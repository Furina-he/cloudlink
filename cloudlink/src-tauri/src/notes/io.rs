//! Shared, bounded file claiming for the two agent-written inboxes. Only registered source
//! names and SQLite claim receipts are writable; other files in these directories are preserved.

use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, Write};
use std::path::{Component, Path, PathBuf};

use crate::db::{Db, IngestClaim};
use crate::error::{AppError, Result};
use crate::fsx;
use crate::model::misc::IpcErrorId;
use crate::paths::Paths;

pub const MAX_FILE_BYTES: u64 = 32 * 1024 * 1024;
pub const MAX_LINE_BYTES: usize = 128 * 1024;
pub const MAX_CLAIMS: usize = 64;
pub const MAX_LINES: usize = 2048;
pub const MAX_SCAN_BYTES: u64 = MAX_FILE_BYTES;

fn invalid() -> AppError {
    AppError::ipc(IpcErrorId::SettingsInvalid)
}

fn file_busy(error: &std::io::Error) -> bool {
    matches!(error.kind(), std::io::ErrorKind::PermissionDenied | std::io::ErrorKind::WouldBlock)
        // Windows sharing/lock violations can map to ErrorKind::Uncategorized. They still
        // mean that an existing writer must close before this claim can be read or renamed.
        || cfg!(windows) && matches!(error.raw_os_error(), Some(32 | 33))
}

pub fn check_path(path: &Path) -> Result<()> {
    for ancestor in path.ancestors() {
        match fs::symlink_metadata(ancestor) {
            Ok(m) if fsx::is_link(&m) => return Err(invalid()),
            Ok(_) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.into()),
        }
    }
    Ok(())
}

pub fn regular_file(path: &Path) -> Result<Option<fs::Metadata>> {
    check_path(path)?;
    match fs::symlink_metadata(path) {
        Ok(m) if m.is_file() && !fsx::is_link(&m) => Ok(Some(m)),
        Ok(_) => Err(invalid()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.into()),
    }
}

fn marker_matches(dir: &Path, kind: &str) -> Result<bool> {
    let marker = dir.join(".cloudlink.json");
    let Some(meta) = regular_file(&marker)? else {
        return Ok(false);
    };
    if meta.len() > 256 * 1024 {
        return Err(invalid());
    }
    let json: serde_json::Value = serde_json::from_slice(&fs::read(marker)?).map_err(|_| invalid())?;
    if json.get("managedBy").and_then(|v| v.as_str()) != Some("cloudlink")
        || json.get("kind").and_then(|v| v.as_str()) != Some(kind)
    {
        return Err(invalid());
    }
    Ok(true)
}

pub fn check_root(paths: &Paths) -> Result<()> {
    check_path(&paths.data_dir)?;
    if !paths.data_dir.is_absolute() || !marker_matches(&paths.data_dir, "data")? {
        return Err(invalid());
    }
    Ok(())
}

/// P4a already created the inbox before it had its own marker. Only compiler-assigned
/// filenames are eligible for that one-way adoption; unknown entries are never claimed.
pub fn ensure_directory(paths: &Paths, dir: &Path, kind: &str, legacy_names: &[String]) -> Result<()> {
    check_root(paths)?;
    check_path(dir)?;
    if !dir.starts_with(&paths.data_dir) || dir == paths.data_dir {
        return Err(invalid());
    }
    if dir.exists() && !dir.is_dir() {
        return Err(invalid());
    }
    fs::create_dir_all(dir)?;
    if marker_matches(dir, kind)? {
        return Ok(());
    }
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if !legacy_names.contains(&name) || regular_file(&entry.path())?.is_none() {
            return Err(invalid());
        }
    }
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(dir.join(".cloudlink.json"))?;
    file.write_all(serde_json::to_string(&serde_json::json!({"managedBy":"cloudlink", "kind":kind}))?.as_bytes())?;
    file.write_all(b"\n")?;
    file.sync_all()?;
    Ok(())
}

fn basename(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 255
        && !name.contains(['/', '\\', ':'])
        && !name.chars().any(char::is_control)
        && matches!(
            Path::new(name).components().collect::<Vec<_>>().as_slice(),
            [Component::Normal(_)]
        )
}

pub fn claim_path(dir: &Path, claim: &IngestClaim) -> Result<PathBuf> {
    let prefix = match claim.kind.as_str() {
        "note" => ".cloudlink-note-",
        "operation" => ".cloudlink-log-",
        _ => return Err(invalid()),
    };
    let suffix = if claim.kind == "note" { ".md" } else { ".jsonl" };
    if claim.id.len() != 26
        || !claim.id.bytes().all(|b| b.is_ascii_alphanumeric())
        || claim.file_name != format!("{prefix}{}{suffix}", claim.id)
        || !basename(&claim.source_name)
        || claim.byte_offset > MAX_FILE_BYTES
    {
        return Err(invalid());
    }
    let path = dir.join(&claim.file_name);
    check_path(&path)?;
    Ok(path)
}

