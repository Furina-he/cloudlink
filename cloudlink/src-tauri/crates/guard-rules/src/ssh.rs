use crate::shell::{self, Simple};

pub(crate) fn credential_path(word: &str) -> bool {
    let lower = word.to_ascii_lowercase().replace('\\', "/");
    let path = lower.split_once('=').map_or(lower.as_str(), |(_, value)| value);
    path.split('/').any(|part| {
        part.starts_with(".env")
            || part == ".ssh"
            || part.starts_with("id_")
            || part.ends_with(".pem")
            || part.ends_with(".key")
            || part == "authorized_keys"
    }) || path.contains("/etc/shadow")
        || path.contains(".aws/credentials")
        || path.contains(".oci/config")
}

pub(crate) fn destination(word: &str) -> String {
    let word = word
        .strip_prefix("ssh://")
        .or_else(|| word.strip_prefix("sftp://"))
        .unwrap_or(word);
    let host = word.rsplit_once('@').map_or(word, |(_, host)| host);
    if host.starts_with('[') {
        return host
            .split_once(']')
            .map_or(host, |(h, _)| h.trim_start_matches('['))
            .to_ascii_lowercase();
    }
    if host.matches(':').count() <= 1 {
        host.split(':').next().unwrap_or(host).to_ascii_lowercase()
    } else {
        host.to_ascii_lowercase()
    }
}

#[derive(Default)]
pub(crate) struct Invocation {
    pub target: String,
    pub remote: String,
    pub no_contact: bool,
    pub unsupported: bool,
}

pub(crate) fn invocation(words: &[String]) -> Invocation {
    let mut out = Invocation::default();
    let mut i = 1;
    let mut options = true;
    while i < words.len() {
        let value = &words[i];
        if options && value == "--" {
            options = false;
            i += 1;
            continue;
        }
        if options && value.starts_with('-') && value != "-" {
            let chars: Vec<char> = value.chars().skip(1).collect();
            let mut n = 0;
            while n < chars.len() {
                let option = chars[n];
                if ['G', 'V', 'Q'].contains(&option) {
                    out.no_contact = true;
                }
                if ['L', 'R', 'D', 'W', 'w', 'N', 's', 'O'].contains(&option) {
                    out.unsupported = true;
                }
                if "BbcDEeFIiJLlmOopQRSWw".contains(option) {
                    let parameter = if n + 1 < chars.len() {
                        chars[n + 1..].iter().collect::<String>()
                    } else {
                        i += 1;
                        if let Some(parameter) = words.get(i) {
                            parameter.clone()
                        } else {
                            out.unsupported = true;
                            break;
                        }
                    };
                    if option == 'o' {
                        let setting = parameter.to_ascii_lowercase();
                        if [
                            "proxycommand",
                            "localcommand",
                            "remotecommand",
                            "hostname",
                            "controlpath",
                            "permitlocalcommand",
                            "forward",
                        ]
                        .iter()
                        .any(|s| setting.starts_with(s))
                        {
                            out.unsupported = true;
                        }
                    }
                    break;
                }
                if !"46AaCfGgKkMNnqsTtVvXxYy".contains(option) {
                    out.unsupported = true;
                }
                n += 1;
            }
            i += 1;
            continue;
        }
        out.target = destination(value);
        out.remote = words[i + 1..].join(" ");
        // Without --, OpenSSH can still interpret options after the destination.
        if options && words.get(i + 1).is_some_and(|v| v.starts_with('-')) {
            out.unsupported = true;
        }
        break;
    }
    out
}

fn command_words(words: &[String]) -> &[String] {
    let i = shell::executable(words);
    words.get(i..).unwrap_or_default()
}

fn subcommand(words: &[String], start: usize, takes_value: &[&str]) -> usize {
    let mut i = start;
    while i < words.len() && words[i].starts_with('-') {
        if takes_value.contains(&words[i].as_str()) {
            i += 1;
        }
        i += 1;
    }
    i
}

