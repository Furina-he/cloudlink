//! Rules for an explicitly routed request. Unlike legacy hooks, standard-mode
//! opaque/high-risk commands require a GUI permit; a credential red line never does.

use serde_json::{Value, json};

use crate::{cli, github, shell, ssh};

fn decision(action: &str, reason: Option<&str>) -> Value {
    let mut result = json!({"decision":action});
    if let Some(reason) = reason {
        result["reasonId"] = Value::String(reason.into());
    }
    result
}

fn result(reason: Option<&'static str>, standard: bool) -> Value {
    match reason {
        None => decision("allow", None),
        Some("cli-write" | "read-only") if standard => decision("allow", None),
        Some(
            reason @ ("credential-read"
            | "cli-env-export"
            | "cli-account"
            | "cli-scope"
            | "github-repo-delete"
            | "github-default-force"
            | "runtime-protected"
            | "execution-input-invalid"),
        ) => decision("deny", Some(reason)),
        Some(reason) if standard => decision("ask", Some(reason)),
        Some(reason) => decision("deny", Some(reason)),
    }
}

/// Paths/process identifiers are projected by the desktop, never supplied as an
/// approval by the caller. This is an accident guard, not an OS-user sandbox.
pub fn runtime_modification(policy: &Value, command: &str) -> bool {
    runtime_modification_inner(policy, command, 0)
}

fn runtime_modification_inner(policy: &Value, command: &str, depth: usize) -> bool {
    if depth > 8 {
        return command.to_ascii_lowercase().contains("cloudlink");
    }
    let parsed = shell::parse(command);
    let lower = command.to_ascii_lowercase().replace('\\', "/");
    let protected = policy["protectedPaths"].as_array().is_some_and(|paths| {
        paths
            .iter()
            .filter_map(Value::as_str)
            .any(|path| lower.contains(&path.to_ascii_lowercase().replace('\\', "/")))
    }) || ["runtime.json", "policy.json", ".cloudlink/routes", ".cloudlink\\routes"]
        .iter()
        .any(|path| lower.contains(path));
    let process_name = parsed.commands.iter().any(|simple| {
        let i = shell::executable(&simple.words);
        let name = simple
            .words
            .get(i)
            .map(|s| shell::binary(s).to_ascii_lowercase())
            .unwrap_or_default();
        ["taskkill", "kill", "killall", "pkill", "stop-process"].contains(&name.as_str())
            && simple.words.iter().skip(i + 1).any(|word| {
                word.to_ascii_lowercase().contains("cloudlink")
                    || policy["runtimePid"]
                        .as_u64()
                        .is_some_and(|pid| word == &pid.to_string())
            })
    });
    let wrapped = parsed.commands.iter().any(|simple| {
        let i = shell::executable(&simple.words);
        let name = simple
            .words
            .get(i)
            .map(|word| shell::binary(word).to_ascii_lowercase())
            .unwrap_or_default();
        if ["powershell", "pwsh", "cmd", "sh", "bash", "zsh", "dash"].contains(&name.as_str())
            && let Some(option) = simple
                .words
                .iter()
                .skip(i + 1)
                .position(|word| ["-command", "-c", "-lc", "/c"].contains(&word.to_ascii_lowercase().as_str()))
        {
            return runtime_modification_inner(policy, &simple.words[i + option + 2..].join(" "), depth + 1);
        }
        name == "stop-process" && lower.contains("cloudlink")
    });
    process_name
        || wrapped
        || protected
            && (parsed.unparsed
                || parsed.expansion
                || parsed.commands.iter().any(|simple| {
                    let i = shell::executable(&simple.words);
                    let name = simple
                        .words
                        .get(i)
                        .map(|s| shell::binary(s).to_ascii_lowercase())
                        .unwrap_or_default();
                    shell::writes_redirect(simple)
                        || [
                            "rm",
                            "mv",
                            "cp",
                            "install",
                            "tee",
                            "truncate",
                            "touch",
                            "dd",
                            "sed",
                            "perl",
                            "python",
                            "python3",
                            "node",
                            "powershell",
                            "pwsh",
                            "cmd",
                            "del",
                            "erase",
                            "rmdir",
                            "ren",
                            "move",
                            "copy",
                            "remove-item",
                            "set-content",
                            "add-content",
                            "out-file",
                            "move-item",
                            "copy-item",
                        ]
                        .contains(&name.as_str())
                }))
        || parsed
            .embedded
            .iter()
            .any(|inner| runtime_modification_inner(policy, inner, depth + 1))
}

