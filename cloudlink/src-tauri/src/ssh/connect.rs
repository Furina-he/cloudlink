//! 测试连接（F-106）、主机指纹确认（F-106 AC2）与安装公钥（F-108）。
//!
//! - managed 服务器保存前用只含这台服务器的临时配置（`ssh -F <临时文件>`），末尾附收敛的 `Host *`；
//!   imported 服务器用该环境的用户 config。
//! - 首次连接用 `StrictHostKeyChecking=yes`，从 `ssh -v` 的输出里取服务器出示的指纹交给用户核对；
//!   确认时先在临时 known_hosts 中无认证核对，实际认证只信任这个固定公钥；
//!   成功后以无认证握手和 askpass 精确指纹回复让 OpenSSH 写入用户 known_hosts。
//!   密钥变更时不发送凭据、不执行远端命令、不写入或删除用户记录。
//! - 密码只经 askpass broker 交给 ssh（`secret::askpass`），v0.1 只支持 Windows 原生环境。

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use ssh_key::{HashAlg, KnownHosts, known_hosts::HostPatterns};

use super::classify::{classify, pretty_name, server_host_key};
use super::managed::{ManagedHost, quote_path, render_host};
use super::{SshTools, Tool};
use crate::env::EnvContext;
use crate::error::{AppError, Result};
use crate::fsx;
use crate::model::asset::{AuthMethod, ConnectionInput, ConnectionSource, ServerAsset};
use crate::model::connection::{ConnectionTestStatus, HostKeyInfo, HostKeyKnown};
use crate::model::misc::IpcErrorId;
use crate::model::probe::{SshError, SshErrorId};
use crate::params;
use crate::proc::{self, Ended, RunOpts};
use crate::secret::SecretString;
use crate::secret::askpass::{self, AskpassBroker};

/// 测试连接只执行这两条命令（PRD 8.3）
pub const TEST_COMMAND: &str = "true; cat /etc/os-release 2>/dev/null";
const TEST_TIMEOUT: Duration = Duration::from_secs(20);
/// 待确认的指纹有效期（CC-SWITCH 3.2.5）
pub const TRUST_TTL: Duration = Duration::from_secs(300);

/// 临时配置末尾的收敛块（CC-SWITCH 3.2.4）
const HARDENED_DEFAULTS: &[&str] = &[
    "GlobalKnownHostsFile none",
    "PermitLocalCommand no",
    "ControlMaster no",
    "ControlPath none",
    "UpdateHostKeys no",
    "VerifyHostKeyDNS no",
    "CheckHostIP no",
    "ForwardAgent no",
    "ForwardX11 no",
    "ClearAllForwardings yes",
    "RequestTTY no",
    "ConnectTimeout 10",
    "ConnectionAttempts 1",
];