fn docker_parts(words: &[String]) -> &[String] {
    let start = subcommand(
        words,
        1,
        &["-H", "--host", "--context", "-c", "--config", "--log-level"],
    );
    words.get(start..).unwrap_or_default()
}

fn compose_parts(parts: &[String]) -> &[String] {
    let start = subcommand(
        parts,
        1,
        &[
            "-f",
            "--file",
            "-p",
            "--project-name",
            "--project-directory",
            "--env-file",
            "--profile",
        ],
    );
    parts.get(start..).unwrap_or_default()
}

fn exec_inner(parts: &[String]) -> &[String] {
    let container = subcommand(
        parts,
        1,
        &[
            "-u",
            "--user",
            "-w",
            "--workdir",
            "-e",
            "--env",
            "--env-file",
            "--detach-keys",
        ],
    );
    parts.get(container + 1..).unwrap_or_default()
}

fn critical_match(word: &str, critical: &[String]) -> bool {
    let word = word.trim_start_matches('/').trim_end_matches(".service");
    critical
        .iter()
        .any(|c| c.trim_start_matches('/').trim_end_matches(".service") == word)
}

fn firewall_query(words: &[String]) -> bool {
    match words.first().map(|s| shell::binary(s)) {
        Some("iptables" | "ip6tables") => {
            words
                .iter()
                .any(|v| ["-L", "--list", "-S", "--list-rules"].contains(&v.as_str()))
                && !words.iter().any(|v| {
                    [
                        "-A",
                        "-I",
                        "-D",
                        "-F",
                        "-X",
                        "-P",
                        "-R",
                        "-N",
                        "-Z",
                        "--append",
                        "--insert",
                        "--delete",
                        "--flush",
                        "--policy",
                        "--replace",
                        "--new-chain",
                        "--zero",
                    ]
                    .contains(&v.as_str())
                })
        }
        Some("nft") => words.get(1).is_some_and(|v| v == "list"),
        Some("ufw") => words.get(1).is_some_and(|v| v == "status" || v == "show"),
        Some("firewall-cmd") => {
            words.iter().skip(1).any(|v| {
                v.starts_with("--list") || v.starts_with("--get") || v.starts_with("--query") || v == "--state"
            }) && words.iter().skip(1).all(|v| {
                v.starts_with("--list")
                    || v.starts_with("--get")
                    || v.starts_with("--query")
                    || v.starts_with("--zone=")
                    || v == "--state"
                    || v == "--permanent"
                    || v == "--quiet"
            })
        }
        _ => false,
    }
}

