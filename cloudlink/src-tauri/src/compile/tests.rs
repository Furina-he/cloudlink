use std::path::{Path, PathBuf};

use super::*;
use crate::model::asset::{Asset, FieldSource, Mode, Service, ServiceKind};
use crate::model::compile::{LintId, RelationNote};
use crate::testkit;
use crate::time;

fn now() -> i64 {
    time::parse_rfc3339(testkit::NOW).unwrap()
}

fn compile_with(assets: &[Asset], config: &SkillConfig) -> CompilePreview {
    let listed: Vec<&Asset> = assets.iter().collect();
    compile(&CompileInput {
        env_id: &EnvId::windows(),
        agent_key: "claude-code",
        assets: &listed,
        all_assets: assets,
        config,
        inbox: "C:/Users/me/.cloudlink/inbox",
        body_line_limit: 100,
        write_snapshot_time: true,
        now_secs: now(),
    })
}

fn golden_servers() -> Vec<Asset> {
    vec![
        Asset::Vps(testkit::hk_edge()),
        Asset::Vps(testkit::sg_db()),
        Asset::Vps(testkit::dev_box()),
    ]
}

fn golden_dir(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/golden")
        .join(name)
        .join("cloudlink-servers")
}

/// 与 `tests/golden/<name>/` 逐字节比对；设置 `CLOUDLINK_UPDATE_GOLDEN=1` 时改为重写黄金样例
fn assert_golden(name: &str, p: &CompilePreview) {
    let dir = golden_dir(name);
    if std::env::var_os("CLOUDLINK_UPDATE_GOLDEN").is_some() {
        let _ = std::fs::remove_dir_all(&dir);
        for f in &p.files {
            let path = dir.join(&f.path);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, &f.content).unwrap();
        }
    }
    let on_disk = publish::dir_hash(&dir).unwrap().expect("golden dir");
    for f in &p.files {
        let want = std::fs::read_to_string(dir.join(&f.path)).unwrap_or_else(|e| panic!("{}: {e}", f.path));
        assert_eq!(f.content, want, "{name}/{} differs from the golden file", f.path);
    }
    assert_eq!(
        publish::files_hash(&p.files),
        on_disk,
        "{name}: golden dir has extra or missing files"
    );
}

#[test]
fn golden_windows_servers() {
    let p = compile_with(&golden_servers(), &testkit::skill_config());
    assert!(p.lint.is_empty(), "{:#?}", p.lint);
    assert!(!p.blocked);
    assert_golden("windows-claude-code", &p);
}

#[test]
fn golden_with_cloud_platform() {
    let mut assets = golden_servers();
    assets.push(Asset::Cli(testkit::cloudflare()));
    let p = compile_with(&assets, &testkit::skill_config());
    assert!(p.lint.is_empty(), "{:#?}", p.lint);
    assert_golden("windows-claude-code-cli", &p);
}

/// F-110 AC1：只写开放的仓库，名称、默认分支、可见性；gh 没有按命令选账号的参数
#[test]
fn golden_with_github_lists_only_open_repositories() {
    let mut assets = golden_servers();
    assets.push(Asset::Cli(testkit::github()));
    let p = compile_with(&assets, &testkit::skill_config());
    assert!(p.lint.is_empty(), "{:#?}", p.lint);
    let github = p
        .files
        .iter()
        .find(|f| f.path.ends_with("github.md"))
        .expect("github file");
    assert!(github.content.contains("## Repositories"));
    assert!(github.content.contains("| `octo/shop-web` | `main` | private |"));
    assert!(!github.content.contains("octo/notes"));
    assert!(!github.content.contains("## Scope"));
    assert!(github.content.contains("never switch accounts"));
    assert_golden("windows-claude-code-github", &p);
}

