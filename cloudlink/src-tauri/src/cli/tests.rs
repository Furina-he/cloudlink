use std::sync::atomic::{AtomicBool, Ordering};

use serde_json::json;

use super::*;
use crate::env::{EnvContext, WslInfo};
use crate::paths::Paths;

const ACCOUNT_A: &str = "11111111111111111111111111111111";
const ACCOUNT_B: &str = "22222222222222222222222222222222";

#[derive(Default)]
struct FixtureRunner {
    calls: Mutex<Vec<Query>>,
    fail_scope: AtomicBool,
    withdraw: AtomicBool,
}

impl Runner for FixtureRunner {
    fn run(&self, env: &EnvContext, query: &Query) -> Result<QueryOutput> {
        self.calls.lock().unwrap().push(query.clone());
        let output = match query {
            Query::Discover { provider } => json!({ "installed": true, "path": if env.is_windows() {
                format!("C:/isolated/{}.cmd", provider.binary().as_str())
            } else { format!("/isolated/{}", provider.binary().as_str()) } }),
            Query::Version { .. } => json!({ "version": "4.157.0" }),
            Query::Profiles { .. } => json!({ "profiles": ["DEFAULT", "production", "bad profile"] }),
            Query::Identity {
                provider: CliProvider::Cloudflare,
                ..
            } => {
                let accounts = if self.withdraw.load(Ordering::SeqCst) {
                    vec![]
                } else if env.is_windows() {
                    vec![
                        json!({ "id": ACCOUNT_A, "name": "Personal" }),
                        json!({ "id": ACCOUNT_B, "name": "Business" }),
                    ]
                } else {
                    vec![json!({ "id": ACCOUNT_A, "name": "Personal" })]
                };
                json!({ "loggedIn": true, "email": "me@example.com", "accounts": accounts })
            }
            Query::Identity {
                provider: CliProvider::Vercel,
                ..
            } => json!({
                "username": "my-user", "globalTeam": {"slug":"my-team"},
                "teams": [{"slug":"my-team"},{"slug":"other-team"}]
            }),
            Query::Identity {
                provider: CliProvider::Oracle,
                account,
                ..
            } => {
                json!({ "authenticated": account.as_deref() == Some("production"), "expired": account.as_deref() == Some("DEFAULT") })
            }
            Query::Scope { .. } if self.fail_scope.load(Ordering::SeqCst) => {
                return Err(AppError::ipc(IpcErrorId::CliScopePermission));
            }
            Query::Scope {
                provider: CliProvider::Cloudflare,
                account,
                ..
            } if account == ACCOUNT_A => json!({ "items": [
                { "id": "zone:example", "kind": "zone", "name": "example.com", "addresses": ["203.0.113.10", "not-an-ip"] },
                { "id": "worker:gateway", "kind": "worker", "name": "gateway" }
            ] }),
            Query::Scope {
                provider: CliProvider::Cloudflare,
                ..
            } => json!({ "items": [
                { "id": "zone:company", "kind": "zone", "name": "company.example" }
            ] }),
            Query::Scope {
                provider: CliProvider::Vercel,
                ..
            } => json!({ "items": [
                { "id": "prj_web", "kind": "project", "name": "web" }
            ] }),
            Query::Scope {
                provider: CliProvider::Oracle,
                ..
            } => json!({ "items": [
                { "id": "ocid1.instance.test.example", "kind": "instance", "name": "compute", "address": "192.0.2.30" }
            ] }),
        };
        Ok(QueryOutput::json(output))
    }

    fn open_terminal(&self, _env: &EnvContext, _command: &str) -> Result<()> {
        Ok(())
    }
}

fn environments(paths: &Paths) -> Vec<EnvContext> {
    vec![
        EnvContext::windows(paths),
        EnvContext::wsl(
            paths,
            "Ubuntu-24.04",
            WslInfo {
                home: "/home/test".into(),
                user: "test".into(),
                interop: true,
                mount_prefix: "/mnt/".into(),
            },
        ),
    ]
}

#[test]
fn cloudflare_uses_account_ids_and_checks_each_environment_for_bound_account() {
    let temp = tempfile::tempdir().unwrap();
    let envs = environments(&Paths::isolated_in(temp.path()));
    let runner = Arc::new(FixtureRunner::default());
    let service = Service::new(runner);
    let states = service.detect(&envs, CliProvider::Cloudflare, Some(ACCOUNT_B)).unwrap();
    let windows = &states[&EnvId::windows()];
    assert_eq!(windows.account.as_deref(), Some("me@example.com"));
    assert_eq!(
        windows.accounts.as_deref(),
        Some(&[ACCOUNT_A.to_string(), ACCOUNT_B.to_string()][..])
    );
    assert!(windows.authenticated);
    assert!(!states[&EnvId::wsl("Ubuntu-24.04")].authenticated);
    assert!(windows.installed);
    assert_eq!(windows.version.as_deref(), Some("4.157.0"));
}

