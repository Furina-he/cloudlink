//! Backend integration tests use temporary Windows/WSL trees and injected services only.
//! No test discovers a real CLI, opens a terminal, uses SSH, or reads the OS vault.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, Weak};

use serde_json::{Value, json};

use super::backend::{Backend, EventSink};
use super::requests::{CliRequest, SettingsPatch};
use super::startup::Start;
use crate::cli::{self, Query, QueryOutput, Runner};
use crate::compile::publish::{self, MARKER_FILE, SKILL_DIR};
use crate::env::{self, EnvContext, FakeSystem};
use crate::error::{AppError, Result};
use crate::fsx;
use crate::model::asset::*;
use crate::model::delivery::{AddCustomTargetRequest, AgentId, DeliveryStatus, InclusionReasonId, Target};
use crate::model::env::EnvId;
use crate::model::misc::{ActivityMessageId, ActivityQuery, IpcErrorId};
use crate::paths::Paths;
use crate::secret::SecretString;
use crate::secret::store::{CredentialStore, MemoryCredentialStore};

const ACCOUNT_A: &str = "11111111111111111111111111111111";
const ACCOUNT_B: &str = "22222222222222222222222222222222";
const USER_CONFIG: &str = "Include ~/.ssh/cloudlink.conf\nHost user-owned\n  HostName 127.0.0.1\n";

fn user_config(env: &EnvContext) -> String {
    USER_CONFIG.replace(
        crate::ssh::managed::INCLUDE_LINE,
        &crate::ssh::managed::include_line(
            &env.managed_config_native(),
            crate::ssh::managed::IncludeMode::for_env(env),
        )
        .unwrap(),
    )
}

#[derive(Default)]
struct RecordingEvents {
    items: Mutex<Vec<(String, Value)>>,
}

impl RecordingEvents {
    fn clear(&self) {
        self.items.lock().unwrap().clear();
    }

    fn contains(&self, name: &str) -> bool {
        self.items.lock().unwrap().iter().any(|(event, _)| event == name)
    }

    fn payloads(&self, name: &str) -> Vec<Value> {
        self.items
            .lock()
            .unwrap()
            .iter()
            .filter(|(event, _)| event == name)
            .map(|(_, payload)| payload.clone())
            .collect()
    }
}

impl EventSink for RecordingEvents {
    fn emit(&self, event: &str, payload: Value) {
        self.items.lock().unwrap().push((event.into(), payload));
    }
}

#[derive(Default)]
struct MetadataRunner {
    calls: Mutex<Vec<(EnvId, Query)>>,
    withdraw_business: AtomicBool,
    deny_scope: AtomicBool,
}

impl Runner for MetadataRunner {
    fn run(&self, env: &EnvContext, query: &Query) -> Result<QueryOutput> {
        self.calls.lock().unwrap().push((env.id.clone(), query.clone()));
        let output = match query {
            Query::Discover { provider } => json!({
                "installed": true,
                "path": env.native_in_home(&["fixture-cli", if env.is_windows() {
                    "wrangler.cmd"
                } else {
                    provider.binary().as_str()
                }]),
            }),
            Query::Version { .. } => json!({ "version": "4.157.0" }),
            Query::Identity {
                provider: CliProvider::Cloudflare,
                ..
            } => {
                let mut accounts = vec![json!({ "id": ACCOUNT_A, "name": "Personal" })];
                if env.is_windows() && !self.withdraw_business.load(Ordering::SeqCst) {
                    accounts.push(json!({ "id": ACCOUNT_B, "name": "Business" }));
                }
                json!({ "loggedIn": true, "email": "test@example.com", "accounts": accounts })
            }
            Query::Scope { .. } if self.deny_scope.load(Ordering::SeqCst) => {
                return Err(AppError::ipc(IpcErrorId::CliScopePermission));
            }
            Query::Scope {
                provider: CliProvider::Cloudflare,
                account,
                ..
            } if account == ACCOUNT_A => {
                json!({ "items": [
                    { "id": "zone:a", "kind": "zone", "name": "example.test", "addresses": ["203.0.113.10"] },
                    { "id": "worker:a", "kind": "worker", "name": "gateway" },
                ] })
            }
            Query::Scope {
                provider: CliProvider::Cloudflare,
                account,
                ..
            } if account == ACCOUNT_B => {
                json!({ "items": [
                    { "id": "zone:b", "kind": "zone", "name": "company.test" },
                ] })
            }
            _ => return Err(AppError::ipc(IpcErrorId::CliCommandUnsupported)),
        };
        Ok(QueryOutput::json(output))
    }

    fn open_terminal(&self, _env: &EnvContext, _command: &str) -> Result<()> {
        panic!("integration tests must never open terminals")
    }
}

struct Fixture {
    backend: Arc<Backend>,
    paths: Paths,
    credentials: Arc<MemoryCredentialStore>,
    events: Arc<RecordingEvents>,
    // Drop the backend/database before asking TempDir to remove its isolated tree on Windows.
    _temp: tempfile::TempDir,
}

impl Fixture {
    fn new() -> Self {
        Self::with_runner(Arc::new(cli::EmptyRunner), false)
    }

    fn with_runner(runner: Arc<dyn Runner>, wsl: bool) -> Self {
        Self::build(runner, wsl, true)
    }

    /// 和桌面应用一样只打开数据库：启动工作留给测试自己调用 `start`
    fn unstarted() -> Self {
        Self::build(Arc::new(cli::EmptyRunner), false, false)
    }

    fn build(runner: Arc<dyn Runner>, wsl: bool, started: bool) -> Self {
        let temp = tempfile::tempdir().unwrap();
        let paths = Paths::isolated_in(temp.path());
        fs::create_dir_all(&paths.data_dir).unwrap();
        fs::write(
            paths.data_dir.join(MARKER_FILE),
            serde_json::to_vec(&json!({ "managedBy": "cloudlink", "kind": "data" })).unwrap(),
        )
        .unwrap();
        let system = Arc::new(FakeSystem {
            distros: if wsl { vec!["Ubuntu-24.04".into()] } else { Vec::new() },
            interop: true,
            agent_keys: Some(1),
        });
        for environment in env::detect(&paths, system.as_ref()) {
            for directory in [".ssh", ".claude", ".codex"] {
                fs::create_dir_all(environment.host_in_home(&[directory])).unwrap();
            }
            fs::write(environment.host_in_home(&[".ssh", "config"]), user_config(&environment)).unwrap();
            fs::write(
                environment.host_in_home(&[".ssh", "fixture-key"]),
                "unusable fixture key\n",
            )
            .unwrap();
            let neighbor = environment.host_in_home(&[".claude", "skills", "user-skill", "SKILL.md"]);
            fs::create_dir_all(neighbor.parent().unwrap()).unwrap();
            fs::write(neighbor, "keep this neighboring user skill\n").unwrap();
        }
        let credentials = Arc::new(MemoryCredentialStore::default());
        let events = Arc::new(RecordingEvents::default());
        let backend = if started {
            Backend::with_services(
                paths.clone(),
                system,
                credentials.clone(),
                cli::Service::new(runner),
                events.clone(),
            )
        } else {
            Backend::assemble(
                paths.clone(),
                system,
                credentials.clone(),
                cli::Service::new(runner),
                events.clone(),
                Arc::new(super::feedback::NoProcessSelfTest),
            )
        }
        .unwrap();
        Self {
            backend,
            paths,
            credentials,
            events,
            _temp: temp,
        }
    }

    fn server(&self) -> ServerAsset {
        let mut server = crate::testkit::dev_box();
        server.connection.host = Some("203.0.113.10".into());
        server.connection.defined_in = vec![EnvId::windows()];
        let auth = server.connection.auth.as_mut().unwrap();
        auth.identity_file = BTreeMap::from([(
            EnvId::windows(),
            self.paths
                .user_home
                .join(".ssh")
                .join("fixture-key")
                .to_string_lossy()
                .into_owned(),
        )]);
        auth.generated_by_cloud_link = false;
        server
    }

    fn seed_ready_server(&self) -> Asset {
        let server = self.server();
        let input = server_input(&server, Some(&server.id));
        self.backend
            .database()
            .unwrap()
            .upsert_asset(&Asset::Vps(server))
            .unwrap();
        let saved = self.backend.save_asset(AssetInput::Vps(input)).unwrap().asset;
        assert!(saved.as_server().unwrap().connection.verified.as_ref().unwrap().ok);
        assert!(self.destination(&self.target()).join("SKILL.md").is_file());
        saved
    }

    fn target(&self) -> Target {
        self.backend
            .list_targets()
            .unwrap()
            .into_iter()
            .find(|target| target.env_id == EnvId::windows() && target.agent == AgentId::ClaudeCode)
            .unwrap()
    }

    fn destination(&self, target: &Target) -> PathBuf {
        let environment = self.backend.context(&target.env_id).unwrap();
        crate::deliver::resolve_target_path(&self.paths, &environment, target)
            .unwrap()
            .join(SKILL_DIR)
    }

    fn source(&self, target: &Target) -> PathBuf {
        publish::output_dir(&self.paths.compiled_dir(), &target.env_id, &target.agent_key)
    }

    fn replace_owned_file(&self, directory: &Path, target: &Target, name: &str, content: &[u8]) {
        let temp_root = crate::deliver::paths::canonical_future(self._temp.path()).unwrap();
        assert!(directory.starts_with(&temp_root));
        let marker = publish::read_marker(directory).expect("fixture must own this tree before simulating an edit");
        assert_eq!(marker.env_id, target.env_id.as_str());
        assert_eq!(marker.agent_key, target.agent_key);
        let path = directory.join(name);
        assert!(!fsx::path_is_link(&path));
        if let Ok(metadata) = fs::symlink_metadata(&path) {
            assert!(metadata.is_file() && !fsx::is_link(&metadata));
        }
        fs::write(path, content).unwrap();
    }

    fn assert_neighbors_untouched(&self) {
        for environment in self.backend.contexts(false).unwrap() {
            assert_eq!(
                fs::read_to_string(environment.host_in_home(&[".ssh", "config"])).unwrap(),
                user_config(&environment)
            );
            assert_eq!(
                fs::read_to_string(environment.host_in_home(&[".claude", "skills", "user-skill", "SKILL.md"])).unwrap(),
                "keep this neighboring user skill\n",
            );
        }
    }
}

