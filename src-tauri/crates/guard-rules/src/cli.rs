use serde_json::Value;

use crate::shell;

pub(crate) fn provider(binary: &str) -> Option<&'static str> {
    match binary {
        "wrangler" => Some("cloudflare"),
        "vercel" | "vc" => Some("vercel"),
        "oci" => Some("oracle"),
        _ => None,
    }
}

fn option<'a>(words: &'a [String], names: &[&str]) -> Option<&'a str> {
    options(words, names).into_iter().next()
}

fn options<'a>(words: &'a [String], names: &[&str]) -> Vec<&'a str> {
    let mut values = Vec::new();
    for (i, word) in words.iter().enumerate() {
        if names.contains(&word.as_str()) {
            values.push(words.get(i + 1).map(String::as_str).unwrap_or(""));
        }
        if let Some((key, value)) = word.split_once('=')
            && names.contains(&key)
        {
            values.push(value);
        }
    }
    values
}

pub(crate) fn account<'a>(provider: &str, words: &'a [String], prefix: &'a [String]) -> Option<&'a str> {
    match provider {
        "cloudflare" => option(words, &["--account-id"]).or_else(|| {
            prefix.iter().rev().find_map(|s| {
                shell::assignment(s)
                    .filter(|(key, _)| *key == "CLOUDFLARE_ACCOUNT_ID")
                    .map(|(_, value)| value)
            })
        }),
        "vercel" => option(words, &["--scope", "-S", "--team", "-T"]),
        "oracle" => option(words, &["--profile"])
            .or_else(|| {
                prefix.iter().rev().find_map(|s| {
                    shell::assignment(s)
                        .filter(|(key, _)| *key == "OCI_CLI_PROFILE")
                        .map(|(_, value)| value)
                })
            })
            .or(Some("DEFAULT")),
        _ => None,
    }
}

pub(crate) fn account_matches(resource: &Value, account: &str) -> bool {
    resource.get("account").and_then(Value::as_str) == Some(account)
        || resource
            .get("accountAliases")
            .and_then(Value::as_array)
            .is_some_and(|aliases| aliases.iter().any(|alias| alias.as_str() == Some(account)))
}

fn positional(words: &[String]) -> Vec<&str> {
    let takes_value = [
        "--scope",
        "-S",
        "--team",
        "-T",
        "--profile",
        "--account-id",
        "--config",
        "-c",
        "--cwd",
        "--config-file",
        "--name",
        "--env",
        "-e",
        "--namespace-id",
        "--binding",
        "--command",
        "--file",
        "--database",
        "--project-name",
        "--project",
        "--project-id",
        "--instance-id",
        "--volume-id",
        "--compartment-id",
        "--region",
        "--auth",
        "--output",
        "--query",
        "--token",
        "-t",
        "--tail",
        "--since",
        "--format",
        "--search",
        "--limit",
        "--page",
        "--zone-id",
        "--bucket",
        "--id",
        "--destination",
    ];
    let mut out = Vec::new();
    let mut i = 1;
    while i < words.len() {
        if words[i].starts_with('-') {
            if takes_value.contains(&words[i].as_str()) {
                i += 1;
            }
        } else {
            out.push(words[i].as_str());
        }
        i += 1;
    }
    out
}

pub(crate) fn no_contact(words: &[String]) -> bool {
    words
        .iter()
        .any(|w| ["--version", "-v", "--help", "-h"].contains(&w.as_str()))
        || positional(words).first().is_some_and(|s| *s == "help")
}

pub(crate) fn identity_only(provider: &str, words: &[String]) -> bool {
    let positional = positional(words);
    match provider {
        "cloudflare" | "vercel" => positional.as_slice() == ["whoami"],
        _ => false,
    }
}

fn is_select(sql: &str) -> bool {
    // Accept one literal SELECT. Comments/stacked statements and mutating pragmas are opaque.
    let sql = sql.trim().trim_end_matches(';').trim();
    let upper = sql.to_ascii_uppercase();
    upper.starts_with("SELECT ")
        && !sql.contains(';')
        && !sql.contains("--")
        && !sql.contains("/*")
        && ![
            "INSERT",
            "UPDATE",
            "DELETE",
            "DROP",
            "ALTER",
            "ATTACH",
            "DETACH",
            "PRAGMA",
            "INTO",
            "LOAD_EXTENSION",
        ]
        .iter()
        .any(|word| {
            upper
                .split(|c: char| !c.is_ascii_alphanumeric() && c != '_')
                .any(|part| part == *word)
        })
}

