//! F-403 reset: preflight every external path, keep a durable intent, and clean vault entries outside locks.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;

use super::Backend;
use super::backend::check_ancestors;
use crate::compile::publish::{self, SKILL_DIR};
use crate::error::{AppError, Result};
use crate::model::misc::{IpcErrorId, Settings};
use crate::{deliver, fsx, guard, notes, operations, ssh};

struct ResetFlag<'a>(&'a Backend);

impl Drop for ResetFlag<'_> {
    fn drop(&mut self) {
        self.0.resetting.store(false, Ordering::SeqCst);
    }
}

fn ordinary_tree(path: &Path, depth: usize) -> Result<()> {
    if depth > 16 {
        return Err(AppError::ipc(IpcErrorId::SettingsInvalid));
    }
    check_ancestors(path)?;
    let meta = fs::symlink_metadata(path)?;
    if fsx::is_link(&meta) || (!meta.is_file() && !meta.is_dir()) {
        return Err(AppError::ipc(IpcErrorId::SettingsInvalid));
    }
    if meta.is_dir() {
        for entry in fs::read_dir(path)? {
            ordinary_tree(&entry?.path(), depth + 1)?;
        }
    }
    Ok(())
}

/// Traverse the app's compiled tree, but only plan deletion of roots with a valid Skill owner marker.
/// Unmarked files/trees survive reset; even an owned tree must have no links before it can be deleted.
fn compiled_roots(path: &Path, depth: usize, output: &mut Vec<PathBuf>) -> Result<()> {
    check_ancestors(path)?;
    let meta = match fs::symlink_metadata(path) {
        Ok(m) => m,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(e.into()),
    };
    if !meta.is_dir() {
        return Ok(());
    }
    if let Some(marker) = publish::read_marker(path) {
        if crate::model::env::EnvId::parse(&marker.env_id).is_some()
            && !marker.agent_key.is_empty()
            && marker.content_hash.len() == 64
            && marker.content_hash.bytes().all(|b| b.is_ascii_hexdigit())
        {
            ordinary_tree(path, 0)?;
            output.push(path.to_path_buf());
        }
        return Ok(());
    }
    if depth < 8 {
        for entry in fs::read_dir(path)? {
            compiled_roots(&entry?.path(), depth + 1, output)?;
        }
    }
    Ok(())
}

