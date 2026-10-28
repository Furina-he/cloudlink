// 手写契约（PRD 6.5、8.3）
export type ProbeStep =
  | "resolve-alias"
  | "connect"
  | "collect-system"
  | "collect-services"
  | "collect-ports"
  | "diff"

export type ProbeStepStatus = "running" | "done" | "error"

export type ProbeErrorId =
  | "auth-failed"
  | "host-key-unknown"
  | "host-key-changed"
  | "resolve-failed"
  | "timeout"
  | "connection-refused"
  | "needs-interaction"
  | "partial"
  | "unknown"

export interface ProbeError {
  id: ProbeErrorId
  /** 例如 { alias: "sg-db" }；部分成功时 { alias, section: "docker" } */
  params?: Record<string, string | number>
}

export type ProbeChangeKind = "added" | "changed" | "missing"

export interface ProbeChange {
  id: string
  kind: ProbeChangeKind
  field: "service" | "os" | "kernel" | "listeningPorts" | "facts"
  /** 标题里的对象名，例如服务名 api-gateway */
  label: string
  before?: string
  after?: string
}

export interface ProbeDiff {
  changes: ProbeChange[]
  durationMs: number
  finishedAt: string
}

// 两个事件都带 assetId（2026-10-28 用户确认，偏离 PRD 7.8）：导入后由后端发起的探测，前端也能归到对应资产
export interface ProbeProgressEvent {
  runId: string
  assetId: string
  step: ProbeStep
  status: ProbeStepStatus
  ms?: number
}

export type ProbeRunStatus = "running" | "ok" | "failed" | "cancelled"

export interface ProbeFinishedEvent {
  runId: string
  assetId: string
  status: Exclude<ProbeRunStatus, "running">
  /** 失败原因；status 为 ok 时可能是 partial（部分段采集失败） */
  error?: ProbeError
  diff?: ProbeDiff
}
