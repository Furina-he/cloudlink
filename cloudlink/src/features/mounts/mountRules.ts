// 挂载前后的规则（纯函数，便于单元测试）
import type { Asset, Mount, Target } from "@/bindings"
import { copy } from "@/lib/copy"

/** 挂载前要用户确认的两种情况（F-303 AC1、F-307） */
export function mountChecks(asset: Asset, target: Target) {
  return {
    prodGlobal: asset.envTag === "prod" && target.kind === "agent-global",
    aliasMissing: !asset.connection.definedIn.includes(target.envId),
  }
}

/** 挂载成功后按 Agent 给出生效提示（F-303 AC4） */
export function effectHints(target: Target): string[] {
  if (target.kind === "agent-global") {
    if (target.agent === "claude-code") return [copy.mountFlow.hintClaude]
    if (target.agent === "universal") return [copy.mountFlow.hintCodex]
    return [copy.mountFlow.hintOther]
  }
  const hints: string[] = []
  if (target.conventions?.includes("claude")) hints.push(copy.mountFlow.hintClaude)
  if (target.conventions?.includes("agents")) hints.push(copy.mountFlow.hintCodex)
  return hints
}

/** 生产资产挂在全局目标上的挂载（F-303 AC1 的常驻提示，PRD 6.6） */
export function prodGlobalMounts(
  mounts: Mount[],
  targets: Target[],
  assetOfSkill: (skillId: string) => Asset | undefined
): Mount[] {
  const globals = new Set(targets.filter((t) => t.kind === "agent-global").map((t) => t.id))
  return mounts.filter(
    (m) => m.status !== "pending" && globals.has(m.targetId) && assetOfSkill(m.skillId)?.envTag === "prod"
  )
}
