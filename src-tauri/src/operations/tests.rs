use std::fs::{self, OpenOptions};
use std::io::Write;

use super::*;
use crate::model::guard::{GuardReasonId, OperationQuery};
use crate::model::misc::ActivityQuery;

fn setup() -> (tempfile::TempDir, Paths, Db, i64) {
    let temp = tempfile::tempdir().unwrap();
    let paths = Paths::isolated_in(temp.path());
    fs::create_dir_all(log_dir(&paths)).unwrap();
    fs::write(
        paths.data_dir.join(".cloudlink.json"),
        r#"{"managedBy":"cloudlink","kind":"data"}"#,
    )
    .unwrap();
    fs::write(
        log_dir(&paths).join(".cloudlink.json"),
        r#"{"managedBy":"cloudlink","kind":"operation-log"}"#,
    )
    .unwrap();
    let db = Db::open_in_memory().unwrap();
    db.upsert_asset(&Asset::Vps(crate::testkit::hk_edge())).unwrap();
    let now = time::parse_rfc3339("2026-11-04T12:00:00Z").unwrap();
    (temp, paths, db, now)
}

fn operation(id: &str, at: &str) -> Operation {
    Operation {
        id: id.into(),
        asset_id: crate::testkit::hk_edge().id,
        env_id: EnvId::windows(),
        at: at.into(),
        session_id: "session_1".into(),
        cwd: "D:/project".into(),
        command: "ssh hk-edge uptime".into(),
        decision: OperationDecision::Allowed,
        reason_id: None,
    }
}

fn append(paths: &Paths, op: &Operation) {
    let path = log_dir(paths).join("2026-11-04.jsonl");
    let mut file = OpenOptions::new().create(true).append(true).open(path).unwrap();
    writeln!(file, "{}", serde_json::to_string(op).unwrap()).unwrap();
}

fn all(db: &Db) -> Vec<Operation> {
    db.list_operations(&OperationQuery {
        asset_id: None,
        before: None,
        limit: 10_000,
    })
    .unwrap()
}

fn activity(db: &Db) -> Vec<ActivityItem> {
    db.list_activity(&ActivityQuery {
        asset_id: None,
        before: None,
        limit: 10_000,
        kinds: None,
    })
    .unwrap()
}

#[test]
fn operation_and_activity_are_imported_once_and_both_are_fully_redacted() {
    let (_temp, paths, db, now) = setup();
    let mut op = operation("op_redacted", &time::format_rfc3339(now));
    op.command = "ssh hk-edge 'echo password=do-not-persist token=also-secret'".into();
    op.cwd = "D:/project/password=badpath".into();
    op.session_id = "token=bad-session".into();
    op.decision = OperationDecision::Denied;
    op.reason_id = Some(GuardReasonId::CredentialRead);
    append(&paths, &op);
    append(&paths, &op);
    let result = ingest(&paths, &db, &[EnvId::windows()], now).unwrap();
    assert_eq!(result[0].count, 1);
    assert_eq!(result[0].denied, 1);
    assert_eq!(result[0].activity.len(), 1);
    assert_eq!(all(&db).len(), 1);
    assert_eq!(activity(&db).len(), 1);
    let encoded = serde_json::to_string(&(all(&db), activity(&db))).unwrap();
    for secret in ["do-not-persist", "also-secret", "badpath", "bad-session"] {
        assert!(!encoded.contains(secret), "{secret} must not persist");
    }
    assert!(encoded.contains("[已隐藏]"));
    assert_eq!(denied_today(&db, &EnvId::windows(), now).unwrap(), 1);
    assert!(ingest(&paths, &db, &[EnvId::windows()], now).unwrap().is_empty());
    assert!(db.ingest_claims("operation").unwrap().is_empty());
}

