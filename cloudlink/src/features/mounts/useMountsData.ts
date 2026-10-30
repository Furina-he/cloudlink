import { useMemo } from "react"

import type { Asset, Mount, SkillStatus, Target } from "@/bindings"
import { ENV_ORDER, useAssetStore } from "@/stores/assets"
import { selectVisibleSkills, useMountStore, type VisibleSkills } from "@/stores/mounts"
import { useSkillStore } from "@/stores/skills"
import { useTargetStore } from "@/stores/targets"
import { useUIStore, type Lens } from "@/stores/ui"

export interface SkillEntry {
  skill: SkillStatus
  asset: Asset
}

/** 挂载视图用到的 Skill（带资产，按生产、预发、开发排序）、目标（按环境筛选）和挂载 */
export function useMountsData() {
  const statusById = useSkillStore((s) => s.statusById)
  const assetsById = useAssetStore((s) => s.byId)
  const allTargets = useTargetStore((s) => s.targets)
  const env = useUIStore((s) => s.mountsEnv)
  const byId = useMountStore((s) => s.byId)

  return useMemo(() => {
    const skills: SkillEntry[] = Object.values(statusById)
      .map((skill) => ({ skill, asset: assetsById[skill.assetId] }))
      .filter((e): e is SkillEntry => !!e.asset)
      .sort(
        (a, b) =>
          ENV_ORDER.indexOf(a.asset.envTag) - ENV_ORDER.indexOf(b.asset.envTag) ||
          a.skill.slug.localeCompare(b.skill.slug)
      )
    const targets = allTargets.filter((t) => env === "all" || t.envId === env)
    const mounts = Object.values(byId)
    const byTarget = new Map<string, Mount[]>()
    for (const m of mounts) byTarget.set(m.targetId, [...(byTarget.get(m.targetId) ?? []), m])
    const skillById = new Map(skills.map((e) => [e.skill.id, e]))
    return { skills, skillById, targets, allTargets, mounts, byTarget }
  }, [statusById, assetsById, allTargets, env, byId])
}

export interface LensView {
  lens: Lens
  target: Target
  result: VisibleSkills
  /** 此视角能看见并且能用的 Skill */
  visible: Set<string>
}

/** 当前 Agent 视角（F-306）；目标被移除后视为没有视角 */
export function useLens(): LensView | null {
  const lens = useUIStore((s) => s.lens)
  const targets = useTargetStore((s) => s.targets)
  const byId = useMountStore((s) => s.byId)
  return useMemo(() => {
    const target = lens && targets.find((t) => t.id === lens.targetId)
    if (!lens || !target) return null
    const result = selectVisibleSkills(lens, targets, Object.values(byId))
    const visible = new Set([...result.project, ...result.global].map((m) => m.skillId))
    return { lens, target, result, visible }
  }, [lens, targets, byId])
}
