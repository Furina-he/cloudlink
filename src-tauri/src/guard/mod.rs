//! Claude Code hook management (F-306). File paths are always supplied by the
//! backend; this module never resolves HOME or falls back outside an override.

use std::path::{Path, PathBuf};
use std::time::Duration;

use serde_json::Value;

use crate::env::EnvContext;
use crate::error::Result;
use crate::paths::Paths;
use crate::proc::{self, RunOpts};

mod json_edit;
mod owned;
mod policy;
mod settings;

pub use policy::{policy_current, project_policy, project_runtime_policy, write_policy};
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
        if (paths.isolated && env.distro().is_some()) || !runtime_valid(paths) || !env.available || !env.interop {
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
        let mut after = marker;
        after["hash"] = hash.into();
        after.as_object_mut().ok_or_else(owned::invalid)?.remove("pendingHash");
        owned::replace(
            &marker_path,
            Some(&marker_bytes),
            &serde_json::to_vec(&after)?,
            owned::MAX_SETTINGS,
        )?;
        cleanup_retired(&directory)?;
        return Ok(false);
    }
    // Windows can rename a running image, but cannot replace it in place. Keep a
    // receipt for the retired image before renaming, then atomically install the new one.
    let mut pending = marker;
    pending["pendingHash"] = hash.clone().into();
    let retired = before.as_ref().map(|bytes| {
        let name = format!(".cloudlink-guard-old-{}.exe", crate::new_id("bin"));
        pending["retiredFiles"][&name] = owned::hash(bytes).into();
        directory.join(name)
    });
    let pending_bytes = serde_json::to_vec(&pending)?;
    owned::replace(&marker_path, Some(&marker_bytes), &pending_bytes, owned::MAX_SETTINGS)?;
    if let Some(retired) = &retired {
        owned::check(retired)?;
        if owned::read(retired, owned::MAX_BINARY)?.is_some()
            || owned::read(&destination, owned::MAX_BINARY)?.as_deref() != before.as_deref()
        {
            return Err(owned::invalid());
        }
        std::fs::rename(&destination, retired)?;
    }
    if let Err(error) = owned::replace(&destination, None, &source_bytes, owned::MAX_BINARY) {
        if let Some(retired) = &retired {
            owned::check(&destination)?;
            if owned::read(&destination, owned::MAX_BINARY)?.is_none()
                && owned::read(retired, owned::MAX_BINARY)?.as_deref() == before.as_deref()
            {
                let _ = std::fs::rename(retired, &destination);
            }
        }
        return Err(error);
    }
    pending["hash"] = hash.into();
    pending
        .as_object_mut()
        .ok_or_else(owned::invalid)?
        .remove("pendingHash");
    owned::replace(
        &marker_path,
        Some(&pending_bytes),
        &serde_json::to_vec(&pending)?,
        owned::MAX_SETTINGS,
    )?;
    cleanup_retired(&directory)?;
    Ok(true)
}

fn cleanup_retired(directory: &Path) -> Result<()> {
    let path = directory.join(".cloudlink.json");
    let before = owned::read(&path, owned::MAX_SETTINGS)?.ok_or_else(owned::invalid)?;
    let mut marker: Value = serde_json::from_slice(&before)?;
    if marker["managedBy"] != "cloudlink" || marker["kind"] != "guard-bin" {
        return Err(owned::invalid());
    }
    let retired = marker
        .get("retiredFiles")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    for (name, hash) in retired {
        if !name.starts_with(".cloudlink-guard-old-bin_") || !name.ends_with(".exe") || name.contains(['/', '\\']) {
            return Err(owned::invalid());
        }
        let retired_path = directory.join(&name);
        if let Some(bytes) = owned::read(&retired_path, owned::MAX_BINARY)? {
            if hash != owned::hash(&bytes) {
                return Err(owned::invalid());
            }
            // An occupied image survives until the next startup; unknown files are never removed.
            if owned::remove_file(&retired_path, &bytes).is_err() {
                continue;
            }
        }
        marker["retiredFiles"]
            .as_object_mut()
            .ok_or_else(owned::invalid)?
            .remove(&name);
    }
    let after = serde_json::to_vec(&marker)?;
    if before != after {
        owned::replace(&path, Some(&before), &after, owned::MAX_SETTINGS)?;
    }
    Ok(())
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
    if let Some(marker) = &bin_marker {
        for (name, hash) in marker
            .get("retiredFiles")
            .and_then(Value::as_object)
            .into_iter()
            .flatten()
        {
            if !name.starts_with(".cloudlink-guard-old-bin_") || !name.ends_with(".exe") || name.contains(['/', '\\']) {
                return Err(owned::invalid());
            }
            if let Some(bytes) = owned::read(&bin.join(name), owned::MAX_BINARY)?
                && hash != &owned::hash(&bytes)
            {
                return Err(owned::invalid());
            }
        }
    }
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
        cleanup_retired(&bin)?;
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
