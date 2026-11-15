import { beforeEach, describe, expect, it, vi } from "vitest"

import type { ExecutionRequest, RuntimeStatus } from "@/bindings"

const fake = vi.hoisted(() => ({ runtime: vi.fn(), list: vi.fn(), respond: vi.fn(), cancel: vi.fn() }))
vi.mock("@/lib/ipc", () => ({ ipc: { getRuntimeStatus: fake.runtime, listExecutionRequests: fake.list, respondExecution: fake.respond, cancelExecution: fake.cancel }, toIpcError: (error: unknown) => error }))
import { useExecutionStore } from "./execution"

let epoch = ""
let sequence = 0
const request = (revision = 1, state: ExecutionRequest["state"] = "waiting"): ExecutionRequest => ({ requestId: "req_1", epoch, revision, policyRevision: 1, assetId: "asset_1", envId: "windows", kind: "exec", source: "unidentified", command: "docker compose down -v", cwd: "D:/fixture", state, checked: true, approvalRequired: true, createdAt: "2026-11-15T00:00:00Z", expiresAt: "2026-11-15T00:05:00Z" })
const runtime = (revision = 1): RuntimeStatus => ({ state: "active", epoch, revision, checkedAt: "2026-11-15T00:00:00Z" })
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((yes) => { resolve = yes }); return { promise, resolve } }

beforeEach(() => {
  epoch = `execution-test-${++sequence}`
  vi.clearAllMocks()
  useExecutionStore.getState().reset()
  useExecutionStore.setState({ runtime: null, epoch: null, revision: 0, status: "idle", error: null })
  fake.runtime.mockResolvedValue(runtime())
  fake.list.mockResolvedValue([request()])
})

describe("单次审批快照", () => {
  it("从最新请求构造 expectedRevision，忙碌时不重复批准", async () => {
    await useExecutionStore.getState().load()
    const later = deferred<ExecutionRequest>()
    fake.respond.mockReturnValueOnce(later.promise)
    const first = useExecutionStore.getState().respond("req_1", "allow-once")
    await useExecutionStore.getState().respond("req_1", "allow-once")
    expect(fake.respond).toHaveBeenCalledExactlyOnceWith({ requestId: "req_1", expectedRevision: 1, decision: "allow-once" })
    later.resolve(request(2, "approved")); await first
    expect(useExecutionStore.getState().requests[0].state).toBe("approved")
  })

  it("批准响应推进全局revision，旧的空快照不能把卡片删除", async () => {
    await useExecutionStore.getState().load()
    fake.respond.mockResolvedValueOnce(request(5, "approved"))
    await useExecutionStore.getState().respond("req_1", "allow-once")
    useExecutionStore.getState()._onChanged({ epoch, revision: 3, requests: [] })
    expect(useExecutionStore.getState().requests[0]?.state).toBe("approved")
    expect(useExecutionStore.getState().revision).toBe(5)
  })

  it("删除/重置后的新空快照不被迟到批准重新创建请求", async () => {
    await useExecutionStore.getState().load()
    const later = deferred<ExecutionRequest>(); fake.respond.mockReturnValueOnce(later.promise)
    const answering = useExecutionStore.getState().respond("req_1", "allow-once")
    useExecutionStore.getState()._onChanged({ epoch, revision: 6, requests: [] })
    later.resolve(request(5, "approved")); await answering
    expect(useExecutionStore.getState().requests).toEqual([])
  })

  it("界面重置也使尚未返回的动作失效", async () => {
    await useExecutionStore.getState().load()
    const later = deferred<ExecutionRequest>(); fake.respond.mockReturnValueOnce(later.promise)
    const answering = useExecutionStore.getState().respond("req_1", "allow-once")
    useExecutionStore.getState().reset()
    later.resolve(request(2, "approved")); await answering
    expect(useExecutionStore.getState().requests).toEqual([])
  })

  it("晚到waiting和旧epoch事件不能覆盖取消或新会话", async () => {
    await useExecutionStore.getState().load()
    useExecutionStore.getState()._onChanged({ epoch, revision: 4, requests: [request(4, "cancelled")] })
    useExecutionStore.getState()._onChanged({ epoch, revision: 3, requests: [request(3)] })
    expect(useExecutionStore.getState().requests[0].state).toBe("cancelled")
    const old = epoch; epoch = `${epoch}-next`
    useExecutionStore.getState()._onRuntime(runtime())
    useExecutionStore.getState()._onChanged({ epoch: old, revision: 20, requests: [] })
    expect(useExecutionStore.getState().epoch).toBe(epoch)
    expect(useExecutionStore.getState().requests).toEqual([])
  })

  it("列表加载落后于事件时保留更晚的事件快照", async () => {
    const later = deferred<ExecutionRequest[]>(); fake.list.mockReturnValueOnce(later.promise)
    const loading = useExecutionStore.getState().load()
    await Promise.resolve()
    useExecutionStore.getState()._onChanged({ epoch, revision: 4, requests: [request(4, "running")] })
    later.resolve([request()]); await loading
    expect(useExecutionStore.getState().requests[0].state).toBe("running")
  })

  it("过期答复失败只刷新状态，不重发或代跑命令", async () => {
    await useExecutionStore.getState().load()
    fake.respond.mockRejectedValueOnce({ id: "execution-stale" })
    fake.runtime.mockResolvedValueOnce(runtime(3)); fake.list.mockResolvedValueOnce([request(3, "expired")])
    await useExecutionStore.getState().respond("req_1", "allow-once")
    expect(fake.respond).toHaveBeenCalledOnce()
    expect(useExecutionStore.getState().requests[0].state).toBe("expired")
    expect(useExecutionStore.getState().errorsById.req_1?.id).toBe("execution-stale")
  })

  it("通知定位不调用批准或取消", async () => {
    await useExecutionStore.getState().load()
    useExecutionStore.getState().focus("req_1")
    expect(fake.respond).not.toHaveBeenCalled(); expect(fake.cancel).not.toHaveBeenCalled()
    expect(useExecutionStore.getState().focusId).toBe("req_1")
  })
})
