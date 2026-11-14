// 运行环境、Agent 目标与 ssh 配置（F-301、F-302、F-107）
import { create } from "zustand"

import type {
  AddCustomTargetRequest,
  EnvId,
  Environment,
  IpcError,
  SshConfigStatus,
  SshHostList,
  Target,
} from "@/bindings"
import { ipc, toIpcError } from "@/lib/ipc"
import { useAssetStore, type LoadStatus } from "./assets"
import { useDeliveryStore } from "./deliveries"
import { useSkillStore } from "./skills"

interface TargetState {
  environments: Environment[]
  targets: Target[]
  status: LoadStatus
  error: IpcError | null
  /** 各运行环境 ssh config 里的 Host（F-102），导入对话框和别名冲突检查共用 */
  sshHosts: SshHostList | null
  sshHostsStatus: LoadStatus
  sshHostsError: IpcError | null
  sshConfig: SshConfigStatus[]

  /** 检测运行环境并加载目标（F-301） */
  detect: () => Promise<void>
  /** 重新扫描 ssh config；每次打开导入对话框都会调用，拿到最新的「已导入」标记 */
  loadSshHosts: () => Promise<void>
  loadSshConfig: () => Promise<void>
  /** 加入 Include（F-107 AC1） */
  addSshInclude: (envId: EnvId) => Promise<void>
  /** 启用后自动写入副本；停用时移除 CloudLink 分发的总 Skill（F-302） */
  setEnabled: (id: string, enabled: boolean) => Promise<Target>
  addCustom: (req: AddCustomTargetRequest) => Promise<Target>
  removeCustom: (id: string) => Promise<void>
}

const replace = (list: Target[], t: Target) => list.map((x) => (x.id === t.id ? t : x))

/** 目标变化可能收窄整个共用组的选择；完成后取真实快照，不依赖事件到达顺序。 */
async function refreshPublication() {
  const [assets, deliveries, inclusions, statuses] = await Promise.all([ipc.listAssets(), ipc.listDeliveries(), ipc.listInclusions(), ipc.getCompileStatus()])
  useAssetStore.setState({ byId: Object.fromEntries(assets.map((a) => [a.id, a])), ids: assets.map((a) => a.id) })
  useDeliveryStore.getState()._onChanged({ deliveries, inclusions })
  useSkillStore.getState()._onCompiled(statuses)
}

export const useTargetStore = create<TargetState>()((set, get) => ({
  environments: [],
  targets: [],
  status: "idle",
  error: null,
  sshHosts: null,
  sshHostsStatus: "idle",
  sshHostsError: null,
  sshConfig: [],

  detect: async () => {
    set({ status: "loading", error: null })
    try {
      const [environments, targets, sshConfig] = await Promise.all([
        ipc.detectEnvironments(),
        ipc.listTargets(),
        ipc.getSshConfigStatus(),
      ])
      set({ environments, targets, sshConfig, status: "ready" })
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

  loadSshConfig: async () => {
    try {
      set({ sshConfig: await ipc.getSshConfigStatus() })
    } catch (e) {
      throw toIpcError(e)
    }
  },

  addSshInclude: async (envId) => {
    let status: SshConfigStatus
    try {
      status = await ipc.addSshInclude(envId)
    } catch (e) {
      throw toIpcError(e)
    }
    set((s) => ({
      sshConfig: s.sshConfig.map((x) => (x.envId === envId ? status : x)),
      environments: s.environments.map((e) =>
        e.id === envId ? { ...e, managedSshConfig: { ...e.managedSshConfig, included: status.included } } : e
      ),
    }))
  },

  setEnabled: async (id, enabled) => {
    try {
      const target = await ipc.setTargetEnabled(id, enabled)
      set((s) => ({ targets: replace(s.targets, target) }))
      await refreshPublication()
      return target
    } catch (e) {
      throw toIpcError(e)
    }
  },

  addCustom: async (req) => {
    try {
      const target = await ipc.addCustomTarget(req)
      set((s) => ({ targets: [...s.targets, target] }))
      await refreshPublication()
      return target
    } catch (e) {
      throw toIpcError(e)
    }
  },

  removeCustom: async (id) => {
    try {
      await ipc.removeCustomTarget(id)
    } catch (e) {
      throw toIpcError(e)
    }
    set({ targets: get().targets.filter((t) => t.id !== id) })
    await refreshPublication()
  },
}))

/** 可用的运行环境（设置里停用的不算） */
/**
 * 第一次检测完成之前，还不知道有没有启用的 Agent：这时不写「没有启用的 Agent」，冷启动时才不会闪一下错误的状态。
 * 重新检测时保留上一次的结果（Windows 环境总会被检测到）
 */
export function selectTargetsKnown(s: Pick<TargetState, "status" | "environments">): boolean {
  return s.status === "ready" || s.environments.length > 0
}

export function selectAvailableEnvs(environments: Environment[], enabled?: { id: EnvId; enabled: boolean }[]): Environment[] {
  return environments.filter((e) => e.available && (enabled?.find((x) => x.id === e.id)?.enabled ?? true))
}
