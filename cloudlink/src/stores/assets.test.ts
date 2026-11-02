import { describe, expect, it } from "vitest"

import type { Asset } from "@/bindings"
import * as fx from "@/mocks/fixtures"
import { collectValues, connState, selectCanDistribute, selectServerGroups, selectUnlockRemaining } from "./assets"

const byId = Object.fromEntries(fx.assets.map((a) => [a.id, a]))
const ids = fx.assets.map((a) => a.id)
const [hkEdge, sgDb, devBox] = ["ast_hk_edge", "ast_sg_db", "ast_dev_box"].map((id) => byId[id])

/** 在夹具上改连接或 Agent 字段 */
const withConn = (a: Asset, patch: Partial<Asset["connection"]>): Asset => ({ ...a, connection: { ...a.connection, ...patch } })
const withAgent = (a: Asset, patch: Partial<Asset["agent"]>): Asset => ({ ...a, agent: { ...a.agent, ...patch } })

describe("服务器列表（PRD 6.4）", () => {
  it("按生产、预发、开发分组，空组不出现", () => {
    const groups = selectServerGroups({ byId, ids }, "")
    expect(groups.map((g) => g.env)).toEqual(["prod", "dev"])
    expect(groups[0].assets.map((a) => a.id).sort()).toEqual(["ast_hk_edge", "ast_sg_db"])
  })

  it("组内按名称排序", () => {
    const named = (id: string, name: string) => ({ ...hkEdge, id, name })
    const list = [named("b", "Beta"), named("a", "Alpha"), named("c", "Gamma")]
    const groups = selectServerGroups({ byId: Object.fromEntries(list.map((a) => [a.id, a])), ids: list.map((a) => a.id) }, "")
    expect(groups[0].assets.map((a) => a.name)).toEqual(["Alpha", "Beta", "Gamma"])
  })

  it("搜索匹配名称、别名、标签、站点名，不区分大小写", () => {
    const idsOf = (q: string) => selectServerGroups({ byId, ids }, q).flatMap((g) => g.assets.map((a) => a.id))
    expect(idsOf("1PANEL")).toEqual(["ast_hk_edge"])
    expect(idsOf("dev-box")).toEqual(["ast_dev_box"])
    expect(idsOf("blog.example")).toEqual(["ast_hk_edge"])
    expect(idsOf("新加坡")).toEqual(["ast_sg_db"])
    expect(idsOf("nothing-like-this")).toEqual([])
  })

  it("候选值去重、排序，跳过空值", () => {
    expect(collectValues(fx.assets, (a) => [a.provider])).toEqual(["AWS Lightsail", "Tencent Cloud"])
    expect(collectValues(fx.assets, (a) => a.tags)).toEqual(["1panel", "db", "edge"])
  })
})

describe("分发开关能否打开（F-303 AC1）", () => {
  it("验证通过即可打开，imported 也一样", () => {
    expect(selectCanDistribute(hkEdge)).toEqual({ ok: true })
    expect(selectCanDistribute(sgDb)).toEqual({ ok: true })
  })

  it("只用密码时先说明原因，即使已经验证过", () => {
    expect(selectCanDistribute(devBox)).toEqual({ ok: false, reason: "password-only" })
    const verified = withConn(devBox, { verified: { ok: true, at: fx.ago(fx.MIN), envIds: ["windows"] } })
    expect(selectCanDistribute(verified)).toEqual({ ok: false, reason: "password-only" })
  })

  it("未验证、上次验证失败时不能打开", () => {
    expect(selectCanDistribute(withConn(hkEdge, { verified: null }))).toEqual({ ok: false, reason: "unverified" })
    const failed = withConn(hkEdge, { verified: { ok: false, at: fx.ago(fx.MIN), envIds: ["windows"] } })
    expect(selectCanDistribute(failed)).toEqual({ ok: false, reason: "failed" })
  })
})

describe("临时解锁的剩余时间（F-306 AC2）", () => {
  const now = Date.parse("2026-10-31T12:00:00Z")
  const until = (ms: number) => withAgent(hkEdge, { unlockedUntil: new Date(now + ms).toISOString() })

  it("未解锁时为 null", () => {
    expect(selectUnlockRemaining(hkEdge, now)).toBeNull()
  })

  it("剩余分钟数向上取整", () => {
    expect(selectUnlockRemaining(until(22.5 * fx.MIN), now)).toBe(23)
    expect(selectUnlockRemaining(until(30 * fx.MIN), now)).toBe(30)
    expect(selectUnlockRemaining(until(1000), now)).toBe(1)
  })

  it("时钟稍旧时也不超过 30 分钟", () => {
    expect(selectUnlockRemaining(until(30 * fx.MIN + 20_000), now)).toBe(30)
  })

  it("到期后为 null", () => {
    expect(selectUnlockRemaining(until(0), now)).toBeNull()
    expect(selectUnlockRemaining(until(-fx.MIN), now)).toBeNull()
  })
})

describe("连接状态（F-106 AC5）", () => {
  it("已连接、连接失败、未验证", () => {
    expect(connState(hkEdge)).toBe("connected")
    expect(connState(withConn(hkEdge, { verified: { ok: false, at: fx.ago(fx.MIN), envIds: ["windows"] } }))).toBe("failed")
    expect(connState(devBox)).toBe("unverified")
  })

  it("分发开着却没有验证结果：连接改过，需要重新测试", () => {
    expect(connState(withConn(hkEdge, { verified: null }))).toBe("changed")
  })
})
