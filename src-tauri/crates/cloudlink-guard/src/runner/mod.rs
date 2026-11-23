//! Independent execution entry point. GUI approval is consumed here, never
//! represented by a command-line switch or a mutable approval file.

mod process;
mod transfer;

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::Path;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use guard_rules::{protocol, routes, runtime};
use serde_json::{Value, json};

#[derive(Debug)]
pub(super) struct Error {
    reason: &'static str,
}
impl Error {
    fn new(reason: &'static str) -> Self {
        Self { reason }
    }
}
impl From<std::io::Error> for Error {
    fn from(error: std::io::Error) -> Self {
        let reason = match error.to_string().as_str() {
            "runtime-invalid" => "runtime-invalid",
            "runtime-not-ready" => "runtime-not-ready",
            "execution-route-invalid" => "execution-route-invalid",
            "execution-routes-stale" => "execution-routes-stale",
            "execution-resource-unavailable" => "execution-resource-unavailable",
            "execution-protocol-invalid" => "execution-protocol-invalid",
            _ => "execution-unavailable",
        };
        Self { reason }
    }
}
type Result<T> = std::result::Result<T, Error>;

struct Parsed {
    input: Value,
    ticket: Option<String>,
    status: bool,
}

fn normalize_agent(agent: &str) -> Option<&'static str> {
    // Kept aligned with model::delivery::AgentBrand; the desktop validates the enum again.
    match agent.trim().to_ascii_lowercase().as_str() {
        "claude-code" => Some("claude-code"),
        "codex" => Some("codex"),
        "cursor" => Some("cursor"),
        "windsurf" => Some("windsurf"),
        "gemini-cli" => Some("gemini-cli"),
        "antigravity" | "agy" => Some("antigravity"),
        "copilot" => Some("copilot"),
        "opencode" => Some("opencode"),
        "cline" => Some("cline"),
        "roo-code" => Some("roo-code"),
        "kilo-code" => Some("kilo-code"),
        "goose" => Some("goose"),
        "amp" => Some("amp"),
        "qwen-code" => Some("qwen-code"),
        "droid" => Some("droid"),
        "augment" => Some("augment"),
        "crush" => Some("crush"),
        "junie" => Some("junie"),
        "warp" => Some("warp"),
        "trae" => Some("trae"),
        "trae-cn" => Some("trae-cn"),
        "kiro" => Some("kiro"),
        "continue" => Some("continue"),
        _ => None,
    }
}

fn known_agent(agent: &str) -> bool {
    // Exact canonical AgentBrand IDs only; JSON protocol rejects aliases or mixed case.
    matches!(
        agent,
        "claude-code"
            | "codex"
            | "cursor"
            | "windsurf"
            | "gemini-cli"
            | "antigravity"
            | "copilot"
            | "opencode"
            | "cline"
            | "roo-code"
            | "kilo-code"
            | "goose"
            | "amp"
            | "qwen-code"
            | "droid"
            | "augment"
            | "crush"
            | "junie"
            | "warp"
            | "trae"
            | "trae-cn"
            | "kiro"
            | "continue"
    )
}

fn metadata_valid(input: &Value) -> bool {
    input.get("caller").is_none_or(|caller| {
        caller.is_null()
            || caller.as_object().is_some_and(|caller| {
                caller.keys().all(|key| key == "agent" || key == "provenance")
                    && match caller.get("provenance").and_then(Value::as_str) {
                        Some("self-reported") => caller.get("agent").and_then(Value::as_str).is_some_and(known_agent),
                        Some("unknown") => caller.get("agent").is_none_or(Value::is_null),
                        _ => false,
                    }
            })
    }) && input.get("sessionId").is_none_or(|session| {
        session.is_null()
            || session.as_str().is_some_and(|session| {
                !session.is_empty() && session.len() <= 256 && !session.chars().any(char::is_control)
            })
    })
}

