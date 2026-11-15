//! SSH stderr is untrusted. Project only enumerated conclusions, a bounded local client version and exit code.

use super::SshTools;
use crate::env::EnvContext;
use crate::model::connection::{ConnectionDiagnostic, DiagnosticStage, DiagnosticSummaryId, SshClientKind};
use crate::model::probe::SshErrorId;
use crate::proc::{Ended, Output};

fn client(tools: &SshTools, env: &EnvContext) -> SshClientKind {
    if env.distro().is_some() {
        return SshClientKind::WslOpenSsh;
    }
    let path = tools
        .windows_ssh
        .to_string_lossy()
        .replace('\\', "/")
        .to_ascii_lowercase();
    if path.contains("/git/") || path.ends_with("/usr/bin/ssh.exe") {
        SshClientKind::GitOpenSsh
    } else if path.ends_with("/openssh/ssh.exe") {
        SshClientKind::WindowsOpenSsh
    } else {
        SshClientKind::Unknown
    }
}

fn version(stderr: &str) -> Option<String> {
    // A remote banner may imitate later diagnostic lines. Only the client's initial version line qualifies.
    let first = stderr.lines().next()?;
    let value = first
        .strip_prefix("OpenSSH_for_Windows_")
        .or_else(|| first.strip_prefix("OpenSSH_"))?
        .split([',', ' '])
        .next()?;
    (value.len() <= 32
        && value.as_bytes().first().is_some_and(u8::is_ascii_digit)
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-')))
    .then(|| value.into())
}

pub fn for_error(
    tools: &SshTools,
    env: &EnvContext,
    error: SshErrorId,
    output: Option<&Output>,
) -> ConnectionDiagnostic {
    use DiagnosticStage as Stage;
    use DiagnosticSummaryId as Summary;
    let (stage, summary) = match error {
        SshErrorId::AuthFailed | SshErrorId::PasswordRejected => (Stage::Authentication, Summary::CheckLoginAndAuth),
        SshErrorId::KeyPermissions => (Stage::KeyCheck, Summary::KeyPermissions),
        SshErrorId::KeyNotFound => (Stage::KeyCheck, Summary::KeyMissing),
        SshErrorId::KeyInvalid => (Stage::KeyCheck, Summary::KeyFormat),
        SshErrorId::HostKeyChanged => (Stage::HostKey, Summary::HostIdentityChanged),
        SshErrorId::HostKeyUnknown => (Stage::HostKey, Summary::VerifyHostIdentity),
        SshErrorId::Timeout => (Stage::Connection, Summary::NetworkTimeout),
        SshErrorId::ConnectionRefused => (Stage::Connection, Summary::ConnectionRefused),
        SshErrorId::ResolveFailed => (Stage::Connection, Summary::ResolveFailed),
        SshErrorId::NeedsInteraction => (Stage::Authentication, Summary::InteractionRequired),
        _ => (Stage::Connection, Summary::UnknownResult),
    };
    let mut summaries = vec![summary];
    if output.is_some_and(|out| out.ended == Ended::OutputLimit) {
        summaries.push(Summary::OutputLimited);
    }
    ConnectionDiagnostic {
        stage,
        client: client(tools, env),
        client_version: output.and_then(|out| version(&out.stderr_str())),
        exit_code: output.and_then(|out| out.code),
        summary: summaries,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::paths::Paths;
    use std::path::PathBuf;
    use std::time::Duration;

    #[test]
    fn diagnostic_never_exports_target_credentials_or_arbitrary_stderr() {
        let root = tempfile::tempdir().unwrap();
        let env = EnvContext::windows(&Paths::isolated_in(root.path()));
        let tools = SshTools {
            windows_ssh: PathBuf::from(crate::model::misc::DEFAULT_WINDOWS_SSH),
        };
        let out = Output { code: Some(255), stdout: vec![],
            stderr: b"OpenSSH_for_Windows_9.5p1, LibreSSL 3.8.2\nroot@203.0.113.10 password=unsafe-credential\nPRIVATE KEY\n".to_vec(),
            ended: Ended::Exited, elapsed: Duration::from_millis(1) };
        let diagnostic = for_error(&tools, &env, SshErrorId::PasswordRejected, Some(&out));
        assert_eq!(diagnostic.client_version.as_deref(), Some("9.5p1"));
        assert_eq!(diagnostic.exit_code, Some(255));
        assert_eq!(diagnostic.stage, DiagnosticStage::Authentication);
        let json = serde_json::to_string(&diagnostic).unwrap();
        for forbidden in ["203.0.113.10", "root@", "unsafe-credential", "PRIVATE KEY", "stderr"] {
            assert!(!json.contains(forbidden));
        }
    }

    #[test]
    fn only_a_bounded_local_initial_version_is_used() {
        assert_eq!(version("OpenSSH_9.9p2, OpenSSL"), Some("9.9p2".into()));
        assert_eq!(version("banner\nOpenSSH_9.9p2, forged"), None);
        assert_eq!(version("OpenSSH_9.9<script>"), None);
        assert_eq!(version("OpenSSH_credential-token"), None);
    }
}