#[test]
fn isolated_include_status_and_reset_keep_original_backup_bytes() {
    let fixture = Fixture::with_runner(Arc::new(cli::EmptyRunner), true);
    let environments = fixture.backend.contexts(false).unwrap();
    let original = "\u{feff}# user-owned settings\r\nHost mine\r\n  HostName 127.0.0.1\r\n";
    let mut written = Vec::new();
    for environment in &environments {
        let config = environment.host_in_home(&[".ssh", "config"]);
        fs::write(&config, original).unwrap();
        assert!(
            !fixture
                .backend
                .get_ssh_config_status()
                .unwrap()
                .iter()
                .find(|status| status.env_id == environment.id)
                .unwrap()
                .included
        );
        let status = fixture.backend.add_ssh_include(&environment.id).unwrap();
        let expected_line = crate::ssh::managed::include_line(
            &environment.managed_config_native(),
            crate::ssh::managed::IncludeMode::Isolated,
        )
        .unwrap();
        assert!(status.included);
        assert_eq!(status.include_line, expected_line);
        let text = fs::read_to_string(&config).unwrap();
        assert_eq!(
            text,
            format!(
                "\u{feff}{expected_line}\r\n\r\n{}",
                original.trim_start_matches('\u{feff}')
            )
        );
        let backup = config.with_file_name("config.cloudlink-bak");
        assert_eq!(fs::read(&backup).unwrap(), original.as_bytes());
        fixture.backend.add_ssh_include(&environment.id).unwrap();
        assert!(!config.with_file_name("config.cloudlink-bak-2").exists());
        written.push((config, backup, text));
    }
    fixture.backend.reset_data().unwrap();
    for (config, backup, text) in written {
        assert_eq!(fs::read_to_string(config).unwrap(), text);
        assert_eq!(fs::read(backup).unwrap(), original.as_bytes());
    }
}

fn server_input(server: &ServerAsset, id: Option<&str>) -> ServerAssetInput {
    let connection = match server.connection.source {
        ConnectionSource::Managed => {
            let auth = server.connection.auth.as_ref().unwrap();
            ConnectionInput::Managed {
                ssh_alias: server.connection.ssh_alias.clone(),
                host: server.connection.host.clone().unwrap(),
                port: server.connection.port.unwrap(),
                user: server.connection.user.clone().unwrap(),
                auth: AuthInput {
                    method: auth.method,
                    identity_file: auth.identity_file.clone(),
                },
                proxy_jump: server.connection.proxy_jump.clone().flatten(),
                defined_in: server.connection.defined_in.clone(),
            }
        }
        ConnectionSource::Imported => ConnectionInput::Imported {
            ssh_alias: server.connection.ssh_alias.clone(),
        },
    };
    ServerAssetInput {
        tag: VpsTag::Tag,
        id: id.map(String::from),
        name: server.name.clone(),
        production: server.production,
        summary: server.summary.clone(),
        guardrails: server.guardrails.clone(),
        notes: server.notes.clone(),
        provider: server.provider.clone(),
        region: server.region.clone(),
        tags: server.tags.clone(),
        connection,
        facts: server.facts.clone(),
        paths: server.paths.clone(),
        services: server.services.clone(),
        served_hostnames: server.served_hostnames.clone(),
        listening_ports: server.listening_ports.clone(),
        export: server.export.clone(),
        test_id: None,
    }
}

fn cli_input(account: &str, scope: Option<Vec<CliScopeItem>>) -> CliAssetInput {
    CliAssetInput {
        tag: CliTag::Tag,
        id: None,
        name: "Cloudflare".into(),
        production: true,
        summary: "DNS and Workers".into(),
        guardrails: Guardrails::default(),
        notes: String::new(),
        cli_provider: CliProvider::Cloudflare,
        account: Some(account.into()),
        scope,
    }
}

fn cli_request(account: Option<&str>, asset_id: Option<&str>) -> CliRequest {
    CliRequest {
        provider: CliProvider::Cloudflare,
        account: account.map(String::from),
        asset_id: asset_id.map(String::from),
    }
}

fn assert_ipc<T>(result: Result<T>, expected: IpcErrorId) {
    match result {
        Err(error) => assert!(error.is_ipc(expected), "expected {expected:?}, received {error:?}"),
        Ok(_) => panic!("expected {expected:?}, operation succeeded"),
    }
}

fn tree_bytes(root: &Path) -> BTreeMap<PathBuf, Vec<u8>> {
    fn walk(root: &Path, current: &Path, files: &mut BTreeMap<PathBuf, Vec<u8>>) {
        for entry in fs::read_dir(current).unwrap() {
            let path = entry.unwrap().path();
            let metadata = fs::symlink_metadata(&path).unwrap();
            assert!(!fsx::is_link(&metadata));
            if metadata.is_dir() {
                walk(root, &path, files);
            } else {
                assert!(metadata.is_file());
                files.insert(path.strip_prefix(root).unwrap().to_path_buf(), fs::read(path).unwrap());
            }
        }
    }
    let mut files = BTreeMap::new();
    walk(root, root, &mut files);
    files
}

#[test]
fn offline_servers_cannot_enable_agents_and_previous_authorization_does_not_bypass_verification() {
    let fixture = Fixture::new();
    let input = server_input(&fixture.server(), None);
    let saved = fixture.backend.save_asset(AssetInput::Vps(input)).unwrap().asset;
    assert!(saved.as_server().unwrap().connection.verified.is_none());
    assert_ipc(
        fixture.backend.set_distribute(saved.id(), "claude-code", true),
        IpcErrorId::CannotDistribute,
    );
    assert!(
        fixture
            .backend
            .database()
            .unwrap()
            .require_asset(saved.id())
            .unwrap()
            .agent()
            .agents
            .is_empty()
    );

    let mut previously_authorized = saved.clone();
    previously_authorized.agent_mut().agents.push("claude-code".into());
    fixture
        .backend
        .database()
        .unwrap()
        .upsert_asset(&previously_authorized)
        .unwrap();
    fixture.backend.check_deliveries().unwrap();
    let inclusion = fixture
        .backend
        .list_inclusions()
        .unwrap()
        .into_iter()
        .find(|item| item.asset_id == saved.id() && item.env_id == EnvId::windows() && item.agent_key == "claude-code")
        .unwrap();
    assert!(!inclusion.included);
    assert_eq!(inclusion.reason.unwrap().id, InclusionReasonId::Unverified);
    fixture
        .backend
        .set_distribute(saved.id(), "claude-code", false)
        .unwrap();
    assert!(!fixture.destination(&fixture.target()).exists());
    fixture.assert_neighbors_untouched();
}

#[test]
fn invoke_payload_cannot_supply_its_own_verification_or_authorization() {
    let fixture = Fixture::new();
    let mut payload = serde_json::to_value(server_input(&fixture.server(), None)).unwrap();
    payload["connection"]["verified"] = json!({ "ok": true, "at": crate::testkit::NOW, "envIds": ["windows"] });
    payload["connection"]["resolved"] = json!({ "hostname": "203.0.113.10", "user": "root", "port": 22 });
    payload["agent"] = json!({ "agents": ["claude-code"], "mode": "standard" });
    match serde_json::from_value::<AssetInput>(payload) {
        Ok(input) => {
            let saved = fixture.backend.save_asset(input).unwrap().asset;
            let connection = &saved.as_server().unwrap().connection;
            assert!(connection.verified.is_none());
            assert!(connection.resolved.is_none());
            assert!(saved.agent().agents.is_empty());
            assert_ipc(
                fixture.backend.set_distribute(saved.id(), "claude-code", true),
                IpcErrorId::CannotDistribute,
            );
        }
        Err(_) => assert!(fixture.backend.list_assets().unwrap().is_empty()),
    }
    assert!(!fixture.destination(&fixture.target()).exists());
}

#[test]
fn unknown_proof_is_rejected_before_persisting_a_server() {
    let fixture = Fixture::new();
    let mut input = server_input(&fixture.server(), None);
    input.test_id = Some("test_fabricated_by_invoke".into());
    assert_ipc(fixture.backend.save_asset(AssetInput::Vps(input)), IpcErrorId::NotFound);
    assert!(fixture.backend.list_assets().unwrap().is_empty());
    assert!(!fixture.paths.user_home.join(".ssh").join("cloudlink.conf").exists());
}

#[test]
fn summary_edits_keep_verified_connection_but_changed_connection_requires_a_new_proof() {
    let fixture = Fixture::new();
    let ready = fixture.seed_ready_server();
    let mut input = server_input(ready.as_server().unwrap(), Some(ready.id()));
    input.summary = "Updated documentation for this server".into();
    let documented = fixture.backend.save_asset(AssetInput::Vps(input)).unwrap().asset;
    assert_eq!(
        documented.as_server().unwrap().connection.verified,
        ready.as_server().unwrap().connection.verified
    );

    let mut input = server_input(documented.as_server().unwrap(), Some(documented.id()));
    let ConnectionInput::Managed { host, .. } = &mut input.connection else {
        unreachable!()
    };
    *host = "198.51.100.44".into();
    let changed = fixture.backend.save_asset(AssetInput::Vps(input)).unwrap().asset;
    assert!(changed.as_server().unwrap().connection.verified.is_none());
    assert!(changed.as_server().unwrap().connection.resolved.is_none());
    assert_ipc(
        fixture.backend.set_distribute(changed.id(), "universal", true),
        IpcErrorId::CannotDistribute,
    );
    assert!(
        fixture
            .backend
            .list_inclusions()
            .unwrap()
            .iter()
            .filter(|item| item.asset_id == changed.id())
            .all(|item| !item.included)
    );
    assert!(!fixture.destination(&fixture.target()).exists());
    fixture.assert_neighbors_untouched();
}

#[test]
fn checking_rewrites_a_missing_delivery_without_republishing_the_source() {
    let fixture = Fixture::new();
    fixture.seed_ready_server();
    let target = fixture.target();
    let destination = fixture.destination(&target);
    let source = fixture.source(&target);
    let before = tree_bytes(&source);
    let statuses = fixture.backend.get_compile_status().unwrap();
    let environment = fixture.backend.context(&target.env_id).unwrap();
    assert!(crate::deliver::remove(&fixture.paths, &environment, &target).unwrap());
    fixture.events.clear();

    let checked = fixture.backend.check_deliveries().unwrap();
    let restored = checked.iter().find(|delivery| delivery.target_id == target.id).unwrap();
    assert_eq!(restored.status, DeliveryStatus::Ok);
    assert_eq!(tree_bytes(&destination), before);
    assert_eq!(tree_bytes(&source), before);
    assert_eq!(fixture.backend.get_compile_status().unwrap(), statuses);
    assert!(!fixture.events.contains("compile://finished"));
    assert!(fixture.events.contains("deliveries://changed"));
    // A missing copy has nothing to back up.
    assert!(!fixture.events.contains("deliveries://backed-up"));
    assert!(!fixture.paths.backups_dir().exists());
    fixture.assert_neighbors_untouched();
}

fn backup_id_from_events(fixture: &Fixture) -> String {
    fixture
        .events
        .payloads("deliveries://backed-up")
        .last()
        .and_then(|p| p.get("backupId").and_then(|v| v.as_str()).map(str::to_string))
        .expect("a backup event")
}

