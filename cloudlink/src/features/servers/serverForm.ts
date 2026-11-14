// 服务器表单与 AssetInput 之间的换算、别名生成、保存失败时的定位（PRD 6.4、6.5）
import type { FieldErrors, FieldPath, UseFormReturn } from "react-hook-form"

import type { ConnectionInput, EnvId, Service, ServerAsset, ServerAssetInput } from "@/bindings"
import { copy } from "@/lib/copy"
import { formatPorts, parsePorts, type ServerFormValues } from "@/lib/schemas"

export const EMPTY_EXPORT = { resolvedConnection: false, listeningPorts: false, image: true }

/** 运行环境的固定顺序：Windows 在前，WSL 按名称。签名比对依赖这个顺序 */
export const sortEnvs = (ids: string[]) => [...ids].sort((a, b) => (a === "windows" ? -1 : b === "windows" ? 1 : a.localeCompare(b))) as EnvId[]

export function formValuesOf(asset: ServerAsset): ServerFormValues {
  const c = asset.connection
  // 草稿的列表和导出开关不能与持久化资源／打开时的基线共用可变引用。
  return structuredClone({
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
    fallbackName: asset.name,
    production: asset.production,
    summary: asset.summary,
    tags: asset.tags,
    provider: asset.provider ?? "",
    region: asset.region ?? "",
    servedHostnames: asset.servedHostnames,
    notes: asset.notes,
    paths: asset.paths,
    services: asset.services.map((s) => s.source === "manual" ? { ...s, portsText: formatPorts(s.ports) } : s),
    rules: asset.guardrails.rules,
    export: asset.export,
  })
}

/** 连接弹窗只覆盖实际编辑的字段，导出修改不把后台转换得到的新密钥覆盖回去。 */
export function connectionEditValues(draft: ServerFormValues, initial: ServerAsset, latest: ServerAsset): ServerFormValues {
  const before = formValuesOf(initial), current = formValuesOf(latest)
  const changed = <T,>(old: T, value: T, now: T): T => JSON.stringify(old) === JSON.stringify(value) ? now : value
  const connection = { ...current.connection }
  for (const key of ["host", "port", "user", "proxyJump", "definedIn", "method"] as const) {
    // 各键都保持自己的类型，Object.assign 不把索引赋值推断成不可能的交集。
    Object.assign(connection, { [key]: changed<unknown>(before.connection[key], draft.connection[key], current.connection[key]) })
  }
  connection.identityFile = { ...current.connection.identityFile }
  for (const key of new Set([...Object.keys(before.connection.identityFile), ...Object.keys(draft.connection.identityFile)])) {
    if (before.connection.identityFile[key] === draft.connection.identityFile[key]) continue
    if (draft.connection.identityFile[key] === undefined) delete connection.identityFile[key]
    else connection.identityFile[key] = draft.connection.identityFile[key]
  }
  connection.password = draft.connection.password
  if (draft.connection.method === "password" && draft.connection.password) connection.method = "password"
  return {
    ...current,
    alias: changed(before.alias, draft.alias, current.alias),
    connection,
    export: {
      resolvedConnection: changed(before.export.resolvedConnection, draft.export.resolvedConnection, current.export.resolvedConnection),
      listeningPorts: changed(before.export.listeningPorts, draft.export.listeningPorts, current.export.listeningPorts),
      image: changed(before.export.image, draft.export.image, current.export.image),
    },
  }
}

/** 名称与连接地址解耦；只在新草稿创建时分配一次，保存仍由后端核验别名唯一性。 */
export function newServerIdentity(taken: string[]): { alias: string; name: string } {
  const used = new Set(taken.map((a) => a.toLowerCase()))
  let n = 1
  while (used.has(`cloudlink-${n}`)) n++
  return { alias: `cloudlink-${n}`, name: copy.create.defaultName(n) }
}

/** 新建表单（6.5）：默认端口 22、先选中密码、写入全部可用运行环境（F-107 AC5） */
export function newServerValues(envIds: EnvId[], identity = newServerIdentity([])): ServerFormValues {
  return {
    source: "managed",
    alias: identity.alias,
    connection: {
      host: "",
      port: 22,
      user: "root",
      method: "password",
      identityFile: {},
      password: "",
      passwordSaved: false,
      proxyJump: "",
      definedIn: envIds,
    },
    name: "",
    fallbackName: identity.name,
    production: true,
    summary: "",
    tags: [],
    provider: "",
    region: "",
    servedHostnames: [],
    notes: "",
    paths: [],
    services: [],
    rules: [],
    export: { ...EMPTY_EXPORT },
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

/** 端口输入是表单元数据，不能进入数据库或 Skill 契约。 */
export function serviceInputOf(value: ServerFormValues["services"][number]): Service {
  const { portsText, ...service } = value
  return { ...service, ports: portsText === undefined ? service.ports : parsePorts(portsText) ?? [] }
}

/** 表单之外的字段（类型、探测得到的事实、监听端口）沿用已保存的服务器 */
export function toAssetInput(v: ServerFormValues, base: ServerAsset | undefined): ServerAssetInput {
  return {
    id: base?.id,
    type: "vps",
    name: v.name.trim() || (base ? "" : v.fallbackName),
    production: v.production,
    provider: v.provider.trim() || undefined,
    region: v.region.trim() || undefined,
    tags: v.tags,
    summary: v.summary,
    connection: connectionInputOfForm(v),
    facts: base?.facts ?? {},
    paths: v.paths,
    services: v.services.map(serviceInputOf),
    servedHostnames: v.servedHostnames,
    listeningPorts: base?.listeningPorts ?? [],
    guardrails: { rules: v.rules },
    export: v.export,
    notes: v.notes,
  }
}

// ---------- 保存校验失败：聚焦第一个出错字段，必要时展开「高级」（6.4） ----------

/** 字段在界面上的顺序；添加与连接编辑的别名、跳板机、运行环境都收进高级。 */
const FIELD_ORDER: { path: string; advanced?: boolean }[] = [
  { path: "connection.host" },
  { path: "connection.port" },
  { path: "connection.user" },
  { path: "name" },
  { path: "connection.identityFile" },
  { path: "connection.password" },
  { path: "alias", advanced: true },
  { path: "connection.proxyJump", advanced: true },
  { path: "connection.definedIn", advanced: true },
  { path: "servedHostnames" },
  { path: "rules" },
  { path: "services" },
  { path: "paths" },
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

/** 第一个出错的字段：是否在「高级」里、聚焦用的路径 */
export function firstError(errors: FieldErrors<ServerFormValues>): { advanced: boolean; path: string } | null {
  for (const f of FIELD_ORDER) {
    const node = f.path.split(".").reduce<unknown>((n, k) => (n as Record<string, unknown> | undefined)?.[k], errors)
    const leaf = firstLeaf(node, f.path)
    if (leaf) return { advanced: !!f.advanced, path: leaf }
  }
  return null
}

/** 聚焦出错的字段：字段刚展开时还没挂载，等两帧再聚焦 */
export function focusField(form: UseFormReturn<ServerFormValues>, path: string) {
  requestAnimationFrame(() => requestAnimationFrame(() => form.setFocus(path as FieldPath<ServerFormValues>)))
}

/** 错误消息是 copy.validation 的 key */
export function errorKey(error: unknown): string | undefined {
  return error && typeof error === "object" && "message" in error ? String((error as { message?: unknown }).message ?? "") : undefined
}

export const shortId = (prefix: string) => `${prefix}-${crypto.randomUUID().slice(0, 8)}`
