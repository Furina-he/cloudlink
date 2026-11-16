//! GitHub scope commands. Remote work happens without mutation/database locks, then
//! resource revision and reset epoch are rechecked before metadata can be committed.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::atomic::Ordering;

use super::Backend;
use crate::error::{AppError, Result};
use crate::model::asset::{Asset, CliProvider};
use crate::model::github::*;
use crate::model::misc::{IpcErrorId, SaveResult};
use crate::params;

fn changed() -> AppError {
    AppError::ipc_with(IpcErrorId::CliScopeFailed, params! {"reason" => "revision-changed"})
}

fn config_of(asset: &Asset) -> Result<GithubConfig> {
    let cli = asset
        .as_cli()
        .filter(|cli| cli.cli_provider == CliProvider::Github)
        .ok_or_else(|| AppError::ipc(IpcErrorId::NotFound))?;
    Ok(cli
        .github
        .clone()
        .unwrap_or_else(|| GithubConfig::legacy(&cli.cli.scope)))
}

pub(super) fn merge_refresh(previous: &GithubConfig, fresh: &GithubConfig) -> GithubConfig {
    let mut next = previous.clone();
    next.env_states = BTreeMap::new();
    for (env_id, snapshot) in &fresh.env_states {
        let mut snapshot = snapshot.clone();
        if snapshot
            .owner
            .as_ref()
            .is_some_and(|owner| previous.owner.as_ref().is_some_and(|old| old.id != owner.id))
        {
            snapshot.status = GithubSnapshotStatus::Denied;
            snapshot.reason_id = Some("owner-changed".into());
            snapshot.repos.clear();
        }
        if snapshot.status == GithubSnapshotStatus::Complete {
            for repo in &mut snapshot.repos {
                repo.selected = previous.includes(repo);
            }
        } else if let Some(old) = previous.env_states.get(env_id) {
            // A failed query is not evidence of deletion. Keep the already-provided
            // history, never merge new repository metadata from incomplete pages.
            snapshot.repos = old.repos.clone();
            for repo in &mut snapshot.repos {
                repo.selected &= previous.includes(repo);
            }
            if snapshot.identity.is_none() {
                snapshot.identity = old.identity.clone();
            }
            if snapshot.owner.is_none() {
                snapshot.owner = old.owner.clone();
            }
        }
        next.env_states.insert(env_id.clone(), snapshot);
    }
    next
}

fn result_for(asset: &Asset, config: GithubConfig, owners: Vec<GithubOwner>) -> GithubScopeResult {
    let cli = asset.as_cli().expect("validated GitHub asset");
    GithubScopeResult {
        asset_id: Some(cli.id.clone()),
        scope: if config.migration_pending {
            cli.cli.scope.clone()
        } else {
            config.scope()
        },
        env_states: cli.cli.env_states.clone(),
        config,
        owners,
    }
}

fn fresh_enough(config: &GithubConfig) -> bool {
    let now = crate::time::now_secs();
    !config.env_states.is_empty()
        && config.env_states.values().all(|snapshot| {
            crate::time::parse_rfc3339(&snapshot.checked_at).is_some_and(|at| at <= now && now - at < 30)
        })
}

fn complete(config: &GithubConfig) -> bool {
    config.owner.is_some()
        && config
            .env_states
            .values()
            .any(|snapshot| snapshot.status == GithubSnapshotStatus::Complete && snapshot.identity.is_some())
}

