//! CloudLink's command-text guard. This crate never runs a command, reads credentials,
//! contacts a host, or approves an operation in the caller's permission system.

mod cli;
mod execution;
pub mod github;
pub mod protocol;
mod redact;
pub mod routes;
pub mod runtime;
mod shell;
mod ssh;

pub use execution::{evaluate_execution, managed_runner_invocation, runtime_modification};

/// Fixed check used by the runner to supply `--force` only to approved destructive
/// Cloudflare commands, so non-interactive `cf` cannot stop at `Aborted.`.
pub fn cf_destructive(args: &[String]) -> bool {
    cli::cf_destructive_words(args)
}

use serde_json::{Value, json};

pub use redact::redact;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Decision {
    pub asset_id: String,
    pub handle: String,
    pub allowed: bool,
    pub reason_id: Option<&'static str>,
}

pub fn policy_valid(policy: &Value) -> bool {
    policy.get("version").and_then(Value::as_u64) == Some(1)
        && policy
            .get("resources")
            .and_then(Value::as_array)
            .is_some_and(|resources| {
                resources.len() <= 1000
                    && resources.iter().all(|resource| {
                        ["id", "kind", "handle", "mode"].iter().all(|key| {
                            resource
                                .get(*key)
                                .and_then(Value::as_str)
                                .is_some_and(|s| !s.is_empty() && s.len() <= 1024 && !s.chars().any(char::is_control))
                        }) && matches!(resource.get("kind").and_then(Value::as_str), Some("vps" | "cli"))
                            && matches!(
                                resource.get("mode").and_then(Value::as_str),
                                Some("confirm-changes" | "auto-ops")
                            )
                            && ["envIds", "hosts", "criticalServices", "accountAliases"]
                                .iter()
                                .all(|key| {
                                    resource.get(*key).is_none_or(|v| {
                                        v.as_array().is_some_and(|a| {
                                            a.len() <= 1000
                                                && a.iter().all(|s| {
                                                    s.as_str().is_some_and(|s| {
                                                        s.len() <= 1024 && !s.chars().any(char::is_control)
                                                    })
                                                })
                                        })
                                    })
                                })
                            && (resource["kind"] != "cli"
                                || matches!(
                                    resource.get("provider").and_then(Value::as_str),
                                    Some("cloudflare" | "vercel" | "oracle" | "github")
                                ))
                            && resource
                                .get("scopeMode")
                                .is_none_or(|v| matches!(v.as_str(), Some("auto" | "manual")))
                            && ["scope", "excludedScope"].iter().all(|key| {
                                resource.get(*key).is_none_or(|v| {
                                    v.as_array().is_some_and(|a| {
                                        a.len() <= 10_000
                                            && a.iter().all(|s| {
                                                ["id", "name", "kind"].iter().all(|field| {
                                                    s.get(*field)
                                                        .and_then(Value::as_str)
                                                        .is_some_and(|s| s.len() <= 1024)
                                                })
                                            })
                                    })
                                })
                            })
                    })
            })
}

fn applies(resource: &Value, env_id: &str) -> bool {
    resource
        .get("envIds")
        .and_then(Value::as_array)
        .is_none_or(|envs| envs.is_empty() || envs.iter().any(|env| env.as_str() == Some(env_id)))
}

fn matches_host(resource: &Value, host: &str) -> bool {
    resource
        .get("handle")
        .and_then(Value::as_str)
        .is_some_and(|name| name.eq_ignore_ascii_case(host))
        || resource.get("hosts").and_then(Value::as_array).is_some_and(|hosts| {
            hosts.iter().any(|h| {
                h.as_str()
                    .is_some_and(|h| h.trim_matches(['[', ']']).eq_ignore_ascii_case(host))
            })
        })
}

fn push(out: &mut Vec<Decision>, resource: &Value, reason_id: Option<&'static str>) {
    // An inline hook cannot grant the runner's one-time approval. Unknown
    // commands remain blocked here and the installed hook directs them to exec.
    let allowed = reason_id.is_none();
    let asset_id = resource["id"].as_str().unwrap_or_default();
    if let Some(existing) = out.iter_mut().find(|d| d.asset_id == asset_id) {
        // One log per resource per Bash call. A denial wins over every allowance.
        if !allowed || existing.allowed && reason_id.is_some() {
            existing.allowed = allowed;
            existing.reason_id = reason_id;
        }
    } else {
        out.push(Decision {
            asset_id: asset_id.into(),
            handle: resource["handle"].as_str().unwrap_or_default().into(),
            allowed,
            reason_id,
        });
    }
}