fn dangerous(words: &[String], critical: &[String], depth: usize) -> Option<&'static str> {
    if depth > 8 {
        return None;
    }
    if words.iter().any(|s| credential_path(s)) {
        return Some("credential-read");
    }
    let executable = shell::executable(words);
    if words
        .iter()
        .take(executable.saturating_add(1))
        .any(|word| matches!(shell::binary(word), "env" | "printenv"))
    {
        return Some("credential-read");
    }
    let words = command_words(words);
    let name = words.first().map(|s| shell::binary(s)).unwrap_or("");
    let all = words.join(" ").to_ascii_lowercase();
    if ["env", "printenv"].contains(&name) {
        return Some("credential-read");
    }
    if ["sh", "bash", "dash", "zsh"].contains(&name)
        && let Some(i) = words.iter().position(|s| s == "-c" || s == "-lc")
        && let Some(script) = words.get(i + 1)
    {
        let parsed = shell::parse(script);
        for simple in &parsed.commands {
            if let Some(reason) = dangerous(&simple.words, critical, depth + 1) {
                return Some(reason);
            }
        }
    }
    if name == "docker" {
        let parts = docker_parts(words);
        if parts.first().is_some_and(|s| s == "inspect") || parts.get(1).is_some_and(|s| s == "inspect") {
            return Some("credential-read");
        }
        if parts.first().is_some_and(|s| s == "exec") {
            return dangerous(exec_inner(parts), critical, depth + 1);
        }
        if parts.first().is_some_and(|s| s == "volume")
            && parts.get(1).is_some_and(|s| s == "rm" || s == "remove" || s == "prune")
            || parts.first().is_some_and(|s| s == "system")
                && parts.get(1).is_some_and(|s| s == "prune")
                && parts.iter().any(|s| s == "--volumes" || s.starts_with("--volumes="))
        {
            return Some("volume-delete");
        }
        let parts = if parts.first().is_some_and(|s| s == "compose") {
            let parts = compose_parts(parts);
            if parts.first().is_some_and(|s| s == "config")
                && parts.iter().any(|s| s == "--environment" || s == "--variables")
            {
                return Some("credential-read");
            }
            if parts.first().is_some_and(|s| s == "down")
                && parts.iter().any(|s| {
                    s == "--volumes"
                        || s.starts_with("--volumes=")
                        || (s.starts_with('-') && !s.starts_with("--") && s.contains('v'))
                })
            {
                return Some("volume-delete");
            }
            if !critical.is_empty() && parts.first().is_some_and(|s| s == "down") {
                return Some("critical-service");
            }
            if !critical.is_empty()
                && parts
                    .first()
                    .is_some_and(|s| ["stop", "restart", "kill", "rm", "remove"].contains(&s.as_str()))
                && !parts.iter().skip(1).any(|s| !s.starts_with('-'))
            {
                return Some("critical-service");
            }
            parts
        } else if parts.first().is_some_and(|s| s == "container") {
            &parts[1..]
        } else {
            parts
        };
        if parts
            .first()
            .is_some_and(|s| ["stop", "restart", "kill", "rm", "remove"].contains(&s.as_str()))
            && parts.iter().skip(1).any(|s| critical_match(s, critical))
        {
            return Some("critical-service");
        }
    }
    if name == "docker-compose" {
        let mut normalized = vec!["docker".to_string(), "compose".to_string()];
        normalized.extend_from_slice(&words[1..]);
        return dangerous(&normalized, critical, depth + 1);
    }
    if name.starts_with("mkfs")
        || ["wipefs", "dropdb"].contains(&name)
        || name == "dd" && words.iter().any(|s| s.starts_with("of=/dev/"))
        || name == "redis-cli"
            && words
                .iter()
                .any(|s| s.eq_ignore_ascii_case("flushall") || s.eq_ignore_ascii_case("flushdb"))
        || ["psql", "mysql"].contains(&name)
            && (all.contains("drop database") || all.contains("drop schema") || all.contains("truncate table"))
    {
        return Some("data-delete");
    }
    if name == "rm"
        && words.iter().any(|s| {
            s == "--recursive" || s.starts_with('-') && !s.starts_with("--") && (s.contains('r') || s.contains('R'))
        })
    {
        for target in words.iter().skip(1).filter(|s| !s.starts_with('-')) {
            let parts: Vec<_> = target.split('/').filter(|p| !p.is_empty() && *p != ".").collect();
            if target.starts_with('/') && (parts.len() <= 2 || parts.contains(&".."))
                || target == "~"
                || target == "~/"
                || target.starts_with("$HOME")
            {
                return Some("data-delete");
            }
        }
    }
    if ["reboot", "shutdown", "poweroff", "halt"].contains(&name)
        || name == "init" && words.get(1).is_some_and(|s| s == "0" || s == "6")
        || name == "systemctl"
            && words
                .iter()
                .any(|s| ["reboot", "poweroff", "halt", "kexec", "rescue", "emergency"].contains(&s.as_str()))
    {
        return Some("host-reboot");
    }
    if ["iptables", "ip6tables", "nft", "ufw", "firewall-cmd"].contains(&name) && !firewall_query(words) {
        return Some("firewall");
    }
    if words
        .iter()
        .any(|w| w.contains("/etc/ssh/") || w.ends_with("sshd_config"))
        && !["cat", "head", "tail", "less", "grep", "stat", "ls"].contains(&name)
    {
        return Some("ssh-config");
    }
    if ["systemctl", "service", "pkill", "killall"].contains(&name) {
        let disruptive = name == "pkill"
            || name == "killall"
            || words
                .iter()
                .any(|s| ["stop", "restart", "kill", "disable", "mask", "reload-or-restart"].contains(&s.as_str()));
        if disruptive
            && words
                .iter()
                .any(|s| ["sshd", "ssh", "sshd.service", "ssh.service"].contains(&s.as_str()))
        {
            return Some("ssh-config");
        }
        if disruptive && words.iter().any(|s| critical_match(s, critical)) {
            return Some("critical-service");
        }
    }
    None
}

