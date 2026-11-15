//! 文件系统安全操作：原子写入、链接/重解析点检测、所有权校验后的删除（PRD 原则 6、CC-SWITCH 3.3）

use std::fs::{self, File, Metadata, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;

/// 符号链接或 Windows 重解析点（Junction 等，`FILE_ATTRIBUTE_REPARSE_POINT` = 0x400）
pub fn is_link(metadata: &Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return true;
        }
    }
    metadata.file_type().is_symlink()
}

/// 路径存在且是链接
pub fn path_is_link(path: &Path) -> bool {
    fs::symlink_metadata(path).map(|m| is_link(&m)).unwrap_or(false)
}

fn tmp_sibling(path: &Path) -> PathBuf {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    path.with_file_name(format!(".{name}.cloudlink-tmp-{}", ulid::Ulid::generate()))
}

/// 原子写入：同目录临时文件 → fsync → rename。目标是链接时拒绝（不跟随链接改写别处的文件）
pub fn write_atomic(path: &Path, content: &[u8]) -> io::Result<()> {
    if path_is_link(path) {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "refusing to replace a link",
        ));
    }
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    let tmp = tmp_sibling(path);
    let result = (|| {
        let mut f = File::create(&tmp)?;
        f.write_all(content)?;
        f.sync_all()?;
        drop(f);
        rename_retry(&tmp, path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}

/// Restrict a newly created, still-empty file while its creator holds an exclusive handle.
/// Callers own the file; this is never used on a user's original config or an existing private key.
#[cfg(windows)]
pub(crate) fn restrict_file_to_current_user(path: &Path) -> io::Result<()> {
    use crate::proc::{self, RunOpts};

    let system = PathBuf::from(std::env::var_os("SystemRoot").unwrap_or_else(|| "C:\\Windows".into())).join("System32");
    let options = || RunOpts {
        timeout: Duration::from_secs(5),
        max_output: 4096,
        ..Default::default()
    };
    let mut identity = proc::command(system.join("whoami.exe"));
    identity.args(["/user", "/fo", "csv", "/nh"]);
    let identity = proc::run(identity, options()).map_err(|_| io::Error::other("could not determine file owner"))?;
    if !identity.success() {
        return Err(io::Error::other("could not determine file owner"));
    }
    let output = identity.stdout_str();
    let sid = output
        .split(['"', ',', '\r', '\n'])
        .find(|value| {
            value.starts_with("S-1-")
                && value
                    .bytes()
                    .all(|byte| byte.is_ascii_digit() || byte == b'S' || byte == b'-')
        })
        .ok_or_else(|| io::Error::other("file owner SID unavailable"))?;
    let mut acl = proc::command(system.join("icacls.exe"));
    acl.arg(path)
        .args(["/inheritance:r", "/grant:r", &format!("*{sid}:F"), "/q"]);
    let result = proc::run(acl, options()).map_err(|_| io::Error::other("could not protect file permissions"))?;
    if !result.success() {
        return Err(io::Error::other("could not protect file permissions"));
    }
    Ok(())
}

/// Caller first verifies managed-file ownership. Protect the temporary file before publishing it.
/// A failure leaves the unique temporary file in place instead of risking cleanup of a replaced path.
pub(crate) fn write_restricted_atomic(path: &Path, content: &[u8]) -> io::Result<()> {
    if path_is_link(path) {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "refusing to replace a link",
        ));
    }
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    let tmp = tmp_sibling(path);
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.share_mode(0);
    }
    let mut file = options.open(&tmp)?;
    #[cfg(windows)]
    restrict_file_to_current_user(&tmp)?;
    file.write_all(content)?;
    file.sync_all()?;
    drop(file);
    if path_is_link(path) {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "refusing to replace a link",
        ));
    }
    rename_retry(&tmp, path)
}

/// Windows 上文件可能被短暂占用：退避重试 3 次（PRD 8.4 第 5 步）
pub fn rename_retry(from: &Path, to: &Path) -> io::Result<()> {
    let mut last = None;
    for attempt in 0..4u64 {
        match fs::rename(from, to) {
            Ok(()) => return Ok(()),
            Err(e) => last = Some(e),
        }
        if attempt < 3 {
            std::thread::sleep(Duration::from_millis(50 * (attempt + 1)));
        }
    }
    Err(last.unwrap_or_else(|| io::Error::other("rename failed")))
}

/// 递归删除目录，但不跟随链接：遇到链接只删链接本身。
/// 调用方必须先确认这个目录归 CloudLink 所有
pub fn remove_tree_no_follow(path: &Path) -> io::Result<()> {
    let meta = match fs::symlink_metadata(path) {
        Ok(m) => m,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(e),
    };
    if is_link(&meta) {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "refusing to delete through a link",
        ));
    }
    if meta.is_dir() {
        for entry in fs::read_dir(path)? {
            let entry = entry?;
            let child = entry.path();
            let m = fs::symlink_metadata(&child)?;
            if is_link(&m) {
                // 链接本身是 CloudLink 目录里的一项：只删链接，不碰它指向的内容
                if m.is_dir() {
                    fs::remove_dir(&child)?;
                } else {
                    fs::remove_file(&child)?;
                }
            } else if m.is_dir() {
                remove_tree_no_follow(&child)?;
            } else {
                fs::remove_file(&child)?;
            }
        }
        fs::remove_dir(path)
    } else {
        fs::remove_file(path)
    }
}

/// 把 Windows 路径写进 ssh_config 或传给 OpenSSH 时的写法：
/// 去掉 `\\?\` 前缀，反斜杠换成正斜杠（CC-SWITCH 3.2.2）
pub fn ssh_path(path: &str) -> String {
    let p = path
        .strip_prefix(r"\\?\UNC\")
        .map(|rest| format!(r"\\{rest}"))
        .unwrap_or_else(|| path.strip_prefix(r"\\?\").unwrap_or(path).to_string());
    p.replace('\\', "/")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn atomic_write_replaces_content() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("a").join("cloudlink.conf");
        write_atomic(&f, b"one").unwrap();
        write_atomic(&f, b"two").unwrap();
        assert_eq!(fs::read_to_string(&f).unwrap(), "two");
        let leftovers: Vec<_> = fs::read_dir(f.parent().unwrap()).unwrap().collect();
        assert_eq!(leftovers.len(), 1);
    }

    #[test]
    fn ssh_path_strips_verbatim_prefix() {
        assert_eq!(ssh_path(r"\\?\C:\Users\me\.ssh\id"), "C:/Users/me/.ssh/id");
        assert_eq!(ssh_path(r"C:\Users\中文\.ssh\id"), "C:/Users/中文/.ssh/id");
        assert_eq!(ssh_path(r"\\?\UNC\server\share\x"), "//server/share/x");
    }

    #[test]
    fn remove_tree_deletes_nested_files() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("t");
        fs::create_dir_all(root.join("references")).unwrap();
        fs::write(root.join("references").join("x.md"), "x").unwrap();
        remove_tree_no_follow(&root).unwrap();
        assert!(!root.exists());
    }
}
