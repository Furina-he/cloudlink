// 操作记录（F-307）：详情里每台服务器最近 50 条
import { create } from "zustand"

import type { Operation } from "@/bindings"
import { dayKey } from "@/lib/format"
import { ipc } from "@/lib/ipc"

export const RECENT_LIMIT = 50

interface OperationState {
  recentByAsset: Record<string, Operation[]>

  load: (assetId: string) => Promise<void>
  /** 护栏记录读入后，只刷新已经加载过的那台服务器 */
  _onNew: (assetId: string) => void
}

export const useOperationStore = create<OperationState>()((set, get) => ({
  recentByAsset: {},

  load: async (assetId) => {
    try {
      const list = await ipc.listOperations({ assetId, limit: RECENT_LIMIT })
      set((s) => ({ recentByAsset: { ...s.recentByAsset, [assetId]: list } }))
    } catch {
      // 操作记录是辅助信息，加载失败时保持原样
    }
  },

  _onNew: (assetId) => {
    if (get().recentByAsset[assetId]) void get().load(assetId)
  },
}))

/** 折叠时的摘要「今天 12 条，拦下 2 条」（F-307 AC1）。只统计已加载的最近 50 条 */
export function selectTodayCounts(list: Operation[] | undefined, now: number = Date.now()) {
  const today = dayKey(new Date(now).toISOString())
  const todays = (list ?? []).filter((o) => dayKey(o.at) === today)
  return { total: todays.length, denied: todays.filter((o) => o.decision === "denied").length }
}
