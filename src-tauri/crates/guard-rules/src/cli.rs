use serde_json::Value;

use crate::shell;

pub(crate) fn provider(binary: &str) -> Option<&'static str> {
    match binary {
        // `cf` and `cloudflare` are the two names installed by the same package.
        "cf" | "cloudflare" => Some("cloudflare"),
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
        "cloudflare" => {
            matches!(
                positional.as_slice(),
                ["auth", "whoami"]
                    | ["auth", "scopes", ..]
                    | ["auth", "list"]
                    | ["cli", "search", ..]
                    | ["schema", ..]
                    | ["docs", "search", ..]
            )
        }
        "vercel" => positional.as_slice() == ["whoami"],
        _ => false,
    }
}

const CF_VALUE_OPTIONS: &[&str] = &[
    "--zone",
    "-z",
    "--account-id",
    "--account-name",
    "--profile",
    "--page",
    "--per-page",
    "--type",
    "--name",
    "--content",
    "--worker",
    "--project-name",
    "--store-id",
    "--secret-id",
    "--token-id",
    "--permission-group-ids",
    "--policies",
    "--value",
    "--body",
    "--file",
    "--title",
    "--description",
    "--source",
    "--skip",
    "--env",
    "--environment",
    "--script-name",
    "--namespace",
    "--dispatch-namespace",
    "--limit",
    "--order",
    "--direction",
    "--match",
    "--status",
    "--format",
    "--output",
    "--filter",
    "--since",
    "--until",
    "--id",
    "--deployment-id",
    "--stage",
    "--zone-id",
    "--namespace-id",
    "--database-id",
    "--secret-name",
    "--key-name",
    "--record-id",
    "--ruleset-id",
    "--policy-id",
];

fn cf_positional(words: &[String]) -> Vec<&str> {
    let mut out = Vec::new();
    let mut i = 1;
    while i < words.len() {
        let word = words[i].as_str();
        if word == "--" {
            out.extend(words[i + 1..].iter().map(String::as_str));
            break;
        }
        if word.starts_with('-') {
            let key = word.split_once('=').map_or(word, |(key, _)| key);
            if !word.contains('=') && CF_VALUE_OPTIONS.contains(&key) {
                i += 1;
            }
        } else {
            out.push(word);
        }
        i += 1;
    }
    out
}

fn cf_option_values<'a>(words: &'a [String], names: &[&str]) -> Vec<&'a str> {
    let mut values = Vec::new();
    for (i, word) in words.iter().enumerate() {
        if names.contains(&word.as_str()) {
            if let Some(value) = words.get(i + 1) {
                values.push(value.as_str());
            }
        } else if let Some((key, value)) = word.split_once('=')
            && names.contains(&key)
        {
            values.push(value);
        }
    }
    values
}

fn auto_scope(resource: &Value) -> bool {
    resource.get("scopeMode").and_then(Value::as_str) == Some("auto")
}

fn cf_list_match(resource: &Value, key: &str, target: &str) -> bool {
    let bare = target
        .strip_prefix("zone:")
        .or_else(|| target.strip_prefix("worker:"))
        .or_else(|| target.strip_prefix("pages:"))
        .unwrap_or(target);
    resource.get(key).and_then(Value::as_array).is_some_and(|scope| {
        scope.iter().any(|item| {
            item.get("id").and_then(Value::as_str).is_some_and(|id| {
                id == target
                    || id == format!("zone:{bare}")
                    || id == format!("worker:{bare}")
                    || id == format!("pages:{bare}")
            }) || item.get("name").and_then(Value::as_str) == Some(bare)
        })
    })
}

fn cf_scope_match(resource: &Value, target: &str) -> bool {
    cf_list_match(resource, "scope", target)
}

fn cf_excluded(resource: &Value, target: &str) -> bool {
    cf_list_match(resource, "excludedScope", target)
}

fn cf_destructive(args: &[&str]) -> bool {
    args.iter()
        .any(|word| ["delete", "remove", "purge", "destroy", "terminate"].contains(word))
}