fn parse(args: &[String]) -> Result<Parsed> {
    let Some(kind) = args.first().map(String::as_str) else {
        return Err(Error::new("execution-input-invalid"));
    };
    if kind == "status" {
        return if args.len() == 1 {
            Ok(Parsed {
                input: Value::Null,
                ticket: None,
                status: true,
            })
        } else {
            Err(Error::new("execution-input-invalid"))
        };
    }
    let mut env = None;
    let mut asset = None;
    let mut tool = None;
    let mut agent = None;
    let mut session_id = None;
    let mut timeout = 90u64;
    let mut trailing = Vec::new();
    let mut index = 1;
    while index < args.len() {
        let arg = &args[index];
        if arg == "--" {
            trailing.extend_from_slice(&args[index + 1..]);
            break;
        }
        if arg.starts_with('-') {
            let value = args
                .get(index + 1)
                .ok_or_else(|| Error::new("execution-input-invalid"))?;
            match arg.as_str() {
                "--env" if env.is_none() => env = Some(value.clone()),
                "--asset" if asset.is_none() => asset = Some(value.clone()),
                "--tool" if tool.is_none() && value == "git" => tool = Some(value.clone()),
                "--agent" if agent.is_none() => {
                    let canonical = normalize_agent(value).ok_or_else(|| Error::new("execution-input-invalid"))?;
                    agent = Some(canonical.to_string());
                }
                "--session" if session_id.is_none() => session_id = Some(value.clone()),
                "--timeout" => timeout = value.parse().map_err(|_| Error::new("execution-input-invalid"))?,
                _ => return Err(Error::new("execution-input-invalid")),
            }
            index += 2;
        } else if kind == "wait" {
            trailing.push(arg.clone());
            index += 1;
        } else {
            return Err(Error::new("execution-input-invalid"));
        }
    }
    let env = env
        .filter(|env| !env.is_empty() && env.len() <= 256 && !env.chars().any(char::is_control))
        .ok_or_else(|| Error::new("execution-input-invalid"))?;
    if kind == "wait" {
        if trailing.len() != 1
            || asset.is_some()
            || tool.is_some()
            || agent.is_some()
            || session_id.is_some()
            || timeout != 90
        {
            return Err(Error::new("execution-input-invalid"));
        }
        validate_ticket(&trailing[0])?;
        return Ok(Parsed {
            input: json!({"envId":env}),
            ticket: Some(trailing.remove(0)),
            status: false,
        });
    }
    if !["exec", "put", "get", "discover"].contains(&kind) || !(1..=3600).contains(&timeout) {
        return Err(Error::new("execution-input-invalid"));
    }
    let asset = asset.ok_or_else(|| Error::new("execution-input-invalid"))?;
    let cwd = std::env::current_dir()
        .map_err(Error::from)?
        .to_str()
        .ok_or_else(|| Error::new("execution-path-invalid"))?
        .to_string();
    let mut input =
        json!({"envId":env,"assetId":asset,"kind":kind,"args":trailing,"tool":tool,"timeoutSec":timeout,"cwd":cwd});
    if let Some(agent) = agent {
        input["caller"] = json!({"agent":agent,"provenance":"self-reported"});
    }
    if let Some(session_id) = session_id {
        input["sessionId"] = session_id.into();
    }
    if !metadata_valid(&input) {
        return Err(Error::new("execution-input-invalid"));
    }
    routes::validate_input(&input).map_err(Error::from)?;
    Ok(Parsed {
        input,
        ticket: None,
        status: false,
    })
}
fn validate_ticket(ticket: &str) -> Result<(&str, &str)> {
    let (id, token) = ticket
        .rsplit_once('.')
        .ok_or_else(|| Error::new("execution-ticket-invalid"))?;
    if id.is_empty()
        || id.len() > 128
        || !id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"_-".contains(&byte))
        || !runtime::valid_token(token)
    {
        return Err(Error::new("execution-ticket-invalid"));
    }
    Ok((id, token))
}
fn diagnostic(value: &Value) {
    let mut value = value.clone();
    if value["reasonId"] == "execution-route-invalid" {
        value["stage"] = "local-route".into();
        value["sent"] = false.into();
    }
    if let Ok(mut bytes) = serde_json::to_vec(&value) {
        bytes.push(b'\n');
        let _ = std::io::stderr().lock().write_all(&bytes);
    }
}
fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn ready(root: &Path) -> Result<Value> {
    let start = Instant::now();
    loop {
        let snapshot = runtime::snapshot(root).map_err(Error::from)?;
        match snapshot["state"].as_str() {
            Some("active" | "stopped") => return Ok(snapshot),
            Some("starting" | "stopping") if start.elapsed() < Duration::from_secs(3) => {
                std::thread::sleep(Duration::from_millis(50))
            }
            Some("starting" | "stopping") => return Err(Error::new("runtime-not-ready")),
            _ => return Err(Error::new("runtime-invalid")),
        }
    }
}
fn rpc(
    session: &Value,
    op: &str,
    id: Option<&str>,
    token: &str,
    input: Option<&Value>,
    outcome: Option<&process::Finished>,
) -> Result<Value> {
    let endpoint = session["endpoint"]
        .as_str()
        .ok_or_else(|| Error::new("runtime-invalid"))?;
    let mut frame = json!({"version":protocol::VERSION,"installationId":session["installationId"],"epoch":session["epoch"],"capability":session["capability"],"op":op,"ownerToken":token});
    if let Some(id) = id {
        frame["requestId"] = Value::String(id.into());
    }
    if let Some(input) = input {
        frame["input"] = input.clone();
    }
    if let Some(output) = outcome {
        frame["outcome"] = Value::String(output.state.into());
        frame["durationMs"] = json!(output.duration_ms);
        if let Some(code) = output.exit_code {
            frame["exitCode"] = json!(code);
        }
        if let Some(reason) = output.reason {
            frame["reasonId"] = Value::String(reason.into());
        }
    }
    let mut connection = protocol::connect(endpoint).map_err(|_| Error::new("execution-coordinator-unavailable"))?;
    protocol::write_frame(&mut connection, &frame).map_err(|_| Error::new("execution-coordinator-unavailable"))?;
    let response =
        protocol::read_frame(&mut connection).map_err(|_| Error::new("execution-coordinator-unavailable"))?;
    if response["epoch"] != session["epoch"] || id.is_some_and(|id| response["requestId"] != id) {
        return Err(Error::new("execution-protocol-invalid"));
    }
    Ok(response)
}
fn wait_for_claim(session: &Value, id: &str, token: &str, env: &str) -> Result<Value> {
    let scope = json!({"envId":env});
    let now = Instant::now();
    loop {
        // Claim is also a read-only status query while waiting. No failed RPC is
        // retried: a lost dispatch response may already have consumed a permit.
        let response = rpc(session, "claim", Some(id), token, Some(&scope), None)?;
        if response["state"] != "waiting" && response["state"] != "approved" {
            return Ok(response);
        }
        if response["state"] == "approved"
            && (response["route"].is_object() || response["routeDigest"].is_string())
            && response["input"].is_object()
        {
            return Ok(response);
        }
        if now.elapsed() >= Duration::from_secs(90) {
            return Ok(json!({"version":protocol::VERSION,"epoch":session["epoch"],"requestId":id,"state":"waiting"}));
        }
        std::thread::sleep(Duration::from_millis(200));
    }
}

