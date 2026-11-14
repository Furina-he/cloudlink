//! 受管复制（F-304、F-309）：父级链接透明解析，叶子与内部文件仍严格检查所有权。

pub mod agents;
pub mod backup;
pub(crate) mod groups;
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

fn marker_valid(marker: &Marker, env_id: &EnvId) -> bool {
    marker.managed_by == MANAGED_BY
        && marker.env_id == env_id.as_str()
        && marker.template_version > 0
        && marker.content_hash.len() == 64
        && marker.content_hash.bytes().all(|b| b.is_ascii_hexdigit())
        && crate::time::parse_rfc3339(&marker.compiled_at).is_some()
        && marker.agent_keys.len() <= 64
        && marker.agent_keys.iter().collect::<BTreeSet<_>>().len() == marker.agent_keys.len()
}

fn marker_matches(marker: &Marker, env_id: &EnvId, agent_key: &str) -> bool {
    marker_valid(marker, env_id) && marker.agent_key == agent_key
}

fn marker_matches_group(marker: &Marker, env_id: &EnvId, keys: &[String]) -> bool {
    marker_valid(marker, env_id)
        && keys.contains(&marker.agent_key)
        && marker.agent_keys.iter().all(|key| keys.contains(key))
        && (marker.agent_keys.is_empty() || marker.agent_keys.contains(&marker.agent_key))
}

pub(crate) fn delivery(target: &Target, status: DeliveryStatus) -> Delivery {
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
        unit_id: None,
        shared_agent_keys: None,
    }
}

