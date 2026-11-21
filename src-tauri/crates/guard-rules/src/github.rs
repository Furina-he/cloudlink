//! GitHub text policy. This module does not authenticate or execute; the runner must
//! separately verify the effective identity, stable owner/repository IDs and exclusions.

use serde_json::Value;

fn words(args: &[String]) -> &[String] {
    if args.first().is_some_and(|word| {
        matches!(
            word.rsplit(['/', '\\']).next().unwrap_or(word).trim_end_matches(".exe"),
            "gh" | "git"
        )
    }) {
        &args[1..]
    } else {
        args
    }
}

fn option<'a>(args: &'a [String], names: &[&str]) -> Result<Option<&'a str>, &'static str> {
    let mut result = None;
    for (index, word) in args.iter().enumerate() {
        let value = if names.contains(&word.as_str()) {
            Some(
                args.get(index + 1)
                    .filter(|value| !value.starts_with('-'))
                    .ok_or("unparsed")?
                    .as_str(),
            )
        } else {
            names
                .iter()
                .find_map(|name| word.strip_prefix(format!("{name}=").as_str()))
                .or_else(|| {
                    names
                        .iter()
                        .filter(|name| name.len() == 2)
                        .find_map(|name| word.strip_prefix(*name))
                        .filter(|value| !value.is_empty())
                })
        };
        if let Some(value) = value {
            if result.is_some_and(|before| before != value) {
                return Err("cli-account");
            }
            result = Some(value);
        }
    }
    Ok(result)
}

fn safe_owner(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 39
        && !value.starts_with('-')
        && value.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
}

fn safe_repo(value: &str) -> bool {
    let Some((owner, repo)) = value.split_once('/') else {
        return false;
    };
    safe_owner(owner)
        && !repo.is_empty()
        && repo.len() <= 100
        && repo != "."
        && repo != ".."
        && repo
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
}

fn config(resource: &Value) -> &Value {
    resource.get("github").unwrap_or(resource)
}

fn snapshots(github: &Value) -> impl Iterator<Item = &Value> {
    github
        .get("envStates")
        .and_then(Value::as_object)
        .into_iter()
        .flat_map(|states| states.values())
}

fn repos(github: &Value) -> impl Iterator<Item = &Value> {
    snapshots(github)
        .flat_map(|snapshot| snapshot.get("repos").and_then(Value::as_array).into_iter().flatten())
        .chain(github.get("repos").and_then(Value::as_array).into_iter().flatten())
}

fn owner_matches(github: &Value, login: &str) -> bool {
    github["owner"]["login"]
        .as_str()
        .is_some_and(|owner| owner.eq_ignore_ascii_case(login))
}

fn allowed_repo(github: &Value, name: &str) -> bool {
    let Some((owner, _)) = name.split_once('/') else {
        return false;
    };
    if !safe_repo(name) || !owner_matches(github, owner) || github["migrationPending"] == true {
        return false;
    }
    let known = repos(github).find(|repo| {
        repo["name"]
            .as_str()
            .is_some_and(|known| known.eq_ignore_ascii_case(name))
    });
    if let Some(repo) = known {
        if repo["ownerId"] != github["owner"]["id"] {
            return false;
        }
        let id = repo["id"].as_str().unwrap_or("");
        return if github["mode"] == "auto" {
            !github["excludedRepoIds"]
                .as_array()
                .is_some_and(|ids| ids.iter().any(|entry| entry == id))
        } else {
            github["selectedRepoIds"]
                .as_array()
                .is_some_and(|ids| ids.iter().any(|entry| entry == id))
        };
    }
    // A future repository can be verified by the runner only in a completely checked
    // automatic owner scope. It must then compare its actual stable ID to exclusions.
    github["mode"] == "auto" && snapshots(github).any(|snapshot| snapshot["status"] == "complete")
}

fn positional(args: &[String], begin: usize) -> Vec<&str> {
    let mut out = Vec::new();
    let mut index = begin;
    while index < args.len() {
        let word = &args[index];
        if [
            "-R",
            "--repo",
            "--hostname",
            "--host",
            "-X",
            "--method",
            "--jq",
            "--template",
            "--json",
            "-f",
            "--raw-field",
            "-F",
            "--field",
            "--input",
            "--header",
            "-H",
            "--cache",
            "--limit",
            "-L",
            "-C",
            "--git-dir",
            "--work-tree",
        ]
        .contains(&word.as_str())
        {
            index += 2;
        } else if word.starts_with('-') {
            index += 1;
        } else {
            out.push(word.as_str());
            index += 1;
        }
    }
    out
}

