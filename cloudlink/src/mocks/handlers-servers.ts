// Mock 命令：服务器的增删改、导入、分发开关、档位、临时解锁（F-101、F-102、F-106、F-303、F-306 AC2）
import type { Asset, AssetConnection, AssetInput, ConnectionInput, ImportHost, Mode } from "@/bindings"
import { connectionInputOf } from "@/features/servers/serverForm"
import { connectionSignature } from "@/stores/connection"
import { selectCanDistribute } from "@/stores/assets"
import { startProbe } from "./handlers-probe"
import { assetById, db, fail, logActivity, newId, now, recompile } from "./state"

/** 已保存服务器的连接参数，与前端表单交给 save_asset 的形状一致（签名比对用） */
export const connInputOf = connectionInputOf

function checkAlias(alias: string, selfId: string | undefined, input: ConnectionInput) {
  const lower = alias.toLowerCase()
  if (db.assets.some((a) => a.id !== selfId && a.connection.sshAlias.toLowerCase() === lower)) fail("alias-taken", { alias })
  if (input.source !== "managed") return
  const clash = db.sshHosts.hosts.find((h) => h.alias.toLowerCase() === lower && h.definedIn.some((e) => input.definedIn.includes(e)))
  if (clash) fail("alias-conflict", { alias, env: clash.definedIn.find((e) => input.definedIn.includes(e))! })
}

function buildConnection(input: ConnectionInput, saved: Asset | undefined): AssetConnection {
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
    // 写入后用 ssh -G 回读（F-107 AC4）
    resolved: { hostname: input.host, user: input.user, port: input.port, proxyJump: input.proxyJump, resolvedAt: now() },
    verified,
  }
}

function saveAsset(input: AssetInput) {
  const saved = input.id ? assetById(input.id) : undefined
  const alias = input.connection.sshAlias
  checkAlias(alias, saved?.id, input.connection)
  const rest = { ...input }
  delete rest.testId
  const asset: Asset = {
    ...rest,
    id: saved?.id ?? newId("ast"),
    connection: buildConnection(input.connection, saved),
    // 新建时：生产为只读巡检，其他取设置中的默认档位（F-202 AC2）
    agent: saved?.agent ?? { agents: [], mode: input.envTag === "prod" ? "read-only" : db.settings.defaultMode, unlockedUntil: null },
    probe: saved?.probe ?? { lastRunId: null, lastSuccessAt: null, status: "never" },
    createdAt: saved?.createdAt ?? now(),
    updatedAt: now(),
  }
  if (saved) db.assets[db.assets.indexOf(saved)] = asset
  else db.assets.push(asset)
  if (input.connection.source === "managed") {
    for (const env of input.connection.definedIn) {
      const count = db.assets.filter((a) => a.connection.source === "managed" && a.connection.definedIn.includes(env)).length
      logActivity({ kind: "ssh-config", messageId: "ssh-config-written", params: { env, count }, ok: true })
    }
  }
  return { asset, statuses: recompile() }
}

function deleteAsset(id: string, opts: { removeGeneratedKey: boolean }) {
  const asset = assetById(id)
  db.assets = db.assets.filter((a) => a.id !== id)
  db.passwords.delete(id)
  db.notes = db.notes.filter((n) => n.assetId !== id)
  db.operations = db.operations.filter((o) => o.assetId !== id)
  if (opts.removeGeneratedKey) Object.values(asset.connection.auth?.identityFile ?? {}).forEach((k) => k && db.cloudlinkKeys.delete(k))
  const host = db.sshHosts.hosts.find((h) => h.alias === asset.connection.sshAlias)
  if (host) host.imported = false
  return { statuses: recompile() }
}

function importHosts(hosts: ImportHost[], probeAfter: boolean) {
  const created = hosts.map((h) => {
    const info = db.sshHosts.hosts.find((x) => x.alias === h.alias)
    if (info) info.imported = true
    const asset: Asset = {
      id: newId("ast"),
      type: "vps",
      name: h.alias,
      envTag: "dev",
      tags: [],
      summary: "",
      connection: {
        source: "imported",
        sshAlias: h.alias,
        definedIn: h.definedIn,
        resolved: info?.hostname ? { hostname: info.hostname, user: info.user ?? "", port: info.port ?? 22, proxyJump: null, resolvedAt: now() } : null,
        verified: null,
      },
      agent: { agents: [], mode: db.settings.defaultMode, unlockedUntil: null },
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
  const rest = asset.agent.agents.filter((k) => k !== agentKey)
  asset.agent.agents = on ? [...rest, agentKey] : rest
  recompile()
  return db.inclusions.filter((i) => i.assetId === id)
}

function setMode(id: string, mode: Mode) {
  const asset = assetById(id)
  asset.agent.mode = mode
  asset.updatedAt = now()
  return { asset, statuses: recompile() }
}

function unlock(id: string) {
  const asset = assetById(id)
  asset.agent.unlockedUntil = new Date(Date.now() + 30 * 60 * 1000).toISOString()
  logActivity({ kind: "unlock", assetId: id, messageId: "unlocked", params: { alias: asset.connection.sshAlias }, ok: true })
  return { unlockedUntil: asset.agent.unlockedUntil }
}

function lock(id: string) {
  const asset = assetById(id)
  const expired = !!asset.agent.unlockedUntil && new Date(asset.agent.unlockedUntil).getTime() <= Date.now()
  asset.agent.unlockedUntil = null
  logActivity({ kind: "unlock", assetId: id, messageId: expired ? "lock-expired" : "locked", params: { alias: asset.connection.sshAlias }, ok: true })
}

type Args = Record<string, unknown>

export const serverHandlers: Record<string, (a: Args) => unknown> = {
  save_asset: (a) => saveAsset(a.input as AssetInput),
  delete_asset: (a) => deleteAsset(a.id as string, a.opts as { removeGeneratedKey: boolean }),
  import_hosts: (a) => importHosts(a.hosts as ImportHost[], a.probeAfter as boolean),
  set_distribute: (a) => setDistribute(a.assetId as string, a.agentKey as string, a.on as boolean),
  set_mode: (a) => setMode(a.assetId as string, a.mode as Mode),
  unlock_server: (a) => unlock(a.assetId as string),
  lock_server: (a) => lock(a.assetId as string),
}
