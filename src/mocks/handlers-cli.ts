// Mock 命令：云平台 CLI（F-104）。检测读 db.cliMachine；一键安装登录按阶段发事件，最后把那个环境改成已就绪
import { emit } from "@tauri-apps/api/event"
import type {
  CliEnvState,
  CliProvider,
  CliScopeItem,
  CliSetupState,
  CliSetupStep,
  CloudScopeConfig,
  CloudScopeSaveRequest,
  EnvId,
  ServerAsset,
  GithubScopeResult,
} from "@/bindings"
import { CLI_BINARY, installMethods } from "@/lib/cliProviders"
import { cliAccounts } from "./fixtures"
import { githubHandlers } from "./handlers-github"
import { cancelMockExecutions } from "./handlers-execution"
import {
  cliById,
  compileUnits,
  db,
  fail,
  logActivity,
  now,
  recompile,
  saveSnapshot,
  scenario,
  sleep,
} from "./state"
import { cliEnvStatus } from "@/stores/assets"

/** 只检测已启用 Agent 所在的运行环境（F-104 AC1） */
const agentEnvs = (): EnvId[] => [
  ...new Set(compileUnits().map((u) => u.envId)),
]

const accountOf: Record<CliProvider, string> = {
  cloudflare: "me@example.com",
  vercel: "my-team",
  oracle: "tenancy-demo",
  github: "octo-dev",
}
type CliRequest = { provider: CliProvider; assetId?: string; account?: string }

function requestAccount(req: CliRequest): string | undefined {
  if (!req.assetId) return req.account
  const asset = cliById(req.assetId)
  if (asset.cliProvider !== req.provider) fail("not-found")
  return asset.account ?? undefined
}

/** 域名解析指向已录入的服务器时自动标记关联（F-104 AC4）：Mock 用「这台服务器承载的站点属于这个域名」近似 */
function linkZones(items: CliScopeItem[]): CliScopeItem[] {
  const servers = db.assets.filter((a): a is ServerAsset => a.type === "vps")
  return items.map((x) => {
    if (x.kind !== "zone") return x
    const server = servers.find((s) =>
      s.servedHostnames.some((h) => h === x.name || h.endsWith(`.${x.name}`))
    )
    return { ...x, linkedAssetId: server?.id }
  })
}

async function detect(req: CliRequest) {
  await sleep(400)
  const machine = db.cliMachine[req.provider]
  const checkedAt = now()
  const envStates: Partial<Record<EnvId, CliEnvState>> = {}
  const account = requestAccount(req)
  for (const env of agentEnvs()) {
    const state = {
      ...(machine[env] ?? {
        installed: false,
        authenticated: false,
        expired: false,
      }),
      checkedAt,
    }
    if (account && req.provider !== "github")
      state.authenticated &&= (
        state.accounts ?? (state.account ? [state.account] : [])
      ).includes(account)
    envStates[env] = state
  }
  if (req.assetId) {
    const asset = cliById(req.assetId)
    asset.cli.envStates = envStates
    asset.updatedAt = now()
    const states = Object.values(envStates)
    logActivity({
      kind: "cli",
      assetId: asset.id,
      messageId: "cli-detected",
      params: {
        alias: asset.handle,
        ready: states.filter((s) => s && cliEnvStatus(s) === "ready").length,
        total: states.length,
      },
      ok: states.every((s) => s && cliEnvStatus(s) === "ready"),
    })
    recompile()
  }
  return envStates
}

