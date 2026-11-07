// 手写契约（PRD 6.4 探测流程、7.8、8.3）。v3：探测结果自动合并，可以撤销；疑似注入的值列为待确认
export type ProbeStep =
  | "resolve-alias"
  | "connect"
  | "collect-system"
  | "collect-services"
  | "collect-ports"
  | "merge"

export type ProbeStepStatus = "running" | "done" | "error"

/** ssh 错误分类（PRD 8.3），探测和测试连接共用 */
export type SshErrorId =
  | "auth-failed"
  | "password-rejected"
  | "host-key-unknown"
  | "host-key-changed"
  | "resolve-failed"
  | "timeout"
  | "connection-refused"
  | "needs-interaction"
  | "key-permissions"
  /** 私钥文件不存在（F-108 的常见问题，归入测试连接的错误分类，2026-10-31） */
  | "key-not-found"
  /** 私钥文件不是 OpenSSH 能用的私钥：PuTTY 格式、公钥或无法识别（params.reason） */
  | "key-invalid"
  | "partial"
  | "unknown"

/** 旧名，探测相关的代码沿用 */
export type ProbeErrorId = SshErrorId

export interface SshError {
  id: SshErrorId
  /** 例如 { alias: "sg-db" }；部分成功时 { alias, section: "docker" } */
  params?: Record<string, string | number>
}

export type ProbeError = SshError

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

// 两个事件都带 assetId（2026-10-28 用户确认，PRD 7.8 v3 已采纳）
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
  /** 已自动合并的变化（F-103 AC2） */
  applied?: ProbeChange[]
  /** 疑似注入、等用户确认的变化（F-103 AC5） */
  held?: ProbeChange[]
  durationMs?: number
  finishedAt?: string
}
