//! Local inbox/log receipts. A consumed byte offset commits together with the imported row,
//! so a crash between SQLite commit and file removal cannot duplicate notes or operations.

use rusqlite::{OptionalExtension, params};

use super::Db;
use crate::error::{AppError, Result};
use crate::model::asset::Asset;
use crate::model::env::EnvId;
use crate::model::guard::{Operation, OperationDecision};
use crate::model::misc::{ActivityItem, IpcErrorId};
use crate::model::notes::{AgentNote, AgentNoteStatus};

const MAX_CLAIM_OFFSET: i64 = 32 * 1024 * 1024;

pub(super) const MIGRATION: &str = r#"
CREATE TABLE ingest_claims (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('note', 'operation')),
    file_name TEXT NOT NULL UNIQUE,
    source_name TEXT NOT NULL,
    asset_id TEXT,
    byte_offset INTEGER NOT NULL DEFAULT 0 CHECK (byte_offset >= 0),
    private_key INTEGER NOT NULL DEFAULT 0,
    at TEXT NOT NULL
);
CREATE INDEX notes_asset_status ON notes(asset_id, status);
CREATE INDEX operations_asset_at ON operations(asset_id, at);
CREATE TABLE password_staging (key TEXT PRIMARY KEY);
"#;

#[derive(Debug, Clone)]
pub struct IngestClaim {
    pub id: String,
    pub kind: String,
    pub file_name: String,
    pub source_name: String,
    pub asset_id: Option<String>,
    pub byte_offset: u64,
    pub private_key: bool,
    pub at: String,
}

impl Db {
    pub fn create_ingest_claim(&self, claim: &IngestClaim) -> Result<()> {
        self.conn.execute(
            "INSERT INTO ingest_claims(id,kind,file_name,source_name,asset_id,at) VALUES (?1,?2,?3,?4,?5,?6)",
            params![
                claim.id,
                claim.kind,
                claim.file_name,
                claim.source_name,
                claim.asset_id,
                claim.at
            ],
        )?;
        Ok(())
    }

    pub fn ingest_claims(&self, kind: &str) -> Result<Vec<IngestClaim>> {
        let mut stmt = self.conn.prepare(
            "SELECT id,kind,file_name,source_name,asset_id,byte_offset,private_key,at FROM ingest_claims WHERE kind=?1 ORDER BY rowid",
        )?;
        Ok(stmt
            .query_map([kind], |r| {
                let offset: i64 = r.get(5)?;
                if !(0..=MAX_CLAIM_OFFSET).contains(&offset) {
                    return Err(rusqlite::Error::IntegralValueOutOfRange(5, offset));
                }
                Ok(IngestClaim {
                    id: r.get(0)?,
                    kind: r.get(1)?,
                    file_name: r.get(2)?,
                    source_name: r.get(3)?,
                    asset_id: r.get(4)?,
                    byte_offset: offset as u64,
                    private_key: r.get(6)?,
                    at: r.get(7)?,
                })
            })?
            .collect::<std::result::Result<_, _>>()?)
    }

    pub fn finish_ingest_claim(&self, id: &str) -> Result<()> {
        self.conn.execute("DELETE FROM ingest_claims WHERE id=?1", [id])?;
        Ok(())
    }

    fn advance_ingest_claim(&self, claim: &IngestClaim, end: u64, private_key: bool) -> Result<()> {
        let start = i64::try_from(claim.byte_offset).map_err(|_| AppError::ipc(IpcErrorId::SettingsInvalid))?;
        let end = i64::try_from(end).map_err(|_| AppError::ipc(IpcErrorId::SettingsInvalid))?;
        if end <= start || end > MAX_CLAIM_OFFSET || start > MAX_CLAIM_OFFSET {
            return Err(AppError::ipc(IpcErrorId::SettingsInvalid));
        }
        let n = self.conn.execute(
            "UPDATE ingest_claims SET byte_offset=?1,private_key=?2 WHERE id=?3 AND byte_offset=?4",
            params![end, private_key, claim.id, start],
        )?;
        if n != 1 {
            return Err(AppError::ipc(IpcErrorId::NotFound));
        }
        Ok(())
    }

