use std::collections::BTreeSet;
use std::fs;
use std::path::Path;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use super::backend::{Backend, check_ancestors};
use crate::error::{AppError, Result};
use crate::fsx;
use crate::model::asset::*;
use crate::model::delivery::Inclusion;
use crate::model::env::EnvId;
use crate::model::misc::*;
use crate::params;
use crate::secret::SecretString;
use crate::ssh::{self, managed::ManagedHost};

struct CredentialWrite<'a>(&'a AtomicUsize);

impl Drop for CredentialWrite<'_> {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::SeqCst);
    }
}

impl Backend {
    pub(super) fn build_asset(&self, input: AssetInput, validate: bool) -> Result<Asset> {
        let now = crate::time::now_rfc3339();
        match input {
            AssetInput::Vps(input) => {
                let saved = input
                    .id
                    .as_ref()
                    .map(|id| self.database()?.require_asset(id))
                    .transpose()?;
                if saved.as_ref().is_some_and(|a| a.as_server().is_none()) {
                    return Err(AppError::ipc(IpcErrorId::NotFound));
                }
                let old = saved.as_ref().and_then(Asset::as_server);
                if validate {
                    validate_common(&input.name, &input.notes, input.guardrails.rules.len())?;
                }
                let id = input.id.clone().unwrap_or_else(|| crate::new_id("ast"));
                let connection = match &input.connection {
                    ConnectionInput::Managed {
                        ssh_alias,
                        host,
                        port,
                        user,
                        auth,
                        proxy_jump,
                        defined_in,
                    } => {
                        if old.is_some_and(|s| s.connection.source != ConnectionSource::Managed) {
                            return Err(AppError::ipc(IpcErrorId::SettingsInvalid));
                        }
                        if validate {
                            if defined_in.is_empty()
                                || defined_in.len() > 64
                                || defined_in.iter().collect::<BTreeSet<_>>().len() != defined_in.len()
                            {
                                return Err(AppError::ipc(IpcErrorId::SettingsInvalid));
                            }
                            for env_id in defined_in {
                                let env = self.context(env_id)?;
                                let h = ManagedHost {
                                    alias: ssh_alias.clone(),
                                    host: host.clone(),
                                    port: *port,
                                    user: user.clone(),
                                    method: auth.method,
                                    identity_file: auth.identity_file.get(env_id).cloned(),
                                    proxy_jump: proxy_jump.clone(),
                                };
                                h.validate(env.is_windows())?;
                                if ssh::alias_conflicts(&env, ssh_alias) {
                                    return Err(AppError::ipc_with(
                                        IpcErrorId::AliasConflict,
                                        params! {"alias" => ssh_alias.clone(), "env" => env_id.as_str()},
                                    ));
                                }
                            }
                        }
                        let same = old.is_some_and(|s| connection_matches(&s.connection, &input.connection));
                        let generated = old.and_then(|s| s.connection.auth.as_ref()).is_some_and(|old_auth| {
                            old_auth.generated_by_cloud_link
                                && old_auth.identity_file == auth.identity_file
                                && old_auth.method == auth.method
                        });
                        AssetConnection {
                            source: ConnectionSource::Managed,
                            ssh_alias: if !validate && ssh_alias.is_empty() {
                                "draft-server".into()
                            } else {
                                ssh_alias.clone()
                            },
                            host: Some(host.clone()),
                            port: Some(*port),
                            user: Some(user.clone()),
                            auth: Some(AssetAuth {
                                method: auth.method,
                                identity_file: auth.identity_file.clone(),
                                generated_by_cloud_link: generated,
                                password_saved: old
                                    .and_then(|s| s.connection.auth.as_ref())
                                    .is_some_and(|a| a.password_saved)
                                    && same,
                            }),
                            proxy_jump: Some(proxy_jump.clone()),
                            defined_in: defined_in.clone(),
                            resolved: if same {
                                old.and_then(|s| s.connection.resolved.clone())
                            } else {
                                None
                            },
                            verified: if same {
                                old.and_then(|s| s.connection.verified.clone())
                            } else {
                                None
                            },
                        }
                    }
                    ConnectionInput::Imported { ssh_alias } => {
                        if validate
                            && (!ssh::validate::alias_ok(ssh_alias)
                                || old.is_some_and(|s| {
                                    s.connection.source != ConnectionSource::Imported
                                        || s.connection.ssh_alias != *ssh_alias
                                }))
                        {
                            return Err(AppError::ipc(IpcErrorId::SettingsInvalid));
                        }
                        AssetConnection {
                            source: ConnectionSource::Imported,
                            ssh_alias: ssh_alias.clone(),
                            host: None,
                            port: None,
                            user: None,
                            auth: None,
                            proxy_jump: None,
                            defined_in: ssh::defined_in(&self.contexts(false)?, ssh_alias),
                            resolved: old.and_then(|s| s.connection.resolved.clone()),
                            verified: old.and_then(|s| s.connection.verified.clone()),
                        }
                    }
                };
                let mut server = ServerAsset {
                    tag: VpsTag::Tag,
                    id,
                    name: input.name,
                    env_tag: input.env_tag,
                    summary: input.summary,
                    agent: old.map(|s| s.agent.clone()).unwrap_or(AssetAgent {
                        agents: Vec::new(),
                        mode: if input.env_tag == EnvTag::Prod {
                            Mode::ReadOnly
                        } else {
                            self.get_settings()?.default_mode
                        },
                    }),
                    guardrails: input.guardrails,
                    notes: input.notes,
                    created_at: old.map(|s| s.created_at.clone()).unwrap_or_else(|| now.clone()),
                    updated_at: now,
                    provider: input.provider,
                    region: input.region,
                    tags: input.tags,
                    connection,
                    facts: input.facts,
                    paths: input.paths,
                    services: input.services,
                    served_hostnames: input.served_hostnames,
                    listening_ports: input.listening_ports,
                    export: input.export,
                    probe: old.map(|s| s.probe.clone()).unwrap_or_default(),
                };
                if validate && let Some(test_id) = input.test_id {
                    let proof = self.connections.proof(&test_id, &input.connection)?;
                    server.connection.verified = Some(ConnectionVerified {
                        ok: true,
                        at: proof.at,
                        env_ids: vec![proof.env_id],
                    });
                }
                Ok(Asset::Vps(server))
            }
            AssetInput::Cli(input) => {
                let saved = input
                    .id
                    .as_ref()
                    .map(|id| self.database()?.require_asset(id))
                    .transpose()?;
                let old = saved.as_ref().and_then(Asset::as_cli);
                if saved
                    .as_ref()
                    .is_some_and(|a| a.as_cli().is_none_or(|c| c.cli_provider != input.cli_provider))
                {
                    return Err(AppError::ipc(IpcErrorId::NotFound));
                }
                if validate {
                    validate_common(&input.name, &input.notes, input.guardrails.rules.len())?;
                }
                if validate
                    && self.list_assets()?.iter().filter_map(Asset::as_cli).any(|a| {
                        Some(a.id.as_str()) != input.id.as_deref()
                            && a.cli_provider == input.cli_provider
                            && a.account == input.account
                    })
                {
                    return Err(AppError::ipc(IpcErrorId::AliasTaken));
                }
                let unchanged_account = old.is_some_and(|a| a.account == input.account);
                let states = if unchanged_account {
                    old.unwrap().cli.env_states.clone()
                } else {
                    Default::default()
                };
                let scope = match input.scope {
                    Some(items) if validate => {
                        self.cli
                            .validate_scope(input.cli_provider, input.account.as_deref(), &items)?
                    }
                    Some(items) => items,
                    None if unchanged_account => old.unwrap().cli.scope.clone(),
                    None => Vec::new(),
                };
                let handle = if let Some(old) = old {
                    old.handle.clone()
                } else {
                    let base = input.cli_provider.as_str();
                    let db = self.database()?;
                    (1..)
                        .map(|n| {
                            if n == 1 {
                                base.to_string()
                            } else {
                                format!("{base}-{n}")
                            }
                        })
                        .find(|h| db.handle_taken(h, None).is_ok_and(|taken| !taken))
                        .ok_or_else(|| AppError::internal("could not allocate CLI handle"))?
                };
                Ok(Asset::Cli(CliAsset {
                    tag: CliTag::Tag,
                    id: input.id.unwrap_or_else(|| crate::new_id("ast")),
                    name: input.name,
                    env_tag: input.env_tag,
                    summary: input.summary,
                    agent: old.map(|a| a.agent.clone()).unwrap_or(AssetAgent {
                        agents: Vec::new(),
                        mode: if input.env_tag == EnvTag::Prod {
                            Mode::ReadOnly
                        } else {
                            self.get_settings()?.default_mode
                        },
                    }),
                    guardrails: input.guardrails,
                    notes: input.notes,
                    created_at: old.map(|a| a.created_at.clone()).unwrap_or_else(|| now.clone()),
                    updated_at: now,
                    cli_provider: input.cli_provider,
                    handle,
                    account: input.account,
                    cli: CliInfo {
                        binary: input.cli_provider.binary(),
                        env_states: states,
                        scope,
                    },
                }))
            }
        }
    }

