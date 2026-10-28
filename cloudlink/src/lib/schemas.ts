// zod 校验（PRD 3.3、5.1、5.4）
import { z } from "zod"

export const SLUG_MAX = 64
export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/
/** synced 是 Claude Code 在 ~/.claude/skills 下的保留目录名 */
export const RESERVED_SLUGS = ["synced"] as const
export const DESCRIPTION_MAX = 1024

/** 消息是 copy.ts 中 validation 的 key，表单层负责映射成中文 */
export const slugSchema = z
  .string()
  .min(1, "slug-required")
  .max(SLUG_MAX, "slug-too-long")
  .regex(SLUG_PATTERN, "slug-format")
  .refine(
    (v) => !(RESERVED_SLUGS as readonly string[]).includes(v),
    "slug-reserved"
  )

/** 唯一性需要全部资产，作为工厂函数提供；编辑时排除自身 id */
export function uniqueSlugSchema(
  taken: { id: string; slug: string }[],
  selfId?: string
) {
  return slugSchema.refine(
    (v) => !taken.some((a) => a.slug === v && a.id !== selfId),
    "slug-taken"
  )
}

export const sshAliasSchema = z
  .string()
  .min(1, "alias-required")
  .regex(/^[^\s*?!]+$/, "alias-format")

export const guardrailRuleSchema = z.object({
  id: z.string(),
  text: z.string().trim().min(1, "rule-empty"),
})

export const assetPathSchema = z.object({
  key: z.string().min(1),
  label: z.string().trim().min(1, "path-label-required"),
  path: z.string().trim().min(1, "path-required"),
  source: z.enum(["manual", "probe"]),
})

export type ValidationKey =
  | "slug-required"
  | "slug-too-long"
  | "slug-format"
  | "slug-reserved"
  | "slug-taken"
  | "alias-required"
  | "alias-format"
  | "rule-empty"
  | "path-label-required"
  | "path-required"
