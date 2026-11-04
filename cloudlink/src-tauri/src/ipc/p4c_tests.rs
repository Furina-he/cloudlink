//! End-to-end backend regressions. Every path and credential store is injected and isolated.

use std::fs;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Barrier, Mutex, Weak};

use serde_json::{Value, json};

use super::requests::MergeNote;
use super::{Backend, EventSink};
use crate::cli;
use crate::compile::publish;
use crate::env::{EnvContext, FakeSystem};
use crate::error::{AppError, Result};
use crate::guard::{self, SelfTest};
use crate::model::asset::{Asset, AuthMethod, Mode};
use crate::model::env::EnvId;
use crate::model::guard::{GuardState, OperationQuery};
use crate::model::misc::{ActivityKind, ActivityQuery, IpcErrorId};
use crate::model::notes::AgentNoteFlag;
use crate::paths::Paths;
use crate::secret::SecretString;
use crate::secret::store::{CredentialStore, MemoryCredentialStore};

const ORIGINAL_SETTINGS: &[u8] = b"{\r\n  \"model\" : \"fixture-model\",\r\n  \"hooks\": { \"PostToolUse\": [] }, \"permissions\": {\"deny\": []}\r\n}\r\n";
const ORIGINAL_SSH: &[u8] = b"Include ~/.ssh/cloudlink.conf\n\n# user-managed\nHost mine\n  HostName 192.0.2.9\n";

#[derive(Default)]
struct Events(Mutex<Vec<(String, Value)>>);

impl EventSink for Events {
    fn emit(&self, event: &str, value: Value) {
        self.0.lock().unwrap().push((event.into(), value));
    }
}

struct AcceptedSelfTest;
impl SelfTest for AcceptedSelfTest {
    fn run(&self, _paths: &Paths, _env: &EnvContext) -> bool {
        true
    }
}

struct Fixture {
    backend: Arc<Backend>,
    events: Arc<Events>,
    paths: Paths,
    _temp: tempfile::TempDir,
}

impl Fixture {
    fn new() -> Self {
        Self::with_vault(Arc::new(MemoryCredentialStore::default()))
    }

    fn with_vault(vault: Arc<dyn CredentialStore>) -> Self {
        let temp = tempfile::tempdir().unwrap();
        let paths = Paths::isolated_in(temp.path());
        fs::create_dir_all(paths.user_home.join(".claude")).unwrap();
        fs::create_dir_all(paths.user_home.join(".ssh")).unwrap();
        fs::write(paths.user_home.join(".claude/settings.json"), ORIGINAL_SETTINGS).unwrap();
        fs::write(paths.user_home.join(".ssh/config"), ORIGINAL_SSH).unwrap();
        let events = Arc::new(Events::default());
        let backend = Backend::with_guard_services(
            paths.clone(),
            Arc::new(FakeSystem::default()),
            vault,
            cli::Service::new(Arc::new(cli::EmptyRunner)),
            events.clone(),
            Arc::new(AcceptedSelfTest),
        )
        .unwrap();
        let source = temp.path().join("packaged-guard.exe");
        fs::write(&source, b"test executable; never run").unwrap();
        guard::sync_binary(&paths, &source).unwrap();
        Self {
            backend,
            events,
            paths,
            _temp: temp,
        }
    }

    fn seed(&self) -> Asset {
        let mut server = crate::testkit::hk_edge();
        server.connection.defined_in = vec![EnvId::windows()];
        let key = self.paths.user_home.join(".ssh/user-key");
        fs::write(&key, b"fake private file used only for path availability").unwrap();
        let auth = server.connection.auth.as_mut().unwrap();
        auth.identity_file.clear();
        auth.identity_file
            .insert(EnvId::windows(), key.to_string_lossy().into_owned());
        let asset = Asset::Vps(server);
        self.backend.database().unwrap().upsert_asset(&asset).unwrap();
        self.backend.write_managed_configs().unwrap();
        self.backend.publish_locked().unwrap();
        asset
    }

    fn write_operation(&self, asset: &Asset) {
        let dir = self.paths.data_dir.join("guard/log");
        fs::create_dir_all(&dir).unwrap();
        if !dir.join(".cloudlink.json").exists() {
            fs::write(
                dir.join(".cloudlink.json"),
                br#"{"managedBy":"cloudlink","kind":"operation-log"}"#,
            )
            .unwrap();
        }
        let now = crate::time::now_rfc3339();
        let line = json!({
            "id": "op_integration", "assetId": asset.id(), "envId": "windows", "at": now,
            "sessionId": "session_fixture", "cwd": "C:/fixture/work",
            "command": "ssh hk-edge 'echo password=OnlyAFixturePassword123'", "decision": "denied", "reasonId": "credential-read"
        });
        fs::write(dir.join(format!("{}.jsonl", &now[..10])), format!("{line}\n")).unwrap();
    }
}

