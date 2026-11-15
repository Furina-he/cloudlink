//! 生成 ed25519 密钥并写入 `~/.ssh/`（F-108 AC1、AC4）。只新建文件，重名时加后缀，绝不覆盖

use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};

use ssh_key::rand_core::OsRng;
use ssh_key::{Algorithm, HashAlg, LineEnding, PrivateKey};
use zeroize::Zeroizing;

use crate::error::{AppError, Result};

pub struct GeneratedKey {
    pub private_openssh: Zeroizing<String>,
    /// `ssh-ed25519 AAAA… cloudlink-<alias>`
    pub public_openssh: String,
    pub fingerprint: String,
}

/// 注释固定以 `cloudlink` 开头，便于用户在 authorized_keys 里认出来（F-108 AC2）
pub fn generate(alias: &str) -> Result<GeneratedKey> {
    let mut key =
        PrivateKey::random(&mut OsRng, Algorithm::Ed25519).map_err(|e| AppError::internal(format!("keygen: {e}")))?;
    key.set_comment(format!("cloudlink-{alias}"));
    let private_openssh = key
        .to_openssh(LineEnding::LF)
        .map_err(|e| AppError::internal(format!("keygen: {e}")))?;
    let public_openssh = key
        .public_key()
        .to_openssh()
        .map_err(|e| AppError::internal(format!("keygen: {e}")))?;
    let fingerprint = key.public_key().fingerprint(HashAlg::Sha256).to_string();
    Ok(GeneratedKey {
        private_openssh,
        public_openssh,
        fingerprint,
    })
}

/// `dir/name`、`dir/name-2`… 中第一个私钥和 `.pub` 都不存在的
pub fn unique_key_path(dir: &Path, name: &str) -> PathBuf {
    let free = |p: &Path| fs::symlink_metadata(p).is_err() && fs::symlink_metadata(pub_path(p)).is_err();
    let first = dir.join(name);
    if free(&first) {
        return first;
    }
    (2..)
        .map(|n| dir.join(format!("{name}-{n}")))
        .find(|p| free(p))
        .expect("unbounded suffix search")
}

pub fn pub_path(private: &Path) -> PathBuf {
    let mut s = private.as_os_str().to_owned();
    s.push(".pub");
    PathBuf::from(s)
}

fn create_new(path: &Path) -> io::Result<fs::File> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    let mut opts = OpenOptions::new();
    opts.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        // Deny access from creation, including before the inherited ACL is restricted.
        opts.share_mode(0);
    }
    opts.open(path)
}

/// 以 create_new 写入，已存在就失败（不覆盖）。WSL 副本由调用方设置 Linux 权限。
pub fn write_new(path: &Path, content: &[u8]) -> io::Result<()> {
    let mut f = create_new(path)?;
    f.write_all(content)?;
    f.sync_all()
}

/// 新建只有当前用户能读写的私钥文件（Windows 收紧 ACL，其他系统 600），已存在就失败
pub fn write_private(path: &Path, content: &[u8]) -> Result<()> {
    let mut private = create_new(path)?;
    #[cfg(windows)]
    crate::fsx::restrict_file_to_current_user(path)?;
    private.write_all(content)?;
    private.sync_all()?;
    Ok(())
}

/// 把生成的密钥写到 `dir/cloudlink_<alias>`（重名加后缀），返回私钥路径
pub fn save(dir: &Path, alias: &str, key: &GeneratedKey) -> Result<PathBuf> {
    let path = unique_key_path(dir, &format!("cloudlink_{alias}"));
    write_private(&path, key.private_openssh.as_bytes())?;
    write_new(&pub_path(&path), format!("{}\n", key.public_openssh).as_bytes())?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generates_and_never_overwrites() {
        let dir = tempfile::tempdir().unwrap();
        let k = generate("hk-edge").unwrap();
        assert!(k.public_openssh.starts_with("ssh-ed25519 "));
        assert!(k.public_openssh.ends_with(" cloudlink-hk-edge"));
        assert!(k.fingerprint.starts_with("SHA256:"));
        assert!(k.private_openssh.starts_with("-----BEGIN OPENSSH PRIVATE KEY-----"));

        let a = save(dir.path(), "hk-edge", &k).unwrap();
        let b = save(dir.path(), "hk-edge", &generate("hk-edge").unwrap()).unwrap();
        assert_eq!(a.file_name().unwrap(), "cloudlink_hk-edge");
        assert_eq!(b.file_name().unwrap(), "cloudlink_hk-edge-2");
        assert_eq!(fs::read_to_string(&a).unwrap(), k.private_openssh.as_str());
        assert!(write_new(&a, b"x").is_err());
    }

    #[cfg(windows)]
    #[test]
    fn private_file_stays_exclusive_until_permissions_and_content_are_ready() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("pending-private-key");
        let mut private = create_new(&path).unwrap();
        for protected in [false, true] {
            if protected {
                crate::fsx::restrict_file_to_current_user(&path).unwrap();
            }
            assert_eq!(fs::File::open(&path).unwrap_err().raw_os_error(), Some(32));
            assert_eq!(
                OpenOptions::new().write(true).open(&path).unwrap_err().raw_os_error(),
                Some(32)
            );
            assert_eq!(fs::remove_file(&path).unwrap_err().raw_os_error(), Some(32));
        }
        private.write_all(b"synthetic private content").unwrap();
        private.sync_all().unwrap();
        drop(private);
        assert_eq!(fs::read(path).unwrap(), b"synthetic private content");
    }

    #[cfg(windows)]
    #[test]
    fn windows_generated_key_is_accepted_even_under_a_permissive_parent() {
        use crate::proc::{self, RunOpts};

        let directory = tempfile::tempdir().unwrap();
        let system =
            PathBuf::from(std::env::var_os("SystemRoot").unwrap_or_else(|| "C:\\Windows".into())).join("System32");
        let mut acl = proc::command(system.join("icacls.exe"));
        acl.arg(directory.path()).args(["/grant", "*S-1-1-0:(OI)(CI)R", "/q"]);
        assert!(proc::run(acl, RunOpts::default()).unwrap().success());

        let key = generate("permission-fixture").unwrap();
        let file = save(directory.path(), "permission-fixture", &key).unwrap();
        let program_data = directory.path().join("ProgramData");
        fs::create_dir(&program_data).unwrap();
        let mut check = proc::command(system.join("OpenSSH/ssh-keygen.exe"));
        check.args(["-y", "-f"]).arg(file).env("ProgramData", program_data);
        let result = proc::run(check, RunOpts::default()).unwrap();
        assert!(result.success(), "{}", result.stderr_str());
        let public = result.stdout_str();
        assert!(public.starts_with("ssh-ed25519 "));
        assert_eq!(
            public.split_whitespace().nth(1),
            key.public_openssh.split_whitespace().nth(1)
        );
    }
}
