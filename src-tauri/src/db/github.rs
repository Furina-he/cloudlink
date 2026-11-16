//! P8c migration preserves the exact old hand-selected scope. A name is not a stable owner ID.

use super::*;
use crate::model::asset::CliProvider;
use crate::model::github::GithubConfig;

pub(super) const MIGRATION: &str = r#"
UPDATE assets SET json = json_set(json, '$.github', json_object(
    'host', 'github.com', 'mode', 'manual',
    'selectedRepoIds', json(COALESCE((SELECT json_group_array(json_extract(repo.value, '$.id'))
        FROM json_each(assets.json, '$.cli.scope') AS repo WHERE json_extract(repo.value, '$.selected') = 1), '[]')),
    'excludedRepoIds', json('[]'), 'revision', 1, 'envStates', json('{}'), 'migrationPending', json('true')))
WHERE type = 'cli' AND json_extract(json, '$.cliProvider') = 'github'
    AND json_type(json, '$.github') IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS assets_github_owner ON assets (
    lower(json_extract(json, '$.github.host')), json_extract(json, '$.github.owner.id'))
WHERE json_extract(json, '$.cliProvider') = 'github' AND json_extract(json, '$.github.owner.id') IS NOT NULL;
"#;

impl Db {
    pub fn github_owner_taken(&self, host: &str, owner_id: &str, except_id: Option<&str>) -> Result<bool> {
        let count: i64 = self.conn.query_row(
            "SELECT count(*) FROM assets WHERE json_extract(json, '$.cliProvider') = 'github'
             AND lower(json_extract(json, '$.github.host')) = lower(?1)
             AND json_extract(json, '$.github.owner.id') = ?2 AND id != ?3",
            params![host, owner_id, except_id.unwrap_or("")],
            |row| row.get(0),
        )?;
        Ok(count > 0)
    }

    /// Atomically replaces a verified legacy multi-owner record. The caller has
    /// positively matched every old selected stable ID; this transaction cannot expand it.
    pub fn replace_legacy_github(&self, current: &Asset, expected_revision: u64, replacements: &[Asset]) -> Result<()> {
        let tx = self.conn.unchecked_transaction()?;
        let saved = self.require_asset(current.id())?;
        let old_cli = saved.as_cli().ok_or_else(|| AppError::ipc(IpcErrorId::NotFound))?;
        let old = old_cli
            .github
            .clone()
            .unwrap_or_else(|| GithubConfig::legacy(&old_cli.cli.scope));
        let old_ids = old_cli
            .cli
            .scope
            .iter()
            .filter(|repo| repo.selected)
            .map(|repo| repo.id.clone())
            .collect::<std::collections::BTreeSet<_>>();
        let next_ids = replacements
            .iter()
            .filter_map(Asset::as_cli)
            .flat_map(|cli| {
                cli.cli
                    .scope
                    .iter()
                    .filter(|repo| repo.selected)
                    .map(|repo| repo.id.clone())
            })
            .collect::<std::collections::BTreeSet<_>>();
        if saved != *current
            || !old.migration_pending
            || old.revision != expected_revision
            || old_ids != next_ids
            || replacements.first().is_none_or(|first| first.id() != current.id())
        {
            return Err(AppError::ipc_with(
                IpcErrorId::CliScopeFailed,
                p! {"reason" => "revision-changed"},
            ));
        }
        for replacement in replacements {
            self.upsert_asset(replacement)?;
        }
        tx.commit()?;
        Ok(())
    }