async function refreshScope(req: CliRequest) {
  if (req.provider === "github") {
    const result = await githubHandlers.get_github_scope({ req: { assetId: req.assetId, ownerLogin: req.assetId ? undefined : req.account, force: true } }) as GithubScopeResult
    return result.scope
  }
  await sleep(300)
  if (scenario === "cli-scope-failed") {
    if (req.assetId) {
      const asset = cliById(req.assetId)
      const cfg: CloudScopeConfig = asset.cloudScope ?? {
        mode: "manual",
        selectedIds: asset.cli.scope.filter((s) => s.selected).map((s) => s.id),
        excludedIds: [],
        snapshotStatus: "complete",
        revision: 1,
      }
      asset.cloudScope = { ...cfg, snapshotStatus: "failed", snapshotErrorId: "cli-command-unsupported", checkedAt: now() }
      asset.updatedAt = now()
    }
    fail("cli-command-unsupported")
  }
  const ready = agentEnvs()
    .map((env) => db.cliMachine[req.provider][env])
    .filter((state) => state && cliEnvStatus(state) === "ready")
  const account =
    requestAccount(req) ?? ready[0]?.accounts?.[0] ?? ready[0]?.account
  if (
    !account ||
    !ready.some(
      (state) =>
        state &&
        (state.accounts ?? (state.account ? [state.account] : [])).includes(
          account
        )
    )
  )
    fail("cli-account-unavailable")
  const catalog = structuredClone(db.cliCatalog[req.provider]).map((item) => ({
    ...item,
    // 默认账号保持既有夹具 ID；第二个账号有自己的 catalog，不能复用默认账号的勾选。
    id: account === accountOf[req.provider] ? item.id : `${account}:${item.id}`,
    selected: false,
  }))
  const items = linkZones(catalog)
  if (!req.assetId) return items
  const asset = cliById(req.assetId)
  const cfg: CloudScopeConfig = asset.cloudScope ?? {
    mode: "manual",
    selectedIds: asset.cli.scope.filter((s) => s.selected).map((s) => s.id),
    excludedIds: [],
    snapshotStatus: "complete",
    revision: 1,
  }
  const merged = items.map((x) => ({
    ...x,
    selected: cfg.mode === "auto" ? !cfg.excludedIds.includes(x.id) : cfg.selectedIds.includes(x.id),
  }))
  asset.cli.scope = merged
  asset.cloudScope = { ...cfg, snapshotStatus: "complete", snapshotErrorId: undefined, checkedAt: now() }
  asset.updatedAt = now()
  recompile({ silent: true })
  return merged
}

async function saveCloudScope(req: CloudScopeSaveRequest) {
  const asset = cliById(req.assetId)
  if (asset.cliProvider === "github") fail("not-found")
  const old: CloudScopeConfig = asset.cloudScope ?? {
    mode: "manual",
    selectedIds: asset.cli.scope.filter((s) => s.selected).map((s) => s.id),
    excludedIds: [],
    snapshotStatus: "complete",
    revision: 1,
  }
  if (old.revision !== req.expectedRevision) fail("cli-scope-failed", { reason: "revision-changed" })
  const known = new Set(asset.cli.scope.map((s) => s.id))
  if (req.mode === "manual" && req.selectedIds.some((id) => !known.has(id))) fail("cli-scope-failed")
  if (req.mode === "auto" && req.excludedIds.some((id) => !known.has(id) && !old.excludedIds.includes(id))) fail("cli-scope-failed")
  const selectedIds = req.mode === "manual" ? [...new Set(req.selectedIds)].sort() : []
  const excludedIds = req.mode === "auto" ? [...new Set(req.excludedIds)].sort() : []
  const same =
    old.mode === req.mode &&
    JSON.stringify([...old.selectedIds].sort()) === JSON.stringify(selectedIds) &&
    JSON.stringify([...old.excludedIds].sort()) === JSON.stringify(excludedIds)
  if (!same) cancelMockExecutions(req.assetId)
  const next: CloudScopeConfig = {
    ...old,
    mode: req.mode,
    selectedIds,
    excludedIds,
    revision: same ? old.revision : old.revision + 1,
  }
  asset.cloudScope = next
  asset.cli.scope = asset.cli.scope.map((x) => ({
    ...x,
    selected: next.mode === "auto" ? !next.excludedIds.includes(x.id) : next.selectedIds.includes(x.id),
  }))
  asset.updatedAt = now()
  logActivity({
    kind: "cli",
    assetId: req.assetId,
    messageId: "cli-scope-updated",
    params: { alias: asset.handle, count: asset.cli.scope.filter((x) => x.selected).length },
    ok: true,
  })
  return saveSnapshot(asset)
}

