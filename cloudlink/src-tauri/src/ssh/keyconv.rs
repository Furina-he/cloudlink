//! 密码转免密（F-106 AC1、F-108）和复制私钥到 WSL（PRD 6.5）。
//! 密钥总在 Windows 上生成，保存为 `~/.ssh/cloudlink_<别名>`。原因是 SSH_ASKPASS 只在 Windows 侧可用，WSL 里没法用密码登录。
//! WSL 目标要用时，由 `copy_key_to_wsl` 复制过去，再用 `wsl_chmod_private` 收紧权限。

use std::fs;
use std::path::Path;
use std::sync::atomic::AtomicBool;
use std::time::Duration;

use super::SshTools;
use super::connect::{TestTarget, install_public_key, run_test};
use crate::env::EnvContext;
use crate::error::{AppError, Result};
use crate::model::asset::{AssetAuth, AuthMethod};
use crate::model::connection::ConnectionTestStatus;
use crate::model::env::EnvId;
use crate::model::probe::{SshError, SshErrorId};
use crate::params;
use crate::proc::{self, Ended, RunOpts};
use crate::secret::keygen;

#[derive(Debug, Clone, PartialEq)]
pub struct Converted {
    /// 私钥路径（Windows 写法），写进托管配置的 `IdentityFile`
    pub identity_file: String,
    pub fingerprint: String,
}

/// 生成 ed25519 密钥 → 用密码追加公钥 → 只用新私钥再连一次。三步都成功才返回。
/// 任何一步失败，都删掉本机刚生成的密钥文件。服务器上已经追加的那一行公钥保持原样。
pub fn convert_to_key(
    tools: &SshTools,
    tmp_dir: &Path,
    t: &TestTarget,
    cancel: Option<&AtomicBool>,
) -> std::result::Result<Converted, SshError> {
    let alias = || params! {"alias" => t.alias.as_str()};
    let Some(host) = t
        .managed
        .as_ref()
        .filter(|_| t.password.is_some() && t.env.is_windows())
    else {
        return Err(SshError::new(SshErrorId::NeedsInteraction, alias()));
    };
    let key = keygen::generate(&t.alias).map_err(|_| SshError::new(SshErrorId::Unknown, alias()))?;
    let path = keygen::save(&t.env.host_in_home(&[".ssh"]), &t.alias, &key)
        .map_err(|_| SshError::new(SshErrorId::Unknown, alias()))?;
    let discard = || {
        let _ = fs::remove_file(&path);
        let _ = fs::remove_file(keygen::pub_path(&path));
    };
    if let Err(e) = install_public_key(tools, tmp_dir, t, &key.public_openssh) {
        discard();
        return Err(e);
    }
    let file_name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let identity_file = t.env.native_in_home(&[".ssh", &file_name]);
    let mut verify_host = host.clone();
    verify_host.method = AuthMethod::Key;
    verify_host.identity_file = Some(identity_file.clone());
    let verify = TestTarget {
        env: t.env.clone(),
        alias: t.alias.clone(),
        managed: Some(verify_host),
        password: None,
    };
    let out = run_test(tools, tmp_dir, &verify, None, cancel);
    if out.status != ConnectionTestStatus::Ok {
        discard();
        return Err(out.error.unwrap_or_else(|| SshError::new(SshErrorId::Unknown, alias())));
    }
    Ok(Converted {
        identity_file,
        fingerprint: key.fingerprint,
    })
}

/// 转换成功后切换认证方式。调用方随后要从凭据库删掉这台服务器的密码
pub fn apply_key_auth(auth: &mut AssetAuth, env: EnvId, identity_file: String) {
    auth.method = AuthMethod::Key;
    auth.identity_file.insert(env, identity_file);
    auth.generated_by_cloud_link = true;
    auth.password_saved = false;
}

/// 把 Windows 上的私钥（和 `.pub`）复制到 WSL 发行版的 `~/.ssh/`。重名时加后缀，不覆盖已有文件。
/// 返回 WSL 写法的私钥路径
pub fn copy_key_to_wsl(win_private: &Path, wsl: &EnvContext) -> Result<String> {
    if wsl.is_windows() {
        return Err(AppError::internal("copy target must be a WSL environment"));
    }
    let meta = fs::symlink_metadata(win_private)?;
    if crate::fsx::is_link(&meta) || !meta.is_file() {
        return Err(AppError::internal("private key is not a regular file"));
    }
    let name = win_private
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let dest = keygen::unique_key_path(&wsl.host_in_home(&[".ssh"]), &name);
    let private = zeroize::Zeroizing::new(fs::read(win_private)?);
    keygen::write_new(&dest, &private)?;
    if let Ok(public) = fs::read(keygen::pub_path(win_private))
        && let Err(e) = keygen::write_new(&keygen::pub_path(&dest), &public)
    {
        let _ = fs::remove_file(&dest);
        return Err(e.into());
    }
    let dest_name = dest
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    Ok(wsl.native_in_home(&[".ssh", &dest_name]))
}