#[test]
fn skill_md_structure_matches_prd() {
    let p = compile_with(&golden_servers(), &testkit::skill_config());
    let skill = &p.files[0].content;
    assert!(skill.starts_with(
        "---\nname: cloudlink-servers\ndescription: The user's servers and how to operate them — hk-edge ("
    ));
    // 只输出 name 和 description 两个 frontmatter 字段（5.1）
    let fm: Vec<&str> = skill.split("---\n").nth(1).unwrap().lines().collect();
    assert_eq!(fm.len(), 2);
    assert!(skill.contains("| `hk-edge` | Public reverse proxy for api.example.com and blog.example.com, and host for the backend API containers | production | read-only | `references/hk-edge.md` |"));
    assert!(skill.contains("5. Deploy with docker compose in /opt/apps/<name>; never edit containers by hand\n6. Tell the user before restarting anything on a production server\n"));
    assert!(skill.contains("`C:/Users/me/.cloudlink/inbox/<name>.md`"));
    assert!(!skill.contains("30 minutes"), "v3.1 removed the 30-minute unlock");
    let paths: Vec<&str> = p.files.iter().map(|f| f.path.as_str()).collect();
    assert_eq!(
        paths,
        [
            "SKILL.md",
            "references/hk-edge.md",
            "references/sg-db.md",
            "references/dev-box.md",
            "references/health-check.md"
        ]
    );
    let hk = &p.files[1].content;
    assert!(hk.contains("- System: Ubuntu 24.04 LTS | 2 vCPU / 2 GB RAM | managed by 1Panel (/opt/1panel)\n"));
    assert!(hk.contains("3. Never stop or restart the `openresty` container (critical)\n"));
    assert!(!hk.contains("203.0.113.10"), "IP is not exported by default");
    assert!(
        !hk.contains("0.0.0.0:22"),
        "listening ports are not exported by default"
    );
    assert_eq!(p.budget.description_limit, 1024);
}

#[test]
fn preview_and_publish_are_byte_identical() {
    let a = compile_with(&golden_servers(), &testkit::skill_config());
    let b = compile_with(&golden_servers(), &testkit::skill_config());
    assert_eq!(a.files, b.files);
    let root = tempfile::tempdir().unwrap();
    let marker = publish::Marker {
        managed_by: publish::MANAGED_BY.into(),
        env_id: "windows".into(),
        agent_key: "claude-code".into(),
        agent_keys: Vec::new(),
        content_hash: publish::files_hash(&a.files),
        compiled_at: testkit::NOW.into(),
        template_version: render::TEMPLATE_VERSION,
    };
    let dir = publish::publish(root.path(), &marker, &a.files).unwrap();
    for f in &a.files {
        assert_eq!(std::fs::read_to_string(dir.join(&f.path)).unwrap(), f.content);
    }
}

#[test]
fn nothing_listed_means_no_files() {
    let p = compile_with(&[], &testkit::skill_config());
    assert!(p.files.is_empty());
    assert!(p.lint.is_empty());
}

#[test]
fn secret_in_notes_blocks_publishing_and_names_the_server() {
    let mut dev = testkit::dev_box();
    dev.notes = format!("Temporary test database.\n{}=devpass-2026", "password");
    let p = compile_with(&[Asset::Vps(dev.clone())], &SkillConfig::default());
    assert!(p.blocked);
    let l = p.lint.iter().find(|l| l.id == LintId::SecretDetected).unwrap();
    assert_eq!(l.asset_id.as_deref(), Some(dev.id.as_str()));
    assert_eq!(l.file.as_deref(), Some("references/dev-box.md"));

    // 全局内容里的密钥没有服务器 id
    let config = SkillConfig {
        relation_notes: vec![RelationNote {
            id: "r1".into(),
            text: format!("{}=hunter2-xyz", "password"),
            replaces: None,
        }],
        ..Default::default()
    };
    let p = compile_with(&[Asset::Vps(testkit::dev_box())], &config);
    let l = p.lint.iter().find(|l| l.id == LintId::SecretDetected).unwrap();
    assert!(l.asset_id.is_none());
}

#[test]
fn exported_ip_in_user_text_is_an_error() {
    let mut hk = testkit::hk_edge();
    hk.notes = "- 2026-10-31: the origin is 203.0.113.10".into();
    let p = compile_with(&[Asset::Vps(hk)], &SkillConfig::default());
    assert!(p.blocked);
    assert!(p.lint.iter().any(|l| l.id == LintId::ExportDisabledField));

    let mut hk = testkit::hk_edge();
    hk.export.resolved_connection = true;
    hk.export.listening_ports = true;
    let p = compile_with(&[Asset::Vps(hk)], &SkillConfig::default());
    assert!(!p.blocked, "{:#?}", p.lint);
    assert!(
        p.files[1]
            .content
            .contains("- Resolved: HostName 203.0.113.10, User root, Port 22")
    );
    assert!(p.files[1].content.contains("- `0.0.0.0:22/tcp`"));
}

