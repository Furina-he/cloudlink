//! SQLite 数据库（PRD 8.1 db、3.5）：WAL 模式，`schema_version` 加顺序迁移。
//! 资源、目标等结构以 JSON 存在 `json` 列里（类型的唯一来源是 Rust 结构体），
//! 需要查询或约束的字段（别名唯一、按资源筛选、按时间分页）单独成列。密码不进数据库。

use std::path::Path;

mod p4b;
mod p4c;

pub use p4c::IngestClaim;
mod reset;

use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;
use serde::de::DeserializeOwned;

use crate::error::{AppError, Result};
use crate::model::asset::Asset;
use crate::model::compile::{CompileStatus, SkillConfig};
use crate::model::delivery::{Delivery, Inclusion, Target};
use crate::model::guard::{Operation, OperationQuery};
use crate::model::misc::{ActivityItem, ActivityQuery, IpcErrorId, Settings};
use crate::model::notes::{AgentNote, AgentNoteStatus};
use crate::params as p;

/// 每一项是从上一版升到这一版的 SQL；只追加，不修改已发布的迁移
const MIGRATIONS: &[&str] = &[
    // v1
    r#"
    CREATE TABLE assets (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        handle TEXT NOT NULL,
        created_at TEXT NOT NULL,
        json TEXT NOT NULL
    );
    CREATE UNIQUE INDEX assets_handle ON assets (lower(handle));
    CREATE TABLE targets (
        id TEXT PRIMARY KEY,
        env_id TEXT NOT NULL,
        agent_key TEXT NOT NULL,
        json TEXT NOT NULL
    );
    CREATE TABLE deliveries (
        id TEXT PRIMARY KEY,
        target_id TEXT NOT NULL UNIQUE REFERENCES targets (id) ON DELETE CASCADE,
        json TEXT NOT NULL
    );
    CREATE TABLE inclusions (
        asset_id TEXT NOT NULL REFERENCES assets (id) ON DELETE CASCADE,
        env_id TEXT NOT NULL,
        agent_key TEXT NOT NULL,
        json TEXT NOT NULL,
        PRIMARY KEY (asset_id, env_id, agent_key)
    );
    CREATE TABLE activity (
        id TEXT PRIMARY KEY,
        at TEXT NOT NULL,
        kind TEXT NOT NULL,
        asset_id TEXT,
        json TEXT NOT NULL
    );
    CREATE INDEX activity_at ON activity (at);
    CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        json TEXT NOT NULL
    );
    CREATE TABLE probe_snapshots (
        run_id TEXT PRIMARY KEY,
        asset_id TEXT NOT NULL REFERENCES assets (id) ON DELETE CASCADE,
        at TEXT NOT NULL,
        json TEXT NOT NULL
    );
    CREATE TABLE operations (
        id TEXT PRIMARY KEY,
        asset_id TEXT NOT NULL,
        at TEXT NOT NULL,
        json TEXT NOT NULL
    );
    CREATE INDEX operations_at ON operations (at);
    CREATE TABLE notes (
        id TEXT PRIMARY KEY,
        asset_id TEXT NOT NULL,
        status TEXT NOT NULL,
        json TEXT NOT NULL
    );
    "#,
    // v2: durable probe results, credential revisions and generated-key ownership receipts.
    p4b::MIGRATION,
    // v3: recoverable inbox/log claims and bounded note ingestion.
    p4c::MIGRATION,
    // v4: F-406 update checks default to on for settings saved before they existed.
    r#"
    UPDATE settings SET json = json_set(json, '$.autoCheckUpdates', json('true'))
    WHERE key = 'settings' AND json_type(json, '$.autoCheckUpdates') IS NULL;
    "#,
    // v5: F-109 envTag (prod/staging/dev) becomes the boolean production switch.
    r#"
    UPDATE assets SET json = json_remove(json_set(json, '$.production',
        json(CASE WHEN json_extract(json, '$.envTag') = 'prod' THEN 'true' ELSE 'false' END)), '$.envTag')
    WHERE json_type(json, '$.envTag') IS NOT NULL;
    "#,
];

pub const SCHEMA_VERSION: u32 = MIGRATIONS.len() as u32;

const KEY_SETTINGS: &str = "settings";
const KEY_SKILL_CONFIG: &str = "skill_config";
const KEY_COMPILE_STATUS: &str = "compile_status";

pub struct Db {
    conn: Connection,
}

fn to_json<T: Serialize>(v: &T) -> Result<String> {
    Ok(serde_json::to_string(v)?)
}

fn from_json<T: DeserializeOwned>(s: &str) -> Result<T> {
    Ok(serde_json::from_str(s)?)
}

