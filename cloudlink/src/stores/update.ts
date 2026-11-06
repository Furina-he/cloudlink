// 检测更新（F-406，PRD 6.13）：检查周期、下载和签名校验都在 Rust 侧，这里只缓存 update://changed 的完整快照
import { create } from "zustand"

import type { Asset, CliProvider, IpcError, UpdateStatus } from "@/bindings"
import { CLI_PROVIDERS } from "@/lib/cliProviders"
import { ipc, toIpcError } from "@/lib/ipc"
import { handleOf, useAssetStore } from "./assets"
import { useCliStore, type CliDetection } from "./cli"
import { NEW_KEY, useConnectionStore, type ConnectionTest } from "./connection"
import { useProbeStore, type ProbeRun } from "./probe"

/** update-busy 的 params.task：安装要等的任务（F-406 AC4） */
export type UpdateTask = "connection" | "probe" | "cli" | "publish"

export interface UpdateBlocker {
  task: UpdateTask
  /** 服务器标识；CLI 检测时是 provider */
  name?: string
}

interface UpdateStoreState {
  /** 还没取到时为 null，和 idle 一样不显示任何更新元素 */
  status: UpdateStatus | null
  dialogOpen: boolean
  /** 「下载并安装」被后端拒绝的原因（例如 update-busy）；再次点击或关闭对话框时清掉 */
  rejected: IpcError | null

  load: () => Promise<void>
  setDialogOpen: (open: boolean) => void
  install: () => Promise<void>
  cancel: () => Promise<void>
  _onChanged: (status: UpdateStatus) => void
}

/** 事件计数：首次读取期间已经收到快照时，丢弃读到的旧值 */
let changes = 0

export const useUpdateStore = create<UpdateStoreState>()((set) => ({
  status: null,
  dialogOpen: false,
  rejected: null,

  load: async () => {
    const seen = changes
    try {
      const status = await ipc.getUpdateStatus()
      if (changes === seen) set({ status })
    } catch {
      // 检查更新失败不打扰用户（F-406），提醒保持隐藏
    }
  },

  setDialogOpen: (dialogOpen) => set(dialogOpen ? { dialogOpen } : { dialogOpen, rejected: null }),

  install: async () => {
    set({ rejected: null })
    try {
      await ipc.installUpdate()
    } catch (e) {
      set({ rejected: toIpcError(e) })
    }
  },

  cancel: async () => {
    // 取消失败时下载照常继续，进度和结果仍由事件推送
    await ipc.cancelUpdate().catch(() => undefined)
  },

  _onChanged: (status) => {
    changes++
    set({ status })
  },
}))

/** 有新版本（含下载中、正在安装）时才显示提醒；idle 时界面上没有任何更新元素（F-406 AC1） */
export const hasUpdate = (status: UpdateStatus | null): status is UpdateStatus & { version: string } =>
  !!status && status.state !== "idle" && !!status.version

/** 下载百分比；总大小未知时为 null */
export function downloadPercent(status: UpdateStatus): number | null {
  if (!status.total || status.downloaded == null) return null
  return Math.min(100, Math.floor((status.downloaded / status.total) * 100))
}

interface BlockerSources {
  tests: Record<string, ConnectionTest>
  runs: Record<string, ProbeRun>
  starting: string[]
  cli: Partial<Record<CliProvider, CliDetection>>
  assets: Record<string, Asset>
}

/**
 * 前端看得到的进行中任务（F-406 AC4），顺序与后端判断一致：测试连接、探测、CLI 检测。
 * 停在指纹确认的测试不算进行中（后端已经有了结果）；发布只有后端知道，由 installUpdate 返回的 update-busy 说明
 */
export function findUpdateBlocker({ tests, runs, starting, cli, assets }: BlockerSources): UpdateBlocker | null {
  const handle = (id: string) => (assets[id] ? handleOf(assets[id]) : undefined)
  const test = Object.entries(tests).find(([, t]) => t.status === "running")
  if (test) {
    const [key, { alias }] = test
    return { task: "connection", name: (key !== NEW_KEY ? handle(key) : undefined) ?? (alias || undefined) }
  }
  const probing = Object.values(runs).find((r) => r.status === "running")?.assetId ?? starting[0]
  if (probing) return { task: "probe", name: handle(probing) }
  const provider = CLI_PROVIDERS.find((p) => cli[p]?.detecting || cli[p]?.scopeLoading)
  if (provider) return { task: "cli", name: provider }
  return null
}

export function useUpdateBlocker(): UpdateBlocker | null {
  const tests = useConnectionStore((s) => s.testsByKey)
  const runs = useProbeStore((s) => s.runs)
  const starting = useProbeStore((s) => s.starting)
  const cli = useCliStore((s) => s.byProvider)
  const assets = useAssetStore((s) => s.byId)
  return findUpdateBlocker({ tests, runs, starting, cli, assets })
}
