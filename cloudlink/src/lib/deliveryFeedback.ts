// 选择、列入、编译与物理副本不是同一个状态。仅当前成功副本能算已同步（P8a）。
import type { CompileStatus, Delivery, Inclusion, Target } from "@/bindings"
import { copy } from "@/lib/copy"

export interface DeliverySnapshot {
  inclusions: Inclusion[]
  deliveries: Delivery[]
  statuses: CompileStatus[]
}
export interface DeliveryProblem {
  target: Target
  id: string
  params?: Record<string, string | number>
}

export function countDeliveredForAsset(assetId: string, inclusions: Inclusion[], deliveries: Delivery[], targets: Target[], statuses: CompileStatus[] = []): number {
  const units = new Set<string>()
  for (const target of targets.filter((t) => t.enabled)) {
    const included = inclusions.some((i) => i.assetId === assetId && i.envId === target.envId && i.agentKey === target.agentKey && i.included)
    const blocked = statuses.some((s) => s.envId === target.envId && s.agentKey === target.agentKey && s.blocked)
    const d = deliveries.find((d) => d.targetId === target.id)
    if (included && !blocked && d?.status === "ok") units.add(d.unitId ?? `${d.envId}|${d.targetId}`)
  }
  return units.size
}

export function deliveryOutcome(assetId: string, agentKeys: string[], on: boolean, snapshot: DeliverySnapshot, targets: Target[]) {
  const intended = targets.filter((t) => t.enabled && agentKeys.includes(t.agentKey))
  const problems: DeliveryProblem[] = []
  for (const target of intended) {
    const d = snapshot.deliveries.find((d) => d.targetId === target.id)
    const inc = snapshot.inclusions.find((i) => i.assetId === assetId && i.envId === target.envId && i.agentKey === target.agentKey)
    const blocked = snapshot.statuses.some((s) => s.envId === target.envId && s.agentKey === target.agentKey && s.blocked)
    let id: string | undefined, params: DeliveryProblem["params"]
    if (d?.statusDetail?.id === "shared-selection-mismatch") { id = d.statusDetail.id; params = d.statusDetail.params }
    else if (d && d.status !== "ok" && !(!on && ["missing", "shared"].includes(d.status))) { id = d.statusDetail?.id ?? d.status; params = d.statusDetail?.params }
    else if (!on && inc?.included) id = "withdraw-failed"
    else if (on && blocked) id = "compile-blocked"
    else if (on && !inc?.included) { id = inc?.reason?.id ?? "not-included"; params = inc?.reason?.params }
    else if (on && !d) id = "missing"
    if (id) problems.push({ target, id, params })
  }
  const count = countDeliveredForAsset(assetId, snapshot.inclusions, snapshot.deliveries, intended, snapshot.statuses)
  return { count, problems, complete: intended.length > 0 && problems.length === 0 }
}

export function deliveryReasonText(id: string, params?: Record<string, string | number>): string {
  if (copy.deliveryFeedback.reasons[id]) return copy.deliveryFeedback.reasons[id]
  if (Object.hasOwn(copy.inclusionReason, id)) return copy.inclusionReason[id as keyof typeof copy.inclusionReason](params)
  return copy.deliveryFeedback.reasons.broken
}

export function deliveryProblemsText(problems: DeliveryProblem[]): string {
  return problems.map((p) => copy.deliveryFeedback.targetProblem(p.target.agent === "custom" ? p.target.label : copy.agent[p.target.agent], copy.env.short(p.target.envId), deliveryReasonText(p.id, p.params))).join("\n")
}

/** 启用目标也只能根据真实副本反馈；空 Skill 不冒充已同步。 */
export function targetSyncOutcome(targets: Target[], snapshot: DeliverySnapshot) {
  const problems: DeliveryProblem[] = []
  const resources = new Set<string>()
  for (const target of targets.filter((t) => t.enabled)) {
    const d = snapshot.deliveries.find((d) => d.targetId === target.id)
    const included = snapshot.inclusions.filter((i) => i.envId === target.envId && i.agentKey === target.agentKey && i.included)
    const blocked = snapshot.statuses.some((s) => s.envId === target.envId && s.agentKey === target.agentKey && s.blocked)
    const id = d?.statusDetail?.id === "shared-selection-mismatch" ? d.statusDetail.id
      : d && d.status !== "ok" && d.status !== "missing" ? d.statusDetail?.id ?? d.status
      : blocked ? "compile-blocked"
      : included.length && d?.status !== "ok" ? "missing" : undefined
    if (id) problems.push({ target, id, params: d?.statusDetail?.params })
    if (!blocked && d?.status === "ok") included.forEach((i) => resources.add(i.assetId))
  }
  return { resources: resources.size, problems }
}

/** 同一真实目录的信息只出现在已检测目标的提示里，不新增共享目录行。 */
export function sharingKeys(agentKey: string, deliveries: Delivery[]): string[] {
  return [...new Set(deliveries.filter((d) => d.sharedAgentKeys?.includes(agentKey)).flatMap((d) => d.sharedAgentKeys ?? []))]
}
