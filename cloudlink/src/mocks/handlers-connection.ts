// Mock 命令：测试连接、主机指纹、密码与密钥、托管 ssh 配置（F-106、F-107、F-108）
import { emit } from "@tauri-apps/api/event"

import type { ConnectionTestedEvent, ConnectionTestRequest, EnvId, SshError } from "@/bindings"
import { connectionSignature } from "@/stores/connection"
import { connInputOf } from "./handlers-servers"
import { assetById, db, fail, logActivity, newId, now, recompile, sleep } from "./state"

interface Run {
  req: ConnectionTestRequest
  envId: EnvId
  key: string
  alias: string
  timers: number[]
}
const runs = new Map<string, Run>()

/** 假指纹：同一个地址总是同一个值 */
function fingerprint(host: string) {
  let h = 2166136261
  for (const ch of host) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  return `SHA256:${btoa(String(h >>> 0).repeat(4)).replace(/=+$/, "").slice(0, 43)}`
}

/** 新建表单里地址含 timeout 超时、含 refused 被拒，用户为 bad 认证失败，其余成功；首次测试新地址先返回待确认的指纹（PRD 7.8） */
function authResult(run: Run): SshError | null {
  const c = run.req.connection
  if (c.source === "imported") return null
  const alias = run.alias
  if (c.user === "bad") return { id: "auth-failed", params: { alias } }
  if (c.auth.method === "password" && run.req.password === "wrong") return { id: "password-rejected", params: { alias } }
  if (c.auth.method === "key") {
    const path = c.auth.identityFile[run.envId]
    if (!path) return { id: "key-not-found", params: { alias, path: "—" } }
    if (run.envId.startsWith("wsl:") && path.startsWith("/mnt/")) return { id: "key-permissions", params: { alias } }
  }
  return null
}

function finish(testId: string, e: Omit<ConnectionTestedEvent, "testId">) {
  const run = runs.get(testId)
  if (!run) return
  if (e.status !== "host-key") runs.delete(testId)
  void emit("connection://tested", { testId, ...e })
  if (e.status !== "ok" && e.status !== "failed") return
  const sig = connectionSignature(run.req.connection)
  if (e.status === "ok") db.passedTests.set(sig, { at: now(), envId: run.envId })
  // 参数与已保存的一致时才更新这台服务器的验证结果（F-106）
  const saved = run.req.assetId ? db.assets.find((a) => a.id === run.req.assetId) : undefined
  if (saved && connectionSignature(connInputOf(saved)) === sig) {
    saved.connection.verified = { ok: e.status === "ok", at: now(), envIds: [run.envId] }
  }
  logActivity({
    kind: "connection",
    assetId: saved?.id,
    messageId: e.status === "ok" ? "test-ok" : "test-failed",
    params: { alias: run.alias, ms: e.ms ?? 0, error: e.error?.id ?? "" },
    durationMs: e.ms,
    ok: e.status === "ok",
  })
}

function continueAuth(testId: string) {
  const run = runs.get(testId)
  if (!run) return
  run.timers.push(
    window.setTimeout(() => {
      const err = authResult(run)
      finish(testId, err ? { status: "failed", ms: 900, error: err } : { status: "ok", ms: 820, remoteOs: run.req.assetId === "ast_dev_box" ? "Ubuntu 22.04.4 LTS" : "Ubuntu 24.04 LTS" })
    }, 700)
  )
}

function testConnection(req: ConnectionTestRequest) {
  const testId = newId("tst")
  const c = req.connection
  const saved = req.assetId ? db.assets.find((a) => a.id === req.assetId) : undefined
  const envId = req.envId ?? (c.source === "managed" ? c.definedIn[0] : saved?.connection.definedIn[0]) ?? "windows"
  const host = c.source === "managed" ? c.host : c.sshAlias
  const run: Run = { req, envId, key: `${envId}:${host}`, alias: c.sshAlias || host, timers: [] }
  runs.set(testId, run)
  const at = (ms: number, fn: () => void) => run.timers.push(window.setTimeout(fn, ms))
  if (host.includes("timeout")) at(1500, () => finish(testId, { status: "failed", ms: 10000, error: { id: "timeout", params: { alias: run.alias } } }))
  else if (host.includes("refused")) at(500, () => finish(testId, { status: "failed", ms: 120, error: { id: "connection-refused", params: { alias: run.alias } } }))
  else if (host.includes("mitm")) at(600, () => finish(testId, { status: "host-key", hostKey: { fingerprint: fingerprint(host), known: "changed" } }))
  else if (!db.trusted.has(run.key)) at(600, () => finish(testId, { status: "host-key", hostKey: { fingerprint: fingerprint(host), known: "new" } }))
  else continueAuth(testId)
  return { testId }
}