async function setScope(assetId: string, selectedIds: string[]) {
  const asset = cliById(assetId)
  if (asset.cliProvider === "github") {
    const result = await githubHandlers.get_github_scope({ req: { assetId, force: false } }) as GithubScopeResult
    return githubHandlers.save_github_scope({ req: { assetId, expectedRevision: result.config.revision, mode: result.config.mode, selectedRepoIds: selectedIds, excludedRepoIds: result.config.mode === "auto" ? result.scope.filter((repo) => !selectedIds.includes(repo.id)).map((repo) => repo.id) : result.config.excludedRepoIds } })
  }
  if (selectedIds.some((id) => !asset.cli.scope.some((item) => item.id === id)))
    fail("cli-scope-failed")
  if (asset.cli.scope.some((item) => item.selected !== selectedIds.includes(item.id))) cancelMockExecutions(assetId)
  asset.cli.scope = asset.cli.scope.map((x) => ({
    ...x,
    selected: selectedIds.includes(x.id),
  }))
  asset.updatedAt = now()
  logActivity({
    kind: "cli",
    assetId,
    messageId: "cli-scope-updated",
    params: { alias: asset.handle, count: selectedIds.length },
    ok: true,
  })
  return saveSnapshot(asset)
}

/** 一键安装登录（F-104 AC2，P9b）：固定命令由后端表决定；Mock 只用阶段事件模拟终端结果 */
function startSetup(req: { provider: CliProvider; envId: EnvId; method: string }) {
  const machine = db.cliMachine[req.provider]
  if (!agentEnvs().includes(req.envId)) fail("terminal-command-invalid")
  if (!machine[req.envId]) fail("terminal-command-invalid")
  if (!installMethods(req.provider, req.envId).some((method) => method.id === req.method)) fail("terminal-command-invalid")
  const current = machine[req.envId] as CliEnvState
  const id = `setup_${Math.random().toString(16).slice(2)}`
  const installed = current.installed
  const initial: CliSetupState = installed ? "waiting-login" : "waiting-install"
  const changed = (state: CliSetupState, step?: CliSetupStep) =>
    void emit("cli-setup://changed", { id, provider: req.provider, envId: req.envId, state, step })
  const ready = () => {
    db.cliMachine[req.provider][req.envId] = {
      installed: true,
      version: "1.0.0",
      path: CLI_BINARY[req.provider],
      authenticated: true,
      expired: false,
      account: accountOf[req.provider],
      accounts: cliAccounts[accountOf[req.provider]],
      checkedAt: now(),
    }
    changed("ready")
  }
  // P9 截图用慢速场景：让等待安装／等待登录各停留几秒
  const slow = scenario === "cli-setup-slow"
  if (scenario === "cli-setup-failed") {
    setTimeout(() => changed("failed", installed ? "login" : "install"), 900)
  } else if (installed) {
    setTimeout(() => changed("waiting-login"), 300)
    setTimeout(ready, slow ? 6000 : 900)
  } else {
    setTimeout(() => {
      machine[req.envId] = { ...current, installed: true, version: "1.0.0" }
      changed("waiting-login")
    }, slow ? 2500 : 600)
    setTimeout(ready, slow ? 7000 : 1200)
  }
  return { id, state: initial }
}

type Args = Record<string, unknown>

export const cliHandlers: Record<string, (a: Args) => unknown> = {
  detect_cli_environment: (a) => detect(a.req as CliRequest),
  start_cli_setup: (a) =>
    startSetup(a.req as { provider: CliProvider; envId: EnvId; method: string }),
  refresh_cli_scope: (a) => refreshScope(a.req as CliRequest),
  set_cli_scope: (a) =>
    setScope(a.assetId as string, a.selectedIds as string[]),
  save_cloud_scope: (a) => saveCloudScope(a.req as CloudScopeSaveRequest),
}
