//! Coordinates compile and delivery without allowing a blocked old artifact to restore a revoked grant.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

use super::Backend;
use crate::compile::publish::{self, Marker};
use crate::compile::{self, CompileInput};
use crate::deliver;
use crate::error::Result;
use crate::model::Detail;
use crate::model::asset::{Asset, ConnectionSource, ExportFlags};
use crate::model::compile::{CompileStatus, LintId, LintItem, LintLevel};
use crate::model::delivery::{Delivery, DeliveryStatus, Inclusion, InclusionReasonId, Target};
use crate::model::env::EnvId;
use crate::model::misc::{ActivityKind, ActivityMessageId};
use crate::params;
use crate::ssh;

#[derive(Serialize, Deserialize)]
struct Authority {
    content_hash: String,
    grants: BTreeMap<String, Grant>,
}

#[derive(PartialEq, Serialize, Deserialize)]
struct Grant {
    identity: String,
    export: Option<ExportFlags>,
    scope: BTreeSet<String>,
}

fn grant(asset: &Asset, env_id: &EnvId) -> Grant {
    let (identity, export, scope) = match asset {
        Asset::Vps(server) => {
            let c = &server.connection;
            let identity = serde_json::json!([
                c.source,
                c.ssh_alias,
                c.host,
                c.port,
                c.user,
                c.proxy_jump,
                c.auth.as_ref().map(|a| a.method),
                c.auth.as_ref().and_then(|a| a.identity_file.get(env_id)),
                server.agent.mode,
                server.guardrails,
                server
                    .services
                    .iter()
                    .filter(|s| s.critical)
                    .map(|s| (s.kind, &s.name))
                    .collect::<Vec<_>>()
            ]);
            (identity, Some(server.export.clone()), BTreeSet::new())
        }
        Asset::Cli(cli) => (
            serde_json::json!([
                cli.cli_provider,
                cli.handle,
                cli.account,
                cli.agent.mode,
                cli.guardrails
            ]),
            None,
            cli.cli
                .scope
                .iter()
                .filter(|s| s.selected)
                .map(|s| s.id.clone())
                .collect(),
        ),
    };
    Grant {
        identity: publish::tree_hash([("identity", identity.to_string().as_bytes())]),
        export,
        scope,
    }
}

fn still_granted(old: &Grant, current: &Grant) -> bool {
    old.identity == current.identity
        && old.scope.is_subset(&current.scope)
        && match (&old.export, &current.export) {
            (Some(old), Some(current)) => {
                (!old.resolved_connection || current.resolved_connection)
                    && (!old.listening_ports || current.listening_ports)
                    && (!old.image || current.image)
            }
            (None, None) => true,
            _ => false,
        }
}

fn included_ids(items: &[Inclusion], env_id: &EnvId, agent_key: &str) -> BTreeSet<String> {
    items
        .iter()
        .filter(|i| i.included && &i.env_id == env_id && i.agent_key == agent_key)
        .map(|i| i.asset_id.clone())
        .collect()
}

fn failure(target: &Target, now: &str, detail: &str) -> Delivery {
    Delivery {
        id: format!("dlv_{}", target.id),
        target_id: target.id.clone(),
        env_id: target.env_id.clone(),
        path: format!("{}/{}", target.path.trim_end_matches(['/', '\\']), publish::SKILL_DIR),
        status: DeliveryStatus::Outdated,
        status_detail: Some(Detail::new(detail.into())),
        checked_at: now.into(),
    }
}