#[test]
fn policy_follows_mode_even_when_skill_compilation_is_blocked() {
    let fixture = Fixture::new();
    let mut asset = fixture.seed();
    if let Asset::Vps(s) = &mut asset {
        s.notes = "password=only-a-fake-test-password".into();
    }
    fixture.backend.database().unwrap().upsert_asset(&asset).unwrap();
    let result = fixture.backend.set_mode(asset.id(), Mode::Standard).unwrap();
    assert!(result.statuses.iter().any(|s| s.blocked));
    let policy: Value =
        serde_json::from_slice(&fs::read(fixture.paths.data_dir.join("guard/policy.json")).unwrap()).unwrap();
    let resource = policy["resources"]
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["id"] == asset.id())
        .unwrap();
    assert_eq!(resource["mode"], "standard");
    fixture.backend.set_mode(asset.id(), Mode::ReadOnly).unwrap();
    let policy: Value =
        serde_json::from_slice(&fs::read(fixture.paths.data_dir.join("guard/policy.json")).unwrap()).unwrap();
    assert_eq!(policy["resources"][0]["mode"], "read-only");
}

#[test]
fn policy_failure_does_not_prevent_withdrawing_a_revoked_delivery() {
    let fixture = Fixture::new();
    let asset = fixture.seed();
    let delivery = fixture.paths.user_home.join(".claude/skills/cloudlink-servers");
    assert!(delivery.exists());
    let policy = fixture.paths.data_dir.join("guard/policy.json");
    fs::remove_file(&policy).unwrap();
    fs::create_dir(&policy).unwrap();
    assert!(
        fixture
            .backend
            .set_distribute(asset.id(), "claude-code", false)
            .is_err()
    );
    assert!(
        !fixture
            .backend
            .database()
            .unwrap()
            .require_asset(asset.id())
            .unwrap()
            .agent()
            .agents
            .iter()
            .any(|key| key == "claude-code")
    );
    assert!(
        !delivery.exists(),
        "a failed guard update must not preserve revoked Skill content"
    );
}

#[test]
fn guard_install_remove_emit_events_and_restore_exact_user_bytes() {
    let fixture = Fixture::new();
    fixture.seed();
    let installed = fixture.backend.install_guard(&EnvId::windows()).unwrap();
    assert_eq!(installed.state, GuardState::Active);
    assert_eq!(fs::read(&installed.planned.backup_path).unwrap(), ORIGINAL_SETTINGS);
    fixture.backend.remove_guard(&EnvId::windows()).unwrap();
    assert_eq!(
        fs::read(fixture.paths.user_home.join(".claude/settings.json")).unwrap(),
        ORIGINAL_SETTINGS
    );
    let events = fixture.events.0.lock().unwrap();
    assert!(events.iter().any(|(name, _)| name == "guard://changed"));
    assert!(
        events
            .iter()
            .any(|(name, data)| name == "activity://new" && data["item"]["messageId"] == "guard-removed")
    );
}

#[test]
fn feedback_import_redacts_before_events_and_merges_only_after_review() {
    let fixture = Fixture::new();
    let asset = fixture.seed();
    fixture.write_operation(&asset);
    fs::write(
        fixture.paths.inbox_dir().join("hk-edge.md"),
        "- 2026-11-01: Deploy from /opt/apps/api.\n- 2026-11-01: password=OnlyAFixturePassword123\n",
    )
    .unwrap();
    let pending = fixture.backend.list_notes(Some(asset.id())).unwrap();
    assert_eq!(pending.len(), 2);
    let flagged = pending
        .iter()
        .find(|n| n.flags.contains(&AgentNoteFlag::Secret))
        .unwrap();
    assert!(!flagged.text.contains("OnlyAFixturePassword123"));
    assert!(
        fixture
            .backend
            .merge_notes(vec![MergeNote {
                id: flagged.id.clone(),
                text: None
            }])
            .unwrap_err()
            .is_ipc(IpcErrorId::NoteHasSecret)
    );
    let result = fixture
        .backend
        .merge_notes(vec![MergeNote {
            id: flagged.id.clone(),
            text: Some("The config lives in /opt/apps/api.".into()),
        }])
        .unwrap();
    assert!(
        result
            .asset
            .as_server()
            .unwrap()
            .notes
            .contains("- 2026-11-01: The config lives in /opt/apps/api.")
    );
    let ops = fixture
        .backend
        .list_operations(OperationQuery {
            asset_id: Some(asset.id().into()),
            before: None,
            limit: 50,
        })
        .unwrap();
    assert_eq!(ops.len(), 1);
    assert!(!ops[0].command.contains("OnlyAFixturePassword123"));
    assert!(ops[0].command.contains("[已隐藏]"));
    let activity = fixture
        .backend
        .list_activity(ActivityQuery {
            asset_id: Some(asset.id().into()),
            before: None,
            limit: 100,
            kinds: Some(vec![ActivityKind::AgentOp]),
        })
        .unwrap();
    assert_eq!(activity.len(), 1);
    assert_eq!(fixture.backend.get_guard_status().unwrap()[0].denied_today, 1);
    fixture.backend.refresh_feedback().unwrap();
    let events = fixture.events.0.lock().unwrap();
    assert_eq!(events.iter().filter(|(name, _)| name == "operations://new").count(), 1);
    assert!(
        !serde_json::to_string(&*events)
            .unwrap()
            .contains("OnlyAFixturePassword123")
    );
}

