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

function seed(mode: Mode) {
  const asset = structuredClone({ ...base, agent: { ...base.agent, mode } })
  useAssetStore.setState({ ids: [asset.id], byId: { [asset.id]: asset } })
  return asset
}

beforeEach(() => {
  vi.resetAllMocks()
  usePendingAction.setState({ pending: null })
  fake.mode.mockImplementation(async (_id: string, mode: Mode) => snapshot({ ...current(), agent: { ...current().agent, mode } }))
  fake.save.mockImplementation(async (input: AssetInput) => snapshot({ ...current(), name: input.name }))
})

describe("执行模式的即时操作", () => {
  it("任意资源开启自动运维先确认，取消不改变资源；确认后仅改变模式", async () => {
    const initial = seed("confirm-changes")
    serverActions.requestMode(initial, "auto-ops")
    expect(usePendingAction.getState().pending).toEqual({ kind: "mode", assetId: initial.id })
    expect(fake.mode).not.toHaveBeenCalled()
    usePendingAction.getState().set(null)
    expect(current()).toEqual(initial)
    await serverActions.setMode(initial, "auto-ops", true)
    expect(current()).toMatchObject({ agent: { mode: "auto-ops" } })
    expect(fake.save).not.toHaveBeenCalled()
  })

  it("切回确认变更无需确认，直接生效", async () => {
    const initial = seed("auto-ops")
    serverActions.requestMode(initial, "confirm-changes")
    await vi.waitFor(() => expect(fake.mode).toHaveBeenCalledTimes(1))
    expect(usePendingAction.getState().pending).toBeNull()
    expect(current()).toMatchObject({ agent: { mode: "confirm-changes" } })
  })

  it("排队中的切换先完成为确认变更后，后续未确认的自动运维切换仍需确认并释放队列", async () => {
    const initial = seed("auto-ops")
    const pending = deferred<SaveResult>()
    fake.mode.mockReturnValueOnce(pending.promise)
    const backWork = serverActions.setMode(initial, "confirm-changes")
    await vi.waitFor(() => expect(fake.mode).toHaveBeenCalledTimes(1))
    const autoWork = serverActions.setMode(initial, "auto-ops")
    pending.resolve(snapshot({ ...initial, agent: { ...initial.agent, mode: "confirm-changes" } }))
    await Promise.all([backWork, autoWork])
    expect(fake.mode).toHaveBeenCalledTimes(1)
    expect(usePendingAction.getState().pending).toEqual({ kind: "mode", assetId: initial.id })
    expect(current()).toMatchObject({ agent: { mode: "confirm-changes" } })
    await serverActions.setMode(initial, "auto-ops", true)
    expect(fake.mode).toHaveBeenCalledTimes(2)
    expect(current()).toMatchObject({ agent: { mode: "auto-ops" } })
  })
})