/// 经 \\wsl.localhost 写入的文件权限过宽，OpenSSH 会拒绝使用。复制后要在发行版内把私钥改成 600
pub fn wsl_chmod_private(wsl: &EnvContext, native: &str) -> Result<()> {
    let Some(distro) = wsl.distro() else {
        return Ok(());
    };
    let mut cmd = proc::command("wsl.exe");
    cmd.args(["-d", distro, "-e", "chmod", "600", "--", native]);
    let out = proc::run(
        cmd,
        RunOpts {
            timeout: Duration::from_secs(15),
            ..Default::default()
        },
    )?;
    if out.ended == Ended::Exited && out.code == Some(0) {
        Ok(())
    } else {
        Err(AppError::internal(format!("chmod 600 failed in {distro}")))
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use super::*;
    use crate::env::WslInfo;
    use crate::paths::Paths;
    use crate::secret::SecretString;
    use crate::ssh::managed::ManagedHost;

    fn wsl(tmp: &Path) -> EnvContext {
        EnvContext::wsl(
            &Paths::isolated_in(tmp),
            "Ubuntu",
            WslInfo {
                home: "/home/me".into(),
                ..Default::default()
            },
        )
    }

    #[test]
    fn conversion_needs_a_password_on_windows() {
        let tmp = tempfile::tempdir().unwrap();
        let paths = Paths::isolated_in(tmp.path());
        let tools = SshTools {
            windows_ssh: tmp.path().join("no-ssh.exe"),
        };
        let mut t = TestTarget {
            env: EnvContext::windows(&paths),
            alias: "hk-edge".into(),
            managed: Some(ManagedHost {
                alias: "hk-edge".into(),
                host: "203.0.113.10".into(),
                port: 22,
                user: "root".into(),
                method: AuthMethod::Password,
                identity_file: None,
                proxy_jump: None,
            }),
            password: None,
        };
        assert_eq!(
            convert_to_key(&tools, tmp.path(), &t, None).unwrap_err().id,
            SshErrorId::NeedsInteraction
        );
        t.env = wsl(tmp.path());
        t.password = Some(SecretString::new("pw".into()).unwrap());
        assert_eq!(
            convert_to_key(&tools, tmp.path(), &t, None).unwrap_err().id,
            SshErrorId::NeedsInteraction
        );
    }

    #[test]
    fn failed_install_leaves_no_key_behind() {
        let tmp = tempfile::tempdir().unwrap();
        let paths = Paths::isolated_in(tmp.path());
        let env = EnvContext::windows(&paths);
        let tools = SshTools {
            windows_ssh: tmp.path().join("no-ssh.exe"),
        };
        let t = TestTarget {
            env: env.clone(),
            alias: "hk-edge".into(),
            managed: Some(ManagedHost {
                alias: "hk-edge".into(),
                host: "203.0.113.10".into(),
                port: 22,
                user: "root".into(),
                method: AuthMethod::Password,
                identity_file: None,
                proxy_jump: None,
            }),
            password: Some(SecretString::new("pw".into()).unwrap()),
        };
        assert!(convert_to_key(&tools, tmp.path(), &t, None).is_err());
        let ssh_dir = env.host_in_home(&[".ssh"]);
        let left: Vec<_> = fs::read_dir(&ssh_dir)
            .map(|d| d.flatten().map(|e| e.file_name()).collect())
            .unwrap_or_default();
        assert!(left.is_empty(), "{left:?}");
    }

    #[test]
    fn switching_auth_records_the_key_for_that_env() {
        let mut auth = AssetAuth {
            method: AuthMethod::Password,
            identity_file: BTreeMap::new(),
            generated_by_cloud_link: false,
            password_saved: true,
        };
        apply_key_auth(
            &mut auth,
            EnvId::windows(),
            r"C:\Users\me\.ssh\cloudlink_hk-edge".into(),
        );
        assert_eq!(auth.method, AuthMethod::Key);
        assert!(auth.generated_by_cloud_link);
        assert!(!auth.password_saved);
        assert_eq!(
            auth.identity_file[&EnvId::windows()],
            r"C:\Users\me\.ssh\cloudlink_hk-edge"
        );
    }

    #[test]
    fn copies_to_wsl_without_overwriting() {
        let tmp = tempfile::tempdir().unwrap();
        let win_dir = tmp.path().join("win-ssh");
        let key = keygen::generate("hk-edge").unwrap();
        let src = keygen::save(&win_dir, "hk-edge", &key).unwrap();
        let env = wsl(tmp.path());

        let existing = env.host_in_home(&[".ssh", "cloudlink_hk-edge"]);
        fs::create_dir_all(existing.parent().unwrap()).unwrap();
        fs::write(&existing, "someone else's key").unwrap();

        let native = copy_key_to_wsl(&src, &env).unwrap();
        assert_eq!(native, "/home/me/.ssh/cloudlink_hk-edge-2");
        assert_eq!(fs::read_to_string(&existing).unwrap(), "someone else's key");
        let copied = env.to_host(&native);
        assert_eq!(fs::read(&copied).unwrap(), fs::read(&src).unwrap());
        assert_eq!(
            fs::read(keygen::pub_path(&copied)).unwrap(),
            fs::read(keygen::pub_path(&src)).unwrap()
        );

        assert!(copy_key_to_wsl(&src, &EnvContext::windows(&Paths::isolated_in(tmp.path()))).is_err());
    }
}
