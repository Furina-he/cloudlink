import { create } from "zustand"

import type { ActivityItem, ActivityQuery, IpcError } from "@/bindings"
import { ipc, toIpcError } from "@/lib/ipc"
import type { LoadStatus } from "./assets"

/** 每页条数（PRD 6.8） */
export const ACTIVITY_PAGE = 100

interface ActivityState {
  items: ActivityItem[]
  status: LoadStatus
  error: IpcError | null
  hasMore: boolean
  query: Omit<ActivityQuery, "before" | "limit">

  /** append 为 true 时从最后一条往前加载下一页 */
  load: (query?: Omit<ActivityQuery, "before" | "limit">, append?: boolean) => Promise<void>
  _onNew: (item: ActivityItem) => void
}

export const useActivityStore = create<ActivityState>()((set, get) => ({
  items: [],
  status: "idle",
  error: null,
  hasMore: false,
  query: {},

  load: async (query = get().query, append = false) => {
    set({ status: "loading", error: null, query })
    const before = append ? get().items.at(-1)?.at : undefined
    try {
      const page = await ipc.listActivity({ ...query, before, limit: ACTIVITY_PAGE })
      set((s) => ({
        items: append ? [...s.items, ...page] : page,
        hasMore: page.length === ACTIVITY_PAGE,
        status: "ready",
      }))
    } catch (e) {
      set({ status: "error", error: toIpcError(e) })
    }
  },

  _onNew: (item) => {
    const { kinds, assetId } = get().query
    if (kinds?.length && !kinds.includes(item.kind)) return
    if (assetId && item.assetId !== assetId) return
    set((s) => ({ items: [item, ...s.items] }))
  },
}))
