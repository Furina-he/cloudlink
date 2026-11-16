//! Private, owned projections for the independent runner. Publication never depends on Skill lint.

use std::collections::BTreeMap;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

use guard_rules::runtime;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

use super::Backend;
use crate::env::EnvContext;
use crate::error::{AppError, Result};
use crate::model::asset::{Asset, AuthMethod, ConnectionSource};
use crate::model::delivery::{Inclusion, Target};
use crate::model::env::EnvId;
use crate::paths::Paths;
use crate::ssh::{self, managed::ManagedHost};

const KIND: &str = "execution-routes";

fn unavailable() -> AppError {
    AppError::ipc(crate::model::misc::IpcErrorId::ExecutionUnavailable)
}

fn marker(directory: &Path) -> Result<Value> {
    Ok(runtime::read_owned_json(
        &directory.join(".cloudlink.json"),
        KIND,
        runtime::MAX_MANIFEST,
    )?)
}

fn ensure_directory(paths: &Paths) -> Result<Value> {
    let directory = paths.data_dir.join("routes");
    if !runtime::safe_path(&directory) {
        return Err(unavailable());
    }
    if !directory.exists() {
        fs::create_dir(&directory)?;
    }
    let path = directory.join(".cloudlink.json");
    if !path.exists() {
        if fs::read_dir(&directory)?.next().is_some() {
            return Err(unavailable());
        }
        runtime::write_atomic(
            &path,
            &serde_json::to_vec(&json!({"managedBy":"cloudlink","kind":KIND,"files":{}}))?,
        )?;
    }
    runtime::protect(&directory)?;
    marker(&directory)
}

fn save_marker(directory: &Path, value: &Value) -> Result<()> {
    marker(directory)?;
    runtime::write_atomic(&directory.join(".cloudlink.json"), &serde_json::to_vec(value)?)?;
    Ok(())
}

fn store_config(directory: &Path, receipt: &mut Value, content: &str) -> Result<(PathBuf, String)> {
    let hash = runtime::digest(content.as_bytes());
    let name = format!("ssh-{hash}.conf");
    let path = directory.join(&name);
    if let Some(before) = runtime::bounded_file(&path, runtime::MAX_MANIFEST)? {
        if receipt["files"][&name] != hash || runtime::digest(&before) != hash {
            return Err(unavailable());
        }
    } else {
        // A durable receipt precedes creation. Never adopt an unrelated existing file.
        receipt["files"][&name] = hash.clone().into();
        save_marker(directory, receipt)?;
        runtime::write_atomic(&path, content.as_bytes())?;
    }
    runtime::protect(&path)?;
    Ok((path, hash))
}

fn imported_host(backend: &Backend, asset: &Asset, env: &EnvContext) -> Option<ManagedHost> {
    let server = asset.as_server()?;
    let effective = if backend.paths.isolated || cfg!(test) {
        // No native defaults or Include expansion in tests. Only the fixture's explicit block is read.
        let path = env.to_host(&env.ssh_config_native());
        crate::paths::validate_file(&path).ok()?;
        let text = fs::read_to_string(path).ok()?;
        let entry = ssh::config::scan_text(&text)
            .hosts
            .into_iter()
            .find(|h| h.alias.eq_ignore_ascii_case(asset.handle()))?;
        ssh::config::Effective {
            hostname: entry.hostname?,
            user: entry.user?,
            port: entry.port.unwrap_or(22),
            ..Default::default()
        }
    } else {
        backend
            .tools()
            .ok()?
            .effective(env, &env.ssh_config_native(), asset.handle())?
    };
    let identity_file = effective.identity_files.into_iter().find_map(|path| {
        let path = if let Some(relative) = path.strip_prefix("~/") {
            format!("{}/{}", env.home.trim_end_matches('/'), relative)
        } else {
            path
        };
        ssh::validate::identity_ok(&path, env.is_windows()).then_some(path)
    });
    let host = ManagedHost {
        alias: server.connection.ssh_alias.clone(),
        host: effective.hostname,
        port: effective.port,
        user: effective.user,
        method: if identity_file.is_some() {
            AuthMethod::Key
        } else {
            AuthMethod::Agent
        },
        identity_file,
        proxy_jump: effective.proxy_jump,
    };
    host.validate(env.is_windows()).ok()?;
    Some(host)
}