fn is_unique_violation(e: &rusqlite::Error) -> bool {
    matches!(
        e,
        rusqlite::Error::SqliteFailure(f, _) if f.extended_code == rusqlite::ffi::SQLITE_CONSTRAINT_UNIQUE
            || f.extended_code == rusqlite::ffi::SQLITE_CONSTRAINT_PRIMARYKEY
    )
}

impl Db {
    pub fn open(path: &Path) -> Result<Self> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let conn = Connection::open(path)?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        Self::init(conn)
    }

    pub fn open_in_memory() -> Result<Self> {
        Self::init(Connection::open_in_memory()?)
    }

    fn init(conn: Connection) -> Result<Self> {
        conn.pragma_update(None, "foreign_keys", true)?;
        conn.busy_timeout(std::time::Duration::from_secs(5))?;
        let mut db = Db { conn };
        db.migrate()?;
        Ok(db)
    }

    pub fn schema_version(&self) -> Result<u32> {
        Ok(self
            .conn
            .query_row("SELECT version FROM schema_version", [], |r| r.get(0))?)
    }

    pub fn journal_mode(&self) -> Result<String> {
        Ok(self.conn.query_row("PRAGMA journal_mode", [], |r| r.get(0))?)
    }

    fn migrate(&mut self) -> Result<()> {
        self.conn
            .execute_batch("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)")?;
        let current: Option<u32> = self
            .conn
            .query_row("SELECT version FROM schema_version", [], |r| r.get(0))
            .optional()?;
        let current = current.unwrap_or(0);
        if current > SCHEMA_VERSION {
            return Err(AppError::internal(format!(
                "database schema {current} is newer than this CloudLink ({SCHEMA_VERSION})"
            )));
        }
        let tx = self.conn.transaction()?;
        for (i, sql) in MIGRATIONS.iter().enumerate().skip(current as usize) {
            tx.execute_batch(sql)?;
            log::info!("database migrated to schema {}", i + 1);
        }
        tx.execute("DELETE FROM schema_version", [])?;
        tx.execute("INSERT INTO schema_version (version) VALUES (?1)", [SCHEMA_VERSION])?;
        tx.commit()?;
        Ok(())
    }

    // ---- 资源 ----

    pub fn list_assets(&self) -> Result<Vec<Asset>> {
        let mut stmt = self.conn.prepare("SELECT json FROM assets ORDER BY created_at, id")?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
        rows.map(|r| from_json(&r?)).collect()
    }

    pub fn get_asset(&self, id: &str) -> Result<Option<Asset>> {
        let json: Option<String> = self
            .conn
            .query_row("SELECT json FROM assets WHERE id = ?1", [id], |r| r.get(0))
            .optional()?;
        json.map(|j| from_json(&j)).transpose()
    }

    pub fn require_asset(&self, id: &str) -> Result<Asset> {
        self.get_asset(id)?
            .ok_or_else(|| AppError::ipc_with(IpcErrorId::NotFound, p! {"id" => id}))
    }

    /// 新建或更新。别名（服务器）与标识（云平台）在全部资源中唯一，不区分大小写（F-101 AC1）
    pub fn upsert_asset(&self, asset: &Asset) -> Result<()> {
        let kind = serde_json::to_value(asset.kind())?;
        let res = self.conn.execute(
            "INSERT INTO assets (id, type, handle, created_at, json) VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT (id) DO UPDATE SET type = excluded.type, handle = excluded.handle, json = excluded.json",
            params![
                asset.id(),
                kind.as_str(),
                asset.handle(),
                asset.created_at(),
                to_json(asset)?
            ],
        );
        match res {
            Ok(_) => Ok(()),
            Err(e) if is_unique_violation(&e) => Err(AppError::ipc_with(
                IpcErrorId::AliasTaken,
                p! {"alias" => asset.handle()},
            )),
            Err(e) => Err(e.into()),
        }
    }

    /// 别名是否已被别的资源占用（不区分大小写）
    pub fn handle_taken(&self, handle: &str, except_id: Option<&str>) -> Result<bool> {
        let n: i64 = self.conn.query_row(
            "SELECT count(*) FROM assets WHERE lower(handle) = lower(?1) AND id != ?2",
            params![handle, except_id.unwrap_or("")],
            |r| r.get(0),
        )?;
        Ok(n > 0)
    }

    pub fn delete_asset(&self, id: &str) -> Result<bool> {
        Ok(self.conn.execute("DELETE FROM assets WHERE id = ?1", [id])? > 0)
    }

    // ---- 目标与分发 ----

    pub fn list_targets(&self) -> Result<Vec<Target>> {
        let mut stmt = self.conn.prepare("SELECT json FROM targets ORDER BY rowid")?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
        rows.map(|r| from_json(&r?)).collect()
    }

    pub fn upsert_target(&self, t: &Target) -> Result<()> {
        self.conn.execute(
            "INSERT INTO targets (id, env_id, agent_key, json) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT (id) DO UPDATE SET env_id = excluded.env_id, agent_key = excluded.agent_key, json = excluded.json",
            params![t.id, t.env_id.as_str(), t.agent_key, to_json(t)?],
        )?;
        Ok(())
    }

    pub fn delete_target(&self, id: &str) -> Result<bool> {
        Ok(self.conn.execute("DELETE FROM targets WHERE id = ?1", [id])? > 0)
    }

    pub fn list_deliveries(&self) -> Result<Vec<Delivery>> {
        let mut stmt = self.conn.prepare("SELECT json FROM deliveries ORDER BY rowid")?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
        rows.map(|r| from_json(&r?)).collect()
    }

    pub fn upsert_delivery(&self, d: &Delivery) -> Result<()> {
        self.conn.execute(
            "INSERT INTO deliveries (id, target_id, json) VALUES (?1, ?2, ?3)
             ON CONFLICT (id) DO UPDATE SET target_id = excluded.target_id, json = excluded.json",
            params![d.id, d.target_id, to_json(d)?],
        )?;
        Ok(())
    }

    pub fn delete_delivery(&self, id: &str) -> Result<bool> {
        Ok(self.conn.execute("DELETE FROM deliveries WHERE id = ?1", [id])? > 0)
    }

    pub fn list_inclusions(&self) -> Result<Vec<Inclusion>> {
        let mut stmt = self
            .conn
            .prepare("SELECT json FROM inclusions ORDER BY asset_id, env_id, agent_key")?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
        rows.map(|r| from_json(&r?)).collect()
    }

    /// 列入情况整表替换（每次都是全量重算的结果）
    pub fn replace_inclusions(&mut self, items: &[Inclusion]) -> Result<()> {
        let tx = self.conn.transaction()?;
        tx.execute("DELETE FROM inclusions", [])?;
        for i in items {
            tx.execute(
                "INSERT INTO inclusions (asset_id, env_id, agent_key, json) VALUES (?1, ?2, ?3, ?4)",
                params![i.asset_id, i.env_id.as_str(), i.agent_key, to_json(i)?],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    // ---- 设置与全局内容 ----

    fn get_kv<T: DeserializeOwned>(&self, key: &str) -> Result<Option<T>> {
        let json: Option<String> = self
            .conn
            .query_row("SELECT json FROM settings WHERE key = ?1", [key], |r| r.get(0))
            .optional()?;
        json.map(|j| from_json(&j)).transpose()
    }

    fn put_kv<T: Serialize>(&self, key: &str, v: &T) -> Result<()> {
        self.conn.execute(
            "INSERT INTO settings (key, json) VALUES (?1, ?2) ON CONFLICT (key) DO UPDATE SET json = excluded.json",
            params![key, to_json(v)?],
        )?;
        Ok(())
    }

    pub fn get_settings(&self) -> Result<Option<Settings>> {
        self.get_kv(KEY_SETTINGS)
    }
    pub fn put_settings(&self, s: &Settings) -> Result<()> {
        self.put_kv(KEY_SETTINGS, s)
    }
    pub fn get_skill_config(&self) -> Result<SkillConfig> {
        Ok(self
            .get_kv::<SkillConfig>(KEY_SKILL_CONFIG)?
            .unwrap_or_default()
            .migrated())
    }
    pub fn put_skill_config(&self, c: &SkillConfig) -> Result<()> {
        self.put_kv(KEY_SKILL_CONFIG, c)
    }
    pub fn get_compile_statuses(&self) -> Result<Vec<CompileStatus>> {
        Ok(self.get_kv(KEY_COMPILE_STATUS)?.unwrap_or_default())
    }
    pub fn put_compile_statuses(&self, s: &[CompileStatus]) -> Result<()> {
        self.put_kv(KEY_COMPILE_STATUS, &s)
    }

    // ---- 活动日志（F-402），保留 30 天 ----

    pub fn add_activity(&self, item: &ActivityItem) -> Result<()> {
        let kind = serde_json::to_value(item.kind)?;
        self.conn.execute(
            "INSERT INTO activity (id, at, kind, asset_id, json) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![item.id, item.at, kind.as_str(), item.asset_id, to_json(item)?],
        )?;
        Ok(())
    }

    pub fn list_activity(&self, q: &ActivityQuery) -> Result<Vec<ActivityItem>> {
        let kinds: Vec<String> = match &q.kinds {
            Some(k) => k
                .iter()
                .map(|k| serde_json::to_value(k).map(|v| v.as_str().unwrap_or("").to_string()))
                .collect::<std::result::Result<_, _>>()?,
            None => Vec::new(),
        };
        let mut stmt = self.conn.prepare(
            "SELECT json, kind FROM activity
             WHERE (?1 IS NULL OR at < ?1) AND (?2 IS NULL OR asset_id = ?2)
             ORDER BY at DESC, id DESC",
        )?;
        let rows = stmt.query_map(params![q.before, q.asset_id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })?;
        let mut out = Vec::new();
        for row in rows {
            let (json, kind) = row?;
            if !kinds.is_empty() && !kinds.contains(&kind) {
                continue;
            }
            out.push(from_json(&json)?);
            if out.len() >= q.limit as usize {
                break;
            }
        }
        Ok(out)
    }

    /// 删除早于 `cutoff`（RFC 3339）的活动和操作记录
    pub fn prune_before(&self, cutoff: &str) -> Result<usize> {
        let a = self.conn.execute("DELETE FROM activity WHERE at < ?1", [cutoff])?;
        let o = self.conn.execute("DELETE FROM operations WHERE at < ?1", [cutoff])?;
        Ok(a + o)
    }

    // ---- 探测快照（F-103 AC4：只能撤销最近一次）----

    pub fn put_probe_snapshot(&self, run_id: &str, asset_id: &str, at: &str, snapshot: &Asset) -> Result<()> {
        self.conn
            .execute("DELETE FROM probe_snapshots WHERE asset_id = ?1", [asset_id])?;
        self.conn.execute(
            "INSERT INTO probe_snapshots (run_id, asset_id, at, json) VALUES (?1, ?2, ?3, ?4)",
            params![run_id, asset_id, at, to_json(snapshot)?],
        )?;
        Ok(())
    }

    pub fn take_probe_snapshot(&self, run_id: &str) -> Result<Option<Asset>> {
        let json: Option<String> = self
            .conn
            .query_row("SELECT json FROM probe_snapshots WHERE run_id = ?1", [run_id], |r| {
                r.get(0)
            })
            .optional()?;
        self.conn
            .execute("DELETE FROM probe_snapshots WHERE run_id = ?1", [run_id])?;
        json.map(|j| from_json(&j)).transpose()
    }

    // ---- 操作记录（F-307）与笔记（F-308）----

    pub fn add_operation(&self, op: &Operation) -> Result<bool> {
        Ok(self.conn.execute(
            "INSERT OR IGNORE INTO operations (id, asset_id, at, json) VALUES (?1, ?2, ?3, ?4)",
            params![op.id, op.asset_id, op.at, to_json(op)?],
        )? > 0)
    }

    pub fn list_operations(&self, q: &OperationQuery) -> Result<Vec<Operation>> {
        let mut stmt = self.conn.prepare(
            "SELECT json FROM operations
             WHERE (?1 IS NULL OR at < ?1) AND (?2 IS NULL OR asset_id = ?2)
             ORDER BY at DESC, id DESC LIMIT ?3",
        )?;
        let rows = stmt.query_map(params![q.before, q.asset_id, q.limit], |r| r.get::<_, String>(0))?;
        rows.map(|r| from_json(&r?)).collect()
    }

    pub fn upsert_note(&self, n: &AgentNote) -> Result<()> {
        let status = serde_json::to_value(n.status)?;
        self.conn.execute(
            "INSERT INTO notes (id, asset_id, status, json) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT (id) DO UPDATE SET status = excluded.status, json = excluded.json",
            params![n.id, n.asset_id, status.as_str(), to_json(n)?],
        )?;
        Ok(())
    }

    pub fn list_notes(&self, asset_id: Option<&str>, status: Option<AgentNoteStatus>) -> Result<Vec<AgentNote>> {
        let status = status.map(serde_json::to_value).transpose()?;
        let mut stmt = self.conn.prepare(
            "SELECT json FROM notes WHERE (?1 IS NULL OR asset_id = ?1) AND (?2 IS NULL OR status = ?2) ORDER BY rowid",
        )?;
        let rows = stmt.query_map(params![asset_id, status.as_ref().and_then(|s| s.as_str())], |r| {
            r.get::<_, String>(0)
        })?;
        rows.map(|r| from_json(&r?)).collect()
    }
}

#[cfg(test)]
mod tests;
