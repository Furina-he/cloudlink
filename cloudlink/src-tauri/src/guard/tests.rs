use std::fs;
use std::path::Path;

use serde_json::{Value, json};

use super::*;
use crate::env::WslInfo;
use crate::model::asset::{Asset, Mode};
use crate::model::guard::{GuardDetailId, GuardState};
use crate::testkit;

struct TestResult(bool);

impl SelfTest for TestResult {
    fn run(&self, _paths: &Paths, _env: &EnvContext) -> bool {
        self.0
    }
}

fn fixture() -> (tempfile::TempDir, Paths, EnvContext) {
    let temporary = tempfile::tempdir().unwrap();
    let paths = Paths::isolated_in(temporary.path());
    fs::create_dir_all(&paths.data_dir).unwrap();
    fs::write(
        paths.data_dir.join(".cloudlink.json"),
        br#"{"managedBy":"cloudlink","kind":"data"}"#,
    )
    .unwrap();
    fs::create_dir_all(paths.user_home.join(".claude")).unwrap();
    let source = temporary.path().join("bundled-guard.exe");
    fs::write(&source, b"unit-test-guard-binary-do-not-execute").unwrap();
    sync_binary(&paths, &source).unwrap();
    write_policy(
        &paths,
        &[Asset::Vps(testkit::hk_edge()), Asset::Cli(testkit::cloudflare())],
    )
    .unwrap();
    let environment = EnvContext::windows(&paths);
    (temporary, paths, environment)
}

fn write_settings(environment: &EnvContext, bytes: &[u8]) {
    fs::create_dir_all(environment.host_home.join(".claude")).unwrap();
    fs::write(settings::settings_path(environment), bytes).unwrap();
}

#[test]
fn install_and_remove_restore_arbitrary_original_bytes() {
    for original in [
        b"{}".as_slice(),
        b"{ \n \t}\r\n",
        br#"{"theme":"dark","permissions":{"deny":["Read(.env)"]}}"#,
        br#"{"hooks":{"PostToolUse":[{"matcher":"Write","hooks":[{"type":"command","command":"other"}]}]}}"#,
        br#"{"hooks":{"PreToolUse":[{"matcher":"Bash","hooks":[{"type":"command","command":"echo cloudlink-guard-is-my-script"}]}]},"x":7}"#,
        "{\r\n\t\"备注\" : \"钢与信号\",\r\n\t\"hooks\" : {\r\n\t\t\"PreToolUse\" : []\r\n\t}\r\n}\r\n".as_bytes(),
    ] {
        let (_temporary, paths, environment) = fixture();
        write_settings(&environment, original);
        let installed = install(&paths, &environment, 4, &TestResult(true)).unwrap();
        assert_eq!(installed.state, GuardState::Active);
        assert_eq!(installed.denied_today, 4);
        assert_eq!(fs::read(environment.host_home.join(".claude/settings.json.cloudlink-bak")).unwrap(), original);
        let after = fs::read(settings::settings_path(&environment)).unwrap();
        let entry: Value = serde_json::from_str(&installed.planned.entry).unwrap();
        let document: Value = serde_json::from_slice(&after).unwrap();
        assert!(document["hooks"]["PreToolUse"].as_array().unwrap().contains(&entry));
        install(&paths, &environment, 4, &TestResult(true)).unwrap();
        assert_eq!(fs::read(settings::settings_path(&environment)).unwrap(), after, "idempotent install");
        assert_eq!(remove(&paths, &environment, 4, &TestResult(true)).unwrap().state, GuardState::NotInstalled);
        assert_eq!(fs::read(settings::settings_path(&environment)).unwrap(), original);
    }
}

