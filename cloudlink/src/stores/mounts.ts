import { create } from "zustand"

import type { IpcError, Mode, Mount, MountRequest, SkillStatus, Target } from "@/bindings"
import { toast } from "@/components/ui/toast"
import { conventionOf } from "@/lib/agents"
import { copy, ipcErrorText } from "@/lib/copy"
import { ipc, toIpcError } from "@/lib/ipc"
import type { LoadStatus } from "./assets"
import { useSkillStore, isSkillBlocked } from "./skills"
import type { Lens } from "./ui"

interface MountState {
  byId: Record<string, Mount>
  status: LoadStatus
  error: IpcError | null

  load: () => Promise<void>
  /** 乐观更新：先放一个 pending 芯片；失败时回滚。需要确认的错误交给调用方处理，其余弹 Toast */
  mount: (req: MountRequest) => Promise<Mount>
  /** 立即生效；Toast 提供「撤销」，撤销即重新挂载 */
  unmount: (mountId: string) => Promise<void>
  setMode: (mountId: string, mode: Mode) => Promise<void>
  checkAll: () => Promise<Mount[]>
  /** 设置 / 危险操作：卸载全部挂载 */
  unmountAll: () => Promise<void>
  repair: (mountId: string) => Promise<void>
  _onChanged: (mounts: Mount[]) => void
  _dropTarget: (targetId: string) => void
}

const byIdOf = (list: Mount[]) => Object.fromEntries(list.map((m) => [m.id, m]))
const slugOf = (skillId: string) => useSkillStore.getState().statusById[skillId]?.slug ?? skillId
const needsConfirm = (e: IpcError) => e.id.startsWith("needs-confirm")

function toastError(e: IpcError) {
  toast.add({ title: ipcErrorText(e.id, e.params), type: "error" })
}

export const useMountStore = create<MountState>()((set, get) => ({
  byId: {},
  status: "idle",
  error: null,

  load: async () => {
    set({ status: "loading", error: null })
    try {
      set({ byId: byIdOf(await ipc.listMounts()), status: "ready" })
    } catch (e) {
      set({ status: "error", error: toIpcError(e) })
    }
  },

  mount: async (req) => {
    const tempId = `pending_${req.skillId}_${req.targetId}`
    const now = new Date().toISOString()
    set((s) => ({
      byId: {
        ...s.byId,
        [tempId]: { id: tempId, ...req, links: [], status: "pending", createdAt: now, checkedAt: now },
      },
    }))
    const drop = (s: MountState) => {
      const byId = { ...s.byId }
      delete byId[tempId]
      return byId
    }
    try {
      const m = await ipc.mount(req)
      set((s) => ({ byId: { ...drop(s), [m.id]: m } }))
      return m
    } catch (err) {
      const e = toIpcError(err)
      set((s) => ({ byId: drop(s) }))
      if (!needsConfirm(e)) toastError(e)
      throw e
    }
  },

  unmount: async (mountId) => {
    const m = get().byId[mountId]
    if (!m) return
    set((s) => {
      const byId = { ...s.byId }
      delete byId[mountId]
      return { byId }
    })
    try {
      await ipc.unmount(mountId)
    } catch (err) {
      set((s) => ({ byId: { ...s.byId, [mountId]: m } }))
      toastError(toIpcError(err))
      return
    }
    toast.add({
      title: copy.toast.unmounted(slugOf(m.skillId)),
      timeout: 8000,
      actionProps: {
        children: copy.toast.undo,
        onClick: () =>
          void get()
            .mount({ skillId: m.skillId, targetId: m.targetId, mode: m.mode, confirmed: true })
            .catch(() => {}),
      },
    })
  },

  setMode: async (mountId, mode) => {
    try {
      const m = await ipc.setMountMode(mountId, mode)
      set((s) => ({ byId: { ...s.byId, [m.id]: m } }))
    } catch (err) {
      toastError(toIpcError(err))
    }
  },

  checkAll: async () => {
    try {
      const list = await ipc.checkMounts()
      set({ byId: byIdOf(list) })
      return list
    } catch (err) {
      const e = toIpcError(err)
      toastError(e)
      throw e
    }
  },

  unmountAll: async () => {
    try {
      await ipc.unmountAll()
    } catch (err) {
      const e = toIpcError(err)
      toastError(e)
      throw e
    }
    set({ byId: {} })
  },

  repair: async (mountId) => {
    try {
      const m = await ipc.repairMount(mountId)
      set((s) => ({ byId: { ...s.byId, [m.id]: m } }))
    } catch (err) {
      toastError(toIpcError(err))
    }
  },

  // 后端推送全集；保留尚在进行中的乐观芯片
  _onChanged: (mounts) =>
    set((s) => {
      const pending = Object.values(s.byId).filter(
        (m) =>
          m.status === "pending" &&
          !mounts.some((x) => x.skillId === m.skillId && x.targetId === m.targetId)
      )
      return { byId: byIdOf([...mounts, ...pending]) }
    }),

  _dropTarget: (targetId) =>
    set((s) => ({ byId: byIdOf(Object.values(s.byId).filter((m) => m.targetId !== targetId)) })),
}))

