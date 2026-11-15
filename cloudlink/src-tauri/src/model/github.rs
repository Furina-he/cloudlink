//! GitHub ownership is not authentication. Stable IDs preserve exclusions across renames.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::asset::{CliEnvState, CliScopeItem, CliScopeKind, RepoVisibility};
use super::env::EnvId;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "github.ts")]
pub enum GithubOwnerKind {
    User,
    Organization,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export, export_to = "github.ts")]
pub struct GithubOwner {
    pub id: String,
    pub login: String,
    pub kind: GithubOwnerKind,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export, export_to = "github.ts")]
pub struct GithubIdentity {
    pub id: String,
    pub login: String,
    pub host: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "github.ts")]
pub enum GithubScopeMode {
    Auto,
    Manual,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "github.ts")]
pub enum GithubSnapshotStatus {
    Complete,
    Partial,
    Offline,
    Denied,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export, export_to = "github.ts")]
pub struct GithubRepo {
    pub id: String,
    pub name: String,
    pub owner_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub database_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub default_branch: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub visibility: Option<RepoVisibility>,
    pub selected: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "github.ts")]
pub struct GithubSnapshot {
    pub status: GithubSnapshotStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub identity: Option<GithubIdentity>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub owner: Option<GithubOwner>,
    pub repos: Vec<GithubRepo>,
    pub checked_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub reason_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "github.ts")]
pub struct GithubConfig {
    pub host: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub owner: Option<GithubOwner>,
    pub mode: GithubScopeMode,
    pub selected_repo_ids: Vec<String>,
    pub excluded_repo_ids: Vec<String>,
    pub revision: u64,
    #[ts(type = "Partial<Record<import('./env').EnvId, GithubSnapshot>>")]
    pub env_states: BTreeMap<EnvId, GithubSnapshot>,
    pub migration_pending: bool,
}

impl GithubConfig {
    /// Historical selections do not establish a stable owner. Never infer an identity
    /// from a repository name or silently extend a multi-owner legacy grant.
    pub fn legacy(scope: &[CliScopeItem]) -> Self {
        Self {
            host: "github.com".into(),
            owner: None,
            mode: GithubScopeMode::Manual,
            selected_repo_ids: scope.iter().filter(|r| r.selected).map(|r| r.id.clone()).collect(),
            excluded_repo_ids: Vec::new(),
            revision: 1,
            env_states: BTreeMap::new(),
            migration_pending: true,
        }
    }

    pub fn includes(&self, repo: &GithubRepo) -> bool {
        self.owner.as_ref().is_some_and(|owner| repo.owner_id == owner.id)
            && match self.mode {
                GithubScopeMode::Auto => !self.excluded_repo_ids.contains(&repo.id),
                GithubScopeMode::Manual => self.selected_repo_ids.contains(&repo.id),
            }
    }

    pub fn canonicalize(&mut self) {
        self.selected_repo_ids.sort();
        self.excluded_repo_ids.sort();
        for snapshot in self.env_states.values_mut() {
            snapshot.repos.sort_by(|left, right| left.id.cmp(&right.id));
        }
    }

    /// Diagnostics/check timestamps are not a changed grant and must not expire an
    /// already-approved identical request. Actual identity/target/scope changes do.
    pub fn same_authority(&self, other: &Self) -> bool {
        let authority = |config: &Self| {
            let mut config = config.clone();
            config.revision = 0;
            config.canonicalize();
            for snapshot in config.env_states.values_mut() {
                snapshot.checked_at.clear();
                snapshot.reason_id = None;
            }
            config
        };
        authority(self) == authority(other)
    }

    pub fn scope(&self) -> Vec<CliScopeItem> {
        let mut repos = BTreeMap::new();
        for snapshot in self.env_states.values() {
            for repo in &snapshot.repos {
                if self.owner.as_ref().is_some_and(|owner| owner.id == repo.owner_id) {
                    repos.entry(repo.id.clone()).or_insert(repo);
                }
            }
        }
        repos
            .into_values()
            .map(|repo| CliScopeItem {
                id: repo.id.clone(),
                kind: CliScopeKind::Repo,
                name: repo.name.clone(),
                selected: repo.selected && self.includes(repo),
                linked_asset_id: None,
                address: None,
                default_branch: repo.default_branch.clone(),
                visibility: repo.visibility,
                repo_source: None,
            })
            .collect()
    }

    pub fn provided_ids(&self) -> BTreeSet<String> {
        self.scope()
            .into_iter()
            .filter(|repo| repo.selected)
            .map(|repo| repo.id)
            .collect()
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export, export_to = "github.ts")]
pub struct GithubCreateInput {
    pub host: String,
    pub owner_login: String,
    pub mode: GithubScopeMode,
    pub selected_repo_ids: Vec<String>,
    pub excluded_repo_ids: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export, export_to = "github.ts")]
pub struct GithubScopeRequest {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub asset_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub owner_login: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub host: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub force: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub expected_revision: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "github.ts")]
pub struct GithubScopeResult {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub asset_id: Option<String>,
    pub config: GithubConfig,
    pub owners: Vec<GithubOwner>,
    pub scope: Vec<CliScopeItem>,
    #[ts(type = "Partial<Record<import('./env').EnvId, import('./asset').CliEnvState>>")]
    pub env_states: BTreeMap<EnvId, CliEnvState>,
}

#[derive(Debug, Clone, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export, export_to = "github.ts")]
pub struct GithubScopeSaveRequest {
    pub asset_id: String,
    pub expected_revision: u64,
    pub mode: GithubScopeMode,
    pub selected_repo_ids: Vec<String>,
    pub excluded_repo_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub owner_login: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn repo(id: &str, owner: &str, selected: bool) -> GithubRepo {
        GithubRepo {
            id: id.into(),
            name: "owner/repo".into(),
            owner_id: owner.into(),
            database_id: None,
            default_branch: Some("main".into()),
            visibility: Some(RepoVisibility::Private),
            selected,
        }
    }

    #[test]
    fn stable_exclusion_survives_rename_and_owner_transfer_is_not_included() {
        let mut config = GithubConfig::legacy(&[]);
        config.owner = Some(GithubOwner {
            id: "O1".into(),
            login: "owner".into(),
            kind: GithubOwnerKind::Organization,
        });
        config.mode = GithubScopeMode::Auto;
        config.excluded_repo_ids = vec!["repo:R1".into()];
        let mut renamed = repo("repo:R1", "O1", true);
        renamed.name = "owner/renamed".into();
        assert!(!config.includes(&renamed));
        assert!(!config.includes(&repo("repo:R2", "O2", true)));
        assert!(config.includes(&repo("repo:R3", "O1", true)));
    }
}
