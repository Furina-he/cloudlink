// Mock 后端的内存数据库与公共逻辑：列入计算、重新编译、同步副本（PRD 3.4、8.2、8.4）
import { emit } from "@tauri-apps/api/event"

import type { ActivityItem, AgentId, Asset, AssetInput, CliAsset, CompileStatus, EnvId, Inclusion, IpcError, ServerAsset, Target } from "@/bindings"
import { cliEnvStatus, handleOf } from "@/stores/assets"
import * as fx from "./fixtures"
import { compileSkill, toStatus } from "./lint"

export const db = {
  environments: structuredClone(fx.environments),
  settings: structuredClone(fx.settings),
  sshHosts: structuredClone(fx.sshHosts),
  sshConfig: structuredClone(fx.sshConfig),
  assets: structuredClone(fx.assets),
  /** 本机各运行环境里 CLI 的实际情况和账号下的资源（F-104） */
  cliMachine: structuredClone(fx.cliMachine),
  cliCatalog: structuredClone(fx.cliCatalog),
  targets: structuredClone(fx.targets),
  deliveries: structuredClone(fx.deliveries),
  skillConfig: structuredClone(fx.skillConfig),
  guard: structuredClone(fx.guardStatuses),
  operations: structuredClone(fx.operations),
  notes: structuredClone(fx.notes),
  activity: structuredClone(fx.activity),
  inclusions: [] as Inclusion[],
  /** 键是 `<运行环境>|<AgentKey>` */
  compile: {} as Record<string, CompileStatus>,
  /** 凭据库（F-108）：服务器 id → 密码 */
  passwords: new Map<string, string>([["ast_dev_box", "devpass"]]),
  /** known_hosts：「运行环境:地址」。sg-db 只在 WSL 信任过（PRD 7.8：Windows 上探测会失败） */
  trusted: new Set<string>(["windows:203.0.113.10", `${fx.WSL}:203.0.113.10`, "windows:192.0.2.44", `${fx.WSL}:sg-db`, "windows:jp-relay", `${fx.WSL}:us-backup`]),
  /** CloudLink 生成或复制的私钥路径 */
  cloudlinkKeys: new Set<string>(),
  /** 测试通过的连接参数（signature → 测试时间），保存时据此保留验证结果（F-106 AC4） */
  passedTests: new Map<string, { at: string; envId: EnvId }>(),
}

/**
 * 复现 PRD 6.10 状态用的场景，通过地址栏参数选择：
 * - ?mock=empty：首次启动，没有任何服务器
 * - ?mock=slow：每个命令延迟 1.5 秒（加载中、保存中）
 * - ?mock=fail：开头两次加载服务器失败（开发模式下 StrictMode 会把首次加载执行两遍），点「重试」后恢复
 * - ?mock=degraded：护栏未生效（Windows）、不可用（WSL），编译受阻（hk-edge 笔记里有密钥）
 */
export const scenario = new URLSearchParams(window.location.search).get("mock")
if (scenario === "empty") {
  db.assets = []
  db.deliveries = []
  db.operations = []
  db.notes = []
  db.activity = []
  db.guard = db.guard.map((g) => ({ ...g, state: "not-installed", deniedToday: 0 }))
  db.targets = db.targets.filter((t) => t.agent !== "custom")
  db.sshHosts.hosts.forEach((h) => (h.imported = false))
}
if (scenario === "degraded") {
  // 护栏「未生效」「不可用」，以及 hk-edge 的笔记里有密钥导致 Windows 的总 Skill 编译受阻
  db.guard = db.guard.map((g) =>
    g.envId === "windows"
      ? { ...g, state: "broken", detail: { id: "hooks-disabled" }, deniedToday: 0 }
      : { ...g, state: "unavailable", detail: { id: "interop-disabled" } }
  )
  const hk = db.assets.find((a) => a.id === "ast_hk_edge")
  if (hk) hk.notes = `${hk.notes}\npassword: hunter2`
}
export const LATENCY = scenario === "slow" ? 1500 : 120

let seq = 0
export const newId = (prefix: string) => `${prefix}_${Date.now().toString(36)}${(seq++).toString(36)}`
export const now = () => new Date().toISOString()
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
export const fail = (id: IpcError["id"], params?: IpcError["params"]): never => {
  throw { id, params } satisfies IpcError
}

