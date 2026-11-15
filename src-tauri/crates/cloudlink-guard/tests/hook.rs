use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{Value, json};

struct Fixture {
    root: PathBuf,
    exe: PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let suffix = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let root = std::env::temp_dir()
            .join(format!("cloudlink-guard-{}-{suffix}", std::process::id()))
            .join("含空格 guard data");
        fs::create_dir_all(root.join("bin")).unwrap();
        fs::create_dir_all(root.join("guard")).unwrap();
        let exe = root.join("bin").join(if cfg!(windows) {
            "cloudlink-guard.exe"
        } else {
            "cloudlink-guard"
        });
        fs::copy(env!("CARGO_BIN_EXE_cloudlink-guard"), &exe).unwrap();
        fs::write(
            root.join(".cloudlink.json"),
            b"{\"managedBy\":\"cloudlink\",\"kind\":\"data\"}",
        )
        .unwrap();
        fs::write(
            root.join("guard/.cloudlink.json"),
            b"{\"managedBy\":\"cloudlink\",\"kind\":\"guard\"}",
        )
        .unwrap();
        let fixture = Self { root, exe };
        fixture.policy(json!({"version":1,"resources":[{"id":"ast-test","kind":"vps","handle":"test-vps","mode":"read-only","envIds":["windows","wsl:Fixture"],"hosts":[],"criticalServices":[]}]}));
        fixture
    }

    fn policy(&self, value: Value) {
        fs::write(self.root.join("guard/policy.json"), serde_json::to_vec(&value).unwrap()).unwrap();
    }

    fn run(&self, input: &[u8], args: &[&str]) -> Output {
        let mut child = Command::new(&self.exe)
            .args(args)
            .env("HOME", self.root.join("unused-home"))
            .env("USERPROFILE", self.root.join("unused-profile"))
            .env("APPDATA", self.root.join("unused-appdata"))
            .env("CLOUDLINK_HOME", self.root.join("deliberately-wrong-root"))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        if let Some(mut stdin) = child.stdin.take() {
            // Missing policy/self-test intentionally need not consume stdin.
            let _ = stdin.write_all(input);
        }
        child.wait_with_output().unwrap()
    }

    fn bash(&self, command: &str) -> Output {
        self.run(&serde_json::to_vec(&json!({"tool_name":"Bash","session_id":"fixture-session","cwd":"/fixture/project","tool_input":{"command":command}})).unwrap(), &["--env", "windows"])
    }

    fn records(&self) -> Vec<Value> {
        let directory = self.root.join("guard/log");
        if !directory.exists() {
            return Vec::new();
        }
        fs::read_dir(directory)
            .unwrap()
            .filter_map(Result::ok)
            .filter(|e| e.path().extension().is_some_and(|e| e == "jsonl"))
            .flat_map(|e| {
                fs::read_to_string(e.path())
                    .unwrap()
                    .lines()
                    .map(|line| serde_json::from_str(line).unwrap())
                    .collect::<Vec<Value>>()
            })
            .collect()
    }
}

fn no_links(path: &Path) -> bool {
    let metadata = fs::symlink_metadata(path).unwrap();
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return false;
        }
    }
    !metadata.file_type().is_symlink()
        && (!metadata.is_dir() || fs::read_dir(path).unwrap().all(|e| no_links(&e.unwrap().path())))
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let parent = self.root.parent().unwrap();
        let temporary = fs::canonicalize(std::env::temp_dir()).unwrap();
        let resolved = fs::canonicalize(parent).unwrap();
        assert!(resolved.starts_with(&temporary) && resolved != temporary);
        assert!(no_links(parent));
        fs::remove_dir_all(parent).unwrap();
    }
}

#[test]
fn denied_json_is_a_real_hook_response_and_operation_is_redacted() {
    let fixture = Fixture::new();
    let output = fixture.bash("ssh test-vps 'echo password=fixture-private > .env'");
    assert!(output.status.success());
    assert!(output.stderr.is_empty());
    let deny: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(deny["hookSpecificOutput"]["hookEventName"], "PreToolUse");
    assert_eq!(deny["hookSpecificOutput"]["permissionDecision"], "deny");
    assert!(!String::from_utf8_lossy(&output.stdout).contains("fixture-private"));
    let records = fixture.records();
    assert_eq!(records.len(), 1);
    assert_eq!(records[0]["assetId"], "ast-test");
    assert_eq!(records[0]["decision"], "denied");
    assert_eq!(records[0]["reasonId"], "credential-read");
    assert!(!records[0].to_string().contains("fixture-private"));
    assert!(records[0]["command"].as_str().unwrap().contains("[已隐藏]"));
    assert!(!fixture.root.join("deliberately-wrong-root").exists());
}