#[test]
fn original_absence_is_restored_and_unknown_files_stay() {
    let (_temporary, paths, environment) = fixture();
    let unrelated = environment.host_home.join(".claude/other.json");
    fs::write(&unrelated, b"not CloudLink").unwrap();
    install(&paths, &environment, 0, &TestResult(true)).unwrap();
    remove(&paths, &environment, 0, &TestResult(true)).unwrap();
    assert!(!settings::settings_path(&environment).exists());
    assert_eq!(fs::read(unrelated).unwrap(), b"not CloudLink");
}

#[test]
fn external_edits_are_preserved_including_other_hooks_in_our_wrapper() {
    let (_temporary, paths, environment) = fixture();
    write_settings(&environment, br#"{"theme":"dark"}"#);
    install(&paths, &environment, 0, &TestResult(true)).unwrap();
    let command = hook_command(&paths, &environment);
    let external = format!(
        "{{\r\n \"theme\" : \"light\", \"hooks\": {{\"PreToolUse\":[{{\"matcher\":\"Bash\",\"hooks\":[{{\"type\":\"command\",\"command\":{},\"timeout\":10}}, {{\"type\":\"command\",\"command\":\"my hook\"}}]}}]}}, \"outside\": 42\r\n}}\r\n",
        serde_json::to_string(&command).unwrap()
    );
    write_settings(&environment, external.as_bytes());
    remove(&paths, &environment, 0, &TestResult(true)).unwrap();
    let after = fs::read_to_string(settings::settings_path(&environment)).unwrap();
    assert_eq!(
        after,
        "{\r\n \"theme\" : \"light\", \"hooks\": {\"PreToolUse\":[{\"matcher\":\"Bash\",\"hooks\":[{\"type\":\"command\",\"command\":\"my hook\"}]}]}, \"outside\": 42\r\n}\r\n"
    );
}

#[test]
fn removal_keeps_a_preexisting_read_hook_with_the_same_command() {
    let (_temporary, paths, environment) = fixture();
    let command = hook_command(&paths, &environment);
    let original = json!({"setting":1,"hooks":{"PreToolUse":[{"matcher":"Read","hooks":[{"type":"command","command":command,"timeout":10}]}]}});
    write_settings(&environment, &serde_json::to_vec(&original).unwrap());
    install(&paths, &environment, 0, &TestResult(true)).unwrap();
    let mut changed: Value = serde_json::from_slice(&fs::read(settings::settings_path(&environment)).unwrap()).unwrap();
    changed["setting"] = 2.into();
    write_settings(&environment, &serde_json::to_vec(&changed).unwrap());
    remove(&paths, &environment, 0, &TestResult(true)).unwrap();
    let after: Value = serde_json::from_slice(&fs::read(settings::settings_path(&environment)).unwrap()).unwrap();
    assert_eq!(after["setting"], 2);
    assert_eq!(after["hooks"], original["hooks"]);
}

#[test]
fn remove_refuses_a_hook_moved_to_another_matcher_or_event_without_touching_settings() {
    for changed_event in [false, true] {
        let (_temporary, paths, environment) = fixture();
        let command = hook_command(&paths, &environment);
        let original = json!({"setting":1,"hooks":{"PreToolUse":[{"matcher":"Read","hooks":[{"type":"command","command":command,"timeout":10}]}]}});
        write_settings(&environment, &serde_json::to_vec(&original).unwrap());
        install(&paths, &environment, 0, &TestResult(true)).unwrap();
        let mut changed: Value =
            serde_json::from_slice(&fs::read(settings::settings_path(&environment)).unwrap()).unwrap();
        changed["setting"] = 2.into();
        if changed_event {
            let own = changed["hooks"]["PreToolUse"].as_array_mut().unwrap().pop().unwrap();
            changed["hooks"]["PostToolUse"] = json!([own]);
        } else {
            changed["hooks"]["PreToolUse"][1]["matcher"] = "Read".into();
        }
        let before = serde_json::to_vec(&changed).unwrap();
        write_settings(&environment, &before);
        assert!(preflight_remove(&paths, &environment).is_err());
        assert!(remove(&paths, &environment, 0, &TestResult(true)).is_err());
        assert!(preflight_reset(&paths, std::slice::from_ref(&environment)).is_err());
        assert_eq!(fs::read(settings::settings_path(&environment)).unwrap(), before);
        assert_eq!(
            fs::read(environment.host_home.join(".claude/settings.json.cloudlink-bak")).unwrap(),
            serde_json::to_vec(&original).unwrap()
        );
    }
}

#[test]
fn reset_refuses_missing_parent_markers_when_hook_receipts_survive() {
    for marker in ["guard/.cloudlink.json", "guard/hooks/.cloudlink.json"] {
        let (_temporary, paths, environment) = fixture();
        write_settings(&environment, b"{\"setting\":1}\n");
        install(&paths, &environment, 0, &TestResult(true)).unwrap();
        let before = fs::read(settings::settings_path(&environment)).unwrap();
        fs::remove_file(paths.data_dir.join(marker)).unwrap();
        assert!(preflight_remove(&paths, &environment).is_err());
        assert!(preflight_reset(&paths, std::slice::from_ref(&environment)).is_err());
        assert!(reset_managed_files(&paths, std::slice::from_ref(&environment)).is_err());
        assert_eq!(fs::read(settings::settings_path(&environment)).unwrap(), before);
        assert_eq!(
            status(&paths, &environment, 0, &TestResult(true)).state,
            GuardState::Broken
        );
    }
}

#[test]
fn malformed_settings_are_never_changed_or_backed_up() {
    for original in [
        b"not-json".as_slice(),
        b"[1]",
        br#"{"hooks":[]} "#,
        br#"{"hooks":{"PreToolUse":{}}}"#,
    ] {
        let (_temporary, paths, environment) = fixture();
        write_settings(&environment, original);
        assert!(install(&paths, &environment, 0, &TestResult(true)).is_err());
        assert_eq!(fs::read(settings::settings_path(&environment)).unwrap(), original);
        assert!(
            !environment
                .host_home
                .join(".claude/settings.json.cloudlink-bak")
                .exists()
        );
        // Reset/removal skips unowned JSON, even when it is malformed.
        preflight_remove(&paths, &environment).unwrap();
        remove(&paths, &environment, 0, &TestResult(true)).unwrap();
        assert_eq!(fs::read(settings::settings_path(&environment)).unwrap(), original);
    }
}

#[test]
fn preexisting_backup_and_identical_foreign_hook_are_not_claimed() {
    let (_temporary, paths, environment) = fixture();
    write_settings(&environment, b"{}\n");
    let backup = environment.host_home.join(".claude/settings.json.cloudlink-bak");
    fs::write(&backup, b"user backup").unwrap();
    assert!(install(&paths, &environment, 0, &TestResult(true)).is_err());
    assert_eq!(fs::read(&backup).unwrap(), b"user backup");
    assert_eq!(fs::read(settings::settings_path(&environment)).unwrap(), b"{}\n");

    let (_temporary2, paths2, environment2) = fixture();
    let authored = json!({"hooks":{"PreToolUse":[serde_json::from_str::<Value>(&planned(&paths2, &environment2).entry).unwrap()]}});
    let original = serde_json::to_vec(&authored).unwrap();
    write_settings(&environment2, &original);
    assert!(install(&paths2, &environment2, 0, &TestResult(true)).is_err());
    remove(&paths2, &environment2, 0, &TestResult(true)).unwrap();
    assert_eq!(fs::read(settings::settings_path(&environment2)).unwrap(), original);
}

#[test]
fn disabled_hooks_missing_entries_and_failed_runtime_are_distinguished() {
    let (_temporary, paths, environment) = fixture();
    write_settings(&environment, br#"{"disableAllHooks":true}"#);
    let disabled = status(&paths, &environment, 0, &TestResult(true));
    assert_eq!(disabled.detail.unwrap().id, GuardDetailId::HooksDisabled);
    assert!(install(&paths, &environment, 0, &TestResult(true)).is_err());
    write_settings(&environment, b"{}\n");
    assert!(install(&paths, &environment, 0, &TestResult(false)).is_err());
    assert_eq!(fs::read(settings::settings_path(&environment)).unwrap(), b"{}\n");
    install(&paths, &environment, 0, &TestResult(true)).unwrap();
    assert_eq!(
        status(&paths, &environment, 0, &TestResult(false)).detail.unwrap().id,
        GuardDetailId::SelfTestFailed
    );
    write_settings(&environment, b"{ \"changed\": true }\n");
    assert_eq!(
        status(&paths, &environment, 0, &TestResult(true)).detail.unwrap().id,
        GuardDetailId::EntryMissing
    );
    install(&paths, &environment, 0, &TestResult(true)).unwrap();
    remove(&paths, &environment, 0, &TestResult(true)).unwrap();
    assert_eq!(
        fs::read(settings::settings_path(&environment)).unwrap(),
        b"{ \"changed\": true }\n"
    );
}

#[test]
fn modified_owned_backup_blocks_remove_and_reset_before_touching_settings() {
    let (_temporary, paths, environment) = fixture();
    write_settings(&environment, b"{\"user\":7}\n");
    install(&paths, &environment, 0, &TestResult(true)).unwrap();
    let before = fs::read(settings::settings_path(&environment)).unwrap();
    fs::write(
        environment.host_home.join(".claude/settings.json.cloudlink-bak"),
        b"external change",
    )
    .unwrap();
    assert!(remove(&paths, &environment, 0, &TestResult(true)).is_err());
    assert!(preflight_reset(&paths, std::slice::from_ref(&environment)).is_err());
    assert_eq!(fs::read(settings::settings_path(&environment)).unwrap(), before);
}

#[test]
fn removal_can_resume_after_the_backup_was_pruned() {
    let (_temporary, paths, environment) = fixture();
    write_settings(&environment, b"{\"user\":7}\n");
    install(&paths, &environment, 0, &TestResult(true)).unwrap();
    // Simulate a crash after the completed-settings receipt and backup cleanup,
    // followed by a user's unrelated edit before the next reset attempt.
    let directory = paths.data_dir.join("guard/hooks");
    let receipt_path = fs::read_dir(&directory)
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .find(|path| path.file_name().unwrap() != ".cloudlink.json")
        .unwrap();
    let mut receipt: Value = serde_json::from_slice(&fs::read(&receipt_path).unwrap()).unwrap();
    receipt["removed"] = true.into();
    fs::write(&receipt_path, serde_json::to_vec(&receipt).unwrap()).unwrap();
    fs::remove_file(environment.host_home.join(".claude/settings.json.cloudlink-bak")).unwrap();
    let external = b"{ \"user\" : 9 }\n";
    write_settings(&environment, external);
    preflight_remove(&paths, &environment).unwrap();
    remove(&paths, &environment, 0, &TestResult(true)).unwrap();
    assert_eq!(fs::read(settings::settings_path(&environment)).unwrap(), external);
    assert!(!receipt_path.exists());
}

#[test]
fn pending_install_recovers_at_each_write_boundary_without_losing_original_settings() {
    for boundary in ["before-backup", "before-settings", "after-settings"] {
        let (_temporary, paths, environment) = fixture();
        let original = b"{\r\n \"user\" : 17, \"hooks\" : {\"PreToolUse\": []}\r\n}\r\n";
        write_settings(&environment, original);
        install(&paths, &environment, 0, &TestResult(true)).unwrap();
        let receipt_path = fs::read_dir(paths.data_dir.join("guard/hooks"))
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .find(|path| path.file_name().unwrap() != ".cloudlink.json")
            .unwrap();
        let mut receipt: Value = serde_json::from_slice(&fs::read(&receipt_path).unwrap()).unwrap();
        receipt["pending"] = true.into();
        fs::write(&receipt_path, serde_json::to_vec(&receipt).unwrap()).unwrap();
        if boundary != "after-settings" {
            write_settings(&environment, original);
        }
        if boundary == "before-backup" {
            fs::remove_file(environment.host_home.join(".claude/settings.json.cloudlink-bak")).unwrap();
        }
        assert_eq!(
            install(&paths, &environment, 0, &TestResult(true)).unwrap().state,
            GuardState::Active,
            "{boundary}"
        );
        let completed: Value = serde_json::from_slice(&fs::read(&receipt_path).unwrap()).unwrap();
        assert_eq!(completed["pending"], false, "{boundary}");
        remove(&paths, &environment, 0, &TestResult(true)).unwrap();
        assert_eq!(
            fs::read(settings::settings_path(&environment)).unwrap(),
            original,
            "{boundary}"
        );
    }
}

#[test]
fn binary_copy_is_versioned_by_content_and_modified_executables_are_never_run() {
    let (temporary, paths, environment) = fixture();
    let source = temporary.path().join("bundled-guard.exe");
    assert!(!sync_binary(&paths, &source).unwrap());
    fs::write(&source, b"guard-next-version").unwrap();
    assert!(sync_binary(&paths, &source).unwrap());
    assert!(runtime_valid(&paths));
    install(&paths, &environment, 0, &TestResult(true)).unwrap();
    fs::write(executable_path(&paths), b"tampered binary").unwrap();
    assert!(!runtime_valid(&paths));
    assert!(sync_binary(&paths, &source).is_err());
    assert_eq!(
        status(&paths, &environment, 0, &TestResult(true)).detail.unwrap().id,
        GuardDetailId::SelfTestFailed
    );
}

#[test]
fn pending_binary_update_recovers_before_and_after_executable_replacement() {
    for executable_replaced in [false, true] {
        let (temporary, paths, _environment) = fixture();
        let source = temporary.path().join("bundled-guard.exe");
        let next = b"guard-crash-recovery-next-version";
        fs::write(&source, next).unwrap();
        let marker_path = paths.data_dir.join("bin/.cloudlink.json");
        let mut marker: Value = serde_json::from_slice(&fs::read(&marker_path).unwrap()).unwrap();
        marker["pendingHash"] = owned::hash(next).into();
        fs::write(&marker_path, serde_json::to_vec(&marker).unwrap()).unwrap();
        if executable_replaced {
            fs::write(executable_path(&paths), next).unwrap();
        }
        assert!(!runtime_valid(&paths));
        preflight_reset(&paths, &[]).unwrap();
        assert_eq!(sync_binary(&paths, &source).unwrap(), !executable_replaced);
        assert!(runtime_valid(&paths));
        let completed: Value = serde_json::from_slice(&fs::read(marker_path).unwrap()).unwrap();
        assert!(completed.get("pendingHash").is_none());
        assert_eq!(completed["hash"], owned::hash(next));
        assert_eq!(fs::read(executable_path(&paths)).unwrap(), next);
    }
}

#[test]
fn policy_tracks_modes_and_selected_scopes_without_secrets_or_private_paths() {
    let (_temporary, paths, _environment) = fixture();
    let mut server = testkit::hk_edge();
    let mut cli = testkit::cloudflare();
    server.agent.mode = Mode::Standard;
    server.agent.agents.clear();
    server.notes = "do not export this note password=never".into();
    cli.cli.scope.iter_mut().for_each(|scope| scope.selected = false);
    write_policy(&paths, &[Asset::Vps(server), Asset::Cli(cli)]).unwrap();
    let text = fs::read_to_string(paths.data_dir.join("guard/policy.json")).unwrap();
    let value: Value = serde_json::from_str(&text).unwrap();
    assert!(guard_rules::policy_valid(&value));
    assert_eq!(value["resources"][0]["mode"], "standard");
    assert!(
        value["resources"][0]["hosts"]
            .as_array()
            .unwrap()
            .contains(&json!("203.0.113.10"))
    );
    assert_eq!(value["resources"][0]["criticalServices"], json!(["openresty"]));
    assert_eq!(value["resources"][1]["scope"], json!([]));
    assert!(!text.contains("password="));
    assert!(!text.contains("id_ed25519"));
    assert!(!text.contains("personal.me"));
}

#[test]
fn policy_current_rejects_stale_modes_accounts_and_scope() {
    let (_temporary, paths, _environment) = fixture();
    let assets = vec![Asset::Vps(testkit::hk_edge()), Asset::Cli(testkit::cloudflare())];
    assert!(policy_current(&paths, &assets));
    let mut mode = assets.clone();
    mode[0].agent_mut().mode = Mode::Standard;
    assert!(!policy_current(&paths, &mode));
    let mut account = assets.clone();
    let Asset::Cli(cli) = &mut account[1] else {
        unreachable!()
    };
    cli.account = Some("changed-account".into());
    assert!(!policy_current(&paths, &account));
    let mut scope = assets.clone();
    let Asset::Cli(cli) = &mut scope[1] else { unreachable!() };
    cli.cli.scope[0].selected = false;
    assert!(!policy_current(&paths, &scope));
    write_policy(&paths, &scope).unwrap();
    assert!(policy_current(&paths, &scope));
}

#[test]
fn policy_never_adopts_an_unowned_existing_file() {
    let (_temporary, paths, _environment) = fixture();
    let path = paths.data_dir.join("guard/policy.json");
    fs::write(
        paths.data_dir.join("guard/.cloudlink.json"),
        br#"{"managedBy":"cloudlink","kind":"guard","version":1}"#,
    )
    .unwrap();
    fs::write(&path, br#"{"version":1,"resources":[]}"#).unwrap();
    assert!(write_policy(&paths, &[]).is_err());
    assert_eq!(fs::read(path).unwrap(), br#"{"version":1,"resources":[]}"#);
}

#[test]
fn owned_corrupt_policy_can_be_repaired_or_cleaned_up() {
    let (_temporary, paths, environment) = fixture();
    let policy = paths.data_dir.join("guard/policy.json");
    fs::write(&policy, b"broken JSON").unwrap();
    assert!(!runtime_valid(&paths));
    write_policy(&paths, &[Asset::Vps(testkit::hk_edge())]).unwrap();
    assert!(runtime_valid(&paths));
    fs::write(&policy, b"broken again").unwrap();
    preflight_reset(&paths, std::slice::from_ref(&environment)).unwrap();
    reset_managed_files(&paths, &[environment]).unwrap();
    assert!(!policy.exists());
}

#[test]
fn reset_removes_managed_artifacts_and_preserves_unknown_siblings() {
    let (_temporary, paths, environment) = fixture();
    let original = b"{ \"theme\": \"dark\" }\n";
    write_settings(&environment, original);
    install(&paths, &environment, 0, &TestResult(true)).unwrap();
    fs::write(paths.data_dir.join("guard/user-file.txt"), b"keep").unwrap();
    fs::write(paths.data_dir.join("bin/user.exe"), b"keep binary").unwrap();
    preflight_reset(&paths, std::slice::from_ref(&environment)).unwrap();
    reset_managed_files(&paths, std::slice::from_ref(&environment)).unwrap();
    assert_eq!(fs::read(settings::settings_path(&environment)).unwrap(), original);
    assert!(!executable_path(&paths).exists());
    assert!(!paths.data_dir.join("guard/policy.json").exists());
    assert_eq!(fs::read(paths.data_dir.join("guard/user-file.txt")).unwrap(), b"keep");
    assert_eq!(fs::read(paths.data_dir.join("bin/user.exe")).unwrap(), b"keep binary");
}

#[test]
fn isolated_wsl_installation_and_posix_quoting_have_no_real_home_fallback() {
    let (_temporary, paths, _environment) = fixture();
    let mut environment = EnvContext::wsl(
        &paths,
        "Ubuntu-24.04",
        WslInfo {
            home: "/home/me".into(),
            user: "me".into(),
            interop: true,
            mount_prefix: "/mnt/".into(),
        },
    );
    let original = b"{\"user_setting\":true}\n";
    write_settings(&environment, original);
    install(&paths, &environment, 0, &TestResult(true)).unwrap();
    assert!(settings::settings_path(&environment).starts_with(&paths.wsl_root));
    remove(&paths, &environment, 0, &TestResult(true)).unwrap();
    assert_eq!(fs::read(settings::settings_path(&environment)).unwrap(), original);
    environment.interop = false;
    assert_eq!(
        status(&paths, &environment, 0, &TestResult(true)).state,
        GuardState::Unavailable
    );
    assert!(install(&paths, &environment, 0, &TestResult(true)).is_err());

    let mut quoted_paths = paths;
    quoted_paths.data_dir = PathBuf::from(r"C:\Users\Cloud 用户's $(name)\data");
    let command = hook_command(&quoted_paths, &environment);
    assert_eq!(
        command,
        "'/mnt/c/Users/Cloud 用户'\\''s $(name)/data/bin/cloudlink-guard.exe' --env 'wsl:Ubuntu-24.04'"
    );
}

#[test]
fn a_forged_environment_cannot_redirect_an_isolated_settings_write() {
    let (_temporary, paths, mut environment) = fixture();
    let outside = tempfile::tempdir().unwrap();
    environment.host_home = outside.path().into();
    assert!(install(&paths, &environment, 0, &TestResult(true)).is_err());
    assert!(!outside.path().join(".claude").exists());
}

#[cfg(any(windows, unix))]
fn link_dir(link: &Path, target: &Path) {
    #[cfg(windows)]
    use std::os::windows::process::CommandExt;
    assert!(link.is_absolute() && target.is_absolute());
    #[cfg(unix)]
    std::os::unix::fs::symlink(target, link).unwrap();
    #[cfg(windows)]
    match std::os::windows::fs::symlink_dir(target, link) {
        Ok(()) => {}
        Err(error) if error.raw_os_error() == Some(1314) => {
            let result = crate::proc::command("cmd.exe")
                .args(["/D", "/V:OFF", "/C"])
                .raw_arg(r#"mklink /J "%CLOUDLINK_TEST_LINK%" "%CLOUDLINK_TEST_TARGET%""#)
                .env("CLOUDLINK_TEST_LINK", link)
                .env("CLOUDLINK_TEST_TARGET", target)
                .output()
                .unwrap();
            assert!(result.status.success(), "{}", String::from_utf8_lossy(&result.stderr));
        }
        Err(error) => panic!("cannot create directory link: {error}"),
    }
}

#[cfg(any(windows, unix))]
#[test]
fn settings_ancestor_reparse_points_are_rejected_without_following() {
    let (_temporary, paths, environment) = fixture();
    let outside = tempfile::tempdir().unwrap();
    fs::write(outside.path().join("settings.json"), b"{\"external\":true}\n").unwrap();
    let claude = environment.host_home.join(".claude");
    fs::remove_dir(&claude).unwrap();
    link_dir(&claude, outside.path());
    assert!(install(&paths, &environment, 0, &TestResult(true)).is_err());
    assert_eq!(
        fs::read(outside.path().join("settings.json")).unwrap(),
        b"{\"external\":true}\n"
    );
    assert!(!outside.path().join("settings.json.cloudlink-bak").exists());
    #[cfg(windows)]
    fs::remove_dir(&claude).unwrap();
    #[cfg(unix)]
    fs::remove_file(&claude).unwrap();
}