    pub fn save_asset(&self, input: AssetInput) -> Result<SaveResult> {
        let epoch = self.reset_epoch.load(Ordering::SeqCst);
        let cli_states = if let AssetInput::Cli(request) = &input {
            let prior = request
                .id
                .as_deref()
                .map(|id| self.database()?.require_asset(id))
                .transpose()?;
            let prior = prior.as_ref().and_then(Asset::as_cli);
            let adds_scope = request.scope.as_ref().is_some_and(|scope| {
                scope.iter().any(|item| {
                    item.selected
                        && prior.is_none_or(|old| !old.cli.scope.iter().any(|s| s.id == item.id && s.selected))
                })
            });
            if adds_scope || prior.is_none_or(|old| old.account != request.account) {
                Some(
                    self.cli
                        .detect(&self.cli_contexts()?, request.cli_provider, request.account.as_deref())?,
                )
            } else {
                None
            }
        } else {
            None
        };
        let result = {
            let _edit = self.edit_at(epoch)?;
            let proof_id = match &input {
                AssetInput::Vps(s) => s.test_id.clone(),
                _ => None,
            };
            let mut asset = self.build_asset(input, true)?;
            if let (Asset::Cli(cli), Some(states)) = (&mut asset, cli_states) {
                cli.cli.env_states = states;
            }
            let previous = self.database()?.get_asset(asset.id())?;
            if let Some(previous) = previous
                && previous
                    .as_server()
                    .zip(asset.as_server())
                    .is_some_and(|(before, after)| {
                        before.connection.source != after.connection.source
                            || before.connection.ssh_alias != after.connection.ssh_alias
                            || before.connection.host != after.connection.host
                            || before.connection.port != after.connection.port
                            || before.connection.user != after.connection.user
                            || before.connection.auth != after.connection.auth
                            || before.connection.proxy_jump != after.connection.proxy_jump
                            || before.connection.defined_in != after.connection.defined_in
                    })
            {
                self.cancel_asset_jobs(asset.id());
            }
            self.database()?.upsert_asset_guarded(&asset)?;
            if let Some(id) = proof_id {
                self.connections.consume(&id);
            }
            self.write_managed_configs()?;
            let statuses = self.publish_locked()?;
            SaveResult {
                asset: self.database()?.require_asset(asset.id())?,
                statuses,
            }
        };
        self.retry_credential_cleanup();
        Ok(result)
    }

