//! F-308: one shared, explicitly reviewed inbox. Raw agent text never becomes a Skill until
//! a validated merge commits; secrets are hidden before persistence and still require editing.

pub(crate) mod io;

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::io::{BufReader, Seek, SeekFrom};
use std::path::PathBuf;

use crate::compile::{lint, render, secrets::Scanner};
use crate::db::Db;
use crate::error::{AppError, Result};
use crate::model::asset::Asset;
use crate::model::misc::IpcErrorId;
use crate::model::notes::{AgentNote, AgentNoteFlag, AgentNoteStatus};
use crate::paths::Paths;
use crate::time;

#[derive(Debug, Clone, Default)]
pub struct ImportCount {
    pub asset_id: String,
    pub count: u32,
}

fn source_names(assets: &[Asset]) -> BTreeMap<String, String> {
    render::detail_names(&assets.iter().collect::<Vec<_>>())
        .into_iter()
        .map(|(id, name)| (id, format!("{name}.md")))
        .collect()
}

pub fn prepare(paths: &Paths, assets: &[Asset]) -> Result<()> {
    let names = source_names(assets);
    let dir = paths.inbox_dir();
    io::ensure_directory(paths, &dir, "inbox", &names.values().cloned().collect::<Vec<_>>())?;
    let marker_path = dir.join(".cloudlink.json");
    let mut marker: serde_json::Value = serde_json::from_slice(&fs::read(&marker_path)?)?;
    let mut sources = registered_sources(paths)?;
    for (id, name) in names {
        let old = sources.get(&name);
        // Existing bytes still belong to the previous owner even if an alias has been reused.
        if old.is_none() || old != Some(&id) && io::regular_file(&dir.join(&name))?.is_none() {
            sources.insert(name, id);
        }
    }
    if sources.len() > 2048 || sources.keys().any(|name| name.len() > 255) {
        return Err(AppError::ipc(IpcErrorId::SettingsInvalid));
    }
    let sources = serde_json::to_value(sources)?;
    if marker.get("sources") != Some(&sources) {
        marker["sources"] = sources;
        let encoded = serde_json::to_vec(&marker)?;
        if encoded.len() > 256 * 1024 {
            return Err(AppError::ipc(IpcErrorId::SettingsInvalid));
        }
        crate::fsx::write_atomic(&marker_path, &encoded)?;
    }
    Ok(())
}

fn registered_sources(paths: &Paths) -> Result<BTreeMap<String, String>> {
    let path = paths.inbox_dir().join(".cloudlink.json");
    match io::regular_file(&path)? {
        None => return Ok(BTreeMap::new()),
        Some(meta) if meta.len() > 256 * 1024 => return Err(AppError::ipc(IpcErrorId::SettingsInvalid)),
        Some(_) => {}
    }
    let marker: serde_json::Value = serde_json::from_slice(&fs::read(path)?)?;
    let sources: BTreeMap<String, String> = marker
        .get("sources")
        .map(|value| serde_json::from_value(value.clone()))
        .transpose()?
        .unwrap_or_default();
    if sources.len() > 2048
        || sources.iter().any(|(name, id)| {
            name.len() > 255
                || !name.strip_suffix(".md").is_some_and(|stem| {
                    !stem.is_empty()
                        && stem
                            .bytes()
                            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
                })
                || id.is_empty()
                || id.len() > 128
                || !id
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-'))
        })
    {
        return Err(AppError::ipc(IpcErrorId::SettingsInvalid));
    }
    Ok(sources)
}

fn note_flags(text: &str) -> Vec<AgentNoteFlag> {
    let mut flags = Vec::new();
    if !Scanner::get().scan(text).is_empty() {
        flags.push(AgentNoteFlag::Secret);
    }
    if lint::looks_like_injection(text) {
        flags.push(AgentNoteFlag::Injection);
    }
    flags
}

fn parse_note(asset_id: &str, raw: &str, now: i64) -> Option<AgentNote> {
    let clean: String = raw.trim().chars().filter(|c| !c.is_control()).collect();
    let line = clean.strip_prefix("- ").unwrap_or(&clean).trim();
    if line.is_empty() || line.starts_with("-----END ") && line.contains("PRIVATE KEY") {
        return None;
    }
    let date = line.get(..10).filter(|s| {
        time::parse_rfc3339(s).is_some_and(|t| time::format_date(t) == *s) && line.as_bytes().get(10) == Some(&b':')
    });
    let (written_at, text) = match date {
        Some(date) => (format!("{date}T00:00:00Z"), line[11..].trim()),
        None => (time::format_rfc3339(now), line),
    };
    if text.is_empty() {
        return None;
    }
    let flags = note_flags(text);
    let text = crate::operations::redact_text(text).chars().take(500).collect();
    Some(AgentNote {
        id: crate::new_id("note"),
        asset_id: asset_id.into(),
        text,
        written_at,
        flags,
        status: AgentNoteStatus::Pending,
    })
}