fn hydrate_receipt(root: &Path, receipt: &mut Value) -> Result<()> {
    if !metadata_valid(&receipt["input"]) {
        return Err(Error::new("execution-protocol-invalid"));
    }
    routes::validate_input(&receipt["input"]).map_err(Error::from)?;
    let manifest = routes::load(root).map_err(Error::from)?;
    if receipt["policyRevision"]
        .as_u64()
        .is_some_and(|revision| manifest["revision"].as_u64() != Some(revision))
    {
        return Err(Error::new("execution-permit-invalid"));
    }
    let route = routes::select(
        &manifest,
        receipt["input"]["assetId"].as_str().unwrap_or_default(),
        receipt["input"]["envId"].as_str().unwrap_or_default(),
    )
    .map_err(Error::from)?;
    let digest = runtime::digest(&serde_json::to_vec(&route).map_err(|_| Error::new("execution-route-invalid"))?);
    if receipt["routeDigest"]
        .as_str()
        .is_some_and(|expected| !runtime::valid_token(expected) || expected != digest)
        || receipt["route"].is_object() && receipt["route"] != route
        || !receipt["routeDigest"].is_string() && !receipt["route"].is_object()
    {
        return Err(Error::new("execution-permit-invalid"));
    }
    receipt["route"] = route;
    Ok(())
}

