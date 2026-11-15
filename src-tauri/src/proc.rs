//! 子进程执行（CC-SWITCH 3.2.1）：
//! - Windows 上一律加 `CREATE_NO_WINDOW`，不闪黑框；
//! - stdout/stderr 重定向到匿名临时文件，不用管道，避免孙进程继承句柄导致读取线程挂起；
//! - 每 20ms 检查一次取消、截止时间、输出上限和进程状态，并给调用方一个 tick（askpass 用它驱动 broker）；
//! - `ReapedChild` 在 Drop 时无条件 kill + wait，不留僵尸进程。

use std::ffi::OsStr;
use std::fs::File;
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

/// 输出上限，防输出炸弹
pub const MAX_OUTPUT: u64 = 64 * 1024;
const POLL: Duration = Duration::from_millis(20);

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// 建一个不弹窗的命令
pub fn command(program: impl AsRef<OsStr>) -> Command {
    #[allow(unused_mut)]
    let mut cmd = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Ended {
    Exited,
    TimedOut,
    Cancelled,
    OutputLimit,
}

#[derive(Debug)]
pub struct Output {
    pub code: Option<i32>,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
    pub ended: Ended,
    pub elapsed: Duration,
}

impl Output {
    pub fn success(&self) -> bool {
        self.ended == Ended::Exited && self.code == Some(0)
    }
    pub fn stdout_str(&self) -> String {
        String::from_utf8_lossy(&self.stdout).into_owned()
    }
    pub fn stderr_str(&self) -> String {
        String::from_utf8_lossy(&self.stderr).into_owned()
    }
}

pub struct RunOpts<'a> {
    pub timeout: Duration,
    pub cancel: Option<&'a AtomicBool>,
    pub stdin: Option<&'a [u8]>,
    pub max_output: u64,
}

impl Default for RunOpts<'_> {
    fn default() -> Self {
        RunOpts {
            timeout: Duration::from_secs(15),
            cancel: None,
            stdin: None,
            max_output: MAX_OUTPUT,
        }
    }
}

/// Drop 时一定回收子进程
struct ReapedChild(Child);

impl Drop for ReapedChild {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

fn read_all(mut f: File, limit: u64) -> io::Result<Vec<u8>> {
    f.seek(SeekFrom::Start(0))?;
    let mut buf = Vec::new();
    f.take(limit).read_to_end(&mut buf)?;
    Ok(buf)
}

pub fn run(cmd: Command, opts: RunOpts<'_>) -> io::Result<Output> {
    run_with_tick(cmd, opts, &mut || Ok(()))
}

/// 执行并等待；`tick` 每轮调用一次，返回错误时终止子进程
pub fn run_with_tick(
    mut cmd: Command,
    opts: RunOpts<'_>,
    tick: &mut dyn FnMut() -> io::Result<()>,
) -> io::Result<Output> {
    if opts.cancel.is_some_and(|c| c.load(Ordering::SeqCst)) {
        return Ok(Output {
            code: None,
            stdout: Vec::new(),
            stderr: Vec::new(),
            ended: Ended::Cancelled,
            elapsed: Duration::ZERO,
        });
    }
    let out = tempfile::tempfile()?;
    let err = tempfile::tempfile()?;
    let stdin = match opts.stdin {
        Some(bytes) => {
            let mut f = tempfile::tempfile()?;
            f.write_all(bytes)?;
            f.seek(SeekFrom::Start(0))?;
            Stdio::from(f)
        }
        None => Stdio::null(),
    };
    cmd.stdin(stdin).stdout(out.try_clone()?).stderr(err.try_clone()?);
    let started = Instant::now();
    let mut child = ReapedChild(cmd.spawn()?);
    let deadline = started + opts.timeout;
    let mut ended = Ended::Exited;
    let code = loop {
        if let Some(status) = child.0.try_wait()? {
            break status.code();
        }
        if opts.cancel.is_some_and(|c| c.load(Ordering::SeqCst)) {
            ended = Ended::Cancelled;
            break None;
        }
        if Instant::now() >= deadline {
            ended = Ended::TimedOut;
            break None;
        }
        if out.metadata()?.len() > opts.max_output || err.metadata()?.len() > opts.max_output {
            ended = Ended::OutputLimit;
            break None;
        }
        tick()?;
        std::thread::sleep(POLL);
    };
    drop(child);
    Ok(Output {
        code,
        stdout: read_all(out, opts.max_output)?,
        stderr: read_all(err, opts.max_output)?,
        ended,
        elapsed: started.elapsed(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn shell(script: &str) -> Command {
        if cfg!(windows) {
            let mut c = command("cmd.exe");
            c.args(["/D", "/C", script]);
            c
        } else {
            let mut c = command("sh");
            c.args(["-c", script]);
            c
        }
    }

    #[test]
    fn captures_output_and_exit_code() {
        let o = run(shell("echo hello&& exit 3"), RunOpts::default()).unwrap();
        assert_eq!(o.code, Some(3));
        assert_eq!(o.ended, Ended::Exited);
        assert!(o.stdout_str().contains("hello"));
    }

    #[test]
    fn times_out_and_reaps() {
        let script = if cfg!(windows) {
            "ping -n 30 127.0.0.1 >NUL"
        } else {
            "sleep 30"
        };
        let o = run(
            shell(script),
            RunOpts {
                timeout: Duration::from_millis(300),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(o.ended, Ended::TimedOut);
        assert!(o.elapsed < Duration::from_secs(5));
    }

    #[test]
    fn cancel_flag_stops_the_child() {
        let script = if cfg!(windows) {
            "ping -n 30 127.0.0.1 >NUL"
        } else {
            "sleep 30"
        };
        let flag = AtomicBool::new(true);
        let o = run(
            shell(script),
            RunOpts {
                cancel: Some(&flag),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(o.ended, Ended::Cancelled);
    }

    #[test]
    fn pre_cancelled_command_never_starts_a_process() {
        let tmp = tempfile::tempdir().unwrap();
        let flag = AtomicBool::new(true);
        let out = run(
            command(tmp.path().join("must-not-start.exe")),
            RunOpts {
                cancel: Some(&flag),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(out.ended, Ended::Cancelled);
        assert!(out.stdout.is_empty() && out.stderr.is_empty());
    }
}
