// 手写契约（PRD 3.4、7.8）
import type { EnvId } from "./env"

export type AgentId =
  | "claude-code"
  | "universal"
  | "cursor"
  | "gemini-cli"
  | "copilot"
  | "opencode"
  | "custom"

/** 项目约定目录：claude = .claude/skills，agents = .agents/skills */
export type Convention = "claude" | "agents"
export type LinkMode = "auto" | "link" | "copy"
export type Mode = "read-only" | "standard"
export type MountStatus =
  | "ok"
  | "pending"
  | "broken"
  | "conflict"
  | "stale-copy"
  | "alias-missing"
export type LinkKind = "symlink" | "junction" | "copy"

export interface Target {
  id: string
  kind: "agent-global" | "project"
  envId: EnvId
  label: string
  /** 仅 agent-global 使用 */
  agent?: AgentId
  /** 全局目标：skills 目录；项目目标：仓库根目录 */
  path: string
  /** 仅 project 使用 */
  conventions?: Convention[]
  /** 仅 project 使用 */
  gitExclude?: boolean
  linkMode: LinkMode
}

export interface MountLink {
  path: string
  kind: LinkKind
}

export interface Mount {
  id: string
  skillId: string
  targetId: string
  mode: Mode
  links: MountLink[]
  status: MountStatus
  statusDetail?: string
  createdAt: string
  checkedAt: string
}

export interface MountRequest {
  skillId: string
  targetId: string
  mode: Mode
  /** 生产资产挂全局（F-303 AC1）、别名不可达（F-307）时，用户已在界面上确认 */
  confirmed?: boolean
}

export interface ProjectInspection {
  path: string
  envId: EnvId
  /** 默认名称，取文件夹名 */
  name: string
  isGitRepo: boolean
  existingConventions: Convention[]
}

export interface AddProjectRequest {
  path: string
  label: string
  conventions: Convention[]
  gitExclude: boolean
}
