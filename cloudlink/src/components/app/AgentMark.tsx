// Agent 标识（2026-11-01 用户选定，参考 CC Switch）：资源回路行上的 Agent 按钮用品牌 Logo，点亮时用品牌色。
// DESIGN.md 的例外：品牌 Logo 和 agent-* 颜色只在这里使用；Logo 取自 @lobehub/icons-static-svg（MIT），不自绘
import claudeSvg from "@lobehub/icons-static-svg/icons/claude.svg?raw"
import openaiSvg from "@lobehub/icons-static-svg/icons/openai.svg?raw"

import type { AgentId } from "@/bindings"
import { cn } from "@/lib/utils"

/** 图标文件只有一条 path：取出路径数据，用自己的 svg 渲染（不带 <title>，名称由 Tooltip 和 aria-label 给出） */
function pathOf(svg: string): string {
  const d = /<path[^>]*\sd="([^"]+)"/.exec(svg)?.[1]
  if (!d) throw new Error("AgentMark：图标文件里没有 path")
  return d
}

/** 「通用（Codex 等）」读取 ~/.agents/skills，用 OpenAI 的 Logo（用户选定）；自定义目录没有 Logo，用名称首字 */
const LOGO: Partial<Record<AgentId, string>> = { "claude-code": pathOf(claudeSvg), universal: pathOf(openaiSvg) }

/** 点亮时 Logo 的颜色：Claude 用品牌橙；OpenAI 的 Logo 本身是单色，用墨色，品牌绿只做底色 */
const LIT_GLYPH: Record<AgentId, string> = {
  "claude-code": "text-agent-claude",
  universal: "text-foreground",
  custom: "text-foreground",
}

/** 点亮时按钮的底色和描边（用在 aria-pressed 上，覆盖 Toggle 默认的 bg-muted：选中的卡片本身就是 muted 底） */
export const AGENT_TILE_ON: Record<AgentId, string> = {
  "claude-code": "aria-pressed:border-agent-claude/40 aria-pressed:bg-agent-claude/15 aria-pressed:hover:bg-agent-claude/20",
  universal: "aria-pressed:border-agent-openai/40 aria-pressed:bg-agent-openai/15 aria-pressed:hover:bg-agent-openai/20",
  custom: "aria-pressed:border-foreground/20 aria-pressed:bg-foreground/8 aria-pressed:hover:bg-foreground/12",
}

/** 名称首字：拉丁字母取前两个（Cursor → Cu），其他文字取第一个 */
const initialsOf = (label: string) => {
  const t = label.trim()
  return /^[A-Za-z]/.test(t) ? t.slice(0, 2).replace(/^./, (c) => c.toUpperCase()) : t.slice(0, 1)
}

/** 一个 Agent 的标识：Logo 或名称首字。lit 为 false 时是注记灰 */
export function AgentMark({ agent, label, lit, className }: { agent: AgentId; label: string; lit: boolean; className?: string }) {
  const d = LOGO[agent]
  const color = lit ? LIT_GLYPH[agent] : "text-muted-foreground"
  if (!d) {
    return (
      <span aria-hidden className={cn("flex size-4 shrink-0 items-center justify-center font-mono text-[0.6875rem] leading-none font-semibold", color, className)}>
        {initialsOf(label)}
      </span>
    )
  }
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="currentColor" fillRule="evenodd" className={cn("size-4 shrink-0", color, className)}>
      <path d={d} />
    </svg>
  )
}
