//! Fixed executable/argv execution, bounded streams and fixed metadata preflights.

use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant};

use guard_rules::{routes, runtime};
use serde_json::{Value, json};

use super::{Error, Result};

const OUTPUT_LIMIT: usize = 8 * 1024 * 1024;
const CAPTURE_LIMIT: usize = 512 * 1024;

pub(super) struct Spec {
    pub program: PathBuf,
    pub args: Vec<String>,
    pub cwd: PathBuf,
    pub env: Vec<(String, String)>,
    pub isolated: bool,
    pub home: PathBuf,
}

#[derive(Default)]
pub(super) struct Finished {
    pub state: &'static str,
    pub exit_code: Option<i32>,
    pub duration_ms: u64,
    pub reason: Option<&'static str>,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
}

fn executable(path: &Path) -> bool {
    // Program locations were discovered by the desktop. Resolve existing nvm /
    // package-manager links rather than applying writable-data path rules here.
    path.is_absolute()
        && fs::canonicalize(path).is_ok_and(|resolved| {
            runtime::safe_path(&resolved)
                && fs::symlink_metadata(resolved)
                    .is_ok_and(|metadata| metadata.is_file() && !runtime::is_link(&metadata))
        })
}

fn find_program(name: &str) -> Option<PathBuf> {
    std::env::var_os("PATH").and_then(|paths| {
        std::env::split_paths(&paths)
            .map(|path| path.join(name))
            .find(|path| path.is_absolute() && executable(path))
    })
}

fn native_text(path: &Path) -> Result<String> {
    path.to_str()
        .map(|s| s.strip_prefix("\\\\?\\").unwrap_or(s).replace('\\', "/"))
        .ok_or_else(|| Error::new("execution-path-invalid"))
}

pub(super) fn for_program(route: &Value, path: &Path) -> Result<String> {
    let text = native_text(path)?;
    if route["distro"].as_str().is_none() {
        return Ok(text);
    }
    if text.len() > 2 && text.as_bytes()[1] == b':' {
        return Ok(format!(
            "/mnt/{}/{}",
            text[..1].to_ascii_lowercase(),
            text[3..].trim_start_matches('/')
        ));
    }
    let prefix = format!("//wsl.localhost/{}/", route["distro"].as_str().unwrap_or_default());
    if text.to_ascii_lowercase().starts_with(&prefix.to_ascii_lowercase()) {
        return Ok(format!("/{}", &text[prefix.len()..]));
    }
    if text.starts_with('/') && !text.starts_with("//") {
        return Ok(text);
    }
    Err(Error::new("execution-path-invalid"))
}

fn npm_shim(program: &Path, provider: &str, node: Option<&str>) -> Result<(PathBuf, Vec<String>)> {
    let suffix = match provider {
        "cloudflare" => "node_modules/cf/bin/cf",
        "vercel" => "node_modules/vercel/dist/index.js",
        _ => return Err(Error::new("cli-command-unsupported")),
    };
    let resolved = fs::canonicalize(program).map_err(|_| Error::new("execution-program-unavailable"))?;
    let bytes = runtime::bounded_file(&resolved, 64 * 1024)
        .map_err(|_| Error::new("cli-command-unsupported"))?
        .ok_or_else(|| Error::new("execution-program-unavailable"))?;
    let text = std::str::from_utf8(&bytes)
        .map_err(|_| Error::new("cli-command-unsupported"))?
        .replace('\\', "/");
    // The batch file is never interpreted. Only a known package entry point can
    // be selected, even if a shim contains additional shell metacharacters.
    if !text.to_ascii_lowercase().contains("node") || !text.contains(suffix) || !text.contains("%*") {
        return Err(Error::new("cli-command-unsupported"));
    }
    let parent = resolved
        .parent()
        .ok_or_else(|| Error::new("execution-program-unavailable"))?;
    let candidates = text
        .split('"')
        .filter_map(|part| {
            part.strip_prefix("%dp0%/")
                .or_else(|| part.strip_prefix("%~dp0/"))
                .filter(|relative| {
                    relative.ends_with(suffix)
                        && !relative.contains('%')
                        && !relative.chars().any(char::is_control)
                        && !Path::new(relative).is_absolute()
                        && !Path::new(relative)
                            .components()
                            .any(|part| part == std::path::Component::ParentDir)
                })
                .map(|relative| parent.join(relative))
        })
        .collect::<Vec<_>>();
    let script = candidates
        .first()
        .cloned()
        .ok_or_else(|| Error::new("cli-command-unsupported"))?;
    if candidates.iter().any(|candidate| candidate != &script) {
        return Err(Error::new("cli-command-unsupported"));
    }
    if !executable(&script) {
        return Err(Error::new("execution-program-unavailable"));
    }
    let node = node
        .map(PathBuf::from)
        .or_else(|| {
            let sibling = parent.join("node.exe");
            executable(&sibling)
                .then_some(sibling)
                .or_else(|| find_program("node.exe"))
        })
        .ok_or_else(|| Error::new("execution-program-unavailable"))?;
    if !node.is_absolute()
        || !executable(&node)
        || node
            .file_name()
            .and_then(|s| s.to_str())
            .is_none_or(|s| !s.eq_ignore_ascii_case("node.exe"))
    {
        return Err(Error::new("cli-command-unsupported"));
    }
    Ok((node, vec![native_text(&script)?]))
}

