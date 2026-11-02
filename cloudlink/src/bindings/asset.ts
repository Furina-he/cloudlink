// 手写契约（PRD 3.3）。v3：连接可在界面录入（managed）或来自用户的 ssh config（imported）；档位与分发开关是服务器的属性
import type { EnvId } from "./env"

export type AssetType = "vps" | "domain" | "panel" | "storage"
export type EnvTag = "prod" | "staging" | "dev"
export type FieldSource = "manual" | "probe"
export type ProbeState = "never" | "ok" | "stale" | "failed"
export type Mode = "read-only" | "standard"
export type ConnectionSource = "managed" | "imported"
export type AuthMethod = "key" | "agent" | "password"

export interface ResolvedConnection {
  hostname: string
  user: string
  port: number
  proxyJump: string | null
  resolvedAt: string
}

/** 认证方式（F-108）。密码不在这里，只存系统凭据库 */
export interface AssetAuth {
  method: AuthMethod
  /** 仅 key：按运行环境分别记录私钥路径 */
  identityFile: Partial<Record<EnvId, string>>
  /** 由「改用密钥登录」生成或由「复制到 WSL」复制出的密钥，删除服务器时可以一并清理 */
  generatedByCloudLink: boolean
  /** 凭据库里存着这台服务器的密码（F-108 AC3 删除密码、「改用密钥登录」都要知道） */
  passwordSaved: boolean
}

/** 最近一次测试连接或探测的结果；连接字段被修改并保存后清空（F-106 AC5） */
export interface ConnectionVerified {
  ok: boolean
  at: string
  envIds: EnvId[]
}

export interface AssetConnection {
  source: ConnectionSource
  /** Agent 使用的别名；managed 时默认由名称生成 */
  sshAlias: string
  /** 仅 managed */
  host?: string
  port?: number
  user?: string
  auth?: AssetAuth
  proxyJump?: string | null
  /** 哪些运行环境的 ssh 配置里有这个别名（managed 即托管文件写入了哪些环境，F-107 AC5） */
  definedIn: EnvId[]
  /** 由 ssh -G 得到的只读快照，默认不导出 */
  resolved: ResolvedConnection | null
  verified: ConnectionVerified | null
}

export interface AssetAgent {
  /** 分发给哪些 Agent（F-303，AgentKey）；为空表示不分发 */
  agents: string[]
  mode: Mode
  /** 临时解锁的到期时间（F-306 AC2）；为空表示没有解锁 */
  unlockedUntil: string | null
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
  /** 打开后护栏会拦下停止或删除它的命令（8.6） */
  critical: boolean
  source: FieldSource
  lastSeenAt?: string
  /** 上次探测有、这次没发现（F-103 AC2） */
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
  envTag: EnvTag
  provider?: string
  region?: string
  tags: string[]
  summary: string
  connection: AssetConnection
  agent: AssetAgent
  facts: AssetFacts
  paths: AssetPath[]
  services: Service[]
  servedHostnames: string[]
  listeningPorts: ListeningPort[]
  guardrails: { rules: GuardrailRule[] }
  export: ExportFlags
  notes: string
  probe: AssetProbeInfo
  createdAt: string
  updatedAt: string
}

/** 录入的连接（save_asset）。imported 只有别名，连接信息由用户的 ssh config 维护 */
export type ConnectionInput =
  | {
      source: "managed"
      sshAlias: string
      host: string
      port: number
      user: string
      auth: Pick<AssetAuth, "method" | "identityFile">
      proxyJump: string | null
      /** 写入哪些运行环境的托管配置（F-107 AC5） */
      definedIn: EnvId[]
    }
  | { source: "imported"; sshAlias: string }

/**
 * save_asset、preview_skill 的输入：新建时没有 id。分发开关、档位、解锁走单独的命令（立即生效，不经过保存）；
 * 探测信息、时间戳、解析快照、验证结果由后端维护
 */
export type AssetInput = Omit<
  Asset,
  "id" | "connection" | "agent" | "probe" | "createdAt" | "updatedAt"
> & {
  id?: string
  connection: ConnectionInput
  /** 保存前刚通过的那次测试连接；参数与它一致时，后端保留验证结果（F-106 AC4） */
  testId?: string
}

/** 导入对话框里勾选的一行 */
export interface ImportHost {
  alias: string
  definedIn: EnvId[]
}
