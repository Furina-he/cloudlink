import { describe, expect, it } from "vitest"

import type { SkillStatus } from "@/bindings"
import * as fx from "@/mocks/fixtures"
import { selectSkillRows, skillCompileState, type SkillRow } from "./skills"

const variant = (lint: SkillStatus["variants"][number]["lint"], blocked = false) => ({
  mode: "read-only" as const,
  lint,
  residentTokens: 80,
  blocked,
  compiledAt: null,
  path: "",
})

const row = (slug: string, assetId: string, v: SkillStatus["variants"], mounts: number, resident: number | null): SkillRow => ({
  skill: { id: `skl_${slug}`, slug, assetId, variants: v },
  asset: fx.assets.find((a) => a.id === assetId)!,
  mounts,
  resident,
})

const rows = [
  row("vps-hk-edge", "ast_hk_edge", [variant([])], 3, 86),
  row("vps-sg-db", "ast_sg_db", [variant([{ id: "probe-stale", level: "warning" }])], 2, 140),
  row("vps-dev-box", "ast_dev_box", [variant([{ id: "secret-detected", level: "error" }], true)], 2, null),
]

describe("Skills 视图（PRD 6.7）", () => {
  it("编译状态：受阻优先，其次警告", () => {
    expect(rows.map((r) => skillCompileState(r.skill))).toEqual(["ok", "warning", "blocked"])
  })

  it("按状态筛选，按名称或资产别名搜索", () => {
    expect(selectSkillRows(rows, "", "blocked", "slug").map((r) => r.skill.slug)).toEqual(["vps-dev-box"])
    expect(selectSkillRows(rows, "sg-db", "all", "slug").map((r) => r.skill.slug)).toEqual(["vps-sg-db"])
  })

  it("按挂载数、常驻 Token 排序；受阻的排在最后", () => {
    expect(selectSkillRows(rows, "", "all", "mounts").map((r) => r.skill.slug)).toEqual(["vps-hk-edge", "vps-dev-box", "vps-sg-db"])
    expect(selectSkillRows(rows, "", "all", "tokens").map((r) => r.skill.slug)).toEqual(["vps-sg-db", "vps-hk-edge", "vps-dev-box"])
  })
})
