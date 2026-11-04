use std::collections::BTreeSet;

use serde_json::{Value, json};

use crate::error::Result;
use crate::model::asset::Asset;
use crate::paths::Paths;

use super::owned;

/// The guard protects known resources independently of Skill publication. An
/// unrelated lint failure must never leave an older, more permissive mode or
/// cloud Scope in policy.json. No credentials or private-key paths are copied.
pub fn project_policy(assets: &[Asset]) -> Value {
    let resources: Vec<Value> = assets
        .iter()
        .map(|asset| match asset {
            Asset::Vps(server) => {
                let hosts: BTreeSet<&str> = std::iter::once(server.connection.ssh_alias.as_str())
                    .chain(server.connection.host.as_deref())
                    .chain(
                        server
                            .connection
                            .resolved
                            .as_ref()
                            .map(|resolved| resolved.hostname.as_str()),
                    )
                    .filter(|host| !host.is_empty())
                    .collect();
                json!({
                    "id": server.id,
                    "kind": "vps",
                    "handle": server.connection.ssh_alias,
                    "mode": server.agent.mode,
                    "envIds": server.connection.defined_in,
                    "agentKeys": server.agent.agents,
                    "hosts": hosts,
                    "criticalServices": server.services.iter().filter(|service| service.critical)
                        .map(|service| service.name.as_str()).collect::<Vec<_>>()
                })
            }
            Asset::Cli(cli) => json!({
                "id": cli.id,
                "kind": "cli",
                "handle": cli.handle,
                "mode": cli.agent.mode,
                "envIds": cli.cli.env_states.keys().collect::<Vec<_>>(),
                "agentKeys": cli.agent.agents,
                "provider": cli.cli_provider,
                "account": cli.account,
                "scope": cli.cli.scope.iter().filter(|scope| scope.selected).map(|scope| json!({
                    "id": scope.id, "kind": scope.kind, "name": scope.name
                })).collect::<Vec<_>>()
            }),
        })
        .collect();
    json!({ "managedBy": "cloudlink", "kind": "guard-policy", "version": 1, "resources": resources })
}

pub fn write_policy(paths: &Paths, assets: &[Asset]) -> Result<()> {
    owned::require_data(paths)?;
    let directory = paths.data_dir.join("guard");
    owned::ensure_dir(&directory, "guard")?;
    let marker_path = directory.join(".cloudlink.json");
    let marker_bytes = owned::read(&marker_path, owned::MAX_SETTINGS)?.ok_or_else(owned::invalid)?;
    let mut marker: Value = serde_json::from_slice(&marker_bytes).map_err(|_| owned::invalid())?;
    let path = directory.join("policy.json");
    let before = owned::read(&path, owned::MAX_SETTINGS)?;
    if let Some(bytes) = &before
        && marker["policyOwned"] != true
    {
        let policy: Value = serde_json::from_slice(bytes).map_err(|_| owned::invalid())?;
        if policy["managedBy"] != "cloudlink" || policy["kind"] != "guard-policy" {
            return Err(owned::invalid());
        }
    }
    // This durable receipt allows a later publish/install to repair a damaged
    // policy without adopting an unrelated pre-existing file in the directory.
    if marker["policyOwned"] != true {
        marker["policyOwned"] = Value::Bool(true);
        owned::replace(
            &marker_path,
            Some(&marker_bytes),
            &serde_json::to_vec(&marker)?,
            owned::MAX_SETTINGS,
        )?;
    }
    let mut after = serde_json::to_vec(&project_policy(assets))?;
    after.push(b'\n');
    if after.len() as u64 > owned::MAX_SETTINGS {
        return Err(owned::invalid());
    }
    if before.as_deref() == Some(after.as_slice()) {
        return Ok(());
    }
    owned::replace(&path, before.as_deref(), &after, owned::MAX_SETTINGS)
}

/// A syntactically valid but stale policy must not be reported as active after
/// a failed publication. Compare to current database values, not to file age.
pub fn policy_current(paths: &Paths, assets: &[Asset]) -> bool {
    if owned::require_data(paths).is_err()
        || !matches!(owned::marker(&paths.data_dir.join("guard"), "guard"), Ok(Some(_)))
    {
        return false;
    }
    let Ok(Some(bytes)) = owned::read(&paths.data_dir.join("guard/policy.json"), owned::MAX_SETTINGS) else {
        return false;
    };
    serde_json::from_slice::<Value>(&bytes).is_ok_and(|value| value == project_policy(assets))
}
