//! 只读探测（F-103）：原始输出只在内存中存在，返回与合并的值全部先清洗。
//! 数据库快照、最近一次运行校验和事件发送由 IPC 层负责。

mod merge;
mod parse;
mod runner;

pub use merge::{MergeResult, confirm, merge, undo};
pub use parse::parse;

use std::collections::BTreeSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use crate::env::EnvContext;
use crate::model::asset::{AssetFacts, ListeningPort, Service};
use crate::model::probe::{ProbeStep, ProbeStepStatus, SshError, SshErrorId};
use crate::params as p;
use crate::secret::SecretString;
use crate::secret::askpass::{self, AskpassBroker};
use crate::ssh::{SshTools, Tool};

pub const SCRIPT: &str = include_str!("probe.sh");
pub const MAX_OUTPUT: usize = 64 * 1024;
pub const MAX_VALUE_CHARS: usize = 128;

/// 内部解析结果，不含 raw stdout/stderr。失败段不能用于推断服务已经消失。
#[derive(Debug, Clone, Default)]
pub struct ProbeData {
    pub facts: AssetFacts,
    pub services: Vec<Service>,
    pub listening_ports: Vec<ListeningPort>,
    pub tools: Vec<String>,
    pub failed_sections: Vec<String>,
    pub valid: bool,
    pub(super) successful_sections: BTreeSet<String>,
    pub(super) suspicious_fields: BTreeSet<String>,
    pub(super) suspicious_services: BTreeSet<String>,
}

#[derive(Debug, Clone)]
pub enum ExecuteError {
    Cancelled,
    Failed(SshError),
}

fn ms(started: Instant) -> u32 {
    started.elapsed().as_millis().min(u128::from(u32::MAX)) as u32
}

fn ssh_command(tools: &SshTools, env: &EnvContext, alias: &str, password: bool) -> std::process::Command {
    let mut command = tools.command(env, Tool::Ssh);
    command.args(["-F", &crate::fsx::ssh_path(&env.ssh_config_native()), "-T"]);
    if password {
        for option in [
            "BatchMode=no",
            "PreferredAuthentications=password,keyboard-interactive",
            "NumberOfPasswordPrompts=1",
            "PubkeyAuthentication=no",
            "IdentityAgent=none",
        ] {
            command.args(["-o", option]);
        }
    } else {
        command.args(["-o", "BatchMode=yes"]);
        command
            .env_remove(askpass::MARKER)
            .env_remove("CLOUDLINK_ASKPASS_PORT")
            .env_remove("CLOUDLINK_ASKPASS_TOKEN")
            .env_remove("CLOUDLINK_TRUST_FINGERPRINT")
            .env_remove("SSH_ASKPASS")
            .env("SSH_ASKPASS_REQUIRE", "never");
    }
    for option in [
        "ConnectTimeout=10",
        "StrictHostKeyChecking=yes",
        "PermitLocalCommand=no",
        "ControlMaster=no",
        "ControlPath=none",
        "ClearAllForwardings=yes",
        "ForwardAgent=no",
        "ForwardX11=no",
        "UpdateHostKeys=no",
        "VerifyHostKeyDNS=no",
        "ConnectionAttempts=1",
    ] {
        command.args(["-o", option]);
    }
    command.args(crate::ssh::isolated_options(env, None));
    command.args(["--", alias, "sh -s"]);
    command
}

fn io_error(alias: &str, error: &std::io::Error) -> SshError {
    SshError::new(
        SshErrorId::Unknown,
        p! {"alias" => alias, "osCode" => i64::from(error.raw_os_error().unwrap_or(0))},
    )
}

