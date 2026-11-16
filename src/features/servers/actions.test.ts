import { beforeEach, describe, expect, it, vi } from "vitest"

import type { Asset, AssetInput, Mode, SaveResult, ServerAsset } from "@/bindings"
import { assets } from "@/mocks/fixtures"

const fake = vi.hoisted(() => ({ save: vi.fn(), mode: vi.fn(), toast: vi.fn(), close: vi.fn() }))
vi.mock("@/components/ui/toast", () => ({ toast: { add: fake.toast, close: fake.close } }))
vi.mock("@/lib/ipc", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ipc")>()
  return { ...actual, ipc: { ...actual.ipc, saveAsset: fake.save, setMode: fake.mode } }
})

import { useAssetStore } from "@/stores/assets"
import { serverActions, usePendingAction } from "./actions"

const base = assets.find((asset) => asset.id === "ast_hk_edge") as ServerAsset
const snapshot = (asset: Asset): SaveResult => ({ asset, statuses: [], inclusions: [], deliveries: [] })
const current = () => useAssetStore.getState().byId[base.id]

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((yes) => { resolve = yes })
  return { promise, resolve }
}

function seed(production: boolean, mode: Mode) {
  const asset = structuredClone({ ...base, production, agent: { ...base.agent, mode } })
  useAssetStore.setState({ ids: [asset.id], byId: { [asset.id]: asset } })
  return asset
}

beforeEach(() => {
  vi.resetAllMocks()
  usePendingAction.setState({ pending: null })
  fake.mode.mockImplementation(async (_id: string, mode: Mode) => snapshot({ ...current(), agent: { ...current().agent, mode } }))
  fake.save.mockImplementation(async (input: AssetInput) => snapshot({ ...current(), production: input.production }))
})

describe("生产风险与模式的即时操作", () => {
  it("生产开启自动运维先确认，取消不改变资源；确认后仅改变模式", async () => {
    const initial = seed(true, "confirm-changes")
    serverActions.requestMode(initial, "auto-ops")
    expect(usePendingAction.getState().pending).toEqual({ kind: "mode", assetId: initial.id })
    expect(fake.mode).not.toHaveBeenCalled()
    usePendingAction.getState().set(null)
    expect(current()).toEqual(initial)
    await serverActions.setMode(initial, "auto-ops", true)
    expect(current()).toMatchObject({ production: true, agent: { mode: "auto-ops" } })
    expect(fake.save).not.toHaveBeenCalled()
  })

  it("自动运维资源标生产需确认，取消保留两项；确认或关闭生产都不改模式与连接", async () => {
    const initial = seed(false, "auto-ops")
    await serverActions.setProduction(initial, true)
    expect(usePendingAction.getState().pending).toEqual({ kind: "production", assetId: initial.id })
    expect(fake.save).not.toHaveBeenCalled()
    usePendingAction.getState().set(null)
    expect(current()).toEqual(initial)
    await serverActions.setProduction(initial, true, true)
    expect(current()).toMatchObject({ production: true, agent: initial.agent, connection: initial.connection })
    await serverActions.setProduction(current(), false)
    expect(current()).toMatchObject({ production: false, agent: initial.agent, connection: initial.connection })
    expect(fake.mode).not.toHaveBeenCalled()
  })

  it("排队中的自动运维先完成，随后标生产根据最新模式要求确认并释放队列", async () => {
    const initial = seed(false, "confirm-changes")
    const pending = deferred<SaveResult>()
    fake.mode.mockReturnValueOnce(pending.promise)
    const modeWork = serverActions.setMode(initial, "auto-ops")
    await vi.waitFor(() => expect(fake.mode).toHaveBeenCalledTimes(1))
    const productionWork = serverActions.setProduction(initial, true)
    pending.resolve(snapshot({ ...initial, agent: { ...initial.agent, mode: "auto-ops" } }))
    await Promise.all([modeWork, productionWork])
    expect(fake.save).not.toHaveBeenCalled()
    expect(usePendingAction.getState().pending).toEqual({ kind: "production", assetId: initial.id })
    expect(current()).toMatchObject({ production: false, agent: { mode: "auto-ops" } })
    await serverActions.setProduction(initial, true, true)
    expect(fake.save).toHaveBeenCalledTimes(1)
    expect(current()).toMatchObject({ production: true, agent: { mode: "auto-ops" } })
  })

  it("排队中的生产标记先完成，随后自动运维根据最新生产状态要求确认", async () => {
    const initial = seed(false, "confirm-changes")
    const pending = deferred<SaveResult>()
    fake.save.mockReturnValueOnce(pending.promise)
    const productionWork = serverActions.setProduction(initial, true)
    await vi.waitFor(() => expect(fake.save).toHaveBeenCalledTimes(1))
    const modeWork = serverActions.setMode(initial, "auto-ops")
    pending.resolve(snapshot({ ...initial, production: true }))
    await Promise.all([productionWork, modeWork])
    expect(fake.mode).not.toHaveBeenCalled()
    expect(usePendingAction.getState().pending).toEqual({ kind: "mode", assetId: initial.id })
    expect(current()).toMatchObject({ production: true, agent: { mode: "confirm-changes" } })
    await serverActions.setMode(initial, "auto-ops", true)
    expect(fake.mode).toHaveBeenCalledTimes(1)
    expect(current()).toMatchObject({ production: true, agent: { mode: "auto-ops" } })
  })
})