fn bound_args(route: &Value, args: &[String]) -> Vec<String> {
    let mut out = Vec::new();
    if let Some(account) = route["account"].as_str() {
        let names: &[&str] = match route["provider"].as_str() {
            Some("vercel") => &["--scope", "-S", "--team", "-T"],
            Some("oracle") => &["--profile"],
            _ => &[],
        };
        if !names.is_empty()
            && !args.iter().any(|arg| {
                names
                    .iter()
                    .any(|name| arg == name || arg.starts_with(&format!("{name}=")))
            })
        {
            out.extend([names[0].into(), account.into()]);
        }
    }
    out.extend_from_slice(args);
    out
}

pub(super) fn spec(
    manifest: &Value,
    route: &Value,
    input: &Value,
    override_args: Option<Vec<String>>,
    sftp: bool,
) -> Result<Spec> {
    let cwd =
        routes::local_path(route, &routes::text(input, "cwd", 4096).map_err(Error::from)?).map_err(Error::from)?;
    if !routes::path_allowed(manifest, &cwd) || !cwd.is_dir() {
        return Err(Error::new("execution-path-invalid"));
    }
    let mut args = override_args.unwrap_or_else(|| {
        input["args"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .map(String::from)
            .collect()
    });
    let is_ssh = route["kind"] == "vps";
    let tool_git = input["tool"] == "git";
    let mut program = if is_ssh {
        routes::text(route, "sshPath", 4096).map_err(Error::from)?
    } else if tool_git {
        route["gitPath"]
            .as_str()
            .map(String::from)
            .or_else(|| {
                route["distro"]
                    .is_null()
                    .then(|| find_program(if cfg!(windows) { "git.exe" } else { "git" }))
                    .flatten()
                    .and_then(|path| path.to_str().map(String::from))
            })
            .ok_or_else(|| Error::new("execution-program-unavailable"))?
    } else {
        routes::text(route, "program", 4096).map_err(Error::from)?
    };
    if is_ssh {
        let config = routes::local_path(route, &routes::text(route, "configPath", 4096).map_err(Error::from)?)
            .map_err(Error::from)?;
        let config = for_program(route, &config)?;
        let alias = routes::text(route, "alias", 256).map_err(Error::from)?;
        if sftp {
            let path = Path::new(&program);
            program = native_text(
                &path
                    .parent()
                    .ok_or_else(|| Error::new("execution-program-unavailable"))?
                    .join(if program.ends_with(".exe") { "sftp.exe" } else { "sftp" }),
            )?;
            args = vec![
                "-F".into(),
                config,
                "-oBatchMode=yes".into(),
                "-oStrictHostKeyChecking=yes".into(),
                "-oConnectTimeout=10".into(),
                "-b".into(),
                "-".into(),
                "--".into(),
                alias,
            ];
        } else {
            if args.len() != 1 {
                return Err(Error::new("execution-input-invalid"));
            }
            args = vec![
                "-F".into(),
                config,
                "-T".into(),
                "-oBatchMode=yes".into(),
                "-oStrictHostKeyChecking=yes".into(),
                "-oConnectTimeout=10".into(),
                "--".into(),
                alias,
                args.remove(0),
            ];
        }
    } else if !tool_git {
        args = bound_args(route, &args);
        // Only reached with a request that already passed judging and approval.
        if route["provider"] == "cloudflare"
            && guard_rules::cf_destructive(&args)
            && !args.iter().any(|arg| arg == "--force")
        {
            args.push("--force".into());
        }
    }
    if manifest["isolated"] == true && is_ssh {
        let position = args
            .iter()
            .position(|arg| arg == "--")
            .ok_or_else(|| Error::new("execution-input-invalid"))?;
        args.splice(
            position..position,
            [
                "-oIdentityAgent=none",
                "-oIdentitiesOnly=yes",
                "-oIdentityFile=none",
                "-oGlobalKnownHostsFile=none",
            ]
            .map(String::from),
        );
    }
    if manifest["isolated"] == true && !is_ssh {
        let local = routes::local_path(route, &program).map_err(Error::from)?;
        if !routes::path_allowed(manifest, &local) {
            return Err(Error::new("execution-program-unavailable"));
        }
    }
    let home = PathBuf::from(routes::text(manifest, "userHome", 4096).map_err(Error::from)?);
    let mut environment = Vec::new();
    if let Some(account) = route["account"].as_str() {
        if route["provider"] == "cloudflare" {
            environment.push(("CLOUDFLARE_ACCOUNT_ID".into(), account.into()));
        }
        if route["provider"] == "oracle" {
            environment.push(("OCI_CLI_PROFILE".into(), account.into()));
        }
    }
    if route["provider"] == "github" {
        environment.push((
            "GH_HOST".into(),
            route["github"]["host"].as_str().unwrap_or("github.com").into(),
        ));
    }
    environment.push(("CI".into(), "1".into()));
    environment.push(("GH_PROMPT_DISABLED".into(), "1".into()));
    environment.push(("CF_SEND_TELEMETRY".into(), "false".into()));
    #[cfg(windows)]
    if let Some(distro) = route["distro"].as_str() {
        let working = for_program(route, &cwd)?;
        let mut wsl_args = vec![
            "-d".into(),
            distro.into(),
            "--cd".into(),
            working,
            "-e".into(),
            "/usr/bin/env".into(),
        ];
        for (key, value) in &environment {
            wsl_args.push(format!("{key}={value}"));
        }
        if manifest["isolated"] == true {
            let home = for_program(route, &home)?;
            wsl_args.extend([
                format!("HOME={home}"),
                format!("GH_CONFIG_DIR={home}/.config/gh"),
                format!("XDG_CONFIG_HOME={home}/.config"),
                "GIT_CONFIG_NOSYSTEM=1".into(),
                "GIT_CONFIG_GLOBAL=/dev/null".into(),
            ]);
            for key in [
                "GH_TOKEN",
                "GITHUB_TOKEN",
                "GH_ENTERPRISE_TOKEN",
                "GITHUB_ENTERPRISE_TOKEN",
                "CLOUDFLARE_API_TOKEN",
                "CLOUDFLARE_API_KEY",
                "VERCEL_TOKEN",
                "AWS_ACCESS_KEY_ID",
                "AWS_SECRET_ACCESS_KEY",
                "NODE_OPTIONS",
            ] {
                wsl_args.insert(6, "-u".into());
                wsl_args.insert(7, key.into());
            }
        }
        wsl_args.push(program);
        wsl_args.extend(args);
        let windows = std::env::var_os("SystemRoot")
            .map(PathBuf::from)
            .ok_or_else(|| Error::new("execution-program-unavailable"))?;
        return Ok(Spec {
            program: windows.join("System32/wsl.exe"),
            args: wsl_args,
            cwd,
            env: environment,
            isolated: manifest["isolated"] == true,
            home,
        });
    }
    let path = PathBuf::from(program);
    if !path.is_absolute() || !executable(&path) {
        return Err(Error::new("execution-program-unavailable"));
    }
    let (program, prefix) = if path.extension().is_some_and(|ext| ext.eq_ignore_ascii_case("cmd")) {
        npm_shim(
            &path,
            route["provider"].as_str().unwrap_or_default(),
            route["nodePath"].as_str(),
        )?
    } else {
        (path, Vec::new())
    };
    let mut argv = prefix;
    argv.extend(args);
    Ok(Spec {
        program,
        args: argv,
        cwd,
        env: environment,
        isolated: manifest["isolated"] == true,
        home,
    })
}

fn command(spec: &Spec, has_stdin: bool) -> Command {
    let mut command = Command::new(&spec.program);
    command
        .args(&spec.args)
        .current_dir(&spec.cwd)
        .stdin(if has_stdin { Stdio::piped() } else { Stdio::null() })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    for key in [
        "GH_DEBUG",
        "GH_REPO",
        "SSH_ASKPASS",
        "SSH_ASKPASS_REQUIRE",
        "CLOUDLINK_SSH_ASKPASS",
    ] {
        command.env_remove(key);
    }
    if spec.isolated {
        for key in [
            "GH_TOKEN",
            "GITHUB_TOKEN",
            "GH_ENTERPRISE_TOKEN",
            "GITHUB_ENTERPRISE_TOKEN",
            "CLOUDFLARE_API_TOKEN",
            "CLOUDFLARE_API_KEY",
            "CLOUDFLARE_EMAIL",
            "VERCEL_TOKEN",
            "OCI_CLI_AUTH",
            "AWS_ACCESS_KEY_ID",
            "AWS_SECRET_ACCESS_KEY",
            "NODE_OPTIONS",
        ] {
            command.env_remove(key);
        }
        command
            .env("HOME", &spec.home)
            .env("USERPROFILE", &spec.home)
            .env("APPDATA", spec.home.join("AppData/Roaming"))
            .env("LOCALAPPDATA", spec.home.join("AppData/Local"))
            .env("XDG_CONFIG_HOME", spec.home.join(".config"))
            .env("GH_CONFIG_DIR", spec.home.join(".config/gh"))
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("GIT_CONFIG_GLOBAL", if cfg!(windows) { "NUL" } else { "/dev/null" });
    }
    for (key, value) in &spec.env {
        command.env(key, value);
    }
    command
}

enum Chunk {
    Bytes(bool, Vec<u8>),
    Closed,
}
fn reader<T: Read + Send + 'static>(mut stream: T, stderr: bool, sender: mpsc::SyncSender<Chunk>) {
    std::thread::spawn(move || {
        let mut buffer = [0; 8192];
        loop {
            match stream.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(size) => {
                    if sender.send(Chunk::Bytes(stderr, buffer[..size].to_vec())).is_err() {
                        return;
                    }
                }
            }
        }
        let _ = sender.send(Chunk::Closed);
    });
}

