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

export interface ProbeProgressEvent {
  runId: string
  step: ProbeStep
  status: ProbeStepStatus
  ms?: number
}

export type ProbeRunStatus = "running" | "ok" | "failed" | "cancelled"

export interface ProbeFinishedEvent {
  runId: string
  status: Exclude<ProbeRunStatus, "running">
  error?: ProbeError
  diff?: ProbeDiff
}