fn inspect(resources: &[Value], env_id: &str, text: &str, outer_unsafe: bool, depth: usize, out: &mut Vec<Decision>) {
    if depth > 8 {
        return;
    }
    let parsed = shell::parse(text);
    let unsafe_shell = outer_unsafe || parsed.unparsed || parsed.expansion;
    for simple in &parsed.commands {
        let mut start = shell::executable(&simple.words);
        let Some(first) = simple.words.get(start) else {
            continue;
        };
        // Common package executors preserve the following CLI invocation.
        if matches!(shell::binary(first), "npx" | "bunx" | "pnpm" | "npm" | "bun") {
            start += 1;
            while simple
                .words
                .get(start)
                .is_some_and(|s| s.starts_with('-') || s == "exec" || s == "dlx" || s == "x")
            {
                start += 1;
            }
        }
        let Some(words) = simple.words.get(start..) else {
            continue;
        };
        let Some(binary) = words.first().map(|s| shell::binary(s)) else {
            continue;
        };
        if ["sh", "bash", "zsh", "dash"].contains(&binary)
            && let Some(index) = words.iter().position(|s| s == "-c" || s == "-lc" || s == "-ic")
            && let Some(command) = words.get(index + 1)
        {
            inspect(resources, env_id, command, true, depth + 1, out);
        }
        if binary == "ssh" {
            let invocation = ssh::invocation(words);
            if invocation.no_contact {
                continue;
            }
            for resource in resources.iter().filter(|r| r["kind"] == "vps" && applies(r, env_id)) {
                let dynamic_match =
                    invocation.target.contains('$') && text.contains(resource["handle"].as_str().unwrap_or("\0"));
                if !matches_host(resource, &invocation.target) && !dynamic_match {
                    continue;
                }
                let critical: Vec<String> = resource
                    .get("criticalServices")
                    .and_then(Value::as_array)
                    .map(|a| a.iter().filter_map(Value::as_str).map(String::from).collect())
                    .unwrap_or_default();
                let reason = ssh::judge(
                    &invocation.remote,
                    resource["mode"] == "auto-ops",
                    &critical,
                    unsafe_shell || invocation.unsupported || shell::writes_redirect(simple),
                );
                // Forwarding, ProxyCommand/HostName and other unsupported client options
                // are SSH configuration changes, not ordinary unparsed commands.
                let reason = if invocation.unsupported && reason != Some("interactive") {
                    Some("ssh-config")
                } else {
                    reason
                };
                push(out, resource, reason);
            }
        } else if ["scp", "sftp", "rsync"].contains(&binary) {
            for resource in resources.iter().filter(|r| r["kind"] == "vps" && applies(r, env_id)) {
                let target_match = words.iter().skip(1).any(|word| {
                    (word.contains(':') || binary == "sftp") && matches_host(resource, &ssh::destination(word))
                });
                if target_match {
                    let reason = if words.iter().any(|word| ssh::credential_path(word)) {
                        Some("credential-read")
                    } else {
                        Some("file-transfer")
                    };
                    push(out, resource, reason);
                }
            }
        } else if binary == "gh"
            || binary == "git"
                && words.iter().any(|word| {
                    word == "--force"
                        || word == "--force-with-lease"
                        || word.starts_with("--force-with-lease=")
                        || word == "-f"
                        || word.starts_with('+')
                })
        {
            if cli::no_contact(words) {
                continue;
            }
            for resource in resources
                .iter()
                .filter(|r| r["kind"] == "cli" && r["provider"] == "github" && applies(r, env_id))
            {
                let mut scoped = resource.clone();
                scoped["envId"] = Value::String(env_id.into());
                let reason = github::judge(&scoped, &words[1..], (binary == "git").then_some("git"));
                let reason = if reason.is_none() && unsafe_shell {
                    if resource["mode"] == "auto-ops" {
                        ssh::conservative_scan(text)
                    } else {
                        Some("unparsed")
                    }
                } else {
                    reason
                };
                push(out, resource, reason);
            }
        } else if let Some(provider) = cli::provider(binary) {
            if cli::no_contact(words) {
                continue;
            }
            let candidates: Vec<_> = resources
                .iter()
                .filter(|r| r["kind"] == "cli" && r["provider"] == provider && applies(r, env_id))
                .collect();
            let account = cli::account(provider, words, &simple.words[..start]);
            let matched: Vec<_> = candidates
                .iter()
                .copied()
                .filter(|r| account.is_some_and(|a| cli::account_matches(r, a)))
                .collect();
            let selected = if matched.is_empty() || cli::identity_only(provider, words) {
                candidates
            } else {
                matched
            };
            for resource in selected {
                let reason = cli::judge(
                    resource,
                    provider,
                    words,
                    &simple.words[..start],
                    unsafe_shell || shell::writes_redirect(simple),
                );
                push(out, resource, reason);
            }
        }
    }
    for embedded in &parsed.embedded {
        inspect(resources, env_id, embedded, true, depth + 1, out);
    }
}

/// Missing/invalid policy cannot identify any managed resources and therefore passes through.
pub fn evaluate(policy: &Value, env_id: &str, command: &str) -> Vec<Decision> {
    if !policy_valid(policy) || command.len() > 65_536 || env_id.len() > 256 {
        return Vec::new();
    }
    let resources = policy["resources"].as_array().expect("validated resources");
    let mut decisions = Vec::new();
    inspect(resources, env_id, command, false, 0, &mut decisions);
    decisions
}