pub(crate) fn cf_destructive_words(words: &[String]) -> bool {
    cf_destructive(&cf_positional(words))
}

fn cf_credential(words: &[String], args: &[&str]) -> bool {
    let path = args.join(" ");
    let has = |needle: &str| path.contains(needle);
    let tokens = args.starts_with(&["user", "tokens"]) || args.starts_with(&["accounts", "tokens"]);
    tokens
        && args
            .iter()
            .skip(2)
            .any(|verb| ["create", "update", "rotate"].contains(verb))
        || has("rotate-secret")
        || has("temporary-credentials create")
        || args.starts_with(&["secrets-store", "secrets", "get"])
        || args.starts_with(&["workers", "secrets", "get"])
        || args.starts_with(&["workers-for-platforms"])
            && args.contains(&"secrets")
            && args.contains(&"get")
            && !args.contains(&"list")
        || args.starts_with(&["zero-trust", "cws", "basic-auth-credentials", "secrets", "get"])
        || args.starts_with(&["mesh", "nodes", "token", "get"])
        || args.starts_with(&["tunnels", "token", "get"])
        || cf_option_values(words, &["--show-token"])
            .iter()
            .any(|v| !["false", "0"].contains(v))
}

fn scope_arguments<'a>(provider: &str, words: &'a [String], args: &[&'a str]) -> Vec<&'a str> {
    let mut out = Vec::new();
    let keys: &[&str] = match provider {
        "vercel" => &["--project", "--project-id", "--name"],
        "oracle" => &["--instance-id", "--volume-id", "--bucket-name", "--db-system-id"],
        _ => &[],
    };
    for key in keys {
        out.extend(options(words, &[key]));
    }
    if provider == "vercel" {
        match args {
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
        }
    }
    out
}

fn list_contains(resource: &Value, key: &str, target: &str) -> bool {
    let Some(scope) = resource.get(key).and_then(Value::as_array) else {
        return false;
    };
    scope.iter().any(|item| {
        item.get("id").and_then(Value::as_str) == Some(target)
            || item.get("name").and_then(Value::as_str) == Some(target)
    })
}

fn in_scope(resource: &Value, target: &str) -> bool {
    list_contains(resource, "scope", target)
}

fn is_excluded(resource: &Value, target: &str) -> bool {
    list_contains(resource, "excludedScope", target)
}

fn routine_change(provider: &str, words: &[String], args: &[&str]) -> bool {
    let flags: &[&str];
    let options: &[&str];
    let supported = match provider {
        "vercel" => {
            flags = &["--prod", "--yes", "-y", "--force", "--prebuilt", "--skip-domain"];
            options = &[
                "--scope",
                "-S",
                "--team",
                "-T",
                "--project",
                "--project-id",
                "--name",
                "--archive",
            ];
            args.first().is_some_and(|arg| ["deploy", "redeploy"].contains(arg))
                || args.is_empty() && words.iter().any(|word| word == "--prod")
        }
        "oracle" => {
            flags = &[];
            options = &["--profile", "--instance-id", "--action", "--display-name", "--region"];
            args.starts_with(&["compute", "instance", "action"]) && option(words, &["--action"]) == Some("START")
                || args.starts_with(&["compute", "instance", "update"]) && option(words, &["--display-name"]).is_some()
        }
        _ => return false,
    };
    supported && shell::checked_arguments(&words[1..], flags, options).is_some()
}

/// `cf` has thousands of generated commands. It is judged by ordered shape instead of
/// an exhaustive list: local/identity queries, credential red lines, scope, deletion
/// verbs, ordinary queries, then ordinary changes by mode.
fn cf_judge(resource: &Value, words: &[String], prefix: &[String], unsafe_shell: bool) -> Option<&'static str> {
    let args = cf_positional(words);
    let auto_ops = resource["mode"] == "auto-ops";
    let local = matches!(
        args.as_slice(),
        ["auth", "whoami"]
            | ["auth", "scopes", ..]
            | ["auth", "list"]
            | ["cli", "search", ..]
            | ["schema", ..]
            | ["docs", "search", ..]
    ) || words
        .iter()
        .any(|w| ["--version", "-v", "--help", "-h"].contains(&w.as_str()))
        || args.first() == Some(&"help");
    if local || words.iter().any(|w| w == "--dry-run" || w.starts_with("--dry-run=")) {
        return None;
    }
    if args.starts_with(&["auth"])
        && args
            .get(1)
            .is_some_and(|sub| ["login", "logout", "create", "delete", "activate", "deactivate"].contains(sub))
    {
        return Some("cli-identity");
    }
    if words.iter().any(|w| w == "--profile" || w.starts_with("--profile="))
        || prefix.iter().any(|w| {
            shell::assignment(w).is_some_and(|(key, _)| {
                ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_API_KEY", "CLOUDFLARE_EMAIL"].contains(&key)
            })
        })
    {
        return Some("cli-account");
    }
    if cf_option_values(words, &["--account-id"])
        .iter()
        .any(|value| !account_matches(resource, value))
    {
        return Some("cli-account");
    }
    match account("cloudflare", words, prefix) {
        Some(account) if account_matches(resource, account) => {}
        _ => return Some("cli-account"),
    }
    if cf_credential(words, &args) {
        return Some("cli-env-export");
    }
    let zones = cf_option_values(words, &["--zone", "-z"]);
    if auto_scope(resource) {
        if zones.iter().any(|zone| cf_excluded(resource, zone)) {
            return Some("cli-scope");
        }
        if args.starts_with(&["zones"])
            && args.get(1).is_some_and(|verb| ["get", "edit", "delete"].contains(verb))
            && args.get(2).is_some_and(|target| cf_excluded(resource, target))
        {
            return Some("cli-scope");
        }
        for value in cf_option_values(words, &["--worker", "--project-name"]) {
            if cf_excluded(resource, value) {
                return Some("cli-scope");
            }
        }
        if args
            .first()
            .is_some_and(|head| ["deploy", "workers", "pages", "zones"].contains(head))
            && cf_option_values(words, &["--name"])
                .iter()
                .any(|value| cf_excluded(resource, value))
        {
            return Some("cli-scope");
        }
        if args.starts_with(&["workers"])
            && args.get(1).is_some_and(|verb| ["get", "delete", "edit"].contains(verb))
            && args.get(2).is_some_and(|target| cf_excluded(resource, target))
        {
            return Some("cli-scope");
        }
        if args.starts_with(&["pages"])
            && args.get(1).is_some_and(|verb| ["get", "delete", "edit"].contains(verb))
            && args.get(2).is_some_and(|target| cf_excluded(resource, target))
        {
            return Some("cli-scope");
        }
        if args.starts_with(&["pages"])
            && args
                .get(1)
                .is_some_and(|group| ["deployments", "domains", "source", "build-cache"].contains(group))
            && args
                .get(2)
                .is_some_and(|verb| ["create", "connect", "purge"].contains(verb))
            && args.get(3).is_some_and(|target| cf_excluded(resource, target))
        {
            return Some("cli-scope");
        }
    } else {
        if zones.iter().any(|zone| !cf_scope_match(resource, zone)) {
            return Some("cli-scope");
        }
        if zones.is_empty() && args.first() == Some(&"dns") {
            return Some("cli-scope");
        }
        if args.starts_with(&["zones"])
            && args.get(1).is_some_and(|verb| ["get", "edit", "delete"].contains(verb))
            && args.get(2).is_none_or(|target| !cf_scope_match(resource, target))
        {
            return Some("cli-scope");
        }
        for value in cf_option_values(words, &["--worker"]) {
            if !cf_scope_match(resource, value) {
                return Some("cli-scope");
            }
        }
        for value in cf_option_values(words, &["--project-name"]) {
            if !cf_scope_match(resource, value) {
                return Some("cli-scope");
            }
        }
        if args
            .first()
            .is_some_and(|head| ["deploy", "workers", "pages", "zones"].contains(head))
        {
            let names = cf_option_values(words, &["--name"]);
            if (args.first() == Some(&"deploy") || args.starts_with(&["pages", "deploy"])) && names.is_empty() {
                return Some("cli-scope");
            }
            if names.iter().any(|value| !cf_scope_match(resource, value)) {
                return Some("cli-scope");
            }
        }
        if args.starts_with(&["workers"])
            && args.get(1).is_some_and(|verb| ["get", "delete", "edit"].contains(verb))
            && args.get(2).is_some_and(|target| !cf_scope_match(resource, target))
        {
            return Some("cli-scope");
        }
        if args.starts_with(&["pages"])
            && args.get(1).is_some_and(|verb| ["get", "delete", "edit"].contains(verb))
            && args.get(2).is_some_and(|target| !cf_scope_match(resource, target))
        {
            return Some("cli-scope");
        }
        if args.starts_with(&["pages"])
            && args
                .get(1)
                .is_some_and(|group| ["deployments", "domains", "source", "build-cache"].contains(group))
            && args
                .get(2)
                .is_some_and(|verb| ["create", "connect", "purge"].contains(verb))
            && args.get(3).is_some_and(|target| !cf_scope_match(resource, target))
        {
            return Some("cli-scope");
        }
    }
    if cf_destructive(&args) {
        return Some("cli-destroy");
    }
    if args
        .iter()
        .any(|verb| ["list", "get", "show", "info", "search", "describe", "status", "tail"].contains(verb))
    {
        return if unsafe_shell && auto_ops {
            crate::ssh::conservative_scan(&words.join(" "))
        } else if unsafe_shell {
            Some("unparsed")
        } else {
            None
        };
    }
    if unsafe_shell {
        return if auto_ops {
            crate::ssh::conservative_scan(&words.join(" "))
        } else {
            Some("unparsed")
        };
    }
    if auto_ops {
        return crate::ssh::conservative_scan(&words.join(" "));
    }
    Some("cli-write")
}

