// 分发与列入（F-303、F-304、F-305）：都由后端计算，前端不单独创建
import { create } from "zustand"

import type { Delivery, DeliveryStatus, EnvId, Inclusion, IpcError, Target } from "@/bindings"
import { ipc, toIpcError } from "@/lib/ipc"
import type { LoadStatus } from "./assets"

interface DeliveryState {
  byId: Record<string, Delivery>
  inclusions: Inclusion[]
  status: LoadStatus
  error: IpcError | null

  load: () => Promise<void>
  /** 健康检查（F-305）：返回检查后的全部副本 */
  checkAll: () => Promise<Delivery[]>
  repair: (id: string) => Promise<Delivery>
  removeAll: () => Promise<void>
  _onChanged: (e: { deliveries: Delivery[]; inclusions: Inclusion[] }) => void
  _setInclusions: (inclusions: Inclusion[]) => void
}

const byIdOf = (list: Delivery[]) => Object.fromEntries(list.map((d) => [d.id, d]))

export const useDeliveryStore = create<DeliveryState>()((set) => ({
  byId: {},
  inclusions: [],
  status: "idle",
  error: null,

  load: async () => {
    set({ status: "loading", error: null })
    try {
      const [deliveries, inclusions] = await Promise.all([ipc.listDeliveries(), ipc.listInclusions()])
      set({ byId: byIdOf(deliveries), inclusions, status: "ready" })
    } catch (e) {
      set({ status: "error", error: toIpcError(e) })
    }
  },

  checkAll: async () => {
    try {
      const list = await ipc.checkDeliveries()
      set({ byId: byIdOf(list) })
      return list
    } catch (e) {
      throw toIpcError(e)
    }
  },

  repair: async (id) => {
    try {
      const d = await ipc.repairDelivery(id)
      set((s) => ({ byId: { ...s.byId, [d.id]: d } }))
      return d
    } catch (e) {
      throw toIpcError(e)
    }
  },

  removeAll: async () => {
    try {
      await ipc.removeAllDeliveries()
    } catch (e) {
      throw toIpcError(e)
    }
    set({ byId: {} })
  },

  _onChanged: ({ deliveries, inclusions }) => set({ byId: byIdOf(deliveries), inclusions }),
  _setInclusions: (incoming) =>
    set((s) => {
      // set_distribute 只返回这台服务器的列入情况，其余保持不变
      const assets = new Set(incoming.map((i) => i.assetId))
      return { inclusions: [...s.inclusions.filter((i) => !assets.has(i.assetId)), ...incoming] }
    }),
}))

// ---------- selectors ----------

/** 详情 Agent 分段（PRD 7.5） */
export function selectInclusionsByAsset(inclusions: Inclusion[], assetId: string): Inclusion[] {
  return inclusions.filter((i) => i.assetId === assetId)
}

/** Agent 页：每个运行环境的副本 */
export function selectDeliveriesByEnv(byId: Record<string, Delivery>): Partial<Record<EnvId, Delivery[]>> {
  const out: Partial<Record<EnvId, Delivery[]>> = {}
  Object.values(byId).forEach((d) => (out[d.envId] = [...(out[d.envId] ?? []), d]))
  return out
}

/** 需要处理的副本状态（F-305 的四类问题） */
export const PROBLEM_STATUSES: DeliveryStatus[] = ["missing", "modified", "outdated", "conflict"]

export const isDeliveryProblem = (d: Delivery) => PROBLEM_STATUSES.includes(d.status)

/** 一个目标里的总 Skill 列入了几台服务器：同一个运行环境、同一个 Agent */
export function countIncluded(inclusions: Inclusion[], target: Target): number {
  return inclusions.filter((i) => i.envId === target.envId && i.agentKey === target.agentKey && i.included).length
}
