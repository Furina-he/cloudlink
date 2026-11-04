//! 系统凭据库（Windows 凭据管理器）。
//! - service 名里拼入数据目录的哈希，开发、验收和日常环境的密码天然隔离；
//! - 单元测试下 `OsCredentialStore` 直接报错，测试必须注入 `MemoryCredentialStore`；
//! - 调用方必须在释放全局状态锁之后再调用这里（凭据库可能因系统弹窗而阻塞，CC-SWITCH 3.1.3）。

use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;

use sha2::{Digest, Sha256};

use super::SecretString;
use crate::error::{AppError, Result};

pub trait CredentialStore: Send + Sync {
    fn get(&self, asset_id: &str) -> Result<Option<SecretString>>;
    fn set(&self, asset_id: &str, password: &SecretString) -> Result<()>;
    /// 不存在时也返回 Ok
    fn delete(&self, asset_id: &str) -> Result<()>;
}

/// `cloudlink.password.v1.<sha256(规范化数据目录) 前 16 位>`
pub fn service_name(data_dir: &Path) -> String {
    let canonical = std::fs::canonicalize(data_dir).unwrap_or_else(|_| data_dir.to_path_buf());
    let normalized = canonical.to_string_lossy().to_lowercase();
    let digest = Sha256::digest(normalized.as_bytes());
    let hex: String = digest.iter().take(8).map(|b| format!("{b:02x}")).collect();
    format!("cloudlink.password.v1.{hex}")
}

pub struct OsCredentialStore {
    service: String,
}

impl OsCredentialStore {
    pub fn new(data_dir: &Path) -> Self {
        OsCredentialStore {
            service: service_name(data_dir),
        }
    }

    fn entry(&self, asset_id: &str) -> Result<keyring::Entry> {
        if cfg!(test) {
            return Err(AppError::internal(
                "native credential storage is disabled in unit tests; inject a mock",
            ));
        }
        if !asset_id.starts_with("ast_") || !asset_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
            return Err(AppError::internal("invalid credential key"));
        }
        keyring::Entry::new(&self.service, asset_id).map_err(|e| AppError::internal(format!("keyring: {e}")))
    }
}

impl CredentialStore for OsCredentialStore {
    fn get(&self, asset_id: &str) -> Result<Option<SecretString>> {
        match self.entry(asset_id)?.get_password() {
            Ok(p) => SecretString::new(p).map(Some),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(AppError::internal(format!("keyring get: {e}"))),
        }
    }
    fn set(&self, asset_id: &str, password: &SecretString) -> Result<()> {
        self.entry(asset_id)?
            .set_password(password.expose())
            .map_err(|e| AppError::internal(format!("keyring set: {e}")))
    }
    fn delete(&self, asset_id: &str) -> Result<()> {
        match self.entry(asset_id)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(AppError::internal(format!("keyring delete: {e}"))),
        }
    }
}

/// 测试与隔离模式用的内存凭据库
#[derive(Default)]
pub struct MemoryCredentialStore {
    items: Mutex<HashMap<String, SecretString>>,
}

impl CredentialStore for MemoryCredentialStore {
    fn get(&self, asset_id: &str) -> Result<Option<SecretString>> {
        Ok(self
            .items
            .lock()
            .map_err(|_| AppError::internal("poisoned"))?
            .get(asset_id)
            .cloned())
    }
    fn set(&self, asset_id: &str, password: &SecretString) -> Result<()> {
        self.items
            .lock()
            .map_err(|_| AppError::internal("poisoned"))?
            .insert(asset_id.to_string(), password.clone());
        Ok(())
    }
    fn delete(&self, asset_id: &str) -> Result<()> {
        self.items
            .lock()
            .map_err(|_| AppError::internal("poisoned"))?
            .remove(asset_id);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_store_is_disabled_in_tests() {
        let dir = tempfile::tempdir().unwrap();
        let store = OsCredentialStore::new(dir.path());
        assert!(store.get("ast_1").is_err());
        assert!(store.set("ast_1", &SecretString::new("x".into()).unwrap()).is_err());
        assert!(store.delete("ast_1").is_err());
    }

    #[test]
    fn service_name_differs_per_data_dir() {
        let a = tempfile::tempdir().unwrap();
        let b = tempfile::tempdir().unwrap();
        assert_ne!(service_name(a.path()), service_name(b.path()));
        assert!(service_name(a.path()).starts_with("cloudlink.password.v1."));
    }

    #[test]
    fn memory_store_round_trip() {
        let s = MemoryCredentialStore::default();
        s.set("ast_1", &SecretString::new("pw".into()).unwrap()).unwrap();
        assert_eq!(s.get("ast_1").unwrap().unwrap().expose(), "pw");
        s.delete("ast_1").unwrap();
        assert!(s.get("ast_1").unwrap().is_none());
    }
}
