// 手写契约（PRD 4.4、6.7、7.8）
import type { Asset, Mode } from "./asset"
import type { CompileStatus } from "./compile"
import type { EnvId } from "./env"

/** 活动日志的类型（F-402、6.7）。「Agent 操作」来自护栏记录（F-307），在活动里单独一项 */
export type ActivityKind =
  | "connection"
  | "probe"
  | "compile"
  | "deliver"
  | "remove"
  | "repair"
  | "ssh-config"
  | "guard"
  | "mode"
  | "cli"
  | "note"
  | "agent-op"

export type ActivityMessageId =
  | "test-ok"
  | "test-failed"
  | "probe-updated"
  | "probe-held"
  | "probe-no-changes"
  | "probe-failed"
  | "probe-undone"
  | "compile-ok"
  | "compile-blocked"
  | "deliver-ok"
  | "remove-ok"
  | "repair-ok"
  | "ssh-config-written"
  | "ssh-include-added"
  | "guard-installed"
  | "guard-removed"
  | "mode-changed"
  | "cli-detected"
  | "cli-scope-updated"
  | "notes-merged"
  | "notes-dismissed"
  | "agent-op-allowed"
  | "agent-op-denied"

export interface ActivityItem {
  id: string
  kind: ActivityKind
  at: string
  assetId?: string
  /** 后端只给 id 和参数，句子由 copy.ts 拼出 */
  messageId: ActivityMessageId
  params?: Record<string, string | number>
  durationMs?: number
  /** 执行过的命令清单、差异摘要或完整命令，可展开 */
  detail?: string
  ok: boolean
}

export interface ActivityQuery {
  /** 返回 at 早于它的记录，分页用 */
  before?: string
  limit: number
  kinds?: ActivityKind[]
  assetId?: string
}

export interface Settings {
  theme: "system" | "light" | "dark"
  /** v0.1 固定 en */
  outputLanguage: "en"
  environments: { id: EnvId; enabled: boolean }[]
  /** 正文行数上限，默认 100（5.4） */
  bodyLineLimit: number
  writeSnapshotTime: boolean
  /** 新建非生产服务器的默认档位；生产服务器固定为只读巡检（F-202 AC2） */
  defaultMode: Mode
  probeTimeoutSec: number
  /** 默认是系统 OpenSSH 的绝对路径（PRD 8.3） */
  windowsSshPath: string
  dataDir: string
  logDir: string
  /** 已经问过「加入 Include」的运行环境：拒绝后不再弹窗，改在设置里给出手动说明（F-107 AC1） */
  sshIncludeAsked: EnvId[]
}

export interface SaveResult {
  asset: Asset
  /** 这次保存触发的重新编译，每个运行环境一条 */
  statuses: CompileStatus[]
}

export interface DeleteResult {
  statuses: CompileStatus[]
}

/** 分发开关打不开的原因（F-303 AC1） */
export type DistributeBlockReason =
  "unverified" | "failed" | "password-only" | "cli-not-ready"

export type IpcErrorId =
  | "not-found"
  /** 别名在全部服务器中唯一，不区分大小写（F-101 AC1） */
  | "alias-taken"
  /** 与该环境 ssh config 中已有的 Host 重名（F-107 AC3） */
  | "alias-conflict"
  | "cannot-distribute"
  /** 「改用密钥登录」需要凭据库里已有密码 */
  | "password-missing"
  /** 没有填新密码，而连接目标（地址、端口、用户、认证方式）和已保存的记录不同：已保存的密码不会发往新目标（P4a） */
  | "password-target-changed"
  /** 「改用密钥登录」时连接失败，认证方式没有切换（F-108 AC2） */
  | "connection-failed"
  /** settings.json 不是合法 JSON，没有修改（8.5） */
  | "settings-invalid"
  | "interop-disabled"
  | "target-exists"
  /** 复制到 WSL 的源文件不存在 */
  | "source-missing"
  /** 编译受阻期间不能用旧产物创建或修复副本 */
  | "compile-blocked"
  | "cli-account-unavailable"
  | "cli-scope-permission"
  | "cli-scope-failed"
  | "cli-command-unsupported"
  | "terminal-command-invalid"
  /** 并入的笔记仍然命中密钥（F-308 AC2） */
  | "note-has-secret"
  | "reset-incomplete"
  | "internal"

/** IPC 失败时 invoke 抛出的对象。文案由 copy.ts 按 id 映射 */
export interface IpcError {
  id: IpcErrorId
  params?: Record<string, string | number>
}