#[derive(Debug, Clone)]
pub struct TestTarget {
    pub env: EnvContext,
    pub alias: String,
    /// managed：录入的连接（该环境的写法）；None 表示 imported，用用户自己的 ssh config
    pub managed: Option<ManagedHost>,
    pub password: Option<SecretString>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct TestOutcome {
    pub status: ConnectionTestStatus,
    pub ms: u32,
    pub remote_os: Option<String>,
    pub error: Option<SshError>,
    pub host_key: Option<HostKeyInfo>,
}

impl TestOutcome {
    fn failed(error: SshError, ms: u32) -> Self {
        TestOutcome {
            status: ConnectionTestStatus::Failed,
            ms,
            remote_os: None,
            error: Some(error),
            host_key: None,
        }
    }
}

/// 临时配置文件，Drop 时删除
struct TempConfig(PathBuf);

impl Drop for TempConfig {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

fn temp_config_text(t: &TestTarget, h: &ManagedHost) -> String {
    let mut extra = vec![format!(
        "UserKnownHostsFile {}",
        quote_path(&t.env.known_hosts_native())
    )];
    if t.password.is_some() || h.method == AuthMethod::Password {
        extra.extend(["PubkeyAuthentication no".into(), "IdentityAgent none".into()]);
    }
    let mut text = format!("# CloudLink connection test (temporary)\n{}\n", render_host(h, &extra));
    if h.proxy_jump.is_some() {
        // 跳板机的别名要能解析：其余 Host 从用户 config 里找（首个匹配生效，上面这个块优先）
        text.push_str(&format!("\nInclude {}\n", quote_path(&t.env.ssh_config_native())));
    }
    text.push_str("\nHost *\n");
    for l in HARDENED_DEFAULTS {
        text.push_str(&format!("  {l}\n"));
    }
    text
}

/// ssh 参数（不含程序本身）；`--` 之后紧跟别名和远端命令
pub fn test_args(config_native: &str, alias: &str, password: bool, accept_new: bool) -> Vec<String> {
    let mut a: Vec<String> = vec!["-F".into(), fsx::ssh_path(config_native), "-v".into(), "-T".into()];
    let mut opt = |o: &str| {
        a.push("-o".into());
        a.push(o.into());
    };
    if password {
        opt("PreferredAuthentications=password,keyboard-interactive");
        opt("NumberOfPasswordPrompts=1");
        opt("PubkeyAuthentication=no");
    } else {
        opt("BatchMode=yes");
    }
    opt("ConnectTimeout=10");
    opt("FingerprintHash=sha256");
    opt("ConnectionAttempts=1");
    opt("ControlMaster=no");
    opt("ControlPath=none");
    opt("PermitLocalCommand=no");
    opt(if accept_new {
        "StrictHostKeyChecking=accept-new"
    } else {
        "StrictHostKeyChecking=yes"
    });
    a.push("--".into());
    a.push(alias.into());
    a.push(TEST_COMMAND.into());
    a
}

/// Fetch or remember a host key without submitting credentials or opening a session.
/// A known_hosts override is always disposable; only that case may use accept-new.
fn host_key_args(config_native: &str, known_hosts: Option<&str>, alias: &str) -> Vec<String> {
    let mut args = test_args(config_native, alias, false, known_hosts.is_some());
    args.pop(); // No remote command; -N below prevents even a session channel.
    let dd = args.iter().position(|a| a == "--").expect("ssh target separator");
    let mut options = vec!["-N".to_string()];
    for value in [
        "PreferredAuthentications=none".to_string(),
        "PubkeyAuthentication=no".into(),
        "PasswordAuthentication=no".into(),
        "KbdInteractiveAuthentication=no".into(),
        "GSSAPIAuthentication=no".into(),
        "HostbasedAuthentication=no".into(),
        "IdentityAgent=none".into(),
        "IdentityFile=none".into(),
        "GlobalKnownHostsFile=none".into(),
        "HashKnownHosts=no".into(),
        "UpdateHostKeys=no".into(),
        "VerifyHostKeyDNS=no".into(),
        "CheckHostIP=no".into(),
        "ClearAllForwardings=yes".into(),
        "ForwardAgent=no".into(),
    ] {
        options.push("-o".into());
        options.push(value);
    }
    if let Some(path) = known_hosts {
        options.extend([
            "-o".into(),
            format!("HostKeyAlias={alias}"),
            "-o".into(),
            format!("UserKnownHostsFile={}", quote_path(path)),
        ]);
    }
    args.splice(dd..dd, options);
    args
}

/// `remote=None` never authenticates; `accept` permits only public host-key confirmation.
/// A known_hosts override pins actual authentication to the preview's exact public key.
fn run_ssh(
    tools: &SshTools,
    tmp_dir: &std::path::Path,
    t: &TestTarget,
    remote: Option<&str>,
    accept: Option<&str>,
    known_hosts: Option<&str>,
    cancel: Option<&AtomicBool>,
) -> Result<(proc::Output, Option<String>)> {
    let (config_native, _guard) = match &t.managed {
        Some(h) => {
            h.validate(t.env.is_windows())?;
            let path = tmp_dir.join(format!("test-{}.conf", ulid::Ulid::generate()));
            fsx::write_atomic(&path, temp_config_text(t, h).as_bytes())?;
            (t.env.windows_path_to_native(&path), Some(TempConfig(path)))
        }
        None => (t.env.ssh_config_native(), None),
    };
    let mut args = if let Some(remote_command) = remote {
        let mut args = test_args(&config_native, &t.alias, t.password.is_some(), false);
        *args.last_mut().expect("remote command") = remote_command.to_string();
        if let Some(path) = known_hosts {
            let dd = args.iter().position(|a| a == "--").expect("ssh target separator");
            args.splice(
                dd..dd,
                [
                    "-o".into(),
                    format!("UserKnownHostsFile={}", quote_path(path)),
                    "-o".into(),
                    format!("HostKeyAlias={}", t.alias),
                    "-o".into(),
                    "GlobalKnownHostsFile=none".into(),
                    "-o".into(),
                    "VerifyHostKeyDNS=no".into(),
                    "-o".into(),
                    "UpdateHostKeys=no".into(),
                ],
            );
        }
        args
    } else {
        host_key_args(&config_native, known_hosts, &t.alias)
    };
    if accept.is_some() {
        for arg in &mut args {
            if arg == "StrictHostKeyChecking=yes" {
                *arg = "StrictHostKeyChecking=ask".into();
            } else if arg == "BatchMode=yes" {
                *arg = "BatchMode=no".into();
            }
        }
    }
    let mut cmd = tools.command(&t.env, Tool::Ssh);
    cmd.args(&args);
    let opts = RunOpts {
        timeout: TEST_TIMEOUT,
        cancel,
        ..Default::default()
    };
    let password = t.password.as_ref().filter(|_| remote.is_some());
    let out = match password {
        Some(pw) => {
            let mut broker = AskpassBroker::start(pw.clone())?;
            broker.configure(&mut cmd)?;
            let out = proc::run_with_tick(cmd, opts, &mut || broker.poll());
            broker.revoke();
            out?
        }
        None => {
            if let Some(fingerprint) = accept {
                if t.env.is_windows() {
                    askpass::configure_host_key(&mut cmd, fingerprint)?;
                } else {
                    if !t.env.interop {
                        return Err(AppError::ipc(IpcErrorId::InteropDisabled));
                    }
                    let helper = t.env.windows_path_to_native(&std::env::current_exe()?);
                    let inherited_wslenv = std::env::var("WSLENV").unwrap_or_default();
                    askpass::configure_wsl_host_key(&mut cmd, fingerprint, &helper, &inherited_wslenv)?;
                }
            } else {
                cmd.env_remove(askpass::MARKER)
                    .env_remove("SSH_ASKPASS")
                    .env("SSH_ASKPASS_REQUIRE", "never");
            }
            proc::run(cmd, opts)?
        }
    };
    let fp = server_host_key(&out.stderr_str());
    Ok((out, fp))
}

/// ssh 连上了：退出码 255 是 ssh 自己的错误，其余是远端命令的结果
fn connected(o: &proc::Output) -> bool {
    o.ended == Ended::Exited && o.code.is_some_and(|c| c != 255)
}

/// The public key written by OpenSSH is authoritative; an SSH banner can spoof stderr diagnostics.
fn pinned_fingerprint(path: &std::path::Path, alias: &str) -> Option<String> {
    let meta = std::fs::symlink_metadata(path).ok()?;
    if fsx::is_link(&meta) || !meta.is_file() || meta.len() > proc::MAX_OUTPUT {
        return None;
    }
    let content = std::fs::read_to_string(path).ok()?;
    let entries = KnownHosts::new(&content).collect::<ssh_key::Result<Vec<_>>>().ok()?;
    let [entry] = entries.as_slice() else { return None };
    if entry.marker().is_some()
        || !matches!(entry.host_patterns(), HostPatterns::Patterns(patterns) if patterns.len() == 1 && patterns[0].eq_ignore_ascii_case(alias))
    {
        return None;
    }
    Some(entry.public_key().fingerprint(HashAlg::Sha256).to_string())
}

fn preflight(t: &TestTarget, confirming_host_key: bool) -> Option<SshError> {
    let alias = params! {"alias" => t.alias.as_str()};
    if confirming_host_key && !t.env.is_windows() && !t.env.interop {
        return Some(SshError::new(SshErrorId::NeedsInteraction, alias));
    }
    if t.password.is_some() && !t.env.is_windows() {
        return Some(SshError::new(SshErrorId::NeedsInteraction, alias));
    }
    if let Some(h) = &t.managed
        && h.method == AuthMethod::Key
    {
        match &h.identity_file {
            Some(f) if t.env.to_host(f).is_file() => {}
            _ => return Some(SshError::new(SshErrorId::KeyNotFound, alias)),
        }
    }
    None
}

/// 测试连接。`accept`：用户在指纹对话框里确认过的指纹（trust_host_key 之后的重测）
pub fn run_test(
    tools: &SshTools,
    tmp_dir: &std::path::Path,
    t: &TestTarget,
    accept: Option<&str>,
    cancel: Option<&AtomicBool>,
) -> TestOutcome {
    let started = Instant::now();
    let ms = || started.elapsed().as_millis().min(u128::from(u32::MAX)) as u32;
    if let Some(e) = preflight(t, accept.is_some()) {
        return TestOutcome::failed(e, ms());
    }
    // Keep the public key written by the preview alive through actual authentication.
    let pinned_hosts = accept.map(|_| TempConfig(tmp_dir.join(format!("trust-{}.hosts", ulid::Ulid::generate()))));
    if let Some(hosts) = &pinned_hosts
        && fsx::write_atomic(&hosts.0, b"").is_err()
    {
        return TestOutcome::failed(
            SshError::new(SshErrorId::Unknown, params! {"alias" => t.alias.as_str()}),
            ms(),
        );
    }
    let pinned_native = pinned_hosts
        .as_ref()
        .map(|hosts| t.env.windows_path_to_native(&hosts.0));
    if let Some(want) = accept {
        let (preview, fp) = match run_ssh(tools, tmp_dir, t, None, None, pinned_native.as_deref(), cancel) {
            Ok(out) => out,
            Err(_) => {
                return TestOutcome::failed(
                    SshError::new(SshErrorId::Unknown, params! {"alias" => t.alias.as_str()}),
                    ms(),
                );
            }
        };
        if preview.ended == Ended::Cancelled {
            return TestOutcome {
                status: ConnectionTestStatus::Cancelled,
                ms: ms(),
                remote_os: None,
                error: None,
                host_key: None,
            };
        }
        let actual_key = pinned_hosts
            .as_ref()
            .and_then(|hosts| pinned_fingerprint(&hosts.0, &t.alias));
        if let Some(ref actual) = actual_key {
            if actual != want {
                return TestOutcome {
                    status: ConnectionTestStatus::HostKey,
                    ms: ms(),
                    remote_os: None,
                    error: Some(SshError::new(
                        SshErrorId::HostKeyChanged,
                        params! {"alias" => t.alias.as_str()},
                    )),
                    host_key: Some(HostKeyInfo {
                        fingerprint: actual.clone(),
                        known: HostKeyKnown::Changed,
                    }),
                };
            }
        } else {
            return TestOutcome::failed(
                if fp.as_deref().is_some_and(|actual| actual != want) {
                    SshError::new(SshErrorId::HostKeyChanged, params! {"alias" => t.alias.as_str()})
                } else {
                    classify(&preview.stderr_str(), preview.ended == Ended::TimedOut, false, &t.alias)
                },
                ms(),
            );
        }
    }
    let (out, fp) = match run_ssh(
        tools,
        tmp_dir,
        t,
        Some(TEST_COMMAND),
        None,
        pinned_native.as_deref(),
        cancel,
    ) {
        Ok(r) => r,
        Err(e) => {
            log::warn!("connection test could not start: {e}");
            return TestOutcome::failed(
                SshError::new(SshErrorId::Unknown, params! {"alias" => t.alias.as_str()}),
                ms(),
            );
        }
    };
    if out.ended == Ended::Cancelled {
        return TestOutcome {
            status: ConnectionTestStatus::Cancelled,
            ms: ms(),
            remote_os: None,
            error: None,
            host_key: None,
        };
    }
    if let Some(want) = accept
        && fp.as_deref().is_some_and(|actual| actual != want)
    {
        // The temporary known_hosts pins the key; strict checking refuses a race before authentication.
        return TestOutcome {
            status: ConnectionTestStatus::HostKey,
            ms: ms(),
            remote_os: None,
            error: Some(SshError::new(
                SshErrorId::HostKeyChanged,
                params! {"alias" => t.alias.as_str()},
            )),
            host_key: fp.map(|fingerprint| HostKeyInfo {
                fingerprint,
                known: HostKeyKnown::Changed,
            }),
        };
    }
    if connected(&out) {
        if let Some(want) = accept {
            let (remember, actual) = match run_ssh(tools, tmp_dir, t, None, Some(want), None, cancel) {
                Ok(out) => out,
                Err(_) => {
                    return TestOutcome::failed(
                        SshError::new(SshErrorId::HostKeyUnknown, params! {"alias" => t.alias.as_str()}),
                        ms(),
                    );
                }
            };
            if remember.ended == Ended::Cancelled {
                return TestOutcome {
                    status: ConnectionTestStatus::Cancelled,
                    ms: ms(),
                    remote_os: None,
                    error: None,
                    host_key: None,
                };
            }
            if actual.as_deref().is_some_and(|fingerprint| fingerprint != want) {
                return TestOutcome {
                    status: ConnectionTestStatus::HostKey,
                    ms: ms(),
                    remote_os: None,
                    error: Some(SshError::new(
                        SshErrorId::HostKeyChanged,
                        params! {"alias" => t.alias.as_str()},
                    )),
                    host_key: actual.map(|fingerprint| HostKeyInfo {
                        fingerprint,
                        known: HostKeyKnown::Changed,
                    }),
                };
            }
            let detail = remember.stderr_str();
            if actual.as_deref() != Some(want)
                || !(detail.contains("Permanently added ") || detail.contains("is known and matches the "))
            {
                return TestOutcome::failed(
                    SshError::new(SshErrorId::HostKeyUnknown, params! {"alias" => t.alias.as_str()}),
                    ms(),
                );
            }
        }
        return TestOutcome {
            status: ConnectionTestStatus::Ok,
            ms: ms(),
            remote_os: pretty_name(&out.stdout_str()),
            error: None,
            host_key: None,
        };
    }
    let err = classify(
        &out.stderr_str(),
        out.ended == Ended::TimedOut,
        t.password.is_some(),
        &t.alias,
    );
    let known = match err.id {
        SshErrorId::HostKeyUnknown => Some(HostKeyKnown::New),
        SshErrorId::HostKeyChanged => Some(HostKeyKnown::Changed),
        _ => None,
    };
    match (known, fp) {
        (Some(HostKeyKnown::New), Some(fingerprint)) => TestOutcome {
            status: ConnectionTestStatus::HostKey,
            ms: ms(),
            remote_os: None,
            error: None,
            host_key: Some(HostKeyInfo {
                fingerprint,
                known: HostKeyKnown::New,
            }),
        },
        (Some(HostKeyKnown::Changed), Some(fingerprint)) => TestOutcome {
            status: ConnectionTestStatus::HostKey,
            ms: ms(),
            remote_os: None,
            error: Some(err),
            host_key: Some(HostKeyInfo {
                fingerprint,
                known: HostKeyKnown::Changed,
            }),
        },
        _ => TestOutcome::failed(err, ms()),
    }
}

/// 待确认的主机指纹：绑定这次测试的目标，5 分钟有效，只能消费一次
pub struct PendingTrust {
    pub target: TestTarget,
    pub fingerprint: String,
    pub expires: Instant,
}

#[derive(Default)]
pub struct TrustRegistry {
    pending: Mutex<HashMap<String, PendingTrust>>,
}

impl TrustRegistry {
    pub fn insert(&self, test_id: &str, target: TestTarget, fingerprint: String) {
        let mut map = self.pending.lock().unwrap_or_else(|e| e.into_inner());
        let now = Instant::now();
        map.retain(|_, p| p.expires > now);
        map.insert(
            test_id.to_string(),
            PendingTrust {
                target,
                fingerprint,
                expires: now + TRUST_TTL,
            },
        );
    }