    /// False means the resource already has 100 pending notes; the input remains unconsumed.
    pub fn import_note_line(
        &self,
        claim: &IngestClaim,
        end: u64,
        note: Option<&AgentNote>,
        private_key: bool,
    ) -> Result<bool> {
        if claim.kind != "note" || note.is_some_and(|n| claim.asset_id.as_deref() != Some(n.asset_id.as_str())) {
            return Err(AppError::ipc(IpcErrorId::SettingsInvalid));
        }
        let tx = self.conn.unchecked_transaction()?;
        if let Some(note) = note {
            self.require_asset(&note.asset_id)?;
            let pending: u32 = self.conn.query_row(
                "SELECT count(*) FROM notes WHERE asset_id=?1 AND status='pending'",
                [&note.asset_id],
                |r| r.get(0),
            )?;
            if pending >= 100 {
                return Ok(false);
            }
            self.upsert_note(note)?;
        }
        self.advance_ingest_claim(claim, end, private_key)?;
        tx.commit()?;
        Ok(true)
    }

    /// Operation and matching activity row become durable in the same transaction as the cursor.
    pub fn import_operation_line(
        &self,
        claim: &IngestClaim,
        end: u64,
        record: Option<(&Operation, &ActivityItem)>,
    ) -> Result<bool> {
        if claim.kind != "operation" {
            return Err(AppError::ipc(IpcErrorId::SettingsInvalid));
        }
        let tx = self.conn.unchecked_transaction()?;
        let mut inserted = false;
        if let Some((op, activity)) = record {
            self.require_asset(&op.asset_id)?;
            inserted = self.add_operation(op)?;
            if inserted {
                self.add_activity(activity)?;
            }
        }
        self.advance_ingest_claim(claim, end, false)?;
        tx.commit()?;
        Ok(inserted)
    }

    pub fn get_note(&self, id: &str) -> Result<Option<AgentNote>> {
        let json: Option<String> = self
            .conn
            .query_row("SELECT json FROM notes WHERE id=?1", [id], |r| r.get(0))
            .optional()?;
        json.map(|j| super::from_json(&j)).transpose()
    }

    /// Caller supplies a validated before/after pair; compare again inside the transaction.
    pub fn commit_notes_merge(&self, before: &Asset, after: &Asset, notes: &[AgentNote]) -> Result<()> {
        let tx = self.conn.unchecked_transaction()?;
        if before.id() != after.id() || self.require_asset(before.id())? != *before {
            return Err(AppError::ipc(IpcErrorId::NotFound));
        }
        for note in notes {
            let old = self
                .get_note(&note.id)?
                .ok_or_else(|| AppError::ipc(IpcErrorId::NotFound))?;
            if old.status != AgentNoteStatus::Pending
                || old.asset_id != before.id()
                || note.asset_id != before.id()
                || note.status != AgentNoteStatus::Merged
            {
                return Err(AppError::ipc(IpcErrorId::NotFound));
            }
            self.upsert_note(note)?;
        }
        self.upsert_asset(after)?;
        tx.commit()?;
        Ok(())
    }

    pub fn commit_notes_dismiss(&self, ids: &[String]) -> Result<Vec<AgentNote>> {
        let tx = self.conn.unchecked_transaction()?;
        let mut changed = Vec::new();
        for id in ids {
            let mut note = self.get_note(id)?.ok_or_else(|| AppError::ipc(IpcErrorId::NotFound))?;
            if note.status != AgentNoteStatus::Pending {
                return Err(AppError::ipc(IpcErrorId::NotFound));
            }
            note.status = AgentNoteStatus::Dismissed;
            self.upsert_note(&note)?;
            changed.push(note);
        }
        tx.commit()?;
        Ok(changed)
    }