/// Caller serializes imports and resource edits. Files are renamed before reading; the
/// persisted cursor advances only with the note insertion, including the 100-note limit.
pub fn ingest(paths: &Paths, db: &Db, now_secs: i64) -> Result<Vec<ImportCount>> {
    let assets = db.list_assets()?;
    prepare(paths, &assets)?;
    let names = source_names(&assets);
    let sources = registered_sources(paths)?;
    let dir = paths.inbox_dir();
    let existing = db.ingest_claims("note")?;
    for claim in &existing {
        // If the asset was removed, never capture a new file using its former handle.
        if claim.asset_id.as_deref().is_none_or(|id| !names.contains_key(id))
            && io::regular_file(&io::claim_path(&dir, claim)?)?.is_none()
        {
            db.finish_ingest_claim(&claim.id)?;
            continue;
        }
        io::recover_claim(&dir, db, claim)?;
    }
    let mut count = db.ingest_claims("note")?.len();
    for (name, asset_id) in &sources {
        if count >= io::MAX_CLAIMS {
            break;
        }
        if io::claim_source(&dir, db, "note", name, Some(asset_id), &time::format_rfc3339(now_secs))?.is_some() {
            count += 1;
        }
    }
    let mut totals = BTreeMap::<String, u32>::new();
    let mut lines = 0;
    let mut bytes_read = 0;
    for mut claim in db.ingest_claims("note")?.into_iter().take(io::MAX_CLAIMS) {
        let Some(mut file) = io::open_claim(&dir, &claim)? else {
            continue;
        };
        file.seek(SeekFrom::Start(claim.byte_offset))?;
        let mut reader = BufReader::new(file);
        while lines < io::MAX_LINES && bytes_read < io::MAX_SCAN_BYTES {
            let line = io::bounded_line(&mut reader)?;
            if line.len == 0 {
                break;
            }
            lines += 1;
            bytes_read += line.len;
            let end = claim.byte_offset + line.len;
            let raw = (!line.oversized)
                .then(|| std::str::from_utf8(&line.bytes).ok())
                .flatten();
            let has_header = raw.is_some_and(|s| s.contains("-----BEGIN ") && s.contains("PRIVATE KEY"));
            let has_footer = raw.is_some_and(|s| s.contains("-----END ") && s.contains("PRIVATE KEY"));
            let private_key = (claim.private_key || has_header) && !has_footer;
            let note = if claim.private_key {
                None
            } else {
                raw.and_then(|raw| {
                    claim
                        .asset_id
                        .as_deref()
                        .filter(|id| names.contains_key(*id))
                        .and_then(|id| parse_note(id, raw, now_secs))
                })
            };
            if !db.import_note_line(&claim, end, note.as_ref(), private_key)? {
                break;
            }
            claim.byte_offset = end;
            claim.private_key = private_key;
            if let Some(note) = note {
                *totals.entry(note.asset_id).or_default() += 1;
            }
        }
        io::finish_if_exhausted(&dir, db, &claim)?;
        drop(reader);
        if lines >= io::MAX_LINES || bytes_read >= io::MAX_SCAN_BYTES {
            break;
        }
    }
    // Source files exhausted above can now be assigned to a resource that reused their handle.
    prepare(paths, &assets)?;
    Ok(totals
        .into_iter()
        .map(|(asset_id, count)| ImportCount { asset_id, count })
        .collect())
}

fn validate_ids<'a>(ids: impl IntoIterator<Item = &'a str>) -> Result<()> {
    let mut seen = BTreeSet::new();
    for id in ids {
        if id.is_empty() || id.len() > 128 || !seen.insert(id) || seen.len() > 100 {
            return Err(AppError::ipc(IpcErrorId::SettingsInvalid));
        }
    }
    if seen.is_empty() {
        return Err(AppError::ipc(IpcErrorId::SettingsInvalid));
    }
    Ok(())
}

