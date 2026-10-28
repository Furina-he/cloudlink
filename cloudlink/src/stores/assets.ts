import { create } from "zustand"

import type {
  Asset,
  AssetInput,
  DeleteResult,
  EnvTag,
  ImportHost,
  IpcError,
  SaveResult,
} from "@/bindings"
import { ipc, toIpcError } from "@/lib/ipc"
import type { AssetFilter, AssetSort } from "./ui"

export type LoadStatus = "idle" | "loading" | "ready" | "error"

/** 本次会话里最近一次保存（或应用探测）的编译结果，编辑器头部据此显示「已保存，已编译」 */
export interface SaveRecord {
  at: string
  blocked: boolean
  errors: number
}

interface AssetState {
  byId: Record<string, Asset>
  ids: string[]
  status: LoadStatus
  error: IpcError | null
  lastSaved: Record<string, SaveRecord>
  /** 刚导入的资产，列表只给它们播放进入动画（PRD 7.7）；两秒后清空 */
  freshIds: string[]

  load: () => Promise<void>
  /** 返回编译结果；失败时抛出 IpcError */
  save: (input: AssetInput) => Promise<SaveResult>
  remove: (id: string) => Promise<DeleteResult>
  importHosts: (hosts: ImportHost[], probeAfter: boolean) => Promise<Asset[]>
  _upsert: (asset: Asset) => void
  _recordSave: (result: SaveResult) => void
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
      set({
        byId: Object.fromEntries(list.map((a) => [a.id, a])),
        ids: list.map((a) => a.id),
        status: "ready",
        error: null,
      })
    } catch (e) {
      set({ status: "error", error: toIpcError(e) })
    }
  },

  save: async (input) => {
    try {
      const result = await ipc.saveAsset(input)
      get()._upsert(result.asset)
      get()._recordSave(result)
      return result
    } catch (e) {
      throw toIpcError(e)
    }
  },

  remove: async (id) => {
    let result: DeleteResult
    try {
      result = await ipc.deleteAsset(id)
    } catch (e) {
      throw toIpcError(e)
    }
    set((s) => {
      const byId = { ...s.byId }
      delete byId[id]
      return { byId, ids: s.ids.filter((x) => x !== id) }
    })
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
    const fresh = created.map((a) => a.id)
    set({ freshIds: fresh })
    setTimeout(() => set((s) => (s.freshIds === fresh ? { freshIds: [] } : s)), 2000)
    return created
  },

  _upsert: (asset) =>
    set((s) => ({
      byId: { ...s.byId, [asset.id]: asset },
      ids: s.ids.includes(asset.id) ? s.ids : [...s.ids, asset.id],
    })),

  _recordSave: ({ asset, lint, blocked }) =>
    set((s) => ({
      lastSaved: {
        ...s.lastSaved,
        [asset.id]: {
          at: new Date().toISOString(),
          blocked,
          errors: lint.filter((l) => l.level === "error").length,
        },
      },
    })),
}))

/** 资产列表的筛选结果（PRD 7.5）。query 匹配名称、slug、别名、标签 */
export function selectFilteredAssets(
  state: Pick<AssetState, "byId" | "ids">,
  filter: AssetFilter
): Asset[] {
  const q = filter.query.trim().toLowerCase()
  return state.ids
    .map((id) => state.byId[id])
    .filter((a) => {
      if (filter.types.length && !filter.types.includes(a.type)) return false
      if (filter.envTags.length && !filter.envTags.includes(a.envTag)) return false
      if (filter.tags.length && !filter.tags.some((t) => a.tags.includes(t))) return false
      if (!q) return true
      return [a.name, a.slug, a.connection.sshAlias, ...a.tags].some((s) =>
        s.toLowerCase().includes(q)
      )
    })
}

export const ENV_ORDER: EnvTag[] = ["prod", "staging", "dev"]

const collator = new Intl.Collator("zh-CN", { numeric: true })
const time = (iso: string | null) => (iso ? new Date(iso).getTime() : 0)

const COMPARE: Record<AssetSort, (a: Asset, b: Asset) => number> = {
  name: (a, b) => collator.compare(a.name, b.name),
  // 最近探测的在前，从未探测的排最后
  probed: (a, b) => time(b.probe.lastSuccessAt) - time(a.probe.lastSuccessAt),
  updated: (a, b) => time(b.updatedAt) - time(a.updatedAt),
}

/** 按「生产 / 预发 / 开发」分组，组内按所选方式排序；空组不出现 */
export function groupAssets(list: Asset[], sort: AssetSort): { env: EnvTag; assets: Asset[] }[] {
  return ENV_ORDER.map((env) => ({
    env,
    assets: list
      .filter((a) => a.envTag === env)
      .sort((a, b) => COMPARE[sort](a, b) || collator.compare(a.name, b.name)),
  })).filter((g) => g.assets.length > 0)
}

/** 全部资产上出现过的值，供云厂商、地域、标签的候选项使用 */
export function collectValues(assets: Asset[], pick: (a: Asset) => (string | undefined)[]): string[] {
  const set = new Set<string>()
  assets.forEach((a) => pick(a).forEach((v) => v && set.add(v)))
  return [...set].sort((a, b) => collator.compare(a, b))
}