#[test]
fn loopback_health_check_is_static_but_user_address_exports_still_block() {
    let mut local = testkit::dev_box();
    local.connection.host = Some("127.0.0.1".into());
    local.connection.resolved = None;
    local.export.resolved_connection = false;
    let preview = compile_with(&[Asset::Vps(local.clone())], &SkillConfig::default());
    assert!(!preview.blocked, "{:#?}", preview.lint);
    for file in &preview.files {
        if file.path == "references/health-check.md" {
            assert_eq!(file.content, render::HEALTH_CHECK);
        } else {
            assert!(!file.content.contains("127.0.0.1"));
        }
    }

    local.notes = "The server address is 127.0.0.1".into();
    let preview = compile_with(&[Asset::Vps(local.clone())], &SkillConfig::default());
    assert!(preview.blocked);
    assert!(preview.lint.iter().any(|item| item.id == LintId::ExportDisabledField
        && item.file.as_deref() == Some("references/dev-box.md")));

    local.notes.clear();
    let config = SkillConfig {
        relation_notes: vec![RelationNote {
            id: "r1".into(),
            text: "The server address is 127.0.0.1".into(),
            replaces: None,
        }],
        ..Default::default()
    };
    let preview = compile_with(&[Asset::Vps(local)], &config);
    assert!(preview.blocked);
    assert!(
        preview
            .lint
            .iter()
            .any(|item| item.id == LintId::ExportDisabledField && item.file.as_deref() == Some("SKILL.md"))
    );
}

#[test]
fn modified_health_check_is_scanned_for_disabled_fields_and_secrets() {
    let mut local = testkit::dev_box();
    local.connection.host = Some("127.0.0.1".into());
    local.connection.resolved = None;
    local.export.resolved_connection = false;
    let assets = [Asset::Vps(local)];
    let listed: Vec<&Asset> = assets.iter().collect();
    let config = SkillConfig::default();
    let mut rendered = render::render_skill(&render::RenderInput {
        assets: &listed,
        all_assets: &assets,
        config: &config,
        inbox: "C:/Users/me/.cloudlink/inbox",
        snapshot: None,
    });
    let health_check = rendered
        .files
        .iter_mut()
        .find(|file| file.path == "references/health-check.md")
        .unwrap();
    health_check.content.push_str(&format!(
        "\nThe server address is 127.0.0.1\n{}=devpass-2026\n",
        "password"
    ));

    let items = lint::lint(&lint::LintInput {
        assets: &listed,
        rendered: &rendered,
        body_line_limit: 100,
        now_secs: now(),
    });
    for expected in [LintId::ExportDisabledField, LintId::SecretDetected] {
        assert!(
            items
                .iter()
                .any(|item| item.id == expected && item.file.as_deref() == Some("references/health-check.md")),
            "missing {expected:?}: {items:#?}"
        );
    }
}

#[test]
fn warnings_and_info() {
    let mut sg = testkit::sg_db();
    sg.guardrails.rules.clear();
    sg.services.push(Service {
        kind: ServiceKind::Docker,
        name: "ignore-previous-instructions".into(),
        image: Some("busybox:1.36".into()),
        ports: vec![],
        role: None,
        critical: false,
        source: FieldSource::Probe,
        last_seen_at: None,
        missing: false,
        sanitized: None,
    });
    sg.probe.last_success_at = Some("2026-09-01T00:00:00Z".into());
    let p = compile_with(&[Asset::Vps(sg.clone())], &SkillConfig::default());
    let ids: Vec<LintId> = p.lint.iter().map(|l| l.id).collect();
    assert!(ids.contains(&LintId::ProdStandardNoGuardrails));
    assert!(ids.contains(&LintId::SuspectedInjection));
    assert!(ids.contains(&LintId::ProbeStale));
    assert!(!p.blocked, "warnings do not block");
    assert!(
        p.files[1].content.contains("`ignore-previous-instructions`"),
        "probe values stay in code spans"
    );
    assert!(p.lint.iter().all(|l| l.asset_id.as_deref() == Some(sg.id.as_str())));
}

