//! F-307: import only bounded, valid records for known resources/environments. The sidecar's
//! compact redaction is followed by the compiler's complete bundled secret rules before SQLite.

use std::collections::BTreeMap;
use std::fs;
use std::io::{BufReader, Seek, SeekFrom};
use std::path::PathBuf;
use std::sync::OnceLock;

use regex::Regex;

use crate::compile::secrets::Scanner;
use crate::db::Db;
use crate::error::Result;
use crate::model::asset::Asset;
use crate::model::env::EnvId;
use crate::model::guard::{Operation, OperationDecision};
use crate::model::misc::{ActivityItem, ActivityKind, ActivityMessageId};
use crate::notes::io;
use crate::paths::Paths;
use crate::{params, time};

pub const RETENTION_SECS: i64 = 30 * 86_400;

#[derive(Debug, Clone, Default)]
pub struct ImportCount {
    pub asset_id: String,
    pub count: u32,
    pub denied: u32,
    pub activity: Vec<ActivityItem>,
}

/// Replace complete private-key blocks before per-line scanning; hiding just a PEM header
/// would leave its base64 payload behind. If a line cannot be completely cleaned, hide it all.
pub fn redact_text(text: &str) -> String {
    static PRIVATE_BLOCK: OnceLock<Regex> = OnceLock::new();
    let blocks = PRIVATE_BLOCK.get_or_init(|| {
        Regex::new(
            r"(?s)-----BEGIN[ A-Z0-9_-]{0,100}PRIVATE KEY(?: BLOCK)?-----.*?(?:-----END[ A-Z0-9_-]{0,100}PRIVATE KEY(?: BLOCK)?-----|$)",
        )
        .expect("private block redaction pattern")
    });
    let protected = blocks.replace_all(text, "[已隐藏]").replace("[REDACTED]", "[已隐藏]");
    protected
        .split_inclusive('\n')
        .map(|segment| {
            let mut line = segment.to_string();
            for _ in 0..256 {
                let Some((_, range)) = Scanner::get().find_in_line(&line) else {
                    return line;
                };
                let previous = line.clone();
                line.replace_range(range, "[已隐藏]");
                if line == previous {
                    break;
                }
            }
            if Scanner::get().find_in_line(&line).is_some() {
                if line.ends_with('\n') {
                    "[已隐藏]\n".into()
                } else {
                    "[已隐藏]".into()
                }
            } else {
                line
            }
        })
        .collect()
}

fn date_filename(name: &str) -> bool {
    let Some(date) = name.strip_suffix(".jsonl") else {
        return false;
    };
    date.len() == 10 && time::parse_rfc3339(date).is_some_and(|t| time::format_date(t) == date)
}

fn log_dir(paths: &Paths) -> PathBuf {
    paths.data_dir.join("guard").join("log")
}

fn source_names(paths: &Paths) -> Result<Vec<String>> {
    let dir = log_dir(paths);
    io::check_path(&dir)?;
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut names = Vec::new();
    for entry in fs::read_dir(dir)? {
        let name = entry?.file_name().to_string_lossy().into_owned();
        if date_filename(&name) {
            names.push(name);
        }
    }
    names.sort();
    Ok(names)
}

fn clean_visible(text: &str, allow_newline: bool) -> String {
    redact_text(text)
        .chars()
        .filter(|c| !c.is_control() || allow_newline && matches!(c, '\n' | '\t'))
        .collect()
}

fn parse_operation(raw: &[u8], assets: &[Asset], envs: &[EnvId], now: i64) -> Option<(Operation, ActivityItem)> {
    let mut op: Operation = serde_json::from_slice(raw).ok()?;
    let asset = assets.iter().find(|asset| asset.id() == op.asset_id)?;
    let timestamp = time::parse_rfc3339(&op.at)?;
    if op.id.is_empty()
        || op.id.len() > 128
        || !op
            .id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-'))
        || op.at != time::format_rfc3339(timestamp)
        || timestamp < now - RETENTION_SECS
        || timestamp > now + 300
        || !envs.contains(&op.env_id)
        || op.command.is_empty()
        || op.command.len() > 64 * 1024
        || op.cwd.chars().count() > 4096
        || op.session_id.len() > 1024
    {
        return None;
    }
    op.command = clean_visible(&guard_rules::redact(&op.command), true);
    op.cwd = clean_visible(&guard_rules::redact(&op.cwd), false);
    op.session_id = clean_visible(&guard_rules::redact(&op.session_id), false);
    let allowed = op.decision == OperationDecision::Allowed;
    let mut summary: String = op.command.chars().take(60).collect();
    if op.command.chars().count() > 60 {
        summary = op.command.chars().take(59).chain(std::iter::once('…')).collect();
    }
    let reason = op
        .reason_id
        .and_then(|id| serde_json::to_value(id).ok())
        .and_then(|value| value.as_str().map(String::from))
        .unwrap_or_default();
    let activity = ActivityItem {
        id: format!("act_{}", op.id),
        kind: ActivityKind::AgentOp,
        at: op.at.clone(),
        asset_id: Some(op.asset_id.clone()),
        message_id: if allowed {
            ActivityMessageId::AgentOpAllowed
        } else {
            ActivityMessageId::AgentOpDenied
        },
        params: Some(
            params! {"alias" => clean_visible(asset.handle(), false), "command" => summary, "reason" => reason},
        ),
        duration_ms: None,
        detail: Some(format!("{}\ncwd: {}\nsession: {}", op.command, op.cwd, op.session_id)),
        ok: allowed,
    };
    Some((op, activity))
}