#[test]
fn allowance_is_silent_and_does_not_bypass_the_agents_permission_system() {
    let fixture = Fixture::new();
    let output = fixture.bash("ssh test-vps uptime");
    assert!(output.status.success() && output.stdout.is_empty() && output.stderr.is_empty());
    let records = fixture.records();
    assert_eq!(records.len(), 1);
    assert_eq!(records[0]["decision"], "allowed");
    assert!(records[0].get("reasonId").is_none());
}

#[test]
fn missing_invalid_policy_and_unrelated_input_are_silent_without_records() {
    let fixture = Fixture::new();
    for input in [
        b"not-json".as_slice(),
        b"{\"tool_name\":\"Read\",\"tool_input\":{\"command\":\"ssh test-vps reboot\"}}",
        b"{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":42}}",
    ] {
        let output = fixture.run(input, &["--env", "windows"]);
        assert!(output.status.success() && output.stdout.is_empty() && output.stderr.is_empty());
    }
    assert!(fixture.bash("git status").stdout.is_empty());
    fs::write(fixture.root.join("guard/policy.json"), b"{").unwrap();
    assert!(fixture.bash("ssh test-vps reboot").stdout.is_empty());
    fs::remove_file(fixture.root.join("guard/policy.json")).unwrap();
    assert!(fixture.bash("ssh test-vps reboot").stdout.is_empty());
    assert!(fixture.records().is_empty());
}

#[test]
fn actual_policy_self_test_has_no_audit_side_effect_and_rejects_invalid_policy() {
    let fixture = Fixture::new();
    let output = fixture.run(b"", &["--self-test", "--env", "windows"]);
    assert!(output.status.success());
    assert_eq!(output.stdout, b"cloudlink-guard:ok\n");
    assert!(fixture.records().is_empty());
    fixture.policy(json!({"version":99,"resources":[]}));
    let output = fixture.run(b"", &["--self-test", "--env", "windows"]);
    assert!(!output.status.success());
    assert!(output.stdout.is_empty() && output.stderr.is_empty());
}

#[test]
fn inbox_rotation_and_environment_identity_are_independent_of_process_home() {
    let fixture = Fixture::new();
    fixture.bash("ssh test-vps uptime");
    let log = fs::read_dir(fixture.root.join("guard/log"))
        .unwrap()
        .filter_map(Result::ok)
        .find(|e| e.path().extension().is_some_and(|e| e == "jsonl"))
        .unwrap()
        .path();
    let rotated = log.with_extension("processing");
    fs::rename(&log, &rotated).unwrap();
    let output = fixture.run(
        &serde_json::to_vec(&json!({"tool_name":"Bash","tool_input":{"command":"ssh test-vps uptime"}})).unwrap(),
        &["--env", "wsl:Fixture"],
    );
    assert!(output.status.success() && output.stdout.is_empty());
    assert!(log.exists() && rotated.exists());
    assert_eq!(fixture.records()[0]["envId"], "wsl:Fixture");
}

#[test]
fn foreign_log_marker_is_preserved_while_denial_still_works() {
    let fixture = Fixture::new();
    let log_dir = fixture.root.join("guard/log");
    fs::create_dir(&log_dir).unwrap();
    fs::write(log_dir.join(".cloudlink.json"), b"{\"managedBy\":\"someone-else\"}").unwrap();
    fs::write(log_dir.join("personal.txt"), b"unchanged").unwrap();
    let output = fixture.bash("ssh test-vps reboot");
    assert!(!output.stdout.is_empty());
    assert!(fixture.records().is_empty());
    assert_eq!(fs::read(log_dir.join("personal.txt")).unwrap(), b"unchanged");
}

#[test]
fn bounded_input_and_invalid_arguments_do_not_crash_or_emit_diagnostics() {
    let fixture = Fixture::new();
    for (bytes, args) in [
        (vec![b'x'; 140_000], vec!["--env", "windows"]),
        (b"{}".to_vec(), vec!["--env"]),
        (b"{}".to_vec(), vec!["--unknown"]),
    ] {
        let output = fixture.run(&bytes, &args);
        assert!(output.status.success() && output.stdout.is_empty() && output.stderr.is_empty());
    }
}

#[cfg(windows)]
#[test]
fn a_junction_log_directory_is_never_followed_or_modified() {
    let fixture = Fixture::new();
    let outside = fixture.root.parent().unwrap().join("external");
    fs::create_dir(&outside).unwrap();
    fs::write(outside.join("sentinel.txt"), b"unchanged").unwrap();
    let log_dir = fixture.root.join("guard/log");
    let status = Command::new("cmd.exe")
        .args(["/D", "/V:OFF", "/C", "mklink", "/J"])
        .arg(&log_dir)
        .arg(&outside)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .unwrap();
    assert!(status.success());
    let output = fixture.bash("ssh test-vps reboot");
    assert!(!output.stdout.is_empty());
    assert_eq!(fs::read_dir(&outside).unwrap().count(), 1);
    assert_eq!(fs::read(outside.join("sentinel.txt")).unwrap(), b"unchanged");
    fs::remove_dir(log_dir).unwrap();
}
