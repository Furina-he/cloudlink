// Agent 笔记收件箱（F-308）：只保存待处理的笔记
import { create } from "zustand"

import type { AgentNote, IpcError, SaveResult } from "@/bindings"
import { ipc, toIpcError } from "@/lib/ipc"
import { useAssetStore, type LoadStatus } from "./assets"
import { useSkillStore } from "./skills"

interface NotesState {
  byAsset: Record<string, AgentNote[]>
  status: LoadStatus
  error: IpcError | null

  load: () => Promise<void>
  /** 并入（可带编辑后的内容）：立即保存并重新编译（F-308 AC4） */
  merge: (items: { id: string; text?: string }[]) => Promise<SaveResult>
  dismiss: (ids: string[]) => Promise<void>
  _onNew: (assetId: string) => void
}

const group = (list: AgentNote[]) => {
  const out: Record<string, AgentNote[]> = {}
  list.filter((n) => n.status === "pending").forEach((n) => (out[n.assetId] = [...(out[n.assetId] ?? []), n]))
  return out
}

const drop = (byAsset: NotesState["byAsset"], ids: string[]) =>
  Object.fromEntries(Object.entries(byAsset).map(([k, list]) => [k, list.filter((n) => !ids.includes(n.id))]))

export const useNotesStore = create<NotesState>()((set, get) => ({
  byAsset: {},
  status: "idle",
  error: null,

  load: async () => {
    set({ status: "loading", error: null })
    try {
      set({ byAsset: group(await ipc.listNotes()), status: "ready" })
    } catch (e) {
      set({ status: "error", error: toIpcError(e) })
    }
  },

  merge: async (items) => {
    let result: SaveResult
    try {
      result = await ipc.mergeNotes(items)
    } catch (e) {
      throw toIpcError(e)
    }
    set((s) => ({ byAsset: drop(s.byAsset, items.map((i) => i.id)) }))
    useAssetStore.getState()._upsert(result.asset)
    useSkillStore.getState()._onCompiled(result.statuses)
    return result
  },

  dismiss: async (ids) => {
    try {
      await ipc.dismissNotes(ids)
    } catch (e) {
      throw toIpcError(e)
    }
    set((s) => ({ byAsset: drop(s.byAsset, ids) }))
  },

  _onNew: (assetId) => {
    void ipc
      .listNotes(assetId)
      .then((list) => set((s) => ({ byAsset: { ...s.byAsset, [assetId]: group(list)[assetId] ?? [] } })))
      .catch(() => get().load())
  },
}))

/** 卡片「笔记 3」：待处理的数量（F-308 AC3） */
export const selectPendingCount = (byAsset: NotesState["byAsset"], assetId: string) => byAsset[assetId]?.length ?? 0