fn audit(root: &Path, input: &Value, request_id: &str, epoch: &str, output: &process::Finished, decision: &str) {
    if runtime::read_owned_json(&root.join(".cloudlink.json"), "data", runtime::MAX_RUNTIME).is_err()
        || runtime::read_owned_json(&root.join("guard/.cloudlink.json"), "guard", runtime::MAX_RUNTIME).is_err()
    {
        return;
    }
    let directory = root.join("guard/log");
    if !runtime::safe_path(&directory) || fs::create_dir_all(&directory).is_err() {
        return;
    }
    let marker = directory.join(".cloudlink.json");
    if runtime::bounded_file(&marker, runtime::MAX_RUNTIME)
        .ok()
        .flatten()
        .is_none()
    {
        if !fs::read_dir(&directory).is_ok_and(|mut entries| entries.next().is_none()) {
            return;
        }
        let Ok(mut file) = OpenOptions::new().write(true).create_new(true).open(&marker) else {
            return;
        };
        if file
            .write_all(b"{\"managedBy\":\"cloudlink\",\"kind\":\"operation-log\"}\n")
            .is_err()
        {
            return;
        }
    }
    if runtime::read_owned_json(&marker, "operation-log", runtime::MAX_RUNTIME).is_err() {
        return;
    }
    let at = crate::timestamp(now_secs());
    let path = directory.join(format!("{}.jsonl", &at[..10]));
    if !runtime::safe_path(&path)
        || fs::symlink_metadata(&path).is_ok_and(|metadata| {
            !metadata.is_file() || runtime::is_link(&metadata) || metadata.len() > 32 * 1024 * 1024
        })
    {
        return;
    }
    let command = input["args"]
        .as_array()
        .map(|args| args.iter().filter_map(Value::as_str).collect::<Vec<_>>().join(" "))
        .unwrap_or_default();
    let mut value = json!({"id":format!("exec_{request_id}"),"source":"runner","checked":true,"epoch":epoch,
        "requestId":request_id,"assetId":input["assetId"],"envId":input["envId"],"at":at,"sessionId":crate::safe_text(input["sessionId"].as_str().unwrap_or_default(),256),"cwd":crate::safe_text(input["cwd"].as_str().unwrap_or_default(),4096),
        "command":crate::safe_text(&command,16384),"decision":decision,"executionState":output.state,"durationMs":output.duration_ms});
    if metadata_valid(input)
        && let Some(caller) = input.get("caller").filter(|caller| !caller.is_null())
    {
        value["caller"] = caller.clone();
    }
    if let Some(code) = output.exit_code {
        value["exitCode"] = json!(code);
    }
    if let Some(reason) = output.reason {
        value["reasonId"] = Value::String(reason.into());
    }
    if let Ok(mut bytes) = serde_json::to_vec(&value) {
        bytes.push(b'\n');
        if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
            let _ = file.write_all(&bytes);
        }
    }
}

