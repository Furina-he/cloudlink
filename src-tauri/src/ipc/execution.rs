//! Loopback 只提交、消费和取消本请求。批准只从主窗口的具名 Tauri 命令进入。

use std::collections::BTreeMap;
use std::net::TcpListener;
use std::sync::{Arc, MutexGuard};
use std::time::Duration;

use guard_rules::{protocol, runtime};
use serde_json::{Value, json};

use super::Backend;
use crate::error::{AppError, Result};
use crate::model::env::EnvId;
use crate::model::execution::*;
use crate::model::guard::{Operation, OperationDecision, OperationSource};
use crate::model::misc::IpcErrorId;
use crate::paths::Paths;

const APPROVAL_TTL: i64 = 300;
const MAX_REQUESTS: usize = 256;

pub fn begin_runtime(paths: &Paths) -> Result<runtime::RuntimeOwner> {
    paths.validate_startup()?;
    std::fs::create_dir_all(&paths.data_dir)?;
    super::backend::ensure_data_marker(paths)?;
    Ok(runtime::RuntimeOwner::start(&paths.data_dir, &runtime::nonce()?)?)
}

struct Pending {
    view: ExecutionRequest,
    token: String,
    input: Value,
    route: Value,
    started: bool,
    transitioned_at: i64,
}

pub(super) struct ExecutionService {
    pub(super) owner: runtime::RuntimeOwner,
    listener: Option<TcpListener>,
    endpoint: String,
    capability: String,
    pub(super) state: RuntimeState,
    revision: u64,
    policy_revision: u64,
    pub(super) routes_current: bool,
    requests: BTreeMap<String, Pending>,
}

impl ExecutionService {
    pub(super) fn new(owner: runtime::RuntimeOwner) -> Result<Self> {
        let listener = TcpListener::bind("127.0.0.1:0")?;
        listener.set_nonblocking(true)?;
        Ok(Self {
            endpoint: listener.local_addr()?.to_string(),
            listener: Some(listener),
            capability: runtime::nonce()?,
            owner,
            state: RuntimeState::Starting,
            revision: 1,
            policy_revision: 0,
            routes_current: false,
            requests: BTreeMap::new(),
        })
    }

    pub(super) fn installation_id(&self) -> &str {
        self.owner.installation_id()
    }

    fn status(&self) -> RuntimeStatus {
        RuntimeStatus {
            state: self.state,
            epoch: self.owner.epoch().into(),
            revision: self.revision,
            checked_at: crate::time::now_rfc3339(),
            reason_id: (self.state == RuntimeState::Unknown).then(|| "execution-unavailable".into()),
        }
    }

    fn event(&self) -> ExecutionChangedEvent {
        ExecutionChangedEvent {
            epoch: self.owner.epoch().into(),
            revision: self.revision,
            requests: self.requests.values().map(|pending| pending.view.clone()).collect(),
        }
    }

    fn change(&mut self, id: &str, state: ExecutionState, reason: Option<&str>, now: i64) {
        let Some(pending) = self.requests.get_mut(id) else {
            return;
        };
        self.revision += 1;
        pending.view.revision = self.revision;
        pending.view.state = state;
        if state == ExecutionState::Running {
            pending.started = true;
        }
        pending.view.reason_id = reason.map(String::from);
        pending.transitioned_at = now;
        if state.terminal() {
            // The display is redacted; retained raw commands cannot survive expiry/cancellation.
            pending.input = Value::Null;
            pending.route = Value::Null;
        }
    }

    fn expire(&mut self, now: i64) -> bool {
        let expired: Vec<_> = self
            .requests
            .iter()
            .filter_map(|(id, pending)| {
                let state = pending.view.state;
                if state.unstarted() && crate::time::parse_rfc3339(&pending.view.expires_at).is_none_or(|at| now >= at)
                {
                    Some((id.clone(), ExecutionState::Expired, "execution-expired"))
                } else if state == ExecutionState::Dispatching && now - pending.transitioned_at > 15
                    || state == ExecutionState::Running
                        && now - pending.transitioned_at > pending.input["timeoutSec"].as_i64().unwrap_or(90) + 30
                {
                    Some((id.clone(), ExecutionState::Unknown, "execution-result-unknown"))
                } else {
                    None
                }
            })
            .collect();
        for (id, state, reason) in &expired {
            self.change(id, *state, Some(reason), now);
        }
        !expired.is_empty()
    }