function trustHostKey(testId: string) {
  const run = runs.get(testId) ?? fail("not-found")
  db.trusted.add(run.key)
  continueAuth(testId)
}

function cancelTest(testId: string) {
  const run = runs.get(testId)
  if (!run) return
  run.timers.forEach((t) => clearTimeout(t))
  runs.delete(testId)
  void emit("connection://tested", { testId, status: "cancelled" })
}

function setPassword(assetId: string, password: string | null) {
  const asset = assetById(assetId)
  if (password) db.passwords.set(assetId, password)
  else db.passwords.delete(assetId)
  if (asset.connection.auth) asset.connection.auth.passwordSaved = !!password
}

/** 改用密钥登录（F-108 AC1）：生成 ed25519、安装公钥、切换为私钥文件并重新测试 */
async function convertToKey(assetId: string) {
  const asset = assetById(assetId)
  if (!db.passwords.has(assetId)) fail("password-missing")
  await sleep(1200)
  const alias = asset.connection.sshAlias
  const files = { windows: `C:\\Users\\me\\.ssh\\cloudlink_${alias}`, "wsl:Ubuntu-24.04": `/home/me/.ssh/cloudlink_${alias}` }
  Object.values(files).forEach((f) => db.cloudlinkKeys.add(f))
  asset.connection.auth = { method: "key", identityFile: files, generatedByCloudLink: true, passwordSaved: true }
  asset.connection.verified = { ok: true, at: now(), envIds: ["windows"] }
  if (asset.connection.host) db.trusted.add(`windows:${asset.connection.host}`)
  recompile()
  return asset
}

/** 复制到 WSL（F-108 AC4）：重名时加 -2 后缀，不覆盖 */
function copyKeyToWsl(req: { source: string; envId: EnvId }) {
  if (!req.source.trim()) fail("source-missing", { path: req.source })
  const name = req.source.split(/[\\/]/).pop() || "id_ed25519"
  const existing = new Set(["/home/me/.ssh/id_ed25519", ...db.cloudlinkKeys])
  let path = `/home/me/.ssh/${name}`
  for (let n = 2; existing.has(path); n++) path = `/home/me/.ssh/${name}-${n}`
  db.cloudlinkKeys.add(path)
  return { path }
}

function addInclude(envId: EnvId) {
  const status = db.sshConfig.find((s) => s.envId === envId) ?? fail("not-found")
  status.included = true
  const env = db.environments.find((e) => e.id === envId)
  if (env) env.managedSshConfig.included = true
  if (!db.settings.sshIncludeAsked.includes(envId)) db.settings.sshIncludeAsked.push(envId)
  logActivity({ kind: "ssh-config", messageId: "ssh-include-added", params: { env: envId }, ok: true })
  recompile()
  return status
}

type Args = Record<string, unknown>

export const connectionHandlers: Record<string, (a: Args) => unknown> = {
  test_connection: (a) => testConnection(a.req as ConnectionTestRequest),
  cancel_connection_test: (a) => cancelTest(a.testId as string),
  trust_host_key: (a) => trustHostKey(a.testId as string),
  set_password: (a) => setPassword(a.assetId as string, a.password as string | null),
  convert_to_key_auth: (a) => convertToKey(a.assetId as string),
  copy_key_to_wsl: (a) => copyKeyToWsl(a.req as { source: string; envId: EnvId }),
  get_ssh_config_status: () => db.sshConfig,
  add_ssh_include: (a) => addInclude(a.envId as EnvId),
}