export const assetById = (id: string) => db.assets.find((a) => a.id === id) ?? fail("not-found")
export const aliasOf = (id: string) => {
  const a = db.assets.find((x) => x.id === id)
  return a ? handleOf(a) : id
}
export const serverById = (id: string): ServerAsset => {
  const a = assetById(id)
  return a.type === "vps" ? a : fail("not-found")
}
export const cliById = (id: string): CliAsset => {
  const a = assetById(id)
  return a.type === "cli" ? a : fail("not-found")
}
export const availableEnvs = () =>
  db.environments.filter((e) => e.available && (db.settings.environments.find((x) => x.id === e.id)?.enabled ?? true))

export function logActivity(item: Omit<ActivityItem, "id" | "at">) {
  const full: ActivityItem = { ...item, id: newId("act"), at: now() }
  db.activity.unshift(full)
  void emit("activity://new", { item: full })
}

/** 同一个 Agent 在各运行环境的目录共用一个 AgentKey：内置取 AgentId，自定义目录取 `custom:<名称>` */
export const agentKeyOf = (agent: AgentId, label: string) => (agent === "custom" ? `custom:${label.trim().toLowerCase()}` : agent)

const AGENT_ORDER: Record<AgentId, number> = { "claude-code": 0, universal: 1, trae: 2, "trae-cn": 3, kiro: 4, continue: 5, custom: 6 }

/** 编译单元：已启用目标里不同的「运行环境 × Agent」，每个编译一份总 Skill */
export function compileUnits(): { envId: EnvId; agentKey: string; targets: Target[] }[] {
  const envs = availableEnvs().map((e) => e.id)
  const units = new Map<string, { envId: EnvId; agentKey: string; targets: Target[] }>()
  db.targets
    .filter((t) => t.enabled && envs.includes(t.envId))
    .sort((a, b) => envs.indexOf(a.envId) - envs.indexOf(b.envId) || AGENT_ORDER[a.agent] - AGENT_ORDER[b.agent] || a.label.localeCompare(b.label))
    .forEach((t) => {
      const key = `${t.envId}|${t.agentKey}`
      const unit = units.get(key) ?? { envId: t.envId, agentKey: t.agentKey, targets: [] }
      unit.targets.push(t)
      units.set(key, unit)
    })
  return [...units.values()]
}

/** 列入（3.4）：这项资源点选了这个 Agent × 该环境中有这台服务器的连接配置，或该环境的 CLI 已就绪 */
export function inclusionFor(a: Asset, envId: EnvId, agentKey: string): Inclusion {
  const base = { assetId: a.id, envId, agentKey }
  const out = (id: NonNullable<Inclusion["reason"]>["id"]): Inclusion => ({ ...base, included: false, reason: { id, params: { env: envId, cli: a.type === "cli" ? a.cli.binary : "" } } })
  if (!a.agent.agents.includes(agentKey)) return out("agent-off")
  if (a.type === "cli") {
    const state = a.cli.envStates[envId]
    const status = state ? cliEnvStatus(state) : "not-installed"
    if (status === "not-installed") return out("cli-not-installed")
    return status === "ready" ? { ...base, included: true } : out("cli-not-logged-in")
  }
  const c = a.connection
  if (c.source === "imported") return c.definedIn.includes(envId) ? { ...base, included: true } : out("not-defined")
  if (c.auth?.method === "password") return out("password-only")
  if (!c.definedIn.includes(envId)) return out("not-written")
  if (c.auth?.method === "key" && !c.auth.identityFile[envId]) return out("no-key-in-env")
  if (!db.environments.find((e) => e.id === envId)?.managedSshConfig.included) return out("include-missing")
  return { ...base, included: true }
}


/** 总览表的顺序：生产、预发、开发，组内按别名 */
export const includedIn = (envId: EnvId, agentKey: string) =>
  db.assets
    .filter((a) => inclusionFor(a, envId, agentKey).included)
    .sort((a, b) => Number(b.production) - Number(a.production) || handleOf(a).localeCompare(handleOf(b)))

export function emitDeliveries() {
  void emit("deliveries://changed", { deliveries: db.deliveries, inclusions: db.inclusions })
}

