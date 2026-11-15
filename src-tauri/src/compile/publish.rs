//! 原子发布（PRD 8.4）与所有权标记（3.5）。
//! 写暂存目录 → fsync → 旧目录挪进 `.trash` → 暂存目录改名为正式路径 → 删掉 `.trash`。
//! 只覆盖、删除带有 CloudLink 所有权标记的目录；遇到链接或重解析点一律拒绝。

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::error::{AppError, Result};
use crate::fsx;
use crate::model::compile::CompiledFile;
use crate::model::env::EnvId;

pub const SKILL_DIR: &str = "cloudlink-servers";
pub const MARKER_FILE: &str = ".cloudlink.json";
pub const MANAGED_BY: &str = "cloudlink";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Marker {
    pub managed_by: String,
    pub env_id: String,
    pub agent_key: String,
    /// P8a 共用目录成员；缺失时兼容旧版单 Agent 标记。
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub agent_keys: Vec<String>,
    pub content_hash: String,
    pub compiled_at: String,
    pub template_version: u32,
}

/// 确定性的整树哈希：按相对路径排序，依次喂入「路径、NUL、长度、内容」
pub fn tree_hash<'a>(files: impl IntoIterator<Item = (&'a str, &'a [u8])>) -> String {
    let mut items: Vec<(&str, &[u8])> = files.into_iter().collect();
    items.sort_by(|a, b| a.0.cmp(b.0));
    let mut h = Sha256::new();
    for (path, content) in items {
        h.update(path.as_bytes());
        h.update([0u8]);
        h.update((content.len() as u64).to_le_bytes());
        h.update(content);
    }
    h.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

pub fn files_hash(files: &[CompiledFile]) -> String {
    tree_hash(files.iter().map(|f| (f.path.as_str(), f.content.as_bytes())))
}

/// 目录里实际内容的哈希（不含所有权标记）。遇到链接、重解析点或非普通文件时返回 None（按「被改动」处理）
pub fn dir_hash(dir: &Path) -> io::Result<Option<String>> {
    fn walk(root: &Path, dir: &Path, out: &mut Vec<(String, Vec<u8>)>) -> io::Result<bool> {
        for entry in fs::read_dir(dir)? {
            let entry = entry?;
            let path = entry.path();
            let meta = fs::symlink_metadata(&path)?;
            if fsx::is_link(&meta) {
                return Ok(false);
            }
            let rel = path
                .strip_prefix(root)
                .map_err(io::Error::other)?
                .to_string_lossy()
                .replace('\\', "/");
            if meta.is_dir() {
                if !walk(root, &path, out)? {
                    return Ok(false);
                }
            } else if meta.is_file() {
                if rel != MARKER_FILE {
                    out.push((rel, fs::read(&path)?));
                }
            } else {
                return Ok(false);
            }
        }
        Ok(true)
    }
    let mut files = Vec::new();
    if !walk(dir, dir, &mut files)? {
        return Ok(None);
    }
    Ok(Some(tree_hash(files.iter().map(|(p, c)| (p.as_str(), c.as_slice())))))
}

/// 读所有权标记；目录是链接、没有标记或标记不是 CloudLink 的格式时返回 None
pub fn read_marker(dir: &Path) -> Option<Marker> {
    if fsx::path_is_link(dir) || fsx::path_is_link(&dir.join(MARKER_FILE)) {
        return None;
    }
    let m: Marker = serde_json::from_slice(&fs::read(dir.join(MARKER_FILE)).ok()?).ok()?;
    (m.managed_by == MANAGED_BY).then_some(m)
}

/// 自定义目录追加原始名称的哈希，防止空格、大小写和标点清洗后把不同 Agent 写到同一位置。
pub fn agent_dir_name(agent_key: &str) -> String {
    match agent_key.strip_prefix("custom:") {
        Some(name) => {
            let slug: String = name
                .to_lowercase()
                .chars()
                .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
                .collect::<String>()
                .split('-')
                .filter(|s| !s.is_empty())
                .collect::<Vec<_>>()
                .join("-");
            let short: String = tree_hash([("", name.as_bytes())]).chars().take(16).collect();
            if slug.is_empty() {
                format!("custom-{short}")
            } else {
                format!("custom-{slug}-{short}")
            }
        }
        None => agent_key
            .chars()
            .filter(|c| c.is_ascii_alphanumeric() || *c == '-')
            .collect(),
    }
}