fn check_start(
    root: &Path,
    session: &Value,
    route: &Value,
    input: &Value,
    checked: bool,
    receipt: Option<&Value>,
) -> Result<()> {
    let manifest = routes::load(root).map_err(Error::from)?;
    if input["kind"] == "put"
        && input["inputDigest"].as_str() != Some(&transfer::input_digest(&manifest, route, input)?)
    {
        return Err(Error::new("execution-input-changed"));
    }
    if checked
        && route["provider"] == "github"
        && input["identity"] != process::github_preflight(&manifest, route, input)?
    {
        return Err(Error::new("execution-identity-changed"));
    }
    if checked {
        let args = input["args"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .map(String::from)
            .collect::<Vec<_>>();
        if guard_rules::evaluate_execution(
            &route["policy"],
            input["kind"].as_str().unwrap_or_default(),
            &args,
            input["tool"].as_str(),
        )["decision"]
            == "deny"
        {
            return Err(Error::new("execution-permit-invalid"));
        }
    }
    // Expensive input/identity checks finish first. Session, expiry and route
    // freshness are read at the last possible point before process creation.
    let current = runtime::snapshot(root).map_err(Error::from)?;
    if checked {
        if current["state"] != "active"
            || current["epoch"] != session["epoch"]
            || current["installationId"] != session["installationId"]
        {
            return Err(Error::new("execution-permit-invalid"));
        }
        if receipt
            .and_then(|value| value["expiresAtSecs"].as_u64())
            .is_some_and(|deadline| now_secs() >= deadline)
        {
            return Err(Error::new("execution-permit-expired"));
        }
    } else if current["state"] != "stopped" {
        return Err(Error::new("runtime-not-ready"));
    }
    let manifest = routes::load(root).map_err(Error::from)?;
    let latest = routes::select(
        &manifest,
        input["assetId"].as_str().unwrap_or_default(),
        input["envId"].as_str().unwrap_or_default(),
    )
    .map_err(Error::from)?;
    if latest != *route
        || receipt
            .and_then(|value| value["policyRevision"].as_u64())
            .is_some_and(|revision| manifest["revision"].as_u64() != Some(revision))
    {
        return Err(Error::new("execution-permit-invalid"));
    }
    Ok(())
}

struct Permit<'a> {
    id: &'a str,
    owner_token: &'a str,
    receipt: &'a Value,
}

fn perform(
    root: &Path,
    session: &Value,
    route: &Value,
    input: &Value,
    permit: Option<Permit<'_>>,
) -> process::Finished {
    let checked = permit.is_some();
    let id = permit.as_ref().map(|permit| permit.id);
    let token = permit.as_ref().map_or("", |permit| permit.owner_token);
    let receipt = permit.as_ref().map(|permit| permit.receipt);
    let now = Instant::now();
    let result = (|| {
        routes::validate_route_input(route, input).map_err(Error::from)?;
        let manifest = routes::load(root).map_err(Error::from)?;
        let mut before = || check_start(root, session, route, input, checked, receipt);
        let mut started = || {
            if let Some(id) = id {
                let response = rpc(session, "started", Some(id), token, None, None)?;
                if response["state"] != "running" {
                    return Err(Error::new("execution-permit-invalid"));
                }
            }
            Ok(())
        };
        let timeout = Duration::from_secs(input["timeoutSec"].as_u64().unwrap_or(90));
        match input["kind"].as_str() {
            Some("put" | "get") => transfer::run(&manifest, route, input, timeout, &mut before, &mut started),
            Some("discover") => process::discover(&manifest, route, input, &mut before, &mut started),
            Some("exec") => {
                let spec = process::spec(&manifest, route, input, None, false)?;
                process::stream(&spec, &[], timeout, &mut before, &mut started)
            }
            _ => Err(Error::new("execution-input-invalid")),
        }
    })();
    match result {
        Ok(mut output) => {
            if route["kind"] == "vps" && output.exit_code == Some(255) {
                output.state = "unknown";
                output.reason = Some("execution-result-unknown");
            }
            // `cf` aborts destructive commands without --force in non-interactive runs,
            // prints `Aborted.` and exits 0. Nothing was executed.
            if route["provider"] == "cloudflare"
                && output.state == "succeeded"
                && std::str::from_utf8(&output.stderr).is_ok_and(|text| text.trim_end().ends_with("Aborted."))
            {
                output.state = "failed";
                output.reason = Some("cli-aborted");
            }
            output
        }
        Err(error) => process::Finished {
            state: if error.reason == "execution-coordinator-unavailable" {
                "unknown"
            } else {
                "failed"
            },
            duration_ms: now.elapsed().as_millis() as u64,
            reason: Some(error.reason),
            ..process::Finished::default()
        },
    }
}

fn exit_code(output: &process::Finished) -> i32 {
    output.exit_code.unwrap_or(125)
}
fn finish(root: &Path, session: &Value, input: &Value, id: &str, token: &str, output: process::Finished) -> i32 {
    let _ = rpc(session, "finish", Some(id), token, None, Some(&output));
    audit(
        root,
        input,
        id,
        session["epoch"].as_str().unwrap_or_default(),
        &output,
        "allowed",
    );
    diagnostic(
        &json!({"source":"cloudlink","checked":true,"requestId":id,"state":output.state,"exitCode":output.exit_code,"durationMs":output.duration_ms,"reasonId":output.reason}),
    );
    exit_code(&output)
}

