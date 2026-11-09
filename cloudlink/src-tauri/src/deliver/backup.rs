//! 副本备份与撤销（F-309）：被改动的副本、接管的同名 Skill 先复制到
//! `~/.cloudlink/backups/<时间>-<ULID>/<目标>/cloudlink-servers/`，再覆盖。
//! 备份目录带 `.cloudlink-backup.json` 归属标记，清理只删带标记、全部由普通文件组成的目录。

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::{ordinary_tree, paths as dpaths};
use crate::compile::publish::{MANAGED_BY, SKILL_DIR};
use crate::error::{AppError, Result};
use crate::fsx;
use crate::model::delivery::{BackupReason, Target};
use crate::model::misc::IpcErrorId;
use crate::paths::Paths;

pub const BACKUP_MARKER: &str = ".cloudlink-backup.json";
/// AC5：保留最近 20 份，或 30 天以内的
pub const KEEP_COUNT: usize = 20;
pub const KEEP_SECS: i64 = 30 * 86_400;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupMeta {
    pub managed_by: String,
    pub backup_id: String,
    pub target_id: String,
    pub env_id: String,
    pub agent_key: String,
    pub reason: BackupReason,
    pub created_at: String,
}

/// IPC 传进来的备份编号只能是本模块生成的形式：数字、字母和连字符
fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
}

fn valid_target_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

fn entry_dir(paths: &Paths, backup_id: &str, target_id: &str) -> PathBuf {
    paths.backups_dir().join(backup_id).join(target_id)
}

/// 只复制普通文件和目录；遇到链接或特殊文件立即失败，不跟随
fn copy_tree(from: &Path, to: &Path) -> io::Result<()> {
    let meta = fs::symlink_metadata(from)?;
    if fsx::is_link(&meta) || !meta.is_dir() {
        return Err(io::Error::new(io::ErrorKind::PermissionDenied, "not a plain directory"));
    }
    fs::create_dir(to)?;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let path = entry.path();
        let child = to.join(entry.file_name());
        let meta = fs::symlink_metadata(&path)?;
        if fsx::is_link(&meta) {
            return Err(io::Error::new(io::ErrorKind::PermissionDenied, "link inside copy"));
        }
        if meta.is_dir() {
            copy_tree(&path, &child)?;
        } else if meta.is_file() {
            fs::copy(&path, &child)?;
        } else {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "special file inside copy",
            ));
        }
    }
    Ok(())
}

fn read_meta(dir: &Path) -> Option<BackupMeta> {
    let path = dir.join(BACKUP_MARKER);
    let meta = fs::symlink_metadata(&path).ok()?;
    if fsx::is_link(&meta) || !meta.is_file() {
        return None;
    }
    serde_json::from_slice::<BackupMeta>(&fs::read(path).ok()?)
        .ok()
        .filter(|m| m.managed_by == MANAGED_BY)
}

/// 把 `source`（目标目录里的 `cloudlink-servers`）复制进一份新备份。复制失败时清掉半成品
pub fn create(paths: &Paths, target: &Target, source: &Path, reason: BackupReason) -> Result<BackupMeta> {
    if !valid_target_id(&target.id) || !ordinary_tree(source)? {
        return Err(AppError::ipc(IpcErrorId::TargetExists));
    }
    let root = paths.backups_dir();
    crate::paths::validate_directory(&root)?;
    fs::create_dir_all(&root)?;
    let now = crate::time::now_secs();
    let stamp: String = crate::time::format_rfc3339(now)
        .chars()
        .filter(char::is_ascii_alphanumeric)
        .collect();
    let backup_id = format!("{stamp}-{}", ulid::Ulid::generate());
    let backup_root = root.join(&backup_id);
    fs::create_dir(&backup_root)?;
    let dir = backup_root.join(&target.id);
    fs::create_dir(&dir)?;
    let meta = BackupMeta {
        managed_by: MANAGED_BY.into(),
        backup_id: backup_id.clone(),
        target_id: target.id.clone(),
        env_id: target.env_id.to_string(),
        agent_key: target.agent_key.clone(),
        reason,
        created_at: crate::time::format_rfc3339(now),
    };
    // 标记先写，半成品也能被识别为 CloudLink 的备份并清理
    fsx::write_atomic(&dir.join(BACKUP_MARKER), &serde_json::to_vec_pretty(&meta)?)?;
    if let Err(error) = copy_tree(source, &dir.join(SKILL_DIR)) {
        let _ = fsx::remove_tree_no_follow(&backup_root);
        return Err(error.into());
    }
    Ok(meta)
}

