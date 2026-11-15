import { beforeEach, describe, expect, it, vi } from "vitest"

import type { GithubScopeResult, SaveResult } from "@/bindings"

const fake = vi.hoisted(() => ({
  getScope: vi.fn(), saveScope: vi.fn(), refreshAssets: vi.fn(async () => undefined),
  assets: { byId: { existing: { type: "cli" } } as Record<string, unknown> },
}))
vi.mock("@/lib/ipc", () => ({ ipc: { getGithubScope: fake.getScope }, toIpcError: (error: unknown) => error }))
vi.mock("./assets", () => ({ useAssetStore: { getState: () => ({ ...fake.assets, refresh: fake.refreshAssets, saveGithubScope: fake.saveScope }) } }))

import { githubQueryKey, useGithubStore } from "./github"

function result(revision = 1): GithubScopeResult {
  return {
    assetId: "existing",
    config: { host: "github.com", owner: { id: "O1", login: "owner", kind: "organization" }, mode: "manual", selectedRepoIds: ["repo:R1"], excludedRepoIds: [], revision, migrationPending: false, envStates: {} },
    owners: [{ id: "O1", login: "owner", kind: "organization" }],
    scope: [{ id: "repo:R1", kind: "repo", name: "owner/one", selected: true }],
    envStates: {},
  }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((yes) => { resolve = yes })
  return { promise, resolve }
}

beforeEach(() => {
  for (const key of Object.keys(useGithubStore.getState().byKey)) useGithubStore.getState().clear(key)
  vi.clearAllMocks()
  fake.assets.byId = { existing: { type: "cli" } }
  fake.getScope.mockResolvedValue(result())
})

describe("GitHub 查询快照", () => {
  it("同一未强制查询复用进行中的请求，StrictMode不重复迁移", async () => {
    const later = deferred<GithubScopeResult>()
    fake.getScope.mockReturnValue(later.promise)
    const a = useGithubStore.getState().load({ assetId: "existing" })
    const b = useGithubStore.getState().load({ assetId: "existing" })
    const count = fake.getScope.mock.calls.length
    later.resolve(result(2)); await Promise.all([a, b])
    expect(count).toBe(1)
    expect(useGithubStore.getState().byKey.existing.result?.config.revision).toBe(2)
  })

  it("刷新失败保留快照，不清空旧范围", async () => {
    await useGithubStore.getState().load({ assetId: "existing" })
    fake.getScope.mockRejectedValueOnce({ id: "cli-scope-permission" })
    await useGithubStore.getState().load({ assetId: "existing", force: true })
    const state = useGithubStore.getState().byKey.existing
    expect(state.result?.scope).toEqual(result().scope)
    expect(state.error?.id).toBe("cli-scope-permission")
    expect(state.loading).toBe(false)
  })

  it("晚到的旧请求不能盖过新revision", async () => {
    const first = deferred<GithubScopeResult>()
    const second = deferred<GithubScopeResult>()
    fake.getScope.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const a = useGithubStore.getState().load({ assetId: "existing" })
    const b = useGithubStore.getState().load({ assetId: "existing", force: true })
    second.resolve(result(3))
    await b
    first.resolve(result(1))
    await a
    expect(useGithubStore.getState().byKey.existing.result?.config.revision).toBe(3)
  })

  it("保存后完整发布快照先应用，迟到刷新不能复活旧选择", async () => {
    const later = deferred<GithubScopeResult>()
    fake.getScope.mockReturnValueOnce(later.promise)
    const loading = useGithubStore.getState().load({ assetId: "existing" })
    const saved = result(7)
    const savedResult = { asset: { type: "cli", id: "existing", github: saved.config, cli: { scope: saved.scope, envStates: saved.envStates } }, statuses: [], inclusions: [], deliveries: [] } as unknown as SaveResult
    fake.saveScope.mockResolvedValueOnce(savedResult)
    await useGithubStore.getState().save({ assetId: "existing", expectedRevision: 1, mode: "manual", selectedRepoIds: ["repo:R1"], excludedRepoIds: [] })
    later.resolve(result(1))
    await loading
    expect(fake.saveScope).toHaveBeenCalledOnce()
    expect(useGithubStore.getState().byKey.existing.result?.config.revision).toBe(7)
  })

  it("资源被删除时丢弃响应，并重新读取所有资源以容纳合法拆分", async () => {
    const later = deferred<GithubScopeResult>()
    fake.getScope.mockReturnValueOnce(later.promise)
    const loading = useGithubStore.getState().load({ assetId: "existing" })
    fake.assets.byId = {}
    later.resolve(result(4))
    expect(await loading).toBeNull()
    expect(fake.refreshAssets).toHaveBeenCalledOnce()
    expect(useGithubStore.getState().byKey.existing.result).toBeNull()
  })

  it("关闭并清理查询后迟到结果不能重新创建缓存", async () => {
    const later = deferred<GithubScopeResult>()
    fake.getScope.mockReturnValueOnce(later.promise)
    const loading = useGithubStore.getState().load({ ownerLogin: "owner" })
    const key = githubQueryKey({ ownerLogin: "owner" })
    useGithubStore.getState().clear(key)
    later.resolve(result())
    await loading
    expect(useGithubStore.getState().byKey[key]).toBeUndefined()
  })
})
