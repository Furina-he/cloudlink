//! Claude Code hook management (F-306). File paths are always supplied by the
//! backend; this module never resolves HOME or falls back outside an override.

use std::path::{Path, PathBuf};
use std::time::Duration;

use serde_json::{Value, json};

use crate::env::EnvContext;
use crate::error::Result;
use crate::paths::Paths;
use crate::proc::{self, RunOpts};

mod json_edit;
mod owned;
mod policy;
mod settings;

pub use policy::{policy_current, project_policy, write_policy};
pub use settings::{hook_command, install, planned, preflight_remove, remove, status};

pub fn executable_path(paths: &Paths) -> PathBuf {
    paths.data_dir.join("bin").join("cloudlink-guard.exe")
}

/// Injection keeps unit tests away from real WSL and process execution. A
/// successful fake result cannot bypass policy or binary ownership checks.
pub trait SelfTest: Send + Sync {
    fn run(&self, paths: &Paths, env: &EnvContext) -> bool;
}

pub struct ProcessSelfTest;

impl SelfTest for ProcessSelfTest {
    fn run(&self, paths: &Paths, env: &EnvContext) -> bool {
        if !runtime_valid(paths) || !env.available || !env.interop {
            return false;
        }
        let mut command = if let Some(distro) = env.distro() {
            let mut command = proc::command("wsl.exe");
            command.args(["-d", distro, "-e", &env.windows_path_to_native(&executable_path(paths))]);
            command
        } else {
            proc::command(executable_path(paths))
        };
        command.args(["--self-test", "--env", env.id.as_str()]);
        proc::run(
            command,
            RunOpts {
                timeout: Duration::from_secs(3),
                max_output: 4096,
                ..Default::default()
            },
        )
        .is_ok_and(|output| output.success() && output.stdout == b"cloudlink-guard:ok\n" && output.stderr.is_empty())
    }
}

/// Copies only a known packaged helper. A foreign file at the destination (or a
/// changed executable) is never run, silently adopted, or overwritten.
pub fn sync_binary(paths: &Paths, source: &Path) -> Result<bool> {
    owned::require_data(paths)?;
    let source_bytes = owned::read(source, owned::MAX_BINARY)?.ok_or_else(owned::invalid)?;
    let directory = paths.data_dir.join("bin");
    owned::ensure_dir(&directory, "guard-bin")?;
    let marker_path = directory.join(".cloudlink.json");
    let marker_bytes = owned::read(&marker_path, owned::MAX_SETTINGS)?.ok_or_else(owned::invalid)?;
    let marker: Value = serde_json::from_slice(&marker_bytes).map_err(|_| owned::invalid())?;
    let destination = executable_path(paths);
    let before = owned::read(&destination, owned::MAX_BINARY)?;
    if let Some(before) = &before
        && !matches_binary_hash(&marker, &owned::hash(before))
    {
        return Err(owned::invalid());
    }
    let hash = owned::hash(&source_bytes);
    if before.as_deref() == Some(source_bytes.as_slice()) {
        if marker["hash"] != hash || marker.get("pendingHash").is_some() {
            owned::replace(
                &marker_path,
                Some(&marker_bytes),
                &binary_marker(&hash)?,
                owned::MAX_SETTINGS,
            )?;
        }
        return Ok(false);
    }
    // Journal the intended hash before replacing the executable. Both the old
    // and pending contents remain recognizable after a crash between writes.
    let mut pending = marker;
    pending["pendingHash"] = hash.clone().into();
    let pending_bytes = serde_json::to_vec(&pending)?;
    owned::replace(&marker_path, Some(&marker_bytes), &pending_bytes, owned::MAX_SETTINGS)?;
    owned::replace(&destination, before.as_deref(), &source_bytes, owned::MAX_BINARY)?;
    owned::replace(
        &marker_path,
        Some(&pending_bytes),
        &binary_marker(&hash)?,
        owned::MAX_SETTINGS,
    )?;
    Ok(true)
}

fn binary_marker(hash: &str) -> Result<Vec<u8>> {
    Ok(serde_json::to_vec(&json!({
        "managedBy": "cloudlink", "kind": "guard-bin", "version": 1, "hash": hash
    }))?)
}

fn matches_binary_hash(marker: &Value, hash: &str) -> bool {
    marker["hash"].as_str() == Some(hash) || marker["pendingHash"].as_str() == Some(hash)
}