fn within(path: &Path, roots: &[PathBuf]) -> bool {
    if !runtime::safe_path(path) {
        return false;
    }
    let text = crate::fsx::ssh_path(&path.to_string_lossy()).to_lowercase();
    roots.iter().any(|root| {
        let root = crate::fsx::ssh_path(&root.to_string_lossy()).to_lowercase();
        text == root || text.strip_prefix(&root).is_some_and(|suffix| suffix.starts_with('/'))
    })
}

impl Backend {
    /// The caller holds mutation. Config files are content-addressed, so a new manifest cannot
    /// change the bytes beneath an already consumed approval or a running child.
    pub(super) fn project_execution_routes_locked(
        &self,
        assets: &[Asset],
        envs: &[EnvContext],
        targets: &[Target],
        inclusions: &[Inclusion],
    ) -> Result<()> {
        // Reset removes the managed helper. A later save must restore the console entry without reinstalling a hook.
        if !cfg!(test) && !crate::guard::executable_path(&self.paths).is_file() {
            self.prepare_guard_binary()?;
        }
        let installation = runtime::installation_id(&self.paths.data_dir)?;
        let directory = self.paths.data_dir.join("routes");
        let mut receipt = ensure_directory(&self.paths)?;
        let mut roots = vec![self.paths.data_dir.clone(), self.paths.user_home.clone()];
        if self.paths.isolated {
            // Only the override is a directory. The real WSL root is a bare UNC server prefix,
            // not an absolute filesystem path; it is never an isolation boundary for native runs.
            roots.push(self.paths.wsl_root.clone());
        }
        let policies = crate::guard::project_runtime_policy(&self.paths, assets);
        let by_id: BTreeMap<_, _> = policies["resources"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|p| p["id"].as_str().map(|id| (id, p)))
            .collect();
        let mut resources = Vec::new();
        for env in envs {
            let mut hosts = BTreeMap::new();
            for asset in assets {
                let Some(server) = asset.as_server() else { continue };
                if !server.connection.defined_in.contains(&env.id) {
                    continue;
                }
                let host = if server.connection.source == ConnectionSource::Managed {
                    ManagedHost::from_asset(asset, env)
                } else {
                    imported_host(self, asset, env)
                };
                if let Some(host) = host
                    && host.validate(env.is_windows()).is_ok()
                {
                    if self.paths.isolated
                        && host
                            .identity_file
                            .as_ref()
                            .is_some_and(|f| !within(&env.to_host(f), &roots))
                    {
                        continue;
                    }
                    hosts.insert(asset.id().to_string(), host);
                }
            }
            let config = if hosts.is_empty() {
                None
            } else {
                let mut content = format!("{}\n", ssh::managed::MANAGED_HEADER);
                for host in hosts.values() {
                    let extra = vec![format!(
                        "UserKnownHostsFile {}",
                        ssh::managed::quote_path(&env.known_hosts_native())
                    )];
                    content.push_str(&ssh::managed::render_host(host, &extra));
                    content.push('\n');
                }
                content.push_str("\nHost *\n  BatchMode yes\n  StrictHostKeyChecking yes\n  ConnectTimeout 10\n  ConnectionAttempts 1\n  PermitLocalCommand no\n  ControlMaster no\n  ControlPath none\n  UpdateHostKeys no\n  VerifyHostKeyDNS no\n  GlobalKnownHostsFile none\n  ForwardAgent no\n  ForwardX11 no\n  ClearAllForwardings yes\n  RequestTTY no\n");
                if self.paths.isolated {
                    content.push_str("  IdentityAgent none\n  IdentityFile none\n  GSSAPIAuthentication no\n  HostbasedAuthentication no\n  ProxyCommand none\n  ProxyJump none\n");
                }
                Some(store_config(&directory, &mut receipt, &content)?)
            };
            for asset in assets {
                let target_selected = targets
                    .iter()
                    .any(|t| t.enabled && t.env_id == env.id && asset.agent().agents.contains(&t.agent_key));
                let included = inclusions
                    .iter()
                    .any(|i| i.asset_id == asset.id() && i.env_id == env.id && i.included);
                let mut policy = by_id.get(asset.id()).cloned().cloned().unwrap_or(Value::Null);
                if !policy.is_object() {
                    continue;
                }
                policy["production"] = asset.production().into();
                policy["envId"] = env.id.as_str().into();
                policy["protectedPaths"] = json!([
                    env.windows_path_to_native(&self.paths.data_dir.join("runtime.json")),
                    env.windows_path_to_native(&self.paths.data_dir.join("guard/policy.json")),
                    env.windows_path_to_native(&directory),
                ]);
                policy["runtimePid"] = std::process::id().into();
                let mut route = json!({
                    "assetId":asset.id(),"envId":env.id,"kind":policy["kind"],"handle":asset.handle(),
                    "production":asset.production(),"enabled":target_selected && included && env.available && env.interop,
                    "mode":asset.agent().mode,"policy":policy,
                });
                if let Some(distro) = env.distro() {
                    route["distro"] = distro.into();
                    route["interop"] = env.interop.into();
                    route["home"] = env.home.clone().into();
                }
                match asset {
                    Asset::Vps(server) => {
                        if !server.connection.defined_in.contains(&env.id) {
                            continue;
                        }
                        let Some((config, hash)) = config.as_ref().filter(|_| hosts.contains_key(asset.id())) else {
                            route["enabled"] = false.into();
                            route["reasonId"] = "execution-ssh-unavailable".into();
                            resources.push(route);
                            continue;
                        };
                        route["sshPath"] = if env.is_windows() {
                            crate::fsx::ssh_path(&self.tools()?.windows_ssh.to_string_lossy()).into()
                        } else {
                            "/usr/bin/ssh".into()
                        };
                        // The Windows sidecar translates its managed Windows file when entering WSL.
                        route["configPath"] = crate::fsx::ssh_path(&config.to_string_lossy()).into();
                        route["configNative"] = env.windows_path_to_native(config).into();
                        route["configHash"] = hash.clone().into();
                        route["alias"] = server.connection.ssh_alias.clone().into();
                    }
                    Asset::Cli(cli) => {
                        let Some(state) = cli.cli.env_states.get(&env.id) else {
                            continue;
                        };
                        route["enabled"] =
                            (route["enabled"] == true && state.authenticated && state.installed && !state.expired)
                                .into();
                        route["provider"] = serde_json::to_value(cli.cli_provider)?;
                        route["program"] = state.path.clone().map(Value::String).unwrap_or(Value::Null);
                        route["account"] = cli.account.clone().map(Value::String).unwrap_or(Value::Null);
                        // Share the semantic projection: checkedAt/reasonId must not revoke a permit.
                        route["github"] = route["policy"]["github"].clone();
                        if state.path.is_none() {
                            route["enabled"] = false.into();
                        }
                    }
                }
                resources.push(route);
            }
        }
        let path = directory.join("manifest.json");
        let before = runtime::bounded_file(&path, runtime::MAX_MANIFEST)?;
        let prior = match before.as_ref() {
            Some(_) => Some(runtime::read_owned_json(&path, KIND, runtime::MAX_MANIFEST)?),
            None => None,
        };
        if let Some(prior) = &prior
            && (prior["version"] != 1 || prior["installationId"] != installation)
        {
            return Err(unavailable());
        }
        let mut manifest = json!({
            "managedBy":"cloudlink","kind":KIND,"version":1,"installationId":installation,
            "revision":prior.as_ref().and_then(|p| p["revision"].as_u64()).unwrap_or(0),
            "isolated":self.paths.isolated,"userHome":crate::fsx::ssh_path(&self.paths.user_home.to_string_lossy()),
            "allowedRoots":roots.iter().map(|p| crate::fsx::ssh_path(&p.to_string_lossy())).collect::<Vec<_>>(),
            "policyHash":runtime::digest(&serde_json::to_vec(&policies)?),"resources":resources,
        });
        if prior.as_ref() != Some(&manifest) {
            let revision = manifest["revision"]
                .as_u64()
                .ok_or_else(unavailable)?
                .checked_add(1)
                .ok_or_else(unavailable)?;
            manifest["revision"] = revision.into();
            receipt["manifestOwned"] = true.into();
            save_marker(&directory, &receipt)?;
            runtime::write_atomic(&path, &serde_json::to_vec(&manifest)?)?;
        }
        let mut service = self.execution()?;
        service.routes_current = true;
        service.policy_changed(manifest["revision"].as_u64().ok_or_else(unavailable)?);
        self.execution_changed(&service)?;
        drop(service);
        Ok(())
    }

