// 操作记录（F-307）：详情里每台服务器最近 50 条；动态页的完整记录（按资源筛选、分页）
import { create } from "zustand"

import type { IpcError, Operation } from "@/bindings"
import { dayKey } from "@/lib/format"
import { ipc, toIpcError } from "@/lib/ipc"
import type { LoadStatus } from "./assets"

export const RECENT_LIMIT = 50
export const FEED_PAGE = 100

interface OperationState {
  recentByAsset: Record<string, Operation[]>
  /** 动态页：全部资源或某项资源的记录，新的在前 */
  feed: Operation[]
  feedAssetId: string | null
  feedStatus: LoadStatus
  feedError: IpcError | null
  feedHasMore: boolean

  load: (assetId: string) => Promise<void>
  /** more 为 true 时接着上一页往后读 */
  loadFeed: (assetId: string | null, more?: boolean) => Promise<void>
  /** 护栏记录读入后，只刷新已经加载过的那台服务器 */
  _onNew: (assetId: string) => void
}

export const useOperationStore = create<OperationState>()((set, get) => ({
  recentByAsset: {},
  feed: [],
  feedAssetId: null,
  feedStatus: "idle",
  feedError: null,
  feedHasMore: false,

  loadFeed: async (assetId, more = false) => {
    const before = more ? get().feed.at(-1)?.at : undefined
    set({ feedStatus: "loading", feedError: null, feedAssetId: assetId, ...(more ? {} : { feed: get().feedAssetId === assetId ? get().feed : [] }) })
    try {
      const list = await ipc.listOperations({ assetId: assetId ?? undefined, before, limit: FEED_PAGE })
      set((s) => ({ feed: more ? [...s.feed, ...list] : list, feedHasMore: list.length === FEED_PAGE, feedStatus: "ready" }))
    } catch (e) {
      set({ feedStatus: "error", feedError: toIpcError(e) })
    }
  },

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
    // 动态页读过时刷新第一页（筛的是别的资源时不用）
    const { feedStatus, feedAssetId } = get()
    if (feedStatus !== "idle" && (feedAssetId === null || feedAssetId === assetId)) void get().loadFeed(feedAssetId)
  },
}))

/** 折叠时的摘要「今天 12 条，拦下 2 条」（F-307 AC1）。只统计已加载的最近 50 条 */
export function selectTodayCounts(list: Operation[] | undefined, now: number = Date.now()) {
  const today = dayKey(new Date(now).toISOString())
  const todays = (list ?? []).filter((o) => dayKey(o.at) === today)
  return { total: todays.length, denied: todays.filter((o) => o.decision === "denied").length }
}