fn binary_owned(paths: &Paths) -> bool {
    let Ok(Some(marker)) = owned::marker(&paths.data_dir.join("bin"), "guard-bin") else {
        return false;
    };
    let Ok(Some(bytes)) = owned::read(&executable_path(paths), owned::MAX_BINARY) else {
        return false;
    };
    matches_binary_hash(&marker, &owned::hash(&bytes))
}

fn binary_valid(paths: &Paths) -> bool {
    let directory = paths.data_dir.join("bin");
    let Ok(Some(marker)) = owned::marker(&directory, "guard-bin") else {
        return false;
    };
    let Ok(Some(bytes)) = owned::read(&executable_path(paths), owned::MAX_BINARY) else {
        return false;
    };
    marker.get("pendingHash").is_none() && marker["hash"].as_str() == Some(owned::hash(&bytes).as_str())
}

fn runtime_valid(paths: &Paths) -> bool {
    if owned::require_data(paths).is_err() || !binary_valid(paths) {
        return false;
    }
    let directory = paths.data_dir.join("guard");
    if !matches!(owned::marker(&directory, "guard"), Ok(Some(_))) {
        return false;
    }
    let Ok(Some(bytes)) = owned::read(&directory.join("policy.json"), owned::MAX_SETTINGS) else {
        return false;
    };
    let Ok(policy) = serde_json::from_slice::<Value>(&bytes) else {
        return false;
    };
    policy["managedBy"] == "cloudlink" && policy["kind"] == "guard-policy" && guard_rules::policy_valid(&policy)
}

pub fn preflight_reset(paths: &Paths, envs: &[EnvContext]) -> Result<()> {
    owned::require_data(paths)?;
    let guard = paths.data_dir.join("guard");
    settings::preflight_receipts(paths, envs)?;
    let guard_marker = owned::marker(&guard, "guard")?;
    if let Some(marker) = guard_marker.as_ref() {
        if let Some(bytes) = owned::read(&guard.join("policy.json"), owned::MAX_SETTINGS)?
            && marker["policyOwned"] != true
        {
            let policy: Value = serde_json::from_slice(&bytes).map_err(|_| owned::invalid())?;
            if policy["managedBy"] != "cloudlink" || policy["kind"] != "guard-policy" {
                return Err(owned::invalid());
            }
        }
    } else if let Some(bytes) = owned::read(&guard.join("policy.json"), owned::MAX_SETTINGS)?
        && serde_json::from_slice::<Value>(&bytes)
            .is_ok_and(|value| value["managedBy"] == "cloudlink" && value["kind"] == "guard-policy")
    {
        return Err(owned::invalid());
    }
    let bin = paths.data_dir.join("bin");
    let bin_marker = owned::marker(&bin, "guard-bin")?;
    if owned::read(&executable_path(paths), owned::MAX_BINARY)?.is_some()
        && (bin_marker.is_none() || !binary_owned(paths))
    {
        return Err(owned::invalid());
    }
    Ok(())
}

/// Remove only tracked hook entries, the published policy, and the copied
/// executable. Logs are ingested/cleaned by the history module. Unknown siblings
/// inside these directories remain untouched and keep the directory alive.
pub fn reset_managed_files(paths: &Paths, envs: &[EnvContext]) -> Result<()> {
    preflight_reset(paths, envs)?;
    let guard = paths.data_dir.join("guard");
    if owned::marker(&guard, "guard")?.is_some() {
        for env in envs {
            settings::remove_hook(paths, env)?;
        }
        let policy = guard.join("policy.json");
        if let Some(bytes) = owned::read(&policy, owned::MAX_SETTINGS)? {
            owned::remove_file(&policy, &bytes)?;
        }
        owned::remove_empty_owned_dir(&guard.join("hooks"), "guard-hooks")?;
        owned::remove_empty_owned_dir(&guard, "guard")?;
    }
    let bin = paths.data_dir.join("bin");
    if owned::marker(&bin, "guard-bin")?.is_some() {
        let executable = executable_path(paths);
        if let Some(bytes) = owned::read(&executable, owned::MAX_BINARY)? {
            owned::remove_file(&executable, &bytes)?;
        }
        owned::remove_empty_owned_dir(&bin, "guard-bin")?;
    }
    Ok(())
}

#[cfg(test)]
mod tests;