/// Recognize this installed executable only, not another file with its basename.
/// A chain containing another command is not skipped wholesale by the hook.
pub fn managed_runner_invocation(command: &str, installed: &str) -> bool {
    let parsed = shell::parse(command);
    if parsed.unparsed || parsed.expansion || parsed.commands.len() != 1 {
        return false;
    }
    let simple = &parsed.commands[0];
    if shell::writes_redirect(simple) {
        return false;
    }
    let i = shell::executable(&simple.words);
    let Some(program) = simple.words.get(i) else {
        return false;
    };
    let normalize = |text: &str| {
        let text = text.strip_prefix("\\\\?\\").unwrap_or(text).replace('\\', "/");
        if cfg!(windows) { text.to_lowercase() } else { text }
    };
    let program = normalize(program);
    let installed = normalize(installed);
    let wsl = if installed.len() >= 3 && installed.as_bytes()[1] == b':' {
        Some(format!(
            "/mnt/{}/{}",
            &installed[..1],
            installed[3..].trim_start_matches('/')
        ))
    } else {
        None
    };
    (program == installed || wsl.as_ref() == Some(&program))
        && simple
            .words
            .get(i + 1)
            .is_some_and(|word| ["exec", "wait", "put", "get", "discover", "status"].contains(&word.as_str()))
}

