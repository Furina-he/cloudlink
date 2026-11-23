import { describe, expect, it } from "vitest"

import { invocationChannel, invocationName } from "./InvocationAvatar"

describe("实际调用来源与检查通道", () => {
  it("只有明确的 Claude Code hook 协议来源显示该品牌", () => {
    expect(invocationName({ agent: "claude-code", provenance: "hook" })).toBe("Claude Code")
    expect(invocationName({ agent: "codex", provenance: "hook" })).toBe("未知来源")
  })

  it.each([
    ["claude-code", "Claude Code（自报）"],
    ["antigravity", "Antigravity（自报）"],
    ["codex", "Codex（自报）"],
    ["cursor", "Cursor（自报）"],
  ] as const)("%s 的 runner 元数据明确标记自报", (agent, name) => {
    expect(invocationName({ agent, provenance: "self-reported" })).toBe(name)
  })

  it("未知和历史缺失来源不根据 hook 或分发目录猜品牌", () => {
    expect(invocationName()).toBe("未知来源")
    expect(invocationName({ provenance: "unknown" })).toBe("未知来源")
    expect(invocationName({ agent: "claude-code", provenance: "unknown" })).toBe("未知来源")
    expect(invocationChannel("hook")).toBe("直连护栏")
    expect(invocationChannel("runner")).toBe("CloudLink 执行入口")
    expect(invocationChannel()).toBe("未知检查通道")
  })
})
