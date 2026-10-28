// 资产编辑器的表单与 AssetInput 之间的换算，以及保存失败时的错误定位（PRD 6.4）
import type { FieldErrors } from "react-hook-form"

import type { Asset, AssetInput, Mode } from "@/bindings"
import type { AssetFormValues } from "@/lib/schemas"
import type { AssetTab } from "@/stores/ui"

export const EMPTY_EXPORT = { resolvedConnection: false, listeningPorts: false, image: true }

export function formValuesOf(asset: Asset): AssetFormValues {
  return {
    name: asset.name,
    slug: asset.slug,
    envTag: asset.envTag,
    provider: asset.provider ?? "",
    region: asset.region ?? "",
    tags: asset.tags,
    summary: asset.summary,
    servedHostnames: asset.servedHostnames,
    notes: asset.notes,
    sshAlias: asset.connection.sshAlias,
    paths: asset.paths,
    services: asset.services,
    rules: asset.guardrails.rules,
    defaultMode: asset.guardrails.defaultMode,
    export: asset.export,
  }
}

export function newAssetValues(defaultMode: Mode = "read-only"): AssetFormValues {
  return {
    name: "",
    slug: "",
    envTag: "dev",
    provider: "",
    region: "",
    tags: [],
    summary: "",
    servedHostnames: [],
    notes: "",
    sshAlias: "",
    paths: [],
    services: [],
    rules: [],
    defaultMode,
    export: EMPTY_EXPORT,
  }
}

/** 表单之外的字段（类型、探测得到的事实、监听端口）沿用已保存的资产 */
export function toAssetInput(values: AssetFormValues, base: Asset | undefined): AssetInput {
  return {
    id: base?.id,
    type: base?.type ?? "vps",
    name: values.name.trim(),
    slug: values.slug,
    envTag: values.envTag,
    provider: values.provider.trim() || undefined,
    region: values.region.trim() || undefined,
    tags: values.tags,
    summary: values.summary,
    connection: { sshAlias: values.sshAlias },
    facts: base?.facts ?? {},
    paths: values.paths,
    services: values.services,
    servedHostnames: values.servedHostnames,
    listeningPorts: base?.listeningPorts ?? [],
    guardrails: { defaultMode: values.defaultMode, rules: values.rules },
    export: values.export,
    notes: values.notes,
  }
}

/** 新建资产时，slug 跟着别名走：vps-<别名>，手动改过就不再跟随 */
export function slugFromAlias(alias: string): string {
  const base = alias
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return base ? `vps-${base}`.slice(0, 64).replace(/-+$/, "") : ""
}

export const shortId = (prefix: string) => `${prefix}-${crypto.randomUUID().slice(0, 8)}`

// ---------- 保存校验失败：标签页错误数与第一个出错字段 ----------

type FormTab = Exclude<AssetTab, "mounts">

/** 每个标签页里的字段，顺序就是焦点定位时的优先顺序 */
export const TAB_FIELDS: Record<FormTab, { field: keyof AssetFormValues; sub?: string[] }[]> = {
  overview: [
    { field: "name" },
    { field: "slug" },
    { field: "envTag" },
    { field: "provider" },
    { field: "region" },
    { field: "tags" },
    { field: "summary" },
    { field: "servedHostnames" },
    { field: "notes" },
  ],
  connection: [{ field: "sshAlias" }, { field: "export" }],
  paths: [{ field: "paths", sub: ["label", "path"] }],
  services: [{ field: "services", sub: ["name", "role"] }],
  guardrails: [{ field: "defaultMode" }, { field: "rules", sub: ["text"] }],
}

export const FORM_TABS = Object.keys(TAB_FIELDS) as FormTab[]

const isLeaf = (node: unknown): boolean =>
  !!node && typeof node === "object" && "message" in node && "type" in node

/** 数叶子错误；跳过 ref（DOM 元素） */
function countNode(node: unknown): number {
  if (!node || typeof node !== "object") return 0
  if (isLeaf(node)) return 1
  return Object.entries(node).reduce((n, [k, v]) => (k === "ref" ? n : n + countNode(v)), 0)
}

export function countTabErrors(errors: FieldErrors<AssetFormValues>, tab: FormTab): number {
  return TAB_FIELDS[tab].reduce((n, { field }) => n + countNode(errors[field]), 0)
}

/** 某个标签页里第一个出错字段的路径，例如 paths.1.label */
export function firstErrorPath(errors: FieldErrors<AssetFormValues>, tab: FormTab): string | null {
  for (const { field, sub } of TAB_FIELDS[tab]) {
    const node = errors[field] as unknown
    if (!node) continue
    if (isLeaf(node)) return field
    // 字符串数组（承载的站点）：错误挂在下标上，聚焦整个字段
    if (Array.isArray(node) && !sub && node.some(isLeaf)) return field
    if (Array.isArray(node) && sub) {
      for (let i = 0; i < node.length; i++) {
        const row = node[i] as Record<string, unknown> | undefined
        const key = row && sub.find((k) => isLeaf(row[k]))
        if (key) return `${field}.${i}.${key}`
      }
    }
  }
  return null
}

/** 错误消息是 copy.validation 的 key */
export function errorKey(error: unknown): string | undefined {
  return error && typeof error === "object" && "message" in error
    ? String((error as { message?: unknown }).message ?? "")
    : undefined
}