fn scope_arguments<'a>(provider: &str, words: &'a [String], args: &[&'a str]) -> Vec<&'a str> {
    let mut out = Vec::new();
    let keys: &[&str] = match provider {
        "cloudflare" => &[
            "--name",
            "--project-name",
            "--namespace-id",
            "--database",
            "--zone-id",
            "--bucket",
            "--id",
        ],
        "vercel" => &["--project", "--project-id", "--name"],
        "oracle" => &["--instance-id", "--volume-id", "--bucket-name", "--db-system-id"],
        _ => &[],
    };
    for key in keys {
        out.extend(options(words, &[key]));
    }
    match provider {
        "cloudflare" => match args {
            ["tail", target, ..] => out.push(target),
            ["d1", "execute" | "info" | "delete", target, ..] => out.push(target),
            ["r2", "bucket", "delete" | "info" | "create", target, ..] => out.push(target),
            ["pages", "deployment", _, target, ..] => out.push(target),
            _ => {}
        },
        "vercel" => match args {
            [
                "inspect" | "logs" | "remove" | "rm" | "promote" | "rollback" | "redeploy",
                target,
                ..,
            ] => out.push(target),
            [
                "project" | "projects" | "domains",
                "inspect" | "rm" | "remove",
                target,
                ..,
            ] => out.push(target),
            _ => {}
        },
        _ => {}
    }
    out
}

fn in_scope(resource: &Value, target: &str) -> bool {
    let Some(scope) = resource.get("scope").and_then(Value::as_array) else {
        return false;
    };
    scope.iter().any(|item| {
        item.get("id").and_then(Value::as_str) == Some(target)
            || item.get("name").and_then(Value::as_str) == Some(target)
    })
}

pub(crate) fn judge(
    resource: &Value,
    provider: &str,
    words: &[String],
    prefix: &[String],
    unsafe_shell: bool,
) -> Option<&'static str> {
    let args = positional(words);
    let standard = resource.get("mode").and_then(Value::as_str) == Some("standard");
    let starts = |head: &[&str]| args.starts_with(head);
    let has = |needle: &str| {
        words
            .iter()
            .any(|w| w == needle || w.starts_with(&format!("{needle}=")))
    };

    // Credential exports are global prohibitions, checked before account/scope/mode.
    if provider == "vercel"
        && (starts(&["env", "pull"]) || starts(&["env", "ls"]) || starts(&["env", "list"]) || starts(&["pull"]))
        || provider == "cloudflare"
            && (starts(&["secret", "get"])
                || starts(&["secret", "read"])
                || starts(&["secret", "list"])
                || starts(&["secret", "bulk"])
                || starts(&["secrets-store", "secret", "get"]))
        || provider == "oracle"
            && starts(&["iam"])
            && args.iter().any(|s| {
                [
                    "api-key",
                    "customer-secret-key",
                    "auth-token",
                    "smtp-credential",
                    "secret",
                ]
                .contains(s)
            })
        || provider == "oracle" && (starts(&["secrets", "secret-bundle", "get"]) || starts(&["setup", "config"]))
    {
        return Some("cli-env-export");
    }
    if identity_only(provider, words) {
        return unsafe_shell.then_some("unparsed");
    }
    let account_options: &[&str] = match provider {
        "cloudflare" => &["--account-id"],
        "vercel" => &["--scope", "-S", "--team", "-T"],
        "oracle" => &["--profile"],
        _ => &[],
    };
    if options(words, account_options)
        .iter()
        .any(|a| !account_matches(resource, a))
    {
        return Some("cli-account");
    }
    match account(provider, words, prefix) {
        Some(account) if account_matches(resource, account) => {}
        _ => return Some("cli-account"),
    }
    let mut scopes = scope_arguments(provider, words, &args);
    if provider == "vercel"
        && let Some(project) = prefix.iter().rev().find_map(|word| {
            shell::assignment(word)
                .filter(|(key, _)| *key == "VERCEL_PROJECT_ID")
                .map(|(_, value)| value)
        })
    {
        scopes.push(project);
    }
    // Commands that inherently list account metadata need no one project/instance.
    // Every other operation must name a scope; never infer it from cwd/config files.
    let account_listing = match provider {
        "cloudflare" => starts(&["deployments", "list"]) || starts(&["pages", "project", "list"]),
        "vercel" => starts(&["ls"]) || starts(&["list"]),
        "oracle" => args.get(2) == Some(&"list"),
        _ => false,
    };
    if scopes.iter().any(|scope| !in_scope(resource, scope)) || scopes.is_empty() && !account_listing {
        return Some("cli-scope");
    }
    if provider == "cloudflare"
        && (starts(&["d1", "delete"])
            || starts(&["r2", "bucket", "delete"])
            || starts(&["delete"])
            || starts(&["pages", "project", "delete"]))
        || provider == "vercel"
            && (starts(&["project", "rm"])
                || starts(&["project", "remove"])
                || starts(&["projects", "rm"])
                || starts(&["domains", "rm"])
                || starts(&["domains", "remove"]))
        || provider == "oracle"
            && (starts(&["compute", "instance", "terminate"])
                || starts(&["bv", "volume", "delete"])
                || starts(&["bv", "boot-volume", "delete"])
                || starts(&["db", "system", "terminate"]))
    {
        return Some("cli-destroy");
    }
    if unsafe_shell {
        return Some("unparsed");
    }
    if standard {
        return None;
    }
    let allowed = match provider {
        "cloudflare" => {
            starts(&["tail"])
                || starts(&["deployments", "list"])
                || starts(&["kv", "key", "list"])
                || starts(&["d1", "info"])
                || starts(&["pages", "project", "list"])
                || starts(&["pages", "deployment", "list"])
                || starts(&["d1", "execute"]) && !has("--file") && option(words, &["--command"]).is_some_and(is_select)
        }
        "vercel" => {
            matches!(args.first(), Some(&"ls" | &"list" | &"inspect" | &"logs")) && !has("--prod") && !has("--output")
        }
        "oracle" => {
            args.len() >= 3
                && ["get", "list"].contains(&args[2])
                && !has("--file")
                && !has("--generate-full-command-json-input")
        }
        _ => false,
    };
    (!allowed).then_some("cli-write")
}
