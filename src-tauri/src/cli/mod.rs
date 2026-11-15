//! Read-only cloud CLI metadata (F-104). The runner is injectable; isolated sessions never
//! discover or execute the workstation's CLIs. Catalogs are bound to a provider and account.

mod runner;

pub use runner::{EmptyRunner, SystemRunner};

use std::collections::{BTreeMap, BTreeSet};
use std::fmt;
use std::net::IpAddr;
use std::sync::{Arc, Mutex};

use serde_json::Value;

use crate::env::EnvContext;
use crate::error::{AppError, Result};
use crate::model::asset::{Asset, CliEnvState, CliProvider, CliScopeItem, CliScopeKind, RepoVisibility};
use crate::model::env::EnvId;
use crate::model::misc::IpcErrorId;
use crate::params;

const MAX_ACCOUNTS: usize = 100;
const MAX_SCOPE: usize = 500;
const MAX_TEXT: usize = 128;

/// Only fixed, read-only operations can reach the real runner. `path` always comes from
/// discovery and `account` must occur in the authenticated account set.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Query {
    Discover {
        provider: CliProvider,
    },
    Version {
        provider: CliProvider,
        path: String,
    },
    Identity {
        provider: CliProvider,
        path: String,
        account: Option<String>,
    },
    Profiles {
        path: String,
    },
    Scope {
        provider: CliProvider,
        path: String,
        account: String,
    },
}

pub struct QueryOutput {
    pub code: Option<i32>,
    /// Metadata JSON, version text, or a fixed error ID. Never an auth token or HTTP body.
    pub stdout: String,
}

impl QueryOutput {
    pub fn json(value: Value) -> Self {
        Self {
            code: Some(0),
            stdout: value.to_string(),
        }
    }
}

impl fmt::Debug for QueryOutput {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("QueryOutput")
            .field("code", &self.code)
            .field("bytes", &self.stdout.len())
            .finish()
    }
}

pub trait Runner: Send + Sync {
    fn run(&self, env: &EnvContext, query: &Query) -> Result<QueryOutput>;
    /// Called only after an explicit UI action and validation against the fixed command list.
    fn open_terminal(&self, env: &EnvContext, command: &str) -> Result<()>;
}

#[derive(Default)]
struct Cache {
    states: BTreeMap<(CliProvider, EnvId), CliEnvState>,
    catalogs: BTreeMap<(CliProvider, String), Vec<CliScopeItem>>,
}

pub struct Service {
    runner: Arc<dyn Runner>,
    cache: Mutex<Cache>,
}

impl Service {
    pub fn new(runner: Arc<dyn Runner>) -> Self {
        Self {
            runner,
            cache: Mutex::new(Cache::default()),
        }
    }

    pub fn detect(
        &self,
        envs: &[EnvContext],
        provider: CliProvider,
        bound_account: Option<&str>,
    ) -> Result<BTreeMap<EnvId, CliEnvState>> {
        let mut states = BTreeMap::new();
        for env in envs.iter().filter(|e| e.available) {
            let mut state = self.detect_one(env, provider)?;
            if let Some(account) = bound_account {
                state.authenticated &= state.accounts.as_ref().is_some_and(|a| a.iter().any(|x| x == account));
            }
            states.insert(env.id.clone(), state);
        }
        let mut cache = self.cache.lock().map_err(|_| AppError::internal("CLI cache lock"))?;
        cache
            .states
            .retain(|(p, env_id), _| *p != provider || states.contains_key(env_id));
        // Store the unrestricted account sets, even when the returned state is for a bound asset.
        for (env_id, state) in &states {
            let mut cached = state.clone();
            if bound_account.is_some() {
                cached.authenticated = !cached.expired && cached.accounts.as_ref().is_some_and(|a| !a.is_empty());
            }
            cache.states.insert((provider, env_id.clone()), cached);
        }
        // An account no longer available in any of the freshly detected environments has no
        // trustworthy catalog. A later save must not revive it from an old cache entry.
        let accounts: BTreeSet<String> = states
            .values()
            .flat_map(|s| s.accounts.iter().flatten().cloned())
            .collect();
        cache
            .catalogs
            .retain(|(p, a), _| *p != provider || accounts.contains(a));
        Ok(states)
    }

