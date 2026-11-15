//! P4b metadata transactions. No filesystem or credential-store access belongs in this module.

use std::path::Path;

use rusqlite::{OptionalExtension, params};
use serde_json::Value;

use super::Db;
use crate::env::EnvContext;
use crate::error::{AppError, Result};
use crate::model::asset::{Asset, AuthMethod, ConnectionSource};
use crate::model::env::EnvId;
use crate::model::misc::IpcErrorId;
use crate::probe::MergeResult;

pub(super) const MIGRATION: &str = r#"
CREATE TABLE password_refs (
    asset_id TEXT PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,
    key TEXT NOT NULL UNIQUE,
    target TEXT NOT NULL
);
CREATE TABLE password_cleanup (key TEXT PRIMARY KEY);
CREATE TABLE generated_keys (
    asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    path TEXT NOT NULL UNIQUE,
    content_hash TEXT NOT NULL,
    env_id TEXT NOT NULL,
    native TEXT NOT NULL,
    PRIMARY KEY(asset_id, path)
);
CREATE TABLE pending_keys (
    env_id TEXT NOT NULL,
    native TEXT NOT NULL,
    host_path TEXT PRIMARY KEY,
    content_hash TEXT NOT NULL
);
CREATE UNIQUE INDEX probe_snapshots_latest_asset ON probe_snapshots(asset_id);
CREATE TABLE probe_results (
    run_id TEXT PRIMARY KEY REFERENCES probe_snapshots(run_id) ON DELETE CASCADE,
    after_json TEXT NOT NULL,
    merged_json TEXT NOT NULL
);
"#;

struct KeyReceipt {
    env_id: String,
    native: String,
    host_path: String,
    hash: String,
}

struct ProbeRecord {
    before: Asset,
    after: Asset,
    merged: Value,
}

fn target(asset: &Asset) -> Result<String> {
    let server = asset.as_server().ok_or_else(|| AppError::ipc(IpcErrorId::NotFound))?;
    Ok(serde_json::to_string(&(
        server.connection.source,
        &server.connection.host,
        server.connection.port,
        &server.connection.user,
        server.connection.auth.as_ref().map(|a| a.method),
    ))?)
}

fn same_native(env_id: &EnvId, left: &str, right: &str) -> bool {
    if env_id.is_windows() {
        crate::fsx::ssh_path(left).eq_ignore_ascii_case(&crate::fsx::ssh_path(right))
    } else {
        left == right
    }
}

fn same_host(left: &str, right: &str) -> bool {
    let left = crate::fsx::ssh_path(left);
    let right = crate::fsx::ssh_path(right);
    if left.as_bytes().get(1) == Some(&b':') && right.as_bytes().get(1) == Some(&b':') {
        left.eq_ignore_ascii_case(&right)
    } else {
        left == right
    }
}

fn validate_receipt(env_id: &str, native: &str, host_path: &str, hash: &str) -> Result<()> {
    let env = EnvId::parse(env_id).ok_or_else(|| AppError::ipc(IpcErrorId::SettingsInvalid))?;
    if !crate::ssh::validate::identity_ok(native, env.is_windows())
        || (env.wsl_distro().is_some() && native.contains(['\\', ':']))
        || host_path.len() > 4096
        || host_path.chars().any(char::is_control)
        || !(Path::new(host_path).is_absolute() || crate::ssh::validate::identity_ok(host_path, true))
        || host_path.split(['/', '\\']).any(|part| part == "..")
        || hash.len() != 64
        || !hash.bytes().all(|b| b.is_ascii_hexdigit())
    {
        return Err(AppError::ipc(IpcErrorId::SettingsInvalid));
    }
    Ok(())
}

fn clean_merge(run_id: &str, after: &Asset, merged: &Value) -> Result<MergeResult> {
    let result: MergeResult = serde_json::from_value(merged.clone())?;
    if after.as_server() != Some(&result.asset) || result.asset.probe.last_run_id.as_deref() != Some(run_id) {
        return Err(AppError::ipc(IpcErrorId::NotFound));
    }
    Ok(result)
}

fn authority_key(env_id: &EnvId, agent_key: &str) -> Result<String> {
    Ok(format!(
        "publication_authority:{}",
        serde_json::to_string(&(env_id, agent_key))?
    ))
}

impl Db {
    /// Transactions contain only SQLite operations and pure serialization/path conversion.
    fn atomic<T>(&self, work: impl FnOnce(&Self) -> Result<T>) -> Result<T> {
        let tx = self.conn.unchecked_transaction()?;
        let result = work(self)?;
        tx.commit()?;
        Ok(result)
    }

    pub fn password_target_matches(left: &Asset, right: &Asset) -> bool {
        match (target(left), target(right)) {
            (Ok(left), Ok(right)) => left == right,
            _ => false,
        }
    }

