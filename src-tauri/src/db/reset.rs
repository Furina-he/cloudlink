//! A reset intent survives crashes. Vault cleanup receipts are never discarded before deletion succeeds.

use super::Db;
use crate::error::{AppError, Result};
use crate::model::misc::{IpcErrorId, Settings};

const RESET_PENDING: &str = "reset_pending";

impl Db {
    pub fn reset_pending(&self) -> Result<bool> {
        Ok(self.get_kv(RESET_PENDING)?.unwrap_or(false))
    }

    pub fn begin_reset(&self) -> Result<()> {
        self.put_kv(RESET_PENDING, &true)
    }

    /// File cleanup must have completed first. Retain environment/settings data until finalization,
    /// so a failed vault cleanup can be retried on this launch or after reopening the application.
    pub fn reset_domain(&self) -> Result<()> {
        if !self.reset_pending()? {
            return Err(AppError::ipc(IpcErrorId::SettingsInvalid));
        }
        let tx = self.conn.unchecked_transaction()?;
        tx.execute(
            "INSERT OR IGNORE INTO password_cleanup(key) SELECT key FROM password_refs",
            [],
        )?;
        for table in [
            "inclusions",
            "deliveries",
            "targets",
            "probe_results",
            "probe_snapshots",
            "generated_keys",
            "pending_keys",
            "password_refs",
            "password_staging",
            "operations",
            "notes",
            "activity",
            "ingest_claims",
            "assets",
        ] {
            tx.execute(&format!("DELETE FROM {table}"), [])?;
        }
        tx.execute(
            "DELETE FROM settings WHERE key != ?1 AND key != ?2",
            [RESET_PENDING, super::KEY_SETTINGS],
        )?;
        tx.commit()?;
        Ok(())
    }

    pub fn finish_reset(&self, settings: &Settings) -> Result<()> {
        if !self.password_cleanup()?.is_empty() {
            return Err(AppError::ipc(IpcErrorId::ResetIncomplete));
        }
        // Clear deleted credentials/notes from SQLite free pages and checkpoint the WAL.
        self.conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE); VACUUM;")?;
        let tx = self.conn.unchecked_transaction()?;
        tx.execute("DELETE FROM settings", [])?;
        self.put_settings(settings)?;
        tx.commit()?;
        self.conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")?;
        Ok(())
    }
}
