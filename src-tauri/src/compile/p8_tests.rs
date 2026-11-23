use std::collections::BTreeMap;

use super::*;
use crate::model::asset::{CliProvider, Mode};
use crate::model::github::*;
use crate::testkit;

fn preview(assets: &[Asset], env_id: &EnvId, runner: &str) -> CompilePreview {
    let listed: Vec<_> = assets.iter().collect();
    compile(&CompileInput {
        env_id,
        agent_key: "claude-code",
        assets: &listed,
        all_assets: assets,
        config: &SkillConfig::default(),
        inbox: "C:/fixture/inbox",
        runner,
        body_line_limit: 100,
        write_snapshot_time: false,
        now_secs: crate::time::parse_rfc3339(testkit::NOW).unwrap(),
    })
}

#[test]
fn both_modes_use_stable_runner_ids_regardless_of_production() {
    for mode in [Mode::ConfirmChanges, Mode::AutoOps] {
        let mut server = testkit::hk_edge();
        server.agent.mode = mode;
        let id = server.id.clone();
        let mut dev = testkit::dev_box();
        dev.agent.mode = mode;
        let dev_id = dev.id.clone();
        let p = preview(
            &[Asset::Vps(server), Asset::Vps(dev)],
            &EnvId::windows(),
            "C:/fixture/bin/cloudlink-guard.exe",
        );
        let production = &p
            .files
            .iter()
            .find(|file| file.path.ends_with("hk-edge.md"))
            .unwrap()
            .content;
        assert!(production.contains(&format!("exec --env 'windows' --asset '{id}' -- '<command>'")));
        assert!(!production.contains("ssh hk-edge"));
        assert!(
            p.files
                .iter()
                .find(|file| file.path.ends_with("dev-box.md"))
                .unwrap()
                .content
                .contains(&format!("exec --env 'windows' --asset '{dev_id}'"))
        );
        assert!(production.contains("put --env 'windows'"));
        assert!(production.contains("get --env 'windows'"));
    }
}

#[test]
fn every_production_provider_uses_an_argv_entry_not_a_bare_local_cli() {
    for provider in [
        CliProvider::Cloudflare,
        CliProvider::Vercel,
        CliProvider::Oracle,
        CliProvider::Github,
    ] {
        let mut cli = testkit::cloudflare();
        cli.cli_provider = provider;
        cli.cli.binary = provider.binary();
        cli.handle = provider.as_str().into();
        let id = cli.id.clone();
        let p = preview(
            &[Asset::Cli(cli)],
            &EnvId::windows(),
            "C:/fixture/bin/cloudlink-guard.exe",
        );
        let reference = &p.files[1].content;
        assert!(reference.contains(&format!("exec --env 'windows' --asset '{id}' -- <command arguments>")));
        assert!(!reference.contains("in the local shell; it is already logged in"));
        assert!(reference.contains("without the provider binary or a shell wrapper"));
    }
}

#[test]
fn executable_paths_are_quoted_for_each_shell_without_truncation_or_expansion() {
    let runner = "C:/Users/Me's $(literal)/very long fixture directory/bin/cloudlink-guard.exe";
    let p = preview(&[Asset::Vps(testkit::hk_edge())], &EnvId::windows(), runner);
    let reference = &p.files[1].content;
    assert!(
        reference.contains("'C:/Users/Me'\\''s $(literal)/very long fixture directory/bin/cloudlink-guard.exe' exec")
    );
    assert!(
        reference.contains("& 'C:/Users/Me''s $(literal)/very long fixture directory/bin/cloudlink-guard.exe' exec")
    );
    let wsl = EnvId::parse("wsl:Ubuntu-24.04").unwrap();
    let p = preview(
        &[Asset::Vps(testkit::hk_edge())],
        &wsl,
        "/mnt/c/fixture/bin/cloudlink-guard.exe",
    );
    assert!(
        p.files[1]
            .content
            .contains("'/mnt/c/fixture/bin/cloudlink-guard.exe' exec --env 'wsl:Ubuntu-24.04'")
    );
    assert!(!p.files[1].content.contains("PowerShell:"));
}

#[test]
fn waiting_protocol_lives_in_its_own_reference_and_the_exit_boundary_is_not_told_to_the_agent() {
    let p = preview(
        &[Asset::Vps(testkit::hk_edge())],
        &EnvId::windows(),
        "C:/fixture/bin/cloudlink-guard.exe",
    );
    let skill = &p.files[0].content;
    let execution = &p
        .files
        .iter()
        .find(|file| file.path == render::EXECUTION_FILE)
        .expect("execution reference")
        .content;
    for phrase in [
        "'C:/fixture/bin/cloudlink-guard.exe' wait --env 'windows' '<requestId.ownerToken>'",
        "& 'C:/fixture/bin/cloudlink-guard.exe' wait --env 'windows' '<requestId.ownerToken>'",
        "    'C:/fixture/bin/cloudlink-guard.exe' status\n",
        "    & 'C:/fixture/bin/cloudlink-guard.exe' status\n",
        "90 seconds",
        "5 minutes",
        "at most once",
        "Never replay unknown",
        "never approves or resumes an old request",
        "retains the original request's source",
    ] {
        assert!(execution.contains(phrase), "missing {phrase}");
    }
    // 正文只留调用约定和一句指向；等待细节按需再读
    for phrase in [
        "`references/execution.md`",
        "(exit 75) is not rejection or execution failure",
        "never resubmit it through another tool",
        "maximum 3600",
        "No TTY",
        "confirm-changes",
        "auto-ops",
        "display-only self-report, never approval",
    ] {
        assert!(skill.contains(phrase), "missing {phrase}");
    }
    assert!(!skill.contains("ownerToken") && !skill.contains("5 minutes"));
    // 检查什么时候不生效只在界面上说，不写给 Agent
    for file in &p.files {
        for phrase in [
            "full exit",
            "still forward",
            "checks/approval stop",
            "exit bypass",
            "while CloudLink runs",
            "While CloudLink runs",
            "not a sandbox",
        ] {
            assert!(!file.content.contains(phrase), "{} still says {phrase}", file.path);
        }
    }
    assert!(p.lint.is_empty(), "{:#?}", p.lint);
    assert!(p.budget.body_lines <= 60, "{}", p.budget.body_lines);
    assert_eq!(render::TEMPLATE_VERSION, 6);
    assert!(render::HEALTH_CHECK.contains("Do not replace that entry with direct SSH"));
    let wsl = EnvId::parse("wsl:Ubuntu-24.04").unwrap();
    let p = preview(
        &[Asset::Vps(testkit::hk_edge())],
        &wsl,
        "/mnt/c/fixture/bin/cloudlink-guard.exe",
    );
    let execution = &p
        .files
        .iter()
        .find(|file| file.path == render::EXECUTION_FILE)
        .unwrap()
        .content;
    assert!(execution.contains("'/mnt/c/fixture/bin/cloudlink-guard.exe' wait --env 'wsl:Ubuntu-24.04'"));
    assert!(!execution.contains("PowerShell:"));
}

