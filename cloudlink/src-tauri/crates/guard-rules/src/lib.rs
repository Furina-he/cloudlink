//! CloudLink's command-text guard. This crate never runs a command, reads credentials,
//! contacts a host, or approves an operation in the caller's permission system.

mod cli;
mod redact;
mod shell;
mod ssh;

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
                                Some("read-only" | "standard")
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
                                    Some("cloudflare" | "vercel" | "oracle")
                                ))
                            && resource.get("scope").is_none_or(|v| {
                                v.as_array().is_some_and(|a| {
                                    a.len() <= 10_000
                                        && a.iter().all(|s| {
                                            ["id", "name", "kind"].iter().all(|key| {
                                                s.get(*key).and_then(Value::as_str).is_some_and(|s| s.len() <= 1024)
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
    let standard = resource["mode"] == "standard";
    let allowed = reason_id.is_none() || standard && reason_id == Some("unparsed");
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
                    resource["mode"] == "standard",
                    &critical,
                    unsafe_shell || invocation.unsupported || shell::writes_redirect(simple),
                );
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
                    } else if resource["mode"] != "standard" {
                        Some("file-transfer")
                    } else {
                        unsafe_shell.then_some("unparsed")
                    };
                    push(out, resource, reason);
                }
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
            "This resource is in read-only mode; this command is not an inspection command. Ask the user to switch it to Standard mode in CloudLink if the change is intended."
        }
        "credential-read" | "cli-env-export" => "Reading or exporting credentials is forbidden in every mode.",
        "cli-account" => {
            "The command does not explicitly match a configured cloud account. Use the account selector from the resource's CloudLink details."
        }
        "cli-scope" => "The requested cloud resource is outside the selected CloudLink scope.",
        "file-transfer" => "File transfer is forbidden in read-only mode.",
        "interactive" => "Interactive SSH is forbidden in read-only mode. Supply an inspection command.",
        "unparsed" => "CloudLink could not confirm that this is a read-only command.",
        "critical-service" => "Stopping, deleting or restarting a critical service is forbidden.",
        "ssh-config" => "Changing SSH access or stopping the SSH service is forbidden.",
        "firewall" => "Changing firewall rules is forbidden.",
        "host-reboot" => "Rebooting or shutting down the host is forbidden.",
        _ => "This command can destroy data or infrastructure and is forbidden.",
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
            "wrangler whoami/tail/deployments list/kv key list/d1 info; wrangler d1 execute --command SELECT",
            "vercel whoami/ls/list/inspect/logs", "oci ... get/list (bound account and selected scope)",
        ],
        "standardDeny": [
            {"id":"volume-delete", "examples":["docker compose down -v", "docker volume rm/prune", "docker system prune --volumes"]},
            {"id":"data-delete", "examples":["rm -r /var/lib", "mkfs", "dd of=/dev/...", "wipefs", "dropdb", "redis-cli FLUSHALL"]},
            {"id":"host-reboot", "examples":["reboot", "shutdown", "systemctl poweroff"]},
            {"id":"firewall", "examples":["iptables -A", "nft add", "ufw allow", "firewall-cmd --add-port"]},
            {"id":"ssh-config", "examples":["modify sshd_config/authorized_keys", "systemctl restart sshd"]},
            {"id":"critical-service", "examples":["docker stop/restart/kill/rm <critical service>"]},
            {"id":"cli-destroy", "examples":["wrangler d1 delete", "wrangler r2 bucket delete", "vercel project rm", "vercel domains rm", "oci compute instance terminate", "oci bv volume delete"]},
        ],
        "alwaysDeny": [
            {"id":"credential-read", "examples":[".env; *.pem; *.key; id_*; /etc/shadow; ~/.ssh/", "docker inspect", "env", "printenv"]},
            {"id":"cli-env-export", "examples":["vercel env pull/list", "vercel pull", "wrangler secret get/read/list", "oci iam credentials; oci secrets secret-bundle get"]},
            {"id":"cli-account", "examples":["cloud commands with a missing or different bound account"]},
            {"id":"cli-scope", "examples":["explicit resources outside the selected scope"]},
        ],
    })
}

#[cfg(test)]
mod tests;
