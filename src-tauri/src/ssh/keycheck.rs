//! 私钥文件预检（F-108「检测常见问题」）。CloudLink 自己不读私钥内容（原则 1）：
//! 只看文件是否存在和扩展名，其余交给该环境的 `ssh-keygen -y -P ""`——它只在标准输出给出公钥，
//! 并用和 ssh 相同的规则检查权限（Windows 上是 ACL）、格式和密码短语。

use std::time::Duration;

use ssh_key::{Algorithm, HashAlg, PublicKey};

use super::{SshTools, Tool};
use crate::env::EnvContext;
use crate::model::connection::{KeyCheck, KeyCheckStatus};
use crate::proc::{self, Ended, RunOpts};
use crate::secret::askpass;

const CHECK_TIMEOUT: Duration = Duration::from_secs(10);

/// `native`：该运行环境里的写法
pub fn check(tools: &SshTools, env: &EnvContext, native: &str) -> KeyCheck {
    let native = native.trim();
    if native.is_empty() {
        return KeyCheck::status(KeyCheckStatus::Missing);
    }
    match std::fs::metadata(env.to_host(native)) {
        Ok(meta) if meta.is_file() => {}
        Ok(_) => return KeyCheck::status(KeyCheckStatus::Invalid),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return KeyCheck::status(KeyCheckStatus::Missing),
        Err(_) => return KeyCheck::status(KeyCheckStatus::Unchecked),
    }
    if let Some(status) = by_extension(native) {
        return KeyCheck::status(status);
    }
    let mut cmd = tools.command(env, Tool::SshKeygen);
    // 不弹任何提示：密码短语给空串，askpass 一律关闭
    cmd.args(["-y", "-P", "", "-f", native])
        .env_remove(askpass::MARKER)
        .env_remove("SSH_ASKPASS")
        .env("SSH_ASKPASS_REQUIRE", "never");
    let out = match proc::run(
        cmd,
        RunOpts {
            timeout: CHECK_TIMEOUT,
            max_output: 64 * 1024,
            ..Default::default()
        },
    ) {
        Ok(out) if out.ended == Ended::Exited => out,
        _ => return KeyCheck::status(KeyCheckStatus::Unchecked),
    };
    if out.code == Some(0) {
        return described(&out.stdout_str());
    }
    KeyCheck::status(status_of(&out.stderr_str()))
}

fn by_extension(native: &str) -> Option<KeyCheckStatus> {
    let name = native.rsplit(['/', '\\']).next().unwrap_or(native).to_ascii_lowercase();
    if name.ends_with(".ppk") {
        Some(KeyCheckStatus::Putty)
    } else if name.ends_with(".pub") {
        Some(KeyCheckStatus::PublicKey)
    } else {
        None
    }
}

/// ssh-keygen 失败时的结论；认不出的情况不下结论，留给测试连接
fn status_of(stderr: &str) -> KeyCheckStatus {
    let s = stderr.to_ascii_lowercase();
    if s.contains("unprotected private key file") || s.contains("bad permissions") {
        KeyCheckStatus::Permissions
    } else if s.contains("passphrase") {
        KeyCheckStatus::Passphrase
    } else if s.contains("invalid format") {
        KeyCheckStatus::Invalid
    } else if s.contains("no such file") {
        KeyCheckStatus::Missing
    } else {
        KeyCheckStatus::Unchecked
    }
}

/// 公钥（`ssh-keygen -y` 的输出）→ 类型与 SHA256 指纹
fn described(stdout: &str) -> KeyCheck {
    let Some(key) = stdout
        .lines()
        .find(|l| !l.trim().is_empty())
        .and_then(|l| PublicKey::from_openssh(l.trim()).ok())
    else {
        return KeyCheck::status(KeyCheckStatus::Ok);
    };
    KeyCheck {
        status: KeyCheckStatus::Ok,
        key_type: Some(type_label(&key.algorithm()).into()),
        fingerprint: Some(key.fingerprint(HashAlg::Sha256).to_string()),
    }
}