#[test]
fn full_redaction_cleans_more_than_eight_secrets_and_whole_private_key() {
    let input = (0..20).map(|i| format!("password=credential{i} ")).collect::<String>();
    let cleaned = redact_text(&input);
    assert!(!cleaned.contains("credential"));
    assert_eq!(cleaned.matches("[已隐藏]").count(), 20);
    assert_eq!(
        redact_text("before -----BEGIN PRIVATE KEY-----\nBASE64SECRET\n-----END PRIVATE KEY----- after"),
        "before [已隐藏] after"
    );
    assert_eq!(
        redact_text("-----BEGIN OPENSSH PRIVATE KEY-----\\nBASE64SECRET"),
        "[已隐藏]"
    );
    assert_eq!(redact_text("password=[REDACTED]"), "password=[已隐藏]");
}

#[test]
fn rejects_unknown_resource_environment_dates_and_oversized_metadata() {
    let (_temp, paths, db, now) = setup();
    for (index, key, value) in [
        (0, "assetId", serde_json::json!("unmanaged")),
        (1, "envId", serde_json::json!("wsl:Unknown")),
        (2, "at", serde_json::json!("2026-11-04T29:10:00Z")),
        (3, "at", serde_json::json!("2026-02-30T12:00:00Z")),
        (4, "at", serde_json::json!("2026-11-05T12:00:00Z")),
        (5, "cwd", serde_json::json!("x".repeat(5000))),
        (6, "id", serde_json::json!("op_../../escape")),
    ] {
        let mut op =
            serde_json::to_value(operation(&format!("op_invalid{index}"), &time::format_rfc3339(now))).unwrap();
        op[key] = value;
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(log_dir(&paths).join("2026-11-04.jsonl"))
            .unwrap();
        writeln!(file, "{op}").unwrap();
    }
    assert!(ingest(&paths, &db, &[EnvId::windows()], now).unwrap().is_empty());
    assert!(all(&db).is_empty());
    assert!(activity(&db).is_empty());
}

#[test]
fn thirty_day_retention_prunes_both_existing_tables_and_old_incoming_rows() {
    let (_temp, paths, db, now) = setup();
    let old = operation("op_old", &time::format_rfc3339(now - RETENTION_SECS - 1));
    db.add_operation(&old).unwrap();
    db.add_activity(&ActivityItem {
        id: "act_old".into(),
        kind: ActivityKind::AgentOp,
        at: old.at.clone(),
        asset_id: Some(old.asset_id.clone()),
        message_id: ActivityMessageId::AgentOpAllowed,
        params: None,
        duration_ms: None,
        detail: None,
        ok: true,
    })
    .unwrap();
    append(&paths, &old);
    let kept = operation("op_boundary", &time::format_rfc3339(now - RETENTION_SECS));
    append(&paths, &kept);
    ingest(&paths, &db, &[EnvId::windows()], now).unwrap();
    assert_eq!(all(&db), [kept]);
    assert_eq!(activity(&db).len(), 1);
    assert_eq!(activity(&db)[0].id, "act_op_boundary");
}

#[test]
fn partial_final_record_is_preserved_and_old_open_writer_can_finish_it() {
    let (_temp, paths, db, now) = setup();
    let op = operation("op_partial", &time::format_rfc3339(now));
    let encoded = serde_json::to_string(&op).unwrap();
    let half = encoded.len() / 2;
    fs::write(log_dir(&paths).join("2026-11-04.jsonl"), &encoded[..half]).unwrap();
    assert!(ingest(&paths, &db, &[EnvId::windows()], now).unwrap().is_empty());
    let claims = db.ingest_claims("operation").unwrap();
    assert_eq!(claims.len(), 1);
    assert_eq!(claims[0].byte_offset, 0);
    let path = io::claim_path(&log_dir(&paths), &claims[0]).unwrap();
    let mut file = OpenOptions::new().append(true).open(path).unwrap();
    writeln!(file, "{}", &encoded[half..]).unwrap();
    drop(file);
    append(&paths, &operation("op_new_file", &time::format_rfc3339(now)));
    assert_eq!(ingest(&paths, &db, &[EnvId::windows()], now).unwrap()[0].count, 2);
    assert_eq!(all(&db).len(), 2);
}

