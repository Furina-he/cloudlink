import { beforeEach, describe, expect, it, vi } from "vitest"

import type { CliEnvState, CliScopeItem } from "@/bindings"

const fake = vi.hoisted(() => ({
  detect: vi.fn(),
  scope: vi.fn(),
  refreshAssets: vi.fn(async () => undefined),
  assets: {
    byId: {} as Record<string, { type: string; account: string | null }>,
  },
}))

vi.mock("@/lib/ipc", () => ({
  ipc: { detectCliEnvironment: fake.detect, refreshCliScope: fake.scope },
  toIpcError: (error: unknown) => error,
}))
vi.mock("./assets", () => ({
  cliEnvStatus: (state: CliEnvState) =>
    state.installed && state.authenticated && !state.expired
      ? "ready"
      : "not-logged-in",
  useAssetStore: {
    getState: () => ({ ...fake.assets, refresh: fake.refreshAssets }),
  },
}))

import { emptyDetection, scopeIsReady, useCliStore } from "./cli"

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

const resource = (id: string, name = id): CliScopeItem => ({
  id,
  kind: "project",
  name,
  selected: false,
})
const ready: CliEnvState = {
  installed: true,
  authenticated: true,
  expired: false,
  checkedAt: "2026-11-04T00:00:00Z",
  account: "user",
  accounts: ["account-a", "account-b"],
}

beforeEach(() => {
  for (const provider of ["cloudflare", "vercel", "oracle"] as const)
    useCliStore.getState().clear(provider)
  vi.clearAllMocks()
  fake.assets.byId = {}
  fake.detect.mockResolvedValue({ windows: ready })
  fake.scope.mockResolvedValue([])
})

describe("云 CLI 账号与 Scope", () => {
  it("切换账号后立即清空 Scope，晚到的旧账号响应不能覆盖当前列表", async () => {
    const a = deferred<CliScopeItem[]>()
    const b = deferred<CliScopeItem[]>()
    fake.scope.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise)
    const first = useCliStore.getState().refreshScope("vercel", "account-a")
    useCliStore.getState().clearScope("vercel", "account-b")
    expect(useCliStore.getState().byProvider.vercel?.scope).toBeNull()
    const second = useCliStore.getState().refreshScope("vercel", "account-b")
    b.resolve([resource("b")])
    await second
    a.resolve([resource("a")])
    await first
    expect(useCliStore.getState().byProvider.vercel?.scopeAccount).toBe(
      "account-b"
    )
    expect(
      useCliStore.getState().byProvider.vercel?.scope?.map((item) => item.id)
    ).toEqual(["b"])
  })

  it("两个账号即使出现相同资源 ID，也不能继承另一个账号的勾选", async () => {
    fake.scope.mockResolvedValue([resource("same-id")])
    await useCliStore.getState().refreshScope("vercel", "account-a")
    useCliStore
      .getState()
      .setDraftScope("vercel", [{ ...resource("same-id"), selected: true }])
    await useCliStore.getState().refreshScope("vercel", "account-b")
    expect(useCliStore.getState().byProvider.vercel?.scope?.[0].selected).toBe(
      false
    )
  })

  it("同一账号手动刷新时保留最新的勾选，新出现的资源默认不勾选", async () => {
    fake.scope.mockResolvedValueOnce([resource("existing")])
    await useCliStore.getState().refreshScope("vercel", "account-a")
    const later = deferred<CliScopeItem[]>()
    fake.scope.mockReturnValueOnce(later.promise)
    const loading = useCliStore.getState().refreshScope("vercel", "account-a")
    useCliStore
      .getState()
      .setDraftScope("vercel", [{ ...resource("existing"), selected: true }])
    later.resolve([resource("existing"), resource("new")])
    await loading
    expect(
      useCliStore
        .getState()
        .byProvider.vercel?.scope?.map((item) => item.selected)
    ).toEqual([true, false])
  })

  it("Scope 读取中、失败或属于别的账号时都不能保存", async () => {
    fake.scope.mockResolvedValueOnce([resource("existing")])
    await useCliStore.getState().refreshScope("vercel", "account-a")
    expect(
      scopeIsReady(useCliStore.getState().byProvider.vercel!, "account-a")
    ).toBe(true)
    expect(
      scopeIsReady(useCliStore.getState().byProvider.vercel!, "account-b")
    ).toBe(false)
    const later = deferred<CliScopeItem[]>()
    fake.scope.mockReturnValueOnce(later.promise)
    const loading = useCliStore.getState().refreshScope("vercel", "account-a")
    expect(
      scopeIsReady(useCliStore.getState().byProvider.vercel!, "account-a")
    ).toBe(false)
    later.reject({ id: "cli-scope-permission" })
    await expect(loading).rejects.toEqual({ id: "cli-scope-permission" })
    const result = useCliStore.getState().byProvider.vercel!
    expect(result.scope).toBeNull()
    expect(result.scopeError?.id).toBe("cli-scope-permission")
    expect(scopeIsReady(result, "account-a")).toBe(false)
    expect(scopeIsReady(emptyDetection, null)).toBe(false)
  })

  it("已有资源刷新 Scope 时使用绑定账号，忽略调用方传来的其他账号", async () => {
    fake.assets.byId = { saved: { type: "cli", account: "bound-team" } }
    await useCliStore.getState().refreshScope("vercel", "another-team", "saved")
    expect(fake.scope).toHaveBeenCalledWith({
      provider: "vercel",
      assetId: "saved",
      account: "bound-team",
    })
    expect(fake.refreshAssets).toHaveBeenCalled()
  })

  it("关闭向导后，未完成的 Scope 和环境检测不能重新创建旧向导状态", async () => {
    const later = deferred<CliScopeItem[]>()
    fake.scope.mockReturnValueOnce(later.promise)
    const scope = useCliStore.getState().refreshScope("vercel", "account-a")
    useCliStore.getState().clear("vercel")
    later.resolve([resource("old")])
    await scope
    expect(useCliStore.getState().byProvider.vercel).toBeUndefined()
    const detector = deferred<{ windows: CliEnvState }>()
    fake.detect.mockReturnValueOnce(detector.promise)
    const detection = useCliStore.getState().detect("vercel")
    useCliStore.getState().clear("vercel")
    detector.resolve({ windows: ready })
    await detection
    expect(useCliStore.getState().byProvider.vercel).toBeUndefined()
  })
})