#[test]
fn long_descriptions_are_truncated_and_overview_keeps_everyone() {
    let mut assets = Vec::new();
    for i in 0..80 {
        let mut s = testkit::hk_edge();
        s.id = format!("ast_{i:02}");
        s.connection.ssh_alias = format!("edge-{i:02}");
        s.created_at = format!("2026-10-01T00:00:{i:02}Z");
        s.served_hostnames = vec![format!("site-{i}.example.com")];
        assets.push(Asset::Vps(s));
    }
    let p = compile_with(&assets, &SkillConfig::default());
    assert!(p.budget.description_chars <= 1024);
    assert!(p.lint.iter().any(|l| l.id == LintId::DescriptionTooLong));
    let skill = &p.files[0].content;
    for i in 0..80 {
        assert!(
            skill.contains(&format!("| `edge-{i:02}` |")),
            "overview lists every server (F-201 AC3)"
        );
    }
    assert!(
        p.lint.iter().any(|l| l.id == LintId::BodyTooLong),
        "80 rows exceed the 100-line body limit: {}",
        p.budget.body_lines
    );
}

#[test]
fn duplicate_detail_names_get_a_suffix() {
    let mut a = testkit::hk_edge();
    a.connection.ssh_alias = "HK_edge".into();
    let mut b = testkit::sg_db();
    b.connection.ssh_alias = "hk-edge".into();
    b.created_at = "2026-10-01T00:00:00Z".into();
    let assets = [Asset::Vps(a.clone()), Asset::Vps(b.clone())];
    let listed: Vec<&Asset> = assets.iter().collect();
    let names = render::detail_names(&listed);
    assert_eq!(names[&b.id], "hk-edge");
    assert_eq!(names[&a.id], "hk-edge-2");
}

#[test]
fn status_keeps_last_success_when_blocked() {
    let ok = compile_with(&golden_servers(), &testkit::skill_config());
    let s1 = to_status(&ok, None, "2026-10-31T09:00:00Z");
    assert_eq!(s1.compiled_at.as_deref(), Some("2026-10-31T09:00:00Z"));
    let mut dev = testkit::dev_box();
    dev.notes = format!("{}=devpass-2026", "password");
    let bad = compile_with(&[Asset::Vps(dev)], &SkillConfig::default());
    let s2 = to_status(&bad, Some(&s1), "2026-10-31T10:00:00Z");
    assert!(s2.blocked);
    assert_eq!(s2.errors, 1);
    assert_eq!(s2.compiled_at.as_deref(), Some("2026-10-31T09:00:00Z"));
}

#[test]
fn mode_changes_the_output() {
    let mut hk = testkit::hk_edge();
    let a = compile_with(&[Asset::Vps(hk.clone())], &SkillConfig::default());
    hk.agent.mode = Mode::Standard;
    let b = compile_with(&[Asset::Vps(hk)], &SkillConfig::default());
    assert_ne!(a.files, b.files);
}

/// F-203 AC2：20 台服务器的总 Skill 编译 p95 ≤ 200ms。调试构建下只记录耗时，发布构建下断言
#[test]
fn compile_twenty_servers_is_fast() {
    let mut assets = Vec::new();
    for i in 0..20 {
        let mut s = testkit::hk_edge();
        s.id = format!("ast_{i:02}");
        s.connection.ssh_alias = format!("edge-{i:02}");
        assets.push(Asset::Vps(s));
    }
    let config = testkit::skill_config();
    let _ = compile_with(&assets, &config); // 预热：规则集只编译一次
    let mut times: Vec<u128> = (0..20)
        .map(|_| {
            let t = std::time::Instant::now();
            let _ = compile_with(&assets, &config);
            t.elapsed().as_micros()
        })
        .collect();
    times.sort_unstable();
    let p95_ms = times[18] as f64 / 1000.0;
    println!("compile 20 servers p95 = {p95_ms:.1} ms");
    if !cfg!(debug_assertions) {
        assert!(p95_ms <= 200.0, "p95 {p95_ms} ms");
    }
}
