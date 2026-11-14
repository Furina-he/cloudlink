import { describe, expect, it } from "vitest"
import type { CompileStatus, Delivery, Inclusion, Target } from "@/bindings"
import { countDeliveredForAsset, deliveryOutcome, sharingKeys, targetSyncOutcome } from "./deliveryFeedback"

const target = (id: string, agentKey = id): Target => ({ id, envId: "windows", agent: "custom", agentKey, label: id, path: `C:\\test\\${id}`, enabled: true, detected: true })
const inclusion = (t: Target, included = true): Inclusion => ({ assetId: "asset", envId: t.envId, agentKey: t.agentKey, included })
const delivery = (t: Target, status: Delivery["status"] = "ok", unitId = t.id): Delivery => ({ id: `d-${t.id}`, targetId: t.id, envId: t.envId, path: `${t.path}\\cloudlink-servers`, status, unitId, checkedAt: "2026-11-13T00:00:00Z" })
const blocked = (t: Target): CompileStatus => ({ envId: t.envId, agentKey: t.agentKey, blocked: true, compiledAt: null, errors: 1, warnings: 0, lint: [] })

describe("P8 真实送达反馈", () => {
  it("仅选择或列入不算已同步，失败副本不算，受阻旧副本也不算", () => {
    const t = target("one"), inc = [inclusion(t)]
    expect(countDeliveredForAsset("asset", inc, [], [t])).toBe(0)
    expect(countDeliveredForAsset("asset", inc, [delivery(t, "conflict")], [t])).toBe(0)
    expect(countDeliveredForAsset("asset", inc, [delivery(t)], [t], [blocked(t)])).toBe(0)
    expect(countDeliveredForAsset("asset", inc, [delivery(t)], [t])).toBe(1)
    expect(countDeliveredForAsset("asset", inc, [delivery(t)], [{ ...t, enabled: false }])).toBe(0)
  })

  it("同一物理目录只计一个，跨环境共用不另计一份", () => {
    const a = target("common"), b = target("trae"), wsl = { ...target("wsl"), envId: "wsl:Ubuntu" as const }
    const ds = [delivery(a, "ok", "unit"), delivery(b, "ok", "unit"), { ...delivery(wsl, "shared", "unit"), statusDetail: { id: "shared-windows" } }]
    expect(countDeliveredForAsset("asset", [a, b, wsl].map((t) => inclusion(t)), ds, [a, b, wsl])).toBe(1)
    const outcome = deliveryOutcome("asset", [a.agentKey, b.agentKey, wsl.agentKey], true, { inclusions: [a, b, wsl].map((t) => inclusion(t)), deliveries: ds, statuses: [] }, [a, b, wsl])
    expect(outcome.complete).toBe(false)
    expect(outcome.problems.map((p) => p.id)).toEqual(["shared-windows"])
  })

  it("共用状态说明不等于同步失败；选择不一致仍明确提示", () => {
    const a = target("a"), b = target("b")
    const d = { ...delivery(a), sharedAgentKeys: ["a", "b"], statusDetail: { id: "shared-directory" } }
    const snapshot = { inclusions: [inclusion(a)], deliveries: [d], statuses: [] }
    expect(deliveryOutcome("asset", ["a"], true, snapshot, [a]).complete).toBe(true)
    expect(sharingKeys("a", [d])).toEqual(["a", "b"])
    expect(targetSyncOutcome([a], snapshot).problems).toEqual([])
    const mismatch = { ...d, status: "missing" as const, statusDetail: { id: "shared-selection-mismatch" } }
    expect(deliveryOutcome("asset", ["a"], true, { ...snapshot, deliveries: [mismatch] }, [a, b]).problems[0].id).toBe("shared-selection-mismatch")
  })

  it("未列入、写入失败和部分成功分别反馈", () => {
    const a = target("a"), b = target("b"), c = target("c")
    const snapshot = { inclusions: [inclusion(a), { ...inclusion(b, false), reason: { id: "no-key-in-env" as const } }, inclusion(c)], deliveries: [delivery(a), delivery(b), { ...delivery(c, "broken"), statusDetail: { id: "path-unavailable" } }], statuses: [] }
    const outcome = deliveryOutcome("asset", ["a", "b", "c"], true, snapshot, [a, b, c])
    expect(outcome.count).toBe(1)
    expect(outcome.complete).toBe(false)
    expect(outcome.problems.map((p) => p.id)).toEqual(["no-key-in-env", "path-unavailable"])
  })

  it("撤回只需从副本移除这项资源，共用副本仍供其他资源或成员使用", () => {
    const a = target("a")
    const snapshot = { inclusions: [inclusion(a, false)], deliveries: [delivery(a)], statuses: [] }
    expect(deliveryOutcome("asset", ["a"], false, snapshot, [a]).complete).toBe(true)
    expect(deliveryOutcome("asset", ["a"], false, { ...snapshot, inclusions: [inclusion(a)] }, [a]).problems[0].id).toBe("withdraw-failed")
    expect(deliveryOutcome("asset", ["a"], false, { ...snapshot, deliveries: [delivery(a, "broken")] }, [a]).complete).toBe(false)
  })

  it("没有已启用目标不能宣称成功；空资源启用不宣称已有副本", () => {
    const a = target("a"), empty = { inclusions: [], deliveries: [], statuses: [] }
    expect(deliveryOutcome("asset", ["a"], true, empty, []).complete).toBe(false)
    expect(targetSyncOutcome([a], empty)).toEqual({ resources: 0, problems: [] })
    expect(targetSyncOutcome([a], { ...empty, statuses: [blocked(a)] }).problems[0].id).toBe("compile-blocked")
  })
})