impl Backend {
    pub fn get_github_scope(&self, req: GithubScopeRequest) -> Result<GithubScopeResult> {
        let epoch = self.reset_epoch.load(Ordering::SeqCst);
        let _running = self.cli_run(CliProvider::Github);
        let Some(id) = req.asset_id.as_deref() else {
            return self.cli.github_scope(
                &self.cli_contexts()?,
                req.host.as_deref().unwrap_or("github.com"),
                req.owner_login.as_deref(),
            );
        };
        let previous_asset = self.database()?.require_asset(id)?;
        let previous = config_of(&previous_asset)?;
        if req
            .expected_revision
            .is_some_and(|revision| revision != previous.revision)
        {
            return Err(changed());
        }
        if !req.force.unwrap_or(false) && !previous.migration_pending && fresh_enough(&previous) {
            return Ok(result_for(
                &previous_asset,
                previous.clone(),
                previous.owner.into_iter().collect(),
            ));
        }
        if previous.migration_pending {
            // Owner-less historical records cannot be rebound to the old login by
            // assumption. Try verified stable-ID splits, otherwise offer known owners.
            if let Some(result) = self.resolve_legacy_github(&previous_asset, &previous, epoch)? {
                return Ok(result);
            }
            let fresh = self.cli.github_scope(&self.cli_contexts()?, &previous.host, None)?;
            let _edit = self.edit_at(epoch)?;
            let mut current = self.database()?.require_asset(id)?;
            if config_of(&current)?.revision != previous.revision {
                return Err(changed());
            }
            if let Asset::Cli(cli) = &mut current {
                cli.cli.env_states = fresh.env_states.clone();
            }
            self.database()?.upsert_asset(&current)?;
            self.publish_locked()?;
            let mut result = result_for(&current, previous, fresh.owners);
            result.env_states = fresh.env_states;
            return Ok(result);
        }
        let owner = previous.owner.as_ref().ok_or_else(changed)?;
        let fresh = self
            .cli
            .github_scope(&self.cli_contexts()?, &previous.host, Some(&owner.login))?;
        let next = merge_refresh(&previous, &fresh.config);
        let _edit = self.edit_at(epoch)?;
        let current = self.database()?.require_asset(id)?;
        if config_of(&current)?.revision != previous.revision {
            return Err(changed());
        }
        let mut stored = self.database()?.put_github_config(id, previous.revision, next)?;
        if let Asset::Cli(cli) = &mut stored {
            cli.cli.env_states = fresh.env_states;
        }
        self.database()?.upsert_asset(&stored)?;
        self.publish_locked()?;
        Ok(result_for(&stored, config_of(&stored)?, fresh.owners))
    }

    pub fn save_github_scope(&self, req: GithubScopeSaveRequest) -> Result<SaveResult> {
        let epoch = self.reset_epoch.load(Ordering::SeqCst);
        let previous_asset = self.database()?.require_asset(&req.asset_id)?;
        let previous = config_of(&previous_asset)?;
        if req.expected_revision != previous.revision {
            return Err(changed());
        }
        if !crate::cli::valid_github_ids(&req.selected_repo_ids)
            || !crate::cli::valid_github_ids(&req.excluded_repo_ids)
        {
            return Err(AppError::ipc(IpcErrorId::CliScopeFailed));
        }
        let selected: BTreeSet<_> = req.selected_repo_ids.iter().cloned().collect();
        let prior_ids = if previous.migration_pending {
            previous.selected_repo_ids.iter().cloned().collect()
        } else {
            previous.provided_ids()
        };
        let expands = req.mode == GithubScopeMode::Auto
            && (previous.mode != GithubScopeMode::Auto
                || previous
                    .excluded_repo_ids
                    .iter()
                    .any(|id| !req.excluded_repo_ids.contains(id)))
            || req.mode == GithubScopeMode::Manual && !selected.is_subset(&prior_ids)
            || previous.migration_pending && req.owner_login.is_some();
        let mut next = previous.clone();
        let mut states = previous_asset.as_cli().unwrap().cli.env_states.clone();
        if expands {
            let owner_login = previous
                .owner
                .as_ref()
                .map(|owner| owner.login.as_str())
                .or(req.owner_login.as_deref())
                .ok_or_else(|| {
                    AppError::ipc_with(
                        IpcErrorId::CliScopeFailed,
                        params! {"reason" => "owner-confirmation-required"},
                    )
                })?;
            let _running = self.cli_run(CliProvider::Github);
            let fresh = self
                .cli
                .github_scope(&self.cli_contexts()?, &previous.host, Some(owner_login))?;
            if !complete(&fresh.config) {
                return Err(AppError::ipc(IpcErrorId::CliScopePermission));
            }
            if previous
                .owner
                .as_ref()
                .is_some_and(|owner| fresh.config.owner.as_ref().is_none_or(|current| current.id != owner.id))
            {
                return Err(AppError::ipc_with(
                    IpcErrorId::CliScopeFailed,
                    params! {"reason" => "owner-changed"},
                ));
            }
            if previous.migration_pending {
                let known: BTreeSet<_> = fresh
                    .config
                    .env_states
                    .values()
                    .flat_map(|snapshot| snapshot.repos.iter().map(|repo| repo.id.clone()))
                    .collect();
                if previous.selected_repo_ids.iter().any(|id| !known.contains(id)) {
                    return Err(AppError::ipc_with(
                        IpcErrorId::CliScopeFailed,
                        params! {"reason" => "legacy-owner-split-required"},
                    ));
                }
                next.owner = fresh.config.owner.clone();
                next.migration_pending = false;
            }
            next = merge_refresh(&next, &fresh.config);
            states = fresh.env_states;
        }
        next.mode = req.mode;
        next.selected_repo_ids = req.selected_repo_ids;
        next.excluded_repo_ids = req.excluded_repo_ids;
        let available: BTreeSet<_> = next
            .env_states
            .values()
            .filter(|snapshot| snapshot.status == GithubSnapshotStatus::Complete)
            .flat_map(|snapshot| snapshot.repos.iter().map(|repo| repo.id.clone()))
            .chain(prior_ids)
            .collect();
        if next.mode == GithubScopeMode::Manual && next.selected_repo_ids.iter().any(|id| !available.contains(id)) {
            return Err(AppError::ipc(IpcErrorId::CliScopeFailed));
        }
        let selected_config = next.clone();
        for snapshot in next.env_states.values_mut() {
            for repo in &mut snapshot.repos {
                repo.selected = selected_config.includes(repo)
                    && (snapshot.status == GithubSnapshotStatus::Complete || repo.selected);
            }
        }
        let _edit = self.edit_at(epoch)?;
        let current = self.database()?.require_asset(&req.asset_id)?;
        if config_of(&current)?.revision != previous.revision {
            return Err(changed());
        }
        let mut stored = self
            .database()?
            .put_github_config(&req.asset_id, previous.revision, next)?;
        if let Asset::Cli(cli) = &mut stored {
            cli.cli.env_states = states;
        }
        self.database()?.upsert_asset(&stored)?;
        let statuses = self.publish_locked()?;
        self.save_result(stored, statuses)
    }