#[test]
fn modified_copy_is_backed_up_restored_and_undo_writes_the_edit_back_and_pauses_the_target() {
    let fixture = Fixture::new();
    fixture.seed_ready_server();
    let target = fixture.target();
    let destination = fixture.destination(&target);
    let source = fixture.source(&target);
    fixture.replace_owned_file(
        &destination,
        &target,
        "SKILL.md",
        b"external edit
",
    );
    fixture.replace_owned_file(
        &destination,
        &target,
        "references/external.md",
        b"external additional file
",
    );
    let edited = tree_bytes(&destination);
    fixture.events.clear();

    let checked = fixture.backend.check_deliveries().unwrap();
    assert_eq!(
        checked.iter().find(|d| d.target_id == target.id).unwrap().status,
        DeliveryStatus::Ok
    );
    assert_eq!(tree_bytes(&destination), tree_bytes(&source));
    let backup_id = backup_id_from_events(&fixture);
    let saved = fixture
        .paths
        .backups_dir()
        .join(&backup_id)
        .join(&target.id)
        .join(publish::SKILL_DIR);
    assert_eq!(
        fs::read(saved.join("SKILL.md")).unwrap(),
        b"external edit
"
        .to_vec()
    );
    assert!(saved.join("references/external.md").is_file());
    assert!(
        fixture
            .backend
            .list_activity(ActivityQuery {
                before: None,
                limit: 50,
                kinds: None,
                asset_id: None
            })
            .unwrap()
            .iter()
            .any(|a| a.message_id == ActivityMessageId::CopyRestored)
    );

    let paused = fixture.backend.undo_backup(&backup_id).unwrap();
    assert!(!paused.enabled);
    assert_eq!(tree_bytes(&destination), edited);
    // A paused target is neither checked nor overwritten again.
    fixture.backend.check_deliveries().unwrap();
    assert_eq!(tree_bytes(&destination), edited);
    assert!(
        fixture
            .backend
            .list_deliveries()
            .unwrap()
            .iter()
            .all(|d| d.target_id != target.id)
    );
    // Undo validates the backup id; separators and unknown ids are rejected.
    assert_ipc(fixture.backend.undo_backup("../x"), IpcErrorId::NotFound);
    assert_ipc(fixture.backend.undo_backup("missing-id"), IpcErrorId::NotFound);
    fixture.assert_neighbors_untouched();
}

#[test]
fn foreign_same_name_skill_is_untouched_until_take_over_which_backs_it_up_and_can_be_undone() {
    let fixture = Fixture::new();
    fixture.seed_ready_server();
    let target = fixture.target();
    let destination = fixture.destination(&target);
    let mut marker = publish::read_marker(&destination).unwrap();
    marker.managed_by = "someone-else".into();
    fixture.replace_owned_file(
        &destination,
        &target,
        MARKER_FILE,
        &serde_json::to_vec(&marker).unwrap(),
    );
    let foreign = tree_bytes(&destination);

    let checked = fixture.backend.check_deliveries().unwrap();
    let conflict = checked.iter().find(|delivery| delivery.target_id == target.id).unwrap();
    assert_eq!(conflict.status, DeliveryStatus::Conflict);
    assert_eq!(tree_bytes(&destination), foreign);
    assert_ipc(
        fixture.backend.set_target_enabled(&target.id, false),
        IpcErrorId::TargetExists,
    );
    assert!(fixture.backend.require_target(&target.id).unwrap().enabled);
    assert_eq!(tree_bytes(&destination), foreign);

    fixture.events.clear();
    let taken = fixture.backend.take_over_target(&target.id).unwrap();
    assert_eq!(taken.status, DeliveryStatus::Ok);
    assert_eq!(tree_bytes(&destination), tree_bytes(&fixture.source(&target)));
    let backup_id = backup_id_from_events(&fixture);
    // Taking over twice is refused: the directory is CloudLink's now.
    assert_ipc(fixture.backend.take_over_target(&target.id), IpcErrorId::NotFound);

    let paused = fixture.backend.undo_backup(&backup_id).unwrap();
    assert!(!paused.enabled);
    assert_eq!(tree_bytes(&destination), foreign);
    fixture.assert_neighbors_untouched();
}

#[test]
fn take_over_refuses_a_healthy_copy_and_a_tampered_compiled_source() {
    let fixture = Fixture::new();
    fixture.seed_ready_server();
    let target = fixture.target();
    let destination = fixture.destination(&target);
    let before = tree_bytes(&destination);
    assert_ipc(fixture.backend.take_over_target(&target.id), IpcErrorId::NotFound);

    let source = fixture.source(&target);
    fixture.replace_owned_file(
        &source,
        &target,
        "SKILL.md",
        b"tampered source
",
    );
    let tampered = tree_bytes(&source);
    assert_ipc(fixture.backend.take_over_target(&target.id), IpcErrorId::SourceMissing);
    assert_eq!(tree_bytes(&destination), before);
    assert_eq!(tree_bytes(&source), tampered);
}

#[test]
fn generated_key_receipts_do_not_authorize_deletion_when_data_ownership_changes() {
    let fixture = Fixture::new();
    let ready = fixture.seed_ready_server();
    let key = fixture.paths.user_home.join(".ssh").join("fixture-key");
    let public_key = crate::secret::keygen::pub_path(&key);
    fs::write(&public_key, "unusable fixture public key\n").unwrap();
    fixture.backend.record_generated_key(ready.id(), &key).unwrap();
    let private_before = fs::read(&key).unwrap();
    let public_before = fs::read(&public_key).unwrap();
    let marker_path = fixture.paths.data_dir.join(MARKER_FILE);
    let owned: Value = serde_json::from_slice(&fs::read(&marker_path).unwrap()).unwrap();
    assert_eq!(owned["managedBy"], "cloudlink");
    assert_eq!(owned["kind"], "data");
    assert!(!fsx::path_is_link(&marker_path));
    fs::write(
        &marker_path,
        serde_json::to_vec(&json!({ "managedBy": "someone-else", "kind": "data" })).unwrap(),
    )
    .unwrap();

    assert_ipc(
        fixture.backend.delete_asset(ready.id(), true),
        IpcErrorId::SettingsInvalid,
    );
    assert_eq!(
        fixture.backend.database().unwrap().require_asset(ready.id()).unwrap(),
        ready
    );
    assert_eq!(fs::read(&key).unwrap(), private_before);
    assert_eq!(fs::read(&public_key).unwrap(), public_before);
}

#[test]
fn custom_targets_reject_existing_target_overlap_and_protected_directories() {
    let fixture = Fixture::new();
    let before = fixture.backend.list_targets().unwrap();
    for candidate in [
        fixture.paths.user_home.join(".claude"),
        fixture.paths.user_home.join(".claude").join("skills").join("nested"),
        fixture.paths.user_home.join(".ssh").join("nested"),
        fixture.paths.compiled_dir().join("nested"),
    ] {
        assert_ipc(
            fixture.backend.add_custom_target(AddCustomTargetRequest {
                env_id: EnvId::windows(),
                label: "Editor".into(),
                path: candidate.to_string_lossy().into_owned(),
            }),
            IpcErrorId::TargetExists,
        );
    }
    assert_eq!(fixture.backend.list_targets().unwrap(), before);

    let path = fixture.paths.user_home.join("editor-skills");
    let added = fixture
        .backend
        .add_custom_target(AddCustomTargetRequest {
            env_id: EnvId::windows(),
            label: "Editor".into(),
            path: path.to_string_lossy().into_owned(),
        })
        .unwrap();
    assert_ipc(
        fixture.backend.add_custom_target(AddCustomTargetRequest {
            env_id: EnvId::windows(),
            label: "Nested editor".into(),
            path: path.join("nested").to_string_lossy().into_owned(),
        }),
        IpcErrorId::TargetExists,
    );
    // P8a：同一个真实目录允许多个动态目标共用，嵌套仍拒绝。
    let same = fixture
        .backend
        .add_custom_target(AddCustomTargetRequest {
            env_id: EnvId::windows(),
            label: "Another editor".into(),
            path: path.to_string_lossy().into_owned(),
        })
        .unwrap();
    fixture.backend.remove_custom_target(&same.id).unwrap();
    fixture.backend.remove_custom_target(&added.id).unwrap();
    assert_eq!(fixture.backend.list_targets().unwrap(), before);
    fixture.assert_neighbors_untouched();
}

#[test]
fn scope_payload_uses_trusted_account_metadata_and_rejects_cross_account_ids() {
    let runner = Arc::new(MetadataRunner::default());
    let fixture = Fixture::with_runner(runner.clone(), false);
    let server = fixture.seed_ready_server();
    fixture.backend.detect_cli_environment(cli_request(None, None)).unwrap();
    let catalog_a = fixture
        .backend
        .refresh_cli_scope(cli_request(Some(ACCOUNT_A), None))
        .unwrap();
    let catalog_b = fixture
        .backend
        .refresh_cli_scope(cli_request(Some(ACCOUNT_B), None))
        .unwrap();
    let mut forged = catalog_a.iter().find(|item| item.id == "zone:a").unwrap().clone();
    forged.name = "attacker-name".into();
    forged.kind = CliScopeKind::Instance;
    forged.linked_asset_id = Some("attacker-link".into());
    forged.address = Some("198.51.100.200".into());
    forged.selected = true;
    let saved_a = fixture
        .backend
        .save_asset(AssetInput::Cli(cli_input(ACCOUNT_A, Some(vec![forged]))))
        .unwrap()
        .asset;
    let trusted = saved_a
        .as_cli()
        .unwrap()
        .cli
        .scope
        .iter()
        .find(|item| item.id == "zone:a")
        .unwrap();
    assert_eq!(trusted.name, "example.test");
    assert_eq!(trusted.kind, CliScopeKind::Zone);
    assert_eq!(trusted.linked_asset_id.as_deref(), Some(server.id()));
    assert!(trusted.address.is_none());
    assert!(trusted.selected);

    assert_ipc(
        fixture
            .backend
            .save_asset(AssetInput::Cli(cli_input(ACCOUNT_B, Some(catalog_a)))),
        IpcErrorId::CliScopeFailed,
    );
    runner.calls.lock().unwrap().clear();
    assert_ipc(
        fixture.backend.set_cli_scope(saved_a.id(), &["zone:b".into()]),
        IpcErrorId::CliScopeFailed,
    );
    assert!(
        runner.calls.lock().unwrap().is_empty(),
        "invalid scope must not refresh account state"
    );
    assert_eq!(
        fixture.backend.database().unwrap().require_asset(saved_a.id()).unwrap(),
        saved_a
    );
    let saved_b = fixture
        .backend
        .save_asset(AssetInput::Cli(cli_input(ACCOUNT_B, Some(catalog_b))))
        .unwrap()
        .asset;
    assert_ne!(saved_a.handle(), saved_b.handle());
    assert_ipc(
        fixture.backend.save_asset(AssetInput::Cli(cli_input(ACCOUNT_A, None))),
        IpcErrorId::AliasTaken,
    );
}

