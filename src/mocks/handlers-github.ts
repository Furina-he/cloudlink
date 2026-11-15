import type { CliAsset, CliAssetInput, CliEnvState, CliScopeItem, EnvId, GithubConfig, GithubOwner, GithubRepo, GithubScopeRequest, GithubScopeResult, GithubScopeSaveRequest, GithubSnapshot } from "@/bindings"
import { cliEnvStatus } from "@/stores/assets"
import { githubFixture, githubOwners, githubRepositories } from "./fixtures-github"
import { cancelMockExecutions } from "./handlers-execution"
import { cliById, compileUnits, db, fail, logActivity, now, saveSnapshot, sleep } from "./state"

const cached = new Map<string, { at: number; result: GithubScopeResult }>()
const queryKey = (request: GithubScopeRequest) => request.assetId ?? `${request.host ?? "github.com"}:${request.ownerLogin ?? ""}`

function envStates(): Partial<Record<EnvId, CliEnvState>> {
  return Object.fromEntries([...new Set(compileUnits().map((unit) => unit.envId))].map((envId) => [envId, {
    ...(db.cliMachine.github[envId] ?? { installed: false, authenticated: false, expired: false }), checkedAt: now(),
  }]))
}

function legacy(scope: CliScopeItem[]): GithubConfig {
  return { host: "github.com", mode: "manual", selectedRepoIds: scope.filter((repo) => repo.selected).map((repo) => repo.id), excludedRepoIds: [], revision: 1, envStates: {}, migrationPending: true }
}

function authority(config: GithubConfig) {
  return JSON.stringify({ ...config, revision: 0, selectedRepoIds: [...config.selectedRepoIds].sort(), excludedRepoIds: [...config.excludedRepoIds].sort(), envStates: Object.fromEntries(Object.entries(config.envStates).sort(([a], [b]) => a.localeCompare(b)).map(([envId, snapshot]) => [envId, snapshot && { ...snapshot, checkedAt: undefined, reasonId: undefined, repos: [...snapshot.repos].sort((a, b) => a.id.localeCompare(b.id)) }])) })
}

function includes(config: GithubConfig, repo: GithubRepo) {
  return config.owner?.id === repo.ownerId && (config.mode === "auto" ? !config.excludedRepoIds.includes(repo.id) : config.selectedRepoIds.includes(repo.id))
}

function projectScope(config: GithubConfig): CliScopeItem[] {
  const repos = new Map<string, GithubRepo>()
  for (const snapshot of Object.values(config.envStates)) {
    for (const repo of snapshot?.repos ?? []) if (repo.ownerId === config.owner?.id && !repos.has(repo.id)) repos.set(repo.id, repo)
  }
  return [...repos.values()].map((repo) => ({ id: repo.id, kind: "repo", name: repo.name, defaultBranch: repo.defaultBranch, visibility: repo.visibility, selected: repo.selected && includes(config, repo) }))
}

function snapshot(config: GithubConfig, envId: EnvId, state: CliEnvState, oldScope: CliScopeItem[]): GithubSnapshot {
  const ready = cliEnvStatus(state) === "ready"
  const status = ready ? githubFixture.status : "offline"
  const owner = config.owner
  const previous = config.envStates[envId]
  const known = previous?.repos ?? oldScope.map((repo) => ({ id: repo.id, name: repo.name, ownerId: owner?.id ?? "", defaultBranch: repo.defaultBranch, visibility: repo.visibility, selected: repo.selected }))
  const repos = status === "complete" && owner ? githubRepositories(owner).map((repo) => ({ ...repo, selected: includes(config, repo) })) : known.map((repo) => ({ ...repo, selected: repo.selected && includes(config, repo) }))
  return {
    status,
    identity: ready ? { id: "user:U_octo", login: state.account ?? "octo-dev", host: config.host } : previous?.identity,
    owner,
    repos,
    checkedAt: now(),
    reasonId: status === "complete" ? undefined : `github-${status}`,
  }
}