fn git_positional(args: &[String], begin: usize) -> Vec<&str> {
    let mut out = Vec::new();
    let mut index = begin;
    while index < args.len() {
        let word = &args[index];
        if [
            "--receive-pack",
            "--exec",
            "--push-option",
            "-o",
            "--repo",
            "-C",
            "--git-dir",
            "--work-tree",
        ]
        .contains(&word.as_str())
        {
            index += 2;
        } else if word.starts_with('-') {
            index += 1;
        } else {
            out.push(word.as_str());
            index += 1;
        }
    }
    out
}

fn api_endpoint(args: &[String]) -> Option<&str> {
    positional(args, 1).into_iter().next()
}

fn endpoint_parts(endpoint: &str) -> Result<Vec<&str>, &'static str> {
    if endpoint.len() > 4096
        || endpoint.chars().any(char::is_control)
        || endpoint.contains(['%', '#', '\\'])
        || endpoint.contains("..")
        || endpoint.contains("://")
    {
        return Err("cli-scope");
    }
    let path = endpoint.trim_start_matches('/').split('?').next().unwrap_or("");
    let parts: Vec<_> = path.split('/').collect();
    if parts.iter().any(|part| part.is_empty()) {
        return Err("cli-scope");
    }
    Ok(parts)
}

fn remote_repo(remote: &str, github: &Value) -> Option<String> {
    let host = github["host"].as_str()?;
    let path = if let Some(rest) = remote.strip_prefix("git@") {
        let (actual, path) = rest.split_once(':')?;
        if !actual.eq_ignore_ascii_case(host) {
            return None;
        }
        path
    } else if let Some(rest) = remote
        .strip_prefix("https://")
        .or_else(|| remote.strip_prefix("ssh://git@"))
    {
        let (actual, path) = rest.split_once('/')?;
        if !actual.eq_ignore_ascii_case(host) {
            return None;
        }
        path
    } else {
        return None;
    };
    let name = path.strip_suffix(".git").unwrap_or(path);
    safe_repo(name).then(|| name.to_string())
}

/// Extract a repository explicitly named in CLI argv. `None` is reserved for bound
/// owner-list/identity queries, or git remotes the runner must resolve from its cwd.
pub fn target(resource: &Value, args: &[String], tool: Option<&str>) -> Result<Option<String>, &'static str> {
    let github = config(resource);
    let args = words(args);
    if tool == Some("git") {
        if args.first().is_none_or(|word| word != "push")
            || args.iter().any(|word| {
                [
                    "-c",
                    "-C",
                    "--config-env",
                    "--repo",
                    "--receive-pack",
                    "--exec",
                    "--git-dir",
                    "--work-tree",
                ]
                .iter()
                .any(|option| word.as_str() == *option || word.starts_with(format!("{option}=").as_str()))
            })
        {
            return Err("cli-scope");
        }
        let remote = git_positional(args, 1).into_iter().next();
        return match remote {
            Some(remote) if remote.contains("://") || remote.starts_with("git@") => {
                let name = remote_repo(remote, github).ok_or("cli-scope")?;
                allowed_repo(github, &name).then_some(Some(name)).ok_or("cli-scope")
            }
            _ => Ok(None),
        };
    }
    if let Some(host) = option(args, &["--hostname", "--host"])?
        && !github["host"]
            .as_str()
            .is_some_and(|actual| actual.eq_ignore_ascii_case(host))
    {
        return Err("cli-account");
    }
    if let Some(repo) = option(args, &["--repo", "-R"])? {
        if !safe_repo(repo) || !allowed_repo(github, repo) {
            return Err("cli-scope");
        }
        // A second API or repo positional target must not override the scoped flag.
        if args.first().is_some_and(|word| word == "api") {
            let parts = endpoint_parts(api_endpoint(args).ok_or("cli-scope")?)?;
            if parts.first() != Some(&"repos")
                || parts.len() < 3
                || !format!("{}/{}", parts[1], parts[2]).eq_ignore_ascii_case(repo)
            {
                return Err("cli-scope");
            }
        }
        if args.first().is_some_and(|word| word == "repo")
            && let Some(positional) = positional(args, 2).into_iter().next()
            && !positional.eq_ignore_ascii_case(repo)
        {
            return Err("cli-scope");
        }
        return Ok(Some(repo.to_string()));
    }
    match args.first().map(String::as_str) {
        Some("--version" | "version") => Ok(None),
        Some("auth") if args.get(1).is_some_and(|word| word == "status") => Ok(None),
        Some("api") => {
            let parts = endpoint_parts(api_endpoint(args).ok_or("cli-scope")?)?;
            if parts.first() == Some(&"repos") && parts.len() >= 3 {
                let name = format!("{}/{}", parts[1], parts[2]);
                return allowed_repo(github, &name).then_some(Some(name)).ok_or("cli-scope");
            }
            if parts.as_slice() == ["user"] {
                return Ok(None);
            }
            if parts.len() == 3 && parts[0] == "orgs" && parts[2] == "repos" && owner_matches(github, parts[1]) {
                return Ok(None);
            }
            if parts.as_slice() == ["user", "repos"] && github["owner"]["kind"] == "user" {
                return Ok(None);
            }
            Err("cli-scope")
        }
        Some("repo") if args.get(1).is_some_and(|word| word == "list") => {
            let owner = positional(args, 2).into_iter().next().ok_or("cli-scope")?;
            owner_matches(github, owner).then_some(None).ok_or("cli-scope")
        }
        Some("repo") => {
            let name = positional(args, 2).into_iter().next().ok_or("cli-scope")?;
            allowed_repo(github, name)
                .then_some(Some(name.to_string()))
                .ok_or("cli-scope")
        }
        _ => Err("cli-scope"),
    }
}

