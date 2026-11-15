import { beforeEach, describe, expect, it, vi } from "vitest"

import type { ConnectionTestRequest } from "@/bindings"

const fake = vi.hoisted(() => ({
  test: vi.fn(),
  cancel: vi.fn(),
  trust: vi.fn(),
  refresh: vi.fn(),
}))

vi.mock("@/lib/ipc", () => ({
  ipc: {
    testConnection: fake.test,
    cancelConnectionTest: fake.cancel,
    trustHostKey: fake.trust,
  },
  toIpcError: (error: unknown) => error,
}))
vi.mock("./assets", () => ({
  useAssetStore: { getState: () => ({ refresh: fake.refresh }) },
}))

import {
  announceTest,
  connectionSignature,
  useConnectionStore,
} from "./connection"

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

const request = (host = "127.0.0.1"): ConnectionTestRequest => ({
  connection: {
    source: "managed",
    sshAlias: "test-vps",
    host,
    port: 2222,
    user: "tester",
    auth: { method: "agent", identityFile: {} },
    proxyJump: null,
    definedIn: ["windows"],
  },
})

const state = useConnectionStore.getState

beforeEach(() => {
  for (const key of Object.keys(state().testsByKey)) state().clear(key)
  vi.resetAllMocks()
  fake.test.mockResolvedValue({ testId: "test" })
  fake.cancel.mockResolvedValue(undefined)
  fake.trust.mockResolvedValue(undefined)
  fake.refresh.mockResolvedValue(undefined)
})

