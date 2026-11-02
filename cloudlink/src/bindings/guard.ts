// 手写契约（PRD F-306、F-307、8.6）：Claude Code 护栏与操作记录
import type { EnvId } from "./env"

export type GuardState = "active" | "not-installed" | "broken" | "unavailable"

/** broken：条目被删、自检失败、设置了 disableAllHooks、settings.json 不是合法 JSON；unavailable：WSL 互操作已关闭 */
export type GuardDetailId =
  | "entry-missing"
  | "self-test-failed"
  | "hooks-disabled"
  | "settings-invalid"
  | "interop-disabled"

export interface GuardStatus {
  envId: EnvId
  state: GuardState
  detail?: { id: GuardDetailId; params?: Record<string, string | number> }
  settingsPath: string
  /** 安装时将加入 settings.json 的 JSON 原文和备份位置（F-306 AC1，2026-10-31 补充） */
  planned: { entry: string; backupPath: string }
  /** 今天在这个运行环境里拦下的命令数（2026-10-31 补充） */
  deniedToday: number
  checkedAt: string
}

export type OperationDecision = "allowed" | "denied"

/** 拦下或标注的原因（8.6 判定流程） */
export type GuardReasonId =
  | "read-only"
  | "credential-read"
  | "volume-delete"
  | "data-delete"
  | "host-reboot"
  | "firewall"
  | "ssh-config"
  | "critical-service"
  | "file-transfer"
  | "interactive"
  /** 云平台 CLI 的凭据导出，例如 vercel env pull（任何档位都拦下） */
  | "cli-env-export"
  /** 云平台 CLI 的写操作（只读巡检档拦下） */
  | "cli-write"
  /** 云平台 CLI 的删库、删站、销毁实例（标准运维档也拦下） */
  | "cli-destroy"
  | "unparsed"

/** 护栏判定过的一条命令（F-307） */
export interface Operation {
  id: string
  assetId: string
  envId: EnvId
  at: string
  sessionId: string
  cwd: string
  /** 已脱敏 */
  command: string
  decision: OperationDecision
  reasonId?: GuardReasonId
}

export interface OperationQuery {
  assetId?: string
  /** 返回 at 早于它的记录，分页用 */
  before?: string
  limit: number
}

/** 「查看规则」Sheet（6.6）。命令是英文原文，类别的说明由 copy.ts 按 id 映射 */
export interface GuardRules {
  /** 只读白名单（8.6），每项是一条命令或命令前缀 */
  readOnlyAllow: string[]
  /** 标准运维下拦下的危险类别 */
  standardDeny: { id: GuardReasonId; examples: string[] }[]
  /** 任何档位都拦下 */
  alwaysDeny: { id: GuardReasonId; examples: string[] }[]
}