    pub fn password_ref(&self, asset_id: &str) -> Result<Option<String>> {
        let record: Option<(String, String)> = self
            .conn
            .query_row(
                "SELECT key, target FROM password_refs WHERE asset_id=?1",
                [asset_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        if let Some((key, saved_target)) = record {
            if saved_target != target(&self.require_asset(asset_id)?)? {
                return Err(AppError::ipc(IpcErrorId::PasswordTargetChanged));
            }
            Ok(Some(key))
        } else {
            Ok(None)
        }
    }

    fn pending_for_asset(&self, asset: &Asset) -> Result<Vec<KeyReceipt>> {
        let Some(server) = asset
            .as_server()
            .filter(|s| s.connection.source == ConnectionSource::Managed)
        else {
            return Ok(Vec::new());
        };
        let Some(auth) = server.connection.auth.as_ref().filter(|a| a.method == AuthMethod::Key) else {
            return Ok(Vec::new());
        };
        let mut receipts = Vec::new();
        for (env_id, native) in &auth.identity_file {
            let mut stmt = self.conn.prepare(
                "SELECT env_id,native,host_path,content_hash FROM pending_keys WHERE env_id=?1 AND native=?2 ORDER BY host_path",
            )?;
            let records = stmt.query_map(params![env_id.as_str(), native], |r| {
                Ok(KeyReceipt {
                    env_id: r.get(0)?,
                    native: r.get(1)?,
                    host_path: r.get(2)?,
                    hash: r.get(3)?,
                })
            })?;
            receipts.extend(records.collect::<std::result::Result<Vec<_>, _>>()?);
        }
        Ok(receipts)
    }

    /// Internal transaction body, so callers can commit metadata and snapshots together.
    fn write_asset_guarded(&self, asset: &Asset) -> Result<Asset> {
        let prior: Option<(String, String)> = self
            .conn
            .query_row(
                "SELECT key, target FROM password_refs WHERE asset_id=?1",
                [asset.id()],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        let password_saved = if let Some((key, saved_target)) = prior {
            if target(asset).is_ok_and(|current| current == saved_target) {
                true
            } else {
                self.conn
                    .execute("INSERT OR IGNORE INTO password_cleanup(key) VALUES (?1)", [&key])?;
                self.conn
                    .execute("DELETE FROM password_refs WHERE asset_id=?1", [asset.id()])?;
                false
            }
        } else {
            false
        };
        let receipts = self.pending_for_asset(asset)?;
        let mut stored = asset.clone();
        if let Asset::Vps(server) = &mut stored
            && let Some(auth) = &mut server.connection.auth
        {
            auth.password_saved = password_saved;
            auth.generated_by_cloud_link |= !receipts.is_empty();
        }
        self.upsert_asset(&stored)?;
        for receipt in receipts {
            self.record_generated_key_at(
                stored.id(),
                &receipt.env_id,
                &receipt.native,
                &receipt.host_path,
                &receipt.hash,
            )?;
            self.conn
                .execute("DELETE FROM pending_keys WHERE host_path=?1", [&receipt.host_path])?;
        }
        Ok(stored)
    }

    pub fn upsert_asset_guarded(&self, asset: &Asset) -> Result<()> {
        self.atomic(|db| db.write_asset_guarded(asset).map(|_| ()))
    }

    pub fn replace_password_ref(&self, asset: &Asset, key: Option<&str>) -> Result<()> {
        self.atomic(|db| db.write_password_ref(asset, key))
    }

    fn write_password_ref(&self, asset: &Asset, key: Option<&str>) -> Result<()> {
        self.require_asset(asset.id())?;
        if let Some(key) = key {
            let pending: bool = self.conn.query_row(
                "SELECT EXISTS(SELECT 1 FROM password_cleanup WHERE key=?1)",
                [key],
                |r| r.get(0),
            )?;
            if key.is_empty() || pending {
                return Err(AppError::ipc(IpcErrorId::SettingsInvalid));
            }
        }
        let prior: Option<(String, String)> = self
            .conn
            .query_row(
                "SELECT key,target FROM password_refs WHERE asset_id=?1",
                [asset.id()],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        if let Some((old, saved_target)) = prior {
            if Some(old.as_str()) == key && saved_target != target(asset)? {
                return Err(AppError::ipc(IpcErrorId::PasswordTargetChanged));
            }
            if Some(old.as_str()) != key {
                self.conn
                    .execute("INSERT OR IGNORE INTO password_cleanup(key) VALUES (?1)", [&old])?;
            }
        }
        self.conn
            .execute("DELETE FROM password_refs WHERE asset_id=?1", [asset.id()])?;
        if let Some(key) = key {
            self.conn.execute(
                "INSERT INTO password_refs(asset_id,key,target) VALUES (?1,?2,?3)",
                params![asset.id(), key, target(asset)?],
            )?;
        }
        self.write_asset_guarded(asset).map(|_| ())
    }

    /// Commit this receipt BEFORE calling the OS vault. A crash or a failed write can then be
    /// cleaned after restart even if no asset ever acquired a reference to the new revision.
    pub fn stage_password_write(&self, key: &str) -> Result<()> {
        if key.is_empty() || key.len() > 256 || key.chars().any(char::is_control) {
            return Err(AppError::ipc(IpcErrorId::SettingsInvalid));
        }
        self.atomic(|db| {
            let exists: bool = db.conn.query_row(
                "SELECT EXISTS(SELECT 1 FROM password_refs WHERE key=?1 UNION ALL SELECT 1 FROM password_cleanup WHERE key=?1 UNION ALL SELECT 1 FROM password_staging WHERE key=?1)",
                [key], |r| r.get(0),
            )?;
            if exists {
                return Err(AppError::ipc(IpcErrorId::SettingsInvalid));
            }
            db.conn.execute("INSERT INTO password_cleanup(key) VALUES (?1)", [key])?;
            db.conn.execute("INSERT INTO password_staging(key) VALUES (?1)", [key])?;
            Ok(())
        })
    }

    /// Only a freshly staged revision may leave the cleanup queue and become active. Retired
    /// revisions remain unpromotable; the old pointer and all receipts roll back on any failure.
    pub fn commit_staged_password(&self, asset: &Asset, key: &str) -> Result<()> {
        self.atomic(|db| {
            let staged: bool = db.conn.query_row(
                "SELECT EXISTS(SELECT 1 FROM password_staging s JOIN password_cleanup c ON c.key=s.key WHERE s.key=?1)",
                [key],
                |r| r.get(0),
            )?;
            if !staged {
                return Err(AppError::ipc(IpcErrorId::SettingsInvalid));
            }
            db.conn.execute("DELETE FROM password_staging WHERE key=?1", [key])?;
            db.conn.execute("DELETE FROM password_cleanup WHERE key=?1", [key])?;
            db.write_password_ref(asset, Some(key))
        })
    }

    /// A failed staged vault revision must also survive a crash until cleanup succeeds.
    pub fn queue_password_cleanup(&self, key: &str) -> Result<()> {
        let active: bool =
            self.conn
                .query_row("SELECT EXISTS(SELECT 1 FROM password_refs WHERE key=?1)", [key], |r| {
                    r.get(0)
                })?;
        if key.is_empty() || active {
            return Err(AppError::ipc(IpcErrorId::SettingsInvalid));
        }
        self.conn
            .execute("INSERT OR IGNORE INTO password_cleanup(key) VALUES (?1)", [key])?;
        Ok(())
    }

    pub fn password_cleanup(&self) -> Result<Vec<String>> {
        let mut stmt = self.conn.prepare("SELECT key FROM password_cleanup ORDER BY rowid")?;
        Ok(stmt
            .query_map([], |r| r.get(0))?
            .collect::<std::result::Result<_, _>>()?)
    }

    /// Called only after the vault deletion succeeds, with no state lock around that deletion.
    pub fn finish_password_cleanup(&self, key: &str) -> Result<()> {
        self.atomic(|db| {
            db.conn.execute("DELETE FROM password_cleanup WHERE key=?1", [key])?;
            db.conn.execute("DELETE FROM password_staging WHERE key=?1", [key])?;
            Ok(())
        })
    }

    pub fn delete_asset_with_password_cleanup(&self, id: &str) -> Result<()> {
        self.atomic(|db| {
            db.require_asset(id)?;
            db.conn.execute(
                "INSERT OR IGNORE INTO password_cleanup(key) SELECT key FROM password_refs WHERE asset_id=?1",
                [id],
            )?;
            db.conn.execute("DELETE FROM notes WHERE asset_id=?1", [id])?;
            db.delete_asset(id)?;
            Ok(())
        })
    }

    /// Only a newly created destination is recorded; a copied key's user-owned source is not.
    pub fn record_pending_key(&self, env_id: &str, native: &str, host_path: &str, hash: &str) -> Result<()> {
        validate_receipt(env_id, native, host_path, hash)?;
        self.conn.execute(
            "INSERT INTO pending_keys(env_id,native,host_path,content_hash) VALUES (?1,?2,?3,?4)",
            params![env_id, native, host_path, hash.to_ascii_lowercase()],
        )?;
        Ok(())
    }

    /// `native` identifies the private key for both its private and public file receipts.
    pub fn record_generated_key_at(
        &self,
        asset_id: &str,
        env_id: &str,
        native: &str,
        path: &str,
        hash: &str,
    ) -> Result<()> {
        validate_receipt(env_id, native, path, hash)?;
        self.conn.execute(
            "INSERT INTO generated_keys(asset_id,path,content_hash,env_id,native) VALUES (?1,?2,?3,?4,?5)
             ON CONFLICT(asset_id,path) DO UPDATE SET content_hash=excluded.content_hash,env_id=excluded.env_id,native=excluded.native",
            params![asset_id, path, hash.to_ascii_lowercase(), env_id, native],
        )?;
        Ok(())
    }

    pub fn record_generated_key(&self, asset_id: &str, path: &str, hash: &str) -> Result<()> {
        self.record_generated_key_at(
            asset_id,
            EnvId::WINDOWS,
            path.strip_suffix(".pub").unwrap_or(path),
            path,
            hash,
        )
    }

    /// Shared identity files protect both files in a private/public key pair. Contexts also
    /// recognize Windows files reached from WSL through its configured mount prefix.
    pub fn key_in_use(&self, owner_id: &str, path: &str, envs: &[EnvContext]) -> Result<bool> {
        let receipt: Option<(String, String)> = self
            .conn
            .query_row(
                "SELECT env_id,native FROM generated_keys WHERE asset_id=?1 AND path=?2",
                params![owner_id, path],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        let Some((receipt_env, native)) = receipt else {
            return Ok(false);
        };
        let receipt_env = EnvId::parse(&receipt_env).ok_or_else(|| AppError::ipc(IpcErrorId::SettingsInvalid))?;
        let private_host = if receipt_env.is_windows() {
            native.clone()
        } else if let Some(env) = envs.iter().find(|e| e.id == receipt_env) {
            env.to_host(&native).to_string_lossy().into_owned()
        } else {
            let filename = native.rsplit(['/', '\\']).next().unwrap_or("");
            if path.rsplit(['/', '\\']).next() == Some(format!("{filename}.pub").as_str()) {
                path.strip_suffix(".pub").unwrap_or(path).to_string()
            } else {
                path.to_string()
            }
        };
        for asset in self.list_assets()?.iter().filter(|a| a.id() != owner_id) {
            let Some(auth) = asset.as_server().and_then(|s| s.connection.auth.as_ref()) else {
                continue;
            };
            for (env_id, identity) in &auth.identity_file {
                if (&receipt_env == env_id && same_native(env_id, identity, &native))
                    || (env_id.is_windows() && same_native(env_id, identity, &private_host))
                {
                    return Ok(true);
                }
                if let Some(env) = envs.iter().find(|env| &env.id == env_id)
                    && (same_host(&env.to_host(identity).to_string_lossy(), &private_host)
                        || same_native(env_id, identity, &env.windows_path_to_native(Path::new(&private_host))))
                {
                    return Ok(true);
                }
            }
        }
        Ok(false)
    }

    pub fn generated_keys(&self, asset_id: &str) -> Result<Vec<(String, String)>> {
        let mut stmt = self
            .conn
            .prepare("SELECT path,content_hash FROM generated_keys WHERE asset_id=?1 ORDER BY path")?;
        let receipts = stmt
            .query_map([asset_id], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<std::result::Result<Vec<(String, String)>, _>>()?;
        let mut removable = Vec::new();
        for receipt in receipts {
            if !self.key_in_use(asset_id, &receipt.0, &[])? {
                removable.push(receipt);
            }
        }
        Ok(removable)
    }

    pub fn commit_probe_snapshot(
        &self,
        run_id: &str,
        at: &str,
        before: &Asset,
        after: &Asset,
        merged: &Value,
    ) -> Result<()> {
        let mut merged = clean_merge(run_id, after, merged)?;
        if before.id() != after.id()
            || before.as_server().is_none()
            || before
                .as_server()
                .is_some_and(|s| s.probe.last_run_id.as_deref() == Some(run_id))
        {
            return Err(AppError::ipc(IpcErrorId::NotFound));
        }
        self.atomic(|db| {
            if db.require_asset(before.id())? != *before {
                return Err(AppError::ipc(IpcErrorId::NotFound));
            }
            db.conn
                .execute("DELETE FROM probe_snapshots WHERE asset_id=?1", [before.id()])?;
            // Keep the v1 before-only JSON representation for the existing put/take API.
            db.conn.execute(
                "INSERT INTO probe_snapshots(run_id,asset_id,at,json) VALUES (?1,?2,?3,?4)",
                params![run_id, before.id(), at, serde_json::to_string(before)?],
            )?;
            let stored = db.write_asset_guarded(after)?;
            merged.asset = stored
                .as_server()
                .ok_or_else(|| AppError::ipc(IpcErrorId::NotFound))?
                .clone();
            db.conn.execute(
                "INSERT INTO probe_results(run_id,after_json,merged_json) VALUES (?1,?2,?3)",
                params![run_id, serde_json::to_string(&stored)?, serde_json::to_string(&merged)?],
            )?;
            Ok(())
        })
    }

    fn latest_probe_record(&self, run_id: &str) -> Result<Option<ProbeRecord>> {
        let record: Option<(String, String, String, String)> = self
            .conn
            .query_row(
                "SELECT s.asset_id,s.json,r.after_json,r.merged_json FROM probe_snapshots s
             JOIN probe_results r ON r.run_id=s.run_id WHERE s.run_id=?1",
                [run_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .optional()?;
        let Some((asset_id, before, after, merged)) = record else {
            return Ok(None);
        };
        let current = self.require_asset(&asset_id)?;
        if current
            .as_server()
            .is_none_or(|s| s.probe.last_run_id.as_deref() != Some(run_id))
        {
            return Ok(None);
        }
        let before: Asset = serde_json::from_str(&before)?;
        let after: Asset = serde_json::from_str(&after)?;
        if before.id() != asset_id || after.id() != asset_id {
            return Err(AppError::ipc(IpcErrorId::NotFound));
        }
        let merged = clean_merge(run_id, &after, &serde_json::from_str(&merged)?)?;
        Ok(Some(ProbeRecord {
            before,
            after,
            merged: serde_json::to_value(merged)?,
        }))
    }

    pub fn probe_snapshot(&self, run_id: &str) -> Result<Option<(Asset, Asset)>> {
        Ok(self.latest_probe_record(run_id)?.map(|r| (r.before, r.after)))
    }

    pub fn probe_result(&self, run_id: &str) -> Result<Option<Value>> {
        Ok(self.latest_probe_record(run_id)?.map(|r| r.merged))
    }

    /// Only for updates where the saved asset is also the probe baseline. Held-item
    /// confirmation must use `update_probe_snapshot_with_after` to preserve later edits.
    pub fn update_probe_snapshot(&self, run_id: &str, current: &Asset, merged: &Value) -> Result<()> {
        self.update_probe_snapshot_with_after(run_id, current, current, merged)
    }

    /// Keep later manual edits out of the probe after baseline, so undo and remaining
    /// held-item confirmations can still distinguish them from accepted probe changes.
    pub fn update_probe_snapshot_with_after(
        &self,
        run_id: &str,
        current: &Asset,
        probe_after: &Asset,
        merged: &Value,
    ) -> Result<()> {
        let merged = clean_merge(run_id, probe_after, merged)?;
        if current.id() != probe_after.id()
            || current
                .as_server()
                .is_none_or(|s| s.probe.last_run_id.as_deref() != Some(run_id))
        {
            return Err(AppError::ipc(IpcErrorId::NotFound));
        }
        self.atomic(|db| {
            let record = db
                .latest_probe_record(run_id)?
                .ok_or_else(|| AppError::ipc(IpcErrorId::NotFound))?;
            if record.before.id() != current.id() {
                return Err(AppError::ipc(IpcErrorId::NotFound));
            }
            db.write_asset_guarded(current)?;
            db.conn.execute(
                "UPDATE probe_results SET after_json=?2,merged_json=?3 WHERE run_id=?1",
                params![
                    run_id,
                    serde_json::to_string(probe_after)?,
                    serde_json::to_string(&merged)?
                ],
            )?;
            Ok(())
        })
    }

    pub fn undo_probe_snapshot(&self, run_id: &str, restored: &Asset) -> Result<()> {
        self.atomic(|db| {
            let record = db
                .latest_probe_record(run_id)?
                .ok_or_else(|| AppError::ipc(IpcErrorId::NotFound))?;
            if record.before.id() != restored.id() {
                return Err(AppError::ipc(IpcErrorId::NotFound));
            }
            db.write_asset_guarded(restored)?;
            db.conn
                .execute("DELETE FROM probe_snapshots WHERE run_id=?1", [run_id])?;
            Ok(())
        })
    }

    pub fn publication_authority(&self, env_id: &EnvId, agent_key: &str) -> Result<Option<Value>> {
        self.get_kv(&authority_key(env_id, agent_key)?)
    }

    pub fn put_publication_authority(&self, env_id: &EnvId, agent_key: &str, value: &Value) -> Result<()> {
        self.put_kv(&authority_key(env_id, agent_key)?, value)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::env::{FakeSystem, detect};
    use crate::model::asset::{ConnectionVerified, ProbeState};
    use crate::paths::Paths;

    fn result_for(before: &Asset, run_id: &str) -> (Asset, Value) {
        let mut after = before.clone();
        let Asset::Vps(server) = &mut after else {
            panic!("probe fixture must be a server")
        };
        server.facts.os = Some(format!("observed-{run_id}"));
        server.probe.last_run_id = Some(run_id.into());
        server.probe.last_success_at = Some(crate::testkit::NOW.into());
        server.probe.status = ProbeState::Ok;
        let merged = serde_json::json!({
            "asset": server, "applied": [], "held": [], "partial": null, "pending": []
        });
        (after, merged)
    }

    fn copy_receipts(db: &Db, paths: &Paths, native: &str) -> (String, String) {
        let private = paths
            .wsl_distro_root("Ubuntu-24.04")
            .join(native.trim_start_matches('/'));
        let private = private.to_string_lossy().into_owned();
        let public = format!("{private}.pub");
        db.record_pending_key("wsl:Ubuntu-24.04", native, &private, &"1".repeat(64))
            .unwrap();
        db.record_pending_key("wsl:Ubuntu-24.04", native, &public, &"2".repeat(64))
            .unwrap();
        (private, public)
    }

    #[test]
    fn saved_password_revision_is_unlinked_on_target_edit() {
        let db = Db::open_in_memory().unwrap();
        let mut asset = Asset::Vps(crate::testkit::dev_box());
        db.upsert_asset(&asset).unwrap();
        db.replace_password_ref(&asset, Some("ast_dev_revision")).unwrap();
        assert_eq!(
            db.password_ref(asset.id()).unwrap().as_deref(),
            Some("ast_dev_revision")
        );
        if let Asset::Vps(s) = &mut asset {
            s.connection.host = Some("192.0.2.99".into());
        }
        db.upsert_asset_guarded(&asset).unwrap();
        assert!(db.password_ref(asset.id()).unwrap().is_none());
        assert_eq!(db.password_cleanup().unwrap(), ["ast_dev_revision"]);
    }

    #[test]
    fn staged_password_receipt_survives_restart_before_any_vault_reference_exists() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("data.db");
        {
            let db = Db::open(&path).unwrap();
            db.stage_password_write("ast_pending_write").unwrap();
        }
        let db = Db::open(&path).unwrap();
        assert_eq!(db.password_cleanup().unwrap(), ["ast_pending_write"]);
        let asset = Asset::Vps(crate::testkit::dev_box());
        db.upsert_asset(&asset).unwrap();
        assert!(db.password_ref(asset.id()).unwrap().is_none());
        db.finish_password_cleanup("ast_pending_write").unwrap();
        assert!(db.password_cleanup().unwrap().is_empty());
        assert!(db.commit_staged_password(&asset, "ast_pending_write").is_err());
    }

    #[test]
    fn staged_password_promotion_atomically_swaps_the_pointer_and_retires_old_key() {
        let db = Db::open_in_memory().unwrap();
        let asset = Asset::Vps(crate::testkit::dev_box());
        db.upsert_asset(&asset).unwrap();
        db.replace_password_ref(&asset, Some("ast_old_key")).unwrap();
        db.stage_password_write("ast_new_key").unwrap();
        assert!(db.replace_password_ref(&asset, Some("ast_new_key")).is_err());
        db.commit_staged_password(&asset, "ast_new_key").unwrap();
        assert_eq!(db.password_ref(asset.id()).unwrap().as_deref(), Some("ast_new_key"));
        assert_eq!(db.password_cleanup().unwrap(), ["ast_old_key"]);
        let remaining: u32 = db
            .conn
            .query_row("SELECT count(*) FROM password_staging", [], |r| r.get(0))
            .unwrap();
        assert_eq!(remaining, 0);
    }

    #[test]
    fn a_retired_revision_cannot_be_reclassified_as_staged_and_resurrected() {
        let db = Db::open_in_memory().unwrap();
        let asset = Asset::Vps(crate::testkit::dev_box());
        db.upsert_asset(&asset).unwrap();
        db.queue_password_cleanup("ast_retired").unwrap();
        assert!(db.stage_password_write("ast_retired").is_err());
        assert!(db.commit_staged_password(&asset, "ast_retired").is_err());
        assert!(db.replace_password_ref(&asset, Some("ast_retired")).is_err());
        assert_eq!(db.password_cleanup().unwrap(), ["ast_retired"]);
        assert!(db.password_ref(asset.id()).unwrap().is_none());
    }

    #[test]
    fn failed_staged_promotion_restores_stage_cleanup_and_old_password_reference() {
        let db = Db::open_in_memory().unwrap();
        let asset = Asset::Vps(crate::testkit::dev_box());
        let other = Asset::Vps(crate::testkit::hk_edge());
        db.upsert_asset(&asset).unwrap();
        db.upsert_asset(&other).unwrap();
        db.replace_password_ref(&asset, Some("ast_old_revision")).unwrap();
        db.stage_password_write("ast_new_revision").unwrap();
        let mut invalid = asset.clone();
        if let Asset::Vps(server) = &mut invalid {
            server.connection.ssh_alias = other.handle().into();
        }
        assert!(db.commit_staged_password(&invalid, "ast_new_revision").is_err());
        assert_eq!(
            db.password_ref(asset.id()).unwrap().as_deref(),
            Some("ast_old_revision")
        );
        assert_eq!(db.password_cleanup().unwrap(), ["ast_new_revision"]);
        db.commit_staged_password(&asset, "ast_new_revision").unwrap();
        assert_eq!(
            db.password_ref(asset.id()).unwrap().as_deref(),
            Some("ast_new_revision")
        );
    }

    #[test]
    fn password_pointer_and_asset_change_roll_back_together() {
        let db = Db::open_in_memory().unwrap();
        let asset = Asset::Vps(crate::testkit::dev_box());
        db.upsert_asset(&asset).unwrap();
        db.replace_password_ref(&asset, Some("ast_dev_old")).unwrap();
        let other = Asset::Vps(crate::testkit::hk_edge());
        db.upsert_asset(&other).unwrap();
        let mut invalid = asset.clone();
        if let Asset::Vps(s) = &mut invalid {
            s.connection.ssh_alias = other.handle().to_string();
        }
        assert!(db.replace_password_ref(&invalid, Some("ast_dev_new")).is_err());
        assert_eq!(db.password_ref(asset.id()).unwrap().as_deref(), Some("ast_dev_old"));
        assert!(db.password_cleanup().unwrap().is_empty());
    }

    #[test]
    fn password_target_ignores_verification_alias_and_environment_metadata() {
        let db = Db::open_in_memory().unwrap();
        let asset = Asset::Vps(crate::testkit::dev_box());
        db.upsert_asset(&asset).unwrap();
        db.replace_password_ref(&asset, Some("ast_dev_revision")).unwrap();
        let mut changed = asset.clone();
        if let Asset::Vps(server) = &mut changed {
            server.connection.ssh_alias = "renamed-dev".into();
            server.connection.defined_in = vec![EnvId::windows()];
            server.connection.proxy_jump = Some(Some("gateway".into()));
            server.connection.verified = Some(ConnectionVerified {
                ok: true,
                at: crate::testkit::NOW.into(),
                env_ids: vec![EnvId::windows()],
            });
            server.connection.auth.as_mut().unwrap().password_saved = false;
        }
        assert!(Db::password_target_matches(&asset, &changed));
        db.upsert_asset_guarded(&changed).unwrap();
        assert_eq!(
            db.password_ref(asset.id()).unwrap().as_deref(),
            Some("ast_dev_revision")
        );
        assert!(
            db.require_asset(asset.id())
                .unwrap()
                .as_server()
                .unwrap()
                .connection
                .auth
                .as_ref()
                .unwrap()
                .password_saved
        );
        assert!(db.password_cleanup().unwrap().is_empty());
    }

    #[test]
    fn every_password_target_field_unlinks_the_old_revision() {
        let original = Asset::Vps(crate::testkit::dev_box());
        let mut changed = Vec::new();
        for field in 0..5 {
            let mut asset = original.clone();
            if let Asset::Vps(server) = &mut asset {
                match field {
                    0 => server.connection.source = ConnectionSource::Imported,
                    1 => server.connection.host = Some("192.0.2.99".into()),
                    2 => server.connection.port = Some(2222),
                    3 => server.connection.user = Some("different-user".into()),
                    _ => server.connection.auth.as_mut().unwrap().method = AuthMethod::Password,
                }
            }
            changed.push(asset);
        }
        for asset in changed {
            let db = Db::open_in_memory().unwrap();
            db.upsert_asset(&original).unwrap();
            db.replace_password_ref(&original, Some("old_revision")).unwrap();
            assert!(!Db::password_target_matches(&original, &asset));
            assert!(db.replace_password_ref(&asset, Some("old_revision")).is_err());
            db.upsert_asset_guarded(&asset).unwrap();
            assert!(db.password_ref(asset.id()).unwrap().is_none());
            assert_eq!(db.password_cleanup().unwrap(), ["old_revision"]);
            assert!(
                !db.require_asset(asset.id())
                    .unwrap()
                    .as_server()
                    .unwrap()
                    .connection
                    .auth
                    .as_ref()
                    .unwrap()
                    .password_saved
            );
        }
    }

    #[test]
    fn password_replacement_clear_and_failed_revisions_use_a_durable_cleanup_queue() {
        let db = Db::open_in_memory().unwrap();
        let asset = Asset::Vps(crate::testkit::dev_box());
        db.upsert_asset(&asset).unwrap();
        db.replace_password_ref(&asset, Some("old_revision")).unwrap();
        assert!(db.queue_password_cleanup("old_revision").is_err());
        db.replace_password_ref(&asset, Some("new_revision")).unwrap();
        assert_eq!(db.password_cleanup().unwrap(), ["old_revision"]);
        assert!(db.replace_password_ref(&asset, Some("old_revision")).is_err());
        db.queue_password_cleanup("failed_staged_revision").unwrap();
        db.queue_password_cleanup("failed_staged_revision").unwrap();
        db.replace_password_ref(&asset, None).unwrap();
        assert_eq!(
            db.password_cleanup().unwrap(),
            ["old_revision", "failed_staged_revision", "new_revision"]
        );
        assert!(db.password_ref(asset.id()).unwrap().is_none());
        db.finish_password_cleanup("failed_staged_revision").unwrap();
        assert_eq!(db.password_cleanup().unwrap(), ["old_revision", "new_revision"]);
    }

    #[test]
    fn save_claims_only_new_wsl_copy_receipts_and_preserves_a_shared_pair() {
        let db = Db::open_in_memory().unwrap();
        let temp = tempfile::tempdir().unwrap();
        let paths = Paths::isolated_in(temp.path());
        let native = "/home/me/.ssh/cloudlink-copy";
        let (private, public) = copy_receipts(&db, &paths, native);
        let source = paths
            .user_home
            .join(".ssh/user-private-key")
            .to_string_lossy()
            .into_owned();
        let mut asset = Asset::Vps(crate::testkit::hk_edge());
        if let Asset::Vps(server) = &mut asset {
            let auth = server.connection.auth.as_mut().unwrap();
            auth.identity_file.insert(EnvId::windows(), source.clone());
            auth.identity_file.insert(EnvId::wsl("Ubuntu-24.04"), native.into());
        }
        db.upsert_asset_guarded(&asset).unwrap();
        assert!(
            db.require_asset(asset.id())
                .unwrap()
                .as_server()
                .unwrap()
                .connection
                .auth
                .as_ref()
                .unwrap()
                .generated_by_cloud_link
        );
        let receipts = db.generated_keys(asset.id()).unwrap();
        assert_eq!(receipts.len(), 2);
        assert!(receipts.iter().any(|r| r.0 == private));
        assert!(receipts.iter().any(|r| r.0 == public));
        assert!(receipts.iter().all(|r| r.0 != source && r.0 != format!("{source}.pub")));
        assert_eq!(
            db.conn
                .query_row("SELECT count(*) FROM pending_keys", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            0
        );

        let mut other = asset.clone();
        if let Asset::Vps(server) = &mut other {
            server.id = "ast_shared_key".into();
            server.connection.ssh_alias = "shared-key-user".into();
        }
        db.upsert_asset_guarded(&other).unwrap();
        assert!(db.generated_keys(other.id()).unwrap().is_empty());
        assert!(db.generated_keys(asset.id()).unwrap().is_empty());
        assert!(db.key_in_use(asset.id(), &private, &[]).unwrap());
        assert!(db.key_in_use(asset.id(), &public, &[]).unwrap());
    }

    #[test]
    fn failed_asset_save_rolls_back_pending_receipt_claims() {
        let db = Db::open_in_memory().unwrap();
        let existing = Asset::Vps(crate::testkit::hk_edge());
        db.upsert_asset(&existing).unwrap();
        let temp = tempfile::tempdir().unwrap();
        let paths = Paths::isolated_in(temp.path());
        let native = "/home/me/.ssh/new-cloudlink-copy";
        copy_receipts(&db, &paths, native);
        let mut asset = existing.clone();
        if let Asset::Vps(server) = &mut asset {
            server.id = "ast_pending".into();
            server
                .connection
                .auth
                .as_mut()
                .unwrap()
                .identity_file
                .insert(EnvId::wsl("Ubuntu-24.04"), native.into());
        }
        assert!(db.upsert_asset_guarded(&asset).is_err());
        assert_eq!(
            db.conn
                .query_row("SELECT count(*) FROM pending_keys", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            2
        );
        assert!(db.generated_keys(asset.id()).unwrap().is_empty());
        if let Asset::Vps(server) = &mut asset {
            server.connection.ssh_alias = "new-server".into();
        }
        db.upsert_asset_guarded(&asset).unwrap();
        assert_eq!(db.generated_keys(asset.id()).unwrap().len(), 2);
    }

    #[test]
    fn windows_key_receipts_are_protected_when_another_asset_uses_the_wsl_mount() {
        let db = Db::open_in_memory().unwrap();
        let temp = tempfile::tempdir().unwrap();
        let paths = Paths::isolated_in(temp.path());
        let envs = detect(
            &paths,
            &FakeSystem {
                distros: vec!["Ubuntu-24.04".into()],
                ..Default::default()
            },
        );
        let private = r"C:\CloudLink-Test\keys\shared";
        let public = format!("{private}.pub");
        let owner = Asset::Vps(crate::testkit::hk_edge());
        db.upsert_asset(&owner).unwrap();
        db.record_generated_key_at(owner.id(), "windows", private, private, &"1".repeat(64))
            .unwrap();
        db.record_generated_key_at(owner.id(), "windows", private, &public, &"2".repeat(64))
            .unwrap();
        let mut other = owner.clone();
        if let Asset::Vps(server) = &mut other {
            server.id = "ast_wsl_key_user".into();
            server.connection.ssh_alias = "wsl-key-user".into();
            let auth = server.connection.auth.as_mut().unwrap();
            auth.identity_file.clear();
            let wsl = envs.iter().find(|e| e.distro().is_some()).unwrap();
            auth.identity_file
                .insert(wsl.id.clone(), wsl.windows_path_to_native(Path::new(private)));
        }
        db.upsert_asset(&other).unwrap();
        assert!(db.key_in_use(owner.id(), private, &envs).unwrap());
        assert!(db.key_in_use(owner.id(), &public, &envs).unwrap());
    }

    #[test]
    fn clean_probe_results_survive_reopen_and_keep_the_legacy_before_api() {
        let temp = tempfile::tempdir().unwrap();
        let file = temp.path().join("isolated-data.db");
        let before = Asset::Vps(crate::testkit::hk_edge());
        let (after, mut merged) = result_for(&before, "prb_durable");
        merged
            .as_object_mut()
            .unwrap()
            .insert("rawStdout".into(), Value::String("RAW_OUTPUT_SENTINEL".into()));
        {
            let db = Db::open(&file).unwrap();
            db.upsert_asset(&before).unwrap();
            db.commit_probe_snapshot("prb_durable", crate::testkit::NOW, &before, &after, &merged)
                .unwrap();
            let stored: String = db
                .conn
                .query_row(
                    "SELECT merged_json FROM probe_results WHERE run_id='prb_durable'",
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            assert!(!stored.contains("RAW_OUTPUT_SENTINEL"));
        }
        let db = Db::open(&file).unwrap();
        assert_eq!(db.require_asset(before.id()).unwrap(), after);
        assert_eq!(db.probe_snapshot("prb_durable").unwrap(), Some((before.clone(), after)));
        assert!(
            db.probe_result("prb_durable")
                .unwrap()
                .unwrap()
                .get("rawStdout")
                .is_none()
        );
        assert_eq!(db.take_probe_snapshot("prb_durable").unwrap(), Some(before.clone()));
        assert!(db.probe_result("prb_durable").unwrap().is_none());
        db.put_probe_snapshot("prb_legacy", before.id(), crate::testkit::NOW, &before)
            .unwrap();
        assert_eq!(db.take_probe_snapshot("prb_legacy").unwrap(), Some(before));
    }

    #[test]
    fn confirmation_updates_after_and_results_atomically_and_only_the_latest_run_can_undo() {
        let db = Db::open_in_memory().unwrap();
        let before = Asset::Vps(crate::testkit::hk_edge());
        db.upsert_asset(&before).unwrap();
        let (after, merged) = result_for(&before, "prb_first");
        db.commit_probe_snapshot("prb_first", crate::testkit::NOW, &before, &after, &merged)
            .unwrap();
        let mut confirmed = after.clone();
        if let Asset::Vps(server) = &mut confirmed {
            server.facts.kernel = Some("confirmed-kernel".into());
        }
        let mut confirmed_result = merged.clone();
        confirmed_result["asset"] = serde_json::to_value(confirmed.as_server().unwrap()).unwrap();
        db.update_probe_snapshot("prb_first", &confirmed, &confirmed_result)
            .unwrap();
        assert_eq!(
            db.probe_snapshot("prb_first").unwrap(),
            Some((before, confirmed.clone()))
        );
        assert_eq!(db.probe_result("prb_first").unwrap(), Some(confirmed_result.clone()));
        let (latest, latest_result) = result_for(&confirmed, "prb_second");
        db.commit_probe_snapshot("prb_second", crate::testkit::NOW, &confirmed, &latest, &latest_result)
            .unwrap();
        assert!(db.probe_snapshot("prb_first").unwrap().is_none());
        assert!(db.probe_result("prb_first").unwrap().is_none());
        assert!(
            db.update_probe_snapshot("prb_first", &confirmed, &confirmed_result)
                .is_err()
        );
        assert!(db.undo_probe_snapshot("prb_first", &confirmed).is_err());
        assert_eq!(db.require_asset(confirmed.id()).unwrap(), latest);
        db.undo_probe_snapshot("prb_second", &confirmed).unwrap();
        assert_eq!(db.require_asset(confirmed.id()).unwrap(), confirmed);
        assert!(db.probe_result("prb_second").unwrap().is_none());
    }

    #[test]
    fn confirming_held_items_keeps_manual_fields_out_of_the_probe_after_baseline() {
        let db = Db::open_in_memory().unwrap();
        let before = Asset::Vps(crate::testkit::hk_edge());
        db.upsert_asset(&before).unwrap();
        let (after, mut merged) = result_for(&before, "prb_manual");
        merged["held"] = serde_json::json!([{
            "id": "held-kernel", "kind": "changed", "field": "kernel", "label": "kernel",
            "before": before.as_server().unwrap().facts.kernel, "after": "held-kernel-value"
        }]);
        merged["pending"] = serde_json::json!([{
            "id": "held-kernel", "mutation": {"Kernel": "held-kernel-value"}
        }]);
        db.commit_probe_snapshot("prb_manual", crate::testkit::NOW, &before, &after, &merged)
            .unwrap();
        let mut current = after.clone();
        if let Asset::Vps(server) = &mut current {
            server.facts.kernel = Some("human-kernel".into());
            server.facts.os = Some("human-system".into());
            server.facts.arch = Some("confirmed-arch".into());
        }
        let mut probe_after = after;
        if let Asset::Vps(server) = &mut probe_after {
            server.facts.arch = Some("confirmed-arch".into());
        }
        merged["asset"] = serde_json::to_value(probe_after.as_server().unwrap()).unwrap();
        db.update_probe_snapshot_with_after("prb_manual", &current, &probe_after, &merged)
            .unwrap();
        let (saved_before, saved_after) = db.probe_snapshot("prb_manual").unwrap().unwrap();
        assert_eq!(saved_before, before);
        assert_eq!(saved_after, probe_after);
        assert_eq!(db.require_asset(current.id()).unwrap(), current);
        let stored: MergeResult = serde_json::from_value(db.probe_result("prb_manual").unwrap().unwrap()).unwrap();
        assert!(crate::probe::confirm(current.as_server().unwrap(), &stored, &["held-kernel".into()]).is_err());
        let restored = crate::probe::undo(
            current.as_server().unwrap(),
            saved_before.as_server().unwrap(),
            saved_after.as_server().unwrap(),
        );
        assert_eq!(restored.facts.kernel.as_deref(), Some("human-kernel"));
        assert_eq!(restored.facts.os.as_deref(), Some("human-system"));
        assert_eq!(restored.facts.arch, before.as_server().unwrap().facts.arch);
    }

    #[test]
    fn failed_probe_commit_retains_the_previous_snapshot_and_current_asset() {
        let db = Db::open_in_memory().unwrap();
        let before = Asset::Vps(crate::testkit::hk_edge());
        db.upsert_asset(&before).unwrap();
        let (first, first_result) = result_for(&before, "prb_first");
        db.commit_probe_snapshot("prb_first", crate::testkit::NOW, &before, &first, &first_result)
            .unwrap();
        db.conn.execute_batch("CREATE TRIGGER fail_asset_update BEFORE UPDATE ON assets BEGIN SELECT RAISE(ABORT,'test-write-failure'); END;").unwrap();
        let (second, second_result) = result_for(&first, "prb_second");
        assert!(
            db.commit_probe_snapshot("prb_second", crate::testkit::NOW, &first, &second, &second_result)
                .is_err()
        );
        assert_eq!(db.require_asset(first.id()).unwrap(), first);
        assert_eq!(db.probe_result("prb_first").unwrap(), Some(first_result));
        assert!(db.probe_result("prb_second").unwrap().is_none());
    }

    #[test]
    fn a_failed_later_run_invalidates_the_old_confirmation_and_undo() {
        let db = Db::open_in_memory().unwrap();
        let before = Asset::Vps(crate::testkit::hk_edge());
        db.upsert_asset(&before).unwrap();
        let (after, merged) = result_for(&before, "prb_success");
        db.commit_probe_snapshot("prb_success", crate::testkit::NOW, &before, &after, &merged)
            .unwrap();
        let mut failed = after.clone();
        if let Asset::Vps(server) = &mut failed {
            server.probe.last_run_id = Some("prb_failed".into());
            server.probe.status = ProbeState::Failed;
        }
        db.upsert_asset(&failed).unwrap();
        assert!(db.probe_result("prb_success").unwrap().is_none());
        assert!(db.update_probe_snapshot("prb_success", &after, &merged).is_err());
        assert!(db.undo_probe_snapshot("prb_success", &before).is_err());
        assert_eq!(db.require_asset(failed.id()).unwrap(), failed);
    }

    #[test]
    fn asset_delete_cascades_probe_metadata_but_keeps_password_cleanup() {
        let db = Db::open_in_memory().unwrap();
        let asset = Asset::Vps(crate::testkit::dev_box());
        db.upsert_asset(&asset).unwrap();
        db.replace_password_ref(&asset, Some("delete_revision")).unwrap();
        let before = db.require_asset(asset.id()).unwrap();
        let (after, merged) = result_for(&before, "prb_delete");
        db.commit_probe_snapshot("prb_delete", crate::testkit::NOW, &before, &after, &merged)
            .unwrap();
        db.delete_asset_with_password_cleanup(asset.id()).unwrap();
        assert!(db.get_asset(asset.id()).unwrap().is_none());
        assert!(db.probe_result("prb_delete").unwrap().is_none());
        assert!(db.password_ref(asset.id()).unwrap().is_none());
        assert_eq!(db.password_cleanup().unwrap(), ["delete_revision"]);
    }

    #[test]
    fn publication_authority_is_isolated_by_the_exact_environment_and_agent_key() {
        let db = Db::open_in_memory().unwrap();
        let windows = EnvId::windows();
        let wsl = EnvId::wsl("Ubuntu-24.04");
        let first = serde_json::json!({"assetIds": ["ast_first"]});
        let second = serde_json::json!({"assetIds": ["ast_second"]});
        let third = serde_json::json!({"assetIds": ["ast_third"]});
        assert!(
            db.publication_authority(&windows, "custom:Cursor Plus")
                .unwrap()
                .is_none()
        );
        db.put_publication_authority(&windows, "custom:Cursor Plus", &first)
            .unwrap();
        db.put_publication_authority(&windows, "custom:Cursor-Plus", &second)
            .unwrap();
        db.put_publication_authority(&wsl, "custom:Cursor Plus", &third)
            .unwrap();
        assert_eq!(
            db.publication_authority(&windows, "custom:Cursor Plus").unwrap(),
            Some(first)
        );
        assert_eq!(
            db.publication_authority(&windows, "custom:Cursor-Plus").unwrap(),
            Some(second)
        );
        assert_eq!(
            db.publication_authority(&wsl, "custom:Cursor Plus").unwrap(),
            Some(third)
        );
    }
}