    pub(super) fn write_managed_configs(&self) -> Result<()> {
        let assets = self.list_assets()?;
        for env in self.contexts(false)?.iter().filter(|e| e.available) {
            let hosts: Vec<_> = assets.iter().filter_map(|a| ManagedHost::from_asset(a, env)).collect();
            let path = env.host_in_home(&[".ssh", "cloudlink.conf"]);
            if hosts.is_empty() && !path.exists() {
                continue;
            }
            let write = check_ancestors(&path).and_then(|_| ssh::managed::write(&path, &hosts, env.is_windows()));
            let mut ok = write.is_ok();
            if ok
                && !self.paths.isolated
                && !cfg!(test)
                && fs::read_to_string(env.host_in_home(&[".ssh", "config"]))
                    .is_ok_and(|s| ssh::managed::is_included_at(&s, &env.managed_config_native()))
            {
                let tools = self.tools()?;
                ok = hosts
                    .iter()
                    .all(|h| ssh::readback_mismatches(&tools, env, h).is_empty());
            }
            self.activity(
                ActivityKind::SshConfig,
                ActivityMessageId::SshConfigWritten,
                None,
                params! {"env" => env.id.as_str(), "count" => hosts.len()},
                ok,
            )?;
        }
        Ok(())
    }

    pub fn set_mode(&self, asset_id: &str, mode: Mode) -> Result<SaveResult> {
        let _edit = self.edit()?;
        let mut asset = self.database()?.require_asset(asset_id)?;
        asset.agent_mut().mode = mode;
        self.database()?.upsert_asset(&asset)?;
        self.activity(
            ActivityKind::Mode,
            ActivityMessageId::ModeChanged,
            Some(asset_id),
            params! {"alias" => asset.handle(), "mode" => mode.as_str()},
            true,
        )?;
        let statuses = self.publish_locked()?;
        Ok(SaveResult { asset, statuses })
    }