/// 调用该环境的系统 SSH；Windows 下同一内存 runner 也负责 wsl.exe 的输出。
pub fn execute(
    tools: &SshTools,
    env: &EnvContext,
    alias: &str,
    password: Option<&SecretString>,
    timeout: Duration,
    cancel: &AtomicBool,
    progress: &mut dyn FnMut(ProbeStep, ProbeStepStatus, Option<u32>),
) -> std::result::Result<ProbeData, ExecuteError> {
    use ProbeStep as Step;
    use ProbeStepStatus as Status;

    progress(Step::ResolveAlias, Status::Running, None);
    if !crate::ssh::validate::alias_ok(alias) || !env.available {
        progress(Step::ResolveAlias, Status::Error, Some(0));
        return Err(ExecuteError::Failed(SshError::new(
            SshErrorId::ResolveFailed,
            p! {"alias" => alias},
        )));
    }
    if crate::ssh::managed::check_isolated_config(env, &env.ssh_config_native()).is_err() {
        progress(Step::ResolveAlias, Status::Error, Some(0));
        return Err(ExecuteError::Failed(SshError::new(
            SshErrorId::Unknown,
            p! {"alias" => alias, "reason" => "unsafe-config"},
        )));
    }
    progress(Step::ResolveAlias, Status::Done, Some(0));
    if cancel.load(Ordering::SeqCst) {
        return Err(ExecuteError::Cancelled);
    }
    let started = Instant::now();
    let mut phase = Step::Connect;
    progress(phase, Status::Running, None);
    if password.is_some() && !env.is_windows() {
        progress(phase, Status::Error, Some(ms(started)));
        return Err(ExecuteError::Failed(SshError::new(
            SshErrorId::NeedsInteraction,
            p! {"alias" => alias},
        )));
    }
    let mut command = ssh_command(tools, env, alias, password.is_some());
    let mut broker = match password
        .map(|password| {
            let broker = AskpassBroker::start(password.clone())?;
            broker.configure(&mut command)?;
            Ok::<_, std::io::Error>(broker)
        })
        .transpose()
    {
        Ok(broker) => broker,
        Err(error) => {
            progress(phase, Status::Error, Some(ms(started)));
            return Err(ExecuteError::Failed(io_error(alias, &error)));
        }
    };
    let mut cursor = 0;
    let output = runner::capture(
        command,
        timeout.min(Duration::from_secs(30)).saturating_sub(started.elapsed()),
        cancel,
        &mut || match &mut broker {
            Some(broker) => broker.poll(),
            None => Ok(()),
        },
        &mut |stdout| {
            while let Some(end) = stdout[cursor..].iter().position(|byte| *byte == b'\n') {
                let line = stdout[cursor..cursor + end]
                    .strip_suffix(b"\r")
                    .unwrap_or(&stdout[cursor..cursor + end]);
                cursor += end + 1;
                let next = match line {
                    b"@@os" => Some(Step::CollectSystem),
                    b"@@docker" => Some(Step::CollectServices),
                    b"@@listen" => Some(Step::CollectPorts),
                    _ => None,
                };
                if let Some(next) = next
                    && next != phase
                {
                    progress(phase, Status::Done, Some(ms(started)));
                    phase = next;
                    progress(phase, Status::Running, None);
                }
            }
        },
    );
    if let Some(broker) = &mut broker {
        broker.revoke();
    }
    let output = match output {
        Ok(output) => output,
        Err(runner::CaptureError::Cancelled) => return Err(ExecuteError::Cancelled),
        Err(error) => {
            progress(phase, Status::Error, Some(ms(started)));
            let error = match error {
                runner::CaptureError::TimedOut => crate::ssh::classify::classify("", true, false, alias),
                runner::CaptureError::OutputLimit => {
                    SshError::new(SshErrorId::Unknown, p! {"alias" => alias, "reason" => "output-limit"})
                }
                runner::CaptureError::Unsupported => {
                    SshError::new(SshErrorId::Unknown, p! {"alias" => alias, "reason" => "unsupported"})
                }
                runner::CaptureError::Io(error) => io_error(alias, &error),
                runner::CaptureError::Cancelled => unreachable!("handled above"),
            };
            return Err(ExecuteError::Failed(error));
        }
    };
    if output.code != Some(0) {
        progress(phase, Status::Error, Some(ms(started)));
        return Err(ExecuteError::Failed(crate::ssh::classify::classify(
            &String::from_utf8_lossy(&output.stderr),
            false,
            password.is_some(),
            alias,
        )));
    }
    let data = String::from_utf8(output.stdout).ok().map(|stdout| parse(&stdout));
    let Some(data) = data.filter(|data| data.valid) else {
        progress(phase, Status::Error, Some(ms(started)));
        return Err(ExecuteError::Failed(SshError::new(
            SshErrorId::Unknown,
            p! {"alias" => alias, "reason" => "invalid-output"},
        )));
    };
    progress(phase, Status::Done, Some(ms(started)));
    Ok(data)
}

#[cfg(test)]
mod tests;

#[cfg(test)]
mod isolated_config_tests {
    use super::*;

    #[test]
    fn isolated_probe_rejects_legacy_include_before_starting_ssh() {
        let tmp = tempfile::tempdir().unwrap();
        let env = EnvContext::windows(&crate::paths::Paths::isolated_in(tmp.path()));
        let config = env.host_in_home(&[".ssh", "config"]);
        std::fs::create_dir_all(config.parent().unwrap()).unwrap();
        std::fs::write(&config, "Include ~/.ssh/cloudlink.conf\nHost fixture\n").unwrap();
        let tools = SshTools {
            windows_ssh: tmp.path().join("must-not-start.exe"),
        };
        let mut phases = Vec::new();
        let error = execute(
            &tools,
            &env,
            "fixture",
            None,
            Duration::from_secs(1),
            &AtomicBool::new(false),
            &mut |step, status, _| phases.push((step, status)),
        )
        .unwrap_err();
        let ExecuteError::Failed(error) = error else {
            panic!("unsafe config must fail before starting a probe");
        };
        assert_eq!(error.id, SshErrorId::Unknown);
        assert_eq!(
            error.params.unwrap()["reason"],
            crate::model::ParamValue::from("unsafe-config")
        );
        assert_eq!(
            phases,
            [
                (ProbeStep::ResolveAlias, ProbeStepStatus::Running),
                (ProbeStep::ResolveAlias, ProbeStepStatus::Error),
            ]
        );
    }
}
