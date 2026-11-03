// Agent 标识（2026-11-01 用户选定，2026-11-03 扩展全套主流 Agent 官方 Logo）：
// 资源回路行与 Agent 目标卡片上的 Agent 按钮一律使用官方品牌 SVG Logo（取自 @lobehub/icons-static-svg，MIT，不自绘）；
// 用户自定义的未知 Agent 名称兜底使用通用 BotIcon，不再使用双字母文字缩写。
import ampSvg from "@lobehub/icons-static-svg/icons/amp.svg?raw"
import claudeSvg from "@lobehub/icons-static-svg/icons/claude.svg?raw"
import clineSvg from "@lobehub/icons-static-svg/icons/cline.svg?raw"
import cursorSvg from "@lobehub/icons-static-svg/icons/cursor.svg?raw"
import devinSvg from "@lobehub/icons-static-svg/icons/devin.svg?raw"
import geminiCliSvg from "@lobehub/icons-static-svg/icons/geminicli.svg?raw"
import githubCopilotSvg from "@lobehub/icons-static-svg/icons/githubcopilot.svg?raw"
import gooseSvg from "@lobehub/icons-static-svg/icons/goose.svg?raw"
import openaiSvg from "@lobehub/icons-static-svg/icons/openai.svg?raw"
import opencodeSvg from "@lobehub/icons-static-svg/icons/opencode.svg?raw"
import roocodeSvg from "@lobehub/icons-static-svg/icons/roocode.svg?raw"
import traeSvg from "@lobehub/icons-static-svg/icons/trae.svg?raw"
import windsurfSvg from "@lobehub/icons-static-svg/icons/windsurf.svg?raw"
import { BotIcon } from "lucide-react"

import type { AgentId } from "@/bindings"
import { cn } from "@/lib/utils"

/** 取出 SVG 中的全部 path d 属性，用统一的 <svg> 渲染（不带 <title>，名称由 Tooltip 和 aria-label 给出） */
function pathsOf(svg: string): string[] {
  const list = Array.from(svg.matchAll(/<path[^>]*\sd="([^"]+)"/g), (m) => m[1])
  if (list.length === 0) throw new Error("AgentMark：图标文件里没有 path")
  return list
}

const CLAUDE_PATHS = pathsOf(claudeSvg)
const OPENAI_PATHS = pathsOf(openaiSvg)
const CURSOR_PATHS = pathsOf(cursorSvg)
const WINDSURF_PATHS = pathsOf(windsurfSvg)
const GEMINI_PATHS = pathsOf(geminiCliSvg)
const COPILOT_PATHS = pathsOf(githubCopilotSvg)
const OPENCODE_PATHS = pathsOf(opencodeSvg)
const CLINE_PATHS = pathsOf(clineSvg)
const ROOCODE_PATHS = pathsOf(roocodeSvg)
const TRAE_PATHS = pathsOf(traeSvg)
const GOOSE_PATHS = pathsOf(gooseSvg)
const AMP_PATHS = pathsOf(ampSvg)
const DEVIN_PATHS = pathsOf(devinSvg)

/** 按内置 AgentId 匹配官方 Logo */
const LOGO_BY_AGENT: Partial<Record<AgentId, string[]>> = {
  "claude-code": CLAUDE_PATHS,
  universal: OPENAI_PATHS,
}

/** 按规范化后的名称匹配主流 Agent 官方 Logo（覆盖自定义目录中添加的 Cursor、Windsurf、Gemini CLI 等） */
const LOGO_BY_NAME: Record<string, string[]> = {
  claude: CLAUDE_PATHS,
  claudecode: CLAUDE_PATHS,
  codex: OPENAI_PATHS,
  codexcli: OPENAI_PATHS,
  openai: OPENAI_PATHS,
  cursor: CURSOR_PATHS,
  windsurf: WINDSURF_PATHS,
  gemini: GEMINI_PATHS,
  geminicli: GEMINI_PATHS,
  copilot: COPILOT_PATHS,
  githubcopilot: COPILOT_PATHS,
  opencode: OPENCODE_PATHS,
  cline: CLINE_PATHS,
  roo: ROOCODE_PATHS,
  roocode: ROOCODE_PATHS,
  trae: TRAE_PATHS,
  goose: GOOSE_PATHS,
  amp: AMP_PATHS,
  devin: DEVIN_PATHS,
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "")

function resolvePaths(agent: AgentId, label: string): string[] | undefined {
  return LOGO_BY_AGENT[agent] ?? LOGO_BY_NAME[norm(label)]
}

/** 点亮时 Logo 的颜色：Claude 用品牌橙；其余单色官方 Logo 用墨色，靠底色和描边区分点亮态 */
const LIT_GLYPH: Record<AgentId, string> = {
  "claude-code": "text-agent-claude",
  universal: "text-foreground",
  custom: "text-foreground",
}

/** 点亮时按钮的底色和描边（用在 aria-pressed 上，覆盖 Toggle 默认的 bg-muted） */
export const AGENT_TILE_ON: Record<AgentId, string> = {
  "claude-code": "aria-pressed:border-agent-claude/40 aria-pressed:bg-agent-claude/15 aria-pressed:hover:bg-agent-claude/20",
  universal: "aria-pressed:border-agent-openai/40 aria-pressed:bg-agent-openai/15 aria-pressed:hover:bg-agent-openai/20",
  custom: "aria-pressed:border-foreground/25 aria-pressed:bg-foreground/10 aria-pressed:hover:bg-foreground/15",
}

/** 一个 Agent 的标识：优先渲染官方品牌 SVG Logo；未知自定义名称兜底使用 BotIcon */
export function AgentMark({ agent, label, lit, className }: { agent: AgentId; label: string; lit: boolean; className?: string }) {
  const paths = resolvePaths(agent, label)
  const color = lit ? LIT_GLYPH[agent] : "text-muted-foreground"
  if (!paths) {
    return <BotIcon aria-hidden className={cn("size-4 shrink-0", color, className)} />
  }
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="currentColor" fillRule="evenodd" className={cn("size-4 shrink-0", color, className)}>
      {paths.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  )
}
