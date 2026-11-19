import { beforeEach, describe, expect, it, vi } from "vitest"

const fake = vi.hoisted(() => ({
  listen: vi.fn(),
  connection: vi.fn(),
  setup: vi.fn(),
  guard: vi.fn(),
  update: vi.fn(),
  execution: vi.fn(), runtime: vi.fn(), focus: vi.fn(), view: vi.fn(),
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
vi.mock("@/stores/cli", () => ({
  useCliStore: { getState: () => ({ _onSetupChanged: fake.setup }) },
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
vi.mock("@/stores/execution", () => ({
  useExecutionStore: { getState: () => ({ _onChanged: fake.execution, _onRuntime: fake.runtime, focus: fake.focus }) },
}))
vi.mock("@/stores/ui", () => ({ useUIStore: { getState: () => ({ setView: fake.view }) } }))

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
    const offs: ReturnType<typeof vi.fn>[] = []
    const lateOff = vi.fn()
    fake.listen.mockImplementation((event: string) => {
      if (event === "guard://changed") return Promise.reject(error)
      const off = event === "activity://new" ? lateOff : vi.fn()
      offs.push(off)
      return event === "activity://new" ? late.promise : Promise.resolve(off)
    })
    const result = subscribeBackendEvents().catch((failure: unknown) => failure)
    await Promise.resolve()
    expect(offs.every((off) => off.mock.calls.length === 0)).toBe(true)
    late.resolve(lateOff)
    await expect(result).resolves.toBe(error)
    for (const off of offs) expect(off).toHaveBeenCalledTimes(1)
  })

  it("失败后可重新订阅，事件仍传给 store，关闭时释放这一轮所有监听", async () => {
    const failedOffs: ReturnType<typeof vi.fn>[] = []
    fake.listen.mockImplementation((event: string) => {
      if (event === "guard://changed") return Promise.reject(new Error("registration failed"))
      const off = vi.fn(); failedOffs.push(off)
      return Promise.resolve(off)
    })
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
    const setup = { id: "setup_fixture", provider: "cloudflare", envId: "windows", state: "waiting-login" }
    handlers.get("cli-setup://changed")!({ payload: setup })
    expect(fake.connection).toHaveBeenCalledExactlyOnceWith(connection)
    expect(fake.guard).toHaveBeenCalledExactlyOnceWith(statuses)
    expect(fake.update).toHaveBeenCalledExactlyOnceWith(status)
    expect(fake.setup).toHaveBeenCalledExactlyOnceWith(setup)
    const execution = { epoch: "fixture", revision: 1, requests: [] }
    const runtime = { epoch: "fixture", revision: 1, state: "active", checkedAt: "2026-11-15T00:00:00Z" }
    handlers.get("execution://changed")!({ payload: execution })
    handlers.get("runtime://changed")!({ payload: { status: runtime } })
    handlers.get("execution://focus")!({ payload: { requestId: "req_fixture" } })
    expect(fake.execution).toHaveBeenCalledExactlyOnceWith(execution)
    expect(fake.runtime).toHaveBeenCalledExactlyOnceWith(runtime)
    expect(fake.focus).toHaveBeenCalledExactlyOnceWith("req_fixture")
    expect(fake.view).toHaveBeenCalledExactlyOnceWith("activity")
    expect(activeOffs).toHaveLength(16)
    unsubscribe()
    for (const off of [...failedOffs, ...activeOffs])
      expect(off).toHaveBeenCalledTimes(1)
  })
})
