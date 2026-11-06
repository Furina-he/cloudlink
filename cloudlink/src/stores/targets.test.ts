import { describe, expect, it, vi } from "vitest"

import type { Environment } from "@/bindings"

vi.mock("@/lib/ipc", () => ({ ipc: {}, toIpcError: (error: unknown) => error }))

import { selectTargetsKnown } from "./targets"

const windows = { id: "windows", available: true } as Environment

describe("selectTargetsKnown", () => {
  it("第一次检测完成之前不知道有没有 Agent，界面不写「没有启用的 Agent」", () => {
    expect(selectTargetsKnown({ status: "idle", environments: [] })).toBe(false)
    expect(selectTargetsKnown({ status: "loading", environments: [] })).toBe(false)
    // 检测失败时顶部的加载错误已经说明原因
    expect(selectTargetsKnown({ status: "error", environments: [] })).toBe(false)
  })

  it("检测完成后才确定；重新检测期间沿用上一次的结果，不闪烁", () => {
    expect(selectTargetsKnown({ status: "ready", environments: [] })).toBe(true)
    expect(selectTargetsKnown({ status: "ready", environments: [windows] })).toBe(true)
    expect(selectTargetsKnown({ status: "loading", environments: [windows] })).toBe(true)
  })
})