    pub fn set_distribute(&self, asset_id: &str, agent_key: &str, on: bool) -> Result<Vec<Inclusion>> {
        let epoch = self.reset_epoch.load(Ordering::SeqCst);
        if on {
            let snapshot = self.database()?.require_asset(asset_id)?;
            if let Some(cli) = snapshot.as_cli() {
                self.detect_cli_environment(super::requests::CliRequest {
                    provider: cli.cli_provider,
                    asset_id: Some(asset_id.into()),
                    account: None,
                })?;
            }
        }
        let _edit = self.edit_at(epoch)?;
        let mut asset = self.database()?.require_asset(asset_id)?;
        if on {
            if !self
                .list_targets()?
                .iter()
                .any(|t| t.enabled && t.agent_key == agent_key)
            {
                return Err(AppError::ipc(IpcErrorId::NotFound));
            }
            let reason = match &asset {
                Asset::Vps(s)
                    if s.connection
                        .auth
                        .as_ref()
                        .is_some_and(|a| a.method == AuthMethod::Password) =>
                {
                    Some("password-only")
                }
                Asset::Vps(s) if !s.connection.verified.as_ref().is_some_and(|v| v.ok) => Some("unverified"),
                Asset::Cli(c)
                    if !c.cli.env_states.values().any(|s| {
                        s.installed
                            && s.authenticated
                            && !s.expired
                            && c.account
                                .as_ref()
                                .is_none_or(|a| s.accounts.as_ref().is_some_and(|accounts| accounts.contains(a)))
                    }) =>
                {
                    Some("cli-not-ready")
                }
                _ => None,
            };
            if let Some(reason) = reason {
                return Err(AppError::ipc_with(
                    IpcErrorId::CannotDistribute,
                    params! {"reason" => reason},
                ));
            }
            if !asset.agent().agents.iter().any(|k| k == agent_key) {
                asset.agent_mut().agents.push(agent_key.to_string());
            }
        } else {
            asset.agent_mut().agents.retain(|k| k != agent_key);
        }
        self.database()?.upsert_asset(&asset)?;
        self.publish_locked()?;
        Ok(self
            .list_inclusions()?
            .into_iter()
            .filter(|i| i.asset_id == asset_id)
            .collect())
    }

    pub fn import_hosts(self: &Arc<Self>, hosts: Vec<ImportHost>, probe_after: bool) -> Result<Vec<Asset>> {
        let result = {
            let _edit = self.edit()?;
            let scanned = self.list_ssh_hosts(None)?;
            let mut added = Vec::new();
            for host in hosts {
                let actual = scanned
                    .hosts
                    .iter()
                    .find(|h| h.alias.eq_ignore_ascii_case(&host.alias))
                    .ok_or_else(|| AppError::ipc(IpcErrorId::NotFound))?;
                if actual.imported {
                    continue;
                }
                if host.defined_in.iter().any(|id| !actual.defined_in.contains(id)) {
                    return Err(AppError::ipc(IpcErrorId::SettingsInvalid));
                }
                let now = crate::time::now_rfc3339();
                let asset = Asset::Vps(ServerAsset {
                    tag: VpsTag::Tag,
                    id: crate::new_id("ast"),
                    name: actual.alias.clone(),
                    env_tag: EnvTag::Prod,
                    summary: String::new(),
                    agent: AssetAgent {
                        agents: Vec::new(),
                        mode: Mode::ReadOnly,
                    },
                    guardrails: Guardrails::default(),
                    notes: String::new(),
                    created_at: now.clone(),
                    updated_at: now,
                    provider: None,
                    region: None,
                    tags: Vec::new(),
                    connection: AssetConnection {
                        source: ConnectionSource::Imported,
                        ssh_alias: actual.alias.clone(),
                        host: None,
                        port: None,
                        user: None,
                        auth: None,
                        proxy_jump: None,
                        defined_in: actual.defined_in.clone(),
                        resolved: None,
                        verified: None,
                    },
                    facts: AssetFacts::default(),
                    paths: Vec::new(),
                    services: Vec::new(),
                    served_hostnames: Vec::new(),
                    listening_ports: Vec::new(),
                    export: ExportFlags::default(),
                    probe: AssetProbeInfo::default(),
                });
                self.database()?.upsert_asset(&asset)?;
                added.push(asset);
            }
            self.publish_locked()?;
            added
        };
        if probe_after {
            for asset in &result {
                self.start_probe(asset.id())?;
            }
        }
        Ok(result)
    }