/**
 * 重新编译并同步副本（F-203、F-304 AC3）：每个「运行环境 × Agent」一份，只含分发给这个 Agent 的服务器。
 * 受阻的那一份保留上一次的产物。待同步、已过期的照常写入。被改动的副本和冲突不自动覆盖，要用户点「修复」（F-305）。
 * 副本缺失也留给「修复」：夹具要稳定复现「副本缺失」这个状态（PRD 6.10）。
 * silent 用于启动时（前端还没订阅事件）和调用方自己发事件、记活动的场合
 */
export function recompile(opts: { silent?: boolean } = {}): CompileStatus[] {
  const units = compileUnits()
  db.inclusions = db.assets.flatMap((a) => units.map((u) => inclusionFor(a, u.envId, u.agentKey)))
  const previous = db.compile
  db.compile = {}
  const statuses = units.map((u) => {
    const key = `${u.envId}|${u.agentKey}`
    const list = includedIn(u.envId, u.agentKey)
    const status = toStatus(compileSkill(u.envId, u.agentKey, list, db.skillConfig, db.settings), previous[key])
    db.compile[key] = status
    if (!status.blocked) {
      for (const t of u.targets) {
        const d = db.deliveries.find((x) => x.targetId === t.id)
        if (list.length === 0) {
          // 一台都没有分发给这个 Agent：移除总 Skill（3.4）；冲突的目录不是我们的，不动
          if (d && d.status !== "conflict" && d.status !== "modified") db.deliveries = db.deliveries.filter((x) => x !== d)
        } else if (!d) {
          db.deliveries.push({ id: newId("dlv"), targetId: t.id, envId: u.envId, path: `${t.path}${u.envId === "windows" ? "\\" : "/"}cloudlink-servers`, status: "ok", checkedAt: now() })
        } else if (d.status === "ok" || d.status === "outdated" || d.status === "pending") {
          d.status = "ok"
          d.checkedAt = now()
        }
      }
    }
    if (!opts.silent) {
      logActivity({
        kind: "compile",
        messageId: status.blocked ? "compile-blocked" : "compile-ok",
        params: { target: u.targets[0].label, env: u.envId, count: status.blocked ? status.errors : list.length },
        durationMs: 40,
        ok: !status.blocked,
      })
    }
    return status
  })
  if (!opts.silent) {
    emitCompiled()
    emitDeliveries()
  }
  return statuses
}

/** 编译单元变了（启用、停用、添加或移除目标）也要通知前端，消失的单元随之移除 */
export function emitCompiled() {
  void emit("compile://finished", { statuses: Object.values(db.compile) })
}

/** 预览草稿（F-204）：用已保存的探测信息、档位补全表单之外的字段 */
export function draftToAsset(input: AssetInput): Asset {
  const saved = input.id ? db.assets.find((a) => a.id === input.id) : undefined
  const agent = saved?.agent ?? { agents: [], mode: input.production ? "read-only" : db.settings.defaultMode }
  if (input.type === "cli") {
    const rest = { ...input }
    delete rest.scope
    const cli = saved?.type === "cli" ? saved.cli : { binary: "wrangler" as const, envStates: {}, scope: input.scope ?? [] }
    return { ...rest, id: input.id ?? "draft", handle: saved?.type === "cli" ? saved.handle : input.cliProvider, cli, agent, createdAt: saved?.createdAt ?? now(), updatedAt: now() }
  }
  const server = saved?.type === "vps" ? saved : undefined
  const c = input.connection
  return {
    ...input,
    id: input.id ?? "draft",
    connection: {
      ...(server?.connection ?? { definedIn: [], resolved: null, verified: null }),
      ...(c.source === "managed"
        ? {
            source: "managed" as const,
            sshAlias: c.sshAlias,
            host: c.host,
            port: c.port,
            user: c.user,
            proxyJump: c.proxyJump,
            definedIn: c.definedIn,
            auth: { ...c.auth, generatedByCloudLink: false, passwordSaved: false },
          }
        : { source: "imported" as const, sshAlias: c.sshAlias }),
    },
    agent,
    probe: server?.probe ?? { lastRunId: null, lastSuccessAt: null, status: "never" },
    createdAt: saved?.createdAt ?? now(),
    updatedAt: now(),
  }
}
