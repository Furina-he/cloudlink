// 服务器表单与 AssetInput 之间的换算、别名生成、保存失败时的定位（PRD 6.4、6.5）
import type { FieldErrors, FieldPath, UseFormReturn } from "react-hook-form"

import type { ConnectionInput, EnvId, ServerAsset, ServerAssetInput } from "@/bindings"
import type { ServerFormValues } from "@/lib/schemas"
import type { DetailTab } from "@/stores/ui"

export const EMPTY_EXPORT = { resolvedConnection: false, listeningPorts: false, image: true }

/** 运行环境的固定顺序：Windows 在前，WSL 按名称。签名比对依赖这个顺序 */
export const sortEnvs = (ids: string[]) => [...ids].sort((a, b) => (a === "windows" ? -1 : b === "windows" ? 1 : a.localeCompare(b))) as EnvId[]

export function formValuesOf(asset: ServerAsset): ServerFormValues {
  const c = asset.connection
  return {
    source: c.source,
    alias: c.sshAlias,
    connection: {
      host: c.host ?? "",
      port: c.port ?? 22,
      user: c.user ?? "",
      method: c.auth?.method ?? "key",
      identityFile: { ...(c.auth?.identityFile ?? {}) } as Record<string, string>,
      password: "",
      passwordSaved: c.auth?.passwordSaved ?? false,
      proxyJump: c.proxyJump ?? "",
      definedIn: c.definedIn,
    },
    name: asset.name,
    envTag: asset.envTag,
    summary: asset.summary,
    tags: asset.tags,
    provider: asset.provider ?? "",
    region: asset.region ?? "",
    servedHostnames: asset.servedHostnames,
    notes: asset.notes,
    paths: asset.paths,
    services: asset.services,
    rules: asset.guardrails.rules,
    export: asset.export,
  }
}

/** 新建表单（6.5）：默认端口 22、私钥认证、写入全部可用运行环境（F-107 AC5） */
export function newServerValues(envIds: EnvId[]): ServerFormValues {
  return {
    source: "managed",
    alias: "",
    connection: {
      host: "",
      port: 22,
      user: "root",
      method: "key",
      identityFile: {},
      password: "",
      passwordSaved: false,
      proxyJump: "",
      definedIn: envIds,
    },
    name: "",
    envTag: "dev",
    summary: "",
    tags: [],
    provider: "",
    region: "",
    servedHostnames: [],
    notes: "",
    paths: [],
    services: [],
    rules: [],
    export: EMPTY_EXPORT,
  }
}

/** 表单里的连接参数。只保留写入的运行环境里填了的私钥路径，测试连接和保存用同一份 */
export function connectionInputOfForm(v: Pick<ServerFormValues, "source" | "alias" | "connection">): ConnectionInput {
  if (v.source === "imported") return { source: "imported", sshAlias: v.alias.trim() }
  const c = v.connection
  const definedIn = sortEnvs(c.definedIn)
  const identityFile: Partial<Record<EnvId, string>> = {}
  if (c.method === "key") {
    for (const env of definedIn) {
      const path = c.identityFile[env]?.trim()
      if (path) identityFile[env] = path
    }
  }
  return {
    source: "managed",
    sshAlias: v.alias.trim(),
    host: c.host.trim(),
    port: c.port,
    user: c.user.trim(),
    auth: { method: c.method, identityFile },
    proxyJump: c.proxyJump.trim() || null,
    definedIn,
  }
}

/** 已保存服务器的连接参数，与 connectionInputOfForm(formValuesOf(asset)) 一致 */
export const connectionInputOf = (asset: ServerAsset): ConnectionInput => connectionInputOfForm(formValuesOf(asset))

/** 表单之外的字段（类型、探测得到的事实、监听端口）沿用已保存的服务器 */
export function toAssetInput(v: ServerFormValues, base: ServerAsset | undefined): ServerAssetInput {
  return {
    id: base?.id,
    type: "vps",
    name: v.name.trim(),
    envTag: v.envTag,
    provider: v.provider.trim() || undefined,
    region: v.region.trim() || undefined,
    tags: v.tags,
    summary: v.summary,
    connection: connectionInputOfForm(v),
    facts: base?.facts ?? {},
    paths: v.paths,
    services: v.services,
    servedHostnames: v.servedHostnames,
    listeningPorts: base?.listeningPorts ?? [],
    guardrails: { rules: v.rules },
    export: v.export,
    notes: v.notes,
  }
}

