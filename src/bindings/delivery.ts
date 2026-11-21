// 手写契约（PRD 3.4、4.5、7.8）。v3 只有 Agent 全局目录这一种目标，分发一律受管复制
import type { EnvId } from "./env"

/**
 * CloudLink 维护的目标（4.5，2026-11-07）：Claude Code、通用目录 `~/.agents/skills`（Codex、Cursor 等大多数 Agent 读这里），
 * 只认自己目录的 Antigravity（`~/.gemini/config/skills`）、Trae、Trae CN、Kiro、Continue（检测到才有），以及自定义目录
 */
export type AgentId = "claude-code" | "universal" | "antigravity" | "trae" | "trae-cn" | "kiro" | "continue" | "custom"

/** CloudLink 认得的 Agent 品牌（2026-11-07），只用来显示谁会读到哪份 Skill */
export type AgentBrand =
  | "claude-code"
  | "codex"
  | "cursor"
  | "windsurf"
  | "gemini-cli"
  | "antigravity"
  | "copilot"
  | "opencode"
  | "cline"
  | "roo-code"
  | "kilo-code"
  | "goose"
  | "amp"
  | "qwen-code"
  | "droid"
  | "augment"
  | "crush"
  | "junie"
  | "warp"
  | "trae"
  | "trae-cn"
  | "kiro"
  | "continue"

/** 某个运行环境里检测到的一个 Agent，和它读取的目标（第一个是它主要使用的那个） */
export interface DetectedAgent {
  brand: AgentBrand
  reads: AgentId[]
}

/**
 * 资源行上点选的 Agent（2026-11-01 用户确认）：内置 Agent 取 AgentId，自定义目录取 `custom:<名称>`。
 * 由后端给出，同一个 Agent 在 Windows 和 WSL 的目录共用一个
 */
export type AgentKey = string

export interface Target {
  id: string
  envId: EnvId
  agent: AgentId
  agentKey: AgentKey
  /** 例如 "Claude Code"；自定义目录取用户填的名称 */
  label: string
  /** 全局 skills 目录 */
  path: string
  /** 关闭后，CloudLink 从这个目录移除自己分发的总 Skill */
  enabled: boolean
  /** 是否检测到这个 Agent（未检测到也可以手动启用） */
  detected: boolean
}

/** 未列入的原因（F-303 AC2）。界面文案由 copy.ts 按 id 映射 */
import type { InclusionReasonId } from "./generated/delivery"
export type { InclusionReasonId } from "./generated/delivery"

/** 一台服务器是否列入某个运行环境里某个 Agent 的总 Skill；每个已启用的「Agent × 运行环境」一行 */
export interface Inclusion {
  assetId: string
  envId: EnvId
  agentKey: AgentKey
  included: boolean
  reason?: { id: InclusionReasonId; params?: Record<string, string | number> }
}

export type DeliveryStatus =
  | "ok"
  | "pending"
  /** 副本被外部程序删除 */
  | "missing"
  /** 副本被改动过（实际内容与所有权标记中的哈希不一致） */
  | "modified"
  /** 副本不是最新的编译结果（上次同步失败） */
  | "outdated"
  /** 目标位置已有同名目录，而且不是 CloudLink 创建的 */
  | "conflict"
  /** 父目录或写入失败，不是外来同名 Skill */
  | "broken"
  /** 跨环境共用，或停用成员仍共享其他目标的副本，未单独写入 */
  | "shared"

/** 总 Skill 在一个目标中的受管副本 */
export type { Delivery } from "./generated/delivery"

/** 添加自定义目录（F-301 AC） */
export interface AddCustomTargetRequest {
  envId: EnvId
  label: string
  path: string
}

/** F-309：为什么备份了一个副本 */
export type BackupReason = "modified" | "takeover"

/** deliveries://backed-up：提示条「已恢复，改动的版本已备份 · 撤销」 */
export interface BackupEvent {
  backupId: string
  targetId: string
  reason: BackupReason
}
