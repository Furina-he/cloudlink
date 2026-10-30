import { create } from "zustand"

import type { Asset, IpcError, LintItem, Mode, SkillStatus } from "@/bindings"
import { ipc, toIpcError } from "@/lib/ipc"
import type { LoadStatus } from "./assets"
import type { SkillSort, SkillStateFilter } from "./ui"

export interface CompileFinishedEvent {
  skillId: string
  mode: Mode
  lint: LintItem[]
  tokens: number
}

interface SkillState {
  statusById: Record<string, SkillStatus>
  status: LoadStatus
  error: IpcError | null

  refresh: () => Promise<void>
  _onCompiled: (e: CompileFinishedEvent) => void
}

export const useSkillStore = create<SkillState>()((set) => ({
  statusById: {},
  status: "idle",
  error: null,

  refresh: async () => {
    set((s) => ({ status: s.status === "ready" ? "ready" : "loading", error: null }))
    try {
      const list = await ipc.listSkills()
      set({ statusById: Object.fromEntries(list.map((x) => [x.id, x])), status: "ready" })
    } catch (e) {
      set({ status: "error", error: toIpcError(e) })
    }
  },

  _onCompiled: ({ skillId, mode, lint, tokens }) =>
    set((s) => {
      const skill = s.statusById[skillId]
      if (!skill) return s
      const variant = {
        mode,
        lint,
        residentTokens: tokens,
        blocked: lint.some((l) => l.level === "error"),
        compiledAt: new Date().toISOString(),
        path: skill.variants.find((x) => x.mode === mode)?.path ?? "",
      }
      const variants = skill.variants.some((x) => x.mode === mode)
        ? skill.variants.map((x) => (x.mode === mode ? variant : x))
        : [...skill.variants, variant]
      return { statusById: { ...s.statusById, [skillId]: { ...skill, variants } } }
    }),
}))

/** 任一变体编译受阻即算受阻 */
export const isSkillBlocked = (skill: SkillStatus) => skill.variants.some((v) => v.blocked)

/** 资产对应的单资产 Skill（F-201）；新建尚未保存的资产没有 */
export function selectSkillOfAsset(
  statusById: Record<string, SkillStatus>,
  assetId: string | null
): SkillStatus | undefined {
  if (!assetId) return undefined
  return Object.values(statusById).find((s) => s.assetId === assetId)
}

export type SkillCompileState = "ok" | "warning" | "blocked"

/** 编译状态（PRD 6.13：正常、有警告、编译受阻）：任一变体受阻即受阻，任一变体有警告即有警告 */
export function skillCompileState(skill: SkillStatus): SkillCompileState {
  if (isSkillBlocked(skill)) return "blocked"
  return skill.variants.some((v) => v.lint.some((l) => l.level === "warning")) ? "warning" : "ok"
}

export interface SkillRow {
  skill: SkillStatus
  asset: Asset
  mounts: number
  /** 默认档位变体的常驻 Token；受阻时为 null */
  resident: number | null
}

/** Skills 视图的表格行：按搜索、状态筛选，再按「排序」菜单排序（PRD 6.7） */
export function selectSkillRows(
  rows: SkillRow[],
  query: string,
  state: SkillStateFilter,
  sort: SkillSort
): SkillRow[] {
  const q = query.trim().toLowerCase()
  const hit = (r: SkillRow) =>
    !q || [r.skill.slug, r.asset.name, r.asset.connection.sshAlias].some((s) => s.toLowerCase().includes(q))
  const by: Record<SkillSort, (a: SkillRow, b: SkillRow) => number> = {
    slug: (a, b) => a.skill.slug.localeCompare(b.skill.slug),
    mounts: (a, b) => b.mounts - a.mounts || by.slug(a, b),
    tokens: (a, b) => (b.resident ?? -1) - (a.resident ?? -1) || by.slug(a, b),
  }
  return rows
    .filter((r) => hit(r) && (state === "all" || skillCompileState(r.skill) === state))
    .sort(by[sort])
}