pub fn claim_source(
    dir: &Path,
    db: &Db,
    kind: &str,
    source_name: &str,
    asset_id: Option<&str>,
    now: &str,
) -> Result<Option<IngestClaim>> {
    if !basename(source_name) {
        return Err(invalid());
    }
    let source = dir.join(source_name);
    let Some(meta) = regular_file(&source)? else {
        return Ok(None);
    };
    // An unbounded agent-written file is kept untouched rather than loaded into memory.
    if meta.len() > MAX_FILE_BYTES {
        return Ok(None);
    }
    let id = ulid::Ulid::generate().to_string();
    let (prefix, suffix) = if kind == "note" {
        (".cloudlink-note-", ".md")
    } else {
        (".cloudlink-log-", ".jsonl")
    };
    let claim = IngestClaim {
        file_name: format!("{prefix}{id}{suffix}"),
        id,
        kind: kind.into(),
        source_name: source_name.into(),
        asset_id: asset_id.map(String::from),
        byte_offset: 0,
        private_key: false,
        at: now.into(),
    };
    let destination = claim_path(dir, &claim)?;
    if regular_file(&destination)?.is_some() {
        return Err(invalid());
    }
    // Register before the rename. Recovery can distinguish our files from lookalike filenames.
    db.create_ingest_claim(&claim)?;
    if let Err(e) = fs::rename(&source, &destination) {
        db.finish_ingest_claim(&claim.id)?;
        if e.kind() == std::io::ErrorKind::NotFound || file_busy(&e) {
            return Ok(None);
        }
        return Err(e.into());
    }
    Ok(Some(claim))
}

pub fn recover_claim(dir: &Path, db: &Db, claim: &IngestClaim) -> Result<bool> {
    let file = claim_path(dir, claim)?;
    if regular_file(&file)?.is_some() {
        return Ok(true);
    }
    if claim.byte_offset == 0 {
        let source = dir.join(&claim.source_name);
        if regular_file(&source)?.is_some() {
            if let Err(error) = fs::rename(&source, file) {
                if file_busy(&error) {
                    return Ok(false);
                }
                return Err(error.into());
            }
            return Ok(true);
        }
    }
    // A process may have exited after deleting an exhausted file but before clearing its receipt.
    db.finish_ingest_claim(&claim.id)?;
    Ok(false)
}

pub struct Line {
    pub bytes: Vec<u8>,
    pub len: u64,
    pub oversized: bool,
    pub newline: bool,
}

pub fn bounded_line(reader: &mut impl BufRead) -> std::io::Result<Line> {
    let mut out = Line {
        bytes: Vec::new(),
        len: 0,
        oversized: false,
        newline: false,
    };
    loop {
        let available = reader.fill_buf()?;
        if available.is_empty() {
            break;
        }
        let take = available
            .iter()
            .position(|b| *b == b'\n')
            .map_or(available.len(), |i| i + 1);
        out.newline = available.get(take - 1) == Some(&b'\n');
        out.len += take as u64;
        if out.bytes.len() + take <= MAX_LINE_BYTES && !out.oversized {
            out.bytes.extend_from_slice(&available[..take]);
        } else {
            out.oversized = true;
            out.bytes.clear();
        }
        reader.consume(take);
        if out.newline || out.len > MAX_FILE_BYTES {
            break;
        }
    }
    Ok(out)
}

pub fn finish_if_exhausted(dir: &Path, db: &Db, claim: &IngestClaim) -> Result<()> {
    let path = claim_path(dir, claim)?;
    if let Some(meta) = regular_file(&path)?
        && meta.len() == claim.byte_offset
    {
        fs::remove_file(&path)?;
        db.finish_ingest_claim(&claim.id)?;
    }
    Ok(())
}

/// Return exactly the reserved source files and recorded claims, after a complete preflight.
pub fn cleanup_paths(
    paths: &Paths,
    dir: &Path,
    marker_kind: &str,
    names: &[String],
    claims: &[IngestClaim],
) -> Result<Vec<PathBuf>> {
    check_root(paths)?;
    check_path(dir)?;
    if !dir.exists() {
        return Ok(Vec::new());
    }
    if !dir.is_dir() {
        return Err(invalid());
    }
    let owns_dir = marker_matches(dir, marker_kind)?;
    let mut candidates = Vec::new();
    for name in names {
        if !basename(name) {
            return Err(invalid());
        }
        let file = dir.join(name);
        if regular_file(&file)?.is_some() {
            candidates.push(file);
        }
    }
    for claim in claims {
        let file = claim_path(dir, claim)?;
        if regular_file(&file)?.is_some() {
            candidates.push(file);
        }
    }
    // Root ownership authorizes legacy compiler-assigned inbox names too. Operations are only
    // written by the new sidecar and must always have their own marker.
    if !owns_dir && marker_kind != "inbox" && !candidates.is_empty() {
        return Err(invalid());
    }
    candidates.sort();
    candidates.dedup();
    Ok(candidates)
}

pub fn remove_files(paths: &Paths, dir: &Path, marker_kind: &str, files: &[PathBuf]) -> Result<()> {
    check_root(paths)?;
    for file in files {
        if file.parent() != Some(dir) {
            return Err(invalid());
        }
        if regular_file(file)?.is_some() {
            fs::remove_file(file)?;
        }
    }
    if !dir.exists() {
        return Ok(());
    }
    check_path(dir)?;
    let remaining = fs::read_dir(dir)?.collect::<std::io::Result<Vec<_>>>()?;
    if remaining.len() == 1 && remaining[0].file_name() == ".cloudlink.json" && marker_matches(dir, marker_kind)? {
        fs::remove_file(dir.join(".cloudlink.json"))?;
    }
    if fs::read_dir(dir)?.next().is_none() {
        fs::remove_dir(dir)?;
    }
    Ok(())
}

pub fn open_claim(dir: &Path, claim: &IngestClaim) -> Result<Option<File>> {
    let path = claim_path(dir, claim)?;
    let Some(meta) = regular_file(&path)? else {
        return Ok(None);
    };
    if meta.len() > MAX_FILE_BYTES || meta.len() < claim.byte_offset {
        return Ok(None);
    }
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        // An existing append handle must finish first. Keep this read handle alive through
        // deletion, which SHARE_DELETE permits while any concurrent write access stays denied.
        options.share_mode(0x0000_0004);
    }
    match options.open(path) {
        Ok(file) => Ok(Some(file)),
        Err(e) if file_busy(&e) => Ok(None),
        Err(e) => Err(e.into()),
    }
}