impl Backend {
    /// In health mode, unchanged authorizations are inspected so missing/modified copies remain visible.
    /// Caller holds the mutation mutex; vault and remote authentication are never called here.
    pub(super) fn reconcile_locked(&self, health: bool) -> Result<Vec<CompileStatus>> {
        let mut assets = self.list_assets()?;
        let envs = self.contexts(true)?;
        for asset in &mut assets {
            if let Asset::Vps(server) = asset
                && server.connection.source == ConnectionSource::Imported
            {
                let defined = ssh::defined_in(&envs, &server.connection.ssh_alias);
                if server.connection.defined_in != defined {
                    server.connection.defined_in = defined;
                    self.database()?.upsert_asset(asset)?;
                }
            }
        }
        if crate::notes::prepare(&self.paths, &assets).is_err() {
            // Notes are auxiliary. Their own read command reports the error without preventing startup.
            log::warn!("CloudLink note inbox could not be prepared");
        }
        // Policy follows saved modes and scopes even when a secret blocks Skill compilation.
        // Health checks still load so a damaged policy can be shown as a broken guard.
        let policy_error = crate::guard::write_policy(&self.paths, &assets).err();
        if policy_error.is_some() {
            self.emit_guard_status()?;
            log::warn!("CloudLink guard policy could not be updated");
        }
        let targets = self.list_targets()?;
        let previous_inclusions = self.list_inclusions()?;
        let mut inclusions = deliver::compute_inclusions(&assets, &envs, &targets);
        // An exact generated file is necessary, but the user's other configuration can still override it.
        if !cfg!(test) {
            let tools = self.tools()?;
            let mut mismatches = BTreeMap::new();
            for asset in &assets {
                for env in envs
                    .iter()
                    .filter(|e| e.available && (!self.paths.isolated || e.is_windows()))
                {
                    if let Some(host) = ssh::managed::ManagedHost::from_asset(asset, env) {
                        let fields = ssh::readback_mismatches(&tools, env, &host);
                        if !fields.is_empty() {
                            mismatches.insert((asset.id().to_string(), env.id.clone()), fields.join(", "));
                        }
                    }
                }
            }
            for item in &mut inclusions {
                if item.included
                    && let Some(fields) = mismatches.get(&(item.asset_id.clone(), item.env_id.clone()))
                {
                    item.included = false;
                    item.reason = Some(Detail::with(
                        InclusionReasonId::NotWritten,
                        params! {"env" => item.env_id.as_str(), "fields" => fields.clone()},
                    ));
                }
            }
        }
        self.database()?.replace_inclusions(&inclusions)?;
        let config = self.get_skill_config()?;
        let settings = self.get_settings()?;
        let previous = self.get_compile_status()?;
        let now = crate::time::now_rfc3339();
        let units: BTreeSet<_> = targets
            .iter()
            .filter(|t| t.enabled)
            .map(|t| (t.env_id.clone(), t.agent_key.clone()))
            .collect();
        let mut statuses = Vec::new();
        let mut sources = BTreeMap::new();
        let mut hashes = BTreeMap::new();
        let mut withdraw = BTreeSet::new();
        let mut changed = BTreeSet::new();
        let mut notify_compile = !health;
        for (env_id, agent_key) in units {
            let Some(env) = envs.iter().find(|e| e.id == env_id && e.available) else {
                continue;
            };
            let ids = included_ids(&inclusions, &env_id, &agent_key);
            let included: Vec<_> = assets.iter().filter(|a| ids.contains(a.id())).collect();
            let grants = included
                .iter()
                .map(|a| (a.id().to_string(), grant(a, &env_id)))
                .collect::<BTreeMap<_, _>>();
            let prior_authority = self
                .database()?
                .publication_authority(&env_id, &agent_key)?
                .and_then(|v| serde_json::from_value::<Authority>(v).ok());
            let key = (env_id.clone(), agent_key.clone());
            if ids != included_ids(&previous_inclusions, &env_id, &agent_key)
                || prior_authority.as_ref().is_none_or(|a| a.grants != grants)
            {
                changed.insert(key.clone());
            }
            let old_source = deliver::load_source(&self.paths, &env_id, &agent_key).ok().flatten();
            let retains_grants = prior_authority.as_ref().is_some_and(|prior| {
                old_source
                    .as_ref()
                    .is_some_and(|(marker, _)| marker.content_hash == prior.content_hash)
                    && prior
                        .grants
                        .iter()
                        .all(|(id, old)| grants.get(id).is_some_and(|current| still_granted(old, current)))
            });
            if old_source.is_some() && !retains_grants {
                withdraw.insert(key.clone());
            }
            let old = previous.iter().find(|s| s.env_id == env_id && s.agent_key == agent_key);
            let inbox = env.windows_path_to_native(&self.paths.inbox_dir());
            let mut preview = compile::compile(&CompileInput {
                env_id: &env_id,
                agent_key: &agent_key,
                assets: &included,
                all_assets: &assets,
                config: &config,
                inbox: &inbox,
                body_line_limit: settings.body_line_limit,
                write_snapshot_time: settings.write_snapshot_time,
                now_secs: crate::time::now_secs(),
            });
            let rendered_hash = publish::files_hash(&preview.files);
            let same_source = old_source
                .as_ref()
                .is_some_and(|(marker, _)| marker.content_hash == rendered_hash)
                || (preview.files.is_empty()
                    && prior_authority
                        .as_ref()
                        .is_some_and(|a| a.content_hash == rendered_hash));
            let source_changed = !same_source;
            if !preview.blocked {
                let content_hash = publish::files_hash(&preview.files);
                let marker = Marker {
                    managed_by: publish::MANAGED_BY.into(),
                    env_id: env_id.to_string(),
                    agent_key: agent_key.clone(),
                    content_hash: content_hash.clone(),
                    compiled_at: now.clone(),
                    template_version: 1,
                };
                let published = if same_source {
                    Ok(())
                } else {
                    publish::publish(&self.paths.compiled_dir(), &marker, &preview.files).map(|_| ())
                };
                if published.is_err() {
                    preview.blocked = true;
                    preview.lint.push(LintItem {
                        id: LintId::PublishFailed,
                        level: LintLevel::Error,
                        asset_id: None,
                        params: Some(params! {"env" => env_id.as_str(), "target" => agent_key.clone()}),
                        file: None,
                        line: None,
                    });
                } else {
                    self.database()?.put_publication_authority(
                        &env_id,
                        &agent_key,
                        &serde_json::to_value(Authority {
                            content_hash: content_hash.clone(),
                            grants,
                        })?,
                    )?;
                    hashes.insert(key.clone(), content_hash);
                    sources.insert(key.clone(), (marker, preview.files.clone()));
                }
            }
            if preview.blocked {
                if !retains_grants {
                    withdraw.insert(key.clone());
                }
                if let Some((marker, _)) = old_source {
                    hashes.insert(key.clone(), marker.content_hash);
                }
                // No old source is entered into `sources`: blocked units can never sync or create a copy.
            }
            let mut status = compile::to_status(&preview, old, &now);
            if !preview.blocked && !source_changed {
                status.compiled_at = old.and_then(|s| s.compiled_at.clone());
            }
            if !health
                || changed.contains(&key)
                || old.is_none_or(|old| old.blocked != status.blocked || old.lint != status.lint)
            {
                notify_compile = true;
                self.activity(ActivityKind::Compile,
                    if status.blocked { ActivityMessageId::CompileBlocked } else { ActivityMessageId::CompileOk }, None,
                    params! {"env" => env_id.as_str(), "target" => agent_key.clone(), "count" => if status.blocked { status.errors as usize } else { included.len() }}, !status.blocked)?;
            }
            notify_compile |= !preview.blocked && source_changed;
            statuses.push(status);
        }
        self.database()?.put_compile_statuses(&statuses)?;
        if notify_compile {
            self.emit("compile://finished", &serde_json::json!({ "statuses": statuses }));
        }
        let all_envs = self.contexts(false)?;
        for target in &targets {
            if !target.enabled || !envs.iter().any(|e| e.id == target.env_id) {
                self.database()?.delete_delivery(&format!("dlv_{}", target.id))?;
                continue;
            }
            let Some(env) = all_envs.iter().find(|e| e.id == target.env_id) else {
                continue;
            };
            let key = (target.env_id.clone(), target.agent_key.clone());
            let hash = hashes.get(&key).map(String::as_str);
            let outcome = if withdraw.contains(&key) {
                deliver::remove(&self.paths, env, target).and_then(|_| {
                    if let Some((marker, files)) = sources.get(&key) {
                        deliver::sync(&self.paths, env, target, files, marker, false)
                    } else {
                        deliver::inspect(&self.paths, env, target, hash)
                    }
                })
            } else if (!health || changed.contains(&key))
                && let Some((marker, files)) = sources.get(&key)
            {
                deliver::sync(&self.paths, env, target, files, marker, false)
            } else {
                deliver::inspect(&self.paths, env, target, hash)
            };
            let delivery = outcome.unwrap_or_else(|_| {
                failure(
                    target,
                    &now,
                    if withdraw.contains(&key) {
                        "withdraw-failed"
                    } else {
                        "sync-failed"
                    },
                )
            });
            if sources.get(&key).is_some_and(|(_, files)| files.is_empty())
                && delivery.status == DeliveryStatus::Missing
            {
                self.database()?.delete_delivery(&delivery.id)?;
            } else {
                self.database()?.upsert_delivery(&delivery)?;
            }
        }
        self.emit_deliveries()?;
        self.database()?
            .prune_before(&crate::time::format_rfc3339(crate::time::now_secs() - 30 * 86_400))?;
        self.emit_guard_status()?;
        // A policy failure must never stop already-committed authorization withdrawals.
        // Return the error only after the remaining publication/delivery work has converged.
        if !health && let Some(error) = policy_error {
            return Err(error);
        }
        Ok(statuses)
    }
}
