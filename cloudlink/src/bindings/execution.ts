// P8：仅展示快照。ownerToken、原始argv与可重放输入不在GUI契约内。
import type { EnvId } from "./env"

export type RuntimeState = "starting" | "active" | "stopping" | "stopped" | "unknown"
export interface RuntimeStatus {
  state: RuntimeState
  epoch: string
  revision: number
  checkedAt: string
  reasonId?: string
}
export type ExecutionState = "waiting" | "approved" | "dispatching" | "running" | "denied" | "rejected" | "expired" | "cancelled" | "succeeded" | "failed" | "unknown"
export type ExecutionKind = "exec" | "put" | "get" | "discover"
export interface ExecutionRequest {
  requestId: string
  epoch: string
  revision: number
  policyRevision: number
  assetId: string
  envId: EnvId
  kind: ExecutionKind
  source: "unidentified"
  command: string
  cwd: string
  state: ExecutionState
  checked: boolean
  approvalRequired: boolean
  createdAt: string
  expiresAt: string
  reasonId?: string
  exitCode?: number
  durationMs?: number
}
export interface ExecutionChangedEvent {
  epoch: string
  revision: number
  requests: ExecutionRequest[]
}
export type ExecutionResponse = "allow-once" | "deny"
export interface RespondExecutionRequest {
  requestId: string
  expectedRevision: number
  decision: ExecutionResponse
}
export interface CancelExecutionRequest {
  requestId: string
  expectedRevision: number
}