    /// New revisions are written outside every state/transaction lock. The database pointer switches last.
    pub fn set_password(&self, asset_id: &str, password: Option<String>) -> Result<()> {
        let epoch = self.reset_epoch.load(Ordering::SeqCst);
        let _writing = {
            let _edit = self.edit_at(epoch)?;
            self.credential_writes.fetch_add(1, Ordering::SeqCst);
            CredentialWrite(&self.credential_writes)
        };
        let snapshot = self.database()?.require_asset(asset_id)?;
        let Asset::Vps(server) = &snapshot else {
            return Err(AppError::ipc(IpcErrorId::NotFound));
        };
        if server.connection.source != ConnectionSource::Managed
            || (password.is_some()
                && server
                    .connection
                    .auth
                    .as_ref()
                    .is_none_or(|a| a.method != AuthMethod::Password))
        {
            return Err(AppError::ipc(IpcErrorId::SettingsInvalid));
        }
        let value = password.map(SecretString::new).transpose()?;
        let revision = value.as_ref().map(|_| format!("{asset_id}_{}", ulid::Ulid::generate()));
        let vault = self
            .vault_writes
            .lock()
            .map_err(|_| AppError::internal("credential writes unavailable"))?;
        if let (Some(key), Some(value)) = (&revision, &value) {
            // A crash or an OS error after writing must leave a discoverable cleanup receipt.
            self.database()?.stage_password_write(key)?;
            if let Err(error) = self.credentials.set(key, value) {
                drop(vault);
                drop(_writing);
                self.retry_credential_cleanup();
                return Err(error);
            }
        }
        let committed = (|| {
            let _edit = self.edit_at(epoch)?;
            let mut asset = self.database()?.require_asset(asset_id)?;
            if !crate::db::Db::password_target_matches(&snapshot, &asset) {
                return Err(AppError::ipc(IpcErrorId::PasswordTargetChanged));
            }
            let Asset::Vps(current) = &mut asset else {
                return Err(AppError::ipc(IpcErrorId::NotFound));
            };
            if let Some(auth) = &mut current.connection.auth {
                auth.password_saved = value.is_some();
            }
            let db = self.database()?;
            match revision.as_deref() {
                Some(key) => db.commit_staged_password(&asset, key),
                None => db.replace_password_ref(&asset, None),
            }
        })();
        drop(vault);
        drop(_writing);
        self.retry_credential_cleanup();
        committed
    }

    pub(super) fn cleanup_credentials(&self) -> Result<()> {
        let _vault = self
            .vault_writes
            .lock()
            .map_err(|_| AppError::internal("credential writes unavailable"))?;
        let pending = self.database()?.password_cleanup()?;
        let mut failure = None;
        for key in pending {
            match self.credentials.delete(&key) {
                Ok(()) => {
                    self.database()?.finish_password_cleanup(&key)?;
                }
                Err(error) => {
                    failure = Some(error);
                }
            }
        }
        failure.map_or(Ok(()), Err)
    }

    pub(super) fn retry_credential_cleanup(&self) {
        if self.cleanup_credentials().is_err() {
            // The durable queue is retried later. A completed save must still return its fresh state.
            log::warn!("CloudLink credential cleanup remains pending");
        }
    }