pub fn evaluate_execution(resource: &Value, kind: &str, args: &[String], tool: Option<&str>) -> Value {
    if !matches!(resource["mode"].as_str(), Some("read-only" | "standard"))
        || args.len() > 256
        || args.iter().map(String::len).sum::<usize>() > 65_536
        || args.iter().any(|arg| arg.contains('\0'))
    {
        return decision("deny", Some("execution-input-invalid"));
    }
    let standard = resource["mode"] == "standard";
    let text = args.join(" ");
    if runtime_modification(resource, &text) {
        return decision("deny", Some("runtime-protected"));
    }
    if kind == "discover" {
        return if resource["kind"] == "cli" && resource["provider"] == "github" && args.is_empty() && tool.is_none() {
            decision("allow", None)
        } else {
            decision("deny", Some("execution-input-invalid"))
        };
    }
    if resource["kind"] == "vps" {
        if tool.is_some() {
            return decision("deny", Some("execution-input-invalid"));
        }
        if ["put", "get"].contains(&kind) {
            if args.len() != 2 || args.iter().any(|arg| arg.chars().any(char::is_control)) {
                return decision("deny", Some("execution-input-invalid"));
            }
            if args.iter().any(|arg| ssh::credential_path(arg)) {
                return decision("deny", Some("credential-read"));
            }
            return if kind == "put" && !standard {
                decision("deny", Some("file-transfer"))
            } else {
                decision("allow", None)
            };
        }
        if kind != "exec" || args.len() != 1 || args[0].trim().is_empty() {
            return decision("deny", Some("execution-input-invalid"));
        }
        let parsed = shell::parse(&args[0]);
        if parsed.commands.iter().any(|simple| {
            let i = shell::executable(&simple.words);
            simple.redirects.iter().any(|(op, _)| op.contains('<'))
                || simple
                    .words
                    .get(i)
                    .is_some_and(|word| ["sh", "bash", "dash", "zsh"].contains(&shell::binary(word)))
                    && simple.words.iter().skip(i + 1).any(|word| word == "-s")
        }) {
            return decision("deny", Some("execution-input-invalid"));
        }
        let critical: Vec<String> = resource["criticalServices"]
            .as_array()
            .map(|items| items.iter().filter_map(Value::as_str).map(String::from).collect())
            .unwrap_or_default();
        let opaque = parsed.commands.iter().any(|simple| {
            let i = shell::executable(&simple.words);
            simple
                .words
                .get(i)
                .is_some_and(|word| ["sh", "bash", "dash", "zsh"].contains(&shell::binary(word)))
                && simple
                    .words
                    .iter()
                    .skip(i + 1)
                    .any(|word| ["-c", "-lc", "-ic"].contains(&word.as_str()))
        });
        return result(ssh::judge(&args[0], standard, &critical, opaque), standard);
    }
    if resource["kind"] != "cli" || kind != "exec" || args.is_empty() {
        return decision("deny", Some("execution-input-invalid"));
    }
    if resource["provider"] == "github" {
        return result(github::judge(resource, args, tool), standard);
    }
    if tool.is_some() {
        return decision("deny", Some("execution-input-invalid"));
    }
    let (provider, binary) = match resource["provider"].as_str() {
        Some("cloudflare") => ("cloudflare", "wrangler"),
        Some("vercel") => ("vercel", "vercel"),
        Some("oracle") => ("oracle", "oci"),
        _ => return decision("deny", Some("execution-input-invalid")),
    };
    let mut words = vec![binary.to_string()];
    let account_option: &[&str] = match provider {
        "vercel" => &["--scope", "-S", "--team", "-T"],
        "oracle" => &["--profile"],
        _ => &[],
    };
    if !account_option.is_empty()
        && !args.iter().any(|arg| {
            account_option
                .iter()
                .any(|option| arg == option || arg.starts_with(&format!("{option}=")))
        })
    {
        words.extend([
            account_option[0].into(),
            resource["account"].as_str().unwrap_or_default().into(),
        ]);
    }
    words.extend_from_slice(args);
    let prefix = if provider == "cloudflare" {
        vec![format!(
            "CLOUDFLARE_ACCOUNT_ID={}",
            resource["account"].as_str().unwrap_or_default()
        )]
    } else {
        Vec::new()
    };
    result(cli::judge(resource, provider, &words, &prefix, false), standard)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn vps(mode: &str) -> Value {
        json!({"kind":"vps","mode":mode,"criticalServices":["gateway"],"protectedPaths":["D:/fixture/runtime.json"],"runtimePid":4242})
    }
    fn exec(mode: &str, command: &str) -> Value {
        evaluate_execution(&vps(mode), "exec", &[command.into()], None)
    }

    #[test]
    fn inspection_pipelines_and_nested_docker_commands_pass() {
        for command in [
            "uptime; df -h | tail -n 5",
            "docker exec gateway nginx -t",
            "journalctl -u app -n 200 --no-pager | grep error",
            "kubectl get pods -o wide",
            "kubectl get deployments -n app -o json | head -n 40",
        ] {
            assert_eq!(exec("read-only", command)["decision"], "allow", "{command}");
        }
    }
    #[test]
    fn standard_opaque_and_dangerous_commands_ask_but_red_lines_never_do() {
        for command in [
            "docker compose down -v",
            "docker restart gateway",
            "reboot",
            "echo $(uptime)",
            "nohup sh -c 'docker restart api' &",
        ] {
            assert_eq!(exec("standard", command)["decision"], "ask", "{command}");
            assert_eq!(exec("read-only", command)["decision"], "deny", "{command}");
        }
        for command in [
            "cat .env",
            "sh -c 'cat ~/.ssh/id_ed25519'",
            "docker inspect api",
            "echo x > D:/fixture/runtime.json",
            "taskkill /PID 4242",
            "kubectl get secrets -o yaml",
        ] {
            assert_eq!(exec("standard", command)["decision"], "deny", "{command}");
        }
        assert_eq!(exec("standard", "docker restart api")["decision"], "allow");
    }
    #[test]
    fn transfers_have_no_read_only_upload_or_credential_escape() {
        assert_eq!(
            evaluate_execution(
                &vps("read-only"),
                "put",
                &["/tmp/local".into(), "/tmp/remote".into()],
                None
            )["decision"],
            "deny"
        );
        assert_eq!(
            evaluate_execution(
                &vps("read-only"),
                "get",
                &["/tmp/remote".into(), "/tmp/local".into()],
                None
            )["decision"],
            "allow"
        );
        assert_eq!(
            evaluate_execution(
                &vps("standard"),
                "get",
                &["/home/u/.ssh/id_ed25519".into(), "/tmp/local".into()],
                None
            )["reasonId"],
            "credential-read"
        );
        assert_eq!(exec("standard", "sh -s")["reasonId"], "execution-input-invalid");
    }
    #[test]
    fn runner_recognition_requires_exact_installed_path_and_one_call() {
        assert!(managed_runner_invocation(
            "'D:/fixture/bin/cloudlink-guard.exe' exec --asset ast_1 -- uptime",
            "D:/fixture/bin/cloudlink-guard.exe"
        ));
        assert!(!managed_runner_invocation(
            "cloudlink-guard.exe exec --asset ast_1 -- uptime",
            "D:/fixture/bin/cloudlink-guard.exe"
        ));
        assert!(!managed_runner_invocation(
            "'D:/other/cloudlink-guard.exe' exec --asset ast_1 -- uptime",
            "D:/fixture/bin/cloudlink-guard.exe"
        ));
        assert!(!managed_runner_invocation(
            "'D:/fixture/bin/cloudlink-guard.exe' exec --asset ast_1 -- uptime; ssh host reboot",
            "D:/fixture/bin/cloudlink-guard.exe"
        ));
    }
}
