//! 受管复制（F-304、F-309）：不覆盖外来目录；被改动的副本先备份再覆盖。
//! 所有文件系统操作先检查归属及链接/重解析点；数据库与事件由 IPC 层负责。

pub mod agents;
pub mod backup;
mod inclusion;
mod paths;

pub use inclusion::compute_inclusions;
pub use paths::{resolve_target_path, validate_custom_target};

use std::collections::BTreeSet;
use std::fs;
use std::io;
use std::path::{Component, Path};

use crate::compile::publish::{self, MANAGED_BY, MARKER_FILE, Marker, SKILL_DIR};
use crate::env::EnvContext;
use crate::error::{AppError, Result};
use crate::fsx;
use crate::model::compile::CompiledFile;
use crate::model::delivery::{BackupReason, Delivery, DeliveryStatus, Target};
use crate::model::env::EnvId;
use crate::model::misc::IpcErrorId;
use crate::paths::Paths;

fn marker_matches(marker: &Marker, env_id: &EnvId, agent_key: &str) -> bool {
    marker.managed_by == MANAGED_BY
        && marker.env_id == env_id.as_str()
        && marker.agent_key == agent_key
        && marker.template_version > 0
        && marker.content_hash.len() == 64
        && marker.content_hash.bytes().all(|b| b.is_ascii_hexdigit())
        && crate::time::parse_rfc3339(&marker.compiled_at).is_some()
}

fn delivery(target: &Target, status: DeliveryStatus) -> Delivery {
    Delivery {
        id: format!("dlv_{}", target.id),
        target_id: target.id.clone(),
        env_id: target.env_id.clone(),
        path: if target.env_id.is_windows() {
            Path::new(&target.path).join(SKILL_DIR).to_string_lossy().into_owned()
        } else {
            format!("{}/{SKILL_DIR}", target.path.trim_end_matches('/'))
        },
        status,
        status_detail: None,
        checked_at: crate::time::now_rfc3339(),
    }
}

/// 遇到任何非普通文件或链接都拒绝删除/交换，显式修复也不例外。
pub(crate) fn ordinary_tree(path: &Path) -> io::Result<bool> {
    let meta = fs::symlink_metadata(path)?;
    if fsx::is_link(&meta) {
        return Ok(false);
    }
    if meta.is_file() {
        return Ok(true);
    }
    if !meta.is_dir() {
        return Ok(false);
    }
    for entry in fs::read_dir(path)? {
        if !ordinary_tree(&entry?.path())? {
            return Ok(false);
        }
    }
    Ok(true)
}

fn inspect_path(path: &Path, target: &Target, latest_hash: Option<&str>) -> Result<DeliveryStatus> {
    if paths::reject_link_ancestors(path).is_err() {
        return Ok(DeliveryStatus::Conflict);
    }
    match fs::symlink_metadata(path) {
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(DeliveryStatus::Missing),
        Err(e) => return Err(e.into()),
        Ok(meta) if !meta.is_dir() || fsx::is_link(&meta) => return Ok(DeliveryStatus::Conflict),
        Ok(_) => {}
    }
    let Some(marker) =
        publish::read_marker(path).filter(|marker| marker_matches(marker, &target.env_id, &target.agent_key))
    else {
        return Ok(DeliveryStatus::Conflict);
    };
    if publish::dir_hash(path)?.as_deref() != Some(marker.content_hash.as_str()) {
        return Ok(DeliveryStatus::Modified);
    }
    Ok(if latest_hash == Some(marker.content_hash.as_str()) {
        DeliveryStatus::Ok
    } else {
        DeliveryStatus::Outdated
    })
}

