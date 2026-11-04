// 手写契约（PRD 5.4、7.8）。v3：列入的服务器编译成一个总 Skill，每个「Agent × 运行环境」一份，只含分发给这个 Agent 的服务器
import type { AssetInput } from "./asset"
import type { AgentKey } from "./delivery"
import type { EnvId } from "./env"

export type LintId =
  | "description-too-long"
  | "secret-detected"
  | "export-disabled-field"
  | "missing-reference"
  | "body-too-long"
  | "prod-standard-no-guardrails"
  | "probe-stale"
  | "suspected-injection"
  | "publish-failed"

export type LintLevel = "error" | "warning" | "info"

export interface LintItem {
  id: LintId
  level: LintLevel
  /** 出问题的服务器；全局内容（关系、约定）的问题没有 */
  assetId?: string
  params?: Record<string, string | number>
  file?: string
  line?: number
}

export interface CompileBudget {
  descriptionChars: number
  descriptionLimit: number
  bodyLines: number
  bodyLineLimit: number
}

export interface CompilePreview {
  envId: EnvId
  agentKey: AgentKey
  /** SKILL.md 排在第一个 */
  files: { path: string; content: string }[]
  budget: CompileBudget
  lint: LintItem[]
  /** 有 error 级 Lint 时为 true，此时不会发布 */
  blocked: boolean
}

export interface CompileStatus {
  envId: EnvId
  agentKey: AgentKey
  blocked: boolean
  errors: number
  warnings: number
  compiledAt: string | null
  /** 这一份最近一次编译的 Lint，每条带服务器 id（2026-10-31 补充） */
  lint: LintItem[]
}

/** 运维约定的一条，原文逐字渲染 */
export interface Convention {
  id: string
  text: string
}

/** 总 Skill 的全局内容（F-201 AC1），不属于任何一台服务器 */
export interface SkillConfig {
  relationships: string
  conventions: Convention[]
}

/** preview_skill 的请求：带草稿时预览草稿。带 asset 时，这台服务器按「已列入」计算（2026-10-31 用户确认） */
export interface PreviewRequest {
  envId: EnvId
  agentKey: AgentKey
  asset?: AssetInput
  config?: SkillConfig
}