    pub(super) fn current_execution_route(
        &self,
        input: &Value,
        expected_revision: Option<u64>,
    ) -> Result<(Value, u64)> {
        let directory = self.paths.data_dir.join("routes");
        let receipt = marker(&directory)?;
        let manifest = runtime::read_owned_json(&directory.join("manifest.json"), KIND, runtime::MAX_MANIFEST)?;
        if receipt["manifestOwned"] != true
            || manifest["installationId"] != runtime::installation_id(&self.paths.data_dir)?
            || manifest["version"] != 1
        {
            return Err(unavailable());
        }
        let policy = runtime::read_owned_json(
            &self.paths.data_dir.join("guard/policy.json"),
            "guard-policy",
            runtime::MAX_MANIFEST,
        )?;
        if manifest["policyHash"] != runtime::digest(&serde_json::to_vec(&policy)?) {
            return Err(unavailable());
        }
        let revision = manifest["revision"].as_u64().ok_or_else(unavailable)?;
        if expected_revision.is_some_and(|expected| expected != revision) {
            return Err(AppError::ipc(crate::model::misc::IpcErrorId::ExecutionStale));
        }
        let route = manifest["resources"]
            .as_array()
            .ok_or_else(unavailable)?
            .iter()
            .find(|route| route["assetId"] == input["assetId"] && route["envId"] == input["envId"])
            .ok_or_else(unavailable)?;
        if route["enabled"] != true {
            return Err(unavailable());
        }
        if route["kind"] == "vps" {
            let config = route["configPath"].as_str().ok_or_else(unavailable)?;
            let path = Path::new(config);
            if path.parent() != Some(directory.as_path()) {
                return Err(unavailable());
            }
            let name = path.file_name().and_then(|n| n.to_str()).ok_or_else(unavailable)?;
            let bytes = runtime::bounded_file(path, runtime::MAX_MANIFEST)?.ok_or_else(unavailable)?;
            if receipt["files"][name] != route["configHash"] || route["configHash"] != runtime::digest(&bytes) {
                return Err(unavailable());
            }
        }
        if input["kind"] == "put" {
            let env =
                self.context(&EnvId::parse(input["envId"].as_str().ok_or_else(unavailable)?).ok_or_else(unavailable)?)?;
            let native = input["args"].get(0).and_then(Value::as_str).ok_or_else(unavailable)?;
            let native = if Path::new(native).is_absolute() || env.distro().is_some() && native.starts_with('/') {
                native.to_string()
            } else {
                format!("{}/{native}", input["cwd"].as_str().ok_or_else(unavailable)?)
            };
            let path = env.to_host(&native);
            if !runtime::safe_path(&path)
                || self.paths.isolated
                    && !within(
                        &path,
                        &[
                            self.paths.data_dir.clone(),
                            self.paths.user_home.clone(),
                            self.paths.wsl_root.clone(),
                        ],
                    )
            {
                return Err(unavailable());
            }
            let mut file = fs::File::open(&path)?;
            if !file.metadata()?.is_file() {
                return Err(unavailable());
            }
            let mut hash = Sha256::new();
            let mut buffer = [0; 64 * 1024];
            loop {
                let read = file.read(&mut buffer)?;
                if read == 0 {
                    break;
                }
                hash.update(&buffer[..read]);
            }
            let digest = hash.finalize().iter().map(|b| format!("{b:02x}")).collect::<String>();
            if input["inputDigest"] != digest {
                return Err(AppError::ipc(crate::model::misc::IpcErrorId::ExecutionStale));
            }
        }
        Ok((route.clone(), revision))
    }