pub fn deny_output(decisions: &[Decision]) -> Option<Value> {
    let denied = decisions.iter().find(|d| !d.allowed)?;
    // Do not echo command text: even a rejection must not return credentials to the Agent.
    let reason = match denied.reason_id.unwrap_or("unparsed") {
        "read-only" | "cli-write" => {
            "This change requires one-time approval. Use the resource's CloudLink runner Connect entry instead of switching modes or bypassing checks."
        }
        "credential-read" | "cli-env-export" => "Reading or exporting credentials is forbidden in every mode.",
        "runtime-protected" => {
            "Changing CloudLink's running checks or stopping its process is forbidden while CloudLink is running."
        }
        "execution-channel" => {
            "This resource uses CloudLink's execution channel while CloudLink is running, regardless of production or mode. Use the quoted runner and stable asset ID from the resource's Skill details."
        }
        "runtime-invalid" | "runtime-not-ready" => {
            "CloudLink's running checks are unavailable or could not be verified. Do not treat an unavailable coordinator or policy as an exit; retry after checking CloudLink's status."
        }
        "github-repo-delete" => "Deleting a managed GitHub repository is forbidden in every mode.",
        "github-default-force" => {
            "Force-pushing the default branch, or without an explicit branch, is forbidden in every mode."
        }
        "cli-account" => {
            "The command does not explicitly match a configured cloud account. Use the account selector from the resource's CloudLink details."
        }
        "cli-scope" => "The requested cloud resource is outside the selected CloudLink scope.",
        "file-transfer" => "Use the resource's CloudLink runner single-file put/get entry, not direct file transfer.",
        "interactive" => {
            "Interactive SSH is not supported. Use the resource's CloudLink runner with an explicit remote command."
        }
        "unparsed" => {
            "CloudLink could not classify this command. Use the resource's CloudLink runner for one-time approval when the target is explicit; uncertain targets remain denied."
        }
        "critical-service" | "ssh-config" | "firewall" | "host-reboot" | "volume-delete" | "data-delete"
        | "cli-destroy" | "github-delete" | "github-dangerous" | "opaque-script" => {
            "This change requires one-time approval through the resource's CloudLink runner in either mode."
        }
        "cli-identity" => "The actual CLI identity could not be verified; changing accounts is not authorization.",
        _ => "CloudLink could not safely authorize this command. Do not bypass the block.",
    };
    Some(json!({"hookSpecificOutput": {
        "hookEventName":"PreToolUse", "permissionDecision":"deny",
        "permissionDecisionReason": format!("CloudLink guard: {}. {reason} Do not try to work around this block.", redact(&denied.handle)),
    }}))
}

pub fn rules() -> Value {
    json!({
        "readOnlyAllow": [
            "uptime; nproc; free -m; df -hP", "ls; stat; cat; head; tail; grep; wc (non-credential paths)",
            "ps; top -b -n 1; ss; netstat; ip addr; ip route", "uname; hostname; date; id; whoami; lsblk; findmnt",
            "systemctl status/is-active/list-units/--failed", "journalctl (no mutation options)",
            "docker ps/logs/images/version/info; docker stats --no-stream", "docker compose ps/logs/config --services",
            "docker exec <container> <inspection command>", "nginx -t; openssl s_client; openssl x509 -noout; curl -sI",
            "cf auth whoami/scopes/list; cf zones list; cf workers list; cf pages list; cf … list/get (bound account and selected scope)",
            "vercel whoami/ls/list/inspect/logs", "oci ... get/list (bound account and selected scope)",
        ],
        "standardDeny": [
            {"id":"volume-delete", "examples":["docker compose down -v", "docker volume rm/prune", "docker system prune --volumes"]},
            {"id":"data-delete", "examples":["rm -r /var/lib", "mkfs", "dd of=/dev/...", "wipefs", "dropdb", "redis-cli FLUSHALL"]},
            {"id":"cli-destroy", "examples":["cf … delete/remove/purge/destroy/terminate", "vercel project rm", "vercel domains rm", "oci compute instance terminate", "oci bv volume delete"]},
            {"id":"github-delete", "examples":["git push --force <non-default branch>", "gh api -X DELETE", "gh release delete", "gh run delete"]},
            {"id":"host-reboot", "examples":["reboot", "shutdown", "systemctl poweroff"]},
            {"id":"firewall", "examples":["iptables -A", "nft add", "ufw allow", "firewall-cmd --add-port"]},
            {"id":"ssh-config", "examples":["modify sshd_config/authorized_keys", "systemctl stop sshd"]},
            {"id":"critical-service", "examples":["docker stop/restart/kill/rm <critical service>"]},
            {"id":"opaque-script", "examples":["curl … | sh", "wget -O- … | bash", "base64 -d … | sh", "eval \"$(…)\""]},
        ],
        "alwaysDeny": [
            {"id":"credential-read", "examples":[".env; *.pem; *.key; id_*; /etc/shadow; ~/.ssh/", "docker inspect", "env", "printenv"]},
            {"id":"cli-env-export", "examples":["vercel env pull/list", "vercel pull", "cf … tokens create/update/rotate", "cf … secrets get", "oci iam credentials; oci secrets secret-bundle get"]},
        ],
    })
}

#[cfg(test)]
mod tests;