    fn detect_one(&self, env: &EnvContext, provider: CliProvider) -> Result<CliEnvState> {
        let mut state = CliEnvState {
            installed: false,
            version: None,
            path: None,
            authenticated: false,
            expired: false,
            account: None,
            accounts: None,
            checked_at: crate::time::now_rfc3339(),
        };
        let discovery = self.runner.run(env, &Query::Discover { provider })?;
        let discovered = json_output(&discovery)?;
        if discovered.get("installed").and_then(Value::as_bool) != Some(true) {
            return Ok(state);
        }
        let path = discovered
            .get("path")
            .and_then(Value::as_str)
            .filter(|p| valid_path(p, env))
            .ok_or_else(|| AppError::ipc(IpcErrorId::CliCommandUnsupported))?
            .to_string();
        state.installed = true;
        state.path = Some(path.clone());
        let version = self.runner.run(
            env,
            &Query::Version {
                provider,
                path: path.clone(),
            },
        )?;
        state.version = parse_version(&version.stdout);
        if provider == CliProvider::Oracle {
            let profiles = self.runner.run(env, &Query::Profiles { path: path.clone() })?;
            let profiles = json_output(&profiles)?;
            let names: Vec<String> = profiles
                .get("profiles")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .filter(|p| valid_account(provider, p))
                .take(MAX_ACCOUNTS)
                .map(String::from)
                .collect();
            let mut ready = Vec::new();
            for profile in names {
                let result = self.runner.run(
                    env,
                    &Query::Identity {
                        provider,
                        path: path.clone(),
                        account: Some(profile.clone()),
                    },
                )?;
                let identity = json_output(&result)?;
                state.expired |= identity.get("expired").and_then(Value::as_bool) == Some(true);
                if identity.get("authenticated").and_then(Value::as_bool) == Some(true) {
                    ready.push(profile);
                }
            }
            state.authenticated = !ready.is_empty();
            state.expired &= !state.authenticated;
            state.account = ready.first().cloned();
            state.accounts = Some(ready);
        } else {
            let identity = self.runner.run(
                env,
                &Query::Identity {
                    provider,
                    path,
                    account: None,
                },
            )?;
            let identity = json_output(&identity)?;
            let (display, accounts, expired) = parse_identity(provider, &identity);
            state.authenticated = !accounts.is_empty() && !expired;
            state.account = display;
            state.accounts = Some(accounts);
            state.expired = expired;
        }
        Ok(state)
    }

