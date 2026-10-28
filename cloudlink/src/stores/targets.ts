import { create } from "zustand"

import type { AddProjectRequest, Environment, IpcError, SshHostList, Target } from "@/bindings"
import { ipc, toIpcError } from "@/lib/ipc"
import type { LoadStatus } from "./assets"
import { useMountStore } from "./mounts"

interface TargetState {
  environments: Environment[]
  targets: Target[]
  status: LoadStatus
  error: IpcError | null
  /** 各运行环境 ssh config 里的 Host（F-102），导入对话框和别名选择共用 */
  sshHosts: SshHostList | null
  sshHostsStatus: LoadStatus
  sshHostsError: IpcError | null

  /** 检测运行环境并加载目标（F-301） */
  detect: () => Promise<void>
  /** 重新扫描 ssh config；每次打开导入对话框都会调用，拿到最新的「已导入」标记 */
  loadSshHosts: () => Promise<void>
  addProject: (req: AddProjectRequest) => Promise<Target>
  removeTarget: (id: string) => Promise<void>
}

export const useTargetStore = create<TargetState>()((set) => ({
  environments: [],
  targets: [],
  status: "idle",
  error: null,
  sshHosts: null,
  sshHostsStatus: "idle",
  sshHostsError: null,

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

  loadSshHosts: async () => {
    set({ sshHostsStatus: "loading", sshHostsError: null })
    try {
      set({ sshHosts: await ipc.listSshHosts(), sshHostsStatus: "ready" })
    } catch (e) {
      set({ sshHostsStatus: "error", sshHostsError: toIpcError(e) })
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
