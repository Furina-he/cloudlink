// 手写契约（PRD 3.4、4.5、7.8）。v3 只有 Agent 全局目录这一种目标，分发一律受管复制
import type { EnvId } from "./env"

/** v0.1 只有这三类（4.5） */
export type AgentId = "claude-code" | "universal" | "custom"

/**
 * 回路行上点选的 Agent（2026-11-01 用户确认）：内置 Agent 取 AgentId，自定义目录取 `custom:<名称>`。
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
export type InclusionReasonId =
  /** 这台服务器没有点选这个 Agent */
  | "agent-off"
  /** 尚未通过测试连接或探测 */
  | "unverified"
  /** 运行环境暂时不可用 */
  | "env-unavailable"
  /** 只用密码认证：Agent 在非交互模式下无法输入密码（F-108 AC1） */
  | "password-only"
  /** imported：该环境的 ssh config 里没有这个别名 */
  | "not-defined"
  /** managed：用户没有选择写入这个环境（F-107 AC5） */
  | "not-written"
  /** 该环境的用户 ~/.ssh/config 还没有 Include 托管文件（F-107 AC1 用户拒绝时） */
  | "include-missing"
  /** managed 私钥方式：该环境没有配置私钥 */
  | "no-key-in-env"
  /** 云平台：该环境没有安装 CLI（F-104） */
  | "cli-not-installed"
  /** 云平台：该环境的 CLI 没有登录，或登录已过期 */
  | "cli-not-logged-in"

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

/** 总 Skill 在一个目标中的受管副本 */
export interface Delivery {
  id: string
  targetId: string
  envId: EnvId
  path: string
  status: DeliveryStatus
  /** 只返回 id 和参数 */
  statusDetail?: { id: string; params?: Record<string, string | number> }
  checkedAt: string
}

/** 添加自定义目录（F-301 AC） */
export interface AddCustomTargetRequest {
  envId: EnvId
  label: string
  path: string
}
