import { create } from "zustand"

import type {
  Asset,
  AssetAgent,
  AssetInput,
  CliAsset,
  CliEnvState,
  CliScopeItem,
  DeleteResult,
  DistributeBlockReason,
  DistributeResult,
  EnvId,
  ImportHost,
  IpcError,
  Mode,
  SaveResult,
  ServerAsset,
} from "@/bindings"
import { ipc, toIpcError } from "@/lib/ipc"
import { useDeliveryStore } from "./deliveries"
import { useSkillStore } from "./skills"

export type LoadStatus = "idle" | "loading" | "ready" | "error"

interface AssetState {
  byId: Record<string, Asset>
  ids: string[]
  status: LoadStatus
  error: IpcError | null
  /** 本次会话里最近一次保存的时间，详情头部据此显示「已保存，已编译」 */
  lastSaved: Record<string, string>
  /** 刚新建或导入的资源：资源行短暂高亮（中性底色，约 2.4 秒，PRD 6.5、7.7） */
  freshIds: string[]
  /** 再高亮一次：添加流程在保存之后还要装密钥、同步，关闭弹窗时才让新行亮起来 */
  flash: (ids: string[]) => void

  load: () => Promise<void>
  /** 不显示加载中，静默拉一次全集（测试连接、探测之后） */
  refresh: () => Promise<void>
  /** 返回编译结果；失败时抛出 IpcError。同资源的保存串行发送。 */
  save: (input: AssetInput) => Promise<SaveResult>
  /** 轮到发送时读取最新资源并构造输入；与 save 共用按 id 的队列。 */
  update: (id: string, build: (latest: Asset) => AssetInput) => Promise<SaveResult>
  remove: (id: string, removeGeneratedKey: boolean) => Promise<DeleteResult>
  importHosts: (hosts: ImportHost[], probeAfter: boolean) => Promise<Asset[]>
  /** 立即生效，不经过保存（PRD 6.4）。失败时回滚并抛出 */
  /** 授权与共用成员、实际送达以后端完整快照为准（P8a）。 */
  setDistribute: (id: string, agentKey: string, on: boolean) => Promise<DistributeResult>
  setMode: (id: string, mode: Mode) => Promise<void>
  /** 范围勾选立即生效（PRD 6.4）；乐观更新，失败时恢复 */
  setCliScope: (id: string, selectedIds: string[]) => Promise<void>
  _upsert: (asset: Asset) => void
  _patchAgent: (id: string, patch: Partial<AssetAgent>) => void
}

const markFresh = (set: (fn: (s: AssetState) => Partial<AssetState>) => void, ids: string[]) => {
  set(() => ({ freshIds: ids }))
  setTimeout(() => set((s) => (s.freshIds === ids ? { freshIds: [] } : {})), 2400)
}

