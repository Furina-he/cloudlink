// zod 校验（PRD 3.3、6.4、6.5）。消息是 copy.ts 中 validation 的 key，表单层负责映射成中文
import { z } from "zod"

import type { PortMapping } from "@/bindings"

export const DESCRIPTION_MAX = 1024

/** ssh 的 Host 别名：不能有空格和通配符（*、?、!），也不能有引号和 # */
export const ALIAS_PATTERN = /^[A-Za-z0-9._-]+$/

/** 服务器地址：域名、IPv4 或 IPv6（可带方括号）。不收 URL */
const HOST_PATTERN = /^(\[[0-9a-fA-F:.]+\]|[0-9a-fA-F:]*:[0-9a-fA-F:.]+|[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)*)$/

export const hostSchema = z.string().trim().min(1, "host-required").regex(HOST_PATTERN, "host-format")

export const portSchema = z
  .number({ error: "port-format" })
  .int("port-format")
  .min(1, "port-format")
  .max(65535, "port-format")

export const guardrailRuleSchema = z.object({
  id: z.string(),
  text: z.string().trim().min(1, "rule-empty"),
})

export const conventionSchema = z.object({
  id: z.string(),
  text: z.string().trim().min(1, "convention-empty"),
})

/** 用户补充或改写的一条关系（2026-11-07） */
export const relationNoteSchema = z.object({
  id: z.string(),
  text: z.string().trim().min(1, "relation-empty"),
  replaces: z.string().optional(),
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

/** 别名唯一性与冲突检查需要的上下文 */
export interface AliasContext {
  /** 其他服务器的别名（F-101 AC1，不区分大小写） */
  taken: string[]
  /** 各运行环境用户 ssh config 里已有的 Host（F-107 AC3）；导入的服务器不检查 */
  sshHosts: { alias: string; definedIn: string[] }[]
  /** 编辑中服务器自己的别名，不算冲突 */
  selfAlias?: string
}

/**
 * 服务器表单（PRD 6.4、6.5）。managed 才校验连接字段；imported 的连接信息由用户的 ssh config 维护。
 * 云厂商和地域用空串表示「未填」
 */
export function serverFormSchema(ctx: AliasContext, opts: { nameOptional?: boolean } = {}) {
  return z
    .object({
      source: z.enum(["managed", "imported"]),
      alias: z.string().trim(),
      connection: z.object({
        host: z.string().trim(),
        // 输入框为空或不是数字时 valueAsNumber 得到 NaN；收下它，交给下面的 superRefine 报 port-format
        port: z.union([z.number(), z.nan()]),
        user: z.string().trim(),
        method: z.enum(["key", "agent", "password"]),
        identityFile: z.record(z.string(), z.string()),
        password: z.string(),
        passwordSaved: z.boolean(),
        proxyJump: z.string().trim(),
        definedIn: z.array(z.string()),
      }),
      // 添加表单里名称可空，保存时用地址（PRD 6.5）
      name: opts.nameOptional ? z.string().trim() : z.string().trim().min(1, "name-required"),
      production: z.boolean(),
      summary: z.string(),
      tags: z.array(z.string()),
      provider: z.string().trim(),
      region: z.string().trim(),
      servedHostnames: z.array(hostnameSchema),
      notes: z.string(),
      paths: z.array(assetPathSchema),
      services: z.array(serviceSchema),
      rules: z.array(guardrailRuleSchema),
      export: z.object({
        resolvedConnection: z.boolean(),
        listeningPorts: z.boolean(),
        image: z.boolean(),
      }),
    })
    .superRefine((v, issue) => {
      const add = (path: (string | number)[], message: string) => issue.addIssue({ code: "custom", path, message })
      const alias = v.alias
      if (!alias) add(["alias"], "alias-required")
      else if (!ALIAS_PATTERN.test(alias)) add(["alias"], "alias-format")
      else if (ctx.taken.some((a) => a.toLowerCase() === alias.toLowerCase())) add(["alias"], "alias-taken")
      if (v.source !== "managed") return

      const c = v.connection
      const host = hostSchema.safeParse(c.host)
      if (!host.success) add(["connection", "host"], host.error.issues[0].message)
      if (!portSchema.safeParse(c.port).success) add(["connection", "port"], "port-format")
      if (!c.user) add(["connection", "user"], "user-required")
      if (c.definedIn.length === 0) add(["connection", "definedIn"], "envs-required")
      // 运行环境 id 里有点号（wsl:Ubuntu-24.04），不能作为表单路径的一段，错误挂在整个 identityFile 上
      if (c.method === "key" && !c.definedIn.some((env) => c.identityFile[env]?.trim())) {
        add(["connection", "identityFile"], "key-required")
      }
      if (c.method === "password" && !c.passwordSaved && !c.password) add(["connection", "password"], "password-required")
      // F-107 AC3：与要写入的运行环境里已有的 Host 重名
      const self = ctx.selfAlias?.toLowerCase()
      const clash = alias.toLowerCase() !== self && ctx.sshHosts.find(
        (h) => h.alias.toLowerCase() === alias.toLowerCase() && h.definedIn.some((env) => c.definedIn.includes(env))
      )
      if (clash && alias) add(["alias"], "alias-conflict")
    })
}

export type ServerFormValues = z.infer<ReturnType<typeof serverFormSchema>>

/** 云平台资源的表单（PRD 6.4）：范围勾选立即生效，不在表单里 */
export const cliFormSchema = z.object({
  name: z.string().trim().min(1, "name-required"),
  production: z.boolean(),
  summary: z.string(),
  rules: z.array(guardrailRuleSchema),
  notes: z.string(),
})
export type CliFormValues = z.infer<typeof cliFormSchema>

/** 两类资源共有的表单字段：名称、环境、用途、红线、笔记由同一组组件编辑 */
export type ProfileFormValues = CliFormValues

/** Agent 页「写进 Skill 的内容」（F-201 AC1）：关系由 CloudLink 推出，这里只有用户的补充、改写和隐藏 */
export const skillConfigSchema = z.object({
  relationNotes: z.array(relationNoteSchema),
  hiddenRelations: z.array(z.string()),
  conventions: z.array(conventionSchema),
})
export type SkillConfigValues = z.infer<typeof skillConfigSchema>

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

/** 自定义目录（F-301 AC、PRD 6.6） */
export const customTargetSchema = z.object({
  label: z.string().trim().min(1, "name-required"),
  path: z.string().min(1, "dir-required"),
  envId: z.string().min(1),
})
export type CustomTargetValues = z.infer<typeof customTargetSchema>

/** 设置 / 编译、探测（PRD 6.7）：在合理范围内的整数 */
export const settingsNumbersSchema = z.object({
  bodyLineLimit: z.number({ error: "body-line-limit" }).int("body-line-limit").min(20, "body-line-limit").max(500, "body-line-limit"),
  probeTimeoutSec: z.number({ error: "probe-timeout" }).int("probe-timeout").min(10, "probe-timeout").max(120, "probe-timeout"),
})
export type SettingsNumbers = z.infer<typeof settingsNumbersSchema>

export type ValidationKey =
  | "name-required"
  | "host-required"
  | "host-format"
  | "port-format"
  | "user-required"
  | "alias-required"
  | "alias-format"
  | "alias-taken"
  | "alias-conflict"
  | "key-required"
  | "password-required"
  | "envs-required"
  | "rule-empty"
  | "convention-empty"
  | "relation-empty"
  | "path-label-required"
  | "path-required"
  | "service-name-required"
  | "service-duplicate"
  | "ports-format"
  | "hostname-format"
  | "hostname-ip"
  | "dir-required"
  | "body-line-limit"
  | "probe-timeout"
