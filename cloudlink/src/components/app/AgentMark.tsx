// Agent 标识（2026-11-01 用户选定，2026-11-03 扩展全套主流 Agent 官方 Logo，2026-11-07 加入检测到的 Agent 品牌）：
// Agent 一律使用官方品牌 SVG Logo（取自 @lobehub/icons-static-svg，MIT，不自绘）；
// 通用目录（~/.agents/skills，很多 Agent 共用）用 BlocksIcon；没有官方 Logo 的品牌和未知的自定义名称用 BotIcon，不用文字缩写。
import ampSvg from "@lobehub/icons-static-svg/icons/amp.svg?raw"
import claudeSvg from "@lobehub/icons-static-svg/icons/claude.svg?raw"
import clineSvg from "@lobehub/icons-static-svg/icons/cline.svg?raw"
import codexSvg from "@lobehub/icons-static-svg/icons/codex.svg?raw"
import cursorSvg from "@lobehub/icons-static-svg/icons/cursor.svg?raw"
import devinSvg from "@lobehub/icons-static-svg/icons/devin.svg?raw"
import geminiCliSvg from "@lobehub/icons-static-svg/icons/geminicli.svg?raw"
import githubCopilotSvg from "@lobehub/icons-static-svg/icons/githubcopilot.svg?raw"
import gooseSvg from "@lobehub/icons-static-svg/icons/goose.svg?raw"
import junieSvg from "@lobehub/icons-static-svg/icons/junie.svg?raw"
import kilocodeSvg from "@lobehub/icons-static-svg/icons/kilocode.svg?raw"
import kiroSvg from "@lobehub/icons-static-svg/icons/kiro.svg?raw"
import openaiSvg from "@lobehub/icons-static-svg/icons/openai.svg?raw"
import opencodeSvg from "@lobehub/icons-static-svg/icons/opencode.svg?raw"
import qwenSvg from "@lobehub/icons-static-svg/icons/qwen.svg?raw"
import roocodeSvg from "@lobehub/icons-static-svg/icons/roocode.svg?raw"
import traeSvg from "@lobehub/icons-static-svg/icons/trae.svg?raw"
import windsurfSvg from "@lobehub/icons-static-svg/icons/windsurf.svg?raw"
import { BlocksIcon, BotIcon } from "lucide-react"

import type { AgentBrand, AgentId } from "@/bindings"
import { cn } from "@/lib/utils"

/** 取出 SVG 中的全部 path d 属性，用统一的 <svg> 渲染（不带 <title>，名称由 Tooltip 和 aria-label 给出） */
function pathsOf(svg: string): string[] {
  const list = Array.from(svg.matchAll(/<path[^>]*\sd="([^"]+)"/g), (m) => m[1])
  if (list.length === 0) throw new Error("AgentMark：图标文件里没有 path")
  return list
}

const CLAUDE_PATHS = pathsOf(claudeSvg)
const CODEX_PATHS = pathsOf(codexSvg)
const OPENAI_PATHS = pathsOf(openaiSvg)
const CURSOR_PATHS = pathsOf(cursorSvg)
const WINDSURF_PATHS = pathsOf(windsurfSvg)
const GEMINI_PATHS = pathsOf(geminiCliSvg)
const COPILOT_PATHS = pathsOf(githubCopilotSvg)
const OPENCODE_PATHS = pathsOf(opencodeSvg)
const CLINE_PATHS = pathsOf(clineSvg)
const ROOCODE_PATHS = pathsOf(roocodeSvg)
const KILOCODE_PATHS = pathsOf(kilocodeSvg)
const TRAE_PATHS = pathsOf(traeSvg)
const KIRO_PATHS = pathsOf(kiroSvg)
const GOOSE_PATHS = pathsOf(gooseSvg)
const AMP_PATHS = pathsOf(ampSvg)
const QWEN_PATHS = pathsOf(qwenSvg)
const JUNIE_PATHS = pathsOf(junieSvg)
const DEVIN_PATHS = pathsOf(devinSvg)

