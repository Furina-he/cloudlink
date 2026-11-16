import { emit } from "@tauri-apps/api/event"

import type { ExecutionRequest, ExecutionState, RespondExecutionRequest, CancelExecutionRequest, Operation } from "@/bindings"
import { db, fail, now, scenario } from "./state"

function notify() {
  void emit("execution://changed", { epoch: db.runtime.epoch, revision: db.runtime.revision, requests: db.executionRequests })
}

function record(request: ExecutionRequest, emitEvent = true) {
  if (!db.assets.some((asset) => asset.id === request.assetId)) return
  const operation: Operation = {
    id: `exec_${request.requestId}`, assetId: request.assetId, envId: request.envId,
    at: request.createdAt, sessionId: request.sessionId ?? "", caller: request.caller, cwd: request.cwd, command: request.command,
    decision: ["waiting", "approved", "dispatching", "running", "succeeded", "failed", "unknown"].includes(request.state) ? "allowed" : "denied",
    source: "runner", checked: request.checked, executionState: request.state, requestId: request.requestId,
    epoch: request.epoch, exitCode: request.exitCode, durationMs: request.durationMs,
  }
  const index = db.operations.findIndex((op) => op.id === operation.id)
  if (index >= 0) db.operations[index] = operation
  else db.operations.unshift(operation)
  if (emitEvent) void emit("operations://new", { assetId: request.assetId, count: 1, denied: Number(operation.decision === "denied") })
}

function change(request: ExecutionRequest, state: ExecutionState) {
  request.state = state
  request.revision = ++db.runtime.revision
  record(request)
  notify()
  return request
}

function expire() {
  for (const request of db.executionRequests) {
    if (["waiting", "approved", "dispatching"].includes(request.state) && Date.parse(request.expiresAt) <= Date.now()) change(request, "expired")
  }
}

export function cancelMockExecutions(assetId?: string) {
  for (const request of db.executionRequests) {
    if ((!assetId || request.assetId === assetId) && ["waiting", "approved", "dispatching"].includes(request.state)) change(request, "cancelled")
  }
}

export function resetMockExecutions() {
  cancelMockExecutions()
  db.executionRequests = []
  db.runtime.revision += 1
  notify()
}

const fixtureStates = new Set<ExecutionState>(["waiting", "approved", "running", "expired", "unknown", "succeeded", "failed"])
const requestedState = new URLSearchParams(window.location.search).get("execution") as ExecutionState | null
if (scenario === "approval" || requestedState && fixtureStates.has(requestedState)) {
  const state = requestedState ?? "waiting"
  for (let index = 0; index < 3; index++) {
    const request: ExecutionRequest = {
      requestId: `req_mock_${index}`, epoch: db.runtime.epoch, revision: ++db.runtime.revision,
      policyRevision: 1, assetId: "ast_sg_db", envId: "windows", kind: "exec", source: "unidentified",
      caller: index === 0 ? { agent: "codex", provenance: "self-reported" } : index === 1 ? { agent: "claude-code", provenance: "self-reported" } : undefined,
      sessionId: index === 0 ? "codex-mock-thread" : undefined,
      command: ["docker compose down -v", "kubectl apply -f /opt/apps/api/deployment.yaml", "sh -c 'cd /opt/apps/api && ./deploy.sh --production'"][index],
      cwd: "D:/fixture/workspace", state, checked: true, approvalRequired: true,
      createdAt: now(), expiresAt: new Date(Date.now() + (state === "expired" ? -1 : 300_000)).toISOString(),
      ...(state === "succeeded" ? { exitCode: 0, durationMs: 812 } : state === "failed" ? { exitCode: 1, durationMs: 812 } : {}),
    }
    db.executionRequests.push(request)
    record(request, false) // Initial fixtures precede mockIPC installation; load reads the complete snapshot.
  }
}

type Args = Record<string, unknown>
export const executionHandlers: Record<string, (args: Args) => unknown> = {
  get_runtime_status: () => ({ ...db.runtime, checkedAt: now() }),
  list_execution_requests: () => { expire(); return db.executionRequests },
  respond_execution: (args) => {
    expire()
    const req = args.req as RespondExecutionRequest
    const request = db.executionRequests.find((request) => request.requestId === req.requestId) ?? fail("not-found")
    if (request.revision !== req.expectedRevision || request.state !== "waiting") fail("execution-stale")
    // Approval is not execution; only an original runner continuation can consume it.
    return change(request, req.decision === "allow-once" ? "approved" : "rejected")
  },
  cancel_execution: (args) => {
    const req = args.req as CancelExecutionRequest
    const request = db.executionRequests.find((request) => request.requestId === req.requestId) ?? fail("not-found")
    if (request.revision !== req.expectedRevision || !["waiting", "approved", "dispatching"].includes(request.state)) fail("execution-stale")
    return change(request, "cancelled")
  },
  // Browser fixtures only. This name is not a native command, permission or execution API.
  mock_execution_continue: (args) => {
    const request = db.executionRequests.find((request) => request.requestId === args.requestId) ?? fail("not-found")
    if (request.state !== "approved") fail("execution-stale")
    return change(request, "running")
  },
  mock_execution_finish: (args) => {
    const request = db.executionRequests.find((request) => request.requestId === args.requestId) ?? fail("not-found")
    if (request.state !== "running") fail("execution-stale")
    request.exitCode = typeof args.exitCode === "number" ? args.exitCode : undefined
    request.durationMs = 812
    return change(request, request.exitCode === 0 ? "succeeded" : request.exitCode === undefined ? "unknown" : "failed")
  },
}