    /// Pull metadata from an environment that can operate the requested account. A failed
    /// query invalidates the catalog, so a stale or fabricated draft cannot be saved.
    pub fn scope(
        &self,
        envs: &[EnvContext],
        provider: CliProvider,
        account: Option<&str>,
        assets: &[Asset],
    ) -> Result<Vec<CliScopeItem>> {
        let (account, candidates) = {
            let cache = self.cache.lock().map_err(|_| AppError::internal("CLI cache lock"))?;
            let states: Vec<_> = envs
                .iter()
                .filter(|e| e.available)
                .filter_map(|e| {
                    cache
                        .states
                        .get(&(provider, e.id.clone()))
                        .filter(|s| s.authenticated && !s.expired)
                        .map(|s| (e, s))
                })
                .collect();
            let account = account
                .map(String::from)
                .or_else(|| states.iter().find_map(|(_, s)| s.accounts.as_ref()?.first().cloned()))
                .ok_or_else(|| AppError::ipc(IpcErrorId::CliAccountUnavailable))?;
            if !valid_account(provider, &account) {
                return Err(AppError::ipc(IpcErrorId::CliAccountUnavailable));
            }
            let candidates: Vec<_> = states
                .into_iter()
                .filter(|(_, s)| s.accounts.as_ref().is_some_and(|a| a.contains(&account)))
                .filter_map(|(e, s)| s.path.as_ref().map(|p| (e.clone(), p.clone())))
                .collect();
            if candidates.is_empty() {
                return Err(AppError::ipc(IpcErrorId::CliAccountUnavailable));
            }
            (account, candidates)
        };
        self.cache
            .lock()
            .map_err(|_| AppError::internal("CLI cache lock"))?
            .catalogs
            .remove(&(provider, account.clone()));
        let mut last_error = AppError::ipc(IpcErrorId::CliScopeFailed);
        for (env, path) in candidates {
            let result = self.runner.run(
                &env,
                &Query::Scope {
                    provider,
                    path,
                    account: account.clone(),
                },
            );
            let parsed = result
                .and_then(|o| json_output(&o))
                .and_then(|v| parse_scope(provider, &v, assets));
            match parsed {
                Ok(items) => {
                    let mut cache = self.cache.lock().map_err(|_| AppError::internal("CLI cache lock"))?;
                    if !cache.states.iter().any(|((p, _), state)| {
                        *p == provider
                            && state.authenticated
                            && state.accounts.as_ref().is_some_and(|a| a.contains(&account))
                    }) {
                        return Err(AppError::ipc(IpcErrorId::CliAccountUnavailable));
                    }
                    cache.catalogs.insert((provider, account.clone()), items.clone());
                    return Ok(items);
                }
                Err(error) => last_error = error,
            }
        }
        Err(last_error)
    }

    /// The draft controls only selection. Names, types, addresses and links come from the
    /// freshly retrieved catalog for this account, never from the invoke payload.
    pub fn validate_scope(
        &self,
        provider: CliProvider,
        account: Option<&str>,
        incoming: &[CliScopeItem],
    ) -> Result<Vec<CliScopeItem>> {
        let cache = self.cache.lock().map_err(|_| AppError::internal("CLI cache lock"))?;
        let account = account
            .map(String::from)
            .or_else(|| {
                cache
                    .states
                    .iter()
                    .filter(|((p, _), s)| *p == provider && s.authenticated)
                    .find_map(|(_, s)| s.accounts.as_ref()?.first().cloned())
            })
            .ok_or_else(|| AppError::ipc(IpcErrorId::CliAccountUnavailable))?;
        if !cache.states.iter().any(|((p, _), state)| {
            *p == provider
                && state.authenticated
                && !state.expired
                && state
                    .accounts
                    .as_ref()
                    .is_some_and(|accounts| accounts.contains(&account))
        }) {
            return Err(AppError::ipc(IpcErrorId::CliAccountUnavailable));
        }
        let catalog = cache
            .catalogs
            .get(&(provider, account))
            .ok_or_else(|| AppError::ipc(IpcErrorId::CliScopeFailed))?;
        if incoming.len() > MAX_SCOPE
            || incoming
                .iter()
                .any(|item| !catalog.iter().any(|known| known.id == item.id))
        {
            return Err(AppError::ipc(IpcErrorId::CliScopeFailed));
        }
        let selected: BTreeSet<&str> = incoming.iter().filter(|i| i.selected).map(|i| i.id.as_str()).collect();
        Ok(catalog
            .iter()
            .map(|item| {
                let mut item = item.clone();
                item.selected = selected.contains(item.id.as_str());
                item
            })
            .collect())
    }

    pub fn open_terminal(&self, env: &EnvContext, command: &str) -> Result<()> {
        if !env.available || !terminal_command_allowed(env, command) {
            return Err(AppError::ipc(IpcErrorId::TerminalCommandInvalid));
        }
        self.runner.open_terminal(env, command)
    }
}