/** 检测到的 Agent 品牌的官方 Logo；Factory Droid、Augment、Crush、Warp、Continue 没有收录，用 BotIcon */
const LOGO_BY_BRAND: Partial<Record<AgentBrand, string[]>> = {
  "claude-code": CLAUDE_PATHS,
  codex: CODEX_PATHS,
  cursor: CURSOR_PATHS,
  windsurf: WINDSURF_PATHS,
  "gemini-cli": GEMINI_PATHS,
  copilot: COPILOT_PATHS,
  opencode: OPENCODE_PATHS,
  cline: CLINE_PATHS,
  "roo-code": ROOCODE_PATHS,
  "kilo-code": KILOCODE_PATHS,
  goose: GOOSE_PATHS,
  amp: AMP_PATHS,
  "qwen-code": QWEN_PATHS,
  junie: JUNIE_PATHS,
  trae: TRAE_PATHS,
  "trae-cn": TRAE_PATHS,
  kiro: KIRO_PATHS,
}

/** 按内置目标匹配官方 Logo（通用目录单独处理） */
const LOGO_BY_AGENT: Partial<Record<AgentId, string[]>> = {
  "claude-code": CLAUDE_PATHS,
  trae: TRAE_PATHS,
  "trae-cn": TRAE_PATHS,
  kiro: KIRO_PATHS,
}

/** 按规范化后的名称匹配主流 Agent 官方 Logo（自定义目录里填的名称） */
const LOGO_BY_NAME: Record<string, string[]> = {
  claude: CLAUDE_PATHS,
  claudecode: CLAUDE_PATHS,
  codex: CODEX_PATHS,
  codexcli: CODEX_PATHS,
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
  kilo: KILOCODE_PATHS,
  kilocode: KILOCODE_PATHS,
  trae: TRAE_PATHS,
  traecn: TRAE_PATHS,
  kiro: KIRO_PATHS,
  goose: GOOSE_PATHS,
  amp: AMP_PATHS,
  qwen: QWEN_PATHS,
  qwencode: QWEN_PATHS,
  junie: JUNIE_PATHS,
  devin: DEVIN_PATHS,
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "")

/** 点亮时 Logo 的颜色：Claude 用品牌橙；其余单色官方 Logo 用墨色，靠底色和描边区分点亮态 */
const LIT_GLYPH: Record<AgentId, string> = {
  "claude-code": "text-agent-claude",
  universal: "text-foreground",
  trae: "text-foreground",
  "trae-cn": "text-foreground",
  kiro: "text-foreground",
  continue: "text-foreground",
  custom: "text-foreground",
}

/** 点亮态（DESIGN.md target-toggle-on，Signal Four Rule）：signal-soft 底 + 35% signal 内描边，所有目标一致 */
const SIGNAL_TILE = "aria-pressed:border-transparent aria-pressed:bg-signal-soft aria-pressed:shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--signal)_35%,transparent)] aria-pressed:hover:bg-signal-soft"

/** 点亮时按钮的底色和描边（用在 aria-pressed 上，覆盖 Toggle 默认的 bg-muted） */
export const AGENT_TILE_ON: Record<AgentId, string> = {
  "claude-code": SIGNAL_TILE,
  universal: SIGNAL_TILE,
  trae: SIGNAL_TILE,
  "trae-cn": SIGNAL_TILE,
  kiro: SIGNAL_TILE,
  continue: SIGNAL_TILE,
  custom: SIGNAL_TILE,
}

function Logo({ paths, className }: { paths: string[]; className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="currentColor" fillRule="evenodd" className={cn("size-4 shrink-0", className)}>
      {paths.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  )
}

/** 一个分发目标的标识：官方品牌 Logo；通用目录用 BlocksIcon；未知自定义名称用 BotIcon */
export function AgentMark({ agent, label, lit, className }: { agent: AgentId; label: string; lit: boolean; className?: string }) {
  const color = lit ? LIT_GLYPH[agent] : "text-muted-foreground"
  if (agent === "universal") return <BlocksIcon aria-hidden className={cn("size-4 shrink-0", color, className)} />
  const paths = LOGO_BY_AGENT[agent] ?? (agent === "custom" ? LOGO_BY_NAME[norm(label)] : undefined)
  if (!paths) return <BotIcon aria-hidden className={cn("size-4 shrink-0", color, className)} />
  return <Logo paths={paths} className={cn(color, className)} />
}

/** 检测到的一个 Agent 品牌的标识（单色，颜色跟随文字） */
export function BrandMark({ brand, className }: { brand: AgentBrand; className?: string }) {
  const paths = LOGO_BY_BRAND[brand]
  if (!paths) return <BotIcon aria-hidden className={cn("size-4 shrink-0", className)} />
  return <Logo paths={paths} className={className} />
}