fn credential_path(value: &str) -> bool {
    let value = value.to_ascii_lowercase();
    value.split(['/', '\\', '?', '&', '=', ':']).any(|part| {
        part == ".env"
            || part.starts_with(".env.")
            || part == "shadow"
            || part == "credentials"
            || part.ends_with(".pem")
            || part.ends_with(".key")
            || part.starts_with("id_")
            || matches!(part, ".ssh" | ".aws" | ".oci" | ".kube")
    })
}

fn method(args: &[String]) -> Result<String, &'static str> {
    let explicit = option(args, &["-X", "--method"])?;
    let fields = args.iter().any(|word| {
        word.starts_with("-f")
            || word.starts_with("-F")
            || word == "--field"
            || word == "--raw-field"
            || word.starts_with("--field=")
            || word.starts_with("--raw-field=")
    });
    Ok(explicit
        .unwrap_or(if fields { "POST" } else { "GET" })
        .to_ascii_uppercase())
}

fn api_read(parts: &[&str]) -> bool {
    if parts == ["user"] || parts == ["user", "repos"] || parts.len() == 3 && parts[0] == "orgs" && parts[2] == "repos"
    {
        return true;
    }
    if parts.first() != Some(&"repos") || parts.len() < 3 {
        return false;
    }
    let rest = &parts[3..];
    if rest.is_empty() {
        return true;
    }
    match rest[0] {
        "contents" => true, // credential paths are rejected before endpoint classification
        "pulls" | "issues" => {
            rest.len() <= 2
                || rest.len() == 3 && matches!(rest[2], "comments" | "files" | "reviews" | "commits" | "checks")
        }
        "branches" | "commits" | "tags" | "languages" | "topics" | "contributors" => rest.len() <= 2,
        "releases" => rest.len() <= 2 || rest.len() == 3 && rest[1] == "tags",
        "deployments" => rest.len() <= 2 || rest.len() == 3 && rest[2] == "statuses",
        "actions" => {
            rest.len() == 2 && matches!(rest[1], "runs" | "workflows" | "secrets")
                || rest.len() == 3 && matches!(rest[1], "runs" | "workflows" | "secrets")
                || rest.len() == 4 && rest[1] == "runs" && matches!(rest[3], "jobs" | "logs")
        }
        "environments" => matches!(rest.len(), 3 | 4) && rest[2] == "secrets",
        "git" => {
            rest.len() == 3 && matches!(rest[1], "trees" | "commits")
                || rest.len() >= 3 && matches!(rest[1], "ref" | "refs" | "matching-refs")
        }
        _ => false,
    }
}

