//! Standalone PreToolUse hook: no network, database, GUI, or native credential dependencies.

use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{Value, json};

const MAX_INPUT: u64 = 131_072;
const MAX_POLICY: u64 = 4 * 1024 * 1024;

fn is_link(metadata: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return true;
        }
    }
    metadata.file_type().is_symlink()
}

fn safe_path(path: &Path) -> bool {
    path.ancestors().all(|ancestor| match fs::symlink_metadata(ancestor) {
        Ok(metadata) => !is_link(&metadata),
        Err(error) => error.kind() == std::io::ErrorKind::NotFound,
    })
}

fn bounded_file(path: &Path, max_bytes: u64) -> Option<Vec<u8>> {
    if !safe_path(path) {
        return None;
    }
    let metadata = fs::symlink_metadata(path).ok()?;
    if !metadata.is_file() || metadata.len() > max_bytes {
        return None;
    }
    let mut bytes = Vec::new();
    fs::File::open(path)
        .ok()?
        .take(max_bytes + 1)
        .read_to_end(&mut bytes)
        .ok()?;
    (bytes.len() as u64 <= max_bytes).then_some(bytes)
}

fn root_dir() -> Option<PathBuf> {
    // Never consult HOME, USERPROFILE or CLOUDLINK_HOME. Every installed copy belongs
    // to the data root immediately above its bin directory, including WSL interop.
    let exe = std::env::current_exe().ok()?;
    let bin = exe.parent()?;
    if bin.file_name()?.to_str()? != "bin" || !safe_path(&exe) {
        return None;
    }
    bin.parent().map(Path::to_path_buf)
}

fn timestamp(seconds: u64) -> String {
    // Gregorian civil date from Unix days (Howard Hinnant's civil_from_days).
    let days = (seconds / 86_400) as i64 + 719_468;
    let era = days.div_euclid(146_097);
    let doe = days - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = mp + if mp < 10 { 3 } else { -9 };
    let year = year + i64::from(month <= 2);
    let time = seconds % 86_400;
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
        time / 3600,
        time / 60 % 60,
        time % 60
    )
}

fn safe_text(text: &str, limit: usize) -> String {
    let redacted = guard_rules::redact(text);
    let bounded: String = redacted
        .chars()
        .take(limit)
        .filter(|c| *c == '\n' || *c == '\t' || !c.is_control())
        .collect();
    bounded
}

fn record(root: &Path, env_id: &str, input: &Value, command: &str, decisions: &[guard_rules::Decision]) {
    let Some(marker) =
        bounded_file(&root.join(".cloudlink.json"), 16_384).and_then(|b| serde_json::from_slice::<Value>(&b).ok())
    else {
        return;
    };
    if marker["managedBy"] != "cloudlink" || marker["kind"] != "data" {
        return;
    }
    let Some(guard_marker) = bounded_file(&root.join("guard").join(".cloudlink.json"), 16_384)
        .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
    else {
        return;
    };
    if guard_marker["managedBy"] != "cloudlink" || guard_marker["kind"] != "guard" {
        return;
    }
    let directory = root.join("guard").join("log");
    if !safe_path(&directory) || fs::create_dir_all(&directory).is_err() {
        return;
    }
    let marker_path = directory.join(".cloudlink.json");
    if !safe_path(&marker_path) {
        return;
    }
    match bounded_file(&marker_path, 16_384).and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok()) {
        Some(marker) if marker["managedBy"] == "cloudlink" && marker["kind"] == "operation-log" => {}
        None if !marker_path.exists() && fs::read_dir(&directory).is_ok_and(|mut entries| entries.next().is_none()) => {
            let Ok(mut file) = OpenOptions::new().write(true).create_new(true).open(&marker_path) else {
                return;
            };
            if file
                .write_all(b"{\"managedBy\":\"cloudlink\",\"kind\":\"operation-log\"}\n")
                .is_err()
                || file.sync_all().is_err()
            {
                return;
            }
        }
        _ => return,
    }
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
    let at = timestamp(now.as_secs());
    let path = directory.join(format!("{}.jsonl", &at[..10]));
    if !safe_path(&path) {
        return;
    }
    if let Ok(metadata) = fs::symlink_metadata(&path)
        && (!metadata.is_file() || metadata.len() > 32 * 1024 * 1024)
    {
        return;
    }
    let command = safe_text(command, 16_384);
    let session = safe_text(input.get("session_id").and_then(Value::as_str).unwrap_or(""), 256);
    let cwd = safe_text(input.get("cwd").and_then(Value::as_str).unwrap_or(""), 4096);
    let mut bytes = Vec::new();
    for (index, decision) in decisions.iter().enumerate() {
        let mut item = json!({
            "id": format!("op_{}_{:x}_{index}", now.as_nanos(), std::process::id()),
            "assetId": decision.asset_id,
            "envId": env_id,
            "at": at,
            "sessionId": session,
            "cwd": cwd,
            "command": command,
            "decision": if decision.allowed { "allowed" } else { "denied" },
        });
        if let Some(reason_id) = decision.reason_id {
            item["reasonId"] = Value::String(reason_id.into());
        }
        let Ok(line) = serde_json::to_vec(&item) else {
            return;
        };
        bytes.extend(line);
        bytes.push(b'\n');
    }
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&path) {
        let _ = file.write_all(&bytes);
    }
}

