// P8c：查询结果与表单草稿分开；刷新失败不清空快照，迟到结果不覆盖新请求。
import { create } from "zustand"

import type { GithubScopeRequest, GithubScopeResult, GithubScopeSaveRequest, IpcError, SaveResult } from "@/bindings"
import { ipc, toIpcError } from "@/lib/ipc"
import { useAssetStore } from "./assets"

type LoadRequest = Omit<GithubScopeRequest, "force"> & { force?: boolean }
export const githubQueryKey = (request: LoadRequest) => request.assetId ?? `create:${request.host ?? "github.com"}:${request.ownerLogin ?? ""}`

export interface GithubScopeState {
  result: GithubScopeResult | null
  loading: boolean
  error: IpcError | null
}
export const emptyGithubScope: GithubScopeState = { result: null, loading: false, error: null }

interface GithubState {
  byKey: Record<string, GithubScopeState>
  load: (request: LoadRequest) => Promise<GithubScopeResult | null>
  save: (request: GithubScopeSaveRequest) => Promise<SaveResult>
  clear: (key: string) => void
}

export const useGithubStore = create<GithubState>()((set, get) => {
  const versions = new Map<string, number>()
  const inflight = new Map<string, { signature: string; version: number; promise: Promise<GithubScopeResult | null> }>()
  const next = (key: string) => {
    const version = (versions.get(key) ?? 0) + 1
    versions.set(key, version)
    return version
  }
  const patch = (key: string, update: Partial<GithubScopeState>) => set((state) => ({ byKey: { ...state.byKey, [key]: { ...emptyGithubScope, ...state.byKey[key], ...update } } }))

  return {
    byKey: {},
    load: (request) => {
      const key = githubQueryKey(request)
      const signature = JSON.stringify([request.assetId, request.host, request.ownerLogin, request.expectedRevision])
      const current = inflight.get(key)
      if (!request.force && current?.signature === signature) return current.promise
      const version = next(key)
      patch(key, { loading: true, error: null })
      const work = (async () => {
      try {
        const result = await ipc.getGithubScope({ ...request, force: request.force ?? false })
        if (versions.get(key) !== version) return null
        // Legacy migration can split one record into multiple verified owner resources.
        // Refresh the complete asset list rather than overwriting only the original row.
        if (request.assetId) await useAssetStore.getState().refresh()
        if (versions.get(key) !== version) return null
        if (request.assetId && !useAssetStore.getState().byId[request.assetId]) {
          patch(key, { loading: false, result: null })
          return null
        }
        const previous = get().byKey[key]?.result
        if (previous && request.assetId && result.config.revision < previous.config.revision) {
          patch(key, { loading: false })
          return null
        }
        patch(key, { loading: false, result, error: null })
        return result
      } catch (error) {
        if (versions.get(key) !== version) return null
        patch(key, { loading: false, error: toIpcError(error) })
        return null
      }
      })()
      const promise = work.finally(() => { if (inflight.get(key)?.version === version) inflight.delete(key) })
      inflight.set(key, { signature, version, promise })
      return promise
    },
    save: async (request) => {
      const result = await useAssetStore.getState().saveGithubScope(request)
      next(request.assetId)
      inflight.delete(request.assetId)
      if (result.asset.type === "cli" && result.asset.github) {
        const previous = get().byKey[request.assetId]?.result
        patch(request.assetId, {
          loading: false,
          error: null,
          result: {
            assetId: result.asset.id,
            config: result.asset.github,
            owners: previous?.owners ?? (result.asset.github.owner ? [result.asset.github.owner] : []),
            scope: result.asset.cli.scope,
            envStates: result.asset.cli.envStates,
          },
        })
      }
      return result
    },
    clear: (key) => {
      next(key)
      inflight.delete(key)
      set((state) => {
        const byKey = { ...state.byKey }
        delete byKey[key]
        return { byKey }
      })
    },
  }
})