    /// Split only when every historical selected stable ID has been positively
    /// reobserved under a verified owner. Offline, transfer, rename ambiguity and
    /// existing-owner conflicts leave the original record untouched and pending.
    fn resolve_legacy_github(
        &self,
        asset: &Asset,
        previous: &GithubConfig,
        epoch: u64,
    ) -> Result<Option<GithubScopeResult>> {
        let cli = asset.as_cli().unwrap();
        let selected = cli.cli.scope.iter().filter(|repo| repo.selected).collect::<Vec<_>>();
        if selected.is_empty() {
            return Ok(None);
        }
        let logins: BTreeSet<_> = selected
            .iter()
            .filter_map(|repo| repo.name.split_once('/').map(|(login, _)| login.to_string()))
            .collect();
        if logins.is_empty() || logins.len() > 20 {
            return Ok(None);
        }
        let envs = self.cli_contexts()?;
        let mut replacements = Vec::new();
        for login in logins {
            let fresh = self.cli.github_scope(&envs, &previous.host, Some(&login))?;
            if !complete(&fresh.config) {
                return Ok(None);
            }
            let mut configuration = fresh.config.clone();
            configuration.mode = GithubScopeMode::Manual;
            configuration.selected_repo_ids = selected
                .iter()
                .filter(|repo| {
                    repo.name
                        .split_once('/')
                        .is_some_and(|(owner, _)| owner.eq_ignore_ascii_case(&login))
                })
                .map(|repo| repo.id.clone())
                .collect();
            let observed: BTreeSet<_> = configuration
                .env_states
                .values()
                .filter(|snapshot| snapshot.status == GithubSnapshotStatus::Complete)
                .flat_map(|snapshot| snapshot.repos.iter().map(|repo| repo.id.clone()))
                .collect();
            if configuration.selected_repo_ids.iter().any(|id| !observed.contains(id)) {
                return Ok(None);
            }
            configuration.revision = 1;
            configuration.migration_pending = false;
            let grants = configuration.clone();
            for snapshot in configuration.env_states.values_mut() {
                for repo in &mut snapshot.repos {
                    repo.selected = snapshot.status == GithubSnapshotStatus::Complete && grants.includes(repo);
                }
            }
            let mut replacement = cli.clone();
            replacement.account = configuration.owner.as_ref().map(|owner| owner.login.clone());
            replacement.cli.scope = configuration.scope();
            replacement.cli.env_states = fresh.env_states;
            replacement.github = Some(configuration);
            replacements.push(replacement);
        }
        replacements.sort_by_key(|replacement| replacement.account != cli.account);
        let _edit = self.edit_at(epoch)?;
        let current = self.database()?.require_asset(&cli.id)?;
        if config_of(&current)?.revision != previous.revision {
            return Err(changed());
        }
        let mut handles = self
            .list_assets()?
            .iter()
            .map(|asset| asset.handle().to_string())
            .collect::<BTreeSet<_>>();
        for (index, replacement) in replacements.iter_mut().enumerate() {
            // Late metadata must not revert a concurrent rename, mode or Agent choice.
            let mut latest = current.as_cli().unwrap().clone();
            latest.account = replacement.account.take();
            latest.github = replacement.github.take();
            latest.cli.scope = std::mem::take(&mut replacement.cli.scope);
            latest.cli.env_states = std::mem::take(&mut replacement.cli.env_states);
            *replacement = latest;
            let config = replacement.github.as_mut().unwrap();
            let owner = config.owner.as_ref().unwrap();
            if self
                .database()?
                .github_owner_taken(&config.host, &owner.id, Some(&cli.id))?
            {
                return Ok(None);
            }
            if index == 0 {
                config.revision = previous.revision.checked_add(1).ok_or_else(changed)?;
            } else {
                replacement.id = crate::new_id("ast");
                replacement.handle = (2..)
                    .map(|number| format!("github-{number}"))
                    .find(|handle| !handles.contains(handle))
                    .ok_or_else(|| AppError::internal("could not allocate GitHub handle"))?;
                handles.insert(replacement.handle.clone());
            }
        }
        let assets: Vec<_> = replacements.into_iter().map(Asset::Cli).collect();
        self.database()?
            .replace_legacy_github(&current, previous.revision, &assets)?;
        self.publish_locked()?;
        let first = assets.first().unwrap();
        Ok(Some(result_for(
            first,
            config_of(first)?,
            assets.iter().filter_map(|asset| config_of(asset).ok()?.owner).collect(),
        )))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::asset::RepoVisibility;
    use crate::model::env::EnvId;
    fn configuration() -> GithubConfig {
        let owner = GithubOwner {
            id: "O1".into(),
            login: "acme".into(),
            kind: GithubOwnerKind::Organization,
        };
        GithubConfig {
            host: "github.com".into(),
            owner: Some(owner.clone()),
            mode: GithubScopeMode::Auto,
            selected_repo_ids: Vec::new(),
            excluded_repo_ids: vec!["repo:B".into()],
            revision: 4,
            migration_pending: false,
            env_states: BTreeMap::from([(
                EnvId::windows(),
                GithubSnapshot {
                    status: GithubSnapshotStatus::Complete,
                    identity: Some(GithubIdentity {
                        id: "U1".into(),
                        login: "user".into(),
                        host: "github.com".into(),
                    }),
                    owner: Some(owner),
                    checked_at: "2026-11-01T00:00:00Z".into(),
                    reason_id: None,
                    repos: vec![
                        GithubRepo {
                            id: "repo:A".into(),
                            name: "acme/app".into(),
                            owner_id: "O1".into(),
                            database_id: None,
                            default_branch: Some("main".into()),
                            visibility: Some(RepoVisibility::Private),
                            selected: true,
                        },
                        GithubRepo {
                            id: "repo:B".into(),
                            name: "acme/excluded".into(),
                            owner_id: "O1".into(),
                            database_id: None,
                            default_branch: None,
                            visibility: None,
                            selected: false,
                        },
                    ],
                },
            )]),
        }
    }
    struct Metadata {
        status: std::sync::atomic::AtomicU8,
        calls: std::sync::atomic::AtomicUsize,
    }
    impl crate::cli::Runner for Metadata {
        fn run(&self, env: &crate::env::EnvContext, query: &crate::cli::Query) -> Result<crate::cli::QueryOutput> {
            use crate::cli::Query;
            let value = match query {
                Query::Discover { provider } => {
                    serde_json::json!({"installed":*provider==CliProvider::Github,"path":env.native_in_home(&["fixture-cli","gh.exe"])})
                }
                Query::Version { .. } => serde_json::json!({"version":"2.1.0"}),
                Query::Identity { .. } => serde_json::json!({"loggedIn":true,"login":"user"}),
                Query::Github { owner, .. } => {
                    self.calls.fetch_add(1, Ordering::SeqCst);
                    let status = if self.status.load(Ordering::SeqCst) == 0 {
                        "complete"
                    } else {
                        "partial"
                    };
                    serde_json::json!({"status":status,"owners":[{"id":"U1","login":"user","kind":"user"},{"id":"O1","login":"acme","kind":"organization"}],"identity":{"id":"U1","login":"user","host":"github.com"},"owner":{"id":"O1","login":owner.as_deref().unwrap_or("acme"),"kind":"organization"},"items":if status=="complete" {vec![serde_json::json!({"id":"repo:A","name":"acme/app","ownerId":"O1","defaultBranch":"main","visibility":"private"})]} else {Vec::new()},"reasonId":"rate-limited"})
                }
                _ => return Err(AppError::ipc(IpcErrorId::CliCommandUnsupported)),
            };
            Ok(crate::cli::QueryOutput::json(value))
        }
        fn open_terminal(&self, _env: &crate::env::EnvContext, _command: &str) -> Result<()> {
            panic!("no terminal in GitHub tests")
        }
    }
    struct Events;
    impl super::super::backend::EventSink for Events {
        fn emit(&self, _event: &str, _payload: serde_json::Value) {}
    }
    fn backend() -> (tempfile::TempDir, std::sync::Arc<Backend>, std::sync::Arc<Metadata>) {
        let temp = tempfile::tempdir().unwrap();
        let paths = crate::paths::Paths::isolated_in(temp.path());
        std::fs::create_dir_all(paths.user_home.join(".claude").join("skills")).unwrap();
        let runner = std::sync::Arc::new(Metadata {
            status: std::sync::atomic::AtomicU8::new(0),
            calls: std::sync::atomic::AtomicUsize::new(0),
        });
        let backend = Backend::with_services(
            paths,
            std::sync::Arc::new(crate::env::FakeSystem::default()),
            std::sync::Arc::new(crate::secret::store::MemoryCredentialStore::default()),
            crate::cli::Service::new(runner.clone()),
            std::sync::Arc::new(Events),
        )
        .unwrap();
        (temp, backend, runner)
    }
    #[test]
    fn backend_partial_scope_keeps_history_allows_narrowing_and_rejects_expansion_or_stale_revision() {
        let (_temp, backend, runner) = backend();
        let mut cli = crate::testkit::github();
        cli.github = Some(configuration());
        cli.account = Some("acme".into());
        cli.cli.scope = cli.github.as_ref().unwrap().scope();
        backend
            .database()
            .unwrap()
            .upsert_asset(&Asset::Cli(cli.clone()))
            .unwrap();
        runner.status.store(1, Ordering::SeqCst);
        let current = backend
            .get_github_scope(GithubScopeRequest {
                asset_id: Some(cli.id.clone()),
                owner_login: None,
                host: None,
                force: Some(true),
                expected_revision: Some(4),
            })
            .unwrap();
        assert!(current.scope.iter().any(|repo| repo.id == "repo:A" && repo.selected));
        assert_eq!(
            current.config.env_states[&EnvId::windows()].status,
            GithubSnapshotStatus::Partial
        );
        let narrowed = backend
            .save_github_scope(GithubScopeSaveRequest {
                asset_id: cli.id.clone(),
                expected_revision: current.config.revision,
                mode: GithubScopeMode::Manual,
                selected_repo_ids: Vec::new(),
                excluded_repo_ids: Vec::new(),
                owner_login: None,
            })
            .unwrap();
        assert!(
            narrowed
                .asset
                .as_cli()
                .unwrap()
                .cli
                .scope
                .iter()
                .all(|repo| !repo.selected)
        );
        assert!(
            backend
                .save_github_scope(GithubScopeSaveRequest {
                    asset_id: cli.id.clone(),
                    expected_revision: current.config.revision,
                    mode: GithubScopeMode::Auto,
                    selected_repo_ids: Vec::new(),
                    excluded_repo_ids: Vec::new(),
                    owner_login: None
                })
                .is_err()
        );
        let revision = narrowed.asset.as_cli().unwrap().github.as_ref().unwrap().revision;
        let error = backend
            .save_github_scope(GithubScopeSaveRequest {
                asset_id: cli.id,
                expected_revision: revision,
                mode: GithubScopeMode::Auto,
                selected_repo_ids: Vec::new(),
                excluded_repo_ids: Vec::new(),
                owner_login: None,
            })
            .unwrap_err();
        assert!(error.is_ipc(IpcErrorId::CliScopePermission));
    }
    #[test]
    fn server_profile_cannot_author_or_move_repository_evidence() {
        let (_temp, backend, _runner) = backend();
        let mut server = crate::testkit::hk_edge();
        server.paths[0].repo_source = Some(crate::model::asset::RepoSource {
            host: "github.com".into(),
            owner: "acme".into(),
            repo: "app".into(),
            repo_id: None,
        });
        backend
            .database()
            .unwrap()
            .upsert_asset(&Asset::Vps(server.clone()))
            .unwrap();
        let mut value = serde_json::to_value(&server).unwrap();
        value["paths"][0]["repoSource"] = serde_json::json!({"host":"github.com","owner":"other","repo":"forged"});
        let input: crate::model::asset::AssetInput = serde_json::from_value(value.clone()).unwrap();
        let built = backend.build_asset(input, false).unwrap();
        assert_eq!(
            built.as_server().unwrap().paths[0].repo_source,
            server.paths[0].repo_source
        );
        value["paths"][0]["path"] = "/srv/different".into();
        let input: crate::model::asset::AssetInput = serde_json::from_value(value).unwrap();
        assert!(
            backend.build_asset(input, false).unwrap().as_server().unwrap().paths[0]
                .repo_source
                .is_none()
        );
    }

    #[test]
    fn pending_legacy_scope_can_be_revoked_while_offline_without_owner_guessing() {
        let (_temp, backend, runner) = backend();
        let mut cli = crate::testkit::github();
        cli.github = Some(GithubConfig::legacy(&cli.cli.scope));
        backend
            .database()
            .unwrap()
            .upsert_asset(&Asset::Cli(cli.clone()))
            .unwrap();
        runner.status.store(1, Ordering::SeqCst);
        let saved = backend
            .save_github_scope(GithubScopeSaveRequest {
                asset_id: cli.id,
                expected_revision: 1,
                mode: GithubScopeMode::Manual,
                selected_repo_ids: Vec::new(),
                excluded_repo_ids: Vec::new(),
                owner_login: None,
            })
            .unwrap();
        assert_eq!(saved.asset.as_cli().unwrap().cli.scope.len(), 2);
        assert!(
            saved
                .asset
                .as_cli()
                .unwrap()
                .cli
                .scope
                .iter()
                .all(|repo| !repo.selected)
        );
        assert_eq!(runner.calls.load(Ordering::SeqCst), 0);
        assert!(saved.asset.as_cli().unwrap().github.as_ref().unwrap().owner.is_none());
    }

    #[test]
    fn failed_refresh_preserves_snapshot_and_cannot_expand() {
        for status in [
            GithubSnapshotStatus::Partial,
            GithubSnapshotStatus::Offline,
            GithubSnapshotStatus::Denied,
        ] {
            let previous = configuration();
            let mut fresh = previous.clone();
            let snapshot = fresh.env_states.get_mut(&EnvId::windows()).unwrap();
            snapshot.status = status;
            snapshot.repos.clear();
            let merged = merge_refresh(&previous, &fresh);
            assert_eq!(
                merged.env_states[&EnvId::windows()].repos,
                previous.env_states[&EnvId::windows()].repos
            );
            assert_eq!(merged.provided_ids(), BTreeSet::from(["repo:A".into()]));
        }
    }
    #[test]
    fn complete_auto_refresh_keeps_stable_exclusion_and_drops_verified_absence() {
        let previous = configuration();
        let mut fresh = configuration();
        let repos = &mut fresh.env_states.get_mut(&EnvId::windows()).unwrap().repos;
        repos.remove(0);
        repos[0].name = "acme/renamed".into();
        repos.push(GithubRepo {
            id: "repo:C".into(),
            name: "acme/new-private".into(),
            owner_id: "O1".into(),
            database_id: None,
            default_branch: None,
            visibility: Some(RepoVisibility::Private),
            selected: false,
        });
        let merged = merge_refresh(&previous, &fresh);
        assert_eq!(merged.provided_ids(), BTreeSet::from(["repo:C".into()]));
        assert!(!merged.scope().iter().any(|repo| repo.id == "repo:A"));
    }
    #[test]
    fn identity_owner_mismatch_is_not_a_complete_update() {
        let previous = configuration();
        let mut fresh = configuration();
        fresh
            .env_states
            .get_mut(&EnvId::windows())
            .unwrap()
            .owner
            .as_mut()
            .unwrap()
            .id = "O2".into();
        let merged = merge_refresh(&previous, &fresh);
        assert_eq!(
            merged.env_states[&EnvId::windows()].status,
            GithubSnapshotStatus::Denied
        );
        assert_eq!(merged.provided_ids(), previous.provided_ids());
    }
}
