//! 列入情况：每个已启用的「运行环境 × Agent」一行，原因只返回 ID 和参数。

use std::collections::BTreeSet;
use std::fs;

use crate::env::EnvContext;
use crate::fsx;
use crate::model::Detail;
use crate::model::asset::{Asset, AuthMethod, ConnectionSource};
use crate::model::delivery::{Inclusion, InclusionReasonId, Target};
use crate::params as p;
use crate::ssh::managed::{self, ManagedHost};

/// `envs` 由调用方按设置中的启用状态过滤。不可用环境仍保留原因行。
pub fn compute_inclusions(assets: &[Asset], envs: &[EnvContext], targets: &[Target]) -> Vec<Inclusion> {
    let units: BTreeSet<_> = targets
        .iter()
        .filter(|target| target.enabled && envs.iter().any(|env| env.id == target.env_id))
        .map(|target| (target.env_id.clone(), target.agent_key.clone()))
        .collect();
    let written_envs: BTreeSet<_> = envs
        .iter()
        .filter(|env| env.available && managed_config_matches(assets, env))
        .map(|env| env.id.clone())
        .collect();
    let mut result = Vec::new();
    for asset in assets {
        for (env_id, agent_key) in &units {
            let env = envs
                .iter()
                .find(|env| &env.id == env_id)
                .expect("unit has an environment");
            let reason = reason_for(asset, env, agent_key, written_envs.contains(env_id));
            result.push(Inclusion {
                asset_id: asset.id().into(),
                env_id: env_id.clone(),
                agent_key: agent_key.clone(),
                included: reason.is_none(),
                reason: reason.map(|id| {
                    let mut params = p! {"env" => env.id.as_str()};
                    if let Some(cli) = asset.as_cli() {
                        params.insert("cli".into(), cli.cli.binary.as_str().into());
                    }
                    Detail::with(id, params)
                }),
            });
        }
    }
    result
}

/// `defined_in` records the user's intent. Only the exact current managed file proves that
/// the connection was written; a temporary connection test cannot prove the Agent's config.
fn managed_config_matches(assets: &[Asset], env: &EnvContext) -> bool {
    let path = env.host_in_home(&[".ssh", "cloudlink.conf"]);
    if super::paths::reject_link_ancestors(&path).is_err() {
        return false;
    }
    let Ok(meta) = fs::symlink_metadata(&path) else {
        return false;
    };
    if !meta.is_file() || fsx::is_link(&meta) {
        return false;
    }
    let hosts: Vec<_> = assets
        .iter()
        .filter_map(|asset| ManagedHost::from_asset(asset, env))
        .collect();
    let expected = managed::render(&hosts);
    meta.len() == expected.len() as u64
        && hosts.iter().all(|host| host.validate(env.is_windows()).is_ok())
        && fs::read_to_string(&path).is_ok_and(|text| text == expected)
}

fn reason_for(asset: &Asset, env: &EnvContext, agent_key: &str, managed_written: bool) -> Option<InclusionReasonId> {
    use InclusionReasonId as Reason;
    if !asset.agent().agents.iter().any(|agent| agent == agent_key) {
        return Some(Reason::AgentOff);
    }
    if !env.available {
        return Some(Reason::EnvUnavailable);
    }
    if let Some(cli) = asset.as_cli() {
        let Some(state) = cli.cli.env_states.get(&env.id) else {
            return Some(Reason::CliNotInstalled);
        };
        if !state.installed {
            return Some(Reason::CliNotInstalled);
        }
        let account_matches = cli.account.as_deref().is_none_or(|bound| {
            state
                .account
                .as_deref()
                .is_some_and(|account| account.eq_ignore_ascii_case(bound))
                || state
                    .accounts
                    .as_ref()
                    .is_some_and(|accounts| accounts.iter().any(|account| account.eq_ignore_ascii_case(bound)))
        });
        return (!state.authenticated || state.expired || !account_matches).then_some(Reason::CliNotLoggedIn);
    }
    let connection = &asset.as_server().expect("asset is a server or CLI").connection;
    if !connection.verified.as_ref().is_some_and(|verified| verified.ok) {
        return Some(Reason::Unverified);
    }
    if connection.source == ConnectionSource::Imported {
        return (!connection.defined_in.contains(&env.id)).then_some(Reason::NotDefined);
    }
    let Some(auth) = &connection.auth else {
        return Some(Reason::NoKeyInEnv);
    };
    if auth.method == AuthMethod::Password {
        return Some(Reason::PasswordOnly);
    }
    if !connection.defined_in.contains(&env.id) {
        return Some(Reason::NotWritten);
    }
    if auth.method == AuthMethod::Key
        && auth
            .identity_file
            .get(&env.id)
            .is_none_or(|path| path.trim().is_empty())
    {
        return Some(Reason::NoKeyInEnv);
    }
    let user_config = env.host_in_home(&[".ssh", "config"]);
    let included = super::paths::reject_link_ancestors(&user_config).is_ok()
        && fs::read_to_string(&user_config)
            .is_ok_and(|config| managed::is_included_at(&config, &env.managed_config_native()));
    if !included {
        return Some(Reason::IncludeMissing);
    }
    (!managed_written || ManagedHost::from_asset(asset, env).is_none()).then_some(Reason::NotWritten)
}