pub(crate) fn broken(target: &Target, error: &AppError) -> Delivery {
    let mut result = delivery(target, DeliveryStatus::Broken);
    result.status_detail = Some(groups::error_detail(error));
    result
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

fn inspect_path(path: &Path, target: &Target, latest_hash: Option<&str>, keys: &[String]) -> Result<DeliveryStatus> {
    // 叶子本身的链接是冲突；父目录异常不能冒充外来同名 Skill。
    match fs::symlink_metadata(path) {
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(DeliveryStatus::Missing),
        Err(e) => return Err(e.into()),
        Ok(meta) if !meta.is_dir() || fsx::is_link(&meta) => return Ok(DeliveryStatus::Conflict),
        Ok(_) => {}
    }
    paths::reject_link_ancestors(path)?;
    let Some(marker) = publish::read_marker(path).filter(|m| marker_matches_group(m, &target.env_id, keys)) else {
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

fn recheck(paths: &Paths, env: &EnvContext, targets: &[Target], parent: &Path) -> Result<()> {
    for target in targets {
        paths::recheck_parent(paths, env, target, parent)?;
    }
    Ok(())
}

pub fn inspect(paths: &Paths, env: &EnvContext, target: &Target, latest_hash: Option<&str>) -> Result<Delivery> {
    if !env.available {
        return Ok(delivery(target, DeliveryStatus::Pending));
    }
    let parent = match resolve_target_path(paths, env, target) {
        Ok(path) => path,
        Err(error) => return Ok(broken(target, &error)),
    };
    let status = inspect_path(
        &parent.join(SKILL_DIR),
        target,
        latest_hash,
        std::slice::from_ref(&target.agent_key),
    )?;
    Ok(delivery(target, status))
}

pub(crate) fn inspect_unit(
    paths: &Paths,
    env: &EnvContext,
    unit: &groups::Unit,
    latest_hash: Option<&str>,
) -> Result<Delivery> {
    recheck(paths, env, &unit.targets, &unit.parent)?;
    let status = inspect_path(&unit.parent.join(SKILL_DIR), unit.owner(), latest_hash, &unit.keys())?;
    Ok(delivery(unit.owner(), status))
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

/// 编译源始终在应用私有目录，不允许链接；共用组从其主成员的源读取。
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
        .filter(|m| marker_matches(m, env_id, agent_key))
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
                    .map_err(|_| AppError::ipc(IpcErrorId::SourceMissing))?
                    .to_string_lossy()
                    .replace('\\', "/");
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

pub fn sync(
    paths: &Paths,
    env: &EnvContext,
    target: &Target,
    files: &[CompiledFile],
    marker: &Marker,
    repair_modified: bool,
) -> Result<Delivery> {
    sync_inner(
        paths,
        env,
        std::slice::from_ref(target),
        None,
        files,
        marker,
        repair_modified,
        false,
    )
    .map(|(delivery, _)| delivery)
}

pub fn sync_auto(
    paths: &Paths,
    env: &EnvContext,
    target: &Target,
    files: &[CompiledFile],
    marker: &Marker,
) -> Result<(Delivery, Option<backup::BackupMeta>)> {
    sync_inner(
        paths,
        env,
        std::slice::from_ref(target),
        None,
        files,
        marker,
        true,
        true,
    )
}

pub(crate) fn sync_unit_auto(
    paths: &Paths,
    env: &EnvContext,
    unit: &groups::Unit,
    files: &[CompiledFile],
    marker: &Marker,
) -> Result<(Delivery, Option<backup::BackupMeta>)> {
    sync_inner(paths, env, &unit.targets, Some(&unit.parent), files, marker, true, true)
}

pub(crate) fn sync_unit(
    paths: &Paths,
    env: &EnvContext,
    unit: &groups::Unit,
    files: &[CompiledFile],
    marker: &Marker,
) -> Result<Delivery> {
    sync_inner(
        paths,
        env,
        &unit.targets,
        Some(&unit.parent),
        files,
        marker,
        false,
        false,
    )
    .map(|(d, _)| d)
}

pub fn take_over(
    paths: &Paths,
    env: &EnvContext,
    target: &Target,
    files: &[CompiledFile],
    marker: &Marker,
) -> Result<(Delivery, backup::BackupMeta)> {
    take_over_inner(paths, env, target, std::slice::from_ref(target), None, files, marker)
}

pub(crate) fn take_over_unit(
    paths: &Paths,
    env: &EnvContext,
    target: &Target,
    unit: &groups::Unit,
    files: &[CompiledFile],
    marker: &Marker,
) -> Result<(Delivery, backup::BackupMeta)> {
    take_over_inner(paths, env, target, &unit.targets, Some(&unit.parent), files, marker)
}

fn take_over_inner(
    paths: &Paths,
    env: &EnvContext,
    target: &Target,
    targets: &[Target],
    expected: Option<&Path>,
    files: &[CompiledFile],
    marker: &Marker,
) -> Result<(Delivery, backup::BackupMeta)> {
    let parent = expected
        .map(Path::to_path_buf)
        .map(Ok)
        .unwrap_or_else(|| resolve_target_path(paths, env, target))?;
    recheck(paths, env, targets, &parent)?;
    let keys: Vec<_> = targets.iter().map(|t| t.agent_key.clone()).collect();
    let destination = parent.join(SKILL_DIR);
    if inspect_path(&destination, target, Some(&marker.content_hash), &keys)? != DeliveryStatus::Conflict {
        return Err(AppError::ipc(IpcErrorId::NotFound));
    }
    if publish::read_marker(&destination).is_some_and(|m| m.managed_by == MANAGED_BY) {
        return Err(AppError::ipc(IpcErrorId::TargetExists));
    }
    let saved = backup::take_over(paths, target, &destination)?;
    recheck(paths, env, targets, &parent)?;
    let (delivery, _) = sync_inner(paths, env, targets, Some(&parent), files, marker, false, false)?;
    Ok((delivery, saved))
}

pub fn restore_backup(paths: &Paths, env: &EnvContext, target: &Target, backup_id: &str) -> Result<BackupReason> {
    restore_inner(paths, env, target, std::slice::from_ref(target), None, backup_id)
}

pub(crate) fn restore_backup_unit(
    paths: &Paths,
    env: &EnvContext,
    target: &Target,
    unit: &groups::Unit,
    backup_id: &str,
) -> Result<BackupReason> {
    restore_inner(paths, env, target, &unit.targets, Some(&unit.parent), backup_id)
}

fn restore_inner(
    paths: &Paths,
    env: &EnvContext,
    target: &Target,
    targets: &[Target],
    expected: Option<&Path>,
    backup_id: &str,
) -> Result<BackupReason> {
    if !env.available {
        return Err(AppError::ipc(IpcErrorId::TargetExists));
    }
    let (meta, tree) = backup::load(paths, backup_id, target)?;
    let parent = expected
        .map(Path::to_path_buf)
        .map(Ok)
        .unwrap_or_else(|| resolve_target_path(paths, env, target))?;
    recheck(paths, env, targets, &parent)?;
    let destination = parent.join(SKILL_DIR);
    paths::reject_link_ancestors(&destination)?;
    if fs::symlink_metadata(&destination).is_ok() {
        remove_inner(paths, env, targets, Some(&parent))?;
    }
    recheck(paths, env, targets, &parent)?;
    backup::restore_into(&tree, &destination)?;
    Ok(meta.reason)
}

#[allow(clippy::too_many_arguments)]
fn sync_inner(
    paths: &Paths,
    env: &EnvContext,
    targets: &[Target],
    expected: Option<&Path>,
    files: &[CompiledFile],
    marker: &Marker,
    repair_modified: bool,
    backup_modified: bool,
) -> Result<(Delivery, Option<backup::BackupMeta>)> {
    let target = &targets[0];
    let keys: Vec<_> = targets.iter().map(|t| t.agent_key.clone()).collect();
    if !marker_matches_group(marker, &target.env_id, &keys)
        || !files_are_safe(files)
        || publish::files_hash(files) != marker.content_hash
    {
        return Err(AppError::ipc(IpcErrorId::SourceMissing));
    }
    if !env.available {
        return Ok((delivery(target, DeliveryStatus::Pending), None));
    }
    let parent = match expected
        .map(Path::to_path_buf)
        .map(Ok)
        .unwrap_or_else(|| resolve_target_path(paths, env, target))
    {
        Ok(p) => p,
        Err(error) => return Ok((broken(target, &error), None)),
    };
    recheck(paths, env, targets, &parent)?;
    let destination = parent.join(SKILL_DIR);
    let checked = inspect_path(&destination, target, Some(&marker.content_hash), &keys)?;
    if checked == DeliveryStatus::Conflict || (checked == DeliveryStatus::Modified && !repair_modified) {
        return Ok((delivery(target, checked), None));
    }
    if files.is_empty() {
        remove_inner(paths, env, targets, Some(&parent))?;
        return Ok((delivery(target, DeliveryStatus::Missing), None));
    }
    let metadata_current = publish::read_marker(&destination)
        .is_some_and(|old| old.agent_key == marker.agent_key && old.agent_keys == marker.agent_keys);
    if checked == DeliveryStatus::Ok && metadata_current {
        return Ok((delivery(target, checked), None));
    }
    if fs::symlink_metadata(&destination).is_ok() && !ordinary_tree(&destination)? {
        return Err(AppError::ipc(IpcErrorId::TargetExists));
    }
    paths::reject_link_ancestors(&parent)?;
    fs::create_dir_all(&parent)?;
    let nonce = ulid::Ulid::generate();
    let staged = parent.join(format!(".{SKILL_DIR}.cloudlink-stage-{nonce}"));
    let trash = parent.join(format!(".{SKILL_DIR}.cloudlink-trash-{nonce}"));
    fs::create_dir(&staged)?;
    let mut saved = None;
    let result = (|| {
        fsx::write_atomic(&staged.join(MARKER_FILE), &serde_json::to_vec_pretty(marker)?)?;
        publish::write_tree(&staged, files, marker)?;
        if publish::dir_hash(&staged)?.as_deref() != Some(marker.content_hash.as_str()) {
            return Err(AppError::ipc(IpcErrorId::SourceMissing));
        }
        recheck(paths, env, targets, &parent)?;
        let current = inspect_path(&destination, target, Some(&marker.content_hash), &keys)?;
        if current == DeliveryStatus::Conflict || (current == DeliveryStatus::Modified && !repair_modified) {
            return Ok(current);
        }
        if current == DeliveryStatus::Modified && backup_modified {
            saved = Some(backup::create(paths, target, &destination, BackupReason::Modified)?);
        }
        if fs::symlink_metadata(&destination).is_ok() {
            let owns =
                publish::read_marker(&destination).is_some_and(|old| marker_matches_group(&old, &target.env_id, &keys));
            if !owns || !ordinary_tree(&destination)? {
                return Err(AppError::ipc(IpcErrorId::TargetExists));
            }
        }
        recheck(paths, env, targets, &parent)?;
        publish::swap_in(&staged, &destination, &trash)?;
        Ok(DeliveryStatus::Ok)
    })();
    if publish::read_marker(&staged).is_some() && ordinary_tree(&staged).unwrap_or(false) {
        let _ = publish::remove_owned(&staged);
    } else {
        let _ = fs::remove_dir(&staged);
    }
    let _ = fs::remove_dir(&trash);
    Ok((delivery(target, result?), saved))
}

pub fn remove(paths: &Paths, env: &EnvContext, target: &Target) -> Result<bool> {
    remove_inner(paths, env, std::slice::from_ref(target), None)
}

pub(crate) fn remove_unit(paths: &Paths, env: &EnvContext, unit: &groups::Unit) -> Result<bool> {
    remove_inner(paths, env, &unit.targets, Some(&unit.parent))
}

/// 显式移除共用成员时转交同一受管叶子的标记，避免把自己的旧标记误报成外来冲突。
pub(crate) fn retag_unit(paths: &Paths, env: &EnvContext, unit: &groups::Unit, remaining: &[Target]) -> Result<()> {
    recheck(paths, env, &unit.targets, &unit.parent)?;
    let destination = unit.parent.join(SKILL_DIR);
    if !destination.exists() {
        return Ok(());
    }
    let mut marker = publish::read_marker(&destination)
        .filter(|m| marker_matches_group(m, &unit.env_id, &unit.keys()))
        .ok_or_else(|| AppError::ipc(IpcErrorId::TargetExists))?;
    if !ordinary_tree(&destination)? || remaining.is_empty() {
        return Err(AppError::ipc(IpcErrorId::TargetExists));
    }
    let keys: Vec<_> = remaining
        .iter()
        .map(|t| t.agent_key.clone())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();
    marker.agent_key = keys[0].clone();
    marker.agent_keys = if keys.len() > 1 { keys } else { Vec::new() };
    recheck(paths, env, &unit.targets, &unit.parent)?;
    fsx::write_atomic(&destination.join(MARKER_FILE), &serde_json::to_vec_pretty(&marker)?)?;
    Ok(())
}

fn remove_inner(paths: &Paths, env: &EnvContext, targets: &[Target], expected: Option<&Path>) -> Result<bool> {
    let target = &targets[0];
    if !env.available {
        return Err(AppError::ipc(IpcErrorId::TargetExists));
    }
    let parent = expected
        .map(Path::to_path_buf)
        .map(Ok)
        .unwrap_or_else(|| resolve_target_path(paths, env, target))?;
    recheck(paths, env, targets, &parent)?;
    let destination = parent.join(SKILL_DIR);
    match fs::symlink_metadata(&destination) {
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(false),
        Err(e) => return Err(e.into()),
        Ok(_) => {}
    }
    paths::reject_link_ancestors(&destination)?;
    let keys: Vec<_> = targets.iter().map(|t| t.agent_key.clone()).collect();
    let owns =
        publish::read_marker(&destination).is_some_and(|marker| marker_matches_group(&marker, &target.env_id, &keys));
    if !owns || !ordinary_tree(&destination)? {
        return Err(AppError::ipc(IpcErrorId::TargetExists));
    }
    recheck(paths, env, targets, &parent)?;
    publish::remove_owned(&destination)
}

#[cfg(test)]
mod tests;
