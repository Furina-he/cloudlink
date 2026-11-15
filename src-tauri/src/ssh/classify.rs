//! ssh 错误分类（PRD 8.3 错误分类表）。只返回 id 和参数，界面文案由 copy.ts 映射

use crate::model::probe::{SshError, SshErrorId};
use crate::params;

/// `password_attempted`：这次连接用的是密码。服务器在拒绝时列出的是它支持的全部方式，
/// 所以「密钥被拒」还是「密码被拒」按我们实际尝试的方式判断
pub fn classify(stderr: &str, timed_out: bool, password_attempted: bool, alias: &str) -> SshError {
    let s = stderr;
    let id = if s.contains("REMOTE HOST IDENTIFICATION HAS CHANGED")
        || s.contains("Host key for") && s.contains("has changed")
    {
        SshErrorId::HostKeyChanged
    } else if s.contains("Host key verification failed") || s.contains("No matching host key") && s.contains("known") {
        SshErrorId::HostKeyUnknown
    } else if s.contains("UNPROTECTED PRIVATE KEY FILE") || s.contains("Bad permissions") {
        SshErrorId::KeyPermissions
    } else if s.contains("Load key") && s.contains("invalid format") {
        SshErrorId::KeyInvalid
    } else if s.contains("no such identity") || s.contains("Warning: Identity file") && s.contains("not accessible") {
        SshErrorId::KeyNotFound
    } else if s.contains("Could not resolve hostname") || s.contains("Name or service not known") {
        SshErrorId::ResolveFailed
    } else if s.contains("Connection refused") {
        SshErrorId::ConnectionRefused
    } else if timed_out
        || s.contains("Connection timed out")
        || s.contains("Operation timed out")
        || s.contains("timed out during banner exchange")
    {
        SshErrorId::Timeout
    } else if !password_attempted && s.to_lowercase().contains("passphrase") {
        SshErrorId::NeedsInteraction
    } else if s.contains("Permission denied") || s.contains("Too many authentication failures") {
        if password_attempted {
            SshErrorId::PasswordRejected
        } else {
            SshErrorId::AuthFailed
        }
    } else {
        SshErrorId::Unknown
    };
    SshError::new(id, params! {"alias" => alias})
}

/// `ssh -v` 输出里服务器出示的主机密钥指纹；有跳板机时取最后一个（目标主机）
pub fn server_host_key(stderr: &str) -> Option<String> {
    stderr
        .lines()
        .filter_map(|l| l.split_once("Server host key: ").map(|(_, rest)| rest))
        .filter_map(|rest| rest.split_whitespace().find(|w| w.starts_with("SHA256:")))
        .map(|fp| fp.trim_end_matches(',').to_string())
        .next_back()
}

/// `/etc/os-release` 的 PRETTY_NAME（去掉引号）
pub fn pretty_name(os_release: &str) -> Option<String> {
    let line = os_release.lines().find(|l| l.starts_with("PRETTY_NAME="))?;
    let v = line["PRETTY_NAME=".len()..].trim().trim_matches(['"', '\'']);
    let v: String = v.chars().filter(|c| !c.is_control()).take(128).collect();
    (!v.is_empty()).then_some(v)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn id(stderr: &str) -> SshErrorId {
        classify(stderr, false, false, "hk-edge").id
    }

    #[test]
    fn classification_table() {
        assert_eq!(
            id("root@203.0.113.10: Permission denied (publickey,password)."),
            SshErrorId::AuthFailed
        );
        assert_eq!(
            classify("root@h: Permission denied (publickey,password).", false, true, "a").id,
            SshErrorId::PasswordRejected
        );
        assert_eq!(
            id(
                "No ED25519 host key is known for hk-edge and you have requested strict checking.\r\nHost key verification failed.\r\n"
            ),
            SshErrorId::HostKeyUnknown
        );
        assert_eq!(
            id("@@@@@\n@    WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!     @\nHost key verification failed."),
            SshErrorId::HostKeyChanged
        );
        assert_eq!(
            id("ssh: Could not resolve hostname nope.invalid: No such host is known."),
            SshErrorId::ResolveFailed
        );
        assert_eq!(
            id("ssh: connect to host 10.0.0.1 port 22: Connection timed out"),
            SshErrorId::Timeout
        );
        assert_eq!(classify("", true, false, "a").id, SshErrorId::Timeout);
        assert_eq!(
            id("ssh: connect to host 127.0.0.1 port 2222: Connection refused"),
            SshErrorId::ConnectionRefused
        );
        assert_eq!(
            id("@ WARNING: UNPROTECTED PRIVATE KEY FILE! @\nPermissions 0777 for '/mnt/c/k' are too open."),
            SshErrorId::KeyPermissions
        );
        assert_eq!(
            id("Warning: Identity file C:/nope not accessible: No such file or directory."),
            SshErrorId::KeyNotFound
        );
        assert_eq!(id("something odd"), SshErrorId::Unknown);
        let e = classify("Connection refused", false, false, "sg-db");
        assert_eq!(
            serde_json::to_value(&e).unwrap(),
            serde_json::json!({"id": "connection-refused", "params": {"alias": "sg-db"}})
        );
    }

    #[test]
    fn password_askpass_diagnostics_do_not_override_authentication_failure() {
        let stderr = "debug1: read_passphrase: requested to askpass\r\ncloudlink@127.0.0.1: Permission denied (publickey,password).\r\n";
        assert_eq!(
            classify(stderr, false, true, "desktop-ssh").id,
            SshErrorId::PasswordRejected
        );
    }

    #[test]
    fn encrypted_private_key_still_requires_interaction_when_authentication_fails() {
        let stderr = "Enter passphrase for key 'fixture_ed25519':\r\ncloudlink@127.0.0.1: Permission denied (publickey,password).\r\n";
        assert_eq!(
            classify(stderr, false, false, "desktop-ssh").id,
            SshErrorId::NeedsInteraction
        );
    }

    #[test]
    fn host_key_from_verbose_output() {
        let s = "debug1: Server host key: ssh-ed25519 SHA256:jump111\r\ndebug1: Server host key: ssh-ed25519 SHA256:AbC+/9xyz\r\n";
        assert_eq!(server_host_key(s).as_deref(), Some("SHA256:AbC+/9xyz"));
        assert_eq!(server_host_key("nothing"), None);
    }

    #[test]
    fn os_release() {
        assert_eq!(
            pretty_name("NAME=\"Ubuntu\"\nPRETTY_NAME=\"Ubuntu 24.04 LTS\"\n").as_deref(),
            Some("Ubuntu 24.04 LTS")
        );
        assert_eq!(pretty_name("ID=alpine\n"), None);
    }
}