pub fn ingest(paths: &Paths, db: &Db, env_ids: &[EnvId], now_secs: i64) -> Result<Vec<ImportCount>> {
    io::check_root(paths)?;
    db.prune_before(&time::format_rfc3339(now_secs - RETENTION_SECS))?;
    let dir = log_dir(paths);
    io::check_path(&dir)?;
    if !dir.exists() {
        return Ok(Vec::new());
    }
    io::ensure_directory(paths, &dir, "operation-log", &[])?;
    let assets = db.list_assets()?;
    for claim in db.ingest_claims("operation")? {
        io::recover_claim(&dir, db, &claim)?;
    }
    let mut count = db.ingest_claims("operation")?.len();
    for name in source_names(paths)? {
        if count >= io::MAX_CLAIMS {
            break;
        }
        if io::claim_source(&dir, db, "operation", &name, None, &time::format_rfc3339(now_secs))?.is_some() {
            count += 1;
        }
    }
    let mut totals = BTreeMap::<String, ImportCount>::new();
    let mut lines = 0;
    let mut bytes_read = 0;
    for mut claim in db.ingest_claims("operation")?.into_iter().take(io::MAX_CLAIMS) {
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
            let record = (!line.oversized)
                .then(|| parse_operation(&line.bytes, &assets, env_ids, now_secs))
                .flatten();
            // A writer may have an open handle across rename; retain a partial final JSON record
            // for the next read instead of discarding the rest of a concurrently appended record.
            if record.is_none() && !line.newline && !line.oversized {
                break;
            }
            let end = claim.byte_offset + line.len;
            let inserted = db.import_operation_line(&claim, end, record.as_ref().map(|(o, a)| (o, a)))?;
            claim.byte_offset = end;
            if inserted && let Some((op, activity)) = record {
                let total = totals.entry(op.asset_id.clone()).or_insert_with(|| ImportCount {
                    asset_id: op.asset_id,
                    ..Default::default()
                });
                total.count += 1;
                total.denied += u32::from(op.decision == OperationDecision::Denied);
                total.activity.push(activity);
            }
        }
        io::finish_if_exhausted(&dir, db, &claim)?;
        drop(reader);
        if lines >= io::MAX_LINES || bytes_read >= io::MAX_SCAN_BYTES {
            break;
        }
    }
    Ok(totals.into_values().collect())
}

pub fn denied_today(db: &Db, env_id: &EnvId, now_secs: i64) -> Result<u32> {
    let (start, end) = time::local_day_bounds(now_secs);
    db.denied_operations_between(env_id, &time::format_rfc3339(start), &time::format_rfc3339(end))
}

fn cleanup_inventory(paths: &Paths, db: &Db) -> Result<Vec<PathBuf>> {
    let claims = db.ingest_claims("operation")?;
    let mut names = source_names(paths)?;
    names.extend(claims.iter().map(|claim| claim.source_name.clone()));
    io::cleanup_paths(paths, &log_dir(paths), "operation-log", &names, &claims)
}

pub fn preflight_cleanup(paths: &Paths, db: &Db) -> Result<()> {
    cleanup_inventory(paths, db).map(|_| ())
}

pub fn cleanup(paths: &Paths, db: &Db) -> Result<()> {
    let files = cleanup_inventory(paths, db)?;
    io::remove_files(paths, &log_dir(paths), "operation-log", &files)?;
    for claim in db.ingest_claims("operation")? {
        db.finish_ingest_claim(&claim.id)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests;