fn self_test(policy: &Value) -> bool {
    if !guard_rules::policy_valid(policy) {
        return false;
    }
    let fixture = json!({"version":1,"resources":[{"id":"self-test","kind":"vps","handle":"cloudlink-self-test","mode":"read-only","envIds":["windows"],"hosts":[],"criticalServices":[]}]});
    let allow = guard_rules::evaluate(&fixture, "windows", "ssh -- cloudlink-self-test uptime");
    let deny = guard_rules::evaluate(&fixture, "windows", "ssh -- cloudlink-self-test 'docker restart app'");
    allow.len() == 1
        && allow[0].allowed
        && deny.len() == 1
        && !deny[0].allowed
        && guard_rules::deny_output(&deny).is_some_and(|v| v["hookSpecificOutput"]["permissionDecision"] == "deny")
}

fn run() -> i32 {
    let mut env_id = None;
    let mut check = false;
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--env" => env_id = args.next(),
            "--self-test" => check = true,
            _ => return 0,
        }
    }
    let Some(env_id) = env_id.filter(|e| !e.is_empty() && e.len() <= 256 && !e.chars().any(char::is_control)) else {
        return i32::from(check);
    };
    let policy = root_dir().and_then(|root| {
        bounded_file(&root.join("guard").join("policy.json"), MAX_POLICY)
            .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
            .map(|policy| (root, policy))
    });
    let Some((root, policy)) = policy else {
        return i32::from(check);
    };
    if check {
        if self_test(&policy) {
            let _ = std::io::stdout().write_all(b"cloudlink-guard:ok\n");
            return 0;
        }
        return 1;
    }
    let mut bytes = Vec::new();
    if std::io::stdin().take(MAX_INPUT + 1).read_to_end(&mut bytes).is_err() || bytes.len() as u64 > MAX_INPUT {
        return 0;
    }
    let Ok(input) = serde_json::from_slice::<Value>(&bytes) else {
        return 0;
    };
    if input.get("tool_name").and_then(Value::as_str) != Some("Bash") {
        return 0;
    }
    let Some(command) = input
        .get("tool_input")
        .and_then(|v| v.get("command"))
        .and_then(Value::as_str)
    else {
        return 0;
    };
    let decisions = guard_rules::evaluate(&policy, &env_id, command);
    if decisions.is_empty() {
        return 0;
    }
    record(&root, &env_id, &input, command, &decisions);
    if let Some(deny) = guard_rules::deny_output(&decisions)
        && let Ok(mut output) = serde_json::to_vec(&deny)
    {
        output.push(b'\n');
        let _ = std::io::stdout().write_all(&output);
    }
    0
}

fn main() {
    std::process::exit(run());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unix_dates_include_leap_days_and_year_boundaries() {
        assert_eq!(timestamp(0), "1970-01-01T00:00:00Z");
        assert_eq!(timestamp(951_782_400), "2000-02-29T00:00:00Z");
        assert_eq!(timestamp(1_704_067_200), "2024-01-01T00:00:00Z");
    }
}