/// The UI merges notes for one resource at a time (SaveResult contains one Asset).
/// Validate the whole batch first, then save that resource and statuses in one transaction.
pub fn merge(db: &Db, items: &[(String, Option<String>)], now_secs: i64) -> Result<Vec<Asset>> {
    validate_ids(items.iter().map(|(id, _)| id.as_str()))?;
    let mut edited = Vec::new();
    let mut asset_id: Option<String> = None;
    for (id, text) in items {
        let mut note = db.get_note(id)?.ok_or_else(|| AppError::ipc(IpcErrorId::NotFound))?;
        if note.status != AgentNoteStatus::Pending {
            return Err(AppError::ipc(IpcErrorId::NotFound));
        }
        if asset_id.as_ref().is_some_and(|asset_id| asset_id != &note.asset_id) {
            return Err(AppError::ipc(IpcErrorId::SettingsInvalid));
        }
        asset_id = Some(note.asset_id.clone());
        if note.flags.contains(&AgentNoteFlag::Secret)
            && text.as_deref().is_none_or(|edited| edited.trim() == note.text.trim())
        {
            return Err(AppError::ipc(IpcErrorId::NoteHasSecret));
        }
        if let Some(text) = text {
            if text.trim().is_empty() || text.chars().count() > 500 || text.chars().any(char::is_control) {
                return Err(AppError::ipc(IpcErrorId::SettingsInvalid));
            }
            note.text = text.trim().to_string();
        }
        if note.text.trim().is_empty() || note.text.chars().count() > 500 || note.text.chars().any(char::is_control) {
            return Err(AppError::ipc(IpcErrorId::SettingsInvalid));
        }
        note.flags = note_flags(&note.text);
        if note.flags.contains(&AgentNoteFlag::Secret) {
            return Err(AppError::ipc(IpcErrorId::NoteHasSecret));
        }
        note.status = AgentNoteStatus::Merged;
        edited.push(note);
    }
    let before = db.require_asset(asset_id.as_deref().ok_or_else(|| AppError::ipc(IpcErrorId::NotFound))?)?;
    let mut after = before.clone();
    let (notes, updated_at) = match &mut after {
        Asset::Vps(asset) => (&mut asset.notes, &mut asset.updated_at),
        Asset::Cli(asset) => (&mut asset.notes, &mut asset.updated_at),
    };
    for note in &edited {
        if !notes.is_empty() && !notes.ends_with('\n') {
            notes.push('\n');
        }
        let date = time::format_date(time::parse_rfc3339(&note.written_at).unwrap_or(now_secs));
        notes.push_str(&format!("- {date}: {}", note.text));
    }
    *updated_at = time::format_rfc3339(now_secs);
    db.commit_notes_merge(&before, &after, &edited)?;
    Ok(vec![after])
}

pub fn dismiss(db: &Db, ids: &[String]) -> Result<Vec<ImportCount>> {
    validate_ids(ids.iter().map(String::as_str))?;
    let mut counts = BTreeMap::<String, u32>::new();
    for note in db.commit_notes_dismiss(ids)? {
        *counts.entry(note.asset_id).or_default() += 1;
    }
    Ok(counts
        .into_iter()
        .map(|(asset_id, count)| ImportCount { asset_id, count })
        .collect())
}

fn cleanup_inventory(paths: &Paths, db: &Db) -> Result<Vec<PathBuf>> {
    let claims = db.ingest_claims("note")?;
    let mut names = source_names(&db.list_assets()?).into_values().collect::<Vec<_>>();
    names.extend(registered_sources(paths)?.into_keys());
    names.extend(claims.iter().map(|claim| claim.source_name.clone()));
    io::cleanup_paths(paths, &paths.inbox_dir(), "inbox", &names, &claims)
}

pub fn preflight_cleanup(paths: &Paths, db: &Db) -> Result<()> {
    cleanup_inventory(paths, db).map(|_| ())
}

pub fn cleanup(paths: &Paths, db: &Db) -> Result<()> {
    let files = cleanup_inventory(paths, db)?;
    io::remove_files(paths, &paths.inbox_dir(), "inbox", &files)?;
    for claim in db.ingest_claims("note")? {
        db.finish_ingest_claim(&claim.id)?;
    }
    // Unknown user files keep the directory and its owner marker alive, but reset must not
    // retain the former resource IDs or aliases in that marker's private source registry.
    clear_source_registry(paths)?;
    Ok(())
}

fn clear_source_registry(paths: &Paths) -> Result<()> {
    io::check_root(paths)?;
    let path = paths.inbox_dir().join(".cloudlink.json");
    match io::regular_file(&path)? {
        None => return Ok(()),
        Some(meta) if meta.len() > 256 * 1024 => return Err(AppError::ipc(IpcErrorId::SettingsInvalid)),
        Some(_) => {}
    }
    let before = fs::read(&path)?;
    let mut marker: serde_json::Value = serde_json::from_slice(&before)?;
    if marker["managedBy"] != "cloudlink" || marker["kind"] != "inbox" {
        return Err(AppError::ipc(IpcErrorId::SettingsInvalid));
    }
    let empty = serde_json::json!({});
    if marker.get("sources").is_none_or(|sources| sources == &empty) {
        return Ok(());
    }
    marker["sources"] = empty;
    io::check_path(&path)?;
    if fs::read(&path)? != before {
        return Err(AppError::ipc(IpcErrorId::SettingsInvalid));
    }
    crate::fsx::write_atomic(&path, &serde_json::to_vec(&marker)?)?;
    Ok(())
}

#[cfg(test)]
mod tests;
