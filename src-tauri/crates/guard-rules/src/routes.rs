//! Private, owned route projection. This never consults HOME or a database.

use std::fs;
use std::io;
use std::path::{Component, Path, PathBuf};

use serde_json::Value;

use crate::{protocol, runtime};

fn invalid() -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, "execution-route-invalid")
}

pub fn text(value: &Value, key: &str, max: usize) -> io::Result<String> {
    value[key]
        .as_str()
        .filter(|s| !s.is_empty() && s.len() <= max && !s.chars().any(char::is_control))
        .map(String::from)
        .ok_or_else(invalid)
}

fn tree_safe(directory: &Path, remaining: &mut usize) -> io::Result<()> {
    if !runtime::safe_path(directory) {
        return Err(invalid());
    }
    for entry in fs::read_dir(directory)? {
        if *remaining == 0 {
            return Err(invalid());
        }
        *remaining -= 1;
        let path = entry?.path();
        let metadata = fs::symlink_metadata(&path)?;
        if runtime::is_link(&metadata) {
            return Err(invalid());
        }
        if metadata.is_dir() {
            tree_safe(&path, remaining)?;
        } else if !metadata.is_file() || metadata.len() > runtime::MAX_MANIFEST {
            return Err(invalid());
        }
    }
    Ok(())
}

pub fn load(root: &Path) -> io::Result<Value> {
    runtime::read_owned_json(&root.join(".cloudlink.json"), "data", runtime::MAX_RUNTIME)?;
    let directory = root.join("routes");
    runtime::read_owned_json(
        &directory.join(".cloudlink.json"),
        "execution-routes",
        runtime::MAX_MANIFEST,
    )?;
    tree_safe(&directory, &mut 4096)?;
    let manifest = runtime::read_owned_json(
        &directory.join("manifest.json"),
        "execution-routes",
        runtime::MAX_MANIFEST,
    )?;
    if manifest["version"].as_u64() != Some(protocol::VERSION)
        || manifest["installationId"].as_str() != Some(&runtime::installation_id(root)?)
        || manifest["revision"].as_u64().is_none()
        || manifest["isolated"].as_bool().is_none()
    {
        return Err(invalid());
    }
    if let Some(expected) = manifest["policyHash"].as_str() {
        runtime::read_owned_json(&root.join("guard/.cloudlink.json"), "guard", runtime::MAX_RUNTIME)?;
        let bytes =
            runtime::bounded_file(&root.join("guard/policy.json"), runtime::MAX_MANIFEST)?.ok_or_else(invalid)?;
        let policy: Value = serde_json::from_slice(&bytes).map_err(|_| invalid())?;
        if runtime::digest(&serde_json::to_vec(&policy).map_err(|_| invalid())?) != expected {
            return Err(io::Error::new(io::ErrorKind::InvalidData, "execution-routes-stale"));
        }
    }
    let home = PathBuf::from(text(&manifest, "userHome", 4096)?);
    if !home.is_absolute() || !runtime::safe_path(&home) {
        return Err(invalid());
    }
    let roots = manifest["allowedRoots"]
        .as_array()
        .filter(|roots| !roots.is_empty() && roots.len() <= 64)
        .ok_or_else(invalid)?;
    for root in roots {
        let path = root
            .as_str()
            .filter(|root| root.len() <= 4096)
            .map(PathBuf::from)
            .ok_or_else(invalid)?;
        if !path.is_absolute() || !runtime::safe_path(&path) {
            return Err(invalid());
        }
    }
    let resources = manifest["resources"]
        .as_array()
        .filter(|items| items.len() <= 2000)
        .ok_or_else(invalid)?;
    let mut identities = std::collections::BTreeSet::new();
    for route in resources {
        let id = text(route, "assetId", 128)?;
        let env = text(route, "envId", 256)?;
        if !identities.insert((id, env))
            || route["enabled"].as_bool().is_none()
            || route["production"].as_bool().is_none()
            || !matches!(route["kind"].as_str(), Some("vps" | "cli"))
            || !matches!(route["mode"].as_str(), Some("confirm-changes" | "auto-ops"))
        {
            return Err(invalid());
        }
        if route["enabled"] != true {
            continue;
        }
        let policy = serde_json::json!({"version":1,"resources":[route["policy"].clone()]});
        if !crate::policy_valid(&policy) {
            return Err(invalid());
        }
        if route["kind"] == "vps" {
            text(route, "sshPath", 4096)?;
            let alias = text(route, "alias", 256)?;
            if alias.starts_with('-') || alias.chars().any(char::is_whitespace) {
                return Err(invalid());
            }
            let config = local_path(route, &text(route, "configPath", 4096)?)?;
            let bytes = runtime::bounded_file(&config, runtime::MAX_MANIFEST)?.ok_or_else(invalid)?;
            if !fs::canonicalize(&config)?.starts_with(fs::canonicalize(&directory)?)
                || route["configHash"]
                    .as_str()
                    .is_none_or(|hash| runtime::digest(&bytes) != hash)
            {
                return Err(invalid());
            }
        } else {
            if !matches!(
                route["provider"].as_str(),
                Some("cloudflare" | "vercel" | "oracle" | "github")
            ) {
                return Err(invalid());
            }
            text(route, "program", 4096)?;
        }
        if let Some(distro) = route["distro"].as_str() {
            if route["envId"].as_str() != Some(&format!("wsl:{distro}"))
                || distro.is_empty()
                || distro.chars().any(char::is_control)
            {
                return Err(invalid());
            }
        } else if route["envId"].as_str().is_some_and(|env| env.starts_with("wsl:")) {
            return Err(invalid());
        }
    }
    Ok(manifest)
}