describe("测试连接的 IPC 请求与事件顺序", () => {
  it("invoke 返回前取消立即结束等待，拿到 ID 后补发取消，迟到结果不恢复成功", async () => {
    const start = deferred<{ testId: string }>()
    fake.test.mockReturnValue(start.promise)
    const task = state().test("new", request())
    const result = state().waitForResult("new")
    await state().cancel("new")
    expect(state().testsByKey.new.status).toBe("cancelled")
    await expect(result).resolves.toBe("cancelled")
    expect(fake.cancel).not.toHaveBeenCalled()

    state()._onTested({ testId: "late", status: "ok" })
    start.resolve({ testId: "late" })
    await task
    expect(fake.cancel).toHaveBeenCalledExactlyOnceWith("late")
    expect(state().testsByKey.new.status).toBe("cancelled")
  })

  it("关闭再打开表单后，旧请求不能把旧 testId 绑定到新地址", async () => {
    const first = deferred<{ testId: string }>()
    const second = deferred<{ testId: string }>()
    fake.test
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const oldTask = state().test("new", request())
    const oldResult = state().waitForResult("new")
    state().clear("new")
    const newRequest = request("127.0.0.2")
    const newTask = state().test("new", newRequest)
    const newResult = state().waitForResult("new")
    await expect(oldResult).resolves.toBe("cancelled")

    first.resolve({ testId: "old" })
    await oldTask
    state()._onTested({ testId: "old", status: "ok" })
    second.resolve({ testId: "new" })
    await newTask
    expect(fake.cancel).toHaveBeenCalledWith("old")
    expect(state().testsByKey.new).toMatchObject({
      testId: "new",
      status: "running",
      signature: connectionSignature(newRequest.connection),
    })
    state()._onTested({ testId: "new", status: "ok" })
    await expect(newResult).resolves.toBe("ok")
  })

  it("重试成功后，旧 invoke 的拒绝不能覆盖新结果", async () => {
    const first = deferred<{ testId: string }>()
    fake.test
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({ testId: "new" })
    const oldTask = state().test("new", request())
    const oldResult = state().waitForResult("new")
    await state().test("new", request())
    state()._onTested({ testId: "new", status: "ok" })
    first.reject({ id: "not-found" })
    await oldTask
    await expect(oldResult).resolves.toBe("cancelled")
    expect(state().testsByKey.new).toMatchObject({
      testId: "new",
      status: "ok",
    })
  })

  it("invoke 直接拒绝时，无 testId 的失败也结束新建流水线等待", async () => {
    fake.test.mockRejectedValue({ id: "connection-failed" })
    const task = state().test("new", request())
    const result = state().waitForResult("new")
    await task
    expect(state().testsByKey.new).toMatchObject({
      testId: null,
      status: "failed",
    })
    await expect(result).resolves.toBe("failed")
    await expect(state().waitForResult("new")).resolves.toBe("failed")
  })

  it("列表测试的 invoke 拒绝播报一次带别名的失败，随后测试不复用旧播报", async () => {
    const notify = vi.fn()
    fake.test.mockRejectedValueOnce({
      id: "internal",
      params: { message: "fixture rejection" },
    })
    announceTest("saved", notify)
    await state().test("saved", request())
    expect(notify).toHaveBeenCalledExactlyOnceWith({
      status: "failed",
      error: {
        id: "unknown",
        params: { alias: "test-vps", message: "fixture rejection" },
      },
    })
    expect(fake.refresh).not.toHaveBeenCalled()

    await state().test("saved", request())
    state()._onTested({ testId: "test", status: "ok" })
    expect(notify).toHaveBeenCalledTimes(1)
    expect(fake.refresh).toHaveBeenCalledTimes(1)
  })

  it("旧 invoke 的拒绝不能消耗新测试的播报", async () => {
    const first = deferred<{ testId: string }>()
    const oldNotify = vi.fn()
    const newNotify = vi.fn()
    fake.test
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({ testId: "replacement" })
    announceTest("saved", oldNotify)
    const oldTask = state().test("saved", request())
    announceTest("saved", newNotify)
    await state().test("saved", request())
    first.reject({ id: "internal" })
    await oldTask
    expect(oldNotify).not.toHaveBeenCalled()
    expect(newNotify).not.toHaveBeenCalled()

    const event = { testId: "replacement", status: "ok" as const }
    state()._onTested(event)
    expect(newNotify).toHaveBeenCalledExactlyOnceWith(event)
    expect(oldNotify).not.toHaveBeenCalled()
  })

  it("清除表单结束等待，迟到拒绝不重新创建已关闭表单的状态", async () => {
    const start = deferred<{ testId: string }>()
    fake.test.mockReturnValue(start.promise)
    const task = state().test("new", request())
    const result = state().waitForResult("new")
    state().clear("new")
    await expect(result).resolves.toBe("cancelled")
    start.reject({ id: "not-found" })
    await task
    expect(state().testsByKey.new).toBeUndefined()
    await expect(state().waitForResult("new")).resolves.toBe("cancelled")
  })

  it("已知 ID 的测试取消后，迟到主机指纹和成功事件都不能重新打开确认或播报成功", async () => {
    const notify = vi.fn()
    announceTest("saved", notify)
    await state().test("saved", request())
    await state().cancel("saved")
    state()._onTested({
      testId: "test",
      status: "host-key",
      hostKey: { fingerprint: "SHA256:late", known: "new" },
    })
    state()._onTested({ testId: "test", status: "ok" })
    expect(state().testsByKey.saved).toMatchObject({
      status: "cancelled",
      hostKey: undefined,
    })
    expect(notify).not.toHaveBeenCalled()
    expect(fake.refresh).not.toHaveBeenCalled()
  })

  it("早到的成功事件同样播报并刷新已保存资源，而且只处理一次", async () => {
    const start = deferred<{ testId: string }>()
    const notify = vi.fn()
    fake.test.mockReturnValue(start.promise)
    announceTest("saved", notify)
    const task = state().test("saved", request())
    const event = {
      testId: "early",
      status: "ok" as const,
      remoteOs: "Ubuntu 24.04",
    }
    state()._onTested(event)
    start.resolve({ testId: "early" })
    await task
    state()._onTested(event)
    expect(state().testsByKey.saved).toMatchObject(event)
    expect(notify).toHaveBeenCalledExactlyOnceWith(event)
    expect(fake.refresh).toHaveBeenCalledTimes(1)
  })

  it("早到指纹保留在同一次测试中，信任后等待最终结果", async () => {
    const start = deferred<{ testId: string }>()
    fake.test.mockReturnValue(start.promise)
    const task = state().test("new", request())
    const result = state().waitForResult("new")
    state()._onTested({
      testId: "early",
      status: "host-key",
      hostKey: { fingerprint: "SHA256:fixture", known: "new" },
    })
    start.resolve({ testId: "early" })
    await task
    expect(state().testsByKey.new.status).toBe("host-key")
    await state().trustHostKey("new")
    expect(fake.trust).toHaveBeenCalledExactlyOnceWith(
      "early",
      "SHA256:fixture"
    )
    expect(state().testsByKey.new.status).toBe("running")
    state()._onTested({ testId: "early", status: "ok" })
    await expect(result).resolves.toBe("ok")
  })

  it("信任指纹请求拒绝时退出运行中，流水线可以重新测试", async () => {
    const error = { id: "not-found" }
    fake.trust.mockRejectedValue(error)
    await state().test("new", request())
    state()._onTested({
      testId: "test",
      status: "host-key",
      hostKey: { fingerprint: "SHA256:expired", known: "new" },
    })
    const result = state().waitForResult("new")
    await expect(state().trustHostKey("new")).rejects.toEqual(error)
    expect(state().testsByKey.new).toMatchObject({
      status: "failed",
      hostKey: undefined,
    })
    await expect(result).resolves.toBe("failed")
  })

  it("过期的信任请求拒绝不能影响新测试，替换时取消旧任务", async () => {
    const trust = deferred<void>()
    fake.trust.mockReturnValue(trust.promise)
    await state().test("new", request())
    state()._onTested({
      testId: "test",
      status: "host-key",
      hostKey: { fingerprint: "SHA256:old", known: "new" },
    })
    const trusting = state().trustHostKey("new")
    fake.test.mockResolvedValue({ testId: "new" })
    await state().test("new", request())
    trust.reject({ id: "not-found" })
    await trusting
    expect(fake.cancel).toHaveBeenCalledExactlyOnceWith("test")
    expect(state().testsByKey.new).toMatchObject({
      testId: "new",
      status: "running",
    })
  })

  it("关闭指纹确认所在表单会取消已知任务并清理播报", async () => {
    const notify = vi.fn()
    announceTest("new", notify)
    await state().test("new", request())
    state()._onTested({
      testId: "test",
      status: "host-key",
      hostKey: { fingerprint: "SHA256:fixture", known: "new" },
    })
    state().clear("new")
    expect(fake.cancel).toHaveBeenCalledExactlyOnceWith("test")
    fake.test.mockResolvedValue({ testId: "replacement" })
    await state().test("new", request())
    state()._onTested({ testId: "replacement", status: "ok" })
    expect(notify).not.toHaveBeenCalled()
  })
})