// ---------- 别名生成（6.5，2026-10-31 用户确认） ----------

const kebab = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")

/**
 * 取名称中的英文字母和数字（「HK Edge」→ hk-edge）；没有时改用地址：
 * 域名取第一段（edge.example.com → edge），IPv4 写成 vps-203-0-113-10
 */
export function baseAlias(name: string, host: string): string {
  const fromName = kebab(name)
  if (fromName) return fromName.slice(0, 63).replace(/-+$/, "")
  const h = host.trim().toLowerCase().replace(/^\[|\]$/g, "")
  if (!h) return ""
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return `vps-${h.replace(/\./g, "-")}`
  if (h.includes(":")) return `vps-${kebab(h)}`
  return kebab(h.split(".")[0])
}

/** 与已有别名重名时追加 -2、-3（不区分大小写） */
export function uniqueAlias(base: string, taken: string[]): string {
  if (!base) return ""
  const used = new Set(taken.map((a) => a.toLowerCase()))
  let alias = base
  for (let n = 2; used.has(alias); n++) alias = `${base}-${n}`
  return alias
}

// ---------- 保存校验失败：切到出错字段所在的 Tab，聚焦第一个出错字段（6.4） ----------

/** 字段在界面上的顺序；连接配置里的别名、跳板机、运行环境在「高级」里 */
const FIELD_ORDER: { path: string; tab: DetailTab; advanced?: boolean }[] = [
  { path: "name", tab: "connection" },
  { path: "connection.host", tab: "connection" },
  { path: "connection.port", tab: "connection" },
  { path: "connection.user", tab: "connection" },
  { path: "connection.identityFile", tab: "connection" },
  { path: "connection.password", tab: "connection" },
  { path: "alias", tab: "connection", advanced: true },
  { path: "connection.proxyJump", tab: "connection", advanced: true },
  { path: "connection.definedIn", tab: "connection", advanced: true },
  { path: "servedHostnames", tab: "profile" },
  { path: "rules", tab: "profile" },
  { path: "services", tab: "profile" },
  { path: "paths", tab: "profile" },
]

const isLeaf = (node: unknown): boolean => !!node && typeof node === "object" && "message" in node && "type" in node

/** 某个路径下第一个叶子错误的完整路径，例如 paths.1.label */
function firstLeaf(node: unknown, path: string): string | null {
  if (!node || typeof node !== "object") return null
  if (isLeaf(node)) return path
  for (const [k, child] of Object.entries(node)) {
    if (k === "ref") continue
    const found = firstLeaf(child, `${path}.${k}`)
    if (found) return found
  }
  return null
}

/** 第一个出错的字段：所在 Tab、是否在「高级」里、聚焦用的路径 */
export function firstError(errors: FieldErrors<ServerFormValues>): { tab: DetailTab; advanced: boolean; path: string } | null {
  for (const f of FIELD_ORDER) {
    const node = f.path.split(".").reduce<unknown>((n, k) => (n as Record<string, unknown> | undefined)?.[k], errors)
    const leaf = firstLeaf(node, f.path)
    if (leaf) return { tab: f.tab, advanced: !!f.advanced, path: leaf }
  }
  return null
}

/** 聚焦出错的字段：所在的 Tab 刚切换时字段还没挂载，等两帧再聚焦 */
export function focusField(form: UseFormReturn<ServerFormValues>, path: string) {
  requestAnimationFrame(() => requestAnimationFrame(() => form.setFocus(path as FieldPath<ServerFormValues>)))
}

/** 错误消息是 copy.validation 的 key */
export function errorKey(error: unknown): string | undefined {
  return error && typeof error === "object" && "message" in error ? String((error as { message?: unknown }).message ?? "") : undefined
}

export const shortId = (prefix: string) => `${prefix}-${crypto.randomUUID().slice(0, 8)}`
