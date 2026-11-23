use super::*;
use crate::model::asset::{Asset, Mode};
use crate::model::delivery::{AgentId, Target};
use crate::model::env::EnvId;
use crate::model::misc::{ActivityKind, ActivityMessageId};
use crate::testkit;

#[test]
fn migrates_to_current_schema_with_wal() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("data.db");
    let db = Db::open(&path).unwrap();
    assert_eq!(db.schema_version().unwrap(), SCHEMA_VERSION);
    assert_eq!(db.journal_mode().unwrap().to_lowercase(), "wal");
    drop(db);
    // 重开是幂等的
    let db = Db::open(&path).unwrap();
    assert_eq!(db.schema_version().unwrap(), SCHEMA_VERSION);
}

#[test]
fn real_use_migration_keeps_old_modes_conservative_in_assets_settings_and_probe_history() {
    let conn = rusqlite::Connection::open_in_memory().unwrap();
    for migration in &MIGRATIONS[..6] {
        conn.execute_batch(migration).unwrap();
    }
    conn.execute_batch("CREATE TABLE schema_version(version INTEGER NOT NULL); INSERT INTO schema_version VALUES(6);")
        .unwrap();
    for (index, mode) in ["read-only", "standard", "auto-ops"].iter().enumerate() {
        let mut asset = serde_json::to_value(Asset::Vps(testkit::hk_edge())).unwrap();
        let id = format!("legacy-{index}");
        asset["id"] = id.clone().into();
        asset["agent"]["mode"] = (*mode).into();
        let json = asset.to_string();
        conn.execute(
            "INSERT INTO assets(id,type,handle,created_at,json) VALUES(?1,'vps',?1,'2026-11-15',?2)",
            params![id, json],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO probe_snapshots(run_id,asset_id,at,json) VALUES(?1,?1,'2026-11-15',?2)",
            params![id, json],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO probe_results(run_id,after_json,merged_json) VALUES(?1,?2,?3)",
            params![id, json, serde_json::json!({"asset":asset}).to_string()],
        )
        .unwrap();
    }
    conn.execute(
        "INSERT INTO settings(key,json) VALUES('settings',?1)",
        [r#"{"defaultMode":"standard"}"#],
    )
    .unwrap();
    let db = Db::init(conn).unwrap();
    assert_eq!(db.schema_version().unwrap(), SCHEMA_VERSION);
    for index in 0..3 {
        let expected = if index < 2 { "confirm-changes" } else { "auto-ops" };
        let id = format!("legacy-{index}");
        for (table, column, path, key) in [
            ("assets", "json", "$.agent.mode", "id"),
            ("probe_snapshots", "json", "$.agent.mode", "run_id"),
            ("probe_results", "after_json", "$.agent.mode", "run_id"),
            ("probe_results", "merged_json", "$.asset.agent.mode", "run_id"),
        ] {
            let actual: String = db
                .conn
                .query_row(
                    &format!("SELECT json_extract({column},?1) FROM {table} WHERE {key}=?2"),
                    params![path, id],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(actual, expected, "{table}.{column}: {id}");
        }
    }
    let default: String = db
        .conn
        .query_row(
            "SELECT json_extract(json,'$.defaultMode') FROM settings WHERE key='settings'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(default, "confirm-changes");
    for old in ["read-only", "standard"] {
        assert_eq!(
            serde_json::from_value::<Mode>(old.into()).unwrap(),
            Mode::ConfirmChanges
        );
    }
}

#[test]
fn refuses_newer_schema() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("data.db");
    drop(Db::open(&path).unwrap());
    let conn = rusqlite::Connection::open(&path).unwrap();
    conn.execute("UPDATE schema_version SET version = 999", []).unwrap();
    drop(conn);
    assert!(Db::open(&path).is_err());
}

#[test]
fn assets_round_trip_and_aliases_are_unique_ignoring_case() {
    let db = Db::open_in_memory().unwrap();
    let hk = Asset::Vps(testkit::hk_edge());
    let cf = Asset::Cli(testkit::cloudflare());
    db.upsert_asset(&hk).unwrap();
    db.upsert_asset(&cf).unwrap();
    assert_eq!(db.list_assets().unwrap(), vec![hk.clone(), cf]);

    let mut dup = testkit::sg_db();
    dup.connection.ssh_alias = "HK-Edge".into();
    let err = db.upsert_asset(&Asset::Vps(dup)).unwrap_err();
    assert!(err.is_ipc(IpcErrorId::AliasTaken));
    assert!(db.handle_taken("hk-EDGE", None).unwrap());
    assert!(!db.handle_taken("hk-edge", Some(hk.id())).unwrap());

    // 更新同一条
    let mut changed = testkit::hk_edge();
    changed.agent.mode = Mode::AutoOps;
    db.upsert_asset(&Asset::Vps(changed.clone())).unwrap();
    assert_eq!(db.get_asset(&changed.id).unwrap(), Some(Asset::Vps(changed)));
    assert!(db.delete_asset(hk.id()).unwrap());
    assert!(db.require_asset(hk.id()).unwrap_err().is_ipc(IpcErrorId::NotFound));
}

#[test]
fn deleting_an_asset_cascades_to_inclusions_and_snapshots() {
    let mut db = Db::open_in_memory().unwrap();
    let hk = Asset::Vps(testkit::hk_edge());
    db.upsert_asset(&hk).unwrap();
    db.replace_inclusions(&[Inclusion {
        asset_id: hk.id().into(),
        env_id: EnvId::windows(),
        agent_key: "claude-code".into(),
        included: true,
        reason: None,
    }])
    .unwrap();
    db.put_probe_snapshot("prb_1", hk.id(), testkit::NOW, &hk).unwrap();
    db.delete_asset(hk.id()).unwrap();
    assert!(db.list_inclusions().unwrap().is_empty());
    assert!(db.take_probe_snapshot("prb_1").unwrap().is_none());
}

#[test]
fn only_the_latest_probe_snapshot_is_kept() {
    let db = Db::open_in_memory().unwrap();
    let hk = Asset::Vps(testkit::hk_edge());
    db.upsert_asset(&hk).unwrap();
    db.put_probe_snapshot("prb_1", hk.id(), testkit::NOW, &hk).unwrap();
    db.put_probe_snapshot("prb_2", hk.id(), testkit::NOW, &hk).unwrap();
    assert!(db.take_probe_snapshot("prb_1").unwrap().is_none());
    assert_eq!(db.take_probe_snapshot("prb_2").unwrap(), Some(hk));
}

#[test]
fn targets_deliveries_and_settings() {
    let db = Db::open_in_memory().unwrap();
    let t = Target {
        id: "tgt_1".into(),
        env_id: EnvId::windows(),
        agent: AgentId::ClaudeCode,
        agent_key: "claude-code".into(),
        label: "Claude Code".into(),
        path: r"C:\Users\me\.claude\skills".into(),
        enabled: true,
        detected: true,
    };
    db.upsert_target(&t).unwrap();
    let d = Delivery {
        id: "dlv_1".into(),
        target_id: t.id.clone(),
        env_id: EnvId::windows(),
        path: r"C:\Users\me\.claude\skills\cloudlink-servers".into(),
        status: crate::model::delivery::DeliveryStatus::Ok,
        status_detail: None,
        checked_at: testkit::NOW.into(),
        unit_id: None,
        shared_agent_keys: None,
        asset_ids: None,
    };
    db.upsert_delivery(&d).unwrap();
    assert_eq!(db.list_targets().unwrap(), vec![t.clone()]);
    assert_eq!(db.list_deliveries().unwrap(), vec![d]);
    db.delete_target(&t.id).unwrap();
    assert!(
        db.list_deliveries().unwrap().is_empty(),
        "deliveries follow their target"
    );

    assert!(db.get_settings().unwrap().is_none());
    let s = Settings::defaults("D:/x".into(), "D:/x/logs".into());
    db.put_settings(&s).unwrap();
    assert_eq!(db.get_settings().unwrap(), Some(s));
    assert_eq!(db.get_skill_config().unwrap(), SkillConfig::default());
    db.put_skill_config(&testkit::skill_config()).unwrap();
    assert_eq!(db.get_skill_config().unwrap(), testkit::skill_config());
}

#[test]
fn activity_is_paged_filtered_and_pruned() {
    let db = Db::open_in_memory().unwrap();
    for (i, kind) in [
        ActivityKind::Connection,
        ActivityKind::Compile,
        ActivityKind::Connection,
    ]
    .into_iter()
    .enumerate()
    {
        db.add_activity(&ActivityItem {
            id: format!("act_{i}"),
            kind,
            at: format!("2026-10-2{i}T00:00:00Z"),
            asset_id: Some("ast_1".into()),
            message_id: ActivityMessageId::TestOk,
            params: None,
            duration_ms: None,
            detail: None,
            ok: true,
        })
        .unwrap();
    }
    let all = db
        .list_activity(&ActivityQuery {
            before: None,
            limit: 10,
            kinds: None,
            asset_id: None,
        })
        .unwrap();
    assert_eq!(
        all.iter().map(|a| a.id.as_str()).collect::<Vec<_>>(),
        ["act_2", "act_1", "act_0"]
    );
    let conn = db
        .list_activity(&ActivityQuery {
            before: Some("2026-10-22T00:00:00Z".into()),
            limit: 10,
            kinds: Some(vec![ActivityKind::Connection]),
            asset_id: Some("ast_1".into()),
        })
        .unwrap();
    assert_eq!(conn.len(), 1);
    assert_eq!(db.prune_before("2026-10-21T12:00:00Z").unwrap(), 2);
}

#[test]
fn migration_v4_turns_update_checks_on_for_older_settings() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("data.db");
    let db = Db::open(&path).unwrap();
    let mut older = serde_json::to_value(Settings::defaults("D:/data".into(), "D:/data/logs".into())).unwrap();
    older.as_object_mut().unwrap().remove("autoCheckUpdates");
    db.put_kv(KEY_SETTINGS, &older).unwrap();
    db.conn.execute("UPDATE schema_version SET version = 3", []).unwrap();
    drop(db);

    let db = Db::open(&path).unwrap();
    assert_eq!(db.schema_version().unwrap(), SCHEMA_VERSION);
    let stored: serde_json::Value = db.get_kv(KEY_SETTINGS).unwrap().unwrap();
    assert_eq!(stored["autoCheckUpdates"], serde_json::Value::Bool(true));
    assert!(db.get_settings().unwrap().unwrap().auto_check_updates);

    // 用户关掉的开关在迁移后保持关闭
    let mut off = db.get_settings().unwrap().unwrap();
    off.auto_check_updates = false;
    db.put_settings(&off).unwrap();
    db.conn.execute("UPDATE schema_version SET version = 3", []).unwrap();
    drop(db);
    let db = Db::open(&path).unwrap();
    assert!(!db.get_settings().unwrap().unwrap().auto_check_updates);
}

#[test]
fn migration_v5_and_v9_clean_legacy_env_tag_and_production_fields() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("data.db");
    let db = Db::open(&path).unwrap();
    let hk = Asset::Vps(testkit::hk_edge());
    let dev = Asset::Vps(testkit::dev_box());
    db.upsert_asset(&hk).unwrap();
    db.upsert_asset(&dev).unwrap();
    // 回到 v4 的存储形状：envTag 三档，没有 production
    for (id, tag) in [(hk.id(), "prod"), (dev.id(), "staging")] {
        db.conn
            .execute(
                "UPDATE assets SET json = json_set(json_remove(json, '$.production'), '$.envTag', ?2) WHERE id = ?1",
                rusqlite::params![id, tag],
            )
            .unwrap();
    }
    db.conn.execute("UPDATE schema_version SET version = 4", []).unwrap();
    drop(db);

    let db = Db::open(&path).unwrap();
    assert_eq!(db.schema_version().unwrap(), SCHEMA_VERSION);
    for id in [hk.id(), dev.id()] {
        let raw: String = db
            .conn
            .query_row("SELECT json FROM assets WHERE id = ?1", [id], |r| r.get(0))
            .unwrap();
        assert!(!raw.contains("envTag"), "{raw}");
        assert!(!raw.contains("\"production\""), "{raw}");
        assert!(db.get_asset(id).unwrap().is_some());
    }
}