/// 健康检查只读目标。`latest_hash` 是当前最新成功编译产物的哈希。
pub fn inspect(paths: &Paths, env: &EnvContext, target: &Target, latest_hash: Option<&str>) -> Result<Delivery> {
    if !env.available {
        return Ok(delivery(target, DeliveryStatus::Pending));
    }
    let skills_dir = match resolve_target_path(paths, env, target) {
        Ok(path) => path,
        Err(AppError::Io(error)) if error.kind() == io::ErrorKind::PermissionDenied => {
            return Ok(delivery(target, DeliveryStatus::Conflict));
        }
        Err(e) => return Err(e),
    };
    let status = inspect_path(&skills_dir.join(SKILL_DIR), target, latest_hash)?;
    Ok(delivery(target, status))
}

fn files_are_safe(files: &[CompiledFile]) -> bool {
    let mut names = BTreeSet::new();
    files.iter().all(|file| {
        let path = Path::new(&file.path);
        let safe = !file.path.is_empty()
            && !file.path.contains(['\\', ':'])
            && !file.path.chars().any(char::is_control)
            && file.path.split('/').all(|segment| {
                !segment.is_empty()
                    && segment != "."
                    && segment != ".."
                    && !segment.ends_with(['.', ' '])
                    && (!cfg!(windows) || paths::windows_component_ok(segment))
            })
            && path
                .components()
                .all(|component| matches!(component, Component::Normal(_)))
            && !file.path.eq_ignore_ascii_case(MARKER_FILE);
        safe && names.insert(if cfg!(windows) {
            file.path.to_lowercase()
        } else {
            file.path.clone()
        })
    })
}

/// 读取上一份成功产物用于修复。缺失时为 None；归属、哈希或树不合法时拒绝读取。
pub fn load_source(paths: &Paths, env_id: &EnvId, agent_key: &str) -> Result<Option<(Marker, Vec<CompiledFile>)>> {
    let source = publish::output_dir(&paths.compiled_dir(), env_id, agent_key);
    paths::reject_link_ancestors(&source)?;
    match fs::symlink_metadata(&source) {
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e.into()),
        Ok(meta) if !meta.is_dir() => return Err(AppError::ipc(IpcErrorId::SourceMissing)),
        Ok(_) => {}
    }
    let marker = publish::read_marker(&source)
        .filter(|marker| marker_matches(marker, env_id, agent_key))
        .ok_or_else(|| AppError::ipc(IpcErrorId::SourceMissing))?;
    if publish::dir_hash(&source)?.as_deref() != Some(marker.content_hash.as_str()) {
        return Err(AppError::ipc(IpcErrorId::SourceMissing));
    }
    fn walk(root: &Path, dir: &Path, files: &mut Vec<CompiledFile>) -> Result<()> {
        for entry in fs::read_dir(dir)? {
            let path = entry?.path();
            let meta = fs::symlink_metadata(&path)?;
            if fsx::is_link(&meta) || (!meta.is_dir() && !meta.is_file()) {
                return Err(AppError::ipc(IpcErrorId::SourceMissing));
            }
            if meta.is_dir() {
                walk(root, &path, files)?;
            } else {
                let relative = path
                    .strip_prefix(root)
                    .map_err(|_| AppError::ipc(IpcErrorId::SourceMissing))?;
                let relative = relative.to_string_lossy().replace('\\', "/");
                if relative != MARKER_FILE {
                    files.push(CompiledFile {
                        path: relative,
                        content: fs::read_to_string(&path)?,
                    });
                }
            }
        }
        Ok(())
    }
    let mut files = Vec::new();
    walk(&source, &source, &mut files)?;
    files.sort_by(|a, b| match (a.path.as_str(), b.path.as_str()) {
        ("SKILL.md", "SKILL.md") => std::cmp::Ordering::Equal,
        ("SKILL.md", _) => std::cmp::Ordering::Less,
        (_, "SKILL.md") => std::cmp::Ordering::Greater,
        _ => a.path.cmp(&b.path),
    });
    if !files_are_safe(&files) || publish::files_hash(&files) != marker.content_hash {
        return Err(AppError::ipc(IpcErrorId::SourceMissing));
    }
    Ok(Some((marker, files)))
}

