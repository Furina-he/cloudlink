// 手写契约（PRD 3.3）
import type { EnvId } from "./env"
import type { Mode } from "./mount"

export type AssetType = "vps" | "domain" | "panel" | "storage"
export type EnvTag = "prod" | "staging" | "dev"
export type FieldSource = "manual" | "probe"
export type ProbeState = "never" | "ok" | "stale" | "failed"

export interface ResolvedConnection {
  hostname: string
  user: string
  port: number
  proxyJump: string | null
  resolvedAt: string
}

export interface AssetConnection {
  sshAlias: string
  definedIn: EnvId[]
  /** 由 ssh -G 得到的只读快照，默认不导出 */
  resolved: ResolvedConnection | null
}

export interface AssetFacts {
  os?: string
  kernel?: string
  arch?: string
  cpuCores?: number
  memoryTotalMiB?: number
  diskTotalGiB?: number
  panel?: { type: "1panel" | "bt"; installPath: string } | null
}

export interface AssetPath {
  key: string
  label: string
  path: string
  source: FieldSource
}

export interface PortMapping {
  hostIp: string
  hostPort: number
  containerPort: number
  proto: "tcp" | "udp"
}

export interface Service {
  kind: "docker" | "systemd"
  name: string
  image?: string
  ports: PortMapping[]
  role?: string
  critical: boolean
  source: FieldSource
  lastSeenAt?: string
  /** 上次探测有、这次没发现（F-103 AC3） */
  missing: boolean
  /** 名称含非法字符，已被替换（PRD 8.3） */
  sanitized?: boolean
}

export interface ListeningPort {
  addr: string
  port: number
  proto: "tcp" | "udp"
}

export interface GuardrailRule {
  id: string
  text: string
}

export interface ExportFlags {
  resolvedConnection: boolean
  listeningPorts: boolean
  image: boolean
}

export interface AssetProbeInfo {
  lastRunId: string | null
  lastSuccessAt: string | null
  status: ProbeState
}

export interface Asset {
  id: string
  type: AssetType
  name: string
  slug: string
  envTag: EnvTag
  provider?: string
  region?: string
  tags: string[]
  summary: string
  connection: AssetConnection
  facts: AssetFacts
  paths: AssetPath[]
  services: Service[]
  servedHostnames: string[]
  listeningPorts: ListeningPort[]
  guardrails: { defaultMode: Mode; rules: GuardrailRule[] }
  export: ExportFlags
  notes: string
  probe: AssetProbeInfo
  createdAt: string
  updatedAt: string
}

/** save_asset、preview_compile 的输入：新建时没有 id；探测信息、时间戳、解析快照由后端维护 */
export type AssetInput = Omit<
  Asset,
  "id" | "probe" | "createdAt" | "updatedAt" | "connection"
> & {
  id?: string
  connection: Pick<AssetConnection, "sshAlias">
}

/** 导入对话框里勾选的一行 */
export interface ImportHost {
  alias: string
  definedIn: EnvId[]
}