#[test]
fn full_reset_removes_managed_data_and_preserves_user_files_and_keys() {
    let fixture = Fixture::new();
    let asset = fixture.seed();
    fixture.backend.install_guard(&EnvId::windows()).unwrap();
    fixture.write_operation(&asset);
    fs::write(
        fixture.paths.inbox_dir().join("hk-edge.md"),
        "- 2026-11-01: Durable fixture note.\n",
    )
    .unwrap();
    fixture.backend.refresh_feedback().unwrap();
    let foreign = fixture.paths.user_home.join(".claude/skills/user-skill");
    fs::create_dir_all(&foreign).unwrap();
    fs::write(foreign.join("SKILL.md"), b"user's own skill").unwrap();
    let unknown = fixture.paths.inbox_dir().join("keep-me.txt");
    fs::write(&unknown, b"user's own file").unwrap();
    let compiled = publish::output_dir(&fixture.paths.compiled_dir(), &EnvId::windows(), "claude-code");
    assert!(compiled.exists());
    fixture.backend.reset_data().unwrap();
    assert!(fixture.backend.list_assets().unwrap().is_empty());
    assert!(fixture.backend.list_targets().unwrap().is_empty());
    assert!(!compiled.exists());
    assert!(
        !fixture
            .paths
            .user_home
            .join(".claude/skills/cloudlink-servers")
            .exists()
    );
    assert!(!fixture.paths.user_home.join(".ssh/cloudlink.conf").exists());
    assert!(!guard::executable_path(&fixture.paths).exists());
    assert_eq!(
        fs::read(fixture.paths.user_home.join(".claude/settings.json")).unwrap(),
        ORIGINAL_SETTINGS
    );
    assert_eq!(
        fs::read(fixture.paths.user_home.join(".ssh/config")).unwrap(),
        ORIGINAL_SSH
    );
    assert_eq!(fs::read(foreign.join("SKILL.md")).unwrap(), b"user's own skill");
    assert_eq!(fs::read(&unknown).unwrap(), b"user's own file");
    assert!(fixture.paths.user_home.join(".ssh/user-key").is_file());
    assert!(
        fixture
            .backend
            .database()
            .unwrap()
            .list_notes(None, None)
            .unwrap()
            .is_empty()
    );
    assert!(
        fixture
            .backend
            .database()
            .unwrap()
            .password_cleanup()
            .unwrap()
            .is_empty()
    );
    assert!(!fixture.backend.database().unwrap().reset_pending().unwrap());
    fixture.backend.reset_data().unwrap();
}

#[test]
fn reset_leaves_foreign_same_named_skill_untouched() {
    let fixture = Fixture::new();
    let foreign = fixture.paths.user_home.join(".claude/skills/cloudlink-servers");
    fs::create_dir_all(&foreign).unwrap();
    fs::write(foreign.join("SKILL.md"), b"foreign same-named skill").unwrap();
    fixture.backend.reset_data().unwrap();
    assert_eq!(fs::read(foreign.join("SKILL.md")).unwrap(), b"foreign same-named skill");
}