fn read_only(words: &[String], depth: usize) -> bool {
    if depth > 8 || words.is_empty() {
        return false;
    }
    let name = shell::binary(&words[0]);
    let args = &words[1..];
    let has = |needle: &str| args.iter().any(|a| a == needle);
    let first = args.first().map(String::as_str).unwrap_or("");
    match name {
        "uptime" | "nproc" | "free" | "df" | "du" | "ls" | "stat" | "cat" | "head" | "tail" | "less" | "grep"
        | "wc" | "ps" | "ss" | "netstat" | "uname" | "id" | "whoami" | "lsblk" | "findmnt" | "echo" | "which" => {
            !args
                .iter()
                .any(|a| ["--output", "--log-file", "--log-file-force", "-o"].contains(&a.as_str()) && name == "less")
                && !(name == "ss" && (has("-K") || has("--kill")))
                && !(name == "findmnt" && (has("--tab-file") || has("--verify")))
        }
        "hostname" => {
            args.is_empty()
                || args
                    .iter()
                    .all(|a| ["-f", "--fqdn", "-i", "-I", "-s", "-d", "-A", "-a"].contains(&a.as_str()))
        }
        "date" => {
            !args
                .iter()
                .any(|a| a == "-s" || a.starts_with("--set") || a == "-f" || a.starts_with("--file"))
                && args
                    .iter()
                    .all(|a| a.starts_with('-') || a.starts_with('+') || ["UTC", "utc"].contains(&a.as_str()))
        }
        "top" => {
            (has("-b") || args.iter().any(|a| a.starts_with("-b")))
                && (args.windows(2).any(|pair| pair[0] == "-n" && pair[1] == "1") || has("-n1"))
        }
        "ip" => {
            ["addr", "address", "route"].contains(&first)
                && args
                    .iter()
                    .skip(1)
                    .all(|a| ["show", "list", "-4", "-6", "-s", "-d"].contains(&a.as_str()))
        }
        "command" => has("-v") && args.len() >= 2,
        "systemctl" => {
            let action = subcommand(
                words,
                1,
                &[
                    "-H",
                    "--host",
                    "-M",
                    "--machine",
                    "--type",
                    "--state",
                    "-p",
                    "--property",
                    "-n",
                    "--lines",
                ],
            );
            (words
                .get(action)
                .is_some_and(|a| ["status", "is-active", "list-units"].contains(&a.as_str()))
                || action == words.len() && has("--failed"))
                && !args.iter().any(|a| {
                    [
                        "start",
                        "stop",
                        "restart",
                        "reload",
                        "enable",
                        "disable",
                        "kill",
                        "set-property",
                        "edit",
                        "daemon-reload",
                        "mask",
                        "unmask",
                        "reset-failed",
                    ]
                    .contains(&a.as_str())
                })
        }
        "journalctl" => !args.iter().any(|a| {
            a.starts_with("--vacuum")
                || a.starts_with("--rotate")
                || a.starts_with("--flush")
                || a.starts_with("--sync")
                || a.starts_with("--relinquish")
                || a.starts_with("--setup-keys")
                || a.starts_with("--update-catalog")
        }),
        "docker" => {
            let parts = docker_parts(words);
            match parts.first().map(String::as_str) {
                Some("ps" | "logs" | "images" | "version" | "info") => true,
                Some("stats") => parts.iter().any(|s| s == "--no-stream"),
                Some("exec") => read_only(exec_inner(parts), depth + 1),
                Some("compose") => {
                    let parts = compose_parts(parts);
                    matches!(parts.first().map(String::as_str), Some("ps" | "logs"))
                        || parts.first().is_some_and(|s| s == "config")
                            && parts.iter().any(|s| s == "--services")
                            && !parts
                                .iter()
                                .any(|s| s == "--output" || s.starts_with("--output=") || s.starts_with("-o"))
                }
                _ => false,
            }
        }
        "nginx" => {
            has("-t")
                && !args
                    .iter()
                    .any(|s| s.starts_with("-s") || s.starts_with("-g") || s.starts_with("-e"))
        }
        "openssl" => {
            (first == "s_client" || first == "x509" && has("-noout"))
                && !args.iter().any(|s| {
                    [
                        "-out",
                        "-keyout",
                        "-sess_out",
                        "-keylogfile",
                        "-writerand",
                        "-new",
                        "-signkey",
                    ]
                    .contains(&s.as_str())
                })
        }
        "curl" => {
            (has("--head")
                || args
                    .iter()
                    .any(|s| s.starts_with('-') && !s.starts_with("--") && s.contains('I')))
                && !args.iter().any(|s| {
                    [
                        "-o",
                        "-O",
                        "--output",
                        "--remote-name",
                        "-X",
                        "--request",
                        "-d",
                        "--data",
                        "--data-binary",
                        "--data-raw",
                        "-F",
                        "--form",
                        "-T",
                        "--upload-file",
                        "--next",
                        "-K",
                        "--config",
                    ]
                    .contains(&s.as_str())
                        || s.starts_with("--output=")
                        || s.starts_with("--request=")
                        || s.starts_with("--data=")
                        || s.starts_with("--config=")
                        || s.starts_with('-')
                            && !s.starts_with("--")
                            && s.chars()
                                .skip(1)
                                .any(|c| ['o', 'O', 'X', 'd', 'F', 'T', 'K'].contains(&c))
                })
        }
        _ => false,
    }
}