fn git_judge(github: &Value, args: &[String]) -> Option<&'static str> {
    let push = args.iter().position(|word| word == "push")?;
    let rest = &args[push + 1..];
    let force = rest.iter().any(|word| {
        word == "--force"
            || word.starts_with('-') && !word.starts_with("--") && word.contains('f')
            || word.starts_with("--force-with-lease")
            || word.starts_with('+')
            || word.starts_with("--force-if-includes")
    });
    if !force {
        return None;
    } // ordinary local git operations are deliberately not newly managed
    if rest
        .iter()
        .any(|word| matches!(word.as_str(), "--all" | "--mirror" | "--tags" | "--delete"))
    {
        return Some("github-default-force");
    }
    let positions = git_positional(args, push + 1);
    let refspecs = positions.get(1..).unwrap_or(&[]);
    if refspecs.is_empty() {
        return Some("github-default-force");
    }
    let defaults: Vec<_> = repos(github)
        .filter(|repo| repo["selected"] != false)
        .filter_map(|repo| repo["defaultBranch"].as_str())
        .collect();
    if defaults.is_empty() {
        return Some("github-default-force");
    }
    for spec in refspecs {
        let destination = spec
            .trim_start_matches('+')
            .rsplit(':')
            .next()
            .unwrap_or("")
            .trim_start_matches("refs/heads/");
        if destination.is_empty()
            || destination == "HEAD"
            || destination.contains(['*', '?'])
            || defaults.contains(&destination)
        {
            return Some("github-default-force");
        }
    }
    Some(if github.get("mode").is_none() {
        "cli-scope"
    } else {
        "github-delete"
    })
}

fn routine_options(args: &[String]) -> bool {
    crate::shell::checked_arguments(
        args,
        &[
            "--draft",
            "--fill",
            "--fill-first",
            "--fill-verbose",
            "--merge",
            "--squash",
            "--rebase",
            "--auto",
            "--disable-auto",
            "--delete-branch",
            "--approve",
            "--request-changes",
            "--comment",
            "--edit-last",
            "--create-if-none",
            "--failed",
            "--debug",
            "--prerelease",
            "--generate-notes",
            "--verify-tag",
            "--fail-on-no-commits",
            "--force",
            "--yes",
            "-y",
            "--json",
        ],
        &[
            "--repo",
            "-R",
            "--title",
            "-t",
            "--body",
            "-b",
            "--body-file",
            "-F",
            "--base",
            "-B",
            "--head",
            "-H",
            "--reviewer",
            "-r",
            "--assignee",
            "-a",
            "--label",
            "-l",
            "--milestone",
            "-m",
            "--project",
            "-p",
            "--template",
            "--reason",
            "--add-label",
            "--remove-label",
            "--add-assignee",
            "--remove-assignee",
            "--add-reviewer",
            "--remove-reviewer",
            "--add-project",
            "--remove-project",
            "--subject",
            "--match-head-commit",
            "--ref",
            "--field",
            "-f",
            "--raw-field",
            "--job",
            "--notes",
            "-n",
            "--notes-file",
            "--target",
            "--discussion-category",
            "--color",
            "-c",
            "--description",
            "-d",
            "--name",
            "--notes-start-tag",
        ],
    )
    .is_some()
}