    /// 取出并作废；指纹不符或已过期时返回错误
    pub fn take(&self, test_id: &str, fingerprint: &str) -> Result<PendingTrust> {
        let mut map = self.pending.lock().unwrap_or_else(|e| e.into_inner());
        let p = map
            .remove(test_id)
            .ok_or_else(|| AppError::ipc_with(IpcErrorId::NotFound, params! {"testId" => test_id}))?;
        if p.expires <= Instant::now() || p.fingerprint != fingerprint {
            return Err(AppError::ipc_with(IpcErrorId::NotFound, params! {"testId" => test_id}));
        }
        Ok(p)
    }

    pub fn cancel(&self, test_id: &str) {
        self.pending.lock().unwrap_or_else(|e| e.into_inner()).remove(test_id);
    }
}

/// 未传新密码、要用已保存的密码时，连接目标必须和保存的记录完全一致（CC-SWITCH 二.4）。
/// 否则拒绝读取凭据库，绝不把旧目标的密码发往新目标
pub fn saved_password_allowed(saved: &ServerAsset, req: &ConnectionInput) -> Result<()> {
    let c = &saved.connection;
    let same = match req {
        ConnectionInput::Managed {
            host, port, user, auth, ..
        } => {
            c.source == ConnectionSource::Managed
                && c.host.as_deref() == Some(host.as_str())
                && c.port == Some(*port)
                && c.user.as_deref() == Some(user.as_str())
                && c.auth.as_ref().map(|a| a.method) == Some(auth.method)
        }
        ConnectionInput::Imported { .. } => false,
    };
    if same {
        Ok(())
    } else {
        Err(AppError::ipc(IpcErrorId::PasswordTargetChanged))
    }
}

/// 在服务器上追加公钥：只追加一行，已有同一行时不重复；原文件末尾没有换行时先补一个（F-108 AC2）
pub fn install_key_command(public_openssh: &str) -> Result<String> {
    let ok = public_openssh.starts_with("ssh-ed25519 ")
        && public_openssh
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, ' ' | '+' | '/' | '=' | '-' | '_' | '.'));
    if !ok {
        return Err(AppError::internal("unexpected public key format"));
    }
    let k = public_openssh;
    Ok(format!(
        "umask 077; mkdir -p ~/.ssh && touch ~/.ssh/authorized_keys && \
         if ! grep -qxF '{k}' ~/.ssh/authorized_keys; then \
         if [ -s ~/.ssh/authorized_keys ] && [ \"$(tail -c 1 ~/.ssh/authorized_keys)\" != \"\" ]; then echo >> ~/.ssh/authorized_keys; fi; \
         printf '%s\\n' '{k}' >> ~/.ssh/authorized_keys; fi"
    ))
}