#[test]
fn migration_v9_removes_legacy_production_from_assets_and_probe_history() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("data.db");
    let db = Db::open(&path).unwrap();
    let hk = Asset::Vps(testkit::hk_edge());
    let cf = Asset::Cli(testkit::cloudflare());
    db.upsert_asset(&hk).unwrap();
    db.upsert_asset(&cf).unwrap();
    // 模拟 v8 历史数据：assets、probe_snapshots、probe_results 均带有 production 字段
    for id in [hk.id(), cf.id()] {
        db.conn
            .execute(
                "UPDATE assets SET json = json_set(json, '$.production', json('true')) WHERE id = ?1",
                [id],
            )
            .unwrap();
    }
    let legacy_hk: String = db
        .conn
        .query_row("SELECT json FROM assets WHERE id = ?1", [hk.id()], |r| r.get(0))
        .unwrap();
    assert!(legacy_hk.contains("\"production\":true"));
    let merged_legacy = format!(r#"{{"asset":{legacy_hk},"applied":[]}}"#);
    db.conn
        .execute(
            "INSERT INTO probe_snapshots (run_id, asset_id, at, json) VALUES ('prb_v8', ?1, '2026-11-20T00:00:00Z', ?2)",
            rusqlite::params![hk.id(), legacy_hk],
        )
        .unwrap();
    db.conn
        .execute(
            "INSERT INTO probe_results (run_id, after_json, merged_json) VALUES ('prb_v8', ?1, ?2)",
            rusqlite::params![legacy_hk, merged_legacy],
        )
        .unwrap();
    db.conn.execute("UPDATE schema_version SET version = 8", []).unwrap();
    drop(db);

    let db = Db::open(&path).unwrap();
    assert_eq!(db.schema_version().unwrap(), SCHEMA_VERSION);
    for id in [hk.id(), cf.id()] {
        let raw: String = db
            .conn
            .query_row("SELECT json FROM assets WHERE id = ?1", [id], |r| r.get(0))
            .unwrap();
        assert!(!raw.contains("\"production\""), "{raw}");
        assert!(db.get_asset(id).unwrap().is_some());
    }
    let snap: String = db
        .conn
        .query_row("SELECT json FROM probe_snapshots WHERE run_id = 'prb_v8'", [], |r| {
            r.get(0)
        })
        .unwrap();
    let (after_json, merged_json): (String, String) = db
        .conn
        .query_row(
            "SELECT after_json, merged_json FROM probe_results WHERE run_id = 'prb_v8'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert!(!snap.contains("\"production\""), "{snap}");
    assert!(!after_json.contains("\"production\""), "{after_json}");
    assert!(!merged_json.contains("\"production\""), "{merged_json}");
}

