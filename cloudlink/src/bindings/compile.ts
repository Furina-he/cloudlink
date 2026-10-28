// 手写契约（PRD 5.4、7.8）
import type { Mode } from "./mount"

export type LintId =
  | "name-format"
  | "reserved-name"
  | "description-empty"
  | "description-too-long"
  | "secret-detected"
  | "export-disabled-field"
  | "missing-reference"
  | "body-too-long"
  | "description-missing-alias"
  | "prod-standard-no-guardrails"
  | "probe-stale"
  | "suspected-injection"

export type LintLevel = "error" | "warning" | "info"

export interface LintItem {
  id: LintId
  level: LintLevel
  params?: Record<string, string | number>
  file?: string
  line?: number
}

export interface CompileBudget {
  resident: number
  triggered: number
  onDemand: number
  descriptionChars: number
  bodyLines: number
  bodyLineLimit: number
}

export interface CompilePreview {
  slug: string
  mode: Mode
  /** SKILL.md 排在第一个 */
  files: { path: string; content: string; tokens: number }[]
  budget: CompileBudget
  lint: LintItem[]
  /** 有 error 级 Lint 时为 true，此时不会发布 */
  blocked: boolean
}

export interface SkillVariantStatus {
  mode: Mode
  lint: LintItem[]
  /** 常驻层 Token 估算 */
  residentTokens: number
  blocked: boolean
  compiledAt: string | null
  /** 发布路径，例如 ~/.cloudlink/compiled/read-only/vps-hk-edge */
  path: string
}

/** 每个资产对应一个单资产 Skill（F-201）。只列出已编译的变体 */
export interface SkillStatus {
  id: string
  slug: string
  assetId: string
  variants: SkillVariantStatus[]
}