pub fn terminal_command_allowed(env: &EnvContext, command: &str) -> bool {
    const COMMON: &[&str] = &[
        "npm install -g wrangler",
        "pnpm add -g wrangler",
        "bun add -g wrangler",
        "wrangler login",
        "npm install -g vercel",
        "pnpm add -g vercel",
        "bun add -g vercel",
        "vercel login",
        "pip install oci-cli",
        "oci setup config",
        "gh auth login",
    ];
    COMMON.contains(&command)
        || if env.is_windows() {
            matches!(
                command,
                "winget install Oracle.OCICLI" | "winget install --id GitHub.cli"
            )
        } else {
            command
                == r#"bash -c "$(curl -L https://raw.githubusercontent.com/oracle/oci-cli/master/scripts/install/install.sh)""#
                || command == "sudo apt install gh"
        }
}

pub(crate) fn valid_account(provider: CliProvider, account: &str) -> bool {
    if provider == CliProvider::Cloudflare {
        return account.len() == 32 && account.bytes().all(|b| b.is_ascii_hexdigit());
    }
    if provider == CliProvider::Github {
        return valid_github_owner(account);
    }
    !account.is_empty()
        && account.len() <= MAX_TEXT
        && !account.starts_with(['-', '.'])
        && account
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.'))
}

/// GitHub 用户名和组织名：字母、数字、连字符，最长 39，不以连字符开头
pub(crate) fn valid_github_owner(login: &str) -> bool {
    !login.is_empty()
        && login.len() <= 39
        && !login.starts_with('-')
        && login.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
}

/// `owner/name`：仓库名是字母、数字和 `.` `_` `-`，最长 100，不能是 `.` 或 `..`
fn valid_repo_name(full: &str) -> bool {
    let Some((owner, name)) = full.split_once('/') else {
        return false;
    };
    valid_github_owner(owner)
        && !name.is_empty()
        && name.len() <= 100
        && name != "."
        && name != ".."
        && name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.'))
}

/// 分支名写进 Skill 的表格：git 不允许空白和控制字符，这里再排除表格和代码块会用到的符号
fn valid_branch(branch: &str) -> bool {
    !branch.is_empty()
        && branch.len() <= 255
        && !branch.starts_with('-')
        && !branch.chars().any(|c| {
            c.is_control() || c.is_whitespace() || matches!(c, '`' | '|' | '\\' | '~' | '^' | ':' | '?' | '*' | '[')
        })
}

