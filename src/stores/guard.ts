// 护栏（F-306）：每个有 Claude Code 目标的运行环境一条状态
import { create } from "zustand"

import type { EnvId, GuardRules, GuardState, GuardStatus, IpcError } from "@/bindings"
import { ipc, toIpcError } from "@/lib/ipc"
import type { LoadStatus } from "./assets"

interface GuardStoreState {
  statusByEnv: Partial<Record<EnvId, GuardStatus>>
  rules: GuardRules | null
  status: LoadStatus
  error: IpcError | null

  load: () => Promise<void>
  loadRules: () => Promise<void>
  install: (envId: EnvId) => Promise<void>
  remove: (envId: EnvId) => Promise<void>
  _onChanged: (statuses: GuardStatus[]) => void
}

const byEnv = (list: GuardStatus[]) => Object.fromEntries(list.map((g) => [g.envId, g]))

export const useGuardStore = create<GuardStoreState>()((set, get) => ({
  statusByEnv: {},
  rules: null,
  status: "idle",
  error: null,

  load: async () => {
    set({ status: "loading", error: null })
    try {
      set({ statusByEnv: byEnv(await ipc.getGuardStatus()), status: "ready" })
    } catch (e) {
      set({ status: "error", error: toIpcError(e) })
    }
  },

  loadRules: async () => {
    if (get().rules) return
    try {
      set({ rules: await ipc.getGuardRules() })
    } catch (e) {
      throw toIpcError(e)
    }
  },

  install: async (envId) => {
    try {
      const g = await ipc.installGuard(envId)
      set((s) => ({ statusByEnv: { ...s.statusByEnv, [envId]: g } }))
    } catch (e) {
      throw toIpcError(e)
    }
  },

  remove: async (envId) => {
    try {
      const g = await ipc.removeGuard(envId)
      set((s) => ({ statusByEnv: { ...s.statusByEnv, [envId]: g } }))
    } catch (e) {
      throw toIpcError(e)
    }
  },

  _onChanged: (statuses) => set({ statusByEnv: byEnv(statuses) }),
}))

/** 详情护栏行取最差的一个（PRD 6.4）：未生效 > 未安装 > 不可用 > 已生效 */
const RANK: Record<GuardState, number> = { broken: 0, "not-installed": 1, unavailable: 2, active: 3 }

export function selectWorstGuard(statuses: (GuardStatus | undefined)[]): GuardStatus | null {
  const list = statuses.filter((g): g is GuardStatus => !!g)
  if (list.length === 0) return null
  return list.reduce((worst, g) => (RANK[g.state] < RANK[worst.state] ? g : worst))
}
