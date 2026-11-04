//! F-306–308: policy health and ingestion are serialized with mutations, never with the OS vault.

use std::collections::BTreeSet;

use super::Backend;
use super::requests::MergeNote;
use crate::env::EnvContext;
use crate::error::{AppError, Result};
use crate::guard;
use crate::model::Detail;
use crate::model::delivery::AgentId;
use crate::model::env::EnvId;
use crate::model::guard::{GuardDetailId, GuardState, GuardStatus, Operation, OperationQuery};
use crate::model::misc::{ActivityItem, ActivityKind, ActivityMessageId, ActivityQuery, IpcErrorId, SaveResult};
use crate::model::notes::{AgentNote, AgentNoteStatus};
use crate::paths::Paths;
use crate::{notes, operations, params};

pub(super) struct NoProcessSelfTest;

impl guard::SelfTest for NoProcessSelfTest {
    fn run(&self, _paths: &Paths, _env: &EnvContext) -> bool {
        // Isolated startup must not claim that an unexecuted binary passed its self-test.
        false
    }
}

fn validate_query(before: Option<&str>, limit: u32) -> Result<()> {
    if !(1..=1000).contains(&limit) || before.is_some_and(|b| crate::time::parse_rfc3339(b).is_none()) {
        return Err(AppError::ipc(IpcErrorId::SettingsInvalid));
    }
    Ok(())
}

impl Backend {
    pub(super) fn prepare_guard_binary(&self) -> Result<()> {
        let exe = std::env::current_exe()?;
        let source = exe.with_file_name(if cfg!(windows) {
            "cloudlink-guard.exe"
        } else {
            "cloudlink-guard"
        });
        if !source.is_file() {
            return Err(AppError::ipc(IpcErrorId::SourceMissing));
        }
        guard::sync_binary(&self.paths, &source)?;
        Ok(())
    }

    pub(super) fn import_feedback_locked(&self) -> Result<()> {
        // Both sources get a chance to make progress if the other one is unavailable.
        let operations = self.import_operations_locked();
        let notes = self.import_notes_locked();
        operations.and(notes)
    }

    fn import_operations_locked(&self) -> Result<()> {
        let now = crate::time::now_secs();
        let env_ids: Vec<_> = self.contexts(false)?.into_iter().map(|e| e.id).collect();
        let ops = {
            let db = self.database()?;
            let ops = operations::ingest(&self.paths, &db, &env_ids, now)?;
            db.prune_before(&crate::time::format_rfc3339(now - 30 * 86_400))?;
            ops
        };
        for imported in ops {
            self.emit(
                "operations://new",
                &serde_json::json!({
                    "assetId": imported.asset_id, "count": imported.count, "denied": imported.denied,
                }),
            );
            for item in imported.activity {
                self.emit("activity://new", &serde_json::json!({ "item": item }));
            }
        }
        Ok(())
    }

    fn import_notes_locked(&self) -> Result<()> {
        let notes = notes::ingest(&self.paths, &*self.database()?, crate::time::now_secs())?;
        for imported in notes {
            self.emit(
                "notes://new",
                &serde_json::json!({ "assetId": imported.asset_id, "count": imported.count }),
            );
        }
        Ok(())
    }

    pub fn refresh_feedback(&self) -> Result<()> {
        let _edit = self.edit()?;
        self.import_feedback_locked()
    }

    pub(super) fn guard_statuses_locked(&self) -> Result<Vec<GuardStatus>> {
        let targets = self.list_targets()?;
        let now = crate::time::now_secs();
        let policy_current = guard::policy_current(&self.paths, &self.list_assets()?);
        let mut statuses = Vec::new();
        for env in self.contexts(false)?.iter().filter(|e| {
            targets
                .iter()
                .any(|t| t.env_id == e.id && t.agent == AgentId::ClaudeCode)
        }) {
            let denied = operations::denied_today(&*self.database()?, &env.id, now)?;
            let mut status = guard::status(&self.paths, env, denied, self.guard_test.as_ref());
            if status.state == GuardState::Active && !policy_current {
                status.state = GuardState::Broken;
                status.detail = Some(Detail::new(GuardDetailId::SelfTestFailed));
            }
            statuses.push(status);
        }
        Ok(statuses)
    }

    pub(super) fn emit_guard_status(&self) -> Result<()> {
        let statuses = self.guard_statuses_locked()?;
        self.emit("guard://changed", &serde_json::json!({ "statuses": statuses }));
        Ok(())
    }