/// 读取一份备份；目标、编号或归属不符时返回 NotFound
pub fn load(paths: &Paths, backup_id: &str, target: &Target) -> Result<(BackupMeta, PathBuf)> {
    if !valid_id(backup_id) || !valid_target_id(&target.id) {
        return Err(AppError::ipc(IpcErrorId::NotFound));
    }
    let dir = entry_dir(paths, backup_id, &target.id);
    dpaths::reject_link_ancestors(&dir)?;
    let meta = read_meta(&dir)
        .filter(|m| m.backup_id == backup_id && m.target_id == target.id && m.agent_key == target.agent_key)
        .ok_or_else(|| AppError::ipc(IpcErrorId::NotFound))?;
    let tree = dir.join(SKILL_DIR);
    if !ordinary_tree(&tree).unwrap_or(false) {
        return Err(AppError::ipc(IpcErrorId::NotFound));
    }
    Ok((meta, tree))
}

/// 找到某个目标在一份备份里的条目（撤销时调用方只知道备份编号）
pub fn target_of(paths: &Paths, backup_id: &str) -> Result<String> {
    if !valid_id(backup_id) {
        return Err(AppError::ipc(IpcErrorId::NotFound));
    }
    let root = paths.backups_dir().join(backup_id);
    dpaths::reject_link_ancestors(&root)?;
    for entry in fs::read_dir(&root).map_err(|_| AppError::ipc(IpcErrorId::NotFound))? {
        let entry = entry?;
        if let Some(meta) = read_meta(&entry.path())
            && meta.backup_id == backup_id
        {
            return Ok(meta.target_id);
        }
    }
    Err(AppError::ipc(IpcErrorId::NotFound))
}

/// 把备份写回 `destination`（目标目录里的 `cloudlink-servers`）。调用方已经确认它不存在，
/// 或已经删掉了 CloudLink 自己的副本。先复制到同目录的暂存位置，再改名换入
pub fn restore_into(tree: &Path, destination: &Path) -> Result<()> {
    if fs::symlink_metadata(destination).is_ok() {
        return Err(AppError::ipc(IpcErrorId::TargetExists));
    }
    let parent = destination
        .parent()
        .ok_or_else(|| AppError::ipc(IpcErrorId::TargetExists))?;
    dpaths::reject_link_ancestors(parent)?;
    fs::create_dir_all(parent)?;
    let staged = parent.join(format!(".{SKILL_DIR}.cloudlink-restore-{}", ulid::Ulid::generate()));
    if let Err(error) = copy_tree(tree, &staged).and_then(|_| fsx::rename_retry(&staged, destination)) {
        if ordinary_tree(&staged).unwrap_or(false) {
            let _ = fsx::remove_tree_no_follow(&staged);
        }
        return Err(error.into());
    }
    Ok(())
}

/// 接管：把外来的同名 Skill 移进备份。先完整复制并核对，再删除原目录；任何链接都拒绝
pub fn take_over(paths: &Paths, target: &Target, destination: &Path) -> Result<BackupMeta> {
    dpaths::reject_link_ancestors(destination)?;
    let meta = fs::symlink_metadata(destination)?;
    if fsx::is_link(&meta) || !meta.is_dir() || !ordinary_tree(destination)? {
        return Err(AppError::ipc(IpcErrorId::TargetExists));
    }
    let backup = create(paths, target, destination, BackupReason::Takeover)?;
    fsx::remove_tree_no_follow(destination)?;
    Ok(backup)
}

/// AC5：超出最近 20 份且早于 30 天的备份删除；只删带归属标记、全由普通文件组成的
pub fn prune(paths: &Paths, now_secs: i64) -> Result<usize> {
    let root = paths.backups_dir();
    let entries = match fs::read_dir(&root) {
        Ok(entries) => entries,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(0),
        Err(e) => return Err(e.into()),
    };
    dpaths::reject_link_ancestors(&root)?;
    let mut owned = Vec::new();
    for entry in entries {
        let path = entry?.path();
        let Ok(meta) = fs::symlink_metadata(&path) else {
            continue;
        };
        if fsx::is_link(&meta) || !meta.is_dir() {
            continue;
        }
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or_default()
            .to_string();
        let mut created = None;
        let mut all_owned = true;
        for child in fs::read_dir(&path)? {
            match read_meta(&child?.path()) {
                Some(m) if m.backup_id == name => {
                    created = created.max(crate::time::parse_rfc3339(&m.created_at));
                }
                _ => all_owned = false,
            }
        }
        if let (true, Some(created)) = (all_owned, created) {
            owned.push((created, path));
        }
    }
    owned.sort_by_key(|b| std::cmp::Reverse(b.0));
    let mut removed = 0;
    for (created, path) in owned.into_iter().skip(KEEP_COUNT) {
        if now_secs - created > KEEP_SECS && ordinary_tree(&path).unwrap_or(false) {
            fsx::remove_tree_no_follow(&path)?;
            removed += 1;
        }
    }
    Ok(removed)
}

#[cfg(test)]
pub(crate) fn rewrite_created_at(paths: &Paths, backup_id: &str, target_id: &str, created_at: &str) {
    let dir = entry_dir(paths, backup_id, target_id);
    let mut meta = read_meta(&dir).unwrap();
    meta.created_at = created_at.into();
    fs::write(dir.join(BACKUP_MARKER), serde_json::to_vec(&meta).unwrap()).unwrap();
}
