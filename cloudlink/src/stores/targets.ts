import { create } from "zustand"

import type { AddProjectRequest, Environment, IpcError, Target } from "@/bindings"
import { ipc, toIpcError } from "@/lib/ipc"
import type { LoadStatus } from "./assets"
import { useMountStore } from "./mounts"

interface TargetState {
  environments: Environment[]
  targets: Target[]
  status: LoadStatus
  error: IpcError | null

  /** 检测运行环境并加载目标（F-301） */
  detect: () => Promise<void>
  addProject: (req: AddProjectRequest) => Promise<Target>
  removeTarget: (id: string) => Promise<void>
}

export const useTargetStore = create<TargetState>()((set) => ({
  environments: [],
  targets: [],
  status: "idle",
  error: null,

  detect: async () => {
    set({ status: "loading", error: null })
    try {
      const [environments, targets] = await Promise.all([
        ipc.detectEnvironments(),
        ipc.listTargets(),
      ])
      set({ environments, targets, status: "ready" })
    } catch (e) {
      set({ status: "error", error: toIpcError(e) })
    }
  },

  addProject: async (req) => {
    try {
      const target = await ipc.addProjectTarget(req)
      set((s) => ({ targets: [...s.targets, target] }))
      return target
    } catch (e) {
      throw toIpcError(e)
    }
  },

  removeTarget: async (id) => {
    try {
      await ipc.removeTarget(id)
    } catch (e) {
      throw toIpcError(e)
    }
    set((s) => ({ targets: s.targets.filter((t) => t.id !== id) }))
    useMountStore.getState()._dropTarget(id)
  },
}))
