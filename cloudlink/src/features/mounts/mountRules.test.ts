import { describe, expect, it } from "vitest"

import { copy } from "@/lib/copy"
import * as fx from "@/mocks/fixtures"
import { effectHints, mountChecks } from "./mountRules"

const asset = (id: string) => fx.assets.find((a) => a.id === id)!
const target = (id: string) => fx.targets.find((t) => t.id === id)!

describe("挂载前的确认（F-303 AC1、F-307）", () => {
  it("生产资产挂到全局目标要确认", () => {
    expect(mountChecks(asset("ast_hk_edge"), target("tgt_cc_win")).prodGlobal).toBe(true)
    expect(mountChecks(asset("ast_hk_edge"), target("tgt_openpet")).prodGlobal).toBe(false)
    expect(mountChecks(asset("ast_dev_box"), target("tgt_agents_wsl")).prodGlobal).toBe(false)
  })

  it("别名没有定义在目标所在的运行环境时要确认", () => {
    // sg-db 只在 WSL 定义
    expect(mountChecks(asset("ast_sg_db"), target("tgt_cc_win")).aliasMissing).toBe(true)
    expect(mountChecks(asset("ast_sg_db"), target("tgt_openpet")).aliasMissing).toBe(false)
  })
})

describe("挂载后的生效提示（F-303 AC4）", () => {
  it("按 Agent 给出提示；项目启用了两个约定目录时各一条", () => {
    expect(effectHints(target("tgt_cc_win"))).toEqual([copy.mountFlow.hintClaude])
    expect(effectHints(target("tgt_agents_wsl"))).toEqual([copy.mountFlow.hintCodex])
    expect(effectHints(target("tgt_openpet"))).toEqual([copy.mountFlow.hintClaude, copy.mountFlow.hintCodex])
    expect(effectHints(target("tgt_blog"))).toEqual([copy.mountFlow.hintClaude])
  })
})