    pub fn denied_operations_between(&self, env_id: &EnvId, start: &str, end: &str) -> Result<u32> {
        let decision = serde_json::to_value(OperationDecision::Denied)?;
        Ok(self.conn.query_row(
            "SELECT count(*) FROM operations WHERE at>=?1 AND at<?2 AND json_extract(json,'$.envId')=?3 AND json_extract(json,'$.decision')=?4",
            params![start, end, env_id.as_str(), decision.as_str()],
            |r| r.get(0),
        )?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::misc::{ActivityKind, ActivityMessageId};

    fn claim(kind: &str) -> IngestClaim {
        let id = ulid::Ulid::generate().to_string();
        IngestClaim {
            file_name: format!(".cloudlink-note-{id}.md"),
            id,
            kind: kind.into(),
            source_name: "hk-edge.md".into(),
            asset_id: Some(crate::testkit::hk_edge().id),
            byte_offset: 0,
            private_key: false,
            at: crate::testkit::NOW.into(),
        }
    }

    fn note() -> AgentNote {
        AgentNote {
            id: "note_atomic".into(),
            asset_id: crate::testkit::hk_edge().id,
            text: "durable deployment detail".into(),
            written_at: crate::testkit::NOW.into(),
            flags: vec![],
            status: AgentNoteStatus::Pending,
        }
    }

    #[test]
    fn failed_note_insert_keeps_the_claim_cursor_unconsumed() {
        let db = Db::open_in_memory().unwrap();
        db.upsert_asset(&Asset::Vps(crate::testkit::hk_edge())).unwrap();
        let claim = claim("note");
        db.create_ingest_claim(&claim).unwrap();
        db.conn
            .execute_batch(
                "CREATE TRIGGER fail_note BEFORE INSERT ON notes BEGIN SELECT RAISE(ABORT,'test-note-failure'); END;",
            )
            .unwrap();
        assert!(db.import_note_line(&claim, 30, Some(&note()), false).is_err());
        assert_eq!(db.ingest_claims("note").unwrap()[0].byte_offset, 0);
        assert!(db.get_note("note_atomic").unwrap().is_none());
    }

    #[test]
    fn failed_activity_insert_rolls_back_operation_and_cursor() {
        let db = Db::open_in_memory().unwrap();
        let asset = Asset::Vps(crate::testkit::hk_edge());
        db.upsert_asset(&asset).unwrap();
        let claim = claim("operation");
        db.create_ingest_claim(&claim).unwrap();
        let op = Operation {
            id: "op_atomic".into(),
            asset_id: asset.id().into(),
            env_id: EnvId::windows(),
            at: crate::testkit::NOW.into(),
            session_id: "session".into(),
            cwd: "D:/test".into(),
            command: "ssh hk-edge uptime".into(),
            decision: OperationDecision::Allowed,
            reason_id: None,
        };
        let item = ActivityItem {
            id: "act_op_atomic".into(),
            kind: ActivityKind::AgentOp,
            at: op.at.clone(),
            asset_id: Some(op.asset_id.clone()),
            message_id: ActivityMessageId::AgentOpAllowed,
            params: None,
            duration_ms: None,
            detail: None,
            ok: true,
        };
        db.conn.execute_batch("CREATE TRIGGER fail_activity BEFORE INSERT ON activity BEGIN SELECT RAISE(ABORT,'test-activity-failure'); END;").unwrap();
        assert!(db.import_operation_line(&claim, 100, Some((&op, &item))).is_err());
        assert_eq!(db.ingest_claims("operation").unwrap()[0].byte_offset, 0);
        assert!(
            db.list_operations(&crate::model::guard::OperationQuery {
                asset_id: None,
                before: None,
                limit: 10
            })
            .unwrap()
            .is_empty()
        );
    }

    #[test]
    fn failed_resource_update_rolls_back_merged_note_status() {
        let db = Db::open_in_memory().unwrap();
        let before = Asset::Vps(crate::testkit::hk_edge());
        db.upsert_asset(&before).unwrap();
        let pending = note();
        db.upsert_note(&pending).unwrap();
        let mut merged = pending.clone();
        merged.status = AgentNoteStatus::Merged;
        let mut after = before.clone();
        if let Asset::Vps(server) = &mut after {
            server.notes.push_str("\n- a note");
        }
        db.conn.execute_batch("CREATE TRIGGER fail_asset BEFORE UPDATE ON assets BEGIN SELECT RAISE(ABORT,'test-asset-failure'); END;").unwrap();
        assert!(db.commit_notes_merge(&before, &after, &[merged]).is_err());
        assert_eq!(db.get_note(&pending.id).unwrap(), Some(pending));
        assert_eq!(db.require_asset(before.id()).unwrap(), before);
    }
}