    pub(super) fn clear_execution_routes_locked(&self) -> Result<()> {
        let directory = self.paths.data_dir.join("routes");
        if !directory.exists() {
            return Ok(());
        }
        let receipt = marker(&directory)?;
        // Unknown siblings stay untouched. A tracked file must still match its receipt.
        for (name, hash) in receipt["files"].as_object().ok_or_else(unavailable)? {
            if !name.starts_with("ssh-") || !name.ends_with(".conf") || name.contains(['/', '\\']) {
                return Err(unavailable());
            }
            let path = directory.join(name);
            if let Some(bytes) = runtime::bounded_file(&path, runtime::MAX_MANIFEST)? {
                if hash != &runtime::digest(&bytes) {
                    return Err(unavailable());
                }
                marker(&directory)?;
                fs::remove_file(path)?;
            }
        }
        let manifest = directory.join("manifest.json");
        if runtime::bounded_file(&manifest, runtime::MAX_MANIFEST)?.is_some() {
            if receipt["manifestOwned"] != true {
                return Err(unavailable());
            }
            runtime::read_owned_json(&manifest, KIND, runtime::MAX_MANIFEST)?;
            fs::remove_file(manifest)?;
        }
        save_marker(&directory, &json!({"managedBy":"cloudlink","kind":KIND,"files":{}}))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::*;
    use crate::cli;
    use crate::env::{FakeSystem, WslInfo};
    use crate::secret::store::MemoryCredentialStore;

    struct NoEvents;

    impl super::super::EventSink for NoEvents {
        fn emit(&self, _event: &str, _payload: Value) {}
    }

    fn project(paths: &Paths) -> Arc<Backend> {
        // Even the production-shaped path fixture injects every external service and never starts detection.
        let backend = Backend::assemble(
            paths.clone(),
            Arc::new(FakeSystem::default()),
            Arc::new(MemoryCredentialStore::default()),
            cli::Service::new(Arc::new(cli::EmptyRunner)),
            Arc::new(NoEvents),
            Arc::new(super::super::feedback::NoProcessSelfTest),
            None,
        )
        .unwrap();
        let envs = vec![
            EnvContext::windows(paths),
            EnvContext::wsl(
                paths,
                "Fixture-Distro",
                WslInfo {
                    home: "/home/fixture".into(),
                    interop: true,
                    ..Default::default()
                },
            ),
        ];
        crate::guard::write_policy(paths, &[]).unwrap();
        backend.project_execution_routes_locked(&[], &envs, &[], &[]).unwrap();
        backend
    }

    #[cfg(windows)]
    #[test]
    fn native_windows_manifest_does_not_treat_the_wsl_server_prefix_as_a_directory() {
        let temp = tempfile::tempdir().unwrap();
        let mut paths = Paths::isolated_in(temp.path());
        paths.isolated = false;
        paths.wsl_root = PathBuf::from(r"\\wsl.localhost");
        assert!(!paths.wsl_root.is_absolute());
        let _backend = project(&paths);
        let mut manifest = guard_rules::routes::load(&paths.data_dir).unwrap();
        assert_eq!(
            manifest["allowedRoots"],
            json!([
                crate::fsx::ssh_path(&paths.data_dir.to_string_lossy()),
                crate::fsx::ssh_path(&paths.user_home.to_string_lossy()),
            ])
        );
        // The fix is in generation: the unchanged reader must still reject a malformed UNC root.
        manifest["allowedRoots"]
            .as_array_mut()
            .unwrap()
            .push("//wsl.localhost".into());
        let directory = paths.data_dir.join("routes");
        assert_eq!(marker(&directory).unwrap()["manifestOwned"], true);
        runtime::write_atomic(
            &directory.join("manifest.json"),
            &serde_json::to_vec(&manifest).unwrap(),
        )
        .unwrap();
        assert_eq!(
            guard_rules::routes::load(&paths.data_dir).unwrap_err().to_string(),
            "execution-route-invalid"
        );
    }

    #[test]
    fn isolated_manifest_keeps_all_override_roots_and_rejects_escape_paths() {
        let temp = tempfile::tempdir().unwrap();
        let paths = Paths::isolated_in(temp.path());
        let _backend = project(&paths);
        let manifest = guard_rules::routes::load(&paths.data_dir).unwrap();
        for root in [&paths.data_dir, &paths.user_home, &paths.wsl_root] {
            assert!(guard_rules::routes::path_allowed(
                &manifest,
                &root.join("fixture/new-file")
            ));
        }
        assert!(!guard_rules::routes::path_allowed(
            &manifest,
            &temp.path().join("outside")
        ));
        assert!(!guard_rules::routes::path_allowed(
            &manifest,
            &paths.wsl_root.join("..").join("outside")
        ));
    }
}