pub fn select(manifest: &Value, asset_id: &str, env_id: &str) -> io::Result<Value> {
    let route = manifest["resources"]
        .as_array()
        .ok_or_else(invalid)?
        .iter()
        .find(|route| route["assetId"] == asset_id && route["envId"] == env_id)
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "execution-resource-unavailable"))?;
    if route["enabled"] != true {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            "execution-resource-unavailable",
        ));
    }
    Ok(route.clone())
}

/// A native WSL path is converted only through the route's already registered
/// distro. Ordinary Windows paths retain their spelling (no verbatim prefix).
pub fn local_path(route: &Value, value: &str) -> io::Result<PathBuf> {
    if value.is_empty() || value.len() > 4096 || value.chars().any(char::is_control) {
        return Err(invalid());
    }
    #[cfg(windows)]
    let path = if value.starts_with('/') && route["distro"].as_str().is_some() {
        if value.len() > 7
            && value.starts_with("/mnt/")
            && value.as_bytes()[5].is_ascii_alphabetic()
            && value.as_bytes()[6] == b'/'
        {
            PathBuf::from(format!("{}:/{}", &value[5..6], &value[7..]))
        } else {
            PathBuf::from(format!(
                "//wsl.localhost/{}/{}",
                text(route, "distro", 256)?,
                value.trim_start_matches('/')
            ))
        }
    } else {
        PathBuf::from(value.strip_prefix("\\\\?\\").unwrap_or(value))
    };
    #[cfg(not(windows))]
    let path = {
        let _ = route;
        PathBuf::from(value)
    };
    if !path.is_absolute() || path.components().any(|part| part == Component::ParentDir) {
        return Err(invalid());
    }
    Ok(path)
}

fn resolved(path: &Path) -> io::Result<PathBuf> {
    let mut existing = path;
    let mut suffix = Vec::new();
    while !existing.try_exists()? {
        suffix.push(existing.file_name().ok_or_else(invalid)?.to_os_string());
        existing = existing.parent().ok_or_else(invalid)?;
    }
    let mut result = fs::canonicalize(existing)?;
    for part in suffix.into_iter().rev() {
        result.push(part);
    }
    Ok(result)
}

pub fn path_allowed(manifest: &Value, path: &Path) -> bool {
    runtime::safe_path(path)
        && (manifest["isolated"] != true
            || resolved(path).is_ok_and(|path| {
                manifest["allowedRoots"].as_array().is_some_and(|roots| {
                    roots
                        .iter()
                        .filter_map(Value::as_str)
                        .any(|root| resolved(Path::new(root)).is_ok_and(|root| path.starts_with(root)))
                })
            }))
}

pub fn validate_route_input(route: &Value, input: &Value) -> io::Result<()> {
    validate_input(input)?;
    let args = input["args"].as_array().ok_or_else(invalid)?;
    let valid = match input["kind"].as_str() {
        Some("exec") if route["kind"] == "vps" => {
            args.len() == 1 && args[0].as_str().is_some_and(|arg| !arg.trim().is_empty()) && input["tool"].is_null()
        }
        Some("exec") if route["kind"] == "cli" => {
            !args.is_empty()
                && (input["tool"].is_null()
                    || input["tool"] == "git"
                        && route["provider"] == "github"
                        && args[0] == "push"
                        && args.iter().filter_map(Value::as_str).any(|arg| {
                            arg == "--force"
                                || arg.starts_with("--force-with-lease")
                                || arg.starts_with('+')
                                || arg.starts_with('-') && !arg.starts_with("--") && arg[1..].contains('f')
                        })
                        && !args.iter().filter_map(Value::as_str).any(|arg| {
                            ["-C", "-c", "--config-env", "--repo", "--receive-pack", "--exec"]
                                .iter()
                                .any(|option| arg == *option || arg.starts_with(&format!("{option}=")))
                        }))
        }
        Some("put" | "get") => {
            route["kind"] == "vps"
                && args.len() == 2
                && input["tool"].is_null()
                && args
                    .iter()
                    .all(|arg| arg.as_str().is_some_and(|arg| !arg.chars().any(char::is_control)))
        }
        Some("discover") => {
            route["kind"] == "cli" && route["provider"] == "github" && args.is_empty() && input["tool"].is_null()
        }
        _ => false,
    };
    if valid { Ok(()) } else { Err(invalid()) }
}

