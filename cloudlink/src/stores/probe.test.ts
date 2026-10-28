import { beforeEach, describe, expect, it } from "vitest"

import { isProbing, selectActiveRun, useProbeStore } from "./probe"

beforeEach(() => useProbeStore.setState({ runs: {}, activeRunByAsset: {} }))

describe("探测事件（载荷带 assetId）", () => {
  it("后端发起的探测（导入后立即探测）也能归到对应资产", () => {
    const s = useProbeStore.getState()
    s._onProgress({ runId: "r1", assetId: "a1", step: "resolve-alias", status: "running" })
    expect(isProbing(useProbeStore.getState(), "a1")).toBe(true)
    s._onProgress({ runId: "r1", assetId: "a1", step: "resolve-alias", status: "done", ms: 80 })
    s._onProgress({ runId: "r1", assetId: "a1", step: "connect", status: "running" })
    expect(selectActiveRun(useProbeStore.getState(), "a1")?.steps).toEqual([
      { step: "resolve-alias", status: "done", ms: 80 },
      { step: "connect", status: "running", ms: undefined },
    ])
  })

  it("结束后记录结果，不再算作探测中", () => {
    const s = useProbeStore.getState()
    s._onProgress({ runId: "r1", assetId: "a1", step: "connect", status: "error", ms: 300 })
    s._onFinished({
      runId: "r1",
      assetId: "a1",
      status: "failed",
      error: { id: "host-key-unknown", params: { alias: "x" } },
    })
    const run = selectActiveRun(useProbeStore.getState(), "a1")
    expect(run?.status).toBe("failed")
    expect(run?.error?.id).toBe("host-key-unknown")
    expect(isProbing(useProbeStore.getState(), "a1")).toBe(false)
  })

  it("先到的结束事件也能登记这次探测", () => {
    useProbeStore.getState()._onFinished({ runId: "r9", assetId: "a2", status: "cancelled" })
    expect(selectActiveRun(useProbeStore.getState(), "a2")?.status).toBe("cancelled")
  })
})
