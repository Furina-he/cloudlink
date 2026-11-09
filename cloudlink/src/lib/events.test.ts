import { beforeEach, describe, expect, it, vi } from "vitest"

const fake = vi.hoisted(() => ({
  listen: vi.fn(),
  connection: vi.fn(),
  guard: vi.fn(),
  update: vi.fn(),
}))

vi.mock("@tauri-apps/api/event", () => ({ listen: fake.listen }))
vi.mock("@/stores/activity", () => ({
  useActivityStore: { getState: () => ({ _onNew: vi.fn() }) },
}))
vi.mock("@/stores/connection", () => ({
  useConnectionStore: { getState: () => ({ _onTested: fake.connection }) },
}))
vi.mock("@/stores/deliveries", () => ({
  useDeliveryStore: { getState: () => ({ _onChanged: vi.fn() }) },
}))
vi.mock("@/stores/guard", () => ({
  useGuardStore: { getState: () => ({ _onChanged: fake.guard }) },
}))
vi.mock("@/stores/notes", () => ({
  useNotesStore: { getState: () => ({ _onNew: vi.fn() }) },
}))
vi.mock("@/stores/operations", () => ({
  useOperationStore: { getState: () => ({ _onNew: vi.fn() }) },
}))
vi.mock("@/stores/probe", () => ({
  useProbeStore: {
    getState: () => ({ _onProgress: vi.fn(), _onFinished: vi.fn() }),
  },
}))
vi.mock("@/stores/skills", () => ({
  useSkillStore: { getState: () => ({ _onCompiled: vi.fn() }) },
}))
vi.mock("@/stores/update", () => ({
  useUpdateStore: { getState: () => ({ _onChanged: fake.update }) },
}))

import { subscribeBackendEvents } from "./events"

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((yes) => {
    resolve = yes
  })
  return { promise, resolve }
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe("后端事件订阅", () => {
  it("部分订阅失败时，等待仍在注册的监听并清理全部已成功订阅", async () => {
    const late = deferred<() => void>()
    const error = { id: "internal", params: { detail: "listener unavailable" } }
    const offs = Array.from({ length: 11 }, () => vi.fn())
    let index = 0
    fake.listen.mockImplementation((event: string) => {
      if (event === "guard://changed") return Promise.reject(error)
      if (event === "activity://new") return late.promise
      return Promise.resolve(offs[index++])
    })
    const result = subscribeBackendEvents().catch((failure: unknown) => failure)
    await Promise.resolve()
    expect(offs.every((off) => off.mock.calls.length === 0)).toBe(true)
    late.resolve(offs[10])
    await expect(result).resolves.toBe(error)
    for (const off of offs) expect(off).toHaveBeenCalledTimes(1)
  })

  it("失败后可重新订阅，事件仍传给 store，关闭时释放这一轮所有监听", async () => {
    const failedOffs = Array.from({ length: 11 }, () => vi.fn())
    let index = 0
    fake.listen.mockImplementation((event: string) =>
      event === "guard://changed"
        ? Promise.reject(new Error("registration failed"))
        : Promise.resolve(failedOffs[index++])
    )
    await expect(subscribeBackendEvents()).rejects.toThrow(
      "registration failed"
    )

    const handlers = new Map<string, (event: { payload: unknown }) => void>()
    const activeOffs: ReturnType<typeof vi.fn>[] = []
    fake.listen.mockImplementation(
      (event: string, handler: (event: { payload: unknown }) => void) => {
        handlers.set(event, handler)
        const off = vi.fn()
        activeOffs.push(off)
        return Promise.resolve(off)
      }
    )
    const unsubscribe = await subscribeBackendEvents()
    const connection = { testId: "fixture", status: "ok" }
    const statuses = [{ envId: "windows", state: "active" }]
    handlers.get("connection://tested")!({ payload: connection })
    const status = { state: "available", currentVersion: "0.1.0", version: "0.2.0" }
    handlers.get("guard://changed")!({ payload: { statuses } })
    handlers.get("update://changed")!({ payload: { status } })
    expect(fake.connection).toHaveBeenCalledExactlyOnceWith(connection)
    expect(fake.guard).toHaveBeenCalledExactlyOnceWith(statuses)
    expect(fake.update).toHaveBeenCalledExactlyOnceWith(status)
    expect(activeOffs).toHaveLength(12)
    unsubscribe()
    for (const off of [...failedOffs, ...activeOffs])
      expect(off).toHaveBeenCalledTimes(1)
  })
})
