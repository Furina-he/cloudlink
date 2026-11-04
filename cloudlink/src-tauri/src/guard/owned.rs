use std::fs;
use std::io::{self, Read, Write};
use std::path::{Component, Path};

use serde_json::{Value, json};
use sha2::{Digest, Sha256};

use crate::error::{AppError, Result};
use crate::fsx;
use crate::model::misc::IpcErrorId;
use crate::paths::Paths;

pub(super) const MAX_SETTINGS: u64 = 1024 * 1024;
pub(super) const MAX_BINARY: u64 = 32 * 1024 * 1024;

pub(super) fn invalid() -> AppError {
    AppError::ipc(IpcErrorId::SettingsInvalid)
}

pub(super) fn check(path: &Path) -> Result<()> {
    if !path.is_absolute() || path.components().any(|part| matches!(part, Component::ParentDir)) {
        return Err(invalid());
    }
    for ancestor in path.ancestors() {
        match fs::symlink_metadata(ancestor) {
            Ok(metadata) if fsx::is_link(&metadata) => return Err(invalid()),
            Ok(_) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
    }
    Ok(())
}

pub(super) fn read(path: &Path, limit: u64) -> Result<Option<Vec<u8>>> {
    check(path)?;
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.is_file() && metadata.len() <= limit => metadata,
        Ok(_) => return Err(invalid()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.into()),
    };
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    fs::File::open(path)?.take(limit + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > limit {
        return Err(invalid());
    }
    Ok(Some(bytes))
}

pub(super) fn hash(bytes: &[u8]) -> String {
    Sha256::digest(bytes).iter().map(|byte| format!("{byte:02x}")).collect()
}

pub(super) fn marker(path: &Path, kind: &str) -> Result<Option<Value>> {
    let Some(bytes) = read(&path.join(".cloudlink.json"), MAX_SETTINGS)? else {
        return Ok(None);
    };
    let value: Value = serde_json::from_slice(&bytes).map_err(|_| invalid())?;
    if value["managedBy"] != "cloudlink" || value["kind"] != kind {
        return Err(invalid());
    }
    Ok(Some(value))
}

pub(super) fn require_data(paths: &Paths) -> Result<()> {
    marker(&paths.data_dir, "data")?.ok_or_else(invalid)?;
    Ok(())
}

pub(super) fn ensure_dir(path: &Path, kind: &str) -> Result<()> {
    check(path)?;
    if marker(path, kind)?.is_some() {
        if !fs::symlink_metadata(path)?.is_dir() {
            return Err(invalid());
        }
        return Ok(());
    }
    if path.exists() && fs::read_dir(path)?.next().is_some() {
        return Err(invalid());
    }
    fs::create_dir_all(path)?;
    create(
        &path.join(".cloudlink.json"),
        &serde_json::to_vec(&json!({
            "managedBy": "cloudlink", "kind": kind, "version": 1
        }))?,
    )
}

pub(super) fn create(path: &Path, bytes: &[u8]) -> Result<()> {
    check(path)?;
    let mut file = fs::OpenOptions::new().write(true).create_new(true).open(path)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    Ok(())
}

/// Only called after the caller has verified the enclosing ownership marker and
/// the file's receipt. Recheck the observed bytes immediately before replacing.
pub(super) fn replace(path: &Path, before: Option<&[u8]>, after: &[u8], limit: u64) -> Result<()> {
    if read(path, limit)?.as_deref() != before {
        return Err(invalid());
    }
    check(path)?;
    fsx::write_atomic(path, after)?;
    Ok(())
}

pub(super) fn remove_file(path: &Path, expected: &[u8]) -> Result<()> {
    if read(path, expected.len() as u64)?.as_deref() != Some(expected) {
        return Err(invalid());
    }
    check(path)?;
    fs::remove_file(path)?;
    Ok(())
}

/// Never recursively remove a directory: unknown additions and their contents
/// are retained. The marker is removed only when it is the last entry.
pub(super) fn remove_empty_owned_dir(path: &Path, kind: &str) -> Result<()> {
    if marker(path, kind)?.is_none() {
        return Ok(());
    }
    let entries = fs::read_dir(path)?.collect::<io::Result<Vec<_>>>()?;
    if entries.len() == 1 && entries[0].file_name() == ".cloudlink.json" {
        let marker_path = path.join(".cloudlink.json");
        let bytes = read(&marker_path, MAX_SETTINGS)?.ok_or_else(invalid)?;
        remove_file(&marker_path, &bytes)?;
        check(path)?;
        fs::remove_dir(path)?;
    }
    Ok(())
}
