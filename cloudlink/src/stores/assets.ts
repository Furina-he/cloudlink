import { create } from "zustand"

import type {
  Asset,
  AssetAgent,
  AssetInput,
  DeleteResult,
  DistributeBlockReason,
  EnvTag,
  ImportHost,
  IpcError,
  Mode,
  SaveResult,
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
  /** 刚新建或导入的服务器，卡片只给它们播放进入动画（PRD 7.7）；两秒后清空 */
  freshIds: string[]

  load: () => Promise<void>
  /** 不显示加载中，静默拉一次全集（测试连接、探测之后） */
  refresh: () => Promise<void>
  /** 返回编译结果；失败时抛出 IpcError */
  save: (input: AssetInput) => Promise<SaveResult>
  remove: (id: string, removeGeneratedKey: boolean) => Promise<DeleteResult>
  importHosts: (hosts: ImportHost[], probeAfter: boolean) => Promise<Asset[]>
  /** 立即生效，不经过保存（PRD 6.4）。失败时回滚并抛出 */
  /** 分发给某个 Agent，或者停止分发（F-303）；乐观更新，失败时恢复 */
  setDistribute: (id: string, agentKey: string, on: boolean) => Promise<void>
  setMode: (id: string, mode: Mode) => Promise<void>
  unlock: (id: string) => Promise<void>
  lock: (id: string) => Promise<void>
  _upsert: (asset: Asset) => void
  _patchAgent: (id: string, patch: Partial<AssetAgent>) => void
}

const markFresh = (set: (fn: (s: AssetState) => Partial<AssetState>) => void, ids: string[]) => {
  set(() => ({ freshIds: ids }))
  setTimeout(() => set((s) => (s.freshIds === ids ? { freshIds: [] } : {})), 2000)
}

export const useAssetStore = create<AssetState>()((set, get) => ({
  byId: {},
  ids: [],
  status: "idle",
  error: null,
  lastSaved: {},
  freshIds: [],

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

  save: async (input) => {
    let result: SaveResult
    try {
      result = await ipc.saveAsset(input)
    } catch (e) {
      throw toIpcError(e)
    }
    const isNew = !input.id
    get()._upsert(result.asset)
    useSkillStore.getState()._onCompiled(result.statuses)
    set((s) => ({ lastSaved: { ...s.lastSaved, [result.asset.id]: new Date().toISOString() } }))
    if (isNew) markFresh(set, [result.asset.id])
    return result
  },

  remove: async (id, removeGeneratedKey) => {
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
  },

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

  setDistribute: async (id, agentKey, on) => {
    const before = get().byId[id]?.agent.agents
    if (before) {
      const rest = before.filter((k) => k !== agentKey)
      get()._patchAgent(id, { agents: on ? [...rest, agentKey] : rest })
    }
    try {
      const inclusions = await ipc.setDistribute(id, agentKey, on)
      useDeliveryStore.getState()._setInclusions(inclusions)
    } catch (e) {
      if (before) get()._patchAgent(id, { agents: before })
      throw toIpcError(e)
    }
  },

  setMode: async (id, mode) => {
    let result: SaveResult
    try {
      result = await ipc.setMode(id, mode)
    } catch (e) {
      throw toIpcError(e)
    }
    get()._upsert(result.asset)
    useSkillStore.getState()._onCompiled(result.statuses)
  },

  unlock: async (id) => {
    try {
      const { unlockedUntil } = await ipc.unlockServer(id)
      get()._patchAgent(id, { unlockedUntil })
    } catch (e) {
      throw toIpcError(e)
    }
  },

  lock: async (id) => {
    try {
      await ipc.lockServer(id)
      get()._patchAgent(id, { unlockedUntil: null })
    } catch (e) {
      throw toIpcError(e)
    }
  },

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
}))

// ---------- selectors（派生数据不进 store） ----------

export const ENV_ORDER: EnvTag[] = ["prod", "staging", "dev"]

const collator = new Intl.Collator("zh-CN", { numeric: true })

/** 搜索匹配名称、别名、标签、站点名（PRD 6.4），不区分大小写 */
export function matchesQuery(asset: Asset, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return [asset.name, asset.connection.sshAlias, ...asset.tags, ...asset.servedHostnames].some((s) =>
    s.toLowerCase().includes(q)
  )
}

/** 按「生产 / 预发 / 开发」分组，组内按名称排序；空组不出现（PRD 7.5） */
export function selectServerGroups(
  state: Pick<AssetState, "byId" | "ids">,
  query: string
): { env: EnvTag; assets: Asset[] }[] {
  const list = state.ids.map((id) => state.byId[id]).filter((a) => a && matchesQuery(a, query))
  return ENV_ORDER.map((env) => ({
    env,
    assets: list.filter((a) => a.envTag === env).sort((a, b) => collator.compare(a.name, b.name)),
  })).filter((g) => g.assets.length > 0)
}

/**
 * 分发开关能否打开（F-303 AC1）。纯函数，单元测试见 assets.test.ts。
 * 只用密码排在最前：改用密钥登录会顺带重新测试连接
 */
export function selectCanDistribute(
  asset: Pick<Asset, "connection">
): { ok: true } | { ok: false; reason: DistributeBlockReason } {
  const { connection } = asset
  if (connection.source === "managed" && connection.auth?.method === "password") {
    return { ok: false, reason: "password-only" }
  }
  if (!connection.verified) return { ok: false, reason: "unverified" }
  if (!connection.verified.ok) return { ok: false, reason: "failed" }
  return { ok: true }
}

/** 临时解锁固定 30 分钟（F-306 AC2） */
export const UNLOCK_MINUTES = 30

/**
 * 临时解锁的剩余分钟数（向上取整）；未解锁或已到期返回 null。纯函数。
 * now 来自每 30 秒更新一次的时钟，刚解锁时可能比实际早几十秒，所以不超过 30
 */
export function selectUnlockRemaining(asset: Pick<Asset, "agent">, now: number): number | null {
  const until = asset.agent.unlockedUntil
  if (!until) return null
  const ms = new Date(until).getTime() - now
  return ms > 0 ? Math.min(UNLOCK_MINUTES, Math.ceil(ms / 60_000)) : null
}

/** 卡片和详情的连接状态。分发时一定验证过，所以「分发给了 Agent 却没有验证结果」就是连接改过（F-106 AC5） */
export type ConnState = "connected" | "unverified" | "failed" | "changed"

export function connState(asset: Pick<Asset, "connection" | "agent">): ConnState {
  const verified = asset.connection.verified
  if (verified) return verified.ok ? "connected" : "failed"
  return asset.agent.agents.length > 0 ? "changed" : "unverified"
}

/** 卡片和命令面板用的候选值：全部服务器上出现过的值，去重排序 */
export function collectValues(assets: Asset[], pick: (a: Asset) => (string | undefined)[]): string[] {
  const set = new Set<string>()
  assets.forEach((a) => pick(a).forEach((v) => v && set.add(v)))
  return [...set].sort((a, b) => collator.compare(a, b))
}
