//! 分发目标的路径检查：未创建的后缀也按最近存在的祖先规范化；拒绝链接与重解析点。

use std::fs;
use std::io;
use std::path::{Component, Path, PathBuf};

use crate::env::EnvContext;
use crate::error::{AppError, Result};
use crate::fsx;
use crate::model::delivery::{AddCustomTargetRequest, Target};
use crate::model::env::EnvId;
use crate::model::misc::IpcErrorId;
use crate::paths::Paths;

fn bad_path() -> AppError {
    AppError::ipc(IpcErrorId::TargetExists)
}

pub(super) fn windows_component_ok(part: &str) -> bool {
    let name = part.split('.').next().unwrap_or("").to_ascii_uppercase();
    let numbered_device = |prefix: &str| {
        name.strip_prefix(prefix)
            .is_some_and(|number| number.len() == 1 && matches!(number.as_bytes()[0], b'1'..=b'9'))
    };
    !part.ends_with(['.', ' '])
        && !matches!(name.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        && !numbered_device("COM")
        && !numbered_device("LPT")
}

fn native_path_ok(env_id: &EnvId, native: &str) -> bool {
    if native.is_empty() || native.chars().any(char::is_control) {
        return false;
    }
    if env_id.wsl_distro().is_some() {
        return native.starts_with('/')
            && !native.contains('\\')
            && native.split('/').all(|part| part != "." && part != "..");
    }
    let path = Path::new(native);
    if !path.is_absolute()
        || path.components().any(|part| matches!(part, Component::ParentDir))
        || native.split(['/', '\\']).any(|part| part == "." || part == "..")
        || native.starts_with(r"\\.\")
        || native.starts_with(r"\\?\")
    {
        return false;
    }
    // 禁止 ADS、Win32 的尾随点/空格别名和设备名，避免等价路径绕过重叠检查。
    if cfg!(windows)
        && native
            .char_indices()
            .any(|(i, c)| c == ':' && !(i == 1 && native.as_bytes()[0].is_ascii_alphabetic()))
    {
        return false;
    }
    if cfg!(windows) {
        for part in path.components().filter_map(|c| match c {
            Component::Normal(s) => s.to_str(),
            _ => None,
        }) {
            if !windows_component_ok(part) {
                return false;
            }
        }
    }
    true
}

fn host_path(paths: &Paths, env_id: &EnvId, native: &str) -> Result<PathBuf> {
    if !native_path_ok(env_id, native) {
        return Err(bad_path());
    }
    let host = match env_id.wsl_distro() {
        Some(distro) => {
            let mut p = paths.wsl_distro_root(distro);
            p.extend(native.split('/').filter(|part| !part.is_empty()));
            p
        }
        None if env_id.is_windows() => PathBuf::from(native),
        _ => return Err(AppError::ipc(IpcErrorId::NotFound)),
    };
    // 隔离模式里的自定义目标也必须属于明确覆盖的根，不能指向真实用户目录。
    if paths.isolated
        && ![&paths.data_dir, &paths.user_home, &paths.wsl_root]
            .iter()
            .any(|root| host.starts_with(root))
    {
        return Err(bad_path());
    }
    Ok(host)
}

/// 检查路径及每一级已存在祖先；不存在的后缀不影响对祖先 Junction 的检查。
pub(super) fn reject_link_ancestors(path: &Path) -> io::Result<()> {
    for ancestor in path.ancestors() {
        if ancestor.as_os_str().is_empty() {
            continue;
        }
        match fs::symlink_metadata(ancestor) {
            Ok(meta) if fsx::is_link(&meta) => {
                return Err(io::Error::new(
                    io::ErrorKind::PermissionDenied,
                    "delivery path contains a link or reparse point",
                ));
            }
            Ok(_) => {}
            Err(e) if e.kind() == io::ErrorKind::NotFound => {}
            Err(e) => return Err(e),
        }
    }
    Ok(())
}

/// 最近存在祖先 canonicalize 后接回不存在的后缀，不能只比较词法路径。
fn canonical_future(path: &Path) -> io::Result<PathBuf> {
    let mut current = path;
    let mut suffix = Vec::new();
    loop {
        match fs::symlink_metadata(current) {
            Ok(_) => {
                let mut resolved = fs::canonicalize(current)?;
                for name in suffix.iter().rev() {
                    resolved.push(name);
                }
                return Ok(resolved);
            }
            Err(e) if e.kind() == io::ErrorKind::NotFound => {
                let name = current
                    .file_name()
                    .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "path has no existing ancestor"))?;
                suffix.push(name.to_os_string());
                current = current
                    .parent()
                    .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "path has no parent"))?;
            }
            Err(e) => return Err(e),
        }
    }
}

fn comparison_path(path: &Path) -> io::Result<PathBuf> {
    let canonical = canonical_future(path)?;
    Ok(if cfg!(windows) {
        PathBuf::from(canonical.to_string_lossy().to_lowercase())
    } else {
        canonical
    })
}

fn paths_overlap(a: &Path, b: &Path) -> io::Result<bool> {
    let (a, b) = (comparison_path(a)?, comparison_path(b)?);
    Ok(a.starts_with(&b) || b.starts_with(&a))
}

/// 返回 skills 目标目录在 CloudLink 进程中的位置；WSL 使用 UNC 或隔离 WSL 根。
pub fn resolve_target_path(paths: &Paths, env: &EnvContext, target: &Target) -> Result<PathBuf> {
    if target.env_id != env.id {
        return Err(AppError::ipc(IpcErrorId::NotFound));
    }
    let path = host_path(paths, &target.env_id, &target.path)?;
    reject_link_ancestors(&path)?;
    Ok(path)
}

/// 添加自定义目标前调用。目录可以尚未创建，不会在校验阶段写文件。
pub fn validate_custom_target(
    paths: &Paths,
    env: &EnvContext,
    req: &AddCustomTargetRequest,
    targets: &[Target],
) -> Result<PathBuf> {
    if req.env_id != env.id {
        return Err(AppError::ipc(IpcErrorId::NotFound));
    }
    let candidate = host_path(paths, &req.env_id, &req.path)?;
    let protected = [
        paths.data_dir.clone(),
        paths.user_home.join(".ssh"),
        env.host_in_home(&[".ssh"]),
    ];
    for other in protected {
        if paths_overlap(&candidate, &other)? {
            return Err(bad_path());
        }
    }
    for target in targets {
        let other = host_path(paths, &target.env_id, &target.path)?;
        if paths_overlap(&candidate, &other)? {
            return Err(bad_path());
        }
    }
    reject_link_ancestors(&candidate)?;
    match fs::symlink_metadata(&candidate) {
        Ok(meta) if !meta.is_dir() => return Err(bad_path()),
        Ok(_) => {}
        Err(e) if e.kind() == io::ErrorKind::NotFound => {}
        Err(e) => return Err(e.into()),
    }
    Ok(candidate)
}