async function getScope(request: GithubScopeRequest): Promise<GithubScopeResult> {
  const asset = request.assetId ? cliById(request.assetId) : undefined
  if (asset && asset.cliProvider !== "github") fail("not-found")
  const key = queryKey(request)
  const previous = cached.get(key)
  if (!request.force && previous && Date.now() - previous.at < 30_000 && (!asset || previous.result.config.revision === asset.github?.revision)) return structuredClone(previous.result)
  const before = asset ? JSON.stringify(asset) : null
  await sleep(180)
  if (asset && (!db.assets.includes(asset) || JSON.stringify(asset) !== before)) fail("cli-scope-failed", { reason: "github-scope-stale" })
  const states = envStates()
  const ready = Object.values(states).some((state) => state && cliEnvStatus(state) === "ready")
  const config: GithubConfig = structuredClone(asset?.github ?? (asset ? legacy(asset.cli.scope) : {
    host: request.host ?? "github.com", mode: "auto", selectedRepoIds: [], excludedRepoIds: [], revision: 1, envStates: {}, migrationPending: false,
  }))
  if (config.host !== "github.com") fail("cli-scope-failed", { reason: "github-host-unavailable" })
  const owners = ready ? structuredClone(githubOwners) : []
  if (!asset) config.owner = owners.find((owner) => owner.login === request.ownerLogin) ?? (!request.ownerLogin ? owners[0] : undefined)
  else if (config.migrationPending && ready && githubFixture.status === "complete" && config.selectedRepoIds.length > 0) {
    const verified = owners.filter((owner) => config.selectedRepoIds.every((id) => githubRepositories(owner).some((repo) => repo.id === id)))
    if (verified.length === 1) { config.owner = verified[0]; config.mode = "manual"; config.migrationPending = false }
  }
  for (const [envId, state] of Object.entries(states) as [EnvId, CliEnvState][]) config.envStates[envId] = snapshot(config, envId, state, asset?.cli.scope ?? [])
  if (asset) {
    const changed = authority(config) !== authority(asset.github ?? legacy(asset.cli.scope))
    if (changed) { config.revision += 1; cancelMockExecutions(asset.id) }
  }
  const scope = config.owner ? projectScope(config) : structuredClone(asset?.cli.scope ?? [])
  if (asset) {
    asset.github = config
    asset.cli.scope = scope
    asset.cli.envStates = states
    asset.updatedAt = now()
    saveSnapshot(asset)
  }
  const result: GithubScopeResult = { assetId: asset?.id, config, owners, scope, envStates: states }
  cached.set(key, { at: Date.now(), result: structuredClone(result) })
  return result
}

/** Used only by the public Mock save_asset handler. New input is rechecked, not copied as facts. */
export function prepareGithubCreate(input: CliAssetInput): Pick<CliAsset, "github" | "account" | "cli"> {
  const states = envStates()
  if (!input.github) {
    return { github: legacy(input.scope ?? []), account: input.account, cli: { binary: "gh", envStates: states, scope: structuredClone(input.scope ?? []) } }
  }
  if (input.github.host !== "github.com") fail("cli-scope-failed", { reason: "github-host-unavailable" })
  if (githubFixture.status !== "complete" || !Object.values(states).some((state) => state && cliEnvStatus(state) === "ready")) fail("cli-scope-failed", { reason: "github-incomplete" })
  const owner: GithubOwner = githubOwners.find((candidate) => candidate.login === input.github?.ownerLogin) ?? fail("cli-account-unavailable")
  if (db.assets.some((asset) => asset.type === "cli" && asset.cliProvider === "github" && asset.github?.host === input.github!.host && asset.github.owner?.id === owner.id)) fail("alias-taken", { alias: owner.login })
  const catalog = githubRepositories(owner)
  if (input.github.selectedRepoIds.some((id) => !catalog.some((repo) => repo.id === id))) fail("cli-scope-failed", { reason: "github-repo-unavailable" })
  const config: GithubConfig = { host: input.github.host, mode: input.github.mode, selectedRepoIds: [...input.github.selectedRepoIds], excludedRepoIds: [...input.github.excludedRepoIds], owner: structuredClone(owner), revision: 1, envStates: {}, migrationPending: false }
  for (const [envId, state] of Object.entries(states) as [EnvId, CliEnvState][]) config.envStates[envId] = snapshot(config, envId, state, [])
  return { github: config, account: owner.login, cli: { binary: "gh", envStates: states, scope: projectScope(config) } }
}

