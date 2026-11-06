import { describe, expect, it, vi } from "vitest"

import type { Settings } from "@/bindings"

vi.mock("@/lib/ipc", () => ({ ipc: {}, toIpcError: (error: unknown) => error }))

import { selectSettingsKnown } from "./settings"

describe("selectSettingsKnown", () => {
  it("设置读到之前不画 Agent 开关：还不知道哪些运行环境被停用了", () => {
    expect(selectSettingsKnown({ settings: null })).toBe(false)
  })

  it("读到之后才确定；重新读取期间沿用上一次的值", () => {
    expect(selectSettingsKnown({ settings: { environments: [] } as unknown as Settings })).toBe(true)
  })
})