/// 用密码登录一次，把公钥追加到 authorized_keys
pub fn install_public_key(
    tools: &SshTools,
    tmp_dir: &std::path::Path,
    t: &TestTarget,
    public_openssh: &str,
) -> std::result::Result<(), SshError> {
    install_public_key_cancellable(tools, tmp_dir, t, public_openssh, None)
}

pub fn install_public_key_cancellable(
    tools: &SshTools,
    tmp_dir: &std::path::Path,
    t: &TestTarget,
    public_openssh: &str,
    cancel: Option<&AtomicBool>,
) -> std::result::Result<(), SshError> {
    let alias = || params! {"alias" => t.alias.as_str()};
    if cancel.is_some_and(|c| c.load(Ordering::SeqCst)) {
        return Err(SshError::new(SshErrorId::Unknown, alias()));
    }
    let remote = install_key_command(public_openssh).map_err(|_| SshError::new(SshErrorId::Unknown, alias()))?;
    let (out, _) = run_ssh(tools, tmp_dir, t, Some(&remote), None, None, cancel)
        .map_err(|_| SshError::new(SshErrorId::Unknown, alias()))?;
    if out.ended == Ended::Exited && out.code == Some(0) {
        Ok(())
    } else if connected(&out) {
        Err(SshError::new(SshErrorId::Partial, alias()))
    } else {
        Err(classify(
            &out.stderr_str(),
            out.ended == Ended::TimedOut,
            t.password.is_some(),
            &t.alias,
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::paths::Paths;
    use crate::testkit;

    fn target(tmp: &std::path::Path, password: bool) -> TestTarget {
        let paths = Paths::isolated_in(tmp);
        TestTarget {
            env: EnvContext::windows(&paths),
            alias: "hk-edge".into(),
            managed: Some(ManagedHost {
                alias: "hk-edge".into(),
                host: "203.0.113.10".into(),
                port: 2222,
                user: "root".into(),
                method: if password {
                    AuthMethod::Password
                } else {
                    AuthMethod::Key
                },
                identity_file: (!password).then(|| tmp.join("id_ed25519").to_string_lossy().into_owned()),
                proxy_jump: None,
            }),
            password: password.then(|| SecretString::new("pw".into()).unwrap()),
        }
    }

    #[test]
    fn args_put_double_dash_before_alias() {
        let a = test_args(r"C:\Users\me\AppData\tmp\t.conf", "hk-edge", false, false);
        let dd = a.iter().position(|x| x == "--").unwrap();
        assert_eq!(&a[dd + 1..], ["hk-edge", TEST_COMMAND]);
        assert!(a.contains(&"BatchMode=yes".to_string()));
        assert!(a.contains(&"StrictHostKeyChecking=yes".to_string()));
        assert_eq!(a[1], "C:/Users/me/AppData/tmp/t.conf");

        let p = test_args("/tmp/t.conf", "hk-edge", true, true);
        assert!(!p.contains(&"BatchMode=yes".to_string()), "BatchMode disables askpass");
        assert!(p.contains(&"NumberOfPasswordPrompts=1".to_string()));
        assert!(p.contains(&"StrictHostKeyChecking=accept-new".to_string()));
    }

    #[test]
    fn confirmation_preview_has_no_authentication_or_remote_session() {
        let args = host_key_args("C:/isolated/test.conf", Some("C:/isolated/trust.hosts"), "hk-edge");
        let dd = args.iter().position(|a| a == "--").unwrap();
        assert_eq!(&args[dd + 1..], ["hk-edge"]);
        for expected in [
            "-N",
            "BatchMode=yes",
            "PreferredAuthentications=none",
            "PubkeyAuthentication=no",
            "PasswordAuthentication=no",
            "KbdInteractiveAuthentication=no",
            "IdentityAgent=none",
            "UserKnownHostsFile=\"C:/isolated/trust.hosts\"",
            "GlobalKnownHostsFile=none",
        ] {
            assert!(args.iter().any(|a| a == expected), "missing {expected}");
        }
    }

    #[test]
    fn temp_config_is_scoped_and_hardened() {
        let tmp = tempfile::tempdir().unwrap();
        let t = target(tmp.path(), true);
        let text = temp_config_text(&t, t.managed.as_ref().unwrap());
        assert!(
            text.contains("Host hk-edge\n  HostName 203.0.113.10\n  Port 2222\n  User root\n  HostKeyAlias hk-edge\n")
        );
        assert!(text.contains("  PubkeyAuthentication no\n  IdentityAgent none"));
        assert!(text.contains("Host *\n  GlobalKnownHostsFile none\n"));
        let known = t.env.known_hosts_native().replace('\\', "/");
        assert!(text.contains(&format!("UserKnownHostsFile \"{known}\"")), "{text}");
        assert!(!text.contains("Include"));
    }

    #[test]
    fn missing_key_and_wsl_password_fail_before_running_ssh() {
        let tmp = tempfile::tempdir().unwrap();
        let tools = SshTools {
            windows_ssh: tmp.path().join("no-ssh.exe"),
        };
        let out = run_test(&tools, tmp.path(), &target(tmp.path(), false), None, None);
        assert_eq!(out.error.unwrap().id, SshErrorId::KeyNotFound);

        let mut t = target(tmp.path(), true);
        t.env = EnvContext::wsl(
            &Paths::isolated_in(tmp.path()),
            "Ubuntu",
            crate::env::WslInfo {
                home: "/home/me".into(),
                ..Default::default()
            },
        );
        let out = run_test(&tools, tmp.path(), &t, None, None);
        assert_eq!(out.error.unwrap().id, SshErrorId::NeedsInteraction);
    }

    #[test]
    fn wsl_host_confirmation_preflight_requires_interop_without_running_a_process() {
        let tmp = tempfile::tempdir().unwrap();
        let mut t = target(tmp.path(), false);
        t.managed = None;
        t.env = EnvContext::wsl(
            &Paths::isolated_in(tmp.path()),
            "Ubuntu",
            crate::env::WslInfo {
                home: "/home/me".into(),
                interop: false,
                ..Default::default()
            },
        );
        assert!(preflight(&t, false).is_none());
        assert_eq!(preflight(&t, true).unwrap().id, SshErrorId::NeedsInteraction);
    }

    #[test]
    fn trust_tokens_are_single_use_and_fingerprint_bound() {
        let tmp = tempfile::tempdir().unwrap();
        let reg = TrustRegistry::default();
        reg.insert("t1", target(tmp.path(), false), "SHA256:abc".into());
        assert!(reg.take("t1", "SHA256:other").is_err());
        assert!(reg.take("t1", "SHA256:abc").is_err(), "a wrong attempt burns the token");
        reg.insert("t2", target(tmp.path(), false), "SHA256:abc".into());
        assert!(reg.take("t2", "SHA256:abc").is_ok());
        assert!(reg.take("t2", "SHA256:abc").is_err());
    }

    #[test]
    fn saved_password_only_for_the_same_target() {
        let mut saved = testkit::dev_box();
        saved.connection.auth.as_mut().unwrap().method = AuthMethod::Password;
        let same = ConnectionInput::Managed {
            ssh_alias: "dev-box".into(),
            host: "192.0.2.44".into(),
            port: 22,
            user: "ubuntu".into(),
            auth: crate::model::asset::AuthInput {
                method: AuthMethod::Password,
                identity_file: Default::default(),
            },
            proxy_jump: None,
            defined_in: vec![],
        };
        assert!(saved_password_allowed(&saved, &same).is_ok());
        for change in 0..4 {
            let mut req = same.clone();
            if let ConnectionInput::Managed {
                host, port, user, auth, ..
            } = &mut req
            {
                match change {
                    0 => *host = "198.51.100.66".into(),
                    1 => *port = 2222,
                    2 => *user = "root".into(),
                    _ => auth.method = AuthMethod::Key,
                }
            }
            assert!(
                saved_password_allowed(&saved, &req)
                    .unwrap_err()
                    .is_ipc(IpcErrorId::PasswordTargetChanged)
            );
        }
    }

    #[test]
    fn install_command_appends_one_line() {
        let k = crate::secret::keygen::generate("hk-edge").unwrap();
        let c = install_key_command(&k.public_openssh).unwrap();
        assert!(c.contains("grep -qxF"));
        assert!(c.contains(">> ~/.ssh/authorized_keys"));
        assert!(!c.replace(">>", "").contains('>'), "never truncate");
        assert!(install_key_command("ssh-ed25519 AAAA x'; rm -rf ~").is_err());
    }

    #[cfg(windows)]
    #[test]
    fn cancelled_key_install_never_sends_password_or_starts_remote_installation() {
        let tmp = tempfile::tempdir().unwrap();
        let (tools, _) = changed_key_tools(tmp.path());
        let script = tmp.path().join("fake-ssh.ps1");
        let code = std::fs::read_to_string(&script).unwrap().replace(
            "exit 0\n",
            "[IO.File]::WriteAllText((Join-Path $PSScriptRoot 'remote-install'), 'yes')\nexit 0\n",
        );
        std::fs::write(script, code).unwrap();
        let key = crate::secret::keygen::generate("hk-edge").unwrap();
        let cancel = AtomicBool::new(true);
        assert!(
            install_public_key_cancellable(
                &tools,
                tmp.path(),
                &target(tmp.path(), true),
                &key.public_openssh,
                Some(&cancel)
            )
            .is_err()
        );
        assert!(!tmp.path().join("received-password").exists());
        assert!(!tmp.path().join("remote-install").exists());
    }

    /// Fake ssh requests the actual broker password and records when it would run a remote command.
    /// Its changed host key models the server being replaced between the dialog and confirmation.
    #[cfg(windows)]
    fn changed_key_tools(dir: &std::path::Path) -> (SshTools, String) {
        let public_key = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAILM+rvN+ot98qgEN796jTiQfZfG1KaT0PtFDJ/XFSqti";
        let fingerprint = ssh_key::PublicKey::from_openssh(public_key)
            .unwrap()
            .fingerprint(HashAlg::Sha256)
            .to_string();
        std::fs::write(
            dir.join("fake-ssh.cmd"),
            "@powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"%~dp0fake-ssh.ps1\" %*\r\n",
        )
        .unwrap();
        std::fs::write(
            dir.join("fake-ssh.ps1"),
            r#"$hostKey = '__HOST_PUBLIC_KEY__'
$fingerprint = '__HOST_FINGERPRINT__'
[Console]::Error.WriteLine("debug1: Server host key: ssh-ed25519 $fingerprint")
if ($args -contains 'StrictHostKeyChecking=accept-new') {
    foreach ($arg in $args) {
        if ($arg.StartsWith('UserKnownHostsFile=')) {
            $path = $arg.Substring('UserKnownHostsFile='.Length).Trim('"')
            [IO.File]::WriteAllText($path, "hk-edge $hostKey`n")
        }
    }
}
if ($env:CLOUDLINK_SSH_ASKPASS -eq '1' -and $args -notcontains 'PreferredAuthentications=none') {
    $client = [Net.Sockets.TcpClient]::new('127.0.0.1', [int]$env:CLOUDLINK_ASKPASS_PORT)
    $stream = $client.GetStream()
    $token = [Text.Encoding]::ASCII.GetBytes($env:CLOUDLINK_ASKPASS_TOKEN + "`n")
    $stream.Write($token, 0, $token.Length)
    $reader = [IO.StreamReader]::new($stream)
    [IO.File]::WriteAllText((Join-Path $PSScriptRoot 'received-password'), $reader.ReadToEnd())
    $client.Dispose()
}
if ($args -contains 'true; cat /etc/os-release 2>/dev/null') {
    [IO.File]::WriteAllText((Join-Path $PSScriptRoot 'remote-ran'), 'yes')
}
if ($args -contains 'StrictHostKeyChecking=accept-new' -or $args -contains 'StrictHostKeyChecking=ask') {
    [Console]::Error.WriteLine("Warning: Permanently added 'hk-edge' (ED25519) to the list of known hosts.")
}
exit 0
"#
            .replace("__HOST_PUBLIC_KEY__", public_key)
            .replace("__HOST_FINGERPRINT__", &fingerprint),
        )
        .unwrap();
        (
            SshTools {
                windows_ssh: dir.join("fake-ssh.cmd"),
            },
            fingerprint,
        )
    }

    #[cfg(windows)]
    #[test]
    fn confirmed_changed_key_never_receives_password() {
        let tmp = tempfile::tempdir().unwrap();
        let (tools, _) = changed_key_tools(tmp.path());
        let t = target(tmp.path(), true);
        let out = run_test(&tools, tmp.path(), &t, Some("SHA256:confirmed"), None);
        assert_eq!(out.error.unwrap().id, SshErrorId::HostKeyChanged);
        assert!(
            !tmp.path().join("received-password").exists(),
            "the fingerprint must be checked before configuring the password broker"
        );
        assert!(!tmp.path().join("remote-ran").exists());
    }

    #[cfg(windows)]
    #[test]
    fn confirmed_changed_key_never_runs_remote_command_with_key_auth() {
        let tmp = tempfile::tempdir().unwrap();
        let (tools, _) = changed_key_tools(tmp.path());
        std::fs::write(tmp.path().join("id_ed25519"), "fake test key").unwrap();
        let t = target(tmp.path(), false);
        let out = run_test(&tools, tmp.path(), &t, Some("SHA256:confirmed"), None);
        assert_eq!(out.error.unwrap().id, SshErrorId::HostKeyChanged);
        assert!(
            !tmp.path().join("remote-ran").exists(),
            "a changed host key must be rejected before any remote command is sent"
        );
    }

    #[cfg(windows)]
    #[test]
    fn confirmed_matching_key_can_authenticate_after_the_preview() {
        let tmp = tempfile::tempdir().unwrap();
        let (tools, fingerprint) = changed_key_tools(tmp.path());
        let t = target(tmp.path(), true);
        let out = run_test(&tools, tmp.path(), &t, Some(&fingerprint), None);
        assert_eq!(out.status, ConnectionTestStatus::Ok);
        assert_eq!(
            std::fs::read_to_string(tmp.path().join("received-password")).unwrap(),
            "pw"
        );
        assert!(tmp.path().join("remote-ran").exists());
    }

    #[cfg(windows)]
    #[test]
    fn a_banner_cannot_spoof_the_confirmed_public_key() {
        let tmp = tempfile::tempdir().unwrap();
        let (tools, _) = changed_key_tools(tmp.path());
        let path = tmp.path().join("fake-ssh.ps1");
        let script = std::fs::read_to_string(&path).unwrap().replace(
            "[Console]::Error.WriteLine(\"debug1: Server host key: ssh-ed25519 $fingerprint\")",
            "[Console]::Error.WriteLine('debug1: Server host key: ssh-ed25519 SHA256:confirmed')",
        );
        std::fs::write(path, script).unwrap();
        let out = run_test(
            &tools,
            tmp.path(),
            &target(tmp.path(), true),
            Some("SHA256:confirmed"),
            None,
        );
        assert_eq!(out.error.unwrap().id, SshErrorId::HostKeyChanged);
        assert!(!tmp.path().join("received-password").exists());
        assert!(!tmp.path().join("remote-ran").exists());
    }
}