pub(crate) fn judge(remote: &str, standard: bool, critical: &[String], outer_unsafe: bool) -> Option<&'static str> {
    judge_inner(remote, standard, critical, outer_unsafe, 0)
}

fn judge_inner(
    remote: &str,
    standard: bool,
    critical: &[String],
    outer_unsafe: bool,
    depth: usize,
) -> Option<&'static str> {
    if depth > 8 {
        return Some("unparsed");
    }
    if remote.trim().is_empty() {
        return (!standard).then_some("interactive");
    }
    let parsed = shell::parse(remote);
    for simple in &parsed.commands {
        if simple.redirects.iter().any(|(_, path)| credential_path(path)) {
            return Some("credential-read");
        }
        if let Some(reason) = dangerous(&simple.words, critical, 0) {
            return Some(reason);
        }
        if simple
            .redirects
            .iter()
            .any(|(op, path)| op.contains('>') && (path.contains("/etc/ssh/") || path.ends_with("sshd_config")))
        {
            return Some("ssh-config");
        }
    }
    // Scan literal nested expansions too, even though an opaque standard-mode command can pass.
    for embedded in &parsed.embedded {
        if let Some(reason) = judge_inner(embedded, true, critical, false, depth + 1)
            && reason != "unparsed"
        {
            return Some(reason);
        }
    }
    let unsupported = outer_unsafe || parsed.unparsed || parsed.expansion;
    if unsupported {
        return Some("unparsed");
    }
    if !standard
        && parsed
            .commands
            .iter()
            .any(|simple: &Simple| shell::writes_redirect(simple) || !read_only(&simple.words, 0))
    {
        return Some("read-only");
    }
    if parsed.commands.is_empty() {
        return Some("unparsed");
    }
    None
}