fn drive(
    spec: &Spec,
    stdin: &[u8],
    timeout: Duration,
    capture: bool,
    before: &mut dyn FnMut() -> Result<()>,
    started: &mut dyn FnMut() -> Result<()>,
) -> Result<Finished> {
    let now = Instant::now();
    before()?;
    let mut child = command(spec, !stdin.is_empty())
        .spawn()
        .map_err(|_| Error::new("execution-start-failed"))?;
    let (sender, receiver) = mpsc::sync_channel(16);
    if let Some(stdout) = child.stdout.take() {
        reader(stdout, false, sender.clone());
    }
    if let Some(stderr) = child.stderr.take() {
        reader(stderr, true, sender.clone());
    }
    if let Some(mut pipe) = child.stdin.take() {
        let input = stdin.to_vec();
        std::thread::spawn(move || {
            let _ = pipe.write_all(&input);
        });
    }
    drop(sender);
    if started().is_err() {
        let _ = child.kill();
        let _ = child.wait();
        return Ok(Finished {
            state: "unknown",
            reason: Some("execution-result-unknown"),
            duration_ms: now.elapsed().as_millis() as u64,
            ..Finished::default()
        });
    }
    let mut output = Finished {
        state: "unknown",
        ..Finished::default()
    };
    let mut size = 0;
    let mut closed = 0;
    let mut exit = None;
    let mut exited_at = None;
    loop {
        if now.elapsed() >= timeout {
            output.reason = Some("execution-timeout");
            break;
        }
        match receiver.recv_timeout(Duration::from_millis(20)) {
            Ok(Chunk::Closed) => closed += 1,
            Ok(Chunk::Bytes(stderr, bytes)) => {
                size += bytes.len();
                if size > if capture { CAPTURE_LIMIT } else { OUTPUT_LIMIT } {
                    output.reason = Some("execution-output-limit");
                    break;
                }
                if capture {
                    if stderr {
                        output.stderr.extend(bytes);
                    } else {
                        output.stdout.extend(bytes);
                    }
                } else {
                    let result = if stderr {
                        // Keep a bounded tail to recognize a non-interactive `Aborted.`.
                        if output.stderr.len() < 4096 {
                            let keep = bytes.len().min(4096 - output.stderr.len());
                            output.stderr.extend_from_slice(&bytes[..keep]);
                        }
                        std::io::stderr().lock().write_all(&bytes)
                    } else {
                        std::io::stdout().lock().write_all(&bytes)
                    };
                    if result.is_err() {
                        output.reason = Some("execution-output-disconnected");
                        break;
                    }
                }
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => closed = 2,
            Err(mpsc::RecvTimeoutError::Timeout) => {}
        }
        if exit.is_none() {
            match child.try_wait() {
                Ok(Some(status)) => {
                    exit = Some(status);
                    exited_at = Some(Instant::now());
                }
                Ok(None) => {}
                Err(_) => {
                    output.reason = Some("execution-result-unknown");
                    break;
                }
            }
        }
        if exit.is_some() && (closed >= 2 || exited_at.is_some_and(|at| at.elapsed() >= Duration::from_millis(250))) {
            break;
        }
    }
    if output.reason.is_some() {
        let _ = child.kill();
        let _ = child.wait();
    } else if let Some(status) = exit {
        output.exit_code = status.code();
        output.state = if status.success() {
            "succeeded"
        } else if status.code().is_some() {
            "failed"
        } else {
            "unknown"
        };
    }
    output.duration_ms = now.elapsed().as_millis().min(u128::from(u64::MAX)) as u64;
    Ok(output)
}

pub(super) fn stream(
    spec: &Spec,
    stdin: &[u8],
    timeout: Duration,
    before: &mut dyn FnMut() -> Result<()>,
    started: &mut dyn FnMut() -> Result<()>,
) -> Result<Finished> {
    drive(spec, stdin, timeout, false, before, started)
}
pub(super) fn capture(spec: &Spec, stdin: &[u8]) -> Result<Finished> {
    drive(spec, stdin, Duration::from_secs(10), true, &mut || Ok(()), &mut || {
        Ok(())
    })
}

fn id(value: &Value) -> Option<String> {
    value
        .as_str()
        .filter(|s| !s.is_empty())
        .map(String::from)
        .or_else(|| value.as_u64().map(|id| id.to_string()))
}

/// CloudLink persists GitHub GraphQL `node_id` for users/owners and `repo:<node_id>`
/// for repositories. Real GitHub REST API payloads carry both numeric `id` and
/// `node_id`; prefer `node_id` and fall back to `id` only when `node_id` is absent.
fn github_node_id(value: &Value) -> Option<String> {
    id(&value["node_id"]).or_else(|| id(&value["id"]))
}

fn github_repo_id(value: &Value) -> Option<String> {
    id(&value["node_id"])
        .map(|node| format!("repo:{node}"))
        .or_else(|| id(&value["id"]))
}
fn github_state(route: &Value) -> &Value {
    &route["github"]["envStates"][route["envId"].as_str().unwrap_or_default()]
}
fn gh_query(manifest: &Value, route: &Value, input: &Value, endpoint: &str) -> Result<Value> {
    gh_query_started(
        manifest,
        route,
        input,
        endpoint,
        Duration::from_secs(10),
        &mut || Ok(()),
        &mut || Ok(()),
    )
}
fn gh_query_started(
    manifest: &Value,
    route: &Value,
    input: &Value,
    endpoint: &str,
    timeout: Duration,
    before: &mut dyn FnMut() -> Result<()>,
    started: &mut dyn FnMut() -> Result<()>,
) -> Result<Value> {
    let host = routes::text(&route["github"], "host", 256).map_err(Error::from)?;
    if !host
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || byte == b'.' || byte == b'-')
    {
        return Err(Error::new("cli-account"));
    }
    let mut metadata_input = input.clone();
    metadata_input["tool"] = Value::Null;
    let spec = spec(
        manifest,
        route,
        &metadata_input,
        Some(vec![
            "api".into(),
            "--hostname".into(),
            host,
            "--method".into(),
            "GET".into(),
            endpoint.into(),
        ]),
        false,
    )?;
    let output = drive(&spec, &[], timeout.min(Duration::from_secs(10)), true, before, started)?;
    if output.state != "succeeded" {
        return Err(Error::new("execution-identity-unavailable"));
    }
    serde_json::from_slice(&output.stdout).map_err(|_| Error::new("execution-identity-unavailable"))
}

