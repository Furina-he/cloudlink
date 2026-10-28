// Mock 后端（PRD 7.8）：在普通浏览器里模拟全部 IPC 命令与 5 个事件
import { emit } from "@tauri-apps/api/event"
import { mockIPC } from "@tauri-apps/api/mocks"

import type {
  ActivityItem,
  ActivityQuery,
  AddProjectRequest,
  Asset,
  AssetInput,
  CompilePreview,
  Convention,
  ImportHost,
  IpcError,
  LintItem,
  Mode,
  Mount,
  MountRequest,
  ProbeDiff,
  ProbeError,
  ProbeStep,
  Settings,
  SkillStatus,
  Target,
} from "@/bindings"
import { AGENTS, CONVENTION_DIRS } from "@/lib/agents"
import * as fx from "./fixtures"

const db = {
  assets: structuredClone(fx.assets),
  targets: structuredClone(fx.targets),
  mounts: structuredClone(fx.mounts),
  activity: structuredClone(fx.activity),
  settings: structuredClone(fx.settings),
  hosts: structuredClone(fx.sshHosts),
  environments: structuredClone(fx.environments),
}

/**
 * 复现 PRD 6.11 状态用的场景，通过地址栏参数选择：
 * - ?mock=empty：首次启动，没有任何资产和挂载
 * - ?mock=slow：每个命令延迟 1.5 秒（加载中、保存中）
 * - ?mock=fail：开头两次加载资产失败（开发模式下 StrictMode 会把首次加载执行两遍），点「重试」后恢复
 */
const scenario = new URLSearchParams(window.location.search).get("mock")
if (scenario === "empty") {
  db.assets = []
  db.mounts = []
  db.activity = []
  db.hosts.hosts.forEach((h) => (h.imported = false))
}
const LATENCY = scenario === "slow" ? 1500 : 120
let failListAssets = scenario === "fail" ? 2 : 0

let seq = 0
const newId = (prefix: string) => `${prefix}_${Date.now().toString(36)}${(seq++).toString(36)}`
const now = () => new Date().toISOString()
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const fail = (id: IpcError["id"], params?: IpcError["params"]): never => {
  throw { id, params } satisfies IpcError
}

const skillIdOf = (assetId: string) => `skl_${assetId.replace(/^ast_/, "")}`
const assetOfSkill = (skillId: string) =>
  db.assets.find((a) => skillIdOf(a.id) === skillId) ?? fail("not-found")
const targetById = (id: string) => db.targets.find((t) => t.id === id) ?? fail("not-found")
const mountById = (id: string) => db.mounts.find((m) => m.id === id) ?? fail("not-found")

function logActivity(item: Omit<ActivityItem, "id" | "at">) {
  const full: ActivityItem = { ...item, id: newId("act"), at: now() }
  db.activity.unshift(full)
  void emit("activity://new", { item: full })
}

function emitMounts() {
  void emit("mounts://changed", { mounts: db.mounts })
}

// ---------- 编译（只为界面提供形状正确的结果，真正的渲染在 Rust 编译器） ----------

const BUILTIN_RULES = [
  "Never read or print credential files (`.env`, `*.pem`, `*.key`, `id_*`, `/etc/shadow`, `~/.ssh/`) and never use `docker inspect` to view environment variables.",
  "Never ask for or record passwords, private keys or IP addresses; connect only through the SSH alias.",
  'If the host does not match this document, report the difference to the user instead of "fixing" the server to match the document.',
]

