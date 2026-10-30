import { create } from "zustand"

import type { IpcError, Settings } from "@/bindings"
import { toast } from "@/components/ui/toast"
import { ipcErrorText } from "@/lib/copy"
import { ipc, toIpcError } from "@/lib/ipc"
import type { LoadStatus } from "./assets"

interface SettingsState {
  settings: Settings | null
  status: LoadStatus
  error: IpcError | null

  load: () => Promise<void>
  /** 立即保存；失败时回滚并弹 Toast */
  update: (patch: Partial<Settings>) => Promise<void>
}

/** 设置（PRD 6.9）。PRD 7.5 没有单列，IPC 数据统一放在 Zustand（7.4 禁用 react-query 的约定） */
export const useSettingsStore = create<SettingsState>()((set, get) => ({
  settings: null,
  status: "idle",
  error: null,

  load: async () => {
    set({ status: "loading", error: null })
    try {
      set({ settings: await ipc.getSettings(), status: "ready" })
    } catch (e) {
      set({ status: "error", error: toIpcError(e) })
    }
  },

  update: async (patch) => {
    const before = get().settings
    if (before) set({ settings: { ...before, ...patch } })
    try {
      set({ settings: await ipc.updateSettings(patch) })
    } catch (err) {
      const e = toIpcError(err)
      set({ settings: before })
      toast.add({ title: ipcErrorText(e.id, e.params), type: "error" })
    }
  },
}))