    /// The caller holds the resource mutation lock and publishes the returned current asset.
    pub fn put_github_config(&self, asset_id: &str, expected_revision: u64, mut config: GithubConfig) -> Result<Asset> {
        let mut asset = self.require_asset(asset_id)?;
        let Asset::Cli(cli) = &mut asset else {
            return Err(AppError::ipc(IpcErrorId::NotFound));
        };
        if cli.cli_provider != CliProvider::Github {
            return Err(AppError::ipc(IpcErrorId::NotFound));
        }
        let old = cli
            .github
            .clone()
            .unwrap_or_else(|| GithubConfig::legacy(&cli.cli.scope));
        if old.revision != expected_revision {
            return Err(AppError::ipc_with(
                IpcErrorId::CliScopeFailed,
                p! {"reason" => "revision-changed"},
            ));
        }
        config.canonicalize();
        config.revision = if old.same_authority(&config) {
            expected_revision
        } else {
            expected_revision
                .checked_add(1)
                .ok_or_else(|| AppError::ipc(IpcErrorId::CliScopeFailed))?
        };
        if let Some(owner) = &config.owner
            && self.github_owner_taken(&config.host, &owner.id, Some(asset_id))?
        {
            return Err(AppError::ipc(IpcErrorId::AliasTaken));
        }
        if config.migration_pending {
            for repo in &mut cli.cli.scope {
                repo.selected = config.selected_repo_ids.contains(&repo.id);
            }
        } else {
            cli.cli.scope = config.scope();
        }
        cli.account = config
            .owner
            .as_ref()
            .map(|owner| owner.login.clone())
            .or_else(|| cli.account.clone());
        cli.github = Some(config);
        cli.updated_at = crate::time::now_rfc3339();
        self.upsert_asset(&asset)?;
        Ok(asset)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::github::{GithubOwner, GithubOwnerKind, GithubScopeMode};

    #[test]
    fn legacy_multi_owner_selection_stays_manual_unbound_and_keeps_all_selected_ids() {
        let mut db = Db::open_in_memory().unwrap();
        // Exercise the migration against v5 bytes, not a fabricated post-migration struct.
        db.conn
            .execute_batch(
                "DROP INDEX assets_github_owner; DELETE FROM schema_version; INSERT INTO schema_version VALUES(5);",
            )
            .unwrap();
        let json = serde_json::json!({"type":"cli", "id":"ast_old", "handle":"github", "createdAt":"2026-11-01",
            "name":"GitHub", "production":true, "summary":"", "notes":"", "updatedAt":"2026-11-01",
            "cliProvider":"github", "account":"user", "agent":{"agents":["claude-code"],"mode":"standard"},
            "guardrails":{"rules":[]}, "cli":{"binary":"gh","envStates":{},"scope":[
                {"id":"repo:A","kind":"repo","name":"user/a","selected":true},
                {"id":"repo:B","kind":"repo","name":"org/b","selected":true},
                {"id":"repo:C","kind":"repo","name":"org/c","selected":false}]}});
        db.conn
            .execute(
                "INSERT INTO assets VALUES (?1, 'cli', 'github', '2026-11-01', ?2)",
                params!["ast_old", json.to_string()],
            )
            .unwrap();
        db.migrate().unwrap();
        let migrated = db.require_asset("ast_old").unwrap();
        let cli = migrated.as_cli().unwrap();
        let github = cli.github.as_ref().unwrap();
        assert_eq!(github.mode, GithubScopeMode::Manual);
        assert!(github.owner.is_none() && github.migration_pending);
        assert_eq!(github.selected_repo_ids, ["repo:A", "repo:B"]);
        assert_eq!(cli.cli.scope.len(), 3);
        assert_eq!(cli.agent.mode, crate::model::asset::Mode::AutoOps);
        assert_eq!(cli.agent.agents, ["claude-code"]);
    }

    #[test]
    fn identical_refresh_timestamps_do_not_advance_the_authority_revision() {
        let db = Db::open_in_memory().unwrap();
        let mut cli = crate::testkit::github();
        let mut config:GithubConfig=serde_json::from_value(serde_json::json!({"host":"github.com","owner":{"id":"U1","login":"octo","kind":"user"},"mode":"manual","selectedRepoIds":["repo:R_shop"],"excludedRepoIds":[],"revision":3,"migrationPending":false,
            "envStates":{"windows":{"status":"complete","identity":{"id":"U1","login":"octo","host":"github.com"},"owner":{"id":"U1","login":"octo","kind":"user"},"repos":[{"id":"repo:R_shop","name":"octo/shop-web","ownerId":"U1","defaultBranch":"main","visibility":"private","selected":true}],"checkedAt":"2026-11-15T00:00:00Z"}}})).unwrap();
        cli.cli.scope = config.scope();
        cli.github = Some(config.clone());
        db.upsert_asset(&Asset::Cli(cli.clone())).unwrap();
        config.env_states.values_mut().next().unwrap().checked_at = "2026-11-15T00:01:00Z".into();
        let unchanged = db.put_github_config(&cli.id, 3, config.clone()).unwrap();
        assert_eq!(unchanged.as_cli().unwrap().github.as_ref().unwrap().revision, 3);
        config
            .env_states
            .values_mut()
            .next()
            .unwrap()
            .identity
            .as_mut()
            .unwrap()
            .id = "U2".into();
        let changed = db.put_github_config(&cli.id, 3, config).unwrap();
        assert_eq!(changed.as_cli().unwrap().github.as_ref().unwrap().revision, 4);
    }

    #[test]
    fn pending_owner_can_narrow_without_losing_the_historical_catalog() {
        let db = Db::open_in_memory().unwrap();
        let mut cli = crate::testkit::github();
        cli.cli.scope[1].selected = true;
        let mut config = GithubConfig::legacy(&cli.cli.scope);
        cli.github = Some(config.clone());
        db.upsert_asset(&Asset::Cli(cli.clone())).unwrap();
        config.selected_repo_ids = vec!["repo:R_shop".into()];
        let stored = db.put_github_config(&cli.id, 1, config).unwrap();
        let after = stored.as_cli().unwrap();
        assert_eq!(after.cli.scope.len(), 2);
        assert!(after.cli.scope[0].selected && !after.cli.scope[1].selected);
        assert!(after.github.as_ref().unwrap().migration_pending);
    }

    #[test]
    fn github_owner_uniqueness_and_revision_are_checked() {
        let db = Db::open_in_memory().unwrap();
        let mut cli = crate::testkit::cloudflare();
        cli.cli_provider = CliProvider::Github;
        cli.handle = "github".into();
        cli.cli.binary = crate::model::asset::CliBinary::Gh;
        cli.github = Some(GithubConfig::legacy(&[]));
        db.upsert_asset(&Asset::Cli(cli.clone())).unwrap();
        let mut config = cli.github.unwrap();
        config.owner = Some(GithubOwner {
            id: "O1".into(),
            login: "org".into(),
            kind: GithubOwnerKind::Organization,
        });
        config.migration_pending = false;
        let asset = db.put_github_config(&cli.id, 1, config.clone()).unwrap();
        assert_eq!(asset.as_cli().unwrap().github.as_ref().unwrap().revision, 2);
        assert!(db.put_github_config(&cli.id, 1, config).is_err());
        assert!(db.github_owner_taken("GITHUB.COM", "O1", None).unwrap());
        assert!(!db.github_owner_taken("github.com", "O1", Some(&cli.id)).unwrap());
    }
}