function saveScope(request: GithubScopeSaveRequest) {
  const asset = cliById(request.assetId)
  if (asset.cliProvider !== "github") fail("not-found")
  const previous = asset.github ?? legacy(asset.cli.scope)
  if (previous.revision !== request.expectedRevision) fail("cli-scope-failed", { reason: "github-scope-stale" })
  const config = structuredClone(previous)
  if (config.migrationPending) {
    const owner: GithubOwner = githubOwners.find((candidate) => candidate.login === request.ownerLogin) ?? fail("cli-scope-failed", { reason: "github-incomplete" })
    if (githubFixture.status !== "complete") fail("cli-scope-failed", { reason: "github-incomplete" })
    if (previous.selectedRepoIds.some((id) => !githubRepositories(owner).some((repo) => repo.id === id))) fail("cli-scope-failed", { reason: "legacy-owner-split-required" })
    config.owner = structuredClone(owner)
    config.migrationPending = false
  }
  const complete = !!config.owner && Object.values(config.envStates).every((state) => state?.status === "complete") && githubFixture.status === "complete"
  const before = asset.cli.scope.filter((repo) => repo.selected).map((repo) => repo.id)
  const known: GithubRepo[] = complete && config.owner ? githubRepositories(config.owner) : asset.cli.scope.map((repo) => ({ id: repo.id, name: repo.name, ownerId: config.owner?.id ?? "", selected: repo.selected, defaultBranch: repo.defaultBranch, visibility: repo.visibility }))
  const after = known.filter((repo) => request.mode === "auto" ? !request.excludedRepoIds.includes(repo.id) : request.selectedRepoIds.includes(repo.id)).map((repo) => repo.id)
  const expands = config.owner?.id !== previous.owner?.id || request.mode === "auto" && previous.mode !== "auto" || after.some((id) => !before.includes(id))
  if (!complete && expands) fail("cli-scope-failed", { reason: "github-incomplete" })
  if (request.selectedRepoIds.some((id) => !known.some((repo) => repo.id === id) && !previous.selectedRepoIds.includes(id))) fail("cli-scope-failed", { reason: "github-repo-unavailable" })
  config.mode = request.mode
  config.selectedRepoIds = [...request.selectedRepoIds]
  config.excludedRepoIds = [...request.excludedRepoIds]
  const states = envStates()
  for (const [envId, state] of Object.entries(states) as [EnvId, CliEnvState][]) config.envStates[envId] = snapshot(config, envId, state, asset.cli.scope)
  if (authority(config) !== authority(previous)) { config.revision += 1; cancelMockExecutions(asset.id) }
  asset.github = config
  asset.cli.scope = projectScope(config)
  asset.cli.envStates = states
  asset.updatedAt = now()
  cached.delete(asset.id)
  logActivity({ kind: "cli", assetId: asset.id, messageId: "cli-scope-updated", params: { alias: asset.handle, count: asset.cli.scope.filter((repo) => repo.selected).length }, ok: true })
  return saveSnapshot(asset)
}

export const githubHandlers: Record<string, (args: Record<string, unknown>) => unknown> = {
  get_github_scope: (args) => getScope(args.req as GithubScopeRequest),
  save_github_scope: (args) => saveScope(args.req as GithubScopeSaveRequest),
}
