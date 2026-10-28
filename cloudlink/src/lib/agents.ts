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
