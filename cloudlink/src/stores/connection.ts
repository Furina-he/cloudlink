// 测试连接（F-106）：结果经 connection://tested 返回，在按钮旁原地显示
import { create } from "zustand"

import type { Asset, ConnectionInput, ConnectionTestedEvent, ConnectionTestRequest, SshError } from "@/bindings"
import { ipc, toIpcError } from "@/lib/ipc"
import { useAssetStore } from "./assets"

/** 新建表单用这个键；编辑已有服务器时用服务器 id */
export const NEW_KEY = "new"

export interface ConnectionTest {
  /** invoke 还没返回时为 null */
  testId: string | null
  status: "running" | "ok" | "failed" | "cancelled" | "host-key"
  /** 测试时的连接参数（不含密码）；表单参数和它不同时，结果作废，要求重新测试 */
  signature: string
  /** 主机指纹对话框里显示的名字 */
  alias: string
  ms?: number
  remoteOs?: string
  error?: SshError
  hostKey?: { fingerprint: string; known: "new" | "changed" }
}

interface ConnectionState {
  testsByKey: Record<string, ConnectionTest>

  test: (key: string, req: ConnectionTestRequest) => Promise<void>
  cancel: (key: string) => Promise<void>
  /** 用户核对指纹后信任（F-106 AC2）；同一次测试继续进行 */
  trustHostKey: (key: string) => Promise<void>
  clear: (key: string) => void
  /** 改用密钥登录（F-108 AC1）：生成密钥、安装公钥、切换认证方式并重新测试 */
  convertToKey: (assetId: string) => Promise<Asset>
  _onTested: (e: ConnectionTestedEvent) => void
}

/** 键按字母排序后序列化，前端表单和 Mock 后端得到同一个签名 */
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((k) => [k, stable((value as Record<string, unknown>)[k])]))
  }
  return value
}

export const connectionSignature = (c: ConnectionInput) => JSON.stringify(stable(c))

/** 事件可能先于 invoke 返回到达：先记下，拿到 testId 后再应用 */
const early = new Map<string, ConnectionTestedEvent>()

/** 从右键菜单、命令面板发起的测试：结果用 Toast 播报（详情里的测试连接原地显示） */
const announce = new Map<string, (e: ConnectionTestedEvent) => void>()

export function announceTest(key: string, notify: (e: ConnectionTestedEvent) => void) {
  announce.set(key, notify)
}

const apply = (t: ConnectionTest, e: ConnectionTestedEvent): ConnectionTest => ({
  ...t,
  status: e.status,
  ms: e.ms,
  remoteOs: e.remoteOs,
  error: e.error,
  hostKey: e.hostKey,
})

export const useConnectionStore = create<ConnectionState>()((set, get) => ({
  testsByKey: {},

  test: async (key, req) => {
    set((s) => ({
      testsByKey: {
        ...s.testsByKey,
        [key]: {
          testId: null,
          status: "running",
          signature: connectionSignature(req.connection),
          alias: req.connection.sshAlias || (req.connection.source === "managed" ? req.connection.host : ""),
        },
      },
    }))
    let testId: string
    try {
      testId = (await ipc.testConnection(req)).testId
    } catch (e) {
      const err = toIpcError(e)
      set((s) => ({
        testsByKey: { ...s.testsByKey, [key]: { ...s.testsByKey[key], status: "failed", error: { id: "unknown", params: err.params } } },
      }))
      return
    }
    set((s) => {
      const current = s.testsByKey[key]
      if (!current || current.testId !== null) return s
      const pending = early.get(testId)
      early.delete(testId)
      const next = { ...current, testId }
      return { testsByKey: { ...s.testsByKey, [key]: pending ? apply(next, pending) : next } }
    })
  },

  cancel: async (key) => {
    const t = get().testsByKey[key]
    if (!t?.testId) return
    // 先在界面上结束，不等后端的 cancelled 事件
    set((s) => ({ testsByKey: { ...s.testsByKey, [key]: { ...t, status: "cancelled", hostKey: undefined } } }))
    announce.delete(key)
    try {
      await ipc.cancelConnectionTest(t.testId)
    } catch (e) {
      throw toIpcError(e)
    }
  },

  trustHostKey: async (key) => {
    const t = get().testsByKey[key]
    if (!t?.testId || !t.hostKey) return
    set((s) => ({ testsByKey: { ...s.testsByKey, [key]: { ...t, status: "running", hostKey: undefined } } }))
    try {
      await ipc.trustHostKey(t.testId, t.hostKey.fingerprint)
    } catch (e) {
      throw toIpcError(e)
    }
  },

  clear: (key) =>
    set((s) => {
      if (!s.testsByKey[key]) return s
      const testsByKey = { ...s.testsByKey }
      delete testsByKey[key]
      return { testsByKey }
    }),

  convertToKey: async (assetId) => {
    let asset: Asset
    try {
      asset = await ipc.convertToKeyAuth(assetId)
    } catch (e) {
      throw toIpcError(e)
    }
    useAssetStore.getState()._upsert(asset)
    get().clear(assetId)
    return asset
  },

  _onTested: (e) => {
    const entry = Object.entries(get().testsByKey).find(([, t]) => t.testId === e.testId)
    if (!entry) {
      early.set(e.testId, e)
      return
    }
    const [key, t] = entry
    set((s) => ({ testsByKey: { ...s.testsByKey, [key]: apply(t, e) } }))
    const notify = announce.get(key)
    if (notify && e.status !== "host-key") {
      announce.delete(key)
      notify(e)
    }
    // 已保存的服务器：后端可能更新了验证结果（参数与已保存的一致时）
    if (key !== NEW_KEY && (e.status === "ok" || e.status === "failed")) void useAssetStore.getState().refresh()
  },
}))

/** 表单参数改过之后，旧的测试结果不再算数 */
export function isTestCurrent(t: ConnectionTest | undefined, connection: ConnectionInput): boolean {
  return !!t && t.signature === connectionSignature(connection)
}