    pub fn get_guard_status(&self) -> Result<Vec<GuardStatus>> {
        let _edit = self.edit()?;
        self.import_operations_locked()?;
        self.guard_statuses_locked()
    }

    pub fn install_guard(&self, env_id: &EnvId) -> Result<GuardStatus> {
        let _edit = self.edit()?;
        if !self
            .list_targets()?
            .iter()
            .any(|t| &t.env_id == env_id && t.agent == AgentId::ClaudeCode)
        {
            return Err(AppError::ipc(IpcErrorId::NotFound));
        }
        let env = self.context(env_id)?;
        if !self.paths.isolated && !cfg!(test) {
            self.prepare_guard_binary()?;
        }
        guard::write_policy(&self.paths, &self.list_assets()?)?;
        let denied = operations::denied_today(&*self.database()?, env_id, crate::time::now_secs())?;
        let status = guard::install(&self.paths, &env, denied, self.guard_test.as_ref())?;
        self.activity(
            ActivityKind::Guard,
            ActivityMessageId::GuardInstalled,
            None,
            params! {"env" => env_id.as_str()},
            true,
        )?;
        self.emit_guard_status()?;
        Ok(status)
    }

    pub fn remove_guard(&self, env_id: &EnvId) -> Result<GuardStatus> {
        let _edit = self.edit()?;
        let env = self.context(env_id)?;
        let denied = operations::denied_today(&*self.database()?, env_id, crate::time::now_secs())?;
        let status = guard::remove(&self.paths, &env, denied, self.guard_test.as_ref())?;
        self.activity(
            ActivityKind::Guard,
            ActivityMessageId::GuardRemoved,
            None,
            params! {"env" => env_id.as_str()},
            true,
        )?;
        self.emit_guard_status()?;
        Ok(status)
    }

    pub fn list_operations(&self, q: OperationQuery) -> Result<Vec<Operation>> {
        validate_query(q.before.as_deref(), q.limit)?;
        let _edit = self.edit()?;
        self.import_operations_locked()?;
        self.database()?.list_operations(&q)
    }

    pub fn list_activity(&self, q: ActivityQuery) -> Result<Vec<ActivityItem>> {
        validate_query(q.before.as_deref(), q.limit)?;
        let _edit = self.edit()?;
        self.import_operations_locked()?;
        self.database()?.list_activity(&q)
    }

    pub fn list_notes(&self, asset_id: Option<&str>) -> Result<Vec<AgentNote>> {
        let _edit = self.edit()?;
        self.import_notes_locked()?;
        self.database()?.list_notes(asset_id, Some(AgentNoteStatus::Pending))
    }

    pub fn merge_notes(&self, items: Vec<MergeNote>) -> Result<SaveResult> {
        let _edit = self.edit()?;
        let items: Vec<_> = items.into_iter().map(|i| (i.id, i.text)).collect();
        // SaveResult contains one resource. The UI's "merge all" is scoped to its resource.
        let pending = self.database()?.list_notes(None, Some(AgentNoteStatus::Pending))?;
        let assets: BTreeSet<_> = pending
            .iter()
            .filter(|n| items.iter().any(|i| i.0 == n.id))
            .map(|n| n.asset_id.as_str())
            .collect();
        if assets.len() != 1 {
            return Err(AppError::ipc(IpcErrorId::SettingsInvalid));
        }
        let updated = notes::merge(&*self.database()?, &items, crate::time::now_secs())?;
        let asset = updated
            .into_iter()
            .next()
            .ok_or_else(|| AppError::ipc(IpcErrorId::NotFound))?;
        self.activity(
            ActivityKind::Note,
            ActivityMessageId::NotesMerged,
            Some(asset.id()),
            params! {"alias" => asset.handle(), "count" => items.len()},
            true,
        )?;
        let statuses = self.publish_locked()?;
        self.emit("notes://new", &serde_json::json!({ "assetId": asset.id(), "count": 0 }));
        Ok(SaveResult { asset, statuses })
    }

    pub fn dismiss_notes(&self, ids: &[String]) -> Result<()> {
        let _edit = self.edit()?;
        let dismissed = notes::dismiss(&*self.database()?, ids)?;
        for changed in dismissed {
            let asset = self.database()?.require_asset(&changed.asset_id)?;
            self.activity(
                ActivityKind::Note,
                ActivityMessageId::NotesDismissed,
                Some(asset.id()),
                params! {"alias" => asset.handle(), "count" => changed.count},
                true,
            )?;
            self.emit("notes://new", &serde_json::json!({ "assetId": asset.id(), "count": 0 }));
        }
        Ok(())
    }
}
