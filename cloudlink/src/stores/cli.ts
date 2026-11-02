// 云平台 CLI 的检测与范围拉取（F-104）。新建向导里还没有资源，结果放在这里；已保存的资源由后端更新后再同步回 useAssetStore
import { create } from "zustand"

import type { CliProvider, CliScopeItem } from "@/bindings"
import { ipc, toIpcError, type CliEnvStates } from "@/lib/ipc"
import { cliEnvStatus, useAssetStore } from "./assets"

export interface CliDetection {
  /** 检测进行中（首次进入、重新检测、切回窗口） */
  detecting: boolean
  envStates: CliEnvStates
  scopeLoading: boolean
  scope: CliScopeItem[] | null
  failed: boolean
}

const EMPTY: CliDetection = { detecting: false, envStates: {}, scopeLoading: false, scope: null, failed: false }

interface CliState {
  byProvider: Partial<Record<CliProvider, CliDetection>>
  /** 重新检测；至少一个环境就绪时接着拉取可选资源。assetId 是已保存的这项资源 */
  detect: (provider: CliProvider, assetId?: string) => Promise<void>
  /** 向导里勾选范围（保存时一并提交） */
  setDraftScope: (provider: CliProvider, scope: CliScopeItem[]) => void
  clear: (provider: CliProvider) => void
  /** 「打开终端」之后等用户切回窗口：值是资源 id，新建向导里为 null（F-104 AC2） */
  awaiting: Partial<Record<CliProvider, string | null>>
  awaitFocus: (provider: CliProvider, assetId: string | null) => void
  /** 窗口重新聚焦：重新检测正在等待的云平台 */
  onFocus: () => void
}

export const useCliStore = create<CliState>()((set, get) => {
  const patch = (provider: CliProvider, p: Partial<CliDetection>) =>
    set((s) => ({ byProvider: { ...s.byProvider, [provider]: { ...EMPTY, ...s.byProvider[provider], ...p } } }))

  return {
    byProvider: {},
    awaiting: {},

    awaitFocus: (provider, assetId) => set((s) => ({ awaiting: { ...s.awaiting, [provider]: assetId } })),

    onFocus: () => {
      const awaiting = get().awaiting
      set({ awaiting: {} })
      for (const [provider, assetId] of Object.entries(awaiting) as [CliProvider, string | null][]) {
        get().detect(provider, assetId ?? undefined).catch(() => undefined)
      }
    },

    detect: async (provider, assetId) => {
      if (get().byProvider[provider]?.detecting) return
      patch(provider, { detecting: true, failed: false })
      let envStates: CliEnvStates
      try {
        envStates = await ipc.detectCliEnvironment({ provider, assetId })
      } catch (e) {
        patch(provider, { detecting: false, failed: true })
        throw toIpcError(e)
      }
      patch(provider, { detecting: false, envStates })
      if (!Object.values(envStates).some((s) => s && cliEnvStatus(s) === "ready")) {
        if (assetId) await useAssetStore.getState().refresh()
        return
      }
      patch(provider, { scopeLoading: true })
      try {
        const scope = await ipc.refreshCliScope({ provider, assetId })
        // 向导里已经勾选的项保留，新出现的默认不勾选（未勾选的不公开）
        const draft = get().byProvider[provider]?.scope
        const merged = assetId || !draft ? scope : scope.map((x) => ({ ...x, selected: draft.find((d) => d.id === x.id)?.selected ?? x.selected }))
        patch(provider, { scopeLoading: false, scope: merged })
      } catch (e) {
        patch(provider, { scopeLoading: false })
        throw toIpcError(e)
      } finally {
        if (assetId) await useAssetStore.getState().refresh()
      }
    },

    setDraftScope: (provider, scope) => patch(provider, { scope }),

    clear: (provider) =>
      set((s) => {
        const byProvider = { ...s.byProvider }
        delete byProvider[provider]
        return { byProvider }
      }),
  }
})

export const emptyDetection = EMPTY