impl Backend {
    pub fn reset_data(&self) -> Result<()> {
        if self
            .resetting
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            return Err(AppError::ipc(IpcErrorId::ResetIncomplete));
        }
        let _reset = ResetFlag(self);
        let reset_result = (|| {
            // Deliberately bypass edit(): this is the sole operation allowed to resume reset_pending.
            let lock = self
                .mutation
                .lock()
                .map_err(|_| AppError::internal("mutation state unavailable"))?;
            self.check_data_ownership()?;
            check_ancestors(&self.paths.db_file())?;
            let envs = self.contexts(false)?;
            let targets = self.list_targets()?;
            for target in &targets {
                if !envs.iter().any(|e| e.id == target.env_id && e.available) {
                    return Err(AppError::ipc(IpcErrorId::ResetIncomplete));
                }
            }
            let plan = deliver::groups::Plan::new(&self.paths, &envs, &targets);
            if !plan.invalid.is_empty() {
                return Err(AppError::ipc(IpcErrorId::ResetIncomplete));
            }
            let mut deliveries = Vec::new();
            for unit in &plan.units {
                let env = envs
                    .iter()
                    .find(|e| e.id == unit.env_id)
                    .ok_or_else(|| AppError::ipc(IpcErrorId::ResetIncomplete))?;
                let checked = deliver::inspect_unit(&self.paths, env, unit, None)?;
                if !matches!(
                    checked.status,
                    crate::model::delivery::DeliveryStatus::Conflict | crate::model::delivery::DeliveryStatus::Missing
                ) {
                    ordinary_tree(&unit.parent.join(SKILL_DIR), 0)?;
                    deliveries.push((env, unit));
                }
                // 外来同名目录或叶子链接不是受管副本；保留它们，跨环境共用不重复删除。
            }
            let mut compiled = Vec::new();
            compiled_roots(&self.paths.compiled_dir(), 0, &mut compiled)?;
            let mut configs = Vec::new();
            for env in &envs {
                let path = env.host_in_home(&[".ssh", "cloudlink.conf"]);
                check_ancestors(&path)?;
                match fs::symlink_metadata(&path) {
                    Err(e) if e.kind() == io::ErrorKind::NotFound => {}
                    Err(e) => return Err(e.into()),
                    Ok(meta) if !meta.is_file() || fsx::is_link(&meta) => {
                        return Err(AppError::ipc(IpcErrorId::SettingsInvalid));
                    }
                    Ok(_) => {
                        let bytes = fs::read(&path)?;
                        if String::from_utf8_lossy(&bytes)
                            .trim_start_matches('\u{feff}')
                            .starts_with(ssh::managed::MANAGED_HEADER)
                        {
                            configs.push((path, bytes));
                        }
                    }
                }
            }
            guard::preflight_reset(&self.paths, &envs)?;
            {
                let db = self.database()?;
                notes::preflight_cleanup(&self.paths, &db)?;
                operations::preflight_cleanup(&self.paths, &db)?;
                db.begin_reset()?;
            }
            self.reset_epoch.fetch_add(1, Ordering::SeqCst);
            self.cancel_jobs_for_reset();
            // A vault write may be waiting for a native prompt with no state lock held.
            // Its stale commit will fail and queue cleanup. Keep the durable reset intent until it finishes.
            if self.credential_writes.load(Ordering::SeqCst) != 0 {
                return Err(AppError::ipc(IpcErrorId::ResetIncomplete));
            }
            // Remove the hook/binary first, before consuming the final guard records.
            guard::reset_managed_files(&self.paths, &envs)?;
            for (env, unit) in deliveries {
                deliver::remove_unit(&self.paths, env, unit)?;
            }
            for path in compiled {
                check_ancestors(&path)?;
                ordinary_tree(&path, 0)?;
                publish::remove_owned(&path)?;
            }
            for (path, expected) in configs {
                check_ancestors(&path)?;
                if fs::read(&path)? != expected {
                    return Err(AppError::ipc(IpcErrorId::SettingsInvalid));
                }
                fs::remove_file(path)?;
            }
            {
                let db = self.database()?;
                notes::cleanup(&self.paths, &db)?;
                operations::cleanup(&self.paths, &db)?;
                db.reset_domain()?;
            }
            self.shared_mismatches
                .lock()
                .map_err(|_| AppError::internal("sharing state unavailable"))?
                .clear();
            drop(lock);
            // An OS credential UI/service may block. Neither state nor SQLite locks may be held.
            self.cleanup_credentials()?;
            let _lock = self
                .mutation
                .lock()
                .map_err(|_| AppError::internal("mutation state unavailable"))?;
            self.database()?.finish_reset(&Settings::defaults(
                self.paths.data_dir.to_string_lossy().into_owned(),
                self.paths.log_dir().to_string_lossy().into_owned(),
            ))?;
            // 设置回到默认值，其中「自动检查更新」是开启的
            self.updates.set_enabled(true, std::time::Instant::now());
            self.emit("compile://finished", &serde_json::json!({ "statuses": [] }));
            self.emit(
                "deliveries://changed",
                &serde_json::json!({ "deliveries": [], "inclusions": [] }),
            );
            self.emit("guard://changed", &serde_json::json!({ "statuses": [] }));
            Ok(())
        })();
        match reset_result {
            Err(_) if self.database().is_ok_and(|db| db.reset_pending().unwrap_or(true)) => {
                Err(AppError::ipc(IpcErrorId::ResetIncomplete))
            }
            result => result,
        }
    }
}
