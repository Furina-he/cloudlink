import { describe, expect, it } from "vitest"

import type { Target } from "@/bindings"
import * as fx from "@/mocks/fixtures"
import { lensAgentsFor } from "./agents"

const target = (id: string) => fx.targets.find((t) => t.id === id)!

describe("「以此视角查看」可选的 Agent（F-306）", () => {
  it("全局目标只有它自己的 Agent", () => {
    expect(lensAgentsFor(target("tgt_cc_win"), fx.targets)).toEqual(["claude-code"])
  })

  it("WSL 项目：检测到的通用 .agents，加上 .claude 的代表 Claude Code", () => {
    // WSL 下只有通用 .agents 的全局目标；Windows 的 Claude Code 全局不算
    expect(lensAgentsFor(target("tgt_openpet"), fx.targets)).toEqual(["claude-code", "universal"])
  })

  it("只启用 .claude 的项目不列出读 .agents 的 Agent", () => {
    expect(lensAgentsFor(target("tgt_blog"), fx.targets)).toEqual(["claude-code"])
  })

  it("同环境检测到多个读 .agents 的 Agent 时全部列出，不再补代表", () => {
    const cursor: Target = { id: "t_cursor", kind: "agent-global", envId: fx.WSL, agent: "cursor", label: "Cursor", path: "/home/me/.cursor/skills", linkMode: "auto" }
    const targets = fx.targets.filter((t) => t.id !== "tgt_agents_wsl").concat(cursor)
    expect(lensAgentsFor(target("tgt_openpet"), targets)).toEqual(["claude-code", "cursor"])
  })
})