#[test]
fn scope_links_dns_ips_and_validates_drafts_against_the_bound_catalog() {
    let temp = tempfile::tempdir().unwrap();
    let envs = environments(&Paths::isolated_in(temp.path()));
    let service = Service::new(Arc::new(FixtureRunner::default()));
    service.detect(&envs, CliProvider::Cloudflare, None).unwrap();
    let server = crate::testkit::hk_edge();
    let server_id = server.id.clone();
    let scope = service
        .scope(&envs, CliProvider::Cloudflare, Some(ACCOUNT_A), &[Asset::Vps(server)])
        .unwrap();
    let zone = scope.iter().find(|i| i.kind == CliScopeKind::Zone).unwrap();
    assert_eq!(zone.linked_asset_id.as_deref(), Some(server_id.as_str()));
    assert!(zone.address.is_none());
    let mut draft = zone.clone();
    draft.name = "forged-name".into();
    draft.linked_asset_id = Some("forged-link".into());
    draft.selected = true;
    let validated = service
        .validate_scope(CliProvider::Cloudflare, Some(ACCOUNT_A), &[draft.clone()])
        .unwrap();
    let validated = validated.iter().find(|i| i.id == draft.id).unwrap();
    assert_eq!(validated.name, "example.com");
    assert_eq!(validated.linked_asset_id.as_deref(), Some(server_id.as_str()));
    assert!(validated.selected);
    draft.id = "zone:in-another-account".into();
    assert!(
        service
            .validate_scope(CliProvider::Cloudflare, Some(ACCOUNT_A), &[draft])
            .unwrap_err()
            .is_ipc(IpcErrorId::CliScopeFailed)
    );
    assert!(
        service
            .validate_scope(CliProvider::Cloudflare, Some(ACCOUNT_B), &scope)
            .unwrap_err()
            .is_ipc(IpcErrorId::CliScopeFailed)
    );
}

#[test]
fn account_and_provider_catalogs_do_not_bleed_into_each_other() {
    let temp = tempfile::tempdir().unwrap();
    let envs = environments(&Paths::isolated_in(temp.path()));
    let service = Service::new(Arc::new(FixtureRunner::default()));
    service.detect(&envs, CliProvider::Cloudflare, None).unwrap();
    service.detect(&envs, CliProvider::Vercel, None).unwrap();
    let a = service
        .scope(&envs, CliProvider::Cloudflare, Some(ACCOUNT_A), &[])
        .unwrap();
    let b = service
        .scope(&envs, CliProvider::Cloudflare, Some(ACCOUNT_B), &[])
        .unwrap();
    let projects = service.scope(&envs, CliProvider::Vercel, Some("my-team"), &[]).unwrap();
    assert!(a.iter().all(|i| !b.iter().any(|other| i.id == other.id)));
    assert!(
        service
            .validate_scope(CliProvider::Cloudflare, Some(ACCOUNT_A), &projects)
            .is_err()
    );
    assert!(
        service
            .validate_scope(CliProvider::Cloudflare, Some(ACCOUNT_B), &a)
            .is_err()
    );
}

#[test]
fn revoked_accounts_and_failed_scope_refresh_invalidate_old_catalogs() {
    let temp = tempfile::tempdir().unwrap();
    let envs = environments(&Paths::isolated_in(temp.path()));
    let runner = Arc::new(FixtureRunner::default());
    let service = Service::new(runner.clone());
    service.detect(&envs, CliProvider::Cloudflare, None).unwrap();
    let scope = service
        .scope(&envs, CliProvider::Cloudflare, Some(ACCOUNT_A), &[])
        .unwrap();
    runner.fail_scope.store(true, Ordering::SeqCst);
    assert!(
        service
            .scope(&envs, CliProvider::Cloudflare, Some(ACCOUNT_A), &[])
            .unwrap_err()
            .is_ipc(IpcErrorId::CliScopePermission)
    );
    assert!(
        service
            .validate_scope(CliProvider::Cloudflare, Some(ACCOUNT_A), &scope)
            .is_err()
    );
    runner.fail_scope.store(false, Ordering::SeqCst);
    service
        .scope(&envs, CliProvider::Cloudflare, Some(ACCOUNT_A), &[])
        .unwrap();
    runner.withdraw.store(true, Ordering::SeqCst);
    service.detect(&envs, CliProvider::Cloudflare, None).unwrap();
    assert!(
        service
            .scope(&envs, CliProvider::Cloudflare, Some(ACCOUNT_A), &[])
            .unwrap_err()
            .is_ipc(IpcErrorId::CliAccountUnavailable)
    );
    assert!(
        service
            .validate_scope(CliProvider::Cloudflare, Some(ACCOUNT_A), &scope)
            .is_err()
    );
}