#[test]
fn saved_account_controls_requests_and_per_environment_inclusion() {
    let runner = Arc::new(MetadataRunner::default());
    let fixture = Fixture::with_runner(runner.clone(), true);
    fixture.backend.detect_cli_environment(cli_request(None, None)).unwrap();
    let mut catalog = fixture
        .backend
        .refresh_cli_scope(cli_request(Some(ACCOUNT_B), None))
        .unwrap();
    catalog[0].selected = true;
    let saved = fixture
        .backend
        .save_asset(AssetInput::Cli(cli_input(ACCOUNT_B, Some(catalog))))
        .unwrap()
        .asset;
    let inclusions = fixture
        .backend
        .set_distribute(saved.id(), "claude-code", true)
        .unwrap()
        .inclusions;
    assert!(
        inclusions
            .iter()
            .find(|item| item.env_id == EnvId::windows() && item.agent_key == "claude-code")
            .unwrap()
            .included
    );
    let wsl = inclusions
        .iter()
        .find(|item| item.env_id == EnvId::wsl("Ubuntu-24.04") && item.agent_key == "claude-code")
        .unwrap();
    assert!(!wsl.included);
    assert_eq!(wsl.reason.as_ref().unwrap().id, InclusionReasonId::CliNotLoggedIn);

    runner.calls.lock().unwrap().clear();
    let scope = fixture
        .backend
        .refresh_cli_scope(cli_request(Some(ACCOUNT_A), Some(saved.id())))
        .unwrap();
    assert_eq!(scope.len(), 1);
    assert_eq!(scope[0].id, "zone:b");
    assert!(scope[0].selected);
    assert!(runner.calls.lock().unwrap().iter().all(|(env_id, query)| {
        env_id == &EnvId::windows() && matches!(query, Query::Scope { account, .. } if account == ACCOUNT_B)
    }));
    fixture.assert_neighbors_untouched();
}

#[test]
fn withdrawn_account_invalidates_catalog_and_blocks_new_authorization() {
    let runner = Arc::new(MetadataRunner::default());
    let fixture = Fixture::with_runner(runner.clone(), false);
    fixture.backend.detect_cli_environment(cli_request(None, None)).unwrap();
    let mut catalog = fixture
        .backend
        .refresh_cli_scope(cli_request(Some(ACCOUNT_B), None))
        .unwrap();
    catalog[0].selected = true;
    let saved = fixture
        .backend
        .save_asset(AssetInput::Cli(cli_input(ACCOUNT_B, Some(catalog.clone()))))
        .unwrap()
        .asset;
    fixture.backend.set_distribute(saved.id(), "claude-code", true).unwrap();

    runner.withdraw_business.store(true, Ordering::SeqCst);
    let states = fixture
        .backend
        .detect_cli_environment(cli_request(Some(ACCOUNT_A), Some(saved.id())))
        .unwrap();
    assert!(states.values().all(|state| !state.authenticated));
    assert_ipc(
        fixture
            .backend
            .refresh_cli_scope(cli_request(Some(ACCOUNT_A), Some(saved.id()))),
        IpcErrorId::CliAccountUnavailable,
    );
    assert_ipc(
        fixture.backend.set_distribute(saved.id(), "universal", true),
        IpcErrorId::CannotDistribute,
    );
    let mut draft = cli_input(ACCOUNT_B, Some(catalog));
    draft.id = Some(saved.id().into());
    assert_ipc(
        fixture.backend.save_asset(AssetInput::Cli(draft)),
        IpcErrorId::CliAccountUnavailable,
    );
    assert!(
        fixture
            .backend
            .list_inclusions()
            .unwrap()
            .iter()
            .filter(|item| item.asset_id == saved.id())
            .all(|item| !item.included)
    );
    fixture
        .backend
        .set_distribute(saved.id(), "claude-code", false)
        .unwrap();
}

#[test]
fn failed_scope_refresh_keeps_saved_selection_and_prevents_stale_catalog_save() {
    let runner = Arc::new(MetadataRunner::default());
    let fixture = Fixture::with_runner(runner.clone(), false);
    fixture.backend.detect_cli_environment(cli_request(None, None)).unwrap();
    let mut catalog = fixture
        .backend
        .refresh_cli_scope(cli_request(Some(ACCOUNT_A), None))
        .unwrap();
    catalog[0].selected = true;
    let saved = fixture
        .backend
        .save_asset(AssetInput::Cli(cli_input(ACCOUNT_A, Some(catalog.clone()))))
        .unwrap()
        .asset;
    runner.deny_scope.store(true, Ordering::SeqCst);

    assert_ipc(
        fixture.backend.refresh_cli_scope(cli_request(None, Some(saved.id()))),
        IpcErrorId::CliScopePermission,
    );
    assert_eq!(
        fixture.backend.database().unwrap().require_asset(saved.id()).unwrap(),
        saved
    );
    let mut draft = cli_input(ACCOUNT_A, Some(catalog));
    draft.id = Some(saved.id().into());
    assert_ipc(
        fixture.backend.save_asset(AssetInput::Cli(draft)),
        IpcErrorId::CliScopeFailed,
    );
    let mut documentation = cli_input(ACCOUNT_A, None);
    documentation.id = Some(saved.id().into());
    documentation.summary = "Documentation can still be edited while the provider is unavailable".into();
    let edited = fixture
        .backend
        .save_asset(AssetInput::Cli(documentation))
        .unwrap()
        .asset;
    assert_eq!(edited.as_cli().unwrap().cli.scope, saved.as_cli().unwrap().cli.scope);
}

#[test]
fn cli_detection_skips_disabled_environments_and_environments_without_enabled_agents() {
    let runner = Arc::new(MetadataRunner::default());
    let fixture = Fixture::with_runner(runner.clone(), true);
    let mut environments = fixture.backend.get_settings().unwrap().environments;
    environments
        .iter_mut()
        .find(|setting| setting.id == EnvId::wsl("Ubuntu-24.04"))
        .unwrap()
        .enabled = false;
    fixture
        .backend
        .update_settings(SettingsPatch {
            environments: Some(environments),
            ..Default::default()
        })
        .unwrap();
    runner.calls.lock().unwrap().clear();
    let states = fixture.backend.detect_cli_environment(cli_request(None, None)).unwrap();
    assert_eq!(states.keys().cloned().collect::<Vec<_>>(), vec![EnvId::windows()]);
    assert!(
        runner
            .calls
            .lock()
            .unwrap()
            .iter()
            .all(|(env_id, _)| env_id == &EnvId::windows())
    );

    for target in fixture
        .backend
        .list_targets()
        .unwrap()
        .into_iter()
        .filter(|target| target.env_id == EnvId::windows())
    {
        fixture.backend.set_target_enabled(&target.id, false).unwrap();
    }
    runner.calls.lock().unwrap().clear();
    assert!(
        fixture
            .backend
            .detect_cli_environment(cli_request(None, None))
            .unwrap()
            .is_empty()
    );
    assert!(runner.calls.lock().unwrap().is_empty());
}

#[test]
fn saved_password_uses_only_injected_store_and_is_absent_from_assets_and_events() {
    let fixture = Fixture::new();
    let mut input = server_input(&fixture.server(), None);
    let ConnectionInput::Managed { auth, .. } = &mut input.connection else {
        unreachable!()
    };
    auth.method = AuthMethod::Password;
    auth.identity_file.clear();
    let saved = fixture.backend.save_asset(AssetInput::Vps(input)).unwrap().asset;
    let password = "isolated-password-placeholder";
    fixture.backend.set_password(saved.id(), Some(password.into())).unwrap();
    let key = fixture
        .backend
        .database()
        .unwrap()
        .password_ref(saved.id())
        .unwrap()
        .unwrap();
    assert_eq!(fixture.credentials.get(&key).unwrap().unwrap().expose(), password);
    let asset = fixture.backend.database().unwrap().require_asset(saved.id()).unwrap();
    assert!(
        asset
            .as_server()
            .unwrap()
            .connection
            .auth
            .as_ref()
            .unwrap()
            .password_saved
    );
    assert!(!serde_json::to_string(&asset).unwrap().contains(password));
    assert!(
        fixture
            .events
            .items
            .lock()
            .unwrap()
            .iter()
            .all(|(_, payload)| !payload.to_string().contains(password))
    );
    fixture.backend.delete_asset(saved.id(), false).unwrap();
    assert!(fixture.credentials.get(&key).unwrap().is_none());
    fixture.assert_neighbors_untouched();
}

fn seed_ready_server_with(fixture: &Fixture, server: ServerAsset) -> Asset {
    let input = server_input(&server, Some(&server.id));
    fixture
        .backend
        .database()
        .unwrap()
        .upsert_asset(&Asset::Vps(server))
        .unwrap();
    fixture.backend.save_asset(AssetInput::Vps(input)).unwrap().asset
}

fn seed_secondary_server(fixture: &Fixture) -> Asset {
    let mut server = fixture.server();
    server.id = "ast_secondary_fixture".into();
    server.name = "Secondary server".into();
    server.connection.ssh_alias = "secondary-box".into();
    server.connection.host = Some("198.51.100.20".into());
    seed_ready_server_with(fixture, server)
}

#[test]
fn draft_preview_keeps_other_resources_and_matches_saved_publication_bytes() {
    let fixture = Fixture::new();
    let first = fixture.seed_ready_server();
    let second = seed_secondary_server(&fixture);
    let target = fixture.target();
    let source = fixture.source(&target);
    let before = tree_bytes(&source);
    let mut draft = server_input(first.as_server().unwrap(), Some(first.id()));
    draft.summary = "Updated draft documentation".into();
    let preview = fixture
        .backend
        .preview_skill(crate::model::compile::PreviewRequest {
            env_id: target.env_id.clone(),
            agent_key: target.agent_key.clone(),
            asset: Some(AssetInput::Vps(draft.clone())),
            config: None,
        })
        .unwrap();
    assert!(!preview.blocked);
    assert!(
        preview
            .files
            .iter()
            .any(|file| file.path == format!("references/{}.md", second.handle()))
    );
    assert_eq!(
        tree_bytes(&source),
        before,
        "preview must not publish or write the draft"
    );
    assert_eq!(
        fixture.backend.database().unwrap().require_asset(first.id()).unwrap(),
        first
    );
    let saved = fixture.backend.save_asset(AssetInput::Vps(draft)).unwrap();
    assert!(saved.statuses.iter().all(|status| !status.blocked));
    let (_, published) = crate::deliver::load_source(&fixture.paths, &target.env_id, &target.agent_key)
        .unwrap()
        .unwrap();
    let files = |files: Vec<crate::model::compile::CompiledFile>| {
        files
            .into_iter()
            .map(|f| (f.path, f.content))
            .collect::<BTreeMap<_, _>>()
    };
    assert_eq!(files(preview.files), files(published));
    fixture.assert_neighbors_untouched();
}

