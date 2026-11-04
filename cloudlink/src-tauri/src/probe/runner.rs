//! 原始探测输出只走内存管道。PeekNamedPipe 保证读操作不会等待孙进程关闭句柄。

use std::io;
use std::process::Command;
use std::sync::atomic::AtomicBool;
use std::time::Duration;

#[derive(Debug)]
pub(super) enum CaptureError {
    Cancelled,
    TimedOut,
    OutputLimit,
    #[cfg_attr(windows, allow(dead_code, reason = "v0.1 的进程捕获仅支持 Windows"))]
    Unsupported,
    Io(io::Error),
}

impl From<io::Error> for CaptureError {
    fn from(error: io::Error) -> Self {
        Self::Io(error)
    }
}

pub(super) struct Output {
    pub code: Option<i32>,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
}

#[cfg(windows)]
mod windows {
    use std::ffi::c_void;
    use std::io::{Read, Seek, SeekFrom, Write};
    use std::os::windows::io::AsRawHandle;
    use std::process::{Child, Stdio};
    use std::ptr;
    use std::sync::atomic::Ordering;
    use std::time::Instant;

    use super::*;
    use crate::probe::{MAX_OUTPUT, SCRIPT};

    const POLL: Duration = Duration::from_millis(20);

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn PeekNamedPipe(
            handle: *mut c_void,
            buffer: *mut c_void,
            size: u32,
            read: *mut u32,
            available: *mut u32,
            left: *mut u32,
        ) -> i32;
    }

    struct ReapedChild(Child);

    impl Drop for ReapedChild {
        fn drop(&mut self) {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }

    /// 每次只读取 Peek 时已经可用的字节；本线程是该句柄的唯一读者。
    fn drain<R: Read + AsRawHandle>(pipe: &mut R, bytes: &mut Vec<u8>, other_len: usize) -> Result<(), CaptureError> {
        let mut available = 0;
        // SAFETY: pipe 是有效的 ChildStdout/ChildStderr 句柄，available 指向本地 u32。
        // Peek 不取走数据，后续 Read 的长度不超过它返回的可用量。
        let ok = unsafe {
            PeekNamedPipe(
                pipe.as_raw_handle(),
                ptr::null_mut(),
                0,
                ptr::null_mut(),
                &mut available,
                ptr::null_mut(),
            )
        };
        if ok == 0 {
            let error = io::Error::last_os_error();
            return match error.raw_os_error() {
                Some(109) | Some(232) => Ok(()), // ERROR_BROKEN_PIPE / ERROR_NO_DATA
                _ => Err(error.into()),
            };
        }
        let mut remaining = available as usize;
        let mut chunk = [0u8; 4096];
        while remaining > 0 {
            let room = MAX_OUTPUT.saturating_sub(bytes.len() + other_len);
            let take = remaining.min(chunk.len()).min(room + 1);
            let count = pipe.read(&mut chunk[..take])?;
            if count == 0 {
                break;
            }
            bytes.extend_from_slice(&chunk[..count]);
            if bytes.len() + other_len > MAX_OUTPUT {
                return Err(CaptureError::OutputLimit);
            }
            remaining -= count;
        }
        Ok(())
    }

    pub(super) fn capture(
        mut command: Command,
        timeout: Duration,
        cancel: &AtomicBool,
        tick: &mut dyn FnMut() -> io::Result<()>,
        stdout_tick: &mut dyn FnMut(&[u8]),
    ) -> Result<Output, CaptureError> {
        if cancel.load(Ordering::SeqCst) {
            return Err(CaptureError::Cancelled);
        }
        // 临时文件只含内置脚本，不承载任何服务器输出。
        let mut stdin = tempfile::tempfile()?;
        stdin.write_all(SCRIPT.as_bytes())?;
        stdin.seek(SeekFrom::Start(0))?;
        command
            .stdin(Stdio::from(stdin))
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let started = Instant::now();
        let mut child = ReapedChild(command.spawn()?);
        let mut stdout_pipe = child
            .0
            .stdout
            .take()
            .ok_or_else(|| io::Error::other("stdout pipe missing"))?;
        let mut stderr_pipe = child
            .0
            .stderr
            .take()
            .ok_or_else(|| io::Error::other("stderr pipe missing"))?;
        let mut stdout = Vec::new();
        let mut stderr = Vec::new();
        loop {
            if cancel.load(Ordering::SeqCst) {
                return Err(CaptureError::Cancelled);
            }
            if started.elapsed() >= timeout {
                return Err(CaptureError::TimedOut);
            }
            tick()?;
            drain(&mut stdout_pipe, &mut stdout, stderr.len())?;
            stdout_tick(&stdout);
            drain(&mut stderr_pipe, &mut stderr, stdout.len())?;
            if let Some(status) = child.0.try_wait()? {
                // 不等待 EOF：孙进程可能仍持有管道。只再取已经可用的尾部输出。
                drain(&mut stdout_pipe, &mut stdout, stderr.len())?;
                stdout_tick(&stdout);
                drain(&mut stderr_pipe, &mut stderr, stdout.len())?;
                return Ok(Output {
                    code: status.code(),
                    stdout,
                    stderr,
                });
            }
            std::thread::sleep(POLL);
        }
    }
}

pub(super) fn capture(
    command: Command,
    timeout: Duration,
    cancel: &AtomicBool,
    tick: &mut dyn FnMut() -> io::Result<()>,
    stdout_tick: &mut dyn FnMut(&[u8]),
) -> Result<Output, CaptureError> {
    #[cfg(windows)]
    {
        windows::capture(command, timeout, cancel, tick, stdout_tick)
    }
    #[cfg(not(windows))]
    {
        let _ = (command, timeout, cancel, tick, stdout_tick);
        Err(CaptureError::Unsupported)
    }
}