#[test]
fn vercel_lists_teams_and_personal_account_and_oci_keeps_only_verified_profiles() {
    let temp = tempfile::tempdir().unwrap();
    let envs = environments(&Paths::isolated_in(temp.path()));
    let service = Service::new(Arc::new(FixtureRunner::default()));
    let states = service.detect(&envs, CliProvider::Vercel, None).unwrap();
    assert_eq!(
        states[&EnvId::windows()].accounts.as_ref().unwrap(),
        &vec!["my-team", "my-user", "other-team"]
    );
    let states = service.detect(&envs, CliProvider::Oracle, None).unwrap();
    let state = &states[&EnvId::windows()];
    assert_eq!(state.accounts.as_ref().unwrap(), &vec!["production"]);
    assert!(state.authenticated);
    assert!(!state.expired);
    let items = service
        .scope(&envs, CliProvider::Oracle, Some("production"), &[])
        .unwrap();
    assert_eq!(items[0].address.as_deref(), Some("192.0.2.30"));
}

#[test]
fn vercel_accounts_use_stable_ids_and_only_advertised_personal_scopes() {
    let northstar = json!({
        "username": "my-user", "team": {"id":"team_prod", "slug":"production"},
        "teams": [{"id":"team_prod", "slug":"production"}, {"id":"team_dev", "slug":"development"}]
    });
    let (display, accounts, expired) = parse_identity(CliProvider::Vercel, &northstar);
    assert_eq!(display.as_deref(), Some("production"));
    assert_eq!(accounts, ["team_prod", "team_dev"]);
    assert!(!expired);

    let mut renamed = northstar.clone();
    renamed["team"]["slug"] = json!("renamed-team");
    renamed["teams"][0]["slug"] = json!("renamed-team");
    assert_eq!(parse_identity(CliProvider::Vercel, &renamed).1, accounts);

    let legacy = json!({
        "username": "my-user", "team": {"id":"team_prod", "slug":"production"},
        "teams": [{"id":"user_stable", "slug":"my-user"}, {"id":"team_prod", "slug":"production"}]
    });
    assert_eq!(
        parse_identity(CliProvider::Vercel, &legacy).1,
        ["team_prod", "user_stable"]
    );
}

#[test]
fn vercel_empty_or_revoked_scope_lists_cannot_reintroduce_a_username_or_stale_team() {
    assert!(
        parse_identity(CliProvider::Vercel, &json!({"username":"northstar-user", "teams":[]}))
            .1
            .is_empty()
    );
    let value = json!({
        "username":"my-user", "globalTeam":{"id":"team_revoked", "slug":"old-team"},
        "teams":[{"id":"team_current", "slug":"current-team"}]
    });
    assert_eq!(parse_identity(CliProvider::Vercel, &value).1, ["team_current"]);
    assert_eq!(
        parse_identity(CliProvider::Vercel, &value).0.as_deref(),
        Some("my-user")
    );
    let value = json!({
        "authenticated":false, "expired":true, "username":"my-user",
        "teams":[{"id":"team_current", "slug":"current-team"}]
    });
    assert_eq!(parse_identity(CliProvider::Vercel, &value), (None, vec![], true));
}

#[test]
fn no_cli_queries_or_terminal_commands_can_escape_isolation() {
    let temp = tempfile::tempdir().unwrap();
    let paths = Paths::isolated_in(temp.path());
    let env = EnvContext::windows(&paths);
    let runner = SystemRunner::new(&paths);
    assert!(
        runner
            .run(
                &env,
                &Query::Discover {
                    provider: CliProvider::Cloudflare
                }
            )
            .is_err()
    );
    assert!(runner.open_terminal(&env, "wrangler login").is_err());
    let service = Service::new(Arc::new(EmptyRunner));
    let states = service.detect(&[env], CliProvider::Oracle, None).unwrap();
    assert!(!states[&EnvId::windows()].installed);
    assert!(temp.path().read_dir().unwrap().next().is_none());
}

