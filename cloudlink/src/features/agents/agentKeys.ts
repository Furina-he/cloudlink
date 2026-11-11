// 资源行上可点选的 Agent，和每一份总 Skill（运行环境 × Agent）。都由已启用的目标推出来（2026-11-01 用户确认）
import { useMemo } from "react"

import type { AgentBrand, AgentId, EnvId, Environment, Target } from "@/bindings"
import { copy } from "@/lib/copy"
import { sortEnvs } from "@/features/servers/serverForm"
import { selectSettingsKnown, useSettingsStore } from "@/stores/settings"
import { compileKey } from "@/stores/skills"
import { selectAvailableEnvs, selectTargetsKnown, useTargetStore } from "@/stores/targets"

/** 内置目标在前（Claude Code、通用目录、Trae、Kiro、Continue），自定义目录在后 */
export const AGENT_ORDER: Record<AgentId, number> = { "claude-code": 0, universal: 1, trae: 2, "trae-cn": 3, kiro: 4, continue: 5, custom: 6 }

export interface AgentOption {
  key: string
  agent: AgentId
  /** 完整名称，例如「Codex」 */
  label: string
  /** 资源行按钮上的短名称，例如「通用」 */
  short: string
  /** 把它当作主要目录的、检测到的 Agent（通用目录下的 Codex、Cursor 等），各运行环境合并 */
  readers: AgentBrand[]
}

/** 一份总 Skill：某个运行环境里某个 Agent 的那一份 */
export interface CompileTarget {
  key: string
  envId: EnvId
  agentKey: string
  /** 「Claude Code（Windows）」 */
  label: string
  /** 「Claude Code」，不带运行环境 */
  short: string
}

const shortOf = (t: Pick<Target, "agent" | "label">) => (t.agent === "custom" ? t.label : copy.agentShort[t.agent])
const labelOf = (t: Pick<Target, "agent" | "label">) => (t.agent === "custom" ? t.label : copy.agent[t.agent])

const byAgent = (a: Target, b: Target) => AGENT_ORDER[a.agent] - AGENT_ORDER[b.agent] || a.label.localeCompare(b.label)

/** 按键去重，保留第一个 */
function firstBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    const k = key(item)
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

/** 某个运行环境里把这个目标当作主要目录的 Agent（Claude Code 目标只有它自己，不列） */
export function readersOf(environments: Environment[], envId: EnvId, agent: AgentId): AgentBrand[] {
  if (agent === "claude-code" || agent === "custom") return []
  return (environments.find((e) => e.id === envId)?.agents ?? []).filter((a) => a.reads[0] === agent).map((a) => a.brand)
}

/** 至少有一个已启用目标的 Agent，每个一项；同一个 Agent 在 Windows 和 WSL 的目录共用一项 */
export function selectAgents(targets: Target[], envIds: EnvId[], environments: Environment[] = []): AgentOption[] {
  const enabled = targets.filter((t) => t.enabled && envIds.includes(t.envId)).sort(byAgent)
  return firstBy(enabled, (t) => t.agentKey).map((t) => ({
    key: t.agentKey,
    agent: t.agent,
    label: labelOf(t),
    short: shortOf(t),
    readers: [...new Set(envIds.flatMap((envId) => readersOf(environments, envId, t.agent)))],
  }))
}

/** 每一份总 Skill：已启用目标里不同的「运行环境 × Agent」，按运行环境、Agent 排序 */
export function selectCompileTargets(targets: Target[], envIds: EnvId[]): CompileTarget[] {
  const order = sortEnvs(envIds)
  const enabled = targets
    .filter((t) => t.enabled && envIds.includes(t.envId))
    .sort((a, b) => order.indexOf(a.envId) - order.indexOf(b.envId) || byAgent(a, b))
  return firstBy(enabled, compileKey).map((t) => ({ key: compileKey(t), envId: t.envId, agentKey: t.agentKey, label: copy.agentInEnv(shortOf(t), copy.env.long(t.envId)), short: shortOf(t) }))
}

/** 目标已经不在列表里时（例如刚移除），从 AgentKey 推出名称 */
export function compileLabel(list: CompileTarget[], s: { envId: EnvId; agentKey: string }): string {
  const found = list.find((t) => t.key === compileKey(s))
  if (found) return found.label
  return copy.agentInEnv(compileShort(list, s), copy.env.long(s.envId))
}

/** 同上，只要 Agent 名称，不带运行环境 */
export function compileShort(list: CompileTarget[], s: { envId: EnvId; agentKey: string }): string {
  const found = list.find((t) => t.key === compileKey(s))
  if (found) return found.short
  return s.agentKey.startsWith("custom:") ? s.agentKey.slice("custom:".length) : (copy.agentShort[s.agentKey as Exclude<AgentId, "custom">] ?? s.agentKey)
}

/** 可用运行环境里的 Agent 和每一份总 Skill；目标、运行环境变化时才重新计算 */
export function useAgentOptions() {
  const targets = useTargetStore((s) => s.targets)
  const environments = useTargetStore((s) => s.environments)
  const enabled = useSettingsStore((s) => s.settings?.environments)
  const targetsKnown = useTargetStore(selectTargetsKnown)
  const settingsKnown = useSettingsStore(selectSettingsKnown)
  const known = targetsKnown && settingsKnown
  return useMemo(() => {
    const envIds = selectAvailableEnvs(environments, enabled).map((e) => e.id)
    return { known, agents: selectAgents(targets, envIds, environments), compileTargets: selectCompileTargets(targets, envIds) }
  }, [known, targets, environments, enabled])
}