// ---------- selectors（派生数据不进 store） ----------

export function selectMountsByTarget(byId: Record<string, Mount>, targetId: string): Mount[] {
  return Object.values(byId).filter((m) => m.targetId === targetId)
}

/** 某个 Skill 的全部挂载（资产编辑器「挂载」标签页、删除前的级联清单） */
export function selectMountsBySkill(byId: Record<string, Mount>, skillId: string | undefined): Mount[] {
  if (!skillId) return []
  return Object.values(byId).filter((m) => m.skillId === skillId)
}

/** 链接没建成或 Agent 无法使用：不计入可见，单独计数（F-306；conflict 于 2026-10-28 由用户确认同样处理） */
const UNHEALTHY: Mount["status"][] = ["broken", "alias-missing", "conflict"]

export interface VisibleSkills {
  /** 该 Agent 读取的项目约定目录中的挂载 */
  project: Mount[]
  /** 同一运行环境下该 Agent 全局目录中的挂载 */
  global: Mount[]
  /** 本应可见但处于异常状态的挂载 */
  unhealthy: Mount[]
}

/**
 * Agent 视角的可见集合（F-306）。纯函数。
 * - 项目视角：项目中该 Agent 所读约定目录的挂载 ∪ 同环境下该 Agent 全局目录的挂载
 * - 全局目标视角：这个全局目录本身的挂载
 */
export function selectVisibleSkills(
  lens: Lens,
  targets: Target[],
  mounts: Mount[]
): VisibleSkills {
  const result: VisibleSkills = { project: [], global: [], unhealthy: [] }
  const target = targets.find((t) => t.id === lens.targetId)
  if (!target) return result

  const put = (m: Mount, bucket: "project" | "global") =>
    (UNHEALTHY.includes(m.status) ? result.unhealthy : result[bucket]).push(m)

  if (target.kind === "agent-global") {
    mounts.filter((m) => m.targetId === target.id).forEach((m) => put(m, "global"))
    return result
  }

  const convention = conventionOf(lens.agent)
  if (convention && target.conventions?.includes(convention)) {
    mounts.filter((m) => m.targetId === target.id).forEach((m) => put(m, "project"))
  }
  const globals = new Set(
    targets
      .filter((t) => t.kind === "agent-global" && t.envId === target.envId && t.agent === lens.agent)
      .map((t) => t.id)
  )
  mounts.filter((m) => globals.has(m.targetId)).forEach((m) => put(m, "global"))
  return result
}

export interface Health {
  broken: number
  conflict: number
  blocked: number
}

/** 侧栏计数与挂载视图健康摘要 */
export function selectHealth(mounts: Mount[], skills: SkillStatus[]): Health {
  return {
    broken: mounts.filter((m) => m.status === "broken").length,
    conflict: mounts.filter((m) => m.status === "conflict").length,
    blocked: skills.filter(isSkillBlocked).length,
  }
}