#[test]
fn legacy_address_alias_uses_private_id_mapping_without_mutating_user_data() {
    let mut server = testkit::hk_edge();
    server.connection.ssh_alias = "host-203.0.113.10".into();
    server.name = "Neutral server".into();
    let original = server.clone();
    let p = preview(
        &[Asset::Vps(server)],
        &EnvId::windows(),
        "C:/fixture/bin/cloudlink-guard.exe",
    );
    assert!(!p.blocked, "{:?}", p.lint);
    assert!(
        p.files
            .iter()
            .all(|file| !file.content.contains("203.0.113.10") && !file.path.contains("203.0.113.10"))
    );
    assert!(p.files[1].content.contains(&format!("--asset '{}'", original.id)));
    assert_eq!(original.connection.ssh_alias, "host-203.0.113.10");
    let mut named = original;
    named.name = "Server at 203.0.113.10".into();
    assert!(
        preview(
            &[Asset::Vps(named)],
            &EnvId::windows(),
            "C:/fixture/bin/cloudlink-guard.exe"
        )
        .blocked
    );
}

fn owned_github() -> crate::model::asset::CliAsset {
    let mut cli = testkit::github();
    let owner = GithubOwner {
        id: "owner:team".into(),
        login: "team".into(),
        kind: GithubOwnerKind::Organization,
    };
    cli.cli.scope[0].name = "team/shop-web".into();
    cli.cli.scope[1].name = "team/notes".into();
    cli.cli.scope[1].id = "repo:R_excluded".into();
    let repos = cli
        .cli
        .scope
        .iter()
        .map(|repo| GithubRepo {
            id: repo.id.clone(),
            name: repo.name.clone(),
            owner_id: owner.id.clone(),
            database_id: None,
            default_branch: repo.default_branch.clone(),
            visibility: repo.visibility,
            selected: repo.selected,
        })
        .collect();
    let snapshot = GithubSnapshot {
        status: GithubSnapshotStatus::Complete,
        identity: Some(GithubIdentity {
            id: "user:operator".into(),
            login: "operator".into(),
            host: "github.com".into(),
        }),
        owner: Some(owner.clone()),
        repos,
        checked_at: testkit::NOW.into(),
        reason_id: None,
    };
    cli.github = Some(GithubConfig {
        host: "github.com".into(),
        owner: Some(owner),
        mode: GithubScopeMode::Auto,
        selected_repo_ids: vec![],
        excluded_repo_ids: vec!["repo:R_excluded".into()],
        revision: 1,
        env_states: BTreeMap::from([(EnvId::windows(), snapshot)]),
        migration_pending: false,
    });
    cli
}

#[test]
fn github_auto_owner_and_effective_login_are_separate_and_discovery_is_explicit() {
    let cli = owned_github();
    let p = preview(
        &[Asset::Cli(cli)],
        &EnvId::windows(),
        "C:/fixture/bin/cloudlink-guard.exe",
    );
    let reference = &p.files[1].content;
    for phrase in [
        "Owner: `team`",
        "login in this environment: `operator`",
        "current and future repositories",
        "including private",
        "repo:R_excluded",
        "transferred out",
        "discover --env 'windows'",
        "--tool git",
        "not additional authorization",
        "cannot enlarge authorization",
    ] {
        assert!(reference.contains(phrase), "missing {phrase}");
    }
    assert!(!reference.contains("account other than `team`"));
}

#[test]
fn github_refresh_timestamps_and_diagnostics_do_not_change_authority_projection() {
    let cli = owned_github();
    let before = crate::guard::project_policy(&[Asset::Cli(cli.clone())]);
    let mut after = cli;
    let snapshot = after
        .github
        .as_mut()
        .unwrap()
        .env_states
        .get_mut(&EnvId::windows())
        .unwrap();
    snapshot.checked_at = "2026-11-15T02:00:00Z".into();
    snapshot.reason_id = Some("diagnostic-only".into());
    assert_eq!(before, crate::guard::project_policy(&[Asset::Cli(after.clone())]));
    after
        .github
        .as_mut()
        .unwrap()
        .env_states
        .get_mut(&EnvId::windows())
        .unwrap()
        .identity
        .as_mut()
        .unwrap()
        .login = "other-login".into();
    assert_ne!(before, crate::guard::project_policy(&[Asset::Cli(after)]));
}