#[test]
fn reset_refuses_foreign_data_owner_before_any_side_effect() {
    let fixture = Fixture::new();
    let asset = fixture.seed();
    fixture.backend.install_guard(&EnvId::windows()).unwrap();
    let path = fixture.paths.user_home.join(".claude/settings.json");
    let installed = fs::read(&path).unwrap();
    fs::write(
        fixture.paths.data_dir.join(".cloudlink.json"),
        br#"{"managedBy":"someone-else","kind":"data"}"#,
    )
    .unwrap();
    assert!(fixture.backend.reset_data().is_err());
    assert_eq!(fixture.backend.list_assets().unwrap()[0].id(), asset.id());
    assert_eq!(fs::read(path).unwrap(), installed);
    assert!(!fixture.backend.database().unwrap().reset_pending().unwrap());
}

#[derive(Default)]
struct FallibleVault {
    memory: MemoryCredentialStore,
    fail: AtomicBool,
    fail_after_write: AtomicBool,
    written: Mutex<Vec<String>>,
    backend: Mutex<Weak<Backend>>,
}
impl CredentialStore for FallibleVault {
    fn get(&self, key: &str) -> Result<Option<SecretString>> {
        self.memory.get(key)
    }
    fn set(&self, key: &str, value: &SecretString) -> Result<()> {
        self.memory.set(key, value)?;
        self.written.lock().unwrap().push(key.into());
        if self.fail_after_write.load(Ordering::SeqCst) {
            return Err(AppError::internal("fixture store failed after writing"));
        }
        Ok(())
    }
    fn delete(&self, key: &str) -> Result<()> {
        if let Some(backend) = self.backend.lock().unwrap().upgrade() {
            assert!(backend.db.try_lock().is_ok(), "vault deletion held the database lock");
            assert!(
                backend.mutation.try_lock().is_ok(),
                "vault deletion held the mutation lock"
            );
        }
        if self.fail.load(Ordering::SeqCst) {
            return Err(AppError::internal("fixture vault unavailable"));
        }
        self.memory.delete(key)
    }
}

#[test]
fn reset_keeps_failed_vault_receipts_and_blocks_republication_until_retry() {
    let vault = Arc::new(FallibleVault::default());
    let fixture = Fixture::with_vault(vault.clone());
    *vault.backend.lock().unwrap() = Arc::downgrade(&fixture.backend);
    let mut asset = fixture.seed();
    if let Asset::Vps(s) = &mut asset {
        s.connection.auth.as_mut().unwrap().method = AuthMethod::Password;
    }
    fixture.backend.database().unwrap().upsert_asset(&asset).unwrap();
    fixture
        .backend
        .set_password(asset.id(), Some("only-a-unit-test-password".into()))
        .unwrap();
    let revision = fixture
        .backend
        .database()
        .unwrap()
        .password_ref(asset.id())
        .unwrap()
        .unwrap();
    vault.fail.store(true, Ordering::SeqCst);
    assert!(
        fixture
            .backend
            .reset_data()
            .unwrap_err()
            .is_ipc(IpcErrorId::ResetIncomplete)
    );
    assert!(fixture.backend.database().unwrap().reset_pending().unwrap());
    assert_eq!(
        fixture
            .backend
            .database()
            .unwrap()
            .password_cleanup()
            .unwrap()
            .as_slice(),
        std::slice::from_ref(&revision)
    );
    assert!(
        fixture
            .backend
            .check_deliveries()
            .unwrap_err()
            .is_ipc(IpcErrorId::ResetIncomplete)
    );
    vault.fail.store(false, Ordering::SeqCst);
    fixture.backend.reset_data().unwrap();
    assert!(vault.get(&revision).unwrap().is_none());
    assert!(
        fixture
            .backend
            .database()
            .unwrap()
            .password_cleanup()
            .unwrap()
            .is_empty()
    );
    assert!(!fixture.backend.database().unwrap().reset_pending().unwrap());
}

#[test]
fn a_vault_error_after_writing_cleans_the_staged_secret_and_preserves_the_active_password() {
    let vault = Arc::new(FallibleVault::default());
    let fixture = Fixture::with_vault(vault.clone());
    *vault.backend.lock().unwrap() = Arc::downgrade(&fixture.backend);
    let mut asset = fixture.seed();
    if let Asset::Vps(s) = &mut asset {
        s.connection.auth.as_mut().unwrap().method = AuthMethod::Password;
    }
    fixture.backend.database().unwrap().upsert_asset(&asset).unwrap();
    fixture
        .backend
        .set_password(asset.id(), Some("old-fixture-secret".into()))
        .unwrap();
    let active = fixture
        .backend
        .database()
        .unwrap()
        .password_ref(asset.id())
        .unwrap()
        .unwrap();
    vault.fail_after_write.store(true, Ordering::SeqCst);
    assert!(
        fixture
            .backend
            .set_password(asset.id(), Some("new-fixture-secret".into()))
            .is_err()
    );
    let staged = vault.written.lock().unwrap().last().unwrap().clone();
    assert_ne!(staged, active);
    assert!(vault.get(&staged).unwrap().is_none());
    assert_eq!(vault.get(&active).unwrap().unwrap().expose(), "old-fixture-secret");
    assert_eq!(
        fixture
            .backend
            .database()
            .unwrap()
            .password_ref(asset.id())
            .unwrap()
            .unwrap(),
        active
    );
    assert!(
        fixture
            .backend
            .database()
            .unwrap()
            .password_cleanup()
            .unwrap()
            .is_empty()
    );
}