fn repo_name(route: &Value, input: &Value) -> Result<Option<String>> {
    if input["kind"] == "discover" {
        return Ok(None);
    }
    let args = input["args"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(String::from)
        .collect::<Vec<_>>();
    let mut resource = route["policy"].clone();
    if !resource.is_object() {
        resource = json!({"kind":"cli","provider":"github"});
    }
    resource["github"] = route["github"].clone();
    resource["envId"] = route["envId"].clone();
    guard_rules::github::target(&resource, &args, None).map_err(Error::new)
}

fn git_target(manifest: &Value, route: &Value, input: &Value) -> Result<String> {
    let args: Vec<_> = input["args"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .collect();
    let mut prefix = Vec::new();
    if args.first() != Some(&"push")
        || args.iter().any(|arg| {
            ["-C", "-c", "--config-env", "--repo", "--receive-pack", "--exec"]
                .iter()
                .any(|option| *arg == *option || arg.starts_with(&format!("{option}=")))
        })
    {
        return Err(Error::new("cli-scope"));
    }
    let remote = args
        .iter()
        .skip(1)
        .find(|arg| !arg.starts_with('-'))
        .copied()
        .unwrap_or("origin");
    let url = if remote.contains(':') || remote.contains('/') {
        remote.to_string()
    } else {
        prefix.extend([
            "remote".into(),
            "get-url".into(),
            "--push".into(),
            "--all".into(),
            remote.into(),
        ]);
        let spec = spec(manifest, route, input, Some(prefix), false)?;
        let result = capture(&spec, &[])?;
        if result.state != "succeeded" {
            return Err(Error::new("cli-scope"));
        }
        String::from_utf8(result.stdout)
            .map_err(|_| Error::new("cli-scope"))?
            .trim()
            .into()
    };
    let host = route["github"]["host"]
        .as_str()
        .ok_or_else(|| Error::new("cli-account"))?;
    let ssh = format!("git@{host}:");
    let https = format!("https://{host}/");
    let ssh_url = format!("ssh://git@{host}/");
    let name = url
        .strip_prefix(&ssh)
        .or_else(|| url.strip_prefix(&https))
        .or_else(|| url.strip_prefix(&ssh_url))
        .ok_or_else(|| Error::new("cli-scope"))?;
    Ok(name.trim_end_matches(".git").into())
}

fn force_targets_default(input: &Value, default_branch: &str) -> bool {
    let args = input["args"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .collect::<Vec<_>>();
    let Some(push) = args.iter().position(|arg| *arg == "push") else {
        return true;
    };
    let force = args
        .iter()
        .skip(push + 1)
        .any(|arg| *arg == "-f" || *arg == "--force" || arg.starts_with("--force-with-lease") || arg.starts_with('+'));
    if !force {
        return false;
    }
    let mut skip = false;
    let mut positional = Vec::new();
    for arg in args.iter().skip(push + 1) {
        if skip {
            skip = false;
            continue;
        }
        if ["--receive-pack", "--repo", "-o", "--push-option"].contains(arg) {
            skip = true;
            continue;
        }
        if !arg.starts_with('-') {
            positional.push(*arg);
        }
        if ["--all", "--mirror", "--tags", "--delete"].contains(arg) {
            return true;
        }
    }
    let branches = positional.get(1..).unwrap_or_default();
    branches.is_empty()
        || branches.iter().any(|spec| {
            let spec = spec.trim_start_matches('+');
            let branch = spec
                .split_once(':')
                .map_or(spec, |(_, destination)| destination)
                .trim_start_matches("refs/heads/");
            branch.is_empty() || branch == default_branch || ["HEAD", "@"].contains(&branch) || branch.contains('*')
        })
}

fn verify_github_identity(route: &Value, identity: &Value) -> Result<String> {
    let actual = github_node_id(identity).ok_or_else(|| Error::new("cli-account"))?;
    let expected = id(&github_state(route)["identity"]["id"]).ok_or_else(|| Error::new("cli-account"))?;
    if actual != expected {
        return Err(Error::new("cli-account"));
    }
    Ok(actual)
}

fn verify_github_target(route: &Value, input: &Value, identity: &Value, identity_id: &str, target: &Value) -> Result<Value> {
    let repo_id = github_repo_id(target).ok_or_else(|| Error::new("cli-scope"))?;
    if input["tool"] == "git"
        && force_targets_default(
            input,
            target["default_branch"]
                .as_str()
                .ok_or_else(|| Error::new("cli-scope"))?,
        )
    {
        return Err(Error::new("github-default-force"));
    }
    let owner_id = github_node_id(&target["owner"]).ok_or_else(|| Error::new("cli-scope"))?;
    let expected_owner_id = id(&route["github"]["owner"]["id"]).ok_or_else(|| Error::new("cli-scope"))?;
    if owner_id != expected_owner_id {
        return Err(Error::new("cli-scope"));
    }
    let github = &route["github"];
    let contains = |key: &str| {
        github[key]
            .as_array()
            .is_some_and(|ids| ids.iter().any(|value| id(value).as_deref() == Some(&repo_id)))
    };
    let selected = if github["mode"] == "auto" {
        !contains("excludedRepoIds")
    } else {
        contains("selectedRepoIds")
    };
    let known = github_state(route)["repos"].as_array().is_some_and(|repos| {
        repos
            .iter()
            .any(|repo| id(&repo["id"]).as_deref() == Some(&repo_id) && repo["selected"] == true)
    });
    if !selected || !known && github_state(route)["status"] != "complete" {
        return Err(Error::new("cli-scope"));
    }
    Ok(
        json!({"id":identity_id,"login":identity["login"],"host":github["host"],"repoId":repo_id,"ownerId":owner_id,"name":target["full_name"],"defaultBranch":target["default_branch"]}),
    )
}

fn filter_discovered_repos(route: &Value, rows: &[Value]) -> Result<Vec<Value>> {
    let expected_owner_id = id(&route["github"]["owner"]["id"]).ok_or_else(|| Error::new("cli-scope"))?;
    let mut out = Vec::new();
    for repo in rows {
        if github_node_id(&repo["owner"]).as_deref() != Some(expected_owner_id.as_str()) {
            continue;
        }
        let Some(repo_id) = github_repo_id(repo) else {
            return Err(Error::new("execution-identity-unavailable"));
        };
        let included = |key: &str| {
            route["github"][key]
                .as_array()
                .is_some_and(|ids| ids.iter().any(|value| id(value).as_deref() == Some(&repo_id)))
        };
        if if route["github"]["mode"] == "auto" {
            !included("excludedRepoIds")
        } else {
            included("selectedRepoIds")
        } {
            out.push(json!({"id":repo_id,"name":repo["full_name"],"defaultBranch":repo["default_branch"],"visibility":repo["visibility"]}));
        }
    }
    Ok(out)
}

pub(super) fn github_preflight(manifest: &Value, route: &Value, input: &Value) -> Result<Value> {
    let identity = gh_query(manifest, route, input, "user")?;
    let identity_id = verify_github_identity(route, &identity)?;
    let full = if input["tool"] == "git" {
        Some(git_target(manifest, route, input)?)
    } else {
        repo_name(route, input)?
    };
    let Some(full) = full else {
        return Ok(json!({"id":identity_id,"login":identity["login"],"host":route["github"]["host"]}));
    };
    let mut parts = full.split('/');
    let owner = parts.next().unwrap_or_default();
    let repo = parts.next().unwrap_or_default();
    if parts.next().is_some()
        || owner.is_empty()
        || repo.is_empty()
        || !full
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"._-/".contains(&byte))
    {
        return Err(Error::new("cli-scope"));
    }
    let target = gh_query(manifest, route, input, &format!("repos/{owner}/{repo}"))?;
    verify_github_target(route, input, &identity, &identity_id, &target)
}

pub(super) fn discover(
    manifest: &Value,
    route: &Value,
    input: &Value,
    before: &mut dyn FnMut() -> Result<()>,
    started: &mut dyn FnMut() -> Result<()>,
) -> Result<Finished> {
    let mut repos = Vec::new();
    let now = Instant::now();
    let timeout = Duration::from_secs(input["timeoutSec"].as_u64().unwrap_or(90));
    for page in 1..=100 {
        let remaining = timeout
            .checked_sub(now.elapsed())
            .filter(|duration| !duration.is_zero())
            .ok_or_else(|| Error::new("execution-timeout"))?;
        let endpoint = format!(
            "user/repos?per_page=100&page={page}&visibility=all&affiliation=owner,collaborator,organization_member"
        );
        let result = if page == 1 {
            gh_query_started(manifest, route, input, &endpoint, remaining, before, started)?
        } else {
            gh_query_started(
                manifest,
                route,
                input,
                &endpoint,
                remaining,
                &mut || Ok(()),
                &mut || Ok(()),
            )?
        };
        let rows = result
            .as_array()
            .ok_or_else(|| Error::new("execution-identity-unavailable"))?;
        repos.extend(filter_discovered_repos(route, rows)?);
        if rows.len() < 100 {
            let value = json!({"status":"complete","repos":repos});
            let bytes = serde_json::to_vec(&value).map_err(|_| Error::new("execution-output-invalid"))?;
            if bytes.len() > OUTPUT_LIMIT {
                return Err(Error::new("execution-output-limit"));
            }
            std::io::stdout()
                .lock()
                .write_all(&bytes)
                .map_err(|_| Error::new("execution-output-disconnected"))?;
            std::io::stdout()
                .lock()
                .write_all(b"\n")
                .map_err(|_| Error::new("execution-output-disconnected"))?;
            return Ok(Finished {
                state: "succeeded",
                exit_code: Some(0),
                duration_ms: now.elapsed().as_millis() as u64,
                ..Finished::default()
            });
        }
    }
    Err(Error::new("execution-discovery-partial"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(windows)]
    struct Directory(PathBuf);
    #[cfg(windows)]
    impl Directory {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!("cloudlink-process-{}", runtime::nonce().unwrap()));
            fs::create_dir(&path).unwrap();
            fs::write(
                path.join(".cloudlink.json"),
                b"{\"managedBy\":\"cloudlink\",\"kind\":\"execution-process-test\"}",
            )
            .unwrap();
            Self(path)
        }
    }
    #[cfg(windows)]
    impl Drop for Directory {
        fn drop(&mut self) {
            fn tree(path: &Path) -> bool {
                fs::symlink_metadata(path).is_ok_and(|metadata| {
                    !runtime::is_link(&metadata)
                        && (!metadata.is_dir()
                            || fs::read_dir(path).is_ok_and(|mut entries| {
                                entries.all(|entry| entry.is_ok_and(|entry| tree(&entry.path())))
                            }))
                })
            }
            runtime::read_owned_json(
                &self.0.join(".cloudlink.json"),
                "execution-process-test",
                runtime::MAX_RUNTIME,
            )
            .unwrap();
            assert!(runtime::safe_path(&self.0) && tree(&self.0));
            fs::remove_dir_all(&self.0).unwrap();
        }
    }

    #[cfg(windows)]
    #[test]
    fn wsl_ssh_and_sftp_receive_native_private_config_paths() {
        let directory = Directory::new();
        let root = &directory.0;
        let config = root.join("private [ssh].conf");
        fs::write(&config, b"Host fixture\n").unwrap();
        let manifest = json!({"isolated":true,"userHome":root,"allowedRoots":[root]});
        let route = json!({"kind":"vps","envId":"wsl:Ubuntu-24.04","distro":"Ubuntu-24.04","sshPath":"/usr/bin/ssh","alias":"fixture","configPath":config});
        let input = json!({"kind":"exec","cwd":root,"args":["uname -s"],"timeoutSec":90});
        let windows = config.to_string_lossy().replace('\\', "/");
        let expected = format!("/mnt/{}/{}", windows[..1].to_ascii_lowercase(), &windows[3..]);
        for sftp in [false, true] {
            let spec = spec(&manifest, &route, &input, None, sftp).unwrap();
            assert_eq!(spec.program.file_name().unwrap(), "wsl.exe");
            let position = spec.args.iter().position(|arg| arg == "-F").unwrap();
            assert_eq!(spec.args[position + 1], expected);
            assert!(
                !spec
                    .args
                    .iter()
                    .any(|arg| ["-c", "-lc", "-ilc"].contains(&arg.as_str()))
            );
        }
    }

    #[cfg(windows)]
    #[test]
    fn known_npm_shim_executes_node_with_literal_argv_not_batch_shell() {
        let directory = Directory::new();
        let root = &directory.0;
        let node = find_program("node.exe").expect("Node is required by this project's Windows test toolchain");
        let entry = root.join("node_modules/vercel/dist/index.js");
        fs::create_dir_all(entry.parent().unwrap()).unwrap();
        fs::write(&entry,b"process.stdout.write(JSON.stringify(process.argv.slice(2))); process.stderr.write('fixture-error'); process.exitCode=7;").unwrap();
        let shim = root.join("vercel.cmd");
        fs::write(&shim,b"@echo off\r\nnode \"%dp0%\\node_modules\\vercel\\dist\\index.js\" %*\r\necho forbidden > must-not-exist\r\n").unwrap();
        let manifest = json!({"isolated":true,"userHome":root,"allowedRoots":[root]});
        let route = json!({"kind":"cli","provider":"vercel","program":shim,"nodePath":node,"account":"team_1"});
        let literal = "literal & \"quote\" $() %PATH%";
        let input = json!({"kind":"exec","cwd":root,"args":["deploy",literal],"timeoutSec":90});
        let spec = spec(&manifest, &route, &input, None, false).unwrap();
        assert_eq!(spec.program.file_name().unwrap(), "node.exe");
        let mut starts = 0;
        let output = drive(&spec, &[], Duration::from_secs(5), true, &mut || Ok(()), &mut || {
            starts += 1;
            Ok(())
        })
        .unwrap();
        assert_eq!(starts, 1);
        assert_eq!(output.exit_code, Some(7));
        assert_eq!(output.state, "failed");
        assert_eq!(
            serde_json::from_slice::<Vec<String>>(&output.stdout).unwrap(),
            vec!["--scope", "team_1", "deploy", literal]
        );
        assert_eq!(output.stderr, b"fixture-error");
        assert!(!root.join("must-not-exist").exists());
    }

    #[test]
    fn actual_default_branch_is_checked_even_after_a_cached_branch_change() {
        assert!(force_targets_default(
            &json!({"args":["push","--force-with-lease","origin","feature"]}),
            "feature"
        ));
        assert!(!force_targets_default(
            &json!({"args":["push","--force-with-lease","origin","feature"]}),
            "main"
        ));
        assert!(force_targets_default(&json!({"args":["push","-f","origin"]}), "main"));
    }

    #[test]
    fn argv_preserves_literal_shell_characters_and_default_account() {
        let route = json!({"provider":"vercel","account":"team_1"});
        assert_eq!(
            bound_args(&route, &["deploy".into(), "literal & \"quote\" $()".into()]),
            vec!["--scope", "team_1", "deploy", "literal & \"quote\" $()"]
        );
        assert_eq!(
            bound_args(&route, &["--scope".into(), "another".into(), "deploy".into()]),
            vec!["--scope", "another", "deploy"]
        );
    }
    #[test]
    fn github_targets_require_one_explicit_repository() {
        let route = json!({"envId":"windows","github":{"host":"github.com","owner":{"id":"2","login":"team","kind":"organization"},"mode":"manual","selectedRepoIds":["1"],"excludedRepoIds":[],"envStates":{"windows":{"status":"complete","repos":[{"id":"1","name":"team/repo","ownerId":"2","selected":true}]}}}});
        assert_eq!(
            repo_name(&route, &json!({"args":["pr","list","-R","team/repo"]})).unwrap(),
            Some("team/repo".into())
        );
        assert!(repo_name(&route, &json!({"args":["pr","list"]})).is_err());
        assert!(repo_name(&route, &json!({"args":["pr","list","-R","team/a","--repo=team/b"]})).is_err());
    }

    #[test]
    fn github_verification_matches_rest_node_ids_and_prefixed_repo_ids() {
        let route = json!({
            "envId": "windows",
            "github": {
                "host": "github.com",
                "owner": { "id": "U_kgDOUser1", "login": "octo", "kind": "user" },
                "mode": "auto",
                "selectedRepoIds": [],
                "excludedRepoIds": ["repo:R_kgDOSecret"],
                "envStates": {
                    "windows": {
                        "status": "complete",
                        "identity": { "id": "U_kgDOUser1", "login": "octo", "host": "github.com" },
                        "repos": [
                            { "id": "repo:R_kgDOApp1", "name": "octo/app", "ownerId": "U_kgDOUser1", "selected": true }
                        ]
                    }
                }
            }
        });
        let rest_user = json!({ "id": 12345678, "node_id": "U_kgDOUser1", "login": "octo" });
        let identity_id = verify_github_identity(&route, &rest_user).unwrap();
        assert_eq!(identity_id, "U_kgDOUser1");

        let wrong_user = json!({ "id": 12345678, "node_id": "U_kgDOOther", "login": "other" });
        assert_eq!(
            verify_github_identity(&route, &wrong_user).unwrap_err().reason,
            "cli-account"
        );

        let allowed_repo = json!({
            "id": 987654321,
            "node_id": "R_kgDOApp1",
            "full_name": "octo/app",
            "default_branch": "main",
            "owner": { "id": 12345678, "node_id": "U_kgDOUser1", "login": "octo" }
        });
        let verified = verify_github_target(
            &route,
            &json!({"tool": null, "args": ["repo", "view", "octo/app"]}),
            &rest_user,
            &identity_id,
            &allowed_repo,
        )
        .unwrap();
        assert_eq!(verified["id"], "U_kgDOUser1");
        assert_eq!(verified["ownerId"], "U_kgDOUser1");
        assert_eq!(verified["repoId"], "repo:R_kgDOApp1");

        let excluded_repo = json!({
            "id": 987654322,
            "node_id": "R_kgDOSecret",
            "full_name": "octo/secret",
            "default_branch": "main",
            "owner": { "id": 12345678, "node_id": "U_kgDOUser1", "login": "octo" }
        });
        assert_eq!(
            verify_github_target(
                &route,
                &json!({"tool": null, "args": ["repo", "view", "octo/secret"]}),
                &rest_user,
                &identity_id,
                &excluded_repo,
            )
            .unwrap_err()
            .reason,
            "cli-scope"
        );

        let transferred_repo = json!({
            "id": 987654323,
            "node_id": "R_kgDOMoved",
            "full_name": "other/app",
            "default_branch": "main",
            "owner": { "id": 999999, "node_id": "O_kgDOOther", "login": "other" }
        });
        assert_eq!(
            verify_github_target(
                &route,
                &json!({"tool": null, "args": ["repo", "view", "other/app"]}),
                &rest_user,
                &identity_id,
                &transferred_repo,
            )
            .unwrap_err()
            .reason,
            "cli-scope"
        );
    }

    #[test]
    fn github_discover_filters_by_owner_node_id_and_emits_prefixed_repo_ids() {
        let route = json!({
            "envId": "windows",
            "github": {
                "host": "github.com",
                "owner": { "id": "U_kgDOUser1", "login": "octo", "kind": "user" },
                "mode": "auto",
                "selectedRepoIds": [],
                "excludedRepoIds": ["repo:R_kgDOSecret"]
            }
        });
        let rows = vec![
            json!({
                "id": 101,
                "node_id": "R_kgDOApp1",
                "full_name": "octo/app",
                "default_branch": "main",
                "visibility": "public",
                "owner": { "id": 12345678, "node_id": "U_kgDOUser1" }
            }),
            json!({
                "id": 102,
                "node_id": "R_kgDOSecret",
                "full_name": "octo/secret",
                "default_branch": "main",
                "visibility": "private",
                "owner": { "id": 12345678, "node_id": "U_kgDOUser1" }
            }),
            json!({
                "id": 103,
                "node_id": "R_kgDOOther",
                "full_name": "other/repo",
                "default_branch": "main",
                "visibility": "private",
                "owner": { "id": 999999, "node_id": "O_kgDOOther" }
            }),
        ];
        let discovered = filter_discovered_repos(&route, &rows).unwrap();
        assert_eq!(discovered.len(), 1);
        assert_eq!(discovered[0]["id"], "repo:R_kgDOApp1");
        assert_eq!(discovered[0]["name"], "octo/app");

        let missing_owner = json!({ "envId": "windows", "github": { "mode": "auto" } });
        assert_eq!(
            filter_discovered_repos(&missing_owner, &rows).unwrap_err().reason,
            "cli-scope"
        );
    }
}