/** 简化版密钥规则（真实实现复用 gitleaks 规则集） */
const SECRET_RULES: [string, RegExp][] = [
  ["generic-password", /password\s*[=:]\s*\S+/i],
  ["private-key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["aws-access-key", /AKIA[0-9A-Z]{16}/],
  ["github-token", /gh[pousr]_[A-Za-z0-9]{36}/],
]
const INJECTION = /ignore[\s_-]*(all[\s_-]*)?previous|system[\s_-]*prompt|忽略以上/i
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/

const estimateTokens = (s: string) => Math.ceil(s.length / 3.6)
const code = (s: string) => `\`${s.slice(0, 128)}\``
const portText = (p: Asset["services"][number]["ports"][number]) =>
  `${p.hostIp}:${p.hostPort}->${p.containerPort}${p.proto === "udp" ? "/udp" : ""}`

/** 在文件里找第一处匹配，返回行号（从 1 开始） */
function findLine(content: string, test: (line: string) => boolean): number | null {
  const i = content.split("\n").findIndex(test)
  return i < 0 ? null : i + 1
}

function compile(input: AssetInput, mode: Mode): CompilePreview {
  const saved = input.id ? db.assets.find((a) => a.id === input.id) : undefined
  const alias = input.connection.sshAlias || "(no alias)"
  const env = { prod: "Production", staging: "Staging", dev: "Development" }[input.envTag]
  const os = input.facts.os
  const hosts = input.servedHostnames
  const summary = input.summary.trim()
  const description = [
    `Connection, directory and container topology, and guardrails for ${alias}${os ? ` (${os}, ${env.toLowerCase()})` : ` (${env.toLowerCase()})`}${summary ? `: ${summary}` : ""}.`,
    `Use when a task involves ${[alias, ...hosts].join(", ")}.`,
  ].join(" ")
  const rules = [...input.guardrails.rules.map((r) => r.text), ...BUILTIN_RULES]
  const snapshot =
    db.settings.writeSnapshotTime && saved?.probe.lastSuccessAt
      ? ` | Snapshot: ${saved.probe.lastSuccessAt.slice(0, 10)}`
      : ""
  const facts = input.facts
  const system = [
    os,
    facts.cpuCores && facts.memoryTotalMiB
      ? `${facts.cpuCores} vCPU / ${Math.round(facts.memoryTotalMiB / 1024)} GB RAM`
      : null,
    facts.panel ? `managed by ${facts.panel.type === "1panel" ? "1Panel" : "aaPanel (BT)"} (${facts.panel.installPath})` : null,
  ].filter(Boolean)
  const resolved = saved?.connection.resolved
  const modeSection =
    mode === "read-only"
      ? [
          "## Mode: read-only",
          "- Only inspection commands are allowed, e.g. `docker ps`, `docker logs --tail 200 <container>`, `df -h`, `free -m`, `uptime`, `ss -tln`.",
          "- No writes of any kind: do not restart or stop containers or services, edit or delete files, install packages, or change the firewall. If a change is needed, describe the plan to the user and stop.",
        ]
      : [
          "## Mode: standard operations",
          "- Routine deployments and service restarts are allowed.",
          `- Ask the user for explicit approval before: deleting data or volumes (including \`docker compose down -v\`), changing the firewall or security groups, stopping critical services${input.services.some((s) => s.critical) ? ` (${input.services.filter((s) => s.critical).map((s) => s.name).join(", ")})` : ""}, changing SSH configuration, or rebooting the host.`,
        ]
  const hasTopology = input.paths.length > 0 || input.services.length > 0
  const hasNotes = input.notes.trim().length > 0
  const body = [
    `# ${alias} — ${input.name || "untitled asset"}`,
    "",
    `> ${env} | Mode: ${mode}${snapshot} | Generated by CloudLink — do not edit`,
    "",
    "## Connect",
    `- Run commands through the system SSH alias: \`ssh ${alias} '<command>'\`. Authentication is handled by the local ssh-agent; never ask for or record passwords, IPs or private keys.`,
    ...(system.length ? [`- System: ${system.join(" | ")}.`] : []),
    ...(summary ? [`- Role: ${summary}`] : []),
    ...(input.export.resolvedConnection && resolved
      ? [`- Resolved connection: HostName ${resolved.hostname}, User ${resolved.user}, Port ${resolved.port}.`]
      : []),
    "",
    ...modeSection,
    "",
    "## Guardrails (must follow)",
    ...rules.map((r, i) => `${i + 1}. ${r}`),
    ...(hasTopology || hasNotes ? ["", "## References (read on demand)"] : []),
    ...(hasTopology ? ["- Key directories, containers and port mappings: read `references/runtime-topology.md`"] : []),
    ...(hasNotes ? ["- Additional notes from the owner: read `references/notes.md`"] : []),
  ]
  const skill = ["---", `name: ${input.slug}`, `description: ${description}`, "---", "", ...body].join("\n")
  const files: CompilePreview["files"] = [{ path: "SKILL.md", content: skill, tokens: estimateTokens(skill) }]
  if (hasTopology) {
    const topo = [
      `# ${alias} runtime topology`,
      "",
      ...(input.paths.length
        ? ["## Key directories", "", "| Purpose | Path |", "| --- | --- |", ...input.paths.map((p) => `| ${p.label} | ${code(p.path)} |`), ""]
        : []),
      ...(input.services.length
        ? [
            "## Services",
            "",
            "| Name | Kind | Image | Ports | Role | Critical |",
            "| --- | --- | --- | --- | --- | --- |",
            ...input.services.map(
              (s) =>
                `| ${code(s.name)} | ${s.kind} | ${input.export.image && s.image ? code(s.image) : "-"} | ${s.ports.map(portText).join(", ") || "-"} | ${s.role ?? "-"}${s.missing ? " (not seen in last probe)" : ""} | ${s.critical ? "yes" : "no"} |`
            ),
            "",
          ]
        : []),
      ...(hosts.length ? ["## Sites served by this host", "", ...hosts.map((h) => `- ${h}`), ""] : []),
      ...(input.export.listeningPorts && input.listeningPorts.length
        ? ["## Listening ports", "", ...input.listeningPorts.map((p) => `- ${p.addr}:${p.port}/${p.proto}`), ""]
        : []),
    ].join("\n")
    files.push({ path: "references/runtime-topology.md", content: topo, tokens: estimateTokens(topo) })
  }
  if (hasNotes) {
    files.push({ path: "references/notes.md", content: input.notes, tokens: estimateTokens(input.notes) })
  }

  const lint: LintItem[] = []
  if (!SLUG.test(input.slug) || input.slug.length > 64) lint.push({ id: "name-format", level: "error", file: "SKILL.md", line: 2 })
  if (input.slug === "synced") lint.push({ id: "reserved-name", level: "error", params: { slug: input.slug }, file: "SKILL.md", line: 2 })
  if (description.length > 1024) lint.push({ id: "description-too-long", level: "error", params: { chars: description.length }, file: "SKILL.md", line: 3 })
  for (const f of files) {
    for (const [rule, re] of SECRET_RULES) {
      const line = findLine(f.content, (l) => re.test(l))
      if (line) lint.push({ id: "secret-detected", level: "error", params: { line, rule }, file: f.path, line })
    }
    if (!input.export.resolvedConnection && resolved) {
      const line = findLine(f.content, (l) => l.includes(resolved.hostname))
      if (line) lint.push({ id: "export-disabled-field", level: "error", params: { field: "HostName" }, file: f.path, line })
    }
  }
  if (body.length > db.settings.bodyLineLimit) {
    lint.push({ id: "body-too-long", level: "warning", params: { lines: body.length, limit: db.settings.bodyLineLimit }, file: "SKILL.md" })
  }
  if (input.envTag === "prod" && mode === "standard" && input.guardrails.rules.length === 0) {
    lint.push({ id: "prod-standard-no-guardrails", level: "warning", file: "SKILL.md", line: findLine(skill, (l) => l.startsWith("## Guardrails")) ?? undefined })
  }
  for (const s of input.services.filter((x) => x.source === "probe" && INJECTION.test(x.name))) {
    const topo = files.find((f) => f.path === "references/runtime-topology.md")
    lint.push({
      id: "suspected-injection",
      level: "warning",
      params: { value: s.name },
      file: topo?.path,
      line: topo ? (findLine(topo.content, (l) => l.includes(s.name)) ?? undefined) : undefined,
    })
  }
  if (saved?.probe.status === "stale" && saved.probe.lastSuccessAt) {
    const days = Math.floor((Date.now() - new Date(saved.probe.lastSuccessAt).getTime()) / (24 * 3600 * 1000))
    lint.push({ id: "probe-stale", level: "info", params: { days } })
  }

  return {
    slug: input.slug,
    mode,
    files,
    budget: {
      resident: estimateTokens(`${input.slug} ${description}`),
      triggered: files[0].tokens,
      onDemand: files.slice(1).reduce((n, f) => n + f.tokens, 0),
      descriptionChars: description.length,
      bodyLines: body.length,
      bodyLineLimit: db.settings.bodyLineLimit,
    },
    lint,
    blocked: lint.some((l) => l.level === "error"),
  }
}

function toInput(a: Asset): AssetInput {
  const rest: Partial<Asset> = { ...a }
  delete rest.probe
  delete rest.createdAt
  delete rest.updatedAt
  return { ...(rest as Asset), connection: { sshAlias: a.connection.sshAlias } }
}

function listSkills(): SkillStatus[] {
  return db.assets.map((a) => {
    const skillId = skillIdOf(a.id)
    const modes = new Set<Mode>([a.guardrails.defaultMode])
    db.mounts.filter((m) => m.skillId === skillId).forEach((m) => modes.add(m.mode))
    return {
      id: skillId,
      slug: a.slug,
      assetId: a.id,
      variants: [...modes].map((mode) => {
        const result = compile(toInput(a), mode)
        return {
          mode,
          lint: result.lint,
          residentTokens: result.budget.resident,
          blocked: result.blocked,
          compiledAt: a.updatedAt,
          path: `${db.settings.dataDir}\\compiled\\${mode}\\${a.slug}`,
        }
      }),
    }
  })
}

// ---------- 探测 ----------

const STEPS: ProbeStep[] = ["resolve-alias", "connect", "collect-system", "collect-services", "collect-ports", "diff"]
const probeRuns = new Map<string, { assetId: string; timers: number[]; diff?: ProbeDiff }>()

function startProbe(assetId: string) {
  const asset = db.assets.find((a) => a.id === assetId) ?? fail("not-found")
  const runId = newId("prb")
  const alias = asset.connection.sshAlias
  const run = { assetId, timers: [] as number[], diff: undefined as ProbeDiff | undefined }
  probeRuns.set(runId, run)
  // sg-db 在「建立连接」一步失败：主机密钥未信任
  const failAt = asset.id === "ast_sg_db" ? 1 : -1
  const stepMs = 3000 / STEPS.length
  const at = (ms: number, fn: () => void) => run.timers.push(window.setTimeout(fn, ms))

  STEPS.forEach((step, i) => {
    if (failAt >= 0 && i > failAt) return
    at(i * stepMs, () => void emit("probe://progress", { runId, assetId, step, status: "running" }))
    at((i + 1) * stepMs - 20, () => {
      const failed = i === failAt
      void emit("probe://progress", { runId, assetId, step, status: failed ? "error" : "done", ms: Math.round(stepMs - 20) })
      if (failed) {
        const error: ProbeError = { id: "host-key-unknown", params: { alias } }
        asset.probe = { ...asset.probe, status: "failed", lastRunId: runId }
        void emit("probe://finished", { runId, assetId, status: "failed", error })
        logActivity({ kind: "probe", assetId, messageId: "probe-failed", params: { alias }, durationMs: (i + 1) * stepMs, ok: false })
        probeRuns.delete(runId)
      } else if (i === STEPS.length - 1) {
        const changes = asset.id === "ast_hk_edge" ? structuredClone(fx.hkEdgeProbeChanges) : []
        run.diff = { changes, durationMs: 3000, finishedAt: now() }
        if (changes.length === 0) asset.probe = { lastRunId: runId, lastSuccessAt: now(), status: "ok" }
        void emit("probe://finished", { runId, assetId, status: "ok", diff: run.diff })
        logActivity({
          kind: "probe",
          assetId,
          messageId: changes.length ? "probe-changes" : "probe-no-changes",
          params: { alias, count: changes.length },
          durationMs: 3000,
          ok: true,
        })
      }
    })
  })
  return { runId }
}

function cancelProbe(runId: string) {
  const run = probeRuns.get(runId)
  if (!run) return
  run.timers.forEach((t) => clearTimeout(t))
  probeRuns.delete(runId)
  void emit("probe://finished", { runId, assetId: run.assetId, status: "cancelled" })
}

function applyProbe(runId: string, changeIds: string[]) {
  const run = probeRuns.get(runId) ?? fail("not-found")
  const asset = db.assets.find((a) => a.id === run.assetId) ?? fail("not-found")
  for (const change of run.diff?.changes ?? []) {
    if (!changeIds.includes(change.id)) continue
    if (change.field === "os" && change.after) asset.facts.os = change.after
    if (change.field === "service" && change.kind === "missing") {
      asset.services = asset.services.map((s) => (s.name === change.label ? { ...s, missing: true } : s))
    }
    if (change.field === "service" && change.kind === "added") {
      asset.services.push({ kind: "docker", name: change.label, image: "my-api:v1.2", ports: [{ hostIp: "127.0.0.1", hostPort: 8080, containerPort: 8080, proto: "tcp" }], critical: false, source: "probe", lastSeenAt: now(), missing: false })
    }
    if (change.field === "listeningPorts" && change.after) {
      asset.listeningPorts = change.after.split(",").map((p) => {
        const [port, proto] = p.trim().split("/")
        return { addr: "0.0.0.0", port: Number(port), proto: proto === "udp" ? "udp" : "tcp" }
      })
    }
  }
  asset.probe = { lastRunId: runId, lastSuccessAt: now(), status: "ok" }
  asset.updatedAt = now()
  probeRuns.delete(runId)
  return publish(asset)
}

/** 保存或应用探测后的编译与发布 */
function publish(asset: Asset) {
  const result = compile(toInput(asset), asset.guardrails.defaultMode)
  void emit("compile://finished", {
    skillId: skillIdOf(asset.id),
    mode: result.mode,
    lint: result.lint,
    tokens: result.budget.resident,
  })
  logActivity({
    kind: "compile",
    assetId: asset.id,
    messageId: result.blocked ? "compile-blocked" : "compile-ok",
    params: { slug: asset.slug, mode: result.mode, count: result.lint.filter((l) => l.level === "error").length },
    durationMs: 40,
    ok: !result.blocked,
  })
  return { asset, lint: result.lint, blocked: result.blocked }
}

// ---------- 资产 ----------

const uniqueSlug = (base: string) => {
  let slug = base
  for (let n = 2; db.assets.some((a) => a.slug === slug); n++) slug = `${base}-${n}`
  return slug
}

function saveAsset(input: AssetInput) {
  if (db.assets.some((a) => a.slug === input.slug && a.id !== input.id)) fail("slug-taken", { slug: input.slug })
  const existing = input.id ? db.assets.find((a) => a.id === input.id) : undefined
  const alias = input.connection.sshAlias
  const definedIn = db.hosts.hosts.find((h) => h.alias === alias)?.definedIn ?? []
  const asset: Asset = existing
    ? {
        ...existing,
        ...input,
        id: existing.id,
        connection: {
          sshAlias: alias,
          definedIn,
          // 别名改了，旧的 ssh -G 快照作废
          resolved: alias === existing.connection.sshAlias ? existing.connection.resolved : null,
        },
        updatedAt: now(),
      }
    : {
        ...input,
        id: newId("ast"),
        connection: { sshAlias: alias, definedIn, resolved: null },
        probe: { lastRunId: null, lastSuccessAt: null, status: "never" },
        createdAt: now(),
        updatedAt: now(),
      }
  if (existing) db.assets[db.assets.indexOf(existing)] = asset
  else db.assets.push(asset)
  const host = db.hosts.hosts.find((h) => h.alias === alias)
  if (host) host.imported = true
  // 重命名迁移（F-101 AC2）：按新 slug 重建这个 Skill 的全部链接
  if (existing && existing.slug !== asset.slug) {
    const skillId = skillIdOf(asset.id)
    db.mounts.forEach((m) => {
      if (m.skillId !== skillId) return
      m.links = m.links.map((l) => ({ ...l, path: l.path.slice(0, l.path.length - existing.slug.length) + asset.slug }))
      m.checkedAt = now()
    })
    emitMounts()
  }
  return publish(asset)
}

function deleteAsset(id: string) {
  const asset = db.assets.find((a) => a.id === id) ?? fail("not-found")
  const skillId = skillIdOf(asset.id)
  const unmounted = db.mounts.filter((m) => m.skillId === skillId)
  db.mounts = db.mounts.filter((m) => m.skillId !== skillId)
  db.assets = db.assets.filter((a) => a.id !== id)
  const host = db.hosts.hosts.find((h) => h.alias === asset.connection.sshAlias)
  if (host && !db.assets.some((a) => a.connection.sshAlias === host.alias)) host.imported = false
  emitMounts()
  return { unmounted }
}

function importHosts(hosts: ImportHost[], probeAfter: boolean) {
  const created = hosts.map((h) => {
    const info = db.hosts.hosts.find((x) => x.alias === h.alias)
    if (info) info.imported = true
    const asset: Asset = {
      id: newId("ast"),
      type: "vps",
      name: h.alias,
      slug: uniqueSlug(`vps-${h.alias}`.toLowerCase().replace(/[^a-z0-9-]+/g, "-")),
      envTag: "dev",
      tags: [],
      summary: "",
      connection: {
        sshAlias: h.alias,
        definedIn: h.definedIn,
        resolved: info?.hostname
          ? { hostname: info.hostname, user: info.user ?? "", port: info.port ?? 22, proxyJump: null, resolvedAt: now() }
          : null,
      },
      facts: {},
      paths: [],
      services: [],
      servedHostnames: [],
      listeningPorts: [],
      guardrails: { defaultMode: db.settings.defaultMode, rules: [] },
      export: { resolvedConnection: false, listeningPorts: false, image: true },
      notes: "",
      probe: { lastRunId: null, lastSuccessAt: null, status: "never" },
      createdAt: now(),
      updatedAt: now(),
    }
    db.assets.push(asset)
    return asset
  })
  // 先让 invoke 返回，再开始推送探测事件
  if (probeAfter) setTimeout(() => created.forEach((a) => startProbe(a.id)), 0)
  return created
}

// ---------- 目标与挂载 ----------

const isWindowsPath = (t: Target) => t.envId === "windows"

function linksFor(target: Target, slug: string): Mount["links"] {
  const copy = target.linkMode === "copy" || (target.linkMode === "auto" && isWindowsPath(target))
  const kind = copy ? "copy" : db.settings.windowsJunction && isWindowsPath(target) ? "junction" : "symlink"
  const sep = isWindowsPath(target) ? "\\" : "/"
  const join = (...parts: string[]) => parts.join(sep)
  if (target.kind === "agent-global") return [{ path: join(target.path, slug), kind }]
  return (target.conventions ?? []).map((c: Convention) => ({
    path: join(target.path, ...CONVENTION_DIRS[c].split("/"), slug),
    kind,
  }))
}

/** F-303 AC2：同一 Skill 在「全局目录」与「同一 Agent 会读取的项目目录」中档位不同 */
function findModeConflict(target: Target, skillId: string, mode: Mode) {
  const sameEnv = db.targets.filter((t) => t.envId === target.envId && t.id !== target.id)
  for (const other of sameEnv) {
    const [global, project] = target.kind === "project" ? [other, target] : [target, other]
    if (global.kind !== "agent-global" || project.kind !== "project" || !global.agent) continue
    const convention = AGENTS[global.agent].convention
    if (!convention || !project.conventions?.includes(convention)) continue
    const existing = db.mounts.find((m) => m.targetId === other.id && m.skillId === skillId)
    if (existing && existing.mode !== mode) {
      return { globalMode: global === target ? mode : existing.mode, agent: global.agent }
    }
  }
  return null
}

async function mount(req: MountRequest) {
  const target = targetById(req.targetId)
  const asset = assetOfSkill(req.skillId)
  if (db.mounts.some((m) => m.targetId === target.id && m.skillId === req.skillId)) {
    fail("already-mounted", { slug: asset.slug })
  }
  const conflict = findModeConflict(target, req.skillId, req.mode)
  if (conflict) {
    fail("mode-conflict", {
      slug: asset.slug,
      agent: conflict.agent,
      globalMode: conflict.globalMode,
      mode: req.mode,
    })
  }
  const aliasOk = asset.connection.definedIn.includes(target.envId)
  if (!req.confirmed) {
    if (asset.envTag === "prod" && target.kind === "agent-global") fail("needs-confirm-prod-global", { slug: asset.slug })
    if (!aliasOk) fail("needs-confirm-alias-missing", { alias: asset.connection.sshAlias, env: target.envId })
  }
  await sleep(400)
  const m: Mount = {
    id: newId("mnt"),
    skillId: req.skillId,
    targetId: target.id,
    mode: req.mode,
    links: linksFor(target, asset.slug),
    status: aliasOk ? "ok" : "alias-missing",
    statusDetail: aliasOk ? undefined : target.envId,
    createdAt: now(),
    checkedAt: now(),
  }
  db.mounts.push(m)
  logActivity({ kind: "mount", assetId: asset.id, messageId: "mount-ok", params: { slug: asset.slug, target: target.label }, durationMs: 400, ok: true })
  emitMounts()
  return m
}

function unmount(mountId: string) {
  const m = mountById(mountId)
  const asset = assetOfSkill(m.skillId)
  db.mounts = db.mounts.filter((x) => x.id !== mountId)
  logActivity({ kind: "unmount", assetId: asset.id, messageId: "unmount-ok", params: { slug: asset.slug, target: targetById(m.targetId).label }, durationMs: 60, ok: true })
  emitMounts()
}

function setMountMode(mountId: string, mode: Mode) {
  const m = mountById(mountId)
  const conflict = findModeConflict(targetById(m.targetId), m.skillId, mode)
  if (conflict) {
    fail("mode-conflict", { slug: assetOfSkill(m.skillId).slug, agent: conflict.agent, globalMode: conflict.globalMode, mode })
  }
  m.mode = mode
  m.checkedAt = now()
  emitMounts()
  return m
}

function repairMount(mountId: string) {
  const m = mountById(mountId)
  // 冲突（用户手写的同名目录）和别名缺失都不是重建链接能解决的
  if (m.status === "broken" || m.status === "stale-copy") m.status = "ok"
  m.checkedAt = now()
  const asset = assetOfSkill(m.skillId)
  logActivity({ kind: "repair", assetId: asset.id, messageId: "repair-ok", params: { slug: asset.slug, target: targetById(m.targetId).label }, durationMs: 90, ok: true })
  emitMounts()
  return m
}

function addProjectTarget(req: AddProjectRequest) {
  const envId = /^\\\\wsl(\$|\.localhost)\\([^\\]+)/i.exec(req.path)
  const t: Target = {
    id: newId("tgt"),
    kind: "project",
    envId: envId ? `wsl:${envId[2]}` : "windows",
    label: req.label,
    path: req.path,
    conventions: req.conventions,
    gitExclude: req.gitExclude,
    linkMode: "auto",
  }
  db.targets.push(t)
  return t
}

function listActivity(q: ActivityQuery) {
  return db.activity
    .filter((a) => (!q.before || a.at < q.before) && (!q.kinds?.length || q.kinds.includes(a.kind)) && (!q.assetId || a.assetId === q.assetId))
    .slice(0, q.limit)
}

// ---------- 分发 ----------

type Args = Record<string, unknown>

const handlers: Record<string, (args: Args) => unknown> = {
  detect_environments: () => db.environments,
  list_ssh_hosts: () => db.hosts,
  list_assets: () => {
    if (failListAssets > 0) {
      failListAssets--
      fail("internal", { message: "database is locked" })
    }
    return db.assets
  },
  save_asset: (a) => saveAsset(a.input as AssetInput),
  delete_asset: (a) => deleteAsset(a.id as string),
  import_hosts: (a) => importHosts(a.hosts as ImportHost[], a.probeAfter as boolean),
  start_probe: (a) => startProbe(a.assetId as string),
  cancel_probe: (a) => cancelProbe(a.runId as string),
  apply_probe: (a) => applyProbe(a.runId as string, a.changeIds as string[]),
  preview_compile: (a) => compile(a.input as AssetInput, a.mode as Mode),
  list_skills: () => listSkills(),
  list_targets: () => db.targets,
  inspect_project: (a) => ({
    path: a.path as string,
    envId: "windows",
    name: String(a.path).split(/[\\/]/).pop() ?? "project",
    isGitRepo: true,
    existingConventions: ["claude"],
  }),
  add_project_target: (a) => addProjectTarget(a.req as AddProjectRequest),
  remove_target: (a) => {
    db.targets = db.targets.filter((t) => t.id !== a.id)
    db.mounts = db.mounts.filter((m) => m.targetId !== a.id)
    emitMounts()
  },
  list_mounts: () => db.mounts,
  mount: (a) => mount(a.req as MountRequest),
  unmount: (a) => unmount(a.mountId as string),
  set_mount_mode: (a) => setMountMode(a.mountId as string, a.mode as Mode),
  check_mounts: () => {
    db.mounts.forEach((m) => (m.checkedAt = now()))
    return db.mounts
  },
  repair_mount: (a) => repairMount(a.mountId as string),
  list_activity: (a) => listActivity(a.q as ActivityQuery),
  get_settings: () => db.settings,
  update_settings: (a) => (db.settings = { ...db.settings, ...(a.patch as Partial<Settings>) }),
  get_probe_script: () => fx.PROBE_SCRIPT,
  // plugin-dialog 的 open({ directory: true })：返回固定路径（PRD P3 任务 4）
  "plugin:dialog|open": () => "D:\\code\\infra-tools",
  "plugin:opener|reveal_item_in_dir": () => null,
}

export function installMocks() {
  mockIPC(
    async (cmd, payload) => {
      const handler = handlers[cmd]
      if (!handler) {
        console.warn(`[mock] 未实现的命令：${cmd}`)
        return null
      }
      await sleep(LATENCY)
      // 返回副本，避免界面层意外改到 Mock 数据库
      return structuredClone(await handler((payload ?? {}) as Args))
    },
    { shouldMockEvents: true }
  )
}