    pub(super) fn policy_changed(&mut self, revision: u64) {
        if self.policy_revision == revision {
            return;
        }
        self.policy_revision = revision;
        let pending: Vec<_> = self
            .requests
            .iter()
            .filter(|(_, p)| p.view.state.unstarted())
            .map(|(id, _)| id.clone())
            .collect();
        for id in pending {
            self.change(
                &id,
                ExecutionState::Cancelled,
                Some("execution-policy-changed"),
                crate::time::now_secs(),
            );
        }
    }
}

fn failure(reason: &str, epoch: &str) -> Value {
    json!({"version":protocol::VERSION,"epoch":epoch,"state":"denied","reasonId":reason})
}

fn display(input: &Value) -> String {
    let args = input["args"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .collect::<Vec<_>>();
    let text = if input["kind"] == "exec" && args.len() == 1 {
        args[0].to_string()
    } else {
        args.iter()
            .map(|arg| format!("'{}'", arg.replace('\'', "'\\''")))
            .collect::<Vec<_>>()
            .join(" ")
    };
    crate::operations::redact_text(&guard_rules::redact(&text))
}

fn valid_input(input: &Value) -> bool {
    input.is_object()
        && serde_json::to_vec(input).is_ok_and(|bytes| bytes.len() <= protocol::MAX_FRAME - 2048)
        && input["envId"].as_str().and_then(EnvId::parse).is_some()
        && input["assetId"].as_str().is_some_and(|id| {
            !id.is_empty()
                && id.len() <= 128
                && id
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-'))
        })
        && matches!(input["kind"].as_str(), Some("exec" | "put" | "get" | "discover"))
        && input["args"].as_array().is_some_and(|args| {
            args.len() <= 256
                && args
                    .iter()
                    .all(|arg| arg.as_str().is_some_and(|s| !s.contains('\0') && s.len() <= 65_536))
                && args.iter().filter_map(Value::as_str).map(str::len).sum::<usize>() <= 65_536
        })
        && input["cwd"]
            .as_str()
            .is_some_and(|cwd| !cwd.is_empty() && cwd.len() <= 4096 && !cwd.chars().any(char::is_control))
        && input.get("tool").is_none_or(|tool| tool.is_null() || tool == "git")
        && input
            .get("timeoutSec")
            .is_none_or(|t| t.as_u64().is_some_and(|t| (1..=3600).contains(&t)))
        && (input["kind"] != "put" || input["inputDigest"].as_str().is_some_and(runtime::valid_token))
}

impl Backend {
    pub(super) fn execution(&self) -> Result<MutexGuard<'_, ExecutionService>> {
        self.execution
            .lock()
            .map_err(|_| AppError::ipc(IpcErrorId::ExecutionUnavailable))
    }

    pub fn get_runtime_status(&self) -> Result<RuntimeStatus> {
        Ok(self.execution()?.status())
    }

    pub fn list_execution_requests(&self) -> Result<Vec<ExecutionRequest>> {
        let _edit = self.edit()?;
        let mut service = self.execution()?;
        if service.expire(crate::time::now_secs()) {
            self.execution_changed(&service)?;
        }
        Ok(service.event().requests)
    }

    /// Called with mutation held. Only redacted snapshots are saved in SQLite.
    pub(super) fn execution_changed(&self, service: &ExecutionService) -> Result<()> {
        let event = service.event();
        for view in &event.requests {
            // A deleted resource must never be resurrected by a late result.
            if self.database()?.get_asset(&view.asset_id)?.is_none() {
                continue;
            }
            let allowed = matches!(
                view.state,
                ExecutionState::Waiting
                    | ExecutionState::Approved
                    | ExecutionState::Dispatching
                    | ExecutionState::Running
                    | ExecutionState::Succeeded
                    | ExecutionState::Failed
                    | ExecutionState::Unknown
            );
            let op = Operation {
                id: format!("exec_{}", view.request_id),
                asset_id: view.asset_id.clone(),
                env_id: view.env_id.clone(),
                at: view.created_at.clone(),
                session_id: String::new(),
                cwd: view.cwd.clone(),
                command: view.command.clone(),
                decision: if allowed {
                    OperationDecision::Allowed
                } else {
                    OperationDecision::Denied
                },
                reason_id: view
                    .reason_id
                    .as_ref()
                    .and_then(|reason| serde_json::from_value(Value::String(reason.clone())).ok()),
                source: Some(OperationSource::Runner),
                checked: Some(view.checked),
                execution_state: Some(view.state),
                request_id: Some(view.request_id.clone()),
                epoch: Some(view.epoch.clone()),
                exit_code: view.exit_code,
                duration_ms: view.duration_ms,
            };
            if self.database()?.upsert_execution_operation(&op)? {
                self.emit(
                    "operations://new",
                    &json!({"assetId":view.asset_id,"count":1,"denied":u32::from(!allowed)}),
                );
            }
        }
        self.emit("execution://changed", &event);
        Ok(())
    }

    pub fn respond_execution(&self, req: RespondExecutionRequest) -> Result<ExecutionRequest> {
        let _edit = self.edit()?;
        let mut service = self.execution()?;
        if service.expire(crate::time::now_secs()) {
            self.execution_changed(&service)?;
        }
        let pending = service
            .requests
            .get(&req.request_id)
            .ok_or_else(|| AppError::ipc(IpcErrorId::NotFound))?;
        if service.state != RuntimeState::Active
            || pending.view.revision != req.expected_revision
            || pending.view.state != ExecutionState::Waiting
        {
            return Err(AppError::ipc(IpcErrorId::ExecutionStale));
        }
        // A failed route publish must not permit an obsolete snapshot.
        self.current_execution_route(&pending.input, Some(pending.view.policy_revision))?;
        let (state, reason) = match req.decision {
            ExecutionResponse::AllowOnce => (ExecutionState::Approved, None),
            ExecutionResponse::Deny => (ExecutionState::Rejected, Some("execution-rejected")),
        };
        service.change(&req.request_id, state, reason, crate::time::now_secs());
        let view = service.requests[&req.request_id].view.clone();
        self.execution_changed(&service)?;
        Ok(view)
    }

    pub fn cancel_execution(&self, req: CancelExecutionRequest) -> Result<ExecutionRequest> {
        let _edit = self.edit()?;
        let mut service = self.execution()?;
        let pending = service
            .requests
            .get(&req.request_id)
            .ok_or_else(|| AppError::ipc(IpcErrorId::NotFound))?;
        if pending.view.revision != req.expected_revision || !pending.view.state.unstarted() {
            return Err(AppError::ipc(IpcErrorId::ExecutionStale));
        }
        service.change(
            &req.request_id,
            ExecutionState::Cancelled,
            Some("execution-cancelled"),
            crate::time::now_secs(),
        );
        let view = service.requests[&req.request_id].view.clone();
        self.execution_changed(&service)?;
        Ok(view)
    }

    pub(super) fn execution_rpc(&self, message: &Value) -> Result<Value> {
        let _edit = self.edit()?;
        let mut service = self.execution()?;
        let epoch = service.owner.epoch().to_string();
        if message["version"].as_u64() != Some(protocol::VERSION)
            || message["epoch"] != epoch
            || message["installationId"] != service.installation_id()
            || !message["capability"]
                .as_str()
                .is_some_and(|token| protocol::constant_time_eq(token, &service.capability))
            || !message["ownerToken"].as_str().is_some_and(runtime::valid_token)
        {
            return Ok(failure("execution-protocol-invalid", &epoch));
        }
        // Already-started callers may finish during handoff/exit; this grants no new execution.
        if message["op"] != "finish" && (service.state != RuntimeState::Active || !service.routes_current) {
            return Ok(failure("runtime-not-ready", &epoch));
        }
        let now = crate::time::now_secs();
        if service.expire(now) {
            self.execution_changed(&service)?;
        }
        let op = message["op"].as_str().unwrap_or("");
        if op == "submit" {
            let input = &message["input"];
            if !valid_input(input) {
                return Ok(failure("execution-input-invalid", &epoch));
            }
            if service.requests.len() >= MAX_REQUESTS {
                let completed = service
                    .requests
                    .iter()
                    .find(|(_, pending)| pending.view.state.terminal())
                    .map(|(id, _)| id.clone());
                if let Some(id) = completed {
                    service.requests.remove(&id);
                } else {
                    return Ok(failure("execution-queue-full", &epoch));
                }
            }
            let (route, policy_revision) = self.current_execution_route(input, None)?;
            let args = input["args"]
                .as_array()
                .expect("validated args")
                .iter()
                .map(|s| s.as_str().expect("validated arg").to_string())
                .collect::<Vec<_>>();
            let decision = guard_rules::evaluate_execution(
                &route["policy"],
                input["kind"].as_str().expect("validated kind"),
                &args,
                input["tool"].as_str(),
            );
            let state = match decision["decision"].as_str() {
                Some("allow") => ExecutionState::Approved,
                Some("ask") => ExecutionState::Waiting,
                _ => ExecutionState::Denied,
            };
            let id = crate::new_id("req");
            service.revision += 1;
            let view = ExecutionRequest {
                request_id: id.clone(),
                epoch: epoch.clone(),
                revision: service.revision,
                policy_revision,
                asset_id: input["assetId"].as_str().expect("validated asset").into(),
                env_id: EnvId::parse(input["envId"].as_str().expect("validated env")).expect("validated env"),
                kind: serde_json::from_value(input["kind"].clone())?,
                source: "unidentified".into(),
                command: display(input),
                cwd: crate::operations::redact_text(input["cwd"].as_str().expect("validated cwd")),
                state,
                checked: true,
                approval_required: state == ExecutionState::Waiting,
                created_at: crate::time::format_rfc3339(now),
                expires_at: crate::time::format_rfc3339(now + APPROVAL_TTL),
                reason_id: decision["reasonId"].as_str().map(String::from),
                exit_code: None,
                duration_ms: None,
            };
            service.requests.insert(
                id.clone(),
                Pending {
                    view,
                    token: message["ownerToken"].as_str().expect("validated token").into(),
                    input: if state.terminal() { Value::Null } else { input.clone() },
                    route: if state.terminal() { Value::Null } else { route },
                    started: false,
                    transitioned_at: now,
                },
            );
            self.execution_changed(&service)?;
            return Ok(reply(&service, &id, false));
        }
        let id = message["requestId"].as_str().unwrap_or("");
        let Some(pending) = service.requests.get(id) else {
            return Ok(failure("execution-not-found", &epoch));
        };
        // Terminal display records remain queryable with the same owner token; no raw payload is returned.
        if !pending.token.is_empty()
            && !protocol::constant_time_eq(message["ownerToken"].as_str().expect("validated token"), &pending.token)
        {
            return Ok(failure("execution-not-found", &epoch));
        }
        if op == "claim" && message["input"]["envId"].as_str() != Some(pending.view.env_id.as_str()) {
            let mut denied = failure("execution-ticket-invalid", &epoch);
            denied["requestId"] = id.into();
            return Ok(denied);
        }
        let state = pending.view.state;
        let was_started = pending.started;
        let mut include_input = false;
        match op {
            "claim" if state == ExecutionState::Approved => {
                let route = self.current_execution_route(&pending.input, Some(pending.view.policy_revision));
                let current = route.is_ok_and(|(route, _)| route == pending.route);
                if !current {
                    service.change(id, ExecutionState::Cancelled, Some("execution-policy-changed"), now);
                } else {
                    service.change(id, ExecutionState::Dispatching, None, now);
                    include_input = true;
                }
            }
            "claim" => {}
            "cancel" if state.unstarted() => {
                service.change(id, ExecutionState::Cancelled, Some("execution-cancelled"), now)
            }
            "started" if state == ExecutionState::Dispatching => service.change(id, ExecutionState::Running, None, now),
            "finish"
                if matches!(state, ExecutionState::Dispatching | ExecutionState::Running)
                    || state == ExecutionState::Unknown && was_started =>
            {
                let outcome = match message["outcome"].as_str() {
                    Some("succeeded") if was_started && message["exitCode"].as_i64() == Some(0) => {
                        ExecutionState::Succeeded
                    }
                    Some("failed") => ExecutionState::Failed,
                    _ => ExecutionState::Unknown,
                };
                service.change(id, outcome, message["reasonId"].as_str(), now);
                let pending = service.requests.get_mut(id).expect("existing request");
                pending.view.exit_code = message["exitCode"].as_i64().and_then(|code| i32::try_from(code).ok());
                pending.view.duration_ms = message["durationMs"]
                    .as_u64()
                    .and_then(|ms| u32::try_from(ms).ok())
                    .filter(|ms| *ms <= 3_630_000);
            }
            "cancel" | "started" | "finish" => {}
            _ => return Ok(failure("execution-protocol-invalid", &epoch)),
        }
        self.execution_changed(&service)?;
        Ok(reply(&service, id, include_input))
    }

    pub(super) fn activate_execution(&self) -> Result<()> {
        let mut service = self.execution()?;
        // No current routes is a readiness error, never an unchecked shortcut.
        if !service.routes_current || !self.paths.data_dir.join("routes/manifest.json").is_file() {
            return Err(AppError::ipc(IpcErrorId::ExecutionUnavailable));
        }
        service
            .owner
            .publish("active", Some(&service.endpoint), Some(&service.capability))?;
        service.state = RuntimeState::Active;
        service.revision += 1;
        self.emit("runtime://changed", &json!({"status":service.status()}));
        Ok(())
    }

    pub(super) fn start_execution_service(self: &Arc<Self>) -> Result<()> {
        let listener = self
            .execution()?
            .listener
            .take()
            .ok_or_else(|| AppError::ipc(IpcErrorId::ExecutionUnavailable))?;
        let weak = Arc::downgrade(self);
        std::thread::Builder::new()
            .name("cloudlink-execution".into())
            .spawn(move || {
                loop {
                    let Some(backend) = weak.upgrade() else { break };
                    if backend
                        .execution()
                        .is_ok_and(|s| matches!(s.state, RuntimeState::Stopping | RuntimeState::Stopped))
                    {
                        break;
                    }
                    match listener.accept() {
                        Ok((mut stream, _)) => {
                            let response = protocol::configure(&stream)
                                .and_then(|_| protocol::read_frame(&mut stream))
                                .ok()
                                .map(|message| {
                                    backend
                                        .execution_rpc(&message)
                                        .unwrap_or_else(|_| failure("execution-unavailable", ""))
                                });
                            if let Some(response) = response {
                                let _ = protocol::write_frame(&mut stream, &response);
                            }
                        }
                        Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {}
                        Err(_) => {
                            if let Ok(mut service) = backend.execution() {
                                service.state = RuntimeState::Unknown;
                                service.revision += 1;
                                backend.emit("runtime://changed", &json!({"status":service.status()}));
                            }
                            break;
                        }
                    }
                    if let Ok(_edit) = backend.edit()
                        && let Ok(mut service) = backend.execution()
                        && service.expire(crate::time::now_secs())
                    {
                        let _ = backend.execution_changed(&service);
                    }
                    drop(backend);
                    std::thread::sleep(Duration::from_millis(25));
                }
            })?;
        Ok(())
    }

    pub fn stop_execution(&self) {
        let Ok(_edit) = self.mutation.lock() else { return };
        let Ok(mut service) = self.execution() else { return };
        if matches!(service.state, RuntimeState::Stopping | RuntimeState::Stopped) {
            return;
        }
        let _ = service.owner.publish("stopping", None, None);
        service.state = RuntimeState::Stopping;
        let ids: Vec<_> = service
            .requests
            .iter()
            .filter(|(_, p)| p.view.state.unstarted())
            .map(|(id, _)| id.clone())
            .collect();
        for id in ids {
            service.change(
                &id,
                ExecutionState::Cancelled,
                Some("execution-app-exited"),
                crate::time::now_secs(),
            );
        }
        let _ = self.execution_changed(&service);
        // This is only an intent. The shared snapshot still reports stopping while our PID lives.
        let _ = service.owner.publish("stopped", None, None);
        service.revision += 1;
        self.emit("runtime://changed", &json!({"status":service.status()}));
    }

    pub(super) fn forget_execution_requests_locked(&self) -> Result<()> {
        let mut service = self.execution()?;
        service.requests.clear();
        service.revision += 1;
        self.emit("execution://changed", &service.event());
        Ok(())
    }

    pub(super) fn cancel_unstarted_execution_locked(&self, reason: &str) -> Result<()> {
        let mut service = self.execution()?;
        let ids: Vec<_> = service
            .requests
            .iter()
            .filter(|(_, p)| p.view.state.unstarted())
            .map(|(id, _)| id.clone())
            .collect();
        for id in ids {
            service.change(&id, ExecutionState::Cancelled, Some(reason), crate::time::now_secs());
        }
        self.execution_changed(&service)
    }
}

fn reply(service: &ExecutionService, id: &str, include_input: bool) -> Value {
    let pending = &service.requests[id];
    let mut result = json!({
        "version":protocol::VERSION,"epoch":service.owner.epoch(),"requestId":id,
        "state":pending.view.state,"revision":pending.view.revision,"reasonId":pending.view.reason_id,
        "expiresAtSecs":crate::time::parse_rfc3339(&pending.view.expires_at),
        "policyRevision":pending.view.policy_revision,
    });
    if include_input {
        result["input"] = pending.input.clone();
        let route = serde_json::to_vec(&pending.route).expect("route serializes");
        result["routeDigest"] = runtime::digest(&route).into();
        // JSON escaping can expand the input. Measure actual bytes, never truncate a scope.
        let size = serde_json::to_vec(&result).expect("reply serializes").len();
        if size + route.len() + 16 <= protocol::MAX_FRAME {
            result["route"] = pending.route.clone();
        }
    }
    result
}

#[cfg(test)]
mod tests;
