import { describe, expect, it } from "vitest"

import * as fx from "@/mocks/fixtures"
import { collectValues, groupAssets, selectFilteredAssets } from "./assets"
import { DEFAULT_FILTER } from "./ui"

const state = {
  byId: Object.fromEntries(fx.assets.map((a) => [a.id, a])),
  ids: fx.assets.map((a) => a.id),
}
const idsOf = (filter: Partial<typeof DEFAULT_FILTER>) =>
  selectFilteredAssets(state, { ...DEFAULT_FILTER, ...filter }).map((a) => a.id)

describe("资产列表（PRD 6.4）", () => {
  it("按生产、预发、开发分组，空组不出现", () => {
    const groups = groupAssets(fx.assets, "name")
    expect(groups.map((g) => g.env)).toEqual(["prod", "dev"])
    expect(groups[0].assets.map((a) => a.id).sort()).toEqual(["ast_hk_edge", "ast_sg_db"])
  })

  it("按最近探测排序：最近的在前", () => {
    expect(groupAssets(fx.assets, "probed")[0].assets.map((a) => a.id)).toEqual(["ast_hk_edge", "ast_sg_db"])
  })

  it("搜索匹配名称、slug、别名、标签，不区分大小写；可按环境筛选", () => {
    expect(idsOf({ query: "1panel" })).toEqual(["ast_hk_edge"])
    expect(idsOf({ query: "DEV-BOX" })).toEqual(["ast_dev_box"])
    expect(idsOf({ envTags: ["dev"] })).toEqual(["ast_dev_box"])
    expect(idsOf({ types: ["domain"] })).toEqual([])
  })

  it("候选值去重、排序，跳过空值", () => {
    expect(collectValues(fx.assets, (a) => [a.provider])).toEqual(["AWS Lightsail", "Tencent Cloud"])
    expect(collectValues(fx.assets, (a) => a.tags)).toEqual(["1panel", "db", "edge"])
  })
})