/// None means a supported allowance; a reason is either a permanent denial, an
/// ordinary write, a high-risk operation, or target-clear but unparsed structure.
pub fn judge(resource: &Value, args: &[String], tool: Option<&str>) -> Option<&'static str> {
    let github = config(resource);
    let args = words(args);
    if args.is_empty()
        || args.len() > 1024
        || args
            .iter()
            .any(|word| word.len() > 65536 || word.chars().any(char::is_control))
    {
        return Some("unparsed");
    }
    if tool == Some("git") {
        let reason = git_judge(github, args);
        if reason == Some("github-delete")
            && let Err(reason) = target(resource, args, tool)
        {
            return Some(reason);
        }
        return reason;
    }
    let verb = args.first().map(String::as_str).unwrap_or("");
    let sub = args.get(1).map(String::as_str).unwrap_or("");
    // Credentials and destructive repository/default-branch operations win even
    // over missing targets or parse failures, and are never approval candidates.
    if verb == "auth"
        && (sub == "token"
            || args.iter().any(|word| {
                matches!(word.as_str(), "--show-token" | "-t" | "-at" | "-ta")
                    || ["--show-token=", "-t="].iter().any(|prefix| {
                        word.strip_prefix(*prefix)
                            .is_some_and(|value| !["false", "False", "FALSE", "0"].contains(&value))
                    })
            }))
        || verb == "variable"
        || verb == "secret" && sub != "list"
        || args.iter().any(|word| credential_path(word))
    {
        return Some("credential-read");
    }
    if verb == "repo" && sub == "delete" {
        return Some("github-repo-delete");
    }
    if verb == "api" {
        let parts = match api_endpoint(args).and_then(|endpoint| endpoint_parts(endpoint).ok()) {
            Some(parts) => parts,
            None => return Some("cli-scope"),
        };
        if parts
            .iter()
            .any(|part| matches!(*part, "variables" | "token" | "tokens" | "credentials" | "hooks"))
            || parts.first() == Some(&"user")
                && parts.len() > 1
                && matches!(parts[1], "keys" | "gpg_keys" | "ssh_signing_keys")
        {
            return Some("credential-read");
        }
        let method = match method(args) {
            Ok(method) => method,
            Err(reason) => return Some(reason),
        };
        if method == "DELETE" && parts.first() == Some(&"repos") && parts.len() == 3 {
            return Some("github-repo-delete");
        }
        if method != "GET" && parts.windows(2).any(|pair| pair == ["git", "refs"]) {
            if option(args, &["--input"]).ok().flatten().is_some() {
                return Some(
                    if !parts.contains(&"heads")
                        || repos(github).any(|repo| repo["defaultBranch"] == parts.last().copied().unwrap_or(""))
                    {
                        "github-default-force"
                    } else {
                        "unparsed"
                    },
                );
            }
            if args
                .iter()
                .any(|word| word.ends_with("force=true") || word.ends_with("force=1"))
            {
                let branch = parts.last().copied().unwrap_or("");
                if !parts.contains(&"heads") || repos(github).any(|repo| repo["defaultBranch"] == branch) {
                    return Some("github-default-force");
                }
                return Some("github-delete");
            }
        }
    }
    if let Err(reason) = target(resource, args, tool) {
        return Some(reason);
    }
    let auto_ops = resource["mode"] == "auto-ops";
    if verb == "api" {
        let parts = match endpoint_parts(api_endpoint(args).unwrap_or("")) {
            Ok(parts) => parts,
            Err(reason) => return Some(reason),
        };
        let method = match method(args) {
            Ok(method) => method,
            Err(reason) => return Some(reason),
        };
        if method == "GET" {
            return (!api_read(&parts)).then_some("unparsed");
        }
        // An arbitrary write endpoint is not an established routine operation.
        // Deletion content is always an approval candidate; other writes follow the
        // mode after the explicit repo target has been verified.
        if method == "DELETE" {
            return Some("github-delete");
        }
        return if auto_ops { None } else { Some("unparsed") };
    }
    let query = matches!(
        (verb, sub),
        ("repo", "view" | "list")
            | ("pr", "list" | "view" | "diff" | "checks" | "status")
            | ("issue", "list" | "view" | "status")
            | ("run", "list" | "view" | "watch")
            | ("workflow", "list" | "view")
            | ("release", "list" | "view")
            | ("label", "list")
            | ("secret", "list")
    );
    if query {
        if args.iter().any(|word| word == "--web") {
            return Some("unparsed");
        }
        if verb == "secret"
            && option(args, &["--json"]).ok().flatten().is_some_and(|fields| {
                fields
                    .split(',')
                    .any(|field| !["name", "updatedAt", "visibility", "selectedRepositoriesUrl"].contains(&field))
            })
        {
            return Some("credential-read");
        }
        return None;
    }
    if verb == "auth" && sub == "status" {
        return (!args.iter().any(|word| word == "--no-refresh")).then_some("unparsed");
    }
    if verb == "--version" || verb == "version" {
        return None;
    }
    let deletion = matches!((verb, sub), ("release", "delete") | ("run", "delete"));
    if deletion {
        return Some("github-delete");
    }
    let dangerous = matches!((verb, sub), ("repo", "archive" | "edit") | ("workflow", "disable"))
        || verb == "pr" && args.iter().any(|word| word == "--admin");
    if dangerous {
        return (!auto_ops).then_some("github-dangerous");
    }
    let write = matches!(
        (verb, sub),
        (
            "pr",
            "create" | "edit" | "merge" | "close" | "reopen" | "comment" | "review" | "ready"
        ) | ("issue", "create" | "edit" | "close" | "reopen" | "comment")
            | ("run", "cancel" | "rerun")
            | ("workflow", "run" | "enable")
            | ("release", "create" | "edit" | "upload")
            | ("label", "create" | "edit")
    );
    if write {
        return if routine_options(args) {
            (!auto_ops).then_some("cli-write")
        } else if auto_ops {
            None
        } else {
            Some("unparsed")
        };
    }
    if auto_ops { None } else { Some("unparsed") }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn resource(mode: &str) -> Value {
        json!({"mode":mode,"github":{"host":"github.com","owner":{"id":"O1","login":"acme","kind":"organization"},"mode":"auto","selectedRepoIds":[],"excludedRepoIds":["repo:R2"],"envStates":{"windows":{"status":"complete","repos":[{"id":"repo:R1","name":"acme/app","ownerId":"O1","defaultBranch":"main","selected":true},{"id":"repo:R2","name":"acme/private","ownerId":"O1","defaultBranch":"trunk","selected":false}]}},"migrationPending":false}})
    }
    fn args(words: &[&str]) -> Vec<String> {
        words.iter().map(|word| (*word).into()).collect()
    }
    #[test]
    fn queries_and_writes_are_not_conflated() {
        for words in [
            vec!["repo", "view", "acme/app"],
            vec!["pr", "list", "-R", "acme/app"],
            vec!["pr", "diff", "12", "--repo=acme/app"],
            vec!["run", "view", "1", "--repo", "acme/app"],
            vec!["api", "repos/acme/app/pulls"],
            vec!["api", "repos/acme/app/git/ref/heads/main"],
            vec!["api", "repos/acme/app/git/matching-refs/heads"],
            vec!["api", "orgs/acme/repos"],
            vec!["secret", "list", "-R", "acme/app"],
        ] {
            assert_eq!(
                judge(&resource("confirm-changes"), &args(&words), None),
                None,
                "{words:?}"
            );
        }
        assert_eq!(
            judge(
                &resource("confirm-changes"),
                &args(&["pr", "merge", "1", "-R", "acme/app"]),
                None
            ),
            Some("cli-write")
        );
        assert_eq!(
            judge(
                &resource("auto-ops"),
                &args(&["pr", "merge", "1", "-R", "acme/app"]),
                None
            ),
            None
        );
        assert_eq!(
            judge(&resource("auto-ops"), &args(&["repo", "archive", "acme/app"]), None),
            None
        );
        assert_eq!(
            judge(
                &resource("confirm-changes"),
                &args(&["repo", "archive", "acme/app"]),
                None
            ),
            Some("github-dangerous")
        );
        assert_eq!(
            judge(
                &resource("auto-ops"),
                &args(&["release", "delete", "1", "-R", "acme/app"]),
                None
            ),
            Some("github-delete")
        );
    }
    #[test]
    fn credentials_and_repository_delete_are_never_approvable() {
        for mode in ["confirm-changes", "auto-ops"] {
            for words in [
                vec!["auth", "token"],
                vec!["auth", "status", "--no-refresh", "--show-token"],
                vec!["auth", "status", "-t", "--no-refresh"],
                vec!["auth", "status", "--show-token=true", "--no-refresh"],
                vec!["auth", "status", "-at", "--no-refresh"],
                vec!["api", "repos/acme/app/contents/.ssh/config"],
                vec!["api", "repos/acme/app/contents/id_ecdsa"],
                vec!["variable", "list", "-R", "acme/app"],
                vec!["api", "repos/acme/app/actions/variables"],
                vec!["api", "repos/acme/app/contents/.env.production"],
                vec!["secret", "list", "-R", "acme/app", "--json", "name,value"],
            ] {
                assert_eq!(
                    judge(&resource(mode), &args(&words), None),
                    Some("credential-read"),
                    "{words:?}"
                );
            }
            assert_eq!(
                judge(&resource(mode), &args(&["repo", "delete", "acme/app"]), None),
                Some("github-repo-delete")
            );
            assert_eq!(
                judge(&resource(mode), &args(&["api", "repos/acme/app", "-X", "DELETE"]), None),
                Some("github-repo-delete")
            );
        }
    }
    #[test]
    fn get_is_not_inherently_safe_and_host_owner_scope_are_checked() {
        assert_eq!(
            judge(
                &resource("auto-ops"),
                &args(&["api", "repos/acme/app/actions/artifacts/1/zip"]),
                None
            ),
            Some("unparsed")
        );
        assert_eq!(
            judge(
                &resource("confirm-changes"),
                &args(&["repo", "view", "other/app"]),
                None
            ),
            Some("cli-scope")
        );
        assert_eq!(
            judge(&resource("auto-ops"), &args(&["repo", "view", "acme/private"]), None),
            Some("cli-scope")
        );
        assert_eq!(
            judge(
                &resource("auto-ops"),
                &args(&["api", "--hostname", "elsewhere.example", "repos/acme/app"]),
                None
            ),
            Some("cli-account")
        );
        assert_eq!(
            judge(
                &resource("auto-ops"),
                &args(&["api", "repos/other/app", "-R", "acme/app"]),
                None
            ),
            Some("cli-scope")
        );
    }
    #[test]
    fn future_auto_targets_require_a_complete_snapshot_and_manual_cannot_expand() {
        let mut value = resource("auto-ops");
        assert_eq!(judge(&value, &args(&["repo", "view", "acme/new"]), None), None);
        value["github"]["envStates"]["windows"]["status"] = "partial".into();
        assert_eq!(
            judge(&value, &args(&["repo", "view", "acme/new"]), None),
            Some("cli-scope")
        );
        value["github"]["mode"] = "manual".into();
        assert_eq!(
            judge(&value, &args(&["repo", "view", "acme/new"]), None),
            Some("cli-scope")
        );
    }
    #[test]
    fn git_target_overrides_cannot_change_the_repository_after_preflight() {
        for words in [
            vec!["-C", "elsewhere", "push", "--force", "origin", "feature"],
            vec![
                "push",
                "--force",
                "origin",
                "feature",
                "--repo=https://github.com/other/app",
            ],
            vec![
                "push",
                "--force",
                "origin",
                "feature",
                "--receive-pack=arbitrary-command",
            ],
        ] {
            assert_eq!(
                target(&resource("auto-ops"), &args(&words), Some("git")),
                Err("cli-scope")
            );
        }
        assert_eq!(
            target(
                &resource("auto-ops"),
                &args(&["push", "--force", "https://github.com/other/app.git", "feature"]),
                Some("git")
            ),
            Err("cli-scope")
        );
        assert_eq!(
            target(
                &resource("auto-ops"),
                &args(&["push", "--force", "https://github.com/acme/app.git", "feature"]),
                Some("git")
            ),
            Ok(Some("acme/app".into()))
        );
    }

    #[test]
    fn force_default_or_unspecified_branch_is_red_line_but_ordinary_git_stays_outside() {
        for words in [
            vec!["push", "--force", "origin"],
            vec!["push", "--force", "origin", "main"],
            vec!["push", "origin", "+HEAD:refs/heads/main"],
            vec!["push", "--force-with-lease", "origin", "HEAD"],
            vec!["push", "-f", "--all", "origin"],
        ] {
            assert_eq!(
                judge(&resource("auto-ops"), &args(&words), Some("git")),
                Some("github-default-force"),
                "{words:?}"
            );
        }
        assert_eq!(
            judge(
                &resource("auto-ops"),
                &args(&["push", "--force", "origin", "HEAD:feature"]),
                Some("git")
            ),
            Some("github-delete")
        );
        assert_eq!(
            judge(
                &resource("confirm-changes"),
                &args(&["push", "--force", "origin", "HEAD:feature"]),
                Some("git")
            ),
            Some("github-delete")
        );
        assert_eq!(
            judge(
                &resource("confirm-changes"),
                &args(&["push", "origin", "main"]),
                Some("git")
            ),
            None
        );
        assert_eq!(
            judge(
                &resource("confirm-changes"),
                &args(&["commit", "-m", "ordinary"]),
                Some("git")
            ),
            None
        );
    }
}