/// `compiled/<环境>/<Agent>/cloudlink-servers`
pub fn output_dir(compiled_root: &Path, env: &EnvId, agent_key: &str) -> PathBuf {
    compiled_root
        .join(env.dir_name())
        .join(agent_dir_name(agent_key))
        .join(SKILL_DIR)
}

/// 写一份完整的 Skill 目录（含所有权标记）到 `dir`，逐个 fsync
pub fn write_tree(dir: &Path, files: &[CompiledFile], marker: &Marker) -> io::Result<()> {
    fs::create_dir_all(dir)?;
    for f in files {
        if f.path.split('/').any(|seg| seg.is_empty() || seg == "." || seg == "..") {
            return Err(io::Error::new(io::ErrorKind::InvalidInput, "bad compiled path"));
        }
        let p = dir.join(&f.path);
        if let Some(parent) = p.parent() {
            fs::create_dir_all(parent)?;
        }
        let file = fs::File::create(&p)?;
        io::Write::write_all(&mut &file, f.content.as_bytes())?;
        file.sync_all()?;
    }
    let marker_json = serde_json::to_vec_pretty(marker).map_err(io::Error::other)?;
    let mf = fs::File::create(dir.join(MARKER_FILE))?;
    io::Write::write_all(&mut &mf, &marker_json)?;
    mf.sync_all()
}

/// 用 `staged` 原子地替换 `target`。`target` 已存在时必须带 CloudLink 的所有权标记
pub fn swap_in(staged: &Path, target: &Path, trash_root: &Path) -> Result<()> {
    let exists = fs::symlink_metadata(target).is_ok();
    if exists && read_marker(target).is_none() {
        return Err(AppError::internal(format!(
            "{} is not owned by CloudLink",
            target.display()
        )));
    }
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)?;
    }
    let trash = trash_root.join(ulid::Ulid::generate().to_string());
    if exists {
        fs::create_dir_all(trash_root)?;
        fsx::rename_retry(target, &trash)?;
    }
    if let Err(e) = fsx::rename_retry(staged, target) {
        // 换不进去：把旧产物放回原处，保留上一次成功的结果
        if exists {
            let _ = fsx::rename_retry(&trash, target);
        }
        return Err(e.into());
    }
    if exists {
        let _ = fsx::remove_tree_no_follow(&trash);
    }
    Ok(())
}

/// 删除带有 CloudLink 所有权标记的 Skill 目录；不存在时什么都不做
pub fn remove_owned(target: &Path) -> Result<bool> {
    if fs::symlink_metadata(target).is_err() {
        return Ok(false);
    }
    if read_marker(target).is_none() {
        return Err(AppError::internal(format!(
            "{} is not owned by CloudLink",
            target.display()
        )));
    }
    fsx::remove_tree_no_follow(target)?;
    Ok(true)
}

