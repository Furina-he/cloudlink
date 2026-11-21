// 手写契约（PRD 3.3）。资源分两类：服务器（SSH，type "vps"）和云平台（CLI，type "cli"）；档位与分发是资源的属性
import type { EnvId } from "./env"
import type { GithubConfig, GithubCreateInput } from "./github"
import type { IpcErrorId } from "./misc"

export type AssetType = "vps" | "cli"
/** 云平台 CLI：cloudflare（cf）、vercel（vercel）、oracle（oci）。v0.1 每家一个资源，标识就是这个值（F-101 AC1） */
export type CliProvider = "cloudflare" | "vercel" | "oracle" | "github"
export type FieldSource = "manual" | "probe"
export type ProbeState = "never" | "ok" | "stale" | "failed"
import type { Mode } from "./generated/asset"
export type { Mode } from "./generated/asset"
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

export type RepoSource = import("./generated/asset").RepoSource

export interface AssetPath {
  key: string
  label: string
  path: string
  source: FieldSource
  repoSource?: RepoSource
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

/** 两类资源共有的字段 */
interface AssetBase {
  id: string
  name: string
  /** F-109：生产环境开关 */
  production: boolean
  summary: string
  agent: AssetAgent
  guardrails: { rules: GuardrailRule[] }
  notes: string
  createdAt: string
  updatedAt: string
}

/** 服务器（SSH） */
export interface ServerAsset extends AssetBase {
  type: "vps"
  provider?: string
  region?: string
  tags: string[]
  connection: AssetConnection
  facts: AssetFacts
  paths: AssetPath[]
  services: Service[]
  servedHostnames: string[]
  listeningPorts: ListeningPort[]
  export: ExportFlags
  probe: AssetProbeInfo
}

/** 云平台 CLI 在一个运行环境里的状态（F-104 AC1，经 Login Shell 检测） */
export interface CliEnvState {
  installed: boolean
  version?: string
  path?: string
  authenticated: boolean
  /** 登录过，但凭据已过期 */
  expired: boolean
  /** whoami 回显的账号或团队名，防止登错团队 */
  account?: string
  /** 这次登录能操作的全部账号：Cloudflare 的 Account、Vercel 的 Team、OCI 的 Profile、gh 的活动账号；第一个是默认 */
  accounts?: string[]
  checkedAt: string
}

/** 一键安装并登录（F-104 AC2，P9b）：前端只传这三个定位值，命令由 Rust 查固定表。cf／vercel／gh 在后台运行并打开浏览器，OCI 保留可见终端 */
export interface CliSetupRequest {
  provider: CliProvider
  envId: EnvId
  method: string
}

/** 返回设置 ID 和初始阶段，避免事件先于 IPC 返回时界面闪空 */
export interface CliSetupStarted {
  id: string
  state: CliSetupState
  step?: CliSetupStep
}

export type CliSetupState = "waiting-install" | "waiting-login" | "ready" | "failed" | "timed-out"
export type CliSetupStep = "install" | "login"

/** `cli-setup://changed`：只报阶段，是否登录成功仍以重新检测为准 */
export interface CliSetupChangedEvent {
  id: string
  provider: CliProvider
  envId: EnvId
  state: CliSetupState
  step?: CliSetupStep
}

export type CliScopeKind = "zone" | "worker" | "pages" | "project" | "instance" | "repo"

/** GitHub 仓库的可见性（F-110 AC1） */
export type RepoVisibility = "public" | "private" | "internal"

/** 云平台账号下的一项资源（F-104 AC3）；未勾选的不进入编译产物 */
export interface CliScopeItem {
  id: string
  kind: CliScopeKind
  name: string
  selected: boolean
  /** 自动识别的关联服务器（F-104 AC4） */
  linkedAssetId?: string
  /** 仅 OCI 实例：公网地址，「同时加为 SSH 服务器」时预填 */
  address?: string
  /** 仅 GitHub 仓库：默认分支 */
  defaultBranch?: string
  /** 仅 GitHub 仓库 */
  visibility?: RepoVisibility
  repoSource?: RepoSource
}

export interface CliInfo {
  binary: "cf" | "vercel" | "oci" | "gh"
  /** 按已启用 Agent 所在的运行环境记录 */
  envStates: Partial<Record<EnvId, CliEnvState>>
  scope: CliScopeItem[]
}

export type CloudScopeMode = "auto" | "manual"

export type CloudSnapshotStatus = "complete" | "partial" | "failed"

/** 非 GitHub 云平台（Cloudflare / Vercel / Oracle Cloud）的动态范围配置（2026-11-21，对齐 GitHub） */
export interface CloudScopeConfig {
  mode: CloudScopeMode
  excludedIds: string[]
  selectedIds: string[]
  snapshotStatus: CloudSnapshotStatus
  snapshotErrorId?: IpcErrorId
  checkedAt?: string
  revision: number
}

export interface CloudScopeCreateInput {
  mode: CloudScopeMode
  selectedIds: string[]
  excludedIds: string[]
}

export interface CloudScopeSaveRequest {
  assetId: string
  expectedRevision: number
  mode: CloudScopeMode
  selectedIds: string[]
  excludedIds: string[]
}

/** 云平台（CLI） */
export interface CliAsset extends AssetBase {
  type: "cli"
  cliProvider: CliProvider
  /** 标识（Skill 里的名字）：同一家的第一个是 cloudflare，之后是 cloudflare-2…；后端分配，不可改 */
  handle: string
  /** 绑定的账号（CliEnvState.accounts 中的一项）；同一家每个账号只接入一次。null 表示跟随 CLI 当前登录 */
  account: string | null
  cloudScope?: CloudScopeConfig
  github?: GithubConfig
  cli: CliInfo
}

export type Asset = ServerAsset | CliAsset

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
 * save_asset、preview_skill 的输入：新建时没有 id。分发、档位走单独的命令（立即生效，不经过保存）；
 * 探测信息、时间戳、解析快照、验证结果由后端维护
 */
export type ServerAssetInput = Omit<ServerAsset, "id" | "connection" | "agent" | "probe" | "createdAt" | "updatedAt"> & {
  id?: string
  connection: ConnectionInput
  /** 保存前刚通过的那次测试连接；参数与它一致时，后端保留验证结果（F-106 AC4） */
  testId?: string
}

/** 云平台资源的输入。检测结果和范围由后端维护，范围变更走 save_cloud_scope / save_github_scope */
export type CliAssetInput = Omit<CliAsset, "id" | "handle" | "agent" | "cli" | "cloudScope" | "github" | "createdAt" | "updatedAt"> & {
  id?: string
  cloudScope?: CloudScopeCreateInput
  github?: GithubCreateInput
  scope?: CliScopeItem[]
}

export type AssetInput = ServerAssetInput | CliAssetInput

/** 导入对话框里勾选的一行 */
export interface ImportHost {
  alias: string
  definedIn: EnvId[]
}