/// 同步一个目标。I/O 错误由调用方记录为待同步，其余目标可以继续。
/// `repair_modified` 为 true 时覆盖被改动的副本（不备份），冲突永不覆盖。
pub fn sync(
    paths: &Paths,
    env: &EnvContext,
    target: &Target,
    files: &[CompiledFile],
    marker: &Marker,
    repair_modified: bool,
) -> Result<Delivery> {
    sync_inner(paths, env, target, files, marker, repair_modified, false).map(|(delivery, _)| delivery)
}

/// 自动同步（F-309 AC2）：副本被改动时先备份改动的版本再覆盖，返回这份备份
pub fn sync_auto(
    paths: &Paths,
    env: &EnvContext,
    target: &Target,
    files: &[CompiledFile],
    marker: &Marker,
) -> Result<(Delivery, Option<backup::BackupMeta>)> {
    sync_inner(paths, env, target, files, marker, true, true)
}

/// 「备份并接管」（F-309 AC3）：目录里是不带 CloudLink 标记的同名 Skill 时，移进备份再写入
pub fn take_over(
    paths: &Paths,
    env: &EnvContext,
    target: &Target,
    files: &[CompiledFile],
    marker: &Marker,
) -> Result<(Delivery, backup::BackupMeta)> {
    let checked = inspect(paths, env, target, Some(&marker.content_hash))?;
    if checked.status != DeliveryStatus::Conflict {
        return Err(AppError::ipc(IpcErrorId::NotFound));
    }
    let destination = resolve_target_path(paths, env, target)?.join(SKILL_DIR);
    if publish::read_marker(&destination).is_some_and(|m| m.managed_by == MANAGED_BY) {
        // 别的目标（或损坏）的 CloudLink 副本不算外来 Skill，不接管
        return Err(AppError::ipc(IpcErrorId::TargetExists));
    }
    let saved = backup::take_over(paths, target, &destination)?;
    let (delivery, _) = sync_inner(paths, env, target, files, marker, false, false)?;
    Ok((delivery, saved))
}

/// 撤销一份备份：删掉 CloudLink 写入的副本（只删归属匹配的），把备份写回原处
pub fn restore_backup(paths: &Paths, env: &EnvContext, target: &Target, backup_id: &str) -> Result<BackupReason> {
    if !env.available {
        return Err(AppError::ipc(IpcErrorId::TargetExists));
    }
    let (meta, tree) = backup::load(paths, backup_id, target)?;
    let destination = resolve_target_path(paths, env, target)?.join(SKILL_DIR);
    paths::reject_link_ancestors(&destination)?;
    if fs::symlink_metadata(&destination).is_ok() {
        remove(paths, env, target)?;
    }
    backup::restore_into(&tree, &destination)?;
    Ok(meta.reason)
}

