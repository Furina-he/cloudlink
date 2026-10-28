// zod 校验（PRD 3.3、5.1、5.4）
import { z } from "zod"

import type { PortMapping } from "@/bindings"

export const SLUG_MAX = 64
export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/
/** synced 是 Claude Code 在 ~/.claude/skills 下的保留目录名 */
export const RESERVED_SLUGS = ["synced"] as const
export const DESCRIPTION_MAX = 1024

/** 消息是 copy.ts 中 validation 的 key，表单层负责映射成中文 */
export const slugSchema = z
  .string()
  .min(1, "slug-required")
  .max(SLUG_MAX, "slug-too-long")
  .regex(SLUG_PATTERN, "slug-format")
  .refine(
    (v) => !(RESERVED_SLUGS as readonly string[]).includes(v),
    "slug-reserved"
  )

/** 唯一性需要全部资产，作为工厂函数提供；编辑时排除自身 id */
export function uniqueSlugSchema(
  taken: { id: string; slug: string }[],
  selfId?: string
) {
  return slugSchema.refine(
    (v) => !taken.some((a) => a.slug === v && a.id !== selfId),
    "slug-taken"
  )
}

export const sshAliasSchema = z
  .string()
  .min(1, "alias-required")
  // 空串只报「必填」，不再重复报格式错误
  .regex(/^[^\s*?!]*$/, "alias-format")

export const guardrailRuleSchema = z.object({
  id: z.string(),
  text: z.string().trim().min(1, "rule-empty"),
})

export const assetPathSchema = z.object({
  key: z.string().min(1),
  label: z.string().trim().min(1, "path-label-required"),
  path: z.string().trim().min(1, "path-required"),
  source: z.enum(["manual", "probe"]),
})

/** 本机反代承载的站点：域名，可以带一层通配（*.example.com） */
const HOSTNAME_PATTERN = /^(\*\.)?([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/
const IPV4_PATTERN = /^\d{1,3}(\.\d{1,3}){3}$/

/** 站点名的错误 key；合法时返回 null。录入时和表单校验共用 */
export function hostnameError(value: string): "hostname-format" | "hostname-ip" | null {
  if (IPV4_PATTERN.test(value)) return "hostname-ip"
  return HOSTNAME_PATTERN.test(value) ? null : "hostname-format"
}

const hostnameSchema = z.string().superRefine((v, ctx) => {
  const key = hostnameError(v)
  if (key) ctx.addIssue({ code: "custom", message: key })
})

const portMappingSchema = z.object({
  hostIp: z.string(),
  hostPort: z.number(),
  containerPort: z.number(),
  proto: z.enum(["tcp", "udp"]),
})

export const serviceSchema = z.object({
  kind: z.enum(["docker", "systemd"]),
  name: z.string().trim().min(1, "service-name-required"),
  image: z.string().optional(),
  ports: z.array(portMappingSchema),
  role: z.string().optional(),
  critical: z.boolean(),
  source: z.enum(["manual", "probe"]),
  lastSeenAt: z.string().optional(),
  missing: z.boolean(),
  sanitized: z.boolean().optional(),
})

/**
 * 资产编辑器的表单（PRD 6.4）。探测信息、解析快照、时间戳由后端维护，不在表单里；
 * 云厂商和地域用空串表示「未填」
 */
export function assetFormSchema(
  taken: { id: string; slug: string }[],
  selfId?: string
) {
  return z.object({
    name: z.string().trim().min(1, "name-required"),
    slug: uniqueSlugSchema(taken, selfId),
    envTag: z.enum(["prod", "staging", "dev"]),
    provider: z.string().trim(),
    region: z.string().trim(),
    tags: z.array(z.string()),
    summary: z.string(),
    // 写进 description 和 runtime-topology.md；不收 IP（PRD 原则 2：拓扑最小披露）
    servedHostnames: z.array(hostnameSchema),
    notes: z.string(),
    sshAlias: sshAliasSchema,
    paths: z.array(assetPathSchema),
    services: z.array(serviceSchema),
    rules: z.array(guardrailRuleSchema),
    defaultMode: z.enum(["read-only", "standard"]),
    export: z.object({
      resolvedConnection: z.boolean(),
      listeningPorts: z.boolean(),
      image: z.boolean(),
    }),
  })
}

export type AssetFormValues = z.infer<ReturnType<typeof assetFormSchema>>

// ---------- 端口映射：「127.0.0.1:8080->8080, 80->80/udp」 ----------

const PORT_ENTRY = /^(?:(\[[0-9a-fA-F:]+\]|[0-9.]+):)?(\d{1,5})->(\d{1,5})(?:\/(tcp|udp))?$/
const validPort = (n: number) => n >= 1 && n <= 65535

/** 解析失败返回 null；空串得到空列表 */
export function parsePorts(text: string): PortMapping[] | null {
  const entries = text.split(",").map((s) => s.trim()).filter(Boolean)
  const result: PortMapping[] = []
  for (const entry of entries) {
    const m = PORT_ENTRY.exec(entry)
    if (!m) return null
    const hostPort = Number(m[2])
    const containerPort = Number(m[3])
    if (!validPort(hostPort) || !validPort(containerPort)) return null
    result.push({
      hostIp: m[1] ?? "0.0.0.0",
      hostPort,
      containerPort,
      proto: m[4] === "udp" ? "udp" : "tcp",
    })
  }
  return result
}

export function formatPort(p: PortMapping): string {
  return `${p.hostIp}:${p.hostPort}->${p.containerPort}${p.proto === "udp" ? "/udp" : ""}`
}

export function formatPorts(ports: PortMapping[]): string {
  return ports.map(formatPort).join(", ")
}

/** 「手动添加服务」对话框；kind + name 是合并键，不能和其他服务重复 */
export function serviceDraftSchema(existing: { kind: string; name: string }[]) {
  return z
    .object({
      kind: z.enum(["docker", "systemd"]),
      name: z.string().trim().min(1, "service-name-required"),
      image: z.string().trim(),
      ports: z.string().refine((s) => parsePorts(s) !== null, "ports-format"),
      role: z.string().trim(),
      critical: z.boolean(),
    })
    .refine(
      (v) => !existing.some((s) => s.kind === v.kind && s.name === v.name),
      { message: "service-duplicate", path: ["name"] }
    )
}

export type ServiceDraft = z.infer<ReturnType<typeof serviceDraftSchema>>

export type ValidationKey =
  | "slug-required"
  | "slug-too-long"
  | "slug-format"
  | "slug-reserved"
  | "slug-taken"
  | "alias-required"
  | "alias-format"
  | "rule-empty"
  | "path-label-required"
  | "path-required"
  | "name-required"
  | "service-name-required"
  | "service-duplicate"
  | "ports-format"
  | "slug-same"
  | "hostname-format"
  | "hostname-ip"
