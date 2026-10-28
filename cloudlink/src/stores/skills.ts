import { create } from "zustand"

import type { IpcError, LintItem, Mode, SkillStatus } from "@/bindings"
import { ipc, toIpcError } from "@/lib/ipc"
import type { LoadStatus } from "./assets"

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