#[test]
fn large_logs_are_streamed_past_eight_mebibytes_without_allocating_the_line() {
    let (_temp, paths, db, now) = setup();
    let path = log_dir(&paths).join("2026-11-04.jsonl");
    let mut file = fs::File::create(path).unwrap();
    let chunk = [b'x'; 4096];
    for _ in 0..2304 {
        file.write_all(&chunk).unwrap();
    }
    file.write_all(b"\n").unwrap();
    drop(file);
    append(&paths, &operation("op_after_large_line", &time::format_rfc3339(now)));
    assert_eq!(ingest(&paths, &db, &[EnvId::windows()], now).unwrap()[0].count, 1);
    assert_eq!(all(&db)[0].id, "op_after_large_line");
}

#[test]
fn recent_queries_return_fifty_and_complete_activity_can_filter_resources() {
    let (_temp, paths, db, now) = setup();
    for i in 0..60 {
        append(
            &paths,
            &operation(&format!("op_{i:03}"), &time::format_rfc3339(now - i)),
        );
    }
    ingest(&paths, &db, &[EnvId::windows()], now).unwrap();
    let query = OperationQuery {
        asset_id: Some(crate::testkit::hk_edge().id),
        before: None,
        limit: 50,
    };
    let recent = db.list_operations(&query).unwrap();
    assert_eq!(recent.len(), 50);
    assert_eq!(recent[0].id, "op_000");
    assert_eq!(recent[49].id, "op_049");
    assert_eq!(activity(&db).len(), 60);
}

#[test]
fn cleanup_only_removes_dated_logs_and_recorded_claims_without_parent_marker() {
    let (_temp, paths, db, now) = setup();
    append(&paths, &operation("op_cleanup", &time::format_rfc3339(now)));
    fs::write(log_dir(&paths).join("personal.txt"), "user content").unwrap();
    let fake = log_dir(&paths).join(".cloudlink-log-00000000000000000000000000.jsonl");
    fs::write(&fake, "foreign claim").unwrap();
    let invalid_date = log_dir(&paths).join("2026-02-30.jsonl");
    fs::write(&invalid_date, "foreign dated file").unwrap();
    preflight_cleanup(&paths, &db).unwrap();
    cleanup(&paths, &db).unwrap();
    assert_eq!(
        fs::read_to_string(log_dir(&paths).join("personal.txt")).unwrap(),
        "user content"
    );
    assert_eq!(fs::read_to_string(fake).unwrap(), "foreign claim");
    assert_eq!(fs::read_to_string(invalid_date).unwrap(), "foreign dated file");
    assert!(!log_dir(&paths).join("2026-11-04.jsonl").exists());
}

#[test]
fn missing_or_foreign_ownership_never_claims_a_log() {
    let (_temp, paths, db, now) = setup();
    append(&paths, &operation("op_untouched", &time::format_rfc3339(now)));
    fs::write(
        log_dir(&paths).join(".cloudlink.json"),
        r#"{"managedBy":"other","kind":"operation-log"}"#,
    )
    .unwrap();
    assert!(ingest(&paths, &db, &[EnvId::windows()], now).is_err());
    assert!(cleanup(&paths, &db).is_err());
    assert!(log_dir(&paths).join("2026-11-04.jsonl").exists());
}

#[cfg(windows)]
#[test]
fn an_open_sidecar_writer_prevents_early_import_and_deletion_after_rename() {
    let (_temp, paths, db, now) = setup();
    let encoded = serde_json::to_string(&operation("op_open_writer", &time::format_rfc3339(now))).unwrap();
    let half = encoded.len() / 2;
    let mut writer = OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_dir(&paths).join("2026-11-04.jsonl"))
        .unwrap();
    writer.write_all(&encoded.as_bytes()[..half]).unwrap();
    assert!(ingest(&paths, &db, &[EnvId::windows()], now).unwrap().is_empty());
    writer.write_all(&encoded.as_bytes()[half..]).unwrap();
    writer.write_all(b"\n").unwrap();
    drop(writer);
    assert_eq!(ingest(&paths, &db, &[EnvId::windows()], now).unwrap()[0].count, 1);
    assert_eq!(all(&db)[0].id, "op_open_writer");
}