fn sync_inner(
    paths: &Paths,
    env: &EnvContext,
    target: &Target,
    files: &[CompiledFile],
    marker: &Marker,
    repair_modified: bool,
    backup_modified: bool,
) -> Result<(Delivery, Option<backup::BackupMeta>)> {
    if !marker_matches(marker, &target.env_id, &target.agent_key)
        || !files_are_safe(files)
        || publish::files_hash(files) != marker.content_hash
    {
        return Err(AppError::ipc(IpcErrorId::SourceMissing));
    }
    let checked = inspect(paths, env, target, Some(&marker.content_hash))?;
    if matches!(checked.status, DeliveryStatus::Conflict | DeliveryStatus::Pending)
        || (checked.status == DeliveryStatus::Modified && !repair_modified)
    {
        return Ok((checked, None));
    }
    let skills_dir = resolve_target_path(paths, env, target)?;
    let destination = skills_dir.join(SKILL_DIR);
    if files.is_empty() {
        remove(paths, env, target)?;
        return Ok((delivery(target, DeliveryStatus::Missing), None));
    }
    if checked.status == DeliveryStatus::Ok {
        return Ok((checked, None));
    }
    if fs::symlink_metadata(&destination).is_ok() && !ordinary_tree(&destination)? {
        return Err(AppError::ipc(IpcErrorId::TargetExists));
    }
    paths::reject_link_ancestors(&skills_dir)?;
    fs::create_dir_all(&skills_dir)?;
    let nonce = ulid::Ulid::generate();
    let staged = skills_dir.join(format!(".{SKILL_DIR}.cloudlink-stage-{nonce}"));
    let trash = skills_dir.join(format!(".{SKILL_DIR}.cloudlink-trash-{nonce}"));
    fs::create_dir(&staged)?;
    let mut saved = None;
    let result = (|| {
        // 标记先写：即使后续写文件失败，清理也能验证这是本次创建的目录。
        fsx::write_atomic(&staged.join(MARKER_FILE), &serde_json::to_vec_pretty(marker)?)?;
        publish::write_tree(&staged, files, marker)?;
        if publish::dir_hash(&staged)?.as_deref() != Some(marker.content_hash.as_str()) {
            return Err(AppError::ipc(IpcErrorId::SourceMissing));
        }
        paths::reject_link_ancestors(&destination)?;
        // 暂存期间外部程序可能改了副本；交换前再次核对，避免覆盖刚发生的改动。
        let current = inspect_path(&destination, target, Some(&marker.content_hash))?;
        if current == DeliveryStatus::Conflict || (current == DeliveryStatus::Modified && !repair_modified) {
            return Ok(current);
        }
        if current == DeliveryStatus::Modified && backup_modified {
            saved = Some(backup::create(paths, target, &destination, BackupReason::Modified)?);
        }
        if fs::symlink_metadata(&destination).is_ok() {
            let owns = publish::read_marker(&destination)
                .is_some_and(|old| marker_matches(&old, &target.env_id, &target.agent_key));
            if !owns || !ordinary_tree(&destination)? {
                return Err(AppError::ipc(IpcErrorId::TargetExists));
            }
        }
        publish::swap_in(&staged, &destination, &trash)?;
        Ok(DeliveryStatus::Ok)
    })();
    if publish::read_marker(&staged).is_some() && ordinary_tree(&staged).unwrap_or(false) {
        let _ = publish::remove_owned(&staged);
    } else {
        // 第一次写标记失败时只能清理已空的本次暂存目录，不能递归删无标记的树。
        let _ = fs::remove_dir(&staged);
    }
    // swap_in 删除它自己创建的 owned 子目录；这里只移除已空的父目录，不递归删除。
    let _ = fs::remove_dir(&trash);
    match result? {
        DeliveryStatus::Ok => Ok((inspect(paths, env, target, Some(&marker.content_hash))?, saved)),
        status => Ok((delivery(target, status), saved)),
    }
}

/// 已确认的停用/移除：只删归属匹配且完全由普通文件组成的副本，不删 skills 根。
pub fn remove(paths: &Paths, env: &EnvContext, target: &Target) -> Result<bool> {
    if !env.available {
        return Err(AppError::ipc(IpcErrorId::TargetExists));
    }
    let destination = resolve_target_path(paths, env, target)?.join(SKILL_DIR);
    match fs::symlink_metadata(&destination) {
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(false),
        Err(e) => return Err(e.into()),
        Ok(_) => {}
    }
    paths::reject_link_ancestors(&destination)?;
    let owns = publish::read_marker(&destination)
        .is_some_and(|marker| marker_matches(&marker, &target.env_id, &target.agent_key));
    if !owns || !ordinary_tree(&destination)? {
        return Err(AppError::ipc(IpcErrorId::TargetExists));
    }
    publish::remove_owned(&destination)
}

#[cfg(test)]
mod tests;
