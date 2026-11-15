import { create } from "zustand"

import type { ActivityItem, ActivityKind, ActivityQuery, IpcError } from "@/bindings"
import { ipc, toIpcError } from "@/lib/ipc"
import type { LoadStatus } from "./assets"

/**
 * 活动日志只记 CloudLink 自己做的事（F-402，2026-11-10）：Agent 执行的命令（agent-op）只在「动态」页。
 * 「全部类型」就是这一组；查询时总是带上，后端不用改
 */
export const OWN_ACTIVITY_KINDS: ActivityKind[] = ["connection", "probe", "compile", "deliver", "remove", "repair", "ssh-config", "guard", "mode", "cli", "note", "update"]

const ownKinds = (kinds: ActivityKind[] | null | undefined): ActivityKind[] => {
  const own = (kinds ?? []).filter((k) => OWN_ACTIVITY_KINDS.includes(k))
  return own.length ? own : OWN_ACTIVITY_KINDS
}

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
      const page = await ipc.listActivity({ ...query, kinds: ownKinds(query.kinds), before, limit: ACTIVITY_PAGE })
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
    if (!ownKinds(kinds).includes(item.kind)) return
    if (assetId && item.assetId !== assetId) return
    set((s) => ({ items: [item, ...s.items] }))
  },
}))