#[test]
fn preview_can_force_an_unselected_draft_without_dropping_other_included_resources() {
    let fixture = Fixture::new();
    let first = fixture.seed_ready_server();
    let second = seed_secondary_server(&fixture);
    let target = fixture.target();
    fixture
        .backend
        .set_distribute(first.id(), &target.agent_key, false)
        .unwrap();
    let current = fixture.backend.database().unwrap().require_asset(first.id()).unwrap();
    let source = tree_bytes(&fixture.source(&target));
    let preview = fixture
        .backend
        .preview_skill(crate::model::compile::PreviewRequest {
            env_id: target.env_id.clone(),
            agent_key: target.agent_key.clone(),
            asset: Some(AssetInput::Vps(server_input(
                current.as_server().unwrap(),
                Some(current.id()),
            ))),
            config: None,
        })
        .unwrap();
    for asset in [&current, &second] {
        assert!(
            preview
                .files
                .iter()
                .any(|file| file.path == format!("references/{}.md", asset.handle()))
        );
    }
    assert_eq!(tree_bytes(&fixture.source(&target)), source);
    fixture.assert_neighbors_untouched();
}

fn block_notes_preserving_last_success(
    fixture: &Fixture,
    asset: &Asset,
    target: &Target,
    last_success: &BTreeMap<PathBuf, Vec<u8>>,
) {
    let copied = tree_bytes(&fixture.destination(target));
    let successful_status = fixture
        .backend
        .get_compile_status()
        .unwrap()
        .into_iter()
        .find(|status| status.env_id == target.env_id && status.agent_key == target.agent_key)
        .unwrap();
    assert!(!successful_status.blocked);
    let mut input = server_input(asset.as_server().unwrap(), Some(asset.id()));
    input.notes = format!("{}=x", "password");
    let saved = fixture.backend.save_asset(AssetInput::Vps(input)).unwrap();
    let blocked = saved
        .statuses
        .iter()
        .find(|status| status.env_id == target.env_id && status.agent_key == target.agent_key)
        .unwrap();
    assert!(blocked.blocked);
    assert!(
        blocked
            .lint
            .iter()
            .any(|lint| lint.id == crate::model::compile::LintId::SecretDetected)
    );
    assert_eq!(blocked.compiled_at, successful_status.compiled_at);
    assert_eq!(tree_bytes(&fixture.source(target)), *last_success);
    assert_eq!(tree_bytes(&fixture.destination(target)), copied);
}

fn assert_blocked_withdrawal_cannot_restore_old_copy(
    fixture: &Fixture,
    target: &Target,
    last_success: &BTreeMap<PathBuf, Vec<u8>>,
) -> Target {
    assert!(!fixture.destination(target).exists());
    assert_eq!(tree_bytes(&fixture.source(target)), *last_success);
    let checked = fixture.backend.check_deliveries().unwrap();
    let withdrawn = checked.iter().find(|delivery| delivery.target_id == target.id).unwrap();
    assert_eq!(withdrawn.status, DeliveryStatus::Missing);
    assert_ipc(fixture.backend.take_over_target(&target.id), IpcErrorId::CompileBlocked);
    assert!(!fixture.destination(target).exists());
    assert_eq!(tree_bytes(&fixture.source(target)), *last_success);

    // The production API normally assigns a custom key to a new directory. A second test
    // directory for this exact unit isolates whether an old unit source can be redistributed.
    let mut additional = target.clone();
    additional.id = "tgt_added_during_blocked_compile".into();
    additional.label = "Additional fixture target".into();
    additional.path = fixture
        .paths
        .user_home
        .join("additional-skills")
        .to_string_lossy()
        .into_owned();
    additional.enabled = false;
    additional.detected = false;
    fixture.backend.database().unwrap().upsert_target(&additional).unwrap();
    fixture.backend.set_target_enabled(&additional.id, true).unwrap();
    let checked = fixture.backend.check_deliveries().unwrap();
    let new_delivery = checked
        .iter()
        .find(|delivery| delivery.target_id == additional.id)
        .unwrap();
    assert_eq!(new_delivery.status, DeliveryStatus::Missing);
    assert_ipc(
        fixture.backend.take_over_target(&additional.id),
        IpcErrorId::CompileBlocked,
    );
    assert!(!fixture.destination(target).exists());
    assert!(!fixture.destination(&additional).exists());
    assert_eq!(tree_bytes(&fixture.source(target)), *last_success);
    fixture.assert_neighbors_untouched();
    additional
}

fn clear_blocking_notes(fixture: &Fixture, asset_id: &str) {
    let asset = fixture.backend.database().unwrap().require_asset(asset_id).unwrap();
    let mut input = server_input(asset.as_server().unwrap(), Some(asset_id));
    input.notes.clear();
    let result = fixture.backend.save_asset(AssetInput::Vps(input)).unwrap();
    assert!(
        result
            .statuses
            .iter()
            .filter(|status| status.agent_key == "claude-code")
            .all(|status| !status.blocked)
    );
}

fn exercise_asset_withdrawal_during_blocked_compile(delete: bool) {
    let fixture = Fixture::new();
    let primary = fixture.seed_ready_server();
    let secondary = seed_secondary_server(&fixture);
    let target = fixture.target();
    let source = fixture.source(&target);
    let last_success = tree_bytes(&source);
    assert!(last_success.contains_key(Path::new("references/dev-box.md")));
    assert!(last_success.contains_key(Path::new("references/secondary-box.md")));
    assert_eq!(tree_bytes(&fixture.destination(&target)), last_success);
    block_notes_preserving_last_success(&fixture, &primary, &target, &last_success);

    if delete {
        fixture.backend.delete_asset(secondary.id(), false).unwrap();
        assert!(
            fixture
                .backend
                .database()
                .unwrap()
                .get_asset(secondary.id())
                .unwrap()
                .is_none()
        );
    } else {
        fixture
            .backend
            .set_distribute(secondary.id(), &target.agent_key, false)
            .unwrap();
        assert!(
            !fixture
                .backend
                .database()
                .unwrap()
                .require_asset(secondary.id())
                .unwrap()
                .agent()
                .agents
                .contains(&target.agent_key)
        );
    }
    let additional = assert_blocked_withdrawal_cannot_restore_old_copy(&fixture, &target, &last_success);
    assert!(
        fixture
            .backend
            .list_inclusions()
            .unwrap()
            .iter()
            .filter(|item| item.asset_id == secondary.id())
            .all(|item| !item.included)
    );

    clear_blocking_notes(&fixture, primary.id());
    let fresh = tree_bytes(&source);
    assert_ne!(fresh, last_success);
    assert!(!fresh.contains_key(Path::new("references/secondary-box.md")));
    assert_eq!(tree_bytes(&fixture.destination(&target)), fresh);
    assert_eq!(tree_bytes(&fixture.destination(&additional)), fresh);
    fixture.assert_neighbors_untouched();
}

#[test]
fn blocked_compile_cannot_keep_or_restore_a_revoked_server_authorization() {
    exercise_asset_withdrawal_during_blocked_compile(false);
}

#[test]
fn blocked_compile_cannot_keep_or_restore_a_deleted_server() {
    exercise_asset_withdrawal_during_blocked_compile(true);
}

#[test]
fn each_revoked_export_flag_withdraws_old_copy_while_another_server_blocks_compile() {
    for export in ["resolved", "ports", "image"] {
        let fixture = Fixture::new();
        let primary = fixture.seed_ready_server();
        let mut server = fixture.server();
        server.id = "ast_export_fixture".into();
        server.name = "Export fixture server".into();
        server.connection.ssh_alias = "export-box".into();
        server.connection.resolved = Some(ResolvedConnection {
            hostname: "192.0.2.77".into(),
            user: "fixture-user".into(),
            port: 2222,
            proxy_jump: None,
            resolved_at: crate::testkit::NOW.into(),
        });
        server.listening_ports = vec![ListeningPort {
            addr: "127.0.0.1".into(),
            port: 54321,
            proto: Proto::Tcp,
        }];
        server.services = vec![Service {
            kind: ServiceKind::Docker,
            name: "export-service".into(),
            image: Some("fixture-image:version-17".into()),
            ports: Vec::new(),
            role: None,
            critical: false,
            source: FieldSource::Manual,
            last_seen_at: None,
            missing: false,
            sanitized: None,
        }];
        server.export = ExportFlags {
            resolved_connection: export == "resolved",
            listening_ports: export == "ports",
            image: export == "image",
        };
        let secondary = seed_ready_server_with(&fixture, server);
        let target = fixture.target();
        let source = fixture.source(&target);
        let last_success = tree_bytes(&source);
        let exported_text = match export {
            "resolved" => "192.0.2.77",
            "ports" => "127.0.0.1:54321",
            "image" => "fixture-image:version-17",
            _ => unreachable!(),
        };
        assert!(
            String::from_utf8(last_success[Path::new("references/export-box.md")].clone())
                .unwrap()
                .contains(exported_text)
        );
        block_notes_preserving_last_success(&fixture, &primary, &target, &last_success);

        let mut input = server_input(secondary.as_server().unwrap(), Some(secondary.id()));
        input.export = ExportFlags {
            resolved_connection: false,
            listening_ports: false,
            image: false,
        };
        fixture.backend.save_asset(AssetInput::Vps(input)).unwrap();
        let additional = assert_blocked_withdrawal_cannot_restore_old_copy(&fixture, &target, &last_success);

        clear_blocking_notes(&fixture, primary.id());
        let fresh = tree_bytes(&source);
        let hidden = String::from_utf8(fresh[Path::new("references/export-box.md")].clone()).unwrap();
        assert!(!hidden.contains(exported_text), "revoked {export} export was retained");
        assert_eq!(tree_bytes(&fixture.destination(&target)), fresh);
        assert_eq!(tree_bytes(&fixture.destination(&additional)), fresh);
        fixture.assert_neighbors_untouched();
    }
}