/// 发布一份编译结果到 `compiled/`。`files` 为空时移除这一份
pub fn publish(compiled_root: &Path, marker: &Marker, files: &[CompiledFile]) -> Result<PathBuf> {
    let env = EnvId::parse(&marker.env_id).ok_or_else(|| AppError::internal("bad env id"))?;
    let target = output_dir(compiled_root, &env, &marker.agent_key);
    if files.is_empty() {
        remove_owned(&target)?;
        return Ok(target);
    }
    let staging_parent = compiled_root.join(".staging").join(format!(
        "{}-{}-{}",
        env.dir_name(),
        agent_dir_name(&marker.agent_key),
        ulid::Ulid::generate()
    ));
    let staged = staging_parent.join(SKILL_DIR);
    let result = write_tree(&staged, files, marker)
        .map_err(AppError::from)
        .and_then(|_| swap_in(&staged, &target, &compiled_root.join(".trash")));
    let _ = fsx::remove_tree_no_follow(&staging_parent);
    result.map(|_| target)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn files(text: &str) -> Vec<CompiledFile> {
        vec![
            CompiledFile {
                path: "SKILL.md".into(),
                content: text.into(),
            },
            CompiledFile {
                path: "references/hk-edge.md".into(),
                content: "# hk-edge\n".into(),
            },
        ]
    }

    fn marker(files: &[CompiledFile]) -> Marker {
        Marker {
            managed_by: MANAGED_BY.into(),
            env_id: "wsl:Ubuntu-24.04".into(),
            agent_key: "claude-code".into(),
            agent_keys: Vec::new(),
            content_hash: files_hash(files),
            compiled_at: "2026-10-31T09:00:00Z".into(),
            template_version: 1,
        }
    }

    #[test]
    fn publish_replaces_atomically_and_hash_matches_disk() {
        let root = tempfile::tempdir().unwrap();
        let f1 = files("one");
        let dir = publish(root.path(), &marker(&f1), &f1).unwrap();
        assert!(dir.ends_with("wsl-Ubuntu-24.04/claude-code/cloudlink-servers"));
        assert_eq!(dir_hash(&dir).unwrap().unwrap(), files_hash(&f1));
        let f2 = files("two");
        publish(root.path(), &marker(&f2), &f2).unwrap();
        assert_eq!(fs::read_to_string(dir.join("SKILL.md")).unwrap(), "two");
        assert_eq!(read_marker(&dir).unwrap().content_hash, files_hash(&f2));
        assert!(fs::read_dir(root.path().join(".staging")).unwrap().next().is_none());
        assert!(fs::read_dir(root.path().join(".trash")).unwrap().next().is_none());

        publish(root.path(), &marker(&f2), &[]).unwrap();
        assert!(!dir.exists());
    }

    #[test]
    fn never_replaces_or_removes_foreign_directories() {
        let root = tempfile::tempdir().unwrap();
        let f = files("x");
        let target = output_dir(root.path(), &EnvId::parse("wsl:Ubuntu-24.04").unwrap(), "claude-code");
        fs::create_dir_all(&target).unwrap();
        fs::write(target.join("SKILL.md"), "hand written").unwrap();
        assert!(publish(root.path(), &marker(&f), &f).is_err());
        assert!(publish(root.path(), &marker(&f), &[]).is_err());
        assert_eq!(fs::read_to_string(target.join("SKILL.md")).unwrap(), "hand written");

        fs::write(target.join(MARKER_FILE), r#"{"managedBy":"someone-else"}"#).unwrap();
        assert!(read_marker(&target).is_none());
    }

    #[test]
    fn dir_hash_detects_edits_and_extra_files() {
        let root = tempfile::tempdir().unwrap();
        let f = files("x");
        let dir = publish(root.path(), &marker(&f), &f).unwrap();
        fs::write(dir.join("references").join("extra.md"), "y").unwrap();
        assert_ne!(dir_hash(&dir).unwrap().unwrap(), files_hash(&f));
    }

    #[test]
    fn agent_dir_names() {
        assert_eq!(agent_dir_name("claude-code"), "claude-code");
        assert!(agent_dir_name("custom:Cursor").starts_with("custom-cursor-"));
        assert!(agent_dir_name("custom:Roo Code").starts_with("custom-roo-code-"));
        assert!(agent_dir_name("custom:光标").starts_with("custom-"));
        assert_eq!(agent_dir_name("../evil"), "evil");
    }

    #[test]
    fn custom_agent_directory_names_do_not_collide() {
        let names = [
            "custom:Roo Code",
            "custom:Roo-Code",
            "custom:Roo_Code",
            "custom:Cursor",
            "custom:cursor",
        ];
        let dirs: std::collections::BTreeSet<_> = names.into_iter().map(agent_dir_name).collect();
        assert_eq!(dirs.len(), names.len());
    }
}