pub(crate) fn valid_path(path: &str, env: &EnvContext) -> bool {
    !path.is_empty()
        && path.len() <= 4096
        && !path.chars().any(char::is_control)
        && if env.is_windows() {
            let bytes = path.as_bytes();
            (bytes.len() >= 3 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' && matches!(bytes[2], b'/' | b'\\'))
                || path.starts_with(r"\\")
        } else {
            path.starts_with('/')
        }
}

fn parse_version(output: &str) -> Option<String> {
    output
        .split(|c: char| !(c.is_ascii_digit() || c == '.'))
        .find(|s| {
            let parts: Vec<_> = s.split('.').collect();
            parts.len() >= 2
                && parts.len() <= 4
                && parts
                    .iter()
                    .all(|p| !p.is_empty() && p.bytes().all(|b| b.is_ascii_digit()))
        })
        .map(String::from)
}

fn json_output(output: &QueryOutput) -> Result<Value> {
    // No parsing error is allowed to include source text (it could be an unexpected credential).
    let value: Value =
        serde_json::from_str(output.stdout.trim()).map_err(|_| AppError::ipc(IpcErrorId::CliCommandUnsupported))?;
    if let Some(error) = value.get("error").and_then(Value::as_str) {
        let id = match error {
            "cli-account-unavailable" => IpcErrorId::CliAccountUnavailable,
            "cli-scope-permission" => IpcErrorId::CliScopePermission,
            "cli-command-unsupported" => IpcErrorId::CliCommandUnsupported,
            _ => IpcErrorId::CliScopeFailed,
        };
        return Err(AppError::ipc(id));
    }
    if output.code != Some(0) && value.get("authenticated").is_none() && value.get("loggedIn").is_none() {
        return Err(AppError::ipc(IpcErrorId::CliScopeFailed));
    }
    Ok(value)
}

fn clean_text(text: &str) -> String {
    text.chars().filter(|c| !c.is_control()).take(MAX_TEXT).collect()
}

fn parse_identity(provider: CliProvider, value: &Value) -> (Option<String>, Vec<String>, bool) {
    let expired = value.get("expired").and_then(Value::as_bool) == Some(true);
    if value.get("loggedIn").and_then(Value::as_bool) == Some(false)
        || value.get("authenticated").and_then(Value::as_bool) == Some(false)
    {
        return (None, Vec::new(), expired);
    }
    let mut accounts = Vec::new();
    let display = match provider {
        CliProvider::Cloudflare => {
            for account in value.get("accounts").and_then(Value::as_array).into_iter().flatten() {
                if let Some(id) = account
                    .get("id")
                    .and_then(Value::as_str)
                    .filter(|id| valid_account(provider, id))
                {
                    accounts.push(id.to_string());
                }
            }
            value.get("email").and_then(Value::as_str).map(clean_text)
        }
        CliProvider::Vercel => {
            let account_id = |team: &Value| {
                team.get("id")
                    .and_then(Value::as_str)
                    .filter(|id| valid_account(provider, id))
                    .or_else(|| {
                        team.get("slug")
                            .and_then(Value::as_str)
                            .filter(|id| valid_account(provider, id))
                    })
                    .map(String::from)
            };
            let teams = value.get("teams").and_then(Value::as_array);
            let stable_ids = [value.get("globalTeam"), value.get("team")]
                .into_iter()
                .flatten()
                .chain(teams.into_iter().flatten())
                .any(|team| {
                    team.get("id")
                        .and_then(Value::as_str)
                        .is_some_and(|id| valid_account(provider, id))
                });
            let listed_ids: BTreeSet<_> = teams.into_iter().flatten().filter_map(account_id).collect();
            for key in ["team", "globalTeam"] {
                if let Some(id) = value.get(key).and_then(account_id)
                    && (!stable_ids || teams.is_none() || listed_ids.contains(&id))
                {
                    accounts.push(id);
                }
            }
            // Current `teams list --format=json` advertises every usable scope, including
            // a personal user ID only for legacy accounts. Northstar usernames are not scopes.
            if !stable_ids
                && !teams.is_some_and(Vec::is_empty)
                && let Some(username) = value
                    .get("username")
                    .and_then(Value::as_str)
                    .filter(|id| valid_account(provider, id))
            {
                accounts.push(username.to_string());
            }
            for team in teams.into_iter().flatten() {
                if let Some(id) = account_id(team) {
                    accounts.push(id);
                }
            }
            ["team", "globalTeam"]
                .into_iter()
                .find_map(|key| {
                    let team = value.get(key)?;
                    if stable_ids && teams.is_some() && !listed_ids.contains(&account_id(team)?) {
                        return None;
                    }
                    team.get("slug")?.as_str().filter(|slug| !slug.is_empty())
                })
                .or_else(|| value.get("username").and_then(Value::as_str))
                .map(clean_text)
        }
        CliProvider::Oracle => None,
        // 命令总是以 gh 当前的活动账号执行，没有按命令指定账号的参数，所以只认活动账号
        CliProvider::Github => {
            let login = value
                .get("login")
                .and_then(Value::as_str)
                .filter(|login| valid_github_owner(login));
            if let Some(login) = login {
                accounts.push(login.to_string());
            }
            login.map(clean_text)
        }
    };
    let mut seen = BTreeSet::new();
    accounts.retain(|id| seen.insert(id.clone()));
    accounts.truncate(MAX_ACCOUNTS);
    (display, accounts, expired)
}

fn parse_scope(provider: CliProvider, value: &Value, assets: &[Asset]) -> Result<Vec<CliScopeItem>> {
    let items = value
        .get("items")
        .and_then(Value::as_array)
        .ok_or_else(|| AppError::ipc(IpcErrorId::CliScopeFailed))?;
    if items.len() > MAX_SCOPE {
        return Err(AppError::ipc(IpcErrorId::CliScopeFailed));
    }
    let mut parsed = BTreeMap::new();
    for value in items {
        let id = value
            .get("id")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty() && s.len() <= 256 && !s.chars().any(char::is_control))
            .ok_or_else(|| AppError::ipc(IpcErrorId::CliScopeFailed))?;
        let name = value
            .get("name")
            .and_then(Value::as_str)
            .ok_or_else(|| AppError::ipc(IpcErrorId::CliScopeFailed))?;
        let kind = match (provider, value.get("kind").and_then(Value::as_str)) {
            (CliProvider::Cloudflare, Some("zone")) => CliScopeKind::Zone,
            (CliProvider::Cloudflare, Some("worker")) => CliScopeKind::Worker,
            (CliProvider::Cloudflare, Some("pages")) => CliScopeKind::Pages,
            (CliProvider::Vercel, Some("project")) => CliScopeKind::Project,
            (CliProvider::Oracle, Some("instance")) => CliScopeKind::Instance,
            (CliProvider::Github, Some("repo")) => CliScopeKind::Repo,
            _ => return Err(AppError::ipc(IpcErrorId::CliScopeFailed)),
        };
        // 仓库名是 owner/name，Skill 里原样写出，只接受 GitHub 允许的字符
        if kind == CliScopeKind::Repo && !valid_repo_name(name) {
            return Err(AppError::ipc(IpcErrorId::CliScopeFailed));
        }
        let (default_branch, visibility) = if kind == CliScopeKind::Repo {
            (
                value
                    .get("defaultBranch")
                    .and_then(Value::as_str)
                    .filter(|b| valid_branch(b))
                    .map(String::from),
                match value.get("visibility").and_then(Value::as_str) {
                    Some("public") => Some(RepoVisibility::Public),
                    Some("private") => Some(RepoVisibility::Private),
                    Some("internal") => Some(RepoVisibility::Internal),
                    _ => None,
                },
            )
        } else {
            (None, None)
        };
        let addresses: Vec<IpAddr> = value
            .get("addresses")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .filter_map(|s| s.parse().ok())
            .collect();
        let linked = (kind == CliScopeKind::Zone)
            .then(|| {
                assets
                    .iter()
                    .filter_map(Asset::as_server)
                    .find(|a| {
                        a.connection
                            .host
                            .as_deref()
                            .or_else(|| a.connection.resolved.as_ref().map(|r| r.hostname.as_str()))
                            .and_then(|h| h.parse::<IpAddr>().ok())
                            .is_some_and(|ip| addresses.contains(&ip))
                    })
                    .map(|a| a.id.clone())
            })
            .flatten();
        let address = if kind == CliScopeKind::Instance {
            value
                .get("address")
                .and_then(Value::as_str)
                .and_then(|s| s.parse::<IpAddr>().ok())
                .map(|ip| ip.to_string())
        } else {
            None
        };
        let name = clean_text(name);
        if name.is_empty() {
            return Err(AppError::ipc_with(
                IpcErrorId::CliScopeFailed,
                params! { "reason" => "invalid-metadata" },
            ));
        }
        parsed.insert(
            id.to_string(),
            CliScopeItem {
                id: id.to_string(),
                kind,
                name,
                selected: false,
                linked_asset_id: linked,
                address,
                default_branch,
                visibility,
            },
        );
    }
    Ok(parsed.into_values().collect())
}

#[cfg(test)]
mod tests;
