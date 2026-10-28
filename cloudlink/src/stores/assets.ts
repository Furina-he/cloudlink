import { create } from "zustand"

import type { Asset, AssetInput, ImportHost, IpcError, SaveResult } from "@/bindings"
import { ipc, toIpcError } from "@/lib/ipc"
import type { AssetFilter } from "./ui"

export type LoadStatus = "idle" | "loading" | "ready" | "error"

interface AssetState {
  byId: Record<string, Asset>
  ids: string[]
  status: LoadStatus
  error: IpcError | null

  load: () => Promise<void>
  /** 返回编译结果；失败时抛出 IpcError */
  save: (input: AssetInput) => Promise<SaveResult>
  remove: (id: string) => Promise<void>
  importHosts: (hosts: ImportHost[], probeAfter: boolean) => Promise<Asset[]>
  _upsert: (asset: Asset) => void
}

export const useAssetStore = create<AssetState>()((set, get) => ({
  byId: {},
  ids: [],
  status: "idle",
  error: null,

  load: async () => {
    set({ status: "loading", error: null })
    try {
      const list = await ipc.listAssets()
      set({
        byId: Object.fromEntries(list.map((a) => [a.id, a])),
        ids: list.map((a) => a.id),
        status: "ready",
      })
    } catch (e) {
      set({ status: "error", error: toIpcError(e) })
    }
  },

  save: async (input) => {
    try {
      const result = await ipc.saveAsset(input)
      get()._upsert(result.asset)
      return result
    } catch (e) {
      throw toIpcError(e)
    }
  },

  remove: async (id) => {
    try {
      await ipc.deleteAsset(id)
    } catch (e) {
      throw toIpcError(e)
    }
    set((s) => {
      const byId = { ...s.byId }
      delete byId[id]
      return { byId, ids: s.ids.filter((x) => x !== id) }
    })
  },

  importHosts: async (hosts, probeAfter) => {
    try {
      const created = await ipc.importHosts(hosts, probeAfter)
      created.forEach((a) => get()._upsert(a))
      return created
    } catch (e) {
      throw toIpcError(e)
    }
  },

  _upsert: (asset) =>
    set((s) => ({
      byId: { ...s.byId, [asset.id]: asset },
      ids: s.ids.includes(asset.id) ? s.ids : [...s.ids, asset.id],
    })),
}))

/** 资产列表的筛选结果（PRD 7.5）。query 匹配名称、slug、别名、标签 */
export function selectFilteredAssets(
  state: Pick<AssetState, "byId" | "ids">,
  filter: AssetFilter
): Asset[] {
  const q = filter.query.trim().toLowerCase()
  return state.ids
    .map((id) => state.byId[id])
    .filter((a) => {
      if (filter.types.length && !filter.types.includes(a.type)) return false
      if (filter.envTags.length && !filter.envTags.includes(a.envTag)) return false
      if (filter.tags.length && !filter.tags.some((t) => a.tags.includes(t))) return false
      if (!q) return true
      return [a.name, a.slug, a.connection.sshAlias, ...a.tags].some((s) =>
        s.toLowerCase().includes(q)
      )
    })
}