fn run_inner(args: &[String], root: &Path) -> Result<i32> {
    let mut parsed = parse(args)?;
    let session = if parsed.status {
        runtime::snapshot(root).map_err(Error::from)?
    } else {
        ready(root)?
    };
    if parsed.status {
        let value = json!({"source":"cloudlink","version":protocol::VERSION,"installationId":session["installationId"],"epoch":session["epoch"],"state":session["state"],"pid":session["pid"],"checked":session["state"]=="active"});
        let mut bytes = serde_json::to_vec(&value).map_err(|_| Error::new("execution-output-invalid"))?;
        bytes.push(b'\n');
        std::io::stdout()
            .lock()
            .write_all(&bytes)
            .map_err(|_| Error::new("execution-output-disconnected"))?;
        return Ok(0);
    }
    if let Some(ticket) = &parsed.ticket {
        if session["state"] != "active" {
            return Err(Error::new("execution-request-cancelled"));
        }
        let (id, token) = validate_ticket(ticket)?;
        let mut response = wait_for_claim(&session, id, token, parsed.input["envId"].as_str().unwrap_or_default())?;
        if response["state"] == "waiting" {
            diagnostic(&json!({"source":"cloudlink","state":"waiting","requestId":ticket}));
            return Ok(75);
        }
        if !["dispatching", "approved"].contains(&response["state"].as_str().unwrap_or_default())
            || (!response["route"].is_object() && !response["routeDigest"].is_string())
            || !response["input"].is_object()
        {
            diagnostic(
                &json!({"source":"cloudlink","checked":true,"requestId":id,"state":response["state"],"reasonId":response["reasonId"]}),
            );
            return Ok(125);
        }
        if response["input"]["envId"] != parsed.input["envId"] {
            return Err(Error::new("execution-ticket-invalid"));
        }
        if let Err(error) = hydrate_receipt(root, &mut response) {
            let output = process::Finished {
                state: "failed",
                reason: Some(error.reason),
                ..process::Finished::default()
            };
            return Ok(finish(root, &session, &response["input"], id, token, output));
        }
        let input = &response["input"];
        let route = &response["route"];
        let output = perform(
            root,
            &session,
            route,
            input,
            Some(Permit {
                id,
                owner_token: token,
                receipt: &response,
            }),
        );
        return Ok(finish(root, &session, input, id, token, output));
    }
    let manifest = routes::load(root).map_err(Error::from)?;
    let route = routes::select(
        &manifest,
        parsed.input["assetId"].as_str().unwrap_or_default(),
        parsed.input["envId"].as_str().unwrap_or_default(),
    )
    .map_err(Error::from)?;
    routes::validate_route_input(&route, &parsed.input).map_err(Error::from)?;
    if ["put", "get"].contains(&parsed.input["kind"].as_str().unwrap_or_default()) {
        let index = if parsed.input["kind"] == "put" { 0 } else { 1 };
        let value = parsed.input["args"][index]
            .as_str()
            .ok_or_else(|| Error::new("execution-input-invalid"))?;
        let path = if value.starts_with('/') || std::path::Path::new(value).is_absolute() {
            routes::local_path(&route, value).map_err(Error::from)?
        } else {
            routes::local_path(&route, parsed.input["cwd"].as_str().unwrap_or_default())
                .map_err(Error::from)?
                .join(value)
        };
        if !routes::path_allowed(&manifest, &path) {
            return Err(Error::new("execution-path-invalid"));
        }
        parsed.input["args"][index] = Value::String(
            path.to_str()
                .ok_or_else(|| Error::new("execution-path-invalid"))?
                .to_string(),
        );
    }
    if parsed.input["kind"] == "put" {
        parsed.input["inputDigest"] = Value::String(transfer::input_digest(&manifest, &route, &parsed.input)?);
    }
    if session["state"] == "stopped" {
        diagnostic(&json!({"source":"cloudlink","checked":false,"reasonId":"execution-checks-stopped"}));
        let output = perform(root, &session, &route, &parsed.input, None);
        diagnostic(
            &json!({"source":"cloudlink","checked":false,"state":output.state,"exitCode":output.exit_code,"durationMs":output.duration_ms,"reasonId":output.reason}),
        );
        return Ok(exit_code(&output));
    }
    if route["provider"] == "github" {
        parsed.input["identity"] = process::github_preflight(&manifest, &route, &parsed.input)?;
    }
    let token = runtime::nonce().map_err(Error::from)?;
    let response = rpc(&session, "submit", None, &token, Some(&parsed.input), None)?;
    let id = routes::text(&response, "requestId", 128).map_err(|_| Error::new("execution-protocol-invalid"))?;
    if !id
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || b"_-".contains(&byte))
    {
        return Err(Error::new("execution-protocol-invalid"));
    }
    if ["denied", "rejected", "expired", "cancelled"].contains(&response["state"].as_str().unwrap_or_default()) {
        diagnostic(
            &json!({"source":"cloudlink","checked":true,"requestId":id,"state":response["state"],"reasonId":response["reasonId"]}),
        );
        return Ok(125);
    }
    let mut receipt = wait_for_claim(
        &session,
        &id,
        &token,
        parsed.input["envId"].as_str().unwrap_or_default(),
    )?;
    if receipt["state"] == "waiting" {
        diagnostic(&json!({"source":"cloudlink","state":"waiting","requestId":format!("{id}.{token}")}));
        return Ok(75);
    }
    if !["dispatching", "approved"].contains(&receipt["state"].as_str().unwrap_or_default())
        || (!receipt["route"].is_object() && !receipt["routeDigest"].is_string())
        || receipt["input"] != parsed.input
    {
        diagnostic(
            &json!({"source":"cloudlink","checked":true,"requestId":id,"state":receipt["state"],"reasonId":receipt["reasonId"]}),
        );
        return Ok(125);
    }
    if let Err(error) = hydrate_receipt(root, &mut receipt) {
        let output = process::Finished {
            state: "failed",
            reason: Some(error.reason),
            ..process::Finished::default()
        };
        return Ok(finish(root, &session, &parsed.input, &id, &token, output));
    }
    let output = perform(
        root,
        &session,
        &receipt["route"],
        &parsed.input,
        Some(Permit {
            id: &id,
            owner_token: &token,
            receipt: &receipt,
        }),
    );
    Ok(finish(root, &session, &parsed.input, &id, &token, output))
}

