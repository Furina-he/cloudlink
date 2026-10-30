// Agent 目录表（PRD 4.5）与可见性规则（F-306）
import type { AgentId, Convention } from "@/bindings"

export interface AgentInfo {
  id: AgentId
  /** 读取的项目约定目录；custom 由用户指定，这里为 null */
  convention: Convention | null
  /** 全局目录，相对 home */
  globalDir: string | null
}

export const AGENTS: Record<AgentId, AgentInfo> = {
  "claude-code": { id: "claude-code", convention: "claude", globalDir: ".claude/skills" },
  universal: { id: "universal", convention: "agents", globalDir: ".agents/skills" },
  cursor: { id: "cursor", convention: "agents", globalDir: ".cursor/skills" },
  "gemini-cli": { id: "gemini-cli", convention: "agents", globalDir: ".gemini/skills" },
  copilot: { id: "copilot", convention: "agents", globalDir: ".copilot/skills" },
  opencode: { id: "opencode", convention: "agents", globalDir: ".config/opencode/skills" },
  custom: { id: "custom", convention: null, globalDir: null },
}

export const CONVENTION_DIRS: Record<Convention, string> = {
  claude: ".claude/skills",
  agents: ".agents/skills",
}

/** 这个 Agent 会读取哪个项目约定目录 */
export function conventionOf(agent: AgentId): Convention | null {
  return AGENTS[agent].convention
}

/** 约定目录没有对应的检测到的 Agent 时，用来查看它的代表 Agent */
const REPRESENTATIVE: Record<Convention, AgentId> = { claude: "claude-code", agents: "universal" }

/**
 * 「以此视角查看」可选的 Agent（F-306，2026-10-29 用户确认）。
 * - 全局目标：就是它自己的 Agent
 * - 项目目标：同一运行环境里检测到的 Agent（有全局目标的）中，读取项目已启用约定目录的那些；
 *   某个已启用的约定目录没有对应 Agent 时，补上代表 Agent，保证每个约定目录都能查看
 */
export function lensAgentsFor(
  target: { kind: "agent-global" | "project"; envId: string; agent?: AgentId; conventions?: Convention[] },
  targets: { kind: "agent-global" | "project"; envId: string; agent?: AgentId }[]
): AgentId[] {
  if (target.kind === "agent-global") return target.agent ? [target.agent] : []
  const enabled = target.conventions ?? []
  const found = new Set<AgentId>()
  for (const t of targets) {
    if (t.kind !== "agent-global" || t.envId !== target.envId || !t.agent) continue
    const c = conventionOf(t.agent)
    if (c && enabled.includes(c)) found.add(t.agent)
  }
  for (const c of enabled) {
    if (![...found].some((a) => conventionOf(a) === c)) found.add(REPRESENTATIVE[c])
  }
  const order = Object.keys(AGENTS) as AgentId[]
  return [...found].sort((a, b) => order.indexOf(a) - order.indexOf(b))
}
