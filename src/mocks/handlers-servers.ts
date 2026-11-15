// Mock 命令：资源的增删改、导入、分发、档位（F-101、F-102、F-104、F-106、F-303）
import type {
  TrayCopy, AssetConnection, AssetInput, CliAsset, CliAssetInput, ConnectionInput, ImportHost, Mode, ServerAsset, ServerAssetInput } from "@/bindings"
import { CLI_BINARY } from "@/lib/cliProviders"
import { connectionInputOf } from "@/features/servers/serverForm"
import { connectionSignature } from "@/stores/connection"
import { handleOf, selectCanDistribute } from "@/stores/assets"
import { startProbe } from "./handlers-probe"
import { assetById, compileUnits, db, fail, logActivity, newId, now, recompile, saveSnapshot, serverById, sharedAgentKeys } from "./state"

/** 已保存服务器的连接参数，与前端表单交给 save_asset 的形状一致（签名比对用） */
export const connInputOf = connectionInputOf

function checkAlias(alias: string, selfId: string | undefined, input: ConnectionInput) {
  const lower = alias.toLowerCase()
  if (db.assets.some((a) => a.id !== selfId && handleOf(a).toLowerCase() === lower)) fail("alias-taken", { alias })
  if (input.source !== "managed") return
  const clash = db.sshHosts.hosts.find((h) => h.alias.toLowerCase() === lower && h.definedIn.some((e) => input.definedIn.includes(e)))
  if (clash) fail("alias-conflict", { alias, env: clash.definedIn.find((e) => input.definedIn.includes(e))! })
}

function buildConnection(input: ConnectionInput, saved: ServerAsset | undefined): AssetConnection {
  const sig = connectionSignature(input)
  const unchanged = saved && connectionSignature(connInputOf(saved)) === sig
  const passed = db.passedTests.get(sig)
  const verified = unchanged ? saved.connection.verified : passed ? { ok: true, at: passed.at, envIds: [passed.envId] } : null
  if (input.source === "imported") return { ...saved!.connection, verified }
  const keyFiles = Object.values(input.auth.identityFile).filter(Boolean) as string[]
  return {
    source: "managed",
    sshAlias: input.sshAlias,
    host: input.host,
    port: input.port,
    user: input.user,
    proxyJump: input.proxyJump,
    definedIn: input.definedIn,
    auth: {
      ...input.auth,
      generatedByCloudLink: keyFiles.some((k) => db.cloudlinkKeys.has(k)),
      passwordSaved: !!saved && db.passwords.has(saved.id),
    },
    // 与 Rust build_asset 一致：参数未变时保留已解析的事实，改资料/标题不刷新连接快照。
    resolved: unchanged ? saved.connection.resolved : { hostname: input.host, user: input.user, port: input.port, proxyJump: input.proxyJump, resolvedAt: now() },
    verified,
  }
}

/** 同一家的标识：第一个是 cloudflare，之后 cloudflare-2、cloudflare-3…（取第一个没被占用的） */
function nextCliHandle(provider: CliAsset["cliProvider"]): string {
  const taken = new Set(db.assets.map((a) => (a.type === "cli" ? a.handle : a.connection.sshAlias)))
  if (!taken.has(provider)) return provider
  let n = 2
  while (taken.has(`${provider}-${n}`)) n++
  return `${provider}-${n}`
}

/** 云平台资源（F-104）：同一家每个账号一个；新建时记下已检测到的环境状态和向导里勾选的范围 */
function saveCli(input: CliAssetInput) {
  const saved = input.id ? assetById(input.id) : undefined
  if (saved && saved.type !== "cli") fail("not-found")
  const prev = saved as CliAsset | undefined
  const sameAccount = db.assets.some((a) => a.type === "cli" && a.id !== prev?.id && a.cliProvider === input.cliProvider && a.account === input.account)
  if (sameAccount) fail("alias-taken", { alias: input.account ?? input.cliProvider })
  const envs = [...new Set(compileUnits().map((u) => u.envId))]
  const rest = { ...input }
  delete rest.scope
  const asset: CliAsset = {
    ...rest,
    id: prev?.id ?? newId("ast"),
    handle: prev?.handle ?? nextCliHandle(input.cliProvider),
    cli: prev?.cli ?? {
      binary: CLI_BINARY[input.cliProvider],
      envStates: Object.fromEntries(envs.map((e) => [e, db.cliMachine[input.cliProvider][e] ?? { installed: false, authenticated: false, expired: false, checkedAt: now() }])),
      scope: input.scope ?? [],
    },
    agent: prev?.agent ?? { agents: [], mode: input.production ? "read-only" : db.settings.defaultMode },
    createdAt: prev?.createdAt ?? now(),
    updatedAt: now(),
  }
  if (prev) db.assets[db.assets.indexOf(prev)] = asset
  else db.assets.push(asset)
  return saveSnapshot(asset)
}

function saveAsset(input: AssetInput) {
  return input.type === "cli" ? saveCli(input) : saveServer(input)
}