#[test]
fn terminal_allowlist_rejects_injection_and_wrong_platform_installers() {
    let temp = tempfile::tempdir().unwrap();
    let envs = environments(&Paths::isolated_in(temp.path()));
    let service = Service::new(Arc::new(FixtureRunner::default()));
    for command in [
        "wrangler login",
        "npm install -g vercel",
        "pip install oci-cli",
        "oci setup config",
    ] {
        assert!(service.open_terminal(&envs[0], command).is_ok());
    }
    for command in [
        "wrangler login && echo unsafe",
        "wrangler login\necho unsafe",
        "npm install -g anything",
        "oci session export",
    ] {
        assert!(
            service
                .open_terminal(&envs[0], command)
                .unwrap_err()
                .is_ipc(IpcErrorId::TerminalCommandInvalid)
        );
    }
    assert!(!terminal_command_allowed(&envs[1], "winget install Oracle.OCICLI"));
    let installer =
        r#"bash -c "$(curl -L https://raw.githubusercontent.com/oracle/oci-cli/master/scripts/install/install.sh)""#;
    assert!(terminal_command_allowed(&envs[1], installer));
    assert!(!terminal_command_allowed(&envs[0], installer));
}

#[test]
fn unknown_accounts_never_reach_the_process_runner_and_raw_output_is_not_in_errors() {
    let temp = tempfile::tempdir().unwrap();
    let envs = environments(&Paths::isolated_in(temp.path()));
    let runner = Arc::new(FixtureRunner::default());
    let service = Service::new(runner.clone());
    service.detect(&envs, CliProvider::Cloudflare, None).unwrap();
    let before = runner.calls.lock().unwrap().len();
    assert!(
        service
            .scope(&envs, CliProvider::Cloudflare, Some("-oProxyCommand=unsafe"), &[])
            .is_err()
    );
    assert_eq!(runner.calls.lock().unwrap().len(), before);
    let secret_output = QueryOutput {
        code: Some(1),
        stdout: "password=should-never-be-visible".into(),
    };
    assert!(!format!("{secret_output:?}").contains("should-never-be-visible"));
    let error = json_output(&secret_output).unwrap_err();
    assert!(!format!("{error}").contains("should-never-be-visible"));
    assert!(
        !serde_json::to_string(&error.to_ipc())
            .unwrap()
            .contains("should-never-be-visible")
    );
}

#[test]
fn scope_accepts_only_the_provider_shape_and_public_ip_addresses() {
    assert!(
        parse_scope(
            CliProvider::Vercel,
            &json!({ "items":[{"id":"bad","kind":"zone","name":"bad"}] }),
            &[]
        )
        .is_err()
    );
    let scope = parse_scope(
        CliProvider::Oracle,
        &json!({ "items":[{
        "id":"instance","kind":"instance","name":"compute\u{001b}","address":"https://evil.example"
    }] }),
        &[],
    )
    .unwrap();
    assert_eq!(scope[0].name, "compute");
    assert!(scope[0].address.is_none());
}

#[test]
fn script_arguments_are_quoted_and_account_values_are_validated() {
    let temp = tempfile::tempdir().unwrap();
    let envs = environments(&Paths::isolated_in(temp.path()));
    assert_eq!(
        runner::ps_quote("C:/O'Brien/wrangler.cmd"),
        "'C:/O''Brien/wrangler.cmd'"
    );
    assert_eq!(
        runner::sh_quote("/home/O'Brien/wrangler"),
        "'/home/O'\\''Brien/wrangler'"
    );
    let script = runner::script_for(
        &envs[1],
        &Query::Scope {
            provider: CliProvider::Cloudflare,
            path: "/usr/bin/wrangler".into(),
            account: ACCOUNT_A.into(),
        },
    )
    .unwrap();
    assert!(script.contains("node -e"));
    let identity = runner::script_for(
        &envs[1],
        &Query::Identity {
            provider: CliProvider::Vercel,
            path: "/usr/bin/vercel".into(),
            account: None,
        },
    )
    .unwrap();
    assert!(identity.contains("node -e"));
    assert!(identity.contains("WRANGLER_WRITE_LOGS=false"));
    assert!(identity.contains("cd /;"));
    assert!(
        runner::script_for(
            &envs[1],
            &Query::Scope {
                provider: CliProvider::Cloudflare,
                path: "/usr/bin/wrangler".into(),
                account: "$(echo unsafe)".into()
            }
        )
        .is_err()
    );
}