#[test]
fn reopening_interrupted_reset_does_not_recreate_policy_or_skills() {
    let fixture = Fixture::new();
    fixture.seed();
    fixture.backend.database().unwrap().begin_reset().unwrap();
    fs::remove_file(fixture.paths.data_dir.join("guard/policy.json")).unwrap();
    let reopened = Backend::with_services(
        fixture.paths.clone(),
        Arc::new(FakeSystem::default()),
        Arc::new(MemoryCredentialStore::default()),
        cli::Service::new(Arc::new(cli::EmptyRunner)),
        Arc::new(Events::default()),
    )
    .unwrap();
    assert!(!fixture.paths.data_dir.join("guard/policy.json").exists());
    assert!(
        reopened
            .detect_environments()
            .unwrap_err()
            .is_ipc(IpcErrorId::ResetIncomplete)
    );
    reopened.reset_data().unwrap();
    assert!(reopened.list_assets().unwrap().is_empty());
}

#[test]
fn reset_invalidates_delayed_mutations_but_allows_new_work_after_success() {
    let fixture = Fixture::new();
    let epoch = fixture.backend.reset_epoch.load(Ordering::SeqCst);
    fixture.backend.reset_data().unwrap();
    assert!(
        fixture
            .backend
            .edit_at(epoch)
            .unwrap_err()
            .is_ipc(IpcErrorId::ResetIncomplete)
    );
    assert!(fixture.backend.edit().is_ok());
    fixture.backend.detect_environments().unwrap();
    assert!(!fixture.backend.list_targets().unwrap().is_empty());
}

#[test]
fn shared_rule_catalog_matches_the_frontend_guard_contract() {
    let rules: crate::model::guard::GuardRules = serde_json::from_value(guard_rules::rules()).unwrap();
    assert!(!rules.read_only_allow.is_empty());
    assert!(
        rules
            .always_deny
            .iter()
            .any(|r| r.id == crate::model::guard::GuardReasonId::CliEnvExport)
    );
}

struct WaitingVault {
    memory: MemoryCredentialStore,
    entered: Barrier,
    release: Barrier,
}

impl CredentialStore for WaitingVault {
    fn get(&self, key: &str) -> Result<Option<SecretString>> {
        self.memory.get(key)
    }
    fn set(&self, key: &str, value: &SecretString) -> Result<()> {
        self.entered.wait();
        self.release.wait();
        self.memory.set(key, value)
    }
    fn delete(&self, key: &str) -> Result<()> {
        self.memory.delete(key)
    }
}

#[test]
fn reset_does_not_complete_ahead_of_an_inflight_vault_write() {
    let vault = Arc::new(WaitingVault {
        memory: MemoryCredentialStore::default(),
        entered: Barrier::new(2),
        release: Barrier::new(2),
    });
    let fixture = Fixture::with_vault(vault.clone());
    let mut asset = fixture.seed();
    if let Asset::Vps(s) = &mut asset {
        s.connection.auth.as_mut().unwrap().method = AuthMethod::Password;
    }
    fixture.backend.database().unwrap().upsert_asset(&asset).unwrap();
    let backend = fixture.backend.clone();
    let writer = std::thread::spawn(move || backend.set_password(asset.id(), Some("fake-inflight-value".into())));
    vault.entered.wait();
    let reset = fixture.backend.reset_data();
    vault.release.wait();
    assert!(reset.unwrap_err().is_ipc(IpcErrorId::ResetIncomplete));
    assert!(writer.join().unwrap().unwrap_err().is_ipc(IpcErrorId::ResetIncomplete));
    assert!(
        fixture
            .backend
            .database()
            .unwrap()
            .password_cleanup()
            .unwrap()
            .is_empty()
    );
    fixture.backend.reset_data().unwrap();
    assert!(fixture.backend.list_assets().unwrap().is_empty());
}