#[test]
fn shrinking_cli_scope_withdraws_old_copy_while_another_asset_blocks_compile() {
    let fixture = Fixture::with_runner(Arc::new(MetadataRunner::default()), false);
    let primary = fixture.seed_ready_server();
    fixture.backend.detect_cli_environment(cli_request(None, None)).unwrap();
    let mut scope = fixture
        .backend
        .refresh_cli_scope(cli_request(Some(ACCOUNT_A), None))
        .unwrap();
    for item in &mut scope {
        item.selected = true;
    }
    let cli_asset = fixture
        .backend
        .save_asset(AssetInput::Cli(cli_input(ACCOUNT_A, Some(scope))))
        .unwrap()
        .asset;
    fixture
        .backend
        .set_distribute(cli_asset.id(), "claude-code", true)
        .unwrap();
    let target = fixture.target();
    let source = fixture.source(&target);
    let last_success = tree_bytes(&source);
    let original_scope = String::from_utf8(last_success[Path::new("references/cloudflare.md")].clone()).unwrap();
    assert!(original_scope.contains("example.test") && original_scope.contains("gateway"));
    block_notes_preserving_last_success(&fixture, &primary, &target, &last_success);

    let narrowed = fixture
        .backend
        .set_cli_scope(cli_asset.id(), &["zone:a".into()])
        .unwrap()
        .asset;
    assert!(
        narrowed
            .as_cli()
            .unwrap()
            .cli
            .scope
            .iter()
            .filter(|item| item.selected)
            .all(|item| item.id == "zone:a")
    );
    let additional = assert_blocked_withdrawal_cannot_restore_old_copy(&fixture, &target, &last_success);

    clear_blocking_notes(&fixture, primary.id());
    let fresh = tree_bytes(&source);
    let restricted_scope = String::from_utf8(fresh[Path::new("references/cloudflare.md")].clone()).unwrap();
    assert!(restricted_scope.contains("example.test"));
    assert!(!restricted_scope.contains("gateway"));
    assert_eq!(tree_bytes(&fixture.destination(&target)), fresh);
    assert_eq!(tree_bytes(&fixture.destination(&additional)), fresh);
    fixture.assert_neighbors_untouched();
}

#[test]
fn successful_authorization_withdrawal_removes_modified_copy_before_fresh_sync() {
    let fixture = Fixture::new();
    fixture.seed_ready_server();
    let secondary = seed_secondary_server(&fixture);
    let target = fixture.target();
    let destination = fixture.destination(&target);
    fixture.replace_owned_file(
        &destination,
        &target,
        "SKILL.md",
        b"external edit still containing secondary-box\n",
    );
    fixture.replace_owned_file(
        &destination,
        &target,
        "references/old-authority.md",
        b"secondary-box used to be granted\n",
    );
    let edited = tree_bytes(&destination);

    fixture
        .backend
        .set_distribute(secondary.id(), "claude-code", false)
        .unwrap();
    let delivery = fixture
        .backend
        .list_deliveries()
        .unwrap()
        .into_iter()
        .find(|delivery| delivery.target_id == target.id)
        .unwrap();
    assert_eq!(delivery.status, DeliveryStatus::Ok);
    let fresh = tree_bytes(&fixture.source(&target));
    assert_ne!(tree_bytes(&destination), edited);
    assert_eq!(tree_bytes(&destination), fresh);
    assert!(!fresh.contains_key(Path::new("references/secondary-box.md")));
    assert!(!destination.join("references/old-authority.md").exists());
    assert!(
        fresh
            .values()
            .all(|bytes| !String::from_utf8_lossy(bytes).contains("secondary-box"))
    );
    fixture.assert_neighbors_untouched();
}

#[cfg(any(windows, unix))]
fn p8_link_dir(link: &Path, target: &Path) {
    #[cfg(unix)]
    std::os::unix::fs::symlink(target, link).unwrap();
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        match std::os::windows::fs::symlink_dir(target, link) {
            Ok(()) => {}
            Err(error) if error.raw_os_error() == Some(1314) => {
                let output = crate::proc::command("cmd.exe")
                    .args(["/D", "/V:OFF", "/C"])
                    .raw_arg(r#"mklink /J "%CLOUDLINK_TEST_LINK%" "%CLOUDLINK_TEST_TARGET%""#)
                    .env("CLOUDLINK_TEST_LINK", link)
                    .env("CLOUDLINK_TEST_TARGET", target)
                    .output()
                    .unwrap();
                assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
            }
            Err(error) => panic!("cannot create isolated link: {error}"),
        }
    }
}

#[cfg(any(windows, unix))]
fn p8_shared_target(fixture: &Fixture) -> Target {
    let shared = PathBuf::from(&fixture.target().path);
    let link = fixture.paths.user_home.join(".mirror/skills");
    fs::create_dir_all(link.parent().unwrap()).unwrap();
    p8_link_dir(&link, &shared);
    fixture
        .backend
        .add_custom_target(AddCustomTargetRequest {
            env_id: EnvId::windows(),
            label: "Mirror".into(),
            path: link.to_string_lossy().into_owned(),
        })
        .unwrap()
}

#[cfg(any(windows, unix))]
#[test]
fn p8_shared_directory_uses_intersection_then_one_explicit_switch_aligns_members() {
    let fixture = Fixture::new();
    let saved = fixture.seed_ready_server();
    let primary = fixture.target();
    let shared = p8_shared_target(&fixture);
    assert!(
        fixture
            .backend
            .database()
            .unwrap()
            .require_asset(saved.id())
            .unwrap()
            .agent()
            .agents
            .is_empty()
    );
    assert!(
        !fixture.destination(&primary).exists(),
        "discovering a sharer must not expand grants"
    );
    let mismatches: Vec<_> = fixture
        .backend
        .list_deliveries()
        .unwrap()
        .into_iter()
        .filter(|d| d.target_id == primary.id || d.target_id == shared.id)
        .collect();
    assert_eq!(
        mismatches.len(),
        2,
        "an empty intersection still keeps every mismatch row"
    );
    assert!(mismatches.iter().all(|d| {
        d.status == DeliveryStatus::Missing
            && d.status_detail
                .as_ref()
                .is_some_and(|detail| detail.id == "shared-selection-mismatch")
    }));
    let checked = fixture.backend.check_deliveries().unwrap();
    assert_eq!(
        checked
            .iter()
            .filter(|d| (d.target_id == primary.id || d.target_id == shared.id)
                && d.status_detail
                    .as_ref()
                    .is_some_and(|detail| detail.id == "shared-selection-mismatch"))
            .count(),
        2,
        "health checks must not drop the empty-source mismatch"
    );

    let result = fixture
        .backend
        .set_distribute(saved.id(), &shared.agent_key, true)
        .unwrap();
    assert_eq!(
        result.affected_agent_keys,
        vec![primary.agent_key.clone(), shared.agent_key.clone()]
    );
    assert!(result.asset.agent().agents.contains(&primary.agent_key));
    assert!(result.asset.agent().agents.contains(&shared.agent_key));
    let delivered: Vec<_> = result
        .deliveries
        .iter()
        .filter(|d| d.status == DeliveryStatus::Ok)
        .collect();
    assert_eq!(delivered.len(), 2);
    assert!(
        delivered.iter().all(|d| d
            .status_detail
            .as_ref()
            .is_some_and(|detail| detail.id == "shared-directory")),
        "an explicit switch clears the mismatch, not the shared-directory explanation"
    );
    assert_eq!(
        delivered
            .iter()
            .map(|d| d.unit_id.clone())
            .collect::<std::collections::BTreeSet<_>>()
            .len(),
        1
    );
    let marker = publish::read_marker(&fixture.destination(&primary)).unwrap();
    assert_eq!(marker.agent_keys, result.affected_agent_keys);
    assert!(
        !fixture.source(&shared).exists(),
        "a shared directory has no duplicate source"
    );

    let off = fixture
        .backend
        .set_distribute(saved.id(), &primary.agent_key, false)
        .unwrap();
    assert!(!off.asset.agent().agents.contains(&primary.agent_key));
    assert!(!off.asset.agent().agents.contains(&shared.agent_key));
    assert!(!fixture.destination(&primary).exists());
    fixture.assert_neighbors_untouched();
}

#[cfg(any(windows, unix))]
#[test]
fn p8_legacy_group_marker_is_upgraded_and_outsider_markers_are_not_claimed() {
    let fixture = Fixture::new();
    let saved = fixture.seed_ready_server();
    let shared = p8_shared_target(&fixture);
    fixture
        .backend
        .set_distribute(saved.id(), &shared.agent_key, true)
        .unwrap();
    let leaf = fixture.destination(&fixture.target());
    let original = publish::read_marker(&leaf).unwrap();
    let mut old = original.clone();
    old.agent_key = shared.agent_key.clone();
    old.agent_keys.clear();
    fs::write(leaf.join(MARKER_FILE), serde_json::to_vec(&old).unwrap()).unwrap();
    assert!(
        fixture
            .backend
            .check_deliveries()
            .unwrap()
            .iter()
            .filter(|d| d.target_id == shared.id || d.target_id == fixture.target().id)
            .all(|d| d.status == DeliveryStatus::Ok)
    );
    assert_eq!(publish::read_marker(&leaf).unwrap().agent_keys, original.agent_keys);

    let mut outsider = original.clone();
    outsider.agent_key = "custom:Unregistered".into();
    outsider.agent_keys = vec!["custom:Unregistered".into()];
    fs::write(leaf.join(MARKER_FILE), serde_json::to_vec(&outsider).unwrap()).unwrap();
    assert!(
        fixture
            .backend
            .check_deliveries()
            .unwrap()
            .iter()
            .filter(|d| d.target_id == shared.id || d.target_id == fixture.target().id)
            .all(|d| d.status == DeliveryStatus::Conflict)
    );
    assert_eq!(publish::read_marker(&leaf).unwrap(), outsider);
}

#[cfg(any(windows, unix))]
#[test]
fn p8_disabling_one_shared_target_keeps_copy_until_the_last_target_stops() {
    let fixture = Fixture::new();
    let saved = fixture.seed_ready_server();
    let shared = p8_shared_target(&fixture);
    fixture
        .backend
        .set_distribute(saved.id(), &shared.agent_key, true)
        .unwrap();
    let primary = fixture.target();
    fixture.backend.set_target_enabled(&primary.id, false).unwrap();
    assert!(fixture.destination(&primary).join("SKILL.md").exists());
    assert!(
        fixture
            .backend
            .list_deliveries()
            .unwrap()
            .iter()
            .any(|d| d.target_id == primary.id && d.status == DeliveryStatus::Shared)
    );
    fixture.backend.set_target_enabled(&shared.id, false).unwrap();
    assert!(!fixture.destination(&primary).exists());
    fixture.assert_neighbors_untouched();
}

#[cfg(any(windows, unix))]
#[test]
fn p8_removing_a_shared_custom_member_preserves_and_retags_the_owned_copy() {
    let fixture = Fixture::new();
    let saved = fixture.seed_ready_server();
    let shared = p8_shared_target(&fixture);
    fixture
        .backend
        .set_distribute(saved.id(), &shared.agent_key, true)
        .unwrap();
    fixture.backend.remove_custom_target(&shared.id).unwrap();
    let primary = fixture.target();
    let marker = publish::read_marker(&fixture.destination(&primary)).unwrap();
    assert_eq!(marker.agent_key, primary.agent_key);
    assert!(marker.agent_keys.is_empty());
    assert!(
        fixture
            .backend
            .list_deliveries()
            .unwrap()
            .iter()
            .any(|d| d.target_id == primary.id && d.status == DeliveryStatus::Ok)
    );
    fixture.assert_neighbors_untouched();
}