function saveServer(input: ServerAssetInput) {
  const saved = input.id ? serverById(input.id) : undefined
  const alias = input.connection.sshAlias
  checkAlias(alias, saved?.id, input.connection)
  const rest = { ...input }
  delete rest.testId
  const asset: ServerAsset = {
    ...rest,
    id: saved?.id ?? newId("ast"),
    connection: buildConnection(input.connection, saved),
    // 新建时：生产为只读巡检，其他取设置中的默认档位（F-202 AC2）
    agent: saved?.agent ?? { agents: [], mode: input.production ? "read-only" : db.settings.defaultMode },
    probe: saved?.probe ?? { lastRunId: null, lastSuccessAt: null, status: "never" },
    createdAt: saved?.createdAt ?? now(),
    updatedAt: now(),
  }
  if (saved) db.assets[db.assets.indexOf(saved)] = asset
  else db.assets.push(asset)
  if (input.connection.source === "managed") {
    for (const env of input.connection.definedIn) {
      const count = db.assets.filter((a) => a.type === "vps" && a.connection.source === "managed" && a.connection.definedIn.includes(env)).length
      logActivity({ kind: "ssh-config", messageId: "ssh-config-written", params: { env, count }, ok: true })
    }
  }
  return saveSnapshot(asset)
}

function deleteAsset(id: string, opts: { removeGeneratedKey: boolean }) {
  const asset = assetById(id)
  db.assets = db.assets.filter((a) => a.id !== id)
  db.passwords.delete(id)
  db.notes = db.notes.filter((n) => n.assetId !== id)
  db.operations = db.operations.filter((o) => o.assetId !== id)
  if (asset.type === "vps") {
    if (opts.removeGeneratedKey) Object.values(asset.connection.auth?.identityFile ?? {}).forEach((k) => k && db.cloudlinkKeys.delete(k))
    const host = db.sshHosts.hosts.find((h) => h.alias === asset.connection.sshAlias)
    if (host) host.imported = false
    // 域名关联指向这台服务器的，一并清掉
    db.assets.forEach((a) => {
      if (a.type === "cli") a.cli.scope = a.cli.scope.map((x) => (x.linkedAssetId === id ? { ...x, linkedAssetId: undefined } : x))
    })
  }
  return { statuses: recompile() }
}

function importHosts(hosts: ImportHost[], probeAfter: boolean) {
  const created = hosts.map((h) => {
    const info = db.sshHosts.hosts.find((x) => x.alias === h.alias)
    if (info) info.imported = true
    const asset: ServerAsset = {
      id: newId("ast"),
      type: "vps",
      name: h.alias,
      production: true,
      tags: [],
      summary: "",
      connection: {
        source: "imported",
        sshAlias: h.alias,
        definedIn: h.definedIn,
        resolved: info?.hostname ? { hostname: info.hostname, user: info.user ?? "", port: info.port ?? 22, proxyJump: null, resolvedAt: now() } : null,
        verified: null,
      },
      agent: { agents: [], mode: db.settings.defaultMode },
      facts: {},
      paths: [],
      services: [],
      servedHostnames: [],
      listeningPorts: [],
      guardrails: { rules: [] },
      export: { resolvedConnection: false, listeningPorts: false, image: true },
      notes: "",
      probe: { lastRunId: null, lastSuccessAt: null, status: "never" },
      createdAt: now(),
      updatedAt: now(),
    }
    db.assets.push(asset)
    return asset
  })
  recompile({ silent: true })
  // 先让 invoke 返回，再开始推送探测事件；探测成功同时刷新连接验证（F-103 AC8）
  if (probeAfter) setTimeout(() => created.forEach((a) => startProbe(a.id)), 0)
  return created
}

function setDistribute(id: string, agentKey: string, on: boolean) {
  const asset = assetById(id)
  if (!db.targets.some((t) => t.agentKey === agentKey)) fail("not-found")
  const can = selectCanDistribute(asset)
  if (on && !can.ok) fail("cannot-distribute", { reason: can.reason })
  const affectedAgentKeys = sharedAgentKeys(agentKey)
  const rest = asset.agent.agents.filter((k) => !affectedAgentKeys.includes(k))
  asset.agent.agents = on ? [...rest, ...affectedAgentKeys] : rest
  return { ...saveSnapshot(asset), affectedAgentKeys }
}

function setMode(id: string, mode: Mode) {
  const asset = assetById(id)
  asset.agent.mode = mode
  asset.updatedAt = now()
  logActivity({ kind: "mode", assetId: id, messageId: "mode-changed", params: { alias: handleOf(asset), mode }, ok: true })
  return saveSnapshot(asset)
}

/** F-407 AC2：只动处于标准运维的生产资源 */
function allReadOnly() {
  const list = db.assets.filter((a) => a.production && a.agent.mode === "standard")
  for (const a of list) {
    a.agent.mode = "read-only"
    logActivity({ kind: "mode", assetId: a.id, messageId: "mode-changed", params: { alias: handleOf(a), mode: "read-only" }, ok: true })
  }
  if (list.length > 0) recompile()
  return list.map((a) => a.name)
}

type Args = Record<string, unknown>

export const serverHandlers: Record<string, (a: Args) => unknown> = {
  save_asset: (a) => saveAsset(a.input as AssetInput),
  delete_asset: (a) => deleteAsset(a.id as string, a.opts as { removeGeneratedKey: boolean }),
  import_hosts: (a) => importHosts(a.hosts as ImportHost[], a.probeAfter as boolean),
  set_distribute: (a) => setDistribute(a.assetId as string, a.agentKey as string, a.on as boolean),
  set_mode: (a) => setMode(a.assetId as string, a.mode as Mode),
  all_read_only: () => allReadOnly(),
  // 托盘只在桌面版里有；mock 记下文字，e2e 可以检查
  set_tray_copy: (a) => void (db.trayCopy = a.copy as TrayCopy),
  set_window_theme: () => undefined,
}
