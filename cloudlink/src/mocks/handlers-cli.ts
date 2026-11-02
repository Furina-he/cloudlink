// Mock 命令：云平台 CLI（F-104）。检测读 db.cliMachine，「打开终端」后把那个环境改成已就绪，模拟用户在终端里装好或登录好
import type { CliEnvState, CliProvider, CliScopeItem, EnvId, ServerAsset } from "@/bindings"
import { CLI_BINARY } from "@/lib/cliProviders"
import { cliAccounts } from "./fixtures"
import { cliById, compileUnits, db, fail, logActivity, now, recompile, sleep } from "./state"
import { cliEnvStatus } from "@/stores/assets"

/** 只检测已启用 Agent 所在的运行环境（F-104 AC1） */
const agentEnvs = (): EnvId[] => [...new Set(compileUnits().map((u) => u.envId))]

const accountOf: Record<CliProvider, string> = { cloudflare: "me@example.com", vercel: "my-team", oracle: "tenancy-demo" }

/** 域名解析指向已录入的服务器时自动标记关联（F-104 AC4）：Mock 用「这台服务器承载的站点属于这个域名」近似 */
function linkZones(items: CliScopeItem[]): CliScopeItem[] {
  const servers = db.assets.filter((a): a is ServerAsset => a.type === "vps")
  return items.map((x) => {
    if (x.kind !== "zone") return x
    const server = servers.find((s) => s.servedHostnames.some((h) => h === x.name || h.endsWith(`.${x.name}`)))
    return { ...x, linkedAssetId: server?.id }
  })
}

async function detect(req: { provider: CliProvider; assetId?: string }) {
  await sleep(400)
  const machine = db.cliMachine[req.provider]
  const checkedAt = now()
  const envStates: Partial<Record<EnvId, CliEnvState>> = {}
  for (const env of agentEnvs()) {
    envStates[env] = { ...(machine[env] ?? { installed: false, authenticated: false, expired: false }), checkedAt }
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
      params: { alias: asset.handle, ready: states.filter((s) => s && cliEnvStatus(s) === "ready").length, total: states.length },
      ok: states.every((s) => s && cliEnvStatus(s) === "ready"),
    })
    recompile()
  }
  return envStates
}

async function refreshScope(req: { provider: CliProvider; assetId?: string }) {
  await sleep(300)
  const items = linkZones(structuredClone(db.cliCatalog[req.provider]))
  if (!req.assetId) return items
  const asset = cliById(req.assetId)
  const merged = items.map((x) => ({ ...x, selected: asset.cli.scope.find((s) => s.id === x.id)?.selected ?? false }))
  asset.cli.scope = merged
  asset.updatedAt = now()
  recompile({ silent: true })
  return merged
}

function setScope(assetId: string, selectedIds: string[]) {
  const asset = cliById(assetId)
  asset.cli.scope = asset.cli.scope.map((x) => ({ ...x, selected: selectedIds.includes(x.id) }))
  asset.updatedAt = now()
  logActivity({ kind: "cli", assetId, messageId: "cli-scope-updated", params: { alias: asset.handle, count: selectedIds.length }, ok: true })
  return { asset, statuses: recompile() }
}

/** 终端里完成安装或登录：这个命令属于哪个 CLI，就把那个 CLI 在这个环境里改成已就绪 */
function openTerminal(req: { envId: EnvId; command: string }) {
  const command = req.command.toLowerCase()
  const provider = (Object.keys(CLI_BINARY) as CliProvider[]).find((p) => command.includes(CLI_BINARY[p]))
  if (!provider) fail("internal", { message: "unknown cli command" })
  db.cliMachine[provider!][req.envId] = { installed: true, version: "1.0.0", path: `${CLI_BINARY[provider!]}`, authenticated: true, expired: false, account: accountOf[provider!], accounts: cliAccounts[accountOf[provider!]], checkedAt: now() }
}

type Args = Record<string, unknown>

export const cliHandlers: Record<string, (a: Args) => unknown> = {
  detect_cli_environment: (a) => detect(a.req as { provider: CliProvider; assetId?: string }),
  refresh_cli_scope: (a) => refreshScope(a.req as { provider: CliProvider; assetId?: string }),
  set_cli_scope: (a) => setScope(a.assetId as string, a.selectedIds as string[]),
  open_env_terminal: (a) => openTerminal(a.req as { envId: EnvId; command: string }),
}