pub fn validate_input(input: &Value) -> io::Result<()> {
    let env = text(input, "envId", 256)?;
    if !["windows", "linux", "macos"].contains(&env.as_str()) && !env.starts_with("wsl:") {
        return Err(invalid());
    }
    let id = text(input, "assetId", 128)?;
    if !id
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    {
        return Err(invalid());
    }
    text(input, "cwd", 4096)?;
    if !matches!(input["kind"].as_str(), Some("exec" | "put" | "get" | "discover"))
        || input["timeoutSec"]
            .as_u64()
            .is_none_or(|seconds| !(1..=3600).contains(&seconds))
        || input["tool"].as_str().is_some_and(|tool| tool != "git")
    {
        return Err(invalid());
    }
    let args = input["args"]
        .as_array()
        .filter(|args| args.len() <= 256)
        .ok_or_else(invalid)?;
    let mut size = 0;
    for arg in args {
        let arg = arg.as_str().filter(|arg| !arg.contains('\0')).ok_or_else(invalid)?;
        size += arg.len();
    }
    if size > 65_536 {
        return Err(invalid());
    }
    if !input["inputDigest"].is_null() && !input["inputDigest"].as_str().is_some_and(runtime::valid_token) {
        return Err(invalid());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn owned_route_receipts_use_the_manifest_budget_not_the_runtime_budget() {
        let root = std::env::temp_dir().join(format!("cloudlink-routes-test-{}", runtime::nonce().unwrap()));
        fs::create_dir(&root).unwrap();
        let directory = root.join("routes");
        fs::create_dir(&directory).unwrap();
        fs::write(
            root.join(".cloudlink.json"),
            br#"{"managedBy":"cloudlink","kind":"data"}"#,
        )
        .unwrap();
        let files: serde_json::Map<String, Value> = (0..250)
            .map(|index| (format!("ssh-{index:04}.conf"), Value::String("a".repeat(64))))
            .collect();
        let receipt =
            serde_json::to_vec(&json!({"managedBy":"cloudlink","kind":"execution-routes","files":files})).unwrap();
        assert!(receipt.len() as u64 > runtime::MAX_RUNTIME);
        fs::write(directory.join(".cloudlink.json"), receipt).unwrap();
        let manifest = json!({
            "managedBy":"cloudlink", "kind":"execution-routes", "version":protocol::VERSION,
            "installationId":runtime::installation_id(&root).unwrap(), "revision":1,
            "isolated":true, "userHome":root, "allowedRoots":[root], "resources":[],
        });
        fs::write(directory.join("manifest.json"), serde_json::to_vec(&manifest).unwrap()).unwrap();
        assert!(load(&root).is_ok());
        for (path, kind) in [
            (root.join(".cloudlink.json"), "data"),
            (directory.join(".cloudlink.json"), "execution-routes"),
        ] {
            runtime::read_owned_json(&path, kind, runtime::MAX_MANIFEST).unwrap();
        }
        for path in [
            directory.join("manifest.json"),
            directory.join(".cloudlink.json"),
            root.join(".cloudlink.json"),
        ] {
            assert!(runtime::safe_path(&path));
            let metadata = fs::symlink_metadata(&path).unwrap();
            assert!(metadata.is_file() && !runtime::is_link(&metadata));
            fs::remove_file(path).unwrap();
        }
        fs::remove_dir(directory).unwrap();
        fs::remove_dir(root).unwrap();
    }

    #[test]
    fn stable_ids_and_frame_limits_are_entry_checks_even_when_stopped() {
        let mut input = json!({"envId":"windows","assetId":"ast_1","kind":"exec","args":["uptime"],"cwd":"D:/fixture","timeoutSec":90});
        assert!(validate_input(&input).is_ok());
        input["assetId"] = Value::String("203.0.113.1:22".into());
        assert!(validate_input(&input).is_err());
        input["assetId"] = Value::String("ast_1".into());
        input["timeoutSec"] = json!(3601);
        assert!(validate_input(&input).is_err());
    }
}