export const useAssetStore = create<AssetState>()((set, get) => {
  const pending = new Map<string, Promise<void>>()
  const enqueue = <T,>(id: string, run: () => Promise<T>): Promise<T> => {
    const task = (pending.get(id) ?? Promise.resolve()).then(run)
    // 尾节点始终完成，单次失败仍返回调用方，但不能阻塞之后的保存。
    const settled = task.then(() => undefined, () => undefined)
    pending.set(id, settled)
    void settled.then(() => { if (pending.get(id) === settled) pending.delete(id) })
    return task
  }
  // 只能由队列内调用；新建无持久化 id 时直接沿用原流程。
  const persist = async (input: AssetInput): Promise<SaveResult> => {
    let result: SaveResult
    try {
      result = await ipc.saveAsset(input)
    } catch (e) {
      throw toIpcError(e)
    }
    get()._upsert(result.asset)
    useSkillStore.getState()._onCompiled(result.statuses)
    useDeliveryStore.getState()._onChanged(result)
    set((s) => ({ lastSaved: { ...s.lastSaved, [result.asset.id]: new Date().toISOString() } }))
    if (!input.id) markFresh(set, [result.asset.id])
    return result
  }

  return {
    byId: {},
    ids: [],
    status: "idle",
    error: null,
    lastSaved: {},
    freshIds: [],
    flash: (ids) => markFresh(set, ids),

    load: async () => {
      set({ status: "loading", error: null })
      try {
        const list = await ipc.listAssets()
        set({ byId: Object.fromEntries(list.map((a) => [a.id, a])), ids: list.map((a) => a.id), status: "ready" })
      } catch (e) {
        set({ status: "error", error: toIpcError(e) })
      }
    },

    refresh: async () => {
      try {
        const list = await ipc.listAssets()
        set({ byId: Object.fromEntries(list.map((a) => [a.id, a])), ids: list.map((a) => a.id) })
      } catch {
        // 静默刷新失败不打断用户；下一次事件或重新聚焦时再同步
      }
    },

    save: (input) => input.id ? enqueue(input.id, () => persist(input)) : persist(input),

    update: (id, build) => enqueue(id, () => {
      const latest = get().byId[id]
      if (!latest) throw { id: "not-found" } satisfies IpcError
      return persist({ ...build(latest), id })
    }),

    remove: (id, removeGeneratedKey) => enqueue(id, async () => {
      let result: DeleteResult
      try {
        result = await ipc.deleteAsset(id, { removeGeneratedKey })
      } catch (e) {
        throw toIpcError(e)
      }
      set((s) => {
        const byId = { ...s.byId }
        delete byId[id]
        return { byId, ids: s.ids.filter((x) => x !== id) }
      })
      useSkillStore.getState()._onCompiled(result.statuses)
      return result
    }),

    importHosts: async (hosts, probeAfter) => {
      let created: Asset[]
      try {
        created = await ipc.importHosts(hosts, probeAfter)
      } catch (e) {
        throw toIpcError(e)
      }
      created.forEach((a) => get()._upsert(a))
      markFresh(set, created.map((a) => a.id))
      return created
    },

    setDistribute: (id, agentKey, on) => enqueue(id, async () => {
      try {
        const result = await ipc.setDistribute(id, agentKey, on)
        get()._upsert(result.asset)
        useDeliveryStore.getState()._onChanged(result)
        useSkillStore.getState()._onCompiled(result.statuses)
        return result
      } catch (e) {
        throw toIpcError(e)
      }
    }),

    setMode: (id, mode) => enqueue(id, async () => {
      let result: SaveResult
      try {
        result = await ipc.setMode(id, mode)
      } catch (e) {
        throw toIpcError(e)
      }
      get()._upsert(result.asset)
      useSkillStore.getState()._onCompiled(result.statuses)
      useDeliveryStore.getState()._onChanged(result)
    }),

    setCliScope: (id, selectedIds) => enqueue(id, async () => {
      const before = get().byId[id]
      if (before?.type === "cli") {
        const scope: CliScopeItem[] = before.cli.scope.map((x) => ({ ...x, selected: selectedIds.includes(x.id) }))
        get()._upsert({ ...before, cli: { ...before.cli, scope } })
      }
      let result: SaveResult
      try {
        result = await ipc.setCliScope(id, selectedIds)
      } catch (e) {
        if (before) get()._upsert(before)
        throw toIpcError(e)
      }
      get()._upsert(result.asset)
      useSkillStore.getState()._onCompiled(result.statuses)
      useDeliveryStore.getState()._onChanged(result)
    }),

    _upsert: (asset) =>
      set((s) => ({
        byId: { ...s.byId, [asset.id]: asset },
        ids: s.ids.includes(asset.id) ? s.ids : [...s.ids, asset.id],
      })),

    _patchAgent: (id, patch) =>
      set((s) => {
        const a = s.byId[id]
        return a ? { byId: { ...s.byId, [id]: { ...a, agent: { ...a.agent, ...patch } } } } : {}
      }),
  }
})

// ---------- selectors（派生数据不进 store） ----------

/** 组内顺序（PRD 6.3）：生产在前，再按名称 */
const prodFirst = (a: Asset, b: Asset) => Number(b.production) - Number(a.production)

const collator = new Intl.Collator("zh-CN", { numeric: true })

export const isServer = (a: Asset): a is ServerAsset => a.type === "vps"
export const isCli = (a: Asset): a is CliAsset => a.type === "cli"

/** 资源的标识：服务器是 SSH 别名，云平台是 cloudflare、cloudflare-2…（F-101 AC1） */
export const handleOf = (a: Asset): string => (a.type === "vps" ? a.connection.sshAlias : a.handle)

