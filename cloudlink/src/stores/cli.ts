// 云平台 CLI 的检测与范围拉取（F-104）。新建向导里还没有资源，结果放在这里；已保存的资源由后端更新后再同步回 useAssetStore
import { create } from "zustand"

import type { CliProvider, CliScopeItem, IpcError } from "@/bindings"
import { ipc, toIpcError, type CliEnvStates } from "@/lib/ipc"
import { cliEnvStatus, useAssetStore } from "./assets"

export interface CliDetection {
  /** 检测进行中（首次进入、重新检测、切回窗口） */
  detecting: boolean
  envStates: CliEnvStates
  scopeLoading: boolean
  scope: CliScopeItem[] | null
  /** Scope 所属的稳定账号标识；null 表示跟随 CLI 当前登录 */
  scopeAccount: string | null
  scopeError: IpcError | null
  failed: boolean
}

const EMPTY: CliDetection = {
  detecting: false,
  envStates: {},
  scopeLoading: false,
  scope: null,
  scopeAccount: null,
  scopeError: null,
  failed: false,
}

interface CliState {
  byProvider: Partial<Record<CliProvider, CliDetection>>
  /** 重新检测；至少一个环境就绪时接着拉取可选资源。assetId 是已保存的这项资源 */
  detect: (provider: CliProvider, assetId?: string) => Promise<void>
  refreshScope: (
    provider: CliProvider,
    account?: string,
    assetId?: string
  ) => Promise<void>
  /** 切账号时先作废旧请求并清空列表，再拉取新账号的范围 */
  clearScope: (provider: CliProvider, account: string | null) => void
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
  const detectionRequests: Partial<Record<CliProvider, number>> = {}
  const scopeRequests: Partial<Record<CliProvider, number>> = {}
  const next = (
    requests: Partial<Record<CliProvider, number>>,
    provider: CliProvider
  ) => {
    const id = (requests[provider] ?? 0) + 1
    requests[provider] = id
    return id
  }
  const patch = (provider: CliProvider, p: Partial<CliDetection>) =>
    set((s) => ({
      byProvider: {
        ...s.byProvider,
        [provider]: { ...EMPTY, ...s.byProvider[provider], ...p },
      },
    }))

  return {
    byProvider: {},
    awaiting: {},

    awaitFocus: (provider, assetId) =>
      set((s) => ({ awaiting: { ...s.awaiting, [provider]: assetId } })),

    onFocus: () => {
      const awaiting = get().awaiting
      set({ awaiting: {} })
      for (const [provider, assetId] of Object.entries(awaiting) as [
        CliProvider,
        string | null,
      ][]) {
        get()
          .detect(provider, assetId ?? undefined)
          .catch(() => undefined)
      }
    },

    detect: async (provider, assetId) => {
      if (get().byProvider[provider]?.detecting) return
      const request = next(detectionRequests, provider)
      next(scopeRequests, provider)
      patch(provider, {
        detecting: true,
        failed: false,
        scopeLoading: false,
        scopeError: null,
      })
      let envStates: CliEnvStates
      try {
        envStates = await ipc.detectCliEnvironment({ provider, assetId })
      } catch (e) {
        if (detectionRequests[provider] !== request) return
        patch(provider, { detecting: false, failed: true })
        throw toIpcError(e)
      }
      if (detectionRequests[provider] !== request) return
      patch(provider, { detecting: false, envStates })
      if (
        !Object.values(envStates).some((s) => s && cliEnvStatus(s) === "ready")
      ) {
        patch(provider, { scope: null, scopeError: null })
        if (assetId) await useAssetStore.getState().refresh()
        return
      }
      const saved = assetId ? useAssetStore.getState().byId[assetId] : undefined
      const account =
        saved?.type === "cli"
          ? saved.account
          : get().byProvider[provider]?.scopeAccount
      // 新建向导首次检测后，由账号选择触发 Scope；手动重新检测则刷新当前账号。
      if (assetId || account)
        await get().refreshScope(provider, account ?? undefined, assetId)
    },

    refreshScope: async (provider, requestedAccount, assetId) => {
      const saved = assetId ? useAssetStore.getState().byId[assetId] : undefined
      const account =
        saved?.type === "cli" ? saved.account : (requestedAccount ?? null)
      const previous = get().byProvider[provider]
      const sameAccount = previous?.scopeAccount === account
      const request = next(scopeRequests, provider)
      patch(provider, {
        scopeLoading: true,
        scopeError: null,
        scopeAccount: account,
        scope: sameAccount ? (previous?.scope ?? null) : null,
      })
      try {
        const scope = await ipc.refreshCliScope({
          provider,
          assetId,
          account: account ?? undefined,
        })
        if (scopeRequests[provider] !== request) return
        const draft = get().byProvider[provider]?.scope
        // 只保留同一账号的勾选；不同账号即使同 ID 也不继承，新增项默认不公开。
        const merged = assetId
          ? scope
          : scope.map((x) => ({
              ...x,
              selected: draft?.find((d) => d.id === x.id)?.selected ?? false,
            }))
        patch(provider, { scopeLoading: false, scope: merged })
      } catch (e) {
        if (scopeRequests[provider] !== request) return
        const error = toIpcError(e)
        patch(provider, { scopeLoading: false, scope: null, scopeError: error })
        throw error
      } finally {
        if (assetId) await useAssetStore.getState().refresh()
      }
    },

    clearScope: (provider, account) => {
      next(scopeRequests, provider)
      patch(provider, {
        scope: null,
        scopeAccount: account,
        scopeLoading: false,
        scopeError: null,
      })
    },

    setDraftScope: (provider, scope) => patch(provider, { scope }),

    clear: (provider) => {
      next(detectionRequests, provider)
      next(scopeRequests, provider)
      set((s) => {
        const byProvider = { ...s.byProvider }
        delete byProvider[provider]
        return { byProvider }
      })
    },
  }
})

export const emptyDetection = EMPTY

/** 保存只允许使用当前账号已经完成的范围查询，空范围本身是有效选择。 */
export function scopeIsReady(
  detection: CliDetection,
  account: string | null
): boolean {
  return (
    !detection.detecting &&
    !detection.failed &&
    !detection.scopeLoading &&
    !detection.scopeError &&
    detection.scopeAccount === account &&
    detection.scope !== null
  )
}