#[test]
fn migration_v8_keeps_existing_cloud_assets_conservatively_manual() {
    use crate::model::asset::{CloudScopeMode, CloudSnapshotStatus};
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("data.db");
    let db = Db::open(&path).unwrap();
    let mut cf = testkit::cloudflare();
    cf.cloud_scope = None;
    let gh = testkit::github();
    db.upsert_asset(&Asset::Cli(cf.clone())).unwrap();
    db.upsert_asset(&Asset::Cli(gh.clone())).unwrap();
    db.conn.execute("UPDATE schema_version SET version = 7", []).unwrap();
    drop(db);

    let db = Db::open(&path).unwrap();
    assert_eq!(db.schema_version().unwrap(), SCHEMA_VERSION);
    let migrated_cf = db.require_asset(&cf.id).unwrap();
    let cs = migrated_cf.as_cli().unwrap().cloud_scope.as_ref().unwrap();
    assert_eq!(cs.mode, CloudScopeMode::Manual);
    assert_eq!(cs.snapshot_status, CloudSnapshotStatus::Complete);
    assert_eq!(cs.revision, 1);
    assert!(cs.excluded_ids.is_empty());
    let mut selected = cs.selected_ids.clone();
    selected.sort();
    assert_eq!(selected, vec!["worker_1", "zone_1", "zone_3"]);
    let migrated_gh = db.require_asset(&gh.id).unwrap();
    assert!(migrated_gh.as_cli().unwrap().cloud_scope.is_none());
}
