// 资料草稿只修改用户编辑过的字段；后台采集的事实和最新连接始终以持久化资源为准。
import type { Asset, AssetInput, CliAsset, CliAssetInput, Service, ServerAsset, ServerAssetInput } from "@/bindings"
import type { CliFormValues, ServerFormValues } from "@/lib/schemas"
import { formValuesOf, serviceInputOf, toAssetInput } from "./serverForm"

export const cliValuesOf = (a: CliAsset): CliFormValues => structuredClone({ name: a.name, production: a.production, summary: a.summary, rules: a.guardrails.rules, notes: a.notes })

export function cliInputOf(v: CliFormValues, a: Pick<CliAsset, "id" | "cliProvider" | "account">): CliAssetInput {
  return { id: a.id, type: "cli", cliProvider: a.cliProvider, account: a.account, name: v.name.trim(), production: v.production, summary: v.summary, guardrails: { rules: v.rules }, notes: v.notes }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const changed = <T,>(before: T, draft: T, latest: T): T => same(before, draft) ? latest : draft
const serviceKey = (s: Service) => `${s.kind}|${s.name}`

/** 不覆盖重新探测得到的镜像、端口、来源、missing、采集时间，也不复活后台已经移除的记录。 */
function mergeServices(before: Service[], draft: Service[], latest: Service[]): Service[] {
  const old = new Map(before.map((s) => [serviceKey(s), s]))
  const current = new Map(latest.map((s) => [serviceKey(s), s]))
  const draftKeys = new Set(draft.map(serviceKey))
  const rows = draft.flatMap((s) => {
    const key = serviceKey(s), prior = old.get(key), now = current.get(key)
    // 打开时没有的同名服务可能刚被后台采集到：保留事实，只补草稿的人工标注。
    if (!prior) return now ? [{ ...now, role: s.role || now.role, critical: s.critical || now.critical }] : [s]
    if (!now) return []
    return [{
      ...now,
      role: changed(prior.role, s.role, now.role),
      critical: changed(prior.critical, s.critical, now.critical),
      // 人工记录仍可维护镜像和端口；已由采集接管的记录继续保留新事实。
      ...(prior.source === "manual" && now.source === "manual" ? { image: changed(prior.image, s.image, now.image), ports: changed(prior.ports, s.ports, now.ports) } : {}),
    }]
  })
  return [...rows, ...latest.filter((s) => !old.has(serviceKey(s)) && !draftKeys.has(serviceKey(s)))]
}

function mergePaths(before: ServerAsset["paths"], draft: ServerAsset["paths"], latest: ServerAsset["paths"]): ServerAsset["paths"] {
  const old = new Map(before.map((p) => [p.key, p]))
  const current = new Map(latest.map((p) => [p.key, p]))
  const draftKeys = new Set(draft.map((p) => p.key))
  const rows = draft.flatMap((p) => {
    const prior = old.get(p.key), now = current.get(p.key)
    if (!prior) return [p]
    if (!now) return []
    return [{ ...now, label: changed(prior.label, p.label, now.label), path: changed(prior.path, p.path, now.path) }]
  })
  return [...rows, ...latest.filter((p) => !old.has(p.key) && !draftKeys.has(p.key))]
}

export function serverProfileInput(v: ServerFormValues, initial: ServerAsset, latest: ServerAsset): ServerAssetInput {
  const prior = formValuesOf(initial), current = formValuesOf(latest)
  return toAssetInput({
    ...current,
    name: changed(prior.name, v.name, current.name),
    summary: changed(prior.summary, v.summary, current.summary),
    tags: changed(prior.tags, v.tags, current.tags),
    provider: changed(prior.provider, v.provider, current.provider),
    region: changed(prior.region, v.region, current.region),
    servedHostnames: changed(prior.servedHostnames, v.servedHostnames, current.servedHostnames),
    notes: changed(prior.notes, v.notes, current.notes),
    rules: changed(prior.rules, v.rules, current.rules),
    services: mergeServices(initial.services, v.services.map(serviceInputOf), latest.services),
    paths: mergePaths(initial.paths, v.paths, latest.paths),
  }, latest)
}

export function cliProfileInput(v: CliFormValues, initial: CliAsset, latest: CliAsset): CliAssetInput {
  return cliInputOf({
    ...cliValuesOf(latest),
    name: changed(initial.name, v.name, latest.name),
    summary: changed(initial.summary, v.summary, latest.summary),
    notes: changed(initial.notes, v.notes, latest.notes),
    rules: changed(initial.guardrails.rules, v.rules, latest.guardrails.rules),
  }, latest)
}

/** 标题快捷改名只投影名称，不改连接、账号、档位或 Agent 选择。 */
export function renameInputOf(asset: Asset, name: string): AssetInput {
  return asset.type === "vps" ? toAssetInput({ ...formValuesOf(asset), name }, asset) : cliInputOf({ ...cliValuesOf(asset), name }, asset)
}
