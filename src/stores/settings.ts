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

/**
 * 设置读到之前，不知道哪些运行环境被停用了：Agent 开关先不画，免得闪一下停用环境里的 Agent。
 * 冷启动时后端做完启动检测才返回设置；重新读取期间沿用上一次的值；读取失败时顶部的加载错误已经说明原因
 */
export function selectSettingsKnown(s: Pick<SettingsState, "settings">): boolean {
  return s.settings !== null
}