pub(super) fn run(args: &[String], root: Option<&Path>) -> i32 {
    match root
        .ok_or_else(|| Error::new("execution-root-unavailable"))
        .and_then(|root| run_inner(args, root))
    {
        Ok(code) => code,
        Err(error) => {
            diagnostic(
                &json!({"source":"cloudlink","reasonId":error.reason,"state":if error.reason=="execution-coordinator-unavailable" {"unknown"} else {"unavailable"}}),
            );
            125
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn strings(args: &[&str]) -> Vec<String> {
        args.iter().map(|s| s.to_string()).collect()
    }
    #[test]
    fn parser_never_accepts_self_approval_or_ambiguous_input() {
        assert!(
            parse(&strings(&[
                "exec", "--env", "windows", "--asset", "ast_1", "--", "uptime"
            ]))
            .is_ok()
        );
        for args in [
            vec![
                "exec",
                "--env",
                "windows",
                "--asset",
                "ast_1",
                "--approved",
                "1",
                "--",
                "reboot",
            ],
            vec!["exec", "--asset", "ast_1", "--", "uptime"],
            vec!["wait", "--env", "windows", "req_1.bad"],
            vec!["status", "--approved"],
        ] {
            assert!(parse(&strings(&args)).is_err());
        }
    }
    #[test]
    fn caller_is_an_explicit_self_report_and_wait_cannot_replace_it() {
        let input = parse(&strings(&[
            "exec",
            "--env",
            "windows",
            "--asset",
            "ast_1",
            "--agent",
            "codex",
            "--session",
            "original-session",
            "--",
            "uptime",
        ]))
        .unwrap()
        .input;
        assert_eq!(input["caller"], json!({"agent":"codex","provenance":"self-reported"}));
        assert_eq!(input["sessionId"], "original-session");
        for alias in ["antigravity", "Antigravity", "agy"] {
            let parsed = parse(&strings(&[
                "exec", "--env", "windows", "--asset", "ast_1", "--agent", alias, "--", "uptime",
            ]))
            .unwrap()
            .input;
            assert_eq!(
                parsed["caller"],
                json!({"agent":"antigravity","provenance":"self-reported"})
            );
        }
        let unknown = parse(&strings(&[
            "exec", "--env", "windows", "--asset", "ast_1", "--", "uptime",
        ]))
        .unwrap()
        .input;
        assert!(unknown.get("caller").is_none() && unknown.get("sessionId").is_none());
        let ticket = format!("req_1.{}", "a".repeat(64));
        for (option, value) in [("--agent", "codex"), ("--session", "replacement-session")] {
            assert!(parse(&strings(&["wait", "--env", "windows", option, value, &ticket])).is_err());
        }
        for (option, value) in [("--agent", "unrecognized"), ("--session", "invalid\nsession")] {
            assert!(
                parse(&strings(&[
                    "exec", "--env", "windows", "--asset", "ast_1", option, value, "--", "uptime"
                ]))
                .is_err()
            );
        }
        let mut spoofed = input;
        spoofed["caller"]["provenance"] = "hook".into();
        assert!(!metadata_valid(&spoofed));
        spoofed["caller"]["provenance"] = "self-reported".into();
        spoofed["sessionId"] = "x".repeat(257).into();
        assert!(!metadata_valid(&spoofed));
    }

    #[test]
    fn result_audit_keeps_the_original_caller_and_bounded_session() {
        let root = std::env::temp_dir().join(format!("cloudlink-caller-audit-{}", runtime::nonce().unwrap()));
        fs::create_dir(&root).unwrap();
        fs::create_dir(root.join("guard")).unwrap();
        fs::write(
            root.join(".cloudlink.json"),
            br#"{"managedBy":"cloudlink","kind":"data"}"#,
        )
        .unwrap();
        fs::write(
            root.join("guard/.cloudlink.json"),
            br#"{"managedBy":"cloudlink","kind":"guard"}"#,
        )
        .unwrap();
        let caller = json!({"agent":"codex","provenance":"self-reported"});
        let input = json!({"assetId":"ast_1","envId":"windows","args":["uptime"],"cwd":root,"caller":caller,"sessionId":"original-session"});
        let output = process::Finished {
            state: "succeeded",
            exit_code: Some(0),
            duration_ms: 42,
            ..Default::default()
        };
        audit(&root, &input, "req_1", "fixture-epoch", &output, "allowed");
        let directory = root.join("guard/log");
        let log = fs::read_dir(&directory)
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .find(|path| path.extension().is_some_and(|extension| extension == "jsonl"))
            .unwrap();
        let record: Value = serde_json::from_slice(&fs::read(&log).unwrap()).unwrap();
        assert_eq!(record["caller"], caller);
        assert_eq!(record["sessionId"], "original-session");
        assert_eq!(record["source"], "runner");
        for (directory, kind) in [
            (&root, "data"),
            (&root.join("guard"), "guard"),
            (&directory, "operation-log"),
        ] {
            runtime::read_owned_json(&directory.join(".cloudlink.json"), kind, runtime::MAX_RUNTIME).unwrap();
        }
        for path in [
            log,
            directory.join(".cloudlink.json"),
            root.join("guard/.cloudlink.json"),
            root.join(".cloudlink.json"),
        ] {
            assert!(runtime::safe_path(&path) && !runtime::is_link(&fs::symlink_metadata(&path).unwrap()));
            fs::remove_file(path).unwrap();
        }
        fs::remove_dir(directory).unwrap();
        fs::remove_dir(root.join("guard")).unwrap();
        fs::remove_dir(root).unwrap();
    }

    #[test]
    fn wait_ticket_is_private_and_contains_no_command() {
        let token = "a".repeat(64);
        let ticket = format!("req_1.{token}");
        assert_eq!(validate_ticket(&ticket).unwrap(), ("req_1", token.as_str()));
        assert!(validate_ticket("req_1").is_err());
    }
}