#[test]
fn p8_distribution_snapshot_distinguishes_grant_compile_and_real_conflict() {
    let fixture = Fixture::new();
    let saved = fixture.seed_ready_server();
    let target = fixture.target();
    let env = fixture.backend.context(&target.env_id).unwrap();
    crate::deliver::remove(&fixture.paths, &env, &target).unwrap();
    let leaf = fixture.destination(&target);
    fs::create_dir_all(&leaf).unwrap();
    fs::write(leaf.join("SKILL.md"), b"user-owned skill").unwrap();
    let result = fixture
        .backend
        .set_distribute(saved.id(), &target.agent_key, true)
        .unwrap();
    assert!(result.asset.agent().agents.contains(&target.agent_key));
    assert!(result.inclusions.iter().any(|i| i.asset_id == saved.id() && i.included));
    assert!(result.statuses.iter().all(|s| !s.blocked));
    assert!(
        result
            .deliveries
            .iter()
            .any(|d| d.target_id == target.id && d.status == DeliveryStatus::Conflict)
    );
    assert_eq!(fs::read(leaf.join("SKILL.md")).unwrap(), b"user-owned skill");
}

#[test]
fn p8_blank_name_is_neutral_and_compiles_without_exposing_the_connection_address() {
    let fixture = Fixture::new();
    let mut input = server_input(&fixture.server(), None);
    input.name.clear();
    if let ConnectionInput::Managed { ssh_alias, .. } = &mut input.connection {
        *ssh_alias = "cloudlink-1".into();
    }
    let result = fixture.backend.save_asset(AssetInput::Vps(input)).unwrap();
    assert_eq!(result.asset.name(), "Server 1");
    let mut ready = result.asset;
    let Asset::Vps(server) = &mut ready else { unreachable!() };
    server.connection.verified = Some(ConnectionVerified {
        ok: true,
        at: crate::testkit::NOW.into(),
        env_ids: vec![EnvId::windows()],
    });
    fixture.backend.database().unwrap().upsert_asset(&ready).unwrap();
    fixture.backend.write_managed_configs().unwrap();
    let result = fixture.backend.set_distribute(ready.id(), "claude-code", true).unwrap();
    assert!(result.statuses.iter().all(|s| !s.blocked));
    let source = fixture.source(&fixture.target());
    for bytes in tree_bytes(&source).values() {
        assert!(!String::from_utf8_lossy(bytes).contains("203.0.113.10"));
    }
}

#[cfg(any(windows, unix))]
#[test]
fn p8_shared_backup_undo_pauses_every_writer_and_preserves_the_edited_copy() {
    let fixture = Fixture::new();
    let saved = fixture.seed_ready_server();
    let shared = p8_shared_target(&fixture);
    fixture
        .backend
        .set_distribute(saved.id(), &shared.agent_key, true)
        .unwrap();
    let primary = fixture.target();
    let leaf = fixture.destination(&primary);
    fs::write(leaf.join("SKILL.md"), b"edited shared skill").unwrap();
    fixture.events.clear();
    fixture.backend.check_deliveries().unwrap();
    let events = fixture.events.payloads("deliveries://backed-up");
    assert_eq!(events.len(), 1, "one physical directory makes one backup");
    let id = events[0]["backupId"].as_str().unwrap();
    fixture.backend.undo_backup(id).unwrap();
    assert_eq!(fs::read(leaf.join("SKILL.md")).unwrap(), b"edited shared skill");
    assert!(
        fixture
            .backend
            .list_targets()
            .unwrap()
            .iter()
            .filter(|t| t.id == primary.id || t.id == shared.id)
            .all(|t| !t.enabled)
    );
    fixture.backend.check_deliveries().unwrap();
    assert_eq!(fs::read(leaf.join("SKILL.md")).unwrap(), b"edited shared skill");
}

#[cfg(any(windows, unix))]
#[test]
fn p8_shared_reset_removes_only_the_owned_leaf_and_keeps_parent_links_and_neighbors() {
    let fixture = Fixture::new();
    let saved = fixture.seed_ready_server();
    let shared = p8_shared_target(&fixture);
    fixture
        .backend
        .set_distribute(saved.id(), &shared.agent_key, true)
        .unwrap();
    let leaf = fixture.destination(&fixture.target());
    let link = PathBuf::from(&shared.path);
    fixture.backend.reset_data().unwrap();
    assert!(!leaf.exists());
    assert!(fsx::path_is_link(&link));
    assert_eq!(
        fs::read(fixture.paths.user_home.join(".claude/skills/user-skill/SKILL.md")).unwrap(),
        b"keep this neighboring user skill\n"
    );
    assert!(fixture.backend.list_assets().unwrap().is_empty());
}

#[cfg(any(windows, unix))]
#[test]
fn p8_shared_reset_preserves_foreign_leaf_links_and_external_content() {
    let fixture = Fixture::new();
    let shared = p8_shared_target(&fixture);
    let outside = fixture.paths.user_home.join("outside-leaf");
    fs::create_dir_all(&outside).unwrap();
    fs::write(outside.join("SKILL.md"), b"external skill").unwrap();
    let leaf = fixture.destination(&fixture.target());
    p8_link_dir(&leaf, &outside);
    fixture.backend.reset_data().unwrap();
    assert!(fsx::path_is_link(&leaf));
    assert!(fsx::path_is_link(Path::new(&shared.path)));
    assert_eq!(fs::read(outside.join("SKILL.md")).unwrap(), b"external skill");
}

#[cfg(any(windows, unix))]
#[test]
fn p8_wsl_linked_to_registered_windows_directory_is_not_written_twice() {
    let fixture = Fixture::with_runner(Arc::new(cli::EmptyRunner), true);
    let windows = fixture.target();
    let wsl = fixture
        .backend
        .list_targets()
        .unwrap()
        .into_iter()
        .find(|t| !t.env_id.is_windows() && t.agent == AgentId::ClaudeCode)
        .unwrap();
    let env = fixture.backend.context(&wsl.env_id).unwrap();
    let wsl_parent = env.to_host(&wsl.path);
    let kept = env.host_in_home(&["previous-skills"]);
    fs::rename(&wsl_parent, &kept).unwrap();
    p8_link_dir(&wsl_parent, Path::new(&windows.path));
    fixture.seed_ready_server();
    let deliveries = fixture.backend.list_deliveries().unwrap();
    let shadow = deliveries.iter().find(|d| d.target_id == wsl.id).unwrap();
    assert_eq!(shadow.status, DeliveryStatus::Shared);
    assert_eq!(shadow.status_detail.as_ref().unwrap().id, "shared-windows");
    assert_eq!(
        shadow.unit_id,
        deliveries.iter().find(|d| d.target_id == windows.id).unwrap().unit_id
    );
    assert!(!fixture.source(&wsl).exists());
    let marker = publish::read_marker(&fixture.destination(&windows)).unwrap();
    assert_eq!(marker.env_id, "windows");
    fixture.backend.set_target_enabled(&wsl.id, false).unwrap();
    assert!(fixture.destination(&windows).exists());
}

#[cfg(any(windows, unix))]
#[test]
fn p8_wsl_linked_to_unregistered_windows_directory_reports_a_path_error() {
    let fixture = Fixture::with_runner(Arc::new(cli::EmptyRunner), true);
    let wsl = fixture
        .backend
        .list_targets()
        .unwrap()
        .into_iter()
        .find(|t| !t.env_id.is_windows() && t.agent == AgentId::ClaudeCode)
        .unwrap();
    let env = fixture.backend.context(&wsl.env_id).unwrap();
    let wsl_parent = env.to_host(&wsl.path);
    fs::rename(&wsl_parent, env.host_in_home(&["previous-skills"])).unwrap();
    let unregistered = fixture.paths.user_home.join("unregistered-skills");
    fs::create_dir_all(&unregistered).unwrap();
    p8_link_dir(&wsl_parent, &unregistered);
    fixture.seed_ready_server();
    let broken = fixture
        .backend
        .list_deliveries()
        .unwrap()
        .into_iter()
        .find(|d| d.target_id == wsl.id)
        .unwrap();
    assert_eq!(broken.status, DeliveryStatus::Broken);
    assert_eq!(broken.status_detail.as_ref().unwrap().id, "wsl-path-unsupported");
    assert!(!unregistered.join(SKILL_DIR).exists());
}

#[derive(Default)]
struct RevisionCredentialStore {
    memory: MemoryCredentialStore,
    backend: Mutex<Weak<Backend>>,
    fail_delete: AtomicBool,
    mutate_on_set: Mutex<Option<(String, String)>>,
    sets: Mutex<Vec<String>>,
    deletes: Mutex<Vec<String>>,
}

impl RevisionCredentialStore {
    fn assert_backend_locks_released(&self) -> Option<Arc<Backend>> {
        let backend = self.backend.lock().unwrap().upgrade();
        if let Some(backend) = &backend {
            assert!(backend.db.try_lock().is_ok(), "credential call held the database lock");
            assert!(
                backend.mutation.try_lock().is_ok(),
                "credential call held the mutation lock"
            );
        }
        backend
    }
}

impl CredentialStore for RevisionCredentialStore {
    fn get(&self, key: &str) -> Result<Option<SecretString>> {
        let _ = self.assert_backend_locks_released();
        self.memory.get(key)
    }

    fn set(&self, key: &str, password: &SecretString) -> Result<()> {
        let backend = self.assert_backend_locks_released();
        self.memory.set(key, password)?;
        self.sets.lock().unwrap().push(key.into());
        let mutation = self.mutate_on_set.lock().unwrap().take();
        if let Some((asset_id, host)) = mutation {
            let backend = backend.expect("mutation requires an attached test backend");
            let db = backend.database()?;
            let mut asset = db.require_asset(&asset_id)?;
            let Asset::Vps(server) = &mut asset else {
                panic!("fixture must be a server")
            };
            server.connection.host = Some(host);
            // Simulate a record changing while the vault write was outside the state locks.
            // The stale setter must leave the previous revision pointer untouched.
            db.upsert_asset(&asset)?;
        }
        Ok(())
    }

    fn delete(&self, key: &str) -> Result<()> {
        let _ = self.assert_backend_locks_released();
        self.deletes.lock().unwrap().push(key.into());
        if self.fail_delete.load(Ordering::SeqCst) {
            return Err(AppError::internal("injected credential deletion failure"));
        }
        self.memory.delete(key)
    }
}