/** 搜索匹配名称、标识、标签、站点名、CLI 账号和范围（PRD 6.4），不区分大小写 */
export function matchesQuery(asset: Asset, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const fields =
    asset.type === "vps"
      ? [asset.name, asset.connection.sshAlias, ...asset.tags, ...asset.servedHostnames]
      : [
          asset.name,
          asset.handle,
          asset.account ?? "",
          asset.cli.binary,
          ...Object.values(asset.cli.envStates).map((e) => e?.account ?? ""),
          ...asset.cli.scope.filter((x) => x.selected).map((x) => x.name),
        ]
  return fields.some((s) => s.toLowerCase().includes(q))
}

/** 配电盘的两组回路（PRD 6.4）：组内按生产、预发、开发，再按名称排序；空组由界面决定是否显示 */
export function selectResourceGroups(state: Pick<AssetState, "byId" | "ids">, query: string): { servers: ServerAsset[]; clis: CliAsset[] } {
  const list = state.ids
    .map((id) => state.byId[id])
    .filter((a) => a && matchesQuery(a, query))
    .sort((a, b) => prodFirst(a, b) || collator.compare(a.name, b.name))
  return { servers: list.filter(isServer), clis: list.filter(isCli) }
}

// ---------- 云平台 CLI 的状态（F-104、6.11） ----------

export type CliEnvStatus = "ready" | "not-installed" | "not-logged-in" | "expired"

export function cliEnvStatus(s: CliEnvState): CliEnvStatus {
  if (!s.installed) return "not-installed"
  if (s.expired) return "expired"
  return s.authenticated ? "ready" : "not-logged-in"
}

/** 第一个有问题的运行环境（Windows 在前）：资源行和详情头部就地给出修复入口；全部就绪时为 null */
export function selectCliProblem(asset: Pick<CliAsset, "cli">): { envId: EnvId; status: Exclude<CliEnvStatus, "ready"> } | null {
  const envIds = (Object.keys(asset.cli.envStates) as EnvId[]).sort((a, b) => (a === "windows" ? -1 : b === "windows" ? 1 : a.localeCompare(b)))
  for (const envId of envIds) {
    const state = asset.cli.envStates[envId]
    if (!state) continue
    const status = cliEnvStatus(state)
    if (status !== "ready") return { envId, status }
  }
  return null
}

/** 资源行上显示的账号：第一个已就绪环境的 whoami */
export function selectCliAccount(asset: Pick<CliAsset, "cli" | "account">): string | undefined {
  const ready = Object.values(asset.cli.envStates).find((s) => s && cliEnvStatus(s) === "ready")
  return ready && (asset.account ?? ready.account)
}

/**
 * 资源能否分发给新的 Agent（F-303 AC1）。纯函数，单元测试见 assets.test.ts。
 * 服务器：只用密码排在最前，改用密钥登录会顺带重新测试连接。云平台：至少一个运行环境已就绪
 */
export function selectCanDistribute(asset: Asset): { ok: true } | { ok: false; reason: DistributeBlockReason } {
  if (asset.type === "cli") {
    const ready = Object.values(asset.cli.envStates).some((s) => s && cliEnvStatus(s) === "ready")
    return ready ? { ok: true } : { ok: false, reason: "cli-not-ready" }
  }
  const { connection } = asset
  if (connection.source === "managed" && connection.auth?.method === "password") {
    return { ok: false, reason: "password-only" }
  }
  if (!connection.verified) return { ok: false, reason: "unverified" }
  if (!connection.verified.ok) return { ok: false, reason: "failed" }
  return { ok: true }
}

/** 档位闸刀的琥珀色提醒（DESIGN.md Breaker Row）：生产资源处于标准运维 */
export const isProdWritable = (a: Pick<Asset, "production" | "agent">) => a.production && a.agent.mode === "standard"

/** 资源行和详情的连接状态。分发时一定验证过，所以「分发给了 Agent 却没有验证结果」就是连接改过（F-106 AC4） */
export type ConnState = "connected" | "unverified" | "failed" | "changed"

export function connState(asset: Pick<ServerAsset, "connection" | "agent">): ConnState {
  const verified = asset.connection.verified
  if (verified) return verified.ok ? "connected" : "failed"
  return asset.agent.agents.length > 0 ? "changed" : "unverified"
}

/** 表单候选值：全部服务器上出现过的值，去重排序 */
export function collectValues(assets: ServerAsset[], pick: (a: ServerAsset) => (string | undefined)[]): string[] {
  const set = new Set<string>()
  assets.forEach((a) => pick(a).forEach((v) => v && set.add(v)))
  return [...set].sort((a, b) => collator.compare(a, b))
}