    pub fn delete_asset(&self, id: &str, remove_generated_key: bool) -> Result<DeleteResult> {
        self.cancel_asset_jobs(id);
        let statuses = {
            let _edit = self.edit()?;
            self.database()?.require_asset(id)?;
            let receipts = if remove_generated_key {
                self.database()?.generated_keys(id)?
            } else {
                Vec::new()
            };
            let envs = self.contexts(false)?;
            let receipts = receipts
                .into_iter()
                .map(|receipt| {
                    self.database()?
                        .key_in_use(id, &receipt.0, &envs)
                        .map(|in_use| (!in_use).then_some(receipt))
                })
                .collect::<Result<Vec<_>>>()?
                .into_iter()
                .flatten()
                .collect::<Vec<_>>();
            for (path, expected_hash) in &receipts {
                check_ancestors(Path::new(path))?;
                if let Ok(meta) = fs::symlink_metadata(path) {
                    if fsx::is_link(&meta) || !meta.is_file() {
                        return Err(AppError::ipc(IpcErrorId::SettingsInvalid));
                    }
                    let content = zeroize::Zeroizing::new(fs::read(path)?);
                    if crate::compile::publish::tree_hash([("", content.as_slice())]) != *expected_hash {
                        return Err(AppError::ipc(IpcErrorId::SettingsInvalid));
                    }
                }
            }
            if !receipts.is_empty() {
                self.check_data_ownership()?;
            }
            for (path, _) in &receipts {
                if Path::new(path).exists() {
                    fs::remove_file(path)?;
                }
            }
            self.database()?.delete_asset_with_password_cleanup(id)?;
            self.write_managed_configs()?;
            self.publish_locked()?
        };
        self.retry_credential_cleanup();
        Ok(DeleteResult { statuses })
    }

    pub(super) fn record_generated_key(&self, id: &str, path: &Path) -> Result<()> {
        self.check_data_ownership()?;
        let env = self.context(&EnvId::windows())?;
        let native = env.windows_path_to_native(path);
        for file in [path.to_path_buf(), crate::secret::keygen::pub_path(path)] {
            check_ancestors(&file)?;
            let content = zeroize::Zeroizing::new(fs::read(&file)?);
            let hash = crate::compile::publish::tree_hash([("", content.as_slice())]);
            self.database()?
                .record_generated_key_at(id, env.id.as_str(), &native, &file.to_string_lossy(), &hash)?;
        }
        Ok(())
    }

    pub(super) fn check_data_ownership(&self) -> Result<()> {
        let path = self.paths.data_dir.join(".cloudlink.json");
        check_ancestors(&path)?;
        let value: serde_json::Value = serde_json::from_slice(&fs::read(path)?)?;
        if value.get("managedBy").and_then(serde_json::Value::as_str) != Some("cloudlink")
            || value.get("kind").and_then(serde_json::Value::as_str) != Some("data")
        {
            return Err(AppError::ipc(IpcErrorId::SettingsInvalid));
        }
        Ok(())
    }
}

pub(super) fn connection_matches(saved: &AssetConnection, input: &ConnectionInput) -> bool {
    match input {
        ConnectionInput::Imported { ssh_alias } => {
            saved.source == ConnectionSource::Imported && saved.ssh_alias == *ssh_alias
        }
        ConnectionInput::Managed {
            ssh_alias,
            host,
            port,
            user,
            auth,
            proxy_jump,
            defined_in,
        } => {
            saved.source == ConnectionSource::Managed
                && saved.ssh_alias == *ssh_alias
                && saved.host.as_ref() == Some(host)
                && saved.port == Some(*port)
                && saved.user.as_ref() == Some(user)
                && saved.proxy_jump.as_ref() == Some(proxy_jump)
                && saved.defined_in == *defined_in
                && saved
                    .auth
                    .as_ref()
                    .is_some_and(|a| a.method == auth.method && a.identity_file == auth.identity_file)
        }
    }
}

fn validate_common(name: &str, notes: &str, rules: usize) -> Result<()> {
    if name.trim().is_empty() || name.len() > 256 || notes.len() > 64 * 1024 || rules > 100 {
        return Err(AppError::ipc(IpcErrorId::SettingsInvalid));
    }
    Ok(())
}
