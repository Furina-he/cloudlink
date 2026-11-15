use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::env::EnvContext;
use crate::error::{AppError, Result};
use crate::model::guard::{GuardDetailId, GuardPlanned, GuardState, GuardStatus};
use crate::model::misc::IpcErrorId;
use crate::paths::Paths;

use super::{SelfTest, executable_path, json_edit, owned};

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Receipt {
    managed_by: String,
    kind: String,
    env_id: String,
    settings_path: String,
    backup_path: String,
    original_exists: bool,
    original_hash: String,
    installed_hash: String,
    command: String,
    #[serde(default)]
    pending: bool,
    #[serde(default)]
    removed: bool,
}

pub(super) fn settings_path(env: &EnvContext) -> PathBuf {
    env.host_in_home(&[".claude", "settings.json"])
}

fn backup_path(env: &EnvContext) -> PathBuf {
    env.host_in_home(&[".claude", "settings.json.cloudlink-bak"])
}

fn hooks_dir(paths: &Paths) -> PathBuf {
    paths.data_dir.join("guard").join("hooks")
}

fn receipt_path(paths: &Paths, env: &EnvContext) -> PathBuf {
    let safe_name: String = env
        .id
        .as_str()
        .as_bytes()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    hooks_dir(paths).join(format!("{safe_name}.cloudlink.json"))
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

pub fn hook_command(paths: &Paths, env: &EnvContext) -> String {
    format!(
        "{} --env {}",
        shell_quote(&env.windows_path_to_native(&executable_path(paths))),
        shell_quote(env.id.as_str())
    )
}

pub fn planned(paths: &Paths, env: &EnvContext) -> GuardPlanned {
    GuardPlanned {
        entry: serde_json::to_string_pretty(&entry(paths, env)).unwrap_or_default(),
        backup_path: env.native_in_home(&[".claude", "settings.json.cloudlink-bak"]),
    }
}

fn entry(paths: &Paths, env: &EnvContext) -> Value {
    json!({ "matcher": "Bash", "hooks": [{ "type": "command", "command": hook_command(paths, env), "timeout": 10 }] })
}

fn context_safe(paths: &Paths, env: &EnvContext) -> Result<()> {
    owned::require_data(paths)?;
    owned::check(&env.host_home)?;
    if env.is_windows() {
        if env.host_home != paths.user_home {
            return Err(owned::invalid());
        }
    } else {
        let root = paths.wsl_distro_root(env.distro().ok_or_else(owned::invalid)?);
        if env.host_root.as_ref() != Some(&root) || !env.host_home.starts_with(root) {
            return Err(owned::invalid());
        }
    }
    Ok(())
}

fn read_receipt(paths: &Paths, env: &EnvContext) -> Result<Option<(Receipt, Vec<u8>)>> {
    context_safe(paths, env)?;
    let guard_owned = owned::marker(&paths.data_dir.join("guard"), "guard")?.is_some();
    let hooks_owned = owned::marker(&hooks_dir(paths), "guard-hooks")?.is_some();
    if !guard_owned || !hooks_owned {
        if owned::read(&receipt_path(paths, env), owned::MAX_SETTINGS)?.is_some() {
            return Err(owned::invalid());
        }
        return Ok(None);
    }
    let Some(bytes) = owned::read(&receipt_path(paths, env), owned::MAX_SETTINGS)? else {
        return Ok(None);
    };
    let receipt: Receipt = serde_json::from_slice(&bytes).map_err(|_| owned::invalid())?;
    if receipt.managed_by != "cloudlink"
        || receipt.kind != "guard-hook"
        || receipt.env_id != env.id.as_str()
        || receipt.settings_path != settings_path(env).to_string_lossy()
        || receipt.backup_path != backup_path(env).to_string_lossy()
        || receipt.command != hook_command(paths, env)
    {
        return Err(owned::invalid());
    }
    Ok(Some((receipt, bytes)))
}

fn original(receipt: &Receipt, env: &EnvContext) -> Result<Vec<u8>> {
    let original = owned::read(&backup_path(env), owned::MAX_SETTINGS)?.ok_or_else(owned::invalid)?;
    if owned::hash(&original) != receipt.original_hash {
        return Err(owned::invalid());
    }
    Ok(original)
}

pub fn status(paths: &Paths, env: &EnvContext, denied_today: u32, test: &dyn SelfTest) -> GuardStatus {
    let mut status = GuardStatus {
        env_id: env.id.clone(),
        state: GuardState::NotInstalled,
        detail: None,
        settings_path: env.native_in_home(&[".claude", "settings.json"]),
        planned: planned(paths, env),
        denied_today,
        checked_at: crate::time::now_rfc3339(),
    };
    let state = check_status(paths, env, test);
    match state {
        Ok(None) => {}
        Ok(Some((next, reason))) => {
            status.state = next;
            status.detail = reason.map(|id| crate::model::Detail { id, params: None });
        }
        Err(_) => {
            status.state = GuardState::Broken;
            status.detail = Some(crate::model::Detail {
                id: GuardDetailId::SettingsInvalid,
                params: None,
            });
        }
    }
    status
}

fn check_status(
    paths: &Paths,
    env: &EnvContext,
    test: &dyn SelfTest,
) -> Result<Option<(GuardState, Option<GuardDetailId>)>> {
    if !env.available || !env.interop {
        return Ok(Some((GuardState::Unavailable, Some(GuardDetailId::InteropDisabled))));
    }
    let receipt = read_receipt(paths, env)?;
    let bytes = owned::read(&settings_path(env), owned::MAX_SETTINGS)?;
    if let Some(bytes) = &bytes {
        json_edit::validate(bytes)?;
        let value: Value = serde_json::from_slice(bytes).map_err(|_| owned::invalid())?;
        if value["disableAllHooks"] == true {
            return Ok(Some((GuardState::Broken, Some(GuardDetailId::HooksDisabled))));
        }
    }
    let Some((receipt, _)) = receipt else {
        return Ok(None);
    };
    if receipt.removed {
        return Ok(None);
    }
    original(&receipt, env)?;
    if bytes
        .as_ref()
        .is_none_or(|bytes| !json_edit::active(bytes, &receipt.command).unwrap_or(false))
    {
        return Ok(Some((GuardState::Broken, Some(GuardDetailId::EntryMissing))));
    }
    if !super::runtime_valid(paths) || !test.run(paths, env) {
        return Ok(Some((GuardState::Broken, Some(GuardDetailId::SelfTestFailed))));
    }
    Ok(Some((GuardState::Active, None)))
}

pub fn install(paths: &Paths, env: &EnvContext, denied_today: u32, test: &dyn SelfTest) -> Result<GuardStatus> {
    context_safe(paths, env)?;
    if !env.available || !env.interop {
        return Err(AppError::ipc(IpcErrorId::InteropDisabled));
    }
    if !super::runtime_valid(paths) {
        return Err(AppError::ipc(IpcErrorId::SourceMissing));
    }
    if !test.run(paths, env) {
        return Err(AppError::ipc(IpcErrorId::SourceMissing));
    }
    let path = settings_path(env);
    let before = owned::read(&path, owned::MAX_SETTINGS)?;
    let document = before.as_deref().unwrap_or(b"{}\n");
    json_edit::validate(document)?;
    let value: Value = serde_json::from_slice(document).map_err(|_| owned::invalid())?;
    if value["disableAllHooks"] == true {
        return Err(owned::invalid());
    }
    if let Some((mut previous, receipt_bytes)) = read_receipt(paths, env)? {
        if !previous.removed && json_edit::active(document, &previous.command)? {
            original(&previous, env)?;
            if previous.pending {
                previous.pending = false;
                owned::replace(
                    &receipt_path(paths, env),
                    Some(&receipt_bytes),
                    &serde_json::to_vec(&previous)?,
                    owned::MAX_SETTINGS,
                )?;
            }
            return Ok(status(paths, env, denied_today, test));
        }
        // Finish the previous attempt/removal before starting a new snapshot.
        // In particular, never replace a backup still referenced by a receipt.
        remove_hook(paths, env)?;
        return install(paths, env, denied_today, test);
    }
    if json_edit::active(document, &hook_command(paths, env))? {
        // A manually authored identical command is not ours to claim or remove.
        return Err(owned::invalid());
    }
    let backup = backup_path(env);
    let backup_before = owned::read(&backup, owned::MAX_SETTINGS)?;
    if backup_before.is_some() {
        return Err(owned::invalid());
    }
    let after = json_edit::append(document, &entry(paths, env))?;
    owned::ensure_dir(&paths.data_dir.join("guard"), "guard")?;
    owned::ensure_dir(&hooks_dir(paths), "guard-hooks")?;
    let mut receipt = Receipt {
        managed_by: "cloudlink".into(),
        kind: "guard-hook".into(),
        env_id: env.id.as_str().into(),
        settings_path: path.to_string_lossy().into_owned(),
        backup_path: backup.to_string_lossy().into_owned(),
        original_exists: before.is_some(),
        original_hash: owned::hash(before.as_deref().unwrap_or_default()),
        installed_hash: owned::hash(&after),
        command: hook_command(paths, env),
        pending: true,
        removed: false,
    };
    owned::check(path.parent().ok_or_else(owned::invalid)?)?;
    fs::create_dir_all(path.parent().ok_or_else(owned::invalid)?)?;
    // Record the pending ownership before writing either backup or settings.
    // A crash between any two writes can be resumed without claiming a foreign
    // backup or losing the previous snapshot's ownership.
    let receipt_file = receipt_path(paths, env);
    let receipt_bytes = serde_json::to_vec(&receipt)?;
    owned::replace(&receipt_file, None, &receipt_bytes, owned::MAX_SETTINGS)?;
    owned::replace(
        &backup,
        None,
        before.as_deref().unwrap_or_default(),
        owned::MAX_SETTINGS,
    )?;
    owned::replace(&path, before.as_deref(), &after, owned::MAX_SETTINGS)?;
    receipt.pending = false;
    owned::replace(
        &receipt_file,
        Some(&receipt_bytes),
        &serde_json::to_vec(&receipt)?,
        owned::MAX_SETTINGS,
    )?;
    Ok(status(paths, env, denied_today, test))
}

pub fn preflight_remove(paths: &Paths, env: &EnvContext) -> Result<()> {
    let Some((receipt, _)) = read_receipt(paths, env)? else {
        // Foreign settings, including malformed JSON, are never modified.
        return Ok(());
    };
    if receipt.removed {
        if let Some(bytes) = owned::read(&backup_path(env), owned::MAX_SETTINGS)?
            && owned::hash(&bytes) != receipt.original_hash
        {
            return Err(owned::invalid());
        }
        return Ok(());
    }
    if receipt.pending && owned::read(&backup_path(env), owned::MAX_SETTINGS)?.is_none() {
        if let Some(bytes) = owned::read(&settings_path(env), owned::MAX_SETTINGS)?
            && json_edit::active(&bytes, &receipt.command)?
        {
            return Err(owned::invalid());
        }
        return Ok(());
    }
    let original = original(&receipt, env)?;
    if let Some(bytes) = owned::read(&settings_path(env), owned::MAX_SETTINGS)? {
        let after = json_edit::remove(&bytes, &receipt.command)?;
        let baseline = if receipt.original_exists {
            json_edit::command_count(&original, &receipt.command)?
        } else {
            0
        };
        if json_edit::command_count(&after, &receipt.command)? > baseline {
            return Err(owned::invalid());
        }
    }
    Ok(())
}

pub fn remove(paths: &Paths, env: &EnvContext, denied_today: u32, test: &dyn SelfTest) -> Result<GuardStatus> {
    remove_hook(paths, env)?;
    Ok(status(paths, env, denied_today, test))
}

pub(super) fn remove_hook(paths: &Paths, env: &EnvContext) -> Result<()> {
    preflight_remove(paths, env)?;
    let Some((mut receipt, mut receipt_bytes)) = read_receipt(paths, env)? else {
        return Ok(());
    };
    if receipt.removed {
        if let Some(bytes) = owned::read(&backup_path(env), owned::MAX_SETTINGS)? {
            owned::remove_file(&backup_path(env), &bytes)?;
        }
        owned::remove_file(&receipt_path(paths, env), &receipt_bytes)?;
        owned::remove_empty_owned_dir(&hooks_dir(paths), "guard-hooks")?;
        return Ok(());
    }
    if receipt.pending && owned::read(&backup_path(env), owned::MAX_SETTINGS)?.is_none() {
        owned::remove_file(&receipt_path(paths, env), &receipt_bytes)?;
        owned::remove_empty_owned_dir(&hooks_dir(paths), "guard-hooks")?;
        return Ok(());
    }
    let original = original(&receipt, env)?;
    let path = settings_path(env);
    if let Some(bytes) = owned::read(&path, owned::MAX_SETTINGS)? {
        if owned::hash(&bytes) == receipt.installed_hash {
            if receipt.original_exists {
                owned::replace(&path, Some(&bytes), &original, owned::MAX_SETTINGS)?;
            } else {
                owned::remove_file(&path, &bytes)?;
            }
        } else {
            let after = json_edit::remove(&bytes, &receipt.command)?;
            if after != bytes {
                owned::replace(&path, Some(&bytes), &after, owned::MAX_SETTINGS)?;
            }
        }
    }
    // Persist the completed settings edit before pruning its backup. A crash
    // between those two file removals must remain safely retryable.
    receipt.removed = true;
    let removed_receipt = serde_json::to_vec(&receipt)?;
    owned::replace(
        &receipt_path(paths, env),
        Some(&receipt_bytes),
        &removed_receipt,
        owned::MAX_SETTINGS,
    )?;
    receipt_bytes = removed_receipt;
    owned::remove_file(&backup_path(env), &original)?;
    owned::remove_file(&receipt_path(paths, env), &receipt_bytes)?;
    owned::remove_empty_owned_dir(&hooks_dir(paths), "guard-hooks")?;
    Ok(())
}

pub(super) fn preflight_receipts(paths: &Paths, envs: &[EnvContext]) -> Result<()> {
    let directory = hooks_dir(paths);
    let guard_owned = owned::marker(&paths.data_dir.join("guard"), "guard")?.is_some();
    let hooks_owned = owned::marker(&directory, "guard-hooks")?.is_some();
    owned::check(&directory)?;
    if !directory.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(directory)? {
        let path = entry?.path();
        let is_receipt_name = path
            .file_name()
            .and_then(|name| name.to_str())
            .and_then(|name| name.strip_suffix(".cloudlink.json"))
            .is_some_and(|stem| {
                !stem.is_empty() && stem.len() % 2 == 0 && stem.bytes().all(|byte| byte.is_ascii_hexdigit())
            });
        if !is_receipt_name {
            continue;
        }
        if !guard_owned || !hooks_owned {
            // Losing an ownership marker does not erase an installed hook's
            // durable receipt. Stop reset rather than report a false cleanup.
            return Err(owned::invalid());
        }
        owned::check(&path)?;
        let bytes = owned::read(&path, owned::MAX_SETTINGS)?.ok_or_else(owned::invalid)?;
        if let Ok(receipt) = serde_json::from_slice::<Receipt>(&bytes)
            && receipt.managed_by == "cloudlink"
            && receipt.kind == "guard-hook"
            && !envs
                .iter()
                .any(|env| env.id.as_str() == receipt.env_id && receipt_path(paths, env) == path)
        {
            return Err(owned::invalid());
        }
    }
    for env in envs {
        preflight_remove(paths, env)?;
    }
    Ok(())
}