struct RevisionFixture {
    backend: Arc<Backend>,
    store: Arc<RevisionCredentialStore>,
    _temp: tempfile::TempDir,
}

impl RevisionFixture {
    fn new() -> Self {
        let temp = tempfile::tempdir().unwrap();
        let paths = Paths::isolated_in(temp.path());
        fs::create_dir_all(paths.user_home.join(".ssh")).unwrap();
        fs::create_dir_all(paths.user_home.join(".claude")).unwrap();
        fs::write(
            paths.user_home.join(".ssh").join("config"),
            user_config(&EnvContext::windows(&paths)),
        )
        .unwrap();
        let store = Arc::new(RevisionCredentialStore::default());
        let backend = Backend::with_services(
            paths,
            Arc::new(FakeSystem {
                distros: Vec::new(),
                interop: true,
                agent_keys: None,
            }),
            store.clone(),
            cli::Service::new(Arc::new(cli::EmptyRunner)),
            Arc::new(RecordingEvents::default()),
        )
        .unwrap();
        *store.backend.lock().unwrap() = Arc::downgrade(&backend);
        Self {
            backend,
            store,
            _temp: temp,
        }
    }

    fn save_password_server(&self) -> Asset {
        let mut input = server_input(&crate::testkit::dev_box(), None);
        let ConnectionInput::Managed { auth, .. } = &mut input.connection else {
            unreachable!()
        };
        auth.method = AuthMethod::Password;
        auth.identity_file.clear();
        self.backend.save_asset(AssetInput::Vps(input)).unwrap().asset
    }

    fn reference(&self, asset_id: &str) -> String {
        self.backend
            .database()
            .unwrap()
            .password_ref(asset_id)
            .unwrap()
            .unwrap()
    }

    fn pending(&self) -> Vec<String> {
        self.backend.database().unwrap().password_cleanup().unwrap()
    }

    fn value(&self, key: &str) -> Option<String> {
        self.store.get(key).unwrap().map(|value| value.expose().to_string())
    }
}

#[test]
fn failed_password_revision_commit_preserves_old_reference_and_queues_only_new_revision() {
    let fixture = RevisionFixture::new();
    let saved = fixture.save_password_server();
    fixture
        .backend
        .set_password(saved.id(), Some("old-fixture-password".into()))
        .unwrap();
    let old_key = fixture.reference(saved.id());
    let original = fixture.backend.database().unwrap().require_asset(saved.id()).unwrap();
    fixture.store.fail_delete.store(true, Ordering::SeqCst);
    *fixture.store.mutate_on_set.lock().unwrap() = Some((saved.id().into(), "198.51.100.91".into()));

    assert_ipc(
        fixture
            .backend
            .set_password(saved.id(), Some("new-fixture-password".into())),
        IpcErrorId::PasswordTargetChanged,
    );
    let new_key = fixture.store.sets.lock().unwrap().last().unwrap().clone();
    assert_ne!(new_key, old_key);
    assert_eq!(fixture.pending(), vec![new_key.clone()]);
    assert!(fixture.store.deletes.lock().unwrap().iter().all(|key| key == &new_key));
    assert_eq!(fixture.value(&old_key).as_deref(), Some("old-fixture-password"));
    assert_eq!(fixture.value(&new_key).as_deref(), Some("new-fixture-password"));
    assert_ipc(
        fixture.backend.database().unwrap().password_ref(saved.id()),
        IpcErrorId::PasswordTargetChanged,
    );

    // Restore only the simulated competing record change, so the public reference lookup
    // can prove that the stale setter never switched the old tuple to its new revision.
    fixture.backend.database().unwrap().upsert_asset(&original).unwrap();
    assert_eq!(fixture.reference(saved.id()), old_key);
    fixture.store.fail_delete.store(false, Ordering::SeqCst);
    fixture.backend.retry_credential_cleanup();
    assert!(fixture.pending().is_empty());
    assert!(fixture.value(&new_key).is_none());
    assert_eq!(fixture.reference(saved.id()), old_key);
    assert_eq!(fixture.value(&old_key).as_deref(), Some("old-fixture-password"));
    assert!(fixture.store.deletes.lock().unwrap().iter().all(|key| key == &new_key));
}

#[test]
fn password_revision_switch_succeeds_when_old_credential_cleanup_needs_retry() {
    let fixture = RevisionFixture::new();
    let saved = fixture.save_password_server();
    fixture
        .backend
        .set_password(saved.id(), Some("old-fixture-password".into()))
        .unwrap();
    let old_key = fixture.reference(saved.id());
    fixture.store.fail_delete.store(true, Ordering::SeqCst);

    fixture
        .backend
        .set_password(saved.id(), Some("new-fixture-password".into()))
        .unwrap();
    let active_key = fixture.reference(saved.id());
    assert_ne!(active_key, old_key);
    assert_eq!(fixture.pending(), vec![old_key.clone()]);
    assert_eq!(fixture.value(&old_key).as_deref(), Some("old-fixture-password"));
    assert_eq!(fixture.value(&active_key).as_deref(), Some("new-fixture-password"));
    assert!(fixture.store.deletes.lock().unwrap().iter().all(|key| key == &old_key));

    fixture.store.fail_delete.store(false, Ordering::SeqCst);
    fixture.backend.retry_credential_cleanup();
    assert!(fixture.pending().is_empty());
    assert!(fixture.value(&old_key).is_none());
    assert_eq!(fixture.reference(saved.id()), active_key);
    assert_eq!(fixture.value(&active_key).as_deref(), Some("new-fixture-password"));
}

#[test]
fn completed_save_and_delete_return_fresh_results_despite_credential_cleanup_failure() {
    let fixture = RevisionFixture::new();
    let saved = fixture.save_password_server();
    fixture
        .backend
        .set_password(saved.id(), Some("old-fixture-password".into()))
        .unwrap();
    let old_key = fixture.reference(saved.id());
    let current = fixture.backend.database().unwrap().require_asset(saved.id()).unwrap();
    let mut input = server_input(current.as_server().unwrap(), Some(saved.id()));
    let ConnectionInput::Managed { host, .. } = &mut input.connection else {
        unreachable!()
    };
    *host = "198.51.100.92".into();
    fixture.store.fail_delete.store(true, Ordering::SeqCst);

    let fresh = fixture.backend.save_asset(AssetInput::Vps(input)).unwrap().asset;
    assert_eq!(
        fresh.as_server().unwrap().connection.host.as_deref(),
        Some("198.51.100.92")
    );
    assert!(
        !fresh
            .as_server()
            .unwrap()
            .connection
            .auth
            .as_ref()
            .unwrap()
            .password_saved
    );
    assert_eq!(
        fixture.backend.database().unwrap().require_asset(saved.id()).unwrap(),
        fresh
    );
    assert!(
        fixture
            .backend
            .database()
            .unwrap()
            .password_ref(saved.id())
            .unwrap()
            .is_none()
    );
    assert_eq!(fixture.pending(), vec![old_key.clone()]);
    assert_eq!(fixture.value(&old_key).as_deref(), Some("old-fixture-password"));
    fixture.store.fail_delete.store(false, Ordering::SeqCst);
    fixture.backend.retry_credential_cleanup();
    assert!(fixture.pending().is_empty());
    assert!(fixture.value(&old_key).is_none());

    fixture
        .backend
        .set_password(saved.id(), Some("delete-fixture-password".into()))
        .unwrap();
    let delete_key = fixture.reference(saved.id());
    fixture.store.fail_delete.store(true, Ordering::SeqCst);
    fixture.backend.delete_asset(saved.id(), false).unwrap();
    assert!(
        fixture
            .backend
            .database()
            .unwrap()
            .get_asset(saved.id())
            .unwrap()
            .is_none()
    );
    assert_eq!(fixture.pending(), vec![delete_key.clone()]);
    assert_eq!(fixture.value(&delete_key).as_deref(), Some("delete-fixture-password"));
    fixture.store.fail_delete.store(false, Ordering::SeqCst);
    fixture.backend.retry_credential_cleanup();
    assert!(fixture.pending().is_empty());
    assert!(fixture.value(&delete_key).is_none());
}

// ---- 冷启动（P6）：setup 只打开数据库，启动工作在后台线程里做，命令在闸门前等它 ----

#[test]
fn commands_wait_until_the_startup_work_has_detected_environments() {
    let fixture = Fixture::unstarted();
    let backend = Arc::clone(&fixture.backend);
    // 首屏读的是数据库：不用等
    assert!(backend.list_assets().unwrap().is_empty());
    assert!(backend.list_targets().unwrap().is_empty());
    let waiting = {
        let backend = Arc::clone(&backend);
        std::thread::spawn(move || {
            backend.wait_for_startup();
            (
                backend.contexts(false).unwrap().len(),
                backend.list_targets().unwrap().len(),
            )
        })
    };
    std::thread::sleep(std::time::Duration::from_millis(150));
    assert!(
        !waiting.is_finished(),
        "a gated command must not run before the startup work"
    );
    backend.start(Start::Inline).unwrap();
    // Windows 一个环境；Claude Code 和 Codex 两个目标（夹具里有 .claude 和 .codex）
    assert_eq!(waiting.join().unwrap(), (1, 2));
}

#[test]
fn a_failed_startup_still_opens_the_gate() {
    let fixture = Fixture::unstarted();
    let backend = Arc::clone(&fixture.backend);
    // 让启动工作拿修改锁时出错
    let poison = Arc::clone(&backend);
    let _ = std::thread::spawn(move || {
        let _held = poison.mutation.lock().unwrap();
        panic!("poison the mutation lock for this test");
    })
    .join();
    assert!(backend.start(Start::Inline).is_err());
    let waiting = {
        let backend = Arc::clone(&backend);
        std::thread::spawn(move || backend.wait_for_startup())
    };
    waiting.join().unwrap();
}

#[test]
fn the_first_detection_after_a_desktop_start_reuses_the_startup_result() {
    let fixture = Fixture::unstarted();
    fixture.backend.start(Start::Desktop).unwrap();
    fixture.events.clear();
    let first = fixture.backend.detect_environments().unwrap();
    assert!(
        !fixture.events.contains("deliveries://changed"),
        "the frontend's first detection must not repeat the startup reconcile"
    );
    let second = fixture.backend.detect_environments().unwrap();
    assert!(
        fixture.events.contains("deliveries://changed"),
        "later detections check again"
    );
    assert_eq!(first, second);
}

#[test]
fn adding_an_include_drops_the_startup_result() {
    let fixture = Fixture::unstarted();
    fixture.backend.start(Start::Desktop).unwrap();
    fixture.backend.add_ssh_include(&EnvId::windows()).unwrap();
    fixture.events.clear();
    fixture.backend.detect_environments().unwrap();
    assert!(fixture.events.contains("deliveries://changed"));
}