/// 与 `ssh-keygen -l` 括号里的写法一致
fn type_label(algorithm: &Algorithm) -> &'static str {
    match algorithm {
        Algorithm::Ed25519 => "ED25519",
        Algorithm::Rsa { .. } => "RSA",
        Algorithm::Ecdsa { .. } => "ECDSA",
        Algorithm::SkEd25519 => "ED25519-SK",
        Algorithm::SkEcdsaSha2NistP256 => "ECDSA-SK",
        Algorithm::Dsa => "DSA",
        _ => "SSH",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::paths::Paths;

    #[test]
    fn extension_and_messages_map_to_statuses() {
        assert_eq!(by_extension(r"C:\keys\server.ppk"), Some(KeyCheckStatus::Putty));
        assert_eq!(
            by_extension("/home/me/.ssh/id_ed25519.PUB"),
            Some(KeyCheckStatus::PublicKey)
        );
        assert_eq!(by_extension(r"D:\downloads\ssh-key-2026-05-21.key"), None);
        let open = "WARNING: UNPROTECTED PRIVATE KEY FILE!\nLoad key \"open\": bad permissions";
        assert_eq!(status_of(open), KeyCheckStatus::Permissions);
        assert_eq!(
            status_of("Load key \"enc\": incorrect passphrase supplied to decrypt private key"),
            KeyCheckStatus::Passphrase
        );
        assert_eq!(status_of("Load key \"x.key\": invalid format"), KeyCheckStatus::Invalid);
        assert_eq!(status_of("nope: No such file or directory"), KeyCheckStatus::Missing);
        assert_eq!(status_of("error in libcrypto"), KeyCheckStatus::Unchecked);
    }

    #[test]
    fn public_key_output_gives_type_and_fingerprint() {
        let key = crate::secret::keygen::generate("check").unwrap();
        let checked = described(&format!("{}\n", key.public_openssh));
        assert_eq!(checked.status, KeyCheckStatus::Ok);
        assert_eq!(checked.key_type.as_deref(), Some("ED25519"));
        assert_eq!(checked.fingerprint.as_deref(), Some(key.fingerprint.as_str()));
        assert_eq!(described("garbage").status, KeyCheckStatus::Ok);
    }

    #[test]
    fn missing_files_and_unrunnable_tools_never_block() {
        let tmp = tempfile::tempdir().unwrap();
        let env = EnvContext::windows(&Paths::isolated_in(tmp.path()));
        let tools = SshTools {
            windows_ssh: tmp.path().join("no-ssh.exe"),
        };
        let missing = tmp.path().join("missing").to_string_lossy().into_owned();
        assert_eq!(check(&tools, &env, &missing).status, KeyCheckStatus::Missing);
        assert_eq!(check(&tools, &env, "  ").status, KeyCheckStatus::Missing);
        let dir = tmp.path().to_string_lossy().into_owned();
        assert_eq!(check(&tools, &env, &dir).status, KeyCheckStatus::Invalid);
        let ppk = tmp.path().join("server.ppk");
        std::fs::write(&ppk, "not read").unwrap();
        assert_eq!(
            check(&tools, &env, &ppk.to_string_lossy()).status,
            KeyCheckStatus::Putty
        );
        let key = tmp.path().join("id_fixture");
        std::fs::write(&key, "not read").unwrap();
        assert_eq!(
            check(&tools, &env, &key.to_string_lossy()).status,
            KeyCheckStatus::Unchecked
        );
    }

    /// 用系统 ssh-keygen 验证 Windows ACL：继承了 Everyone 读权限的私钥会被拒绝，收紧后可用
    #[cfg(windows)]
    #[test]
    fn windows_acl_is_checked_by_system_ssh_keygen() {
        let tmp = tempfile::tempdir().unwrap();
        let system = std::path::PathBuf::from(std::env::var_os("SystemRoot").unwrap_or_else(|| "C:\\Windows".into()))
            .join("System32");
        let tools = SshTools {
            windows_ssh: system.join("OpenSSH").join("ssh.exe"),
        };
        if !tools.windows_ssh.with_file_name("ssh-keygen.exe").is_file() {
            return;
        }
        let env = EnvContext::windows(&Paths::isolated_in(tmp.path()));
        let open_dir = tmp.path().join("open");
        std::fs::create_dir(&open_dir).unwrap();
        let mut acl = proc::command(system.join("icacls.exe"));
        acl.arg(&open_dir).args(["/grant", "*S-1-1-0:(OI)(CI)R", "/q"]);
        assert!(proc::run(acl, RunOpts::default()).unwrap().success());
        let key = crate::secret::keygen::generate("acl-fixture").unwrap();
        let open = open_dir.join("open-key");
        std::fs::write(&open, key.private_openssh.as_bytes()).unwrap();
        assert_eq!(
            check(&tools, &env, &open.to_string_lossy()).status,
            KeyCheckStatus::Permissions
        );

        let restricted = crate::secret::keygen::save(&open_dir, "acl-fixture", &key).unwrap();
        let checked = check(&tools, &env, &restricted.to_string_lossy());
        assert_eq!(checked.status, KeyCheckStatus::Ok);
        assert_eq!(checked.fingerprint.as_deref(), Some(key.fingerprint.as_str()));
    }
}