pub(crate) fn judge(
    resource: &Value,
    provider: &str,
    words: &[String],
    prefix: &[String],
    unsafe_shell: bool,
) -> Option<&'static str> {
    if provider == "cloudflare" {
        return cf_judge(resource, words, prefix, unsafe_shell);
    }
    let args = positional(words);
    let auto_ops = resource.get("mode").and_then(Value::as_str) == Some("auto-ops");
    let starts = |head: &[&str]| args.starts_with(head);
    let has = |needle: &str| {
        words
            .iter()
            .any(|w| w == needle || w.starts_with(&format!("{needle}=")))
    };

    // Credential exports are global prohibitions, checked before account/scope/mode.
    if provider == "vercel"
        && (starts(&["env", "pull"]) || starts(&["env", "ls"]) || starts(&["env", "list"]) || starts(&["pull"]))
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
    if auto_scope(resource) {
        if scopes.iter().any(|scope| is_excluded(resource, scope)) {
            return Some("cli-scope");
        }
    } else {
        // Commands that inherently list account metadata need no one project/instance.
        // Every other operation must name a scope; never infer it from cwd/config files.
        let account_listing = match provider {
            "vercel" => starts(&["ls"]) || starts(&["list"]),
            "oracle" => args.get(2) == Some(&"list"),
            _ => false,
        };
        if scopes.iter().any(|scope| !in_scope(resource, scope)) || scopes.is_empty() && !account_listing {
            return Some("cli-scope");
        }
    }
    if provider == "vercel"
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
    if unsafe_shell && !auto_ops {
        return Some("unparsed");
    }
    let allowed = match provider {
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
    if allowed {
        if unsafe_shell && auto_ops {
            crate::ssh::conservative_scan(&words.join(" "))
        } else {
            None
        }
    } else if unsafe_shell || !routine_change(provider, words, &args) {
        if auto_ops {
            crate::ssh::conservative_scan(&words.join(" "))
        } else {
            Some("unparsed")
        }
    } else {
        (!auto_ops).then_some("cli-write")
    }
}
