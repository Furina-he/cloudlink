// 测试连接（F-106）：结果经 connection://tested 返回，在按钮旁原地显示
import { create } from "zustand"

import type {
  Asset,
  ConnectionInput,
  ConnectionTestedEvent,
  ConnectionTestRequest,
  HostKeyInfo,
  SshError,
} from "@/bindings"
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
  /** host-key 时等待核对（new）或已阻断（changed）；信任之后为 trusted，沿用 known_hosts 时为 adopted */
  hostKey?: HostKeyInfo
}

interface ConnectionState {
  testsByKey: Record<string, ConnectionTest>

  test: (key: string, req: ConnectionTestRequest) => Promise<void>
  /** 等当前请求结束；取消、清除或被另一请求替换时也会结束 */
  waitForResult: (key: string) => Promise<"ok" | "failed" | "cancelled">
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
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, stable((value as Record<string, unknown>)[k])])
    )
  }
  return value
}

export const connectionSignature = (c: ConnectionInput) =>
  JSON.stringify(stable(c))

/** 从右键菜单、命令面板发起的测试：结果用 Toast 播报（详情里的测试连接原地显示） */
type ConnectionResult = Omit<ConnectionTestedEvent, "testId">
const announce = new Map<string, (e: ConnectionResult) => void>()

export function announceTest(
  key: string,
  notify: (e: ConnectionResult) => void
) {
  announce.set(key, notify)
}

function notifyResult(key: string, result: ConnectionResult) {
  if (result.status === "host-key") return
  const notify = announce.get(key)
  announce.delete(key)
  notify?.(result)
}

const apply = (
  t: ConnectionTest,
  e: ConnectionTestedEvent
): ConnectionTest => ({
  ...t,
  status: e.status,
  ms: e.ms,
  remoteOs: e.remoteOs,
  error: e.error,
  hostKey: e.hostKey,
})

export const useConnectionStore = create<ConnectionState>()((
  set,
  get,
  store
) => {
  let sequence = 0
  const requests = new Map<string, number>()
  const pending = new Set<number>()
  // 只在等待 invoke 返回时保留早到事件，最后一个请求登记完就清理无主事件。
  const early = new Map<string, ConnectionTestedEvent>()
  const clearEarly = () => {
    if (!pending.size) early.clear()
  }
  const cancelRetired = (testId: string) =>
    ipc.cancelConnectionTest(testId).catch(() => undefined)
  const running = (test: ConnectionTest) =>
    test.status === "running" || test.status === "host-key"

  return {
    testsByKey: {},

    test: async (key, req) => {
      const previous = get().testsByKey[key]
      const request = ++sequence
      requests.set(key, request)
      pending.add(request)
      set((s) => ({
        testsByKey: {
          ...s.testsByKey,
          [key]: {
            testId: null,
            status: "running",
            signature: connectionSignature(req.connection),
            alias:
              req.connection.sshAlias ||
              (req.connection.source === "managed" ? req.connection.host : ""),
          },
        },
      }))
      if (previous?.testId && running(previous))
        void cancelRetired(previous.testId)
      let testId: string
      try {
        testId = (await ipc.testConnection(req)).testId
      } catch (e) {
        pending.delete(request)
        clearEarly()
        if (requests.get(key) !== request) return
        const err = toIpcError(e)
        const error: SshError = {
          id: "unknown",
          params: { ...err.params, alias: get().testsByKey[key].alias },
        }
        set((s) => ({
          testsByKey: {
            ...s.testsByKey,
            [key]: { ...s.testsByKey[key], status: "failed", error },
          },
        }))
        notifyResult(key, { status: "failed", error })
        return
      }
      pending.delete(request)
      if (requests.get(key) !== request) {
        early.delete(testId)
        clearEarly()
        await cancelRetired(testId)
        return
      }
      set((s) => {
        const current = s.testsByKey[key]
        if (!current || current.testId !== null) return s
        return {
          testsByKey: { ...s.testsByKey, [key]: { ...current, testId } },
        }
      })
      const event = early.get(testId)
      early.delete(testId)
      clearEarly()
      // 与正常到达的事件走同一条路径，保留 Toast 和已保存资源的刷新。
      if (event) get()._onTested(event)
    },

    waitForResult: (key) => {
      const request = requests.get(key)
      return new Promise((resolve) => {
        const check = () => {
          const test = get().testsByKey[key]
          if (!test || requests.get(key) !== request) {
            unsubscribe()
            resolve("cancelled")
          } else if (
            test.status === "ok" ||
            test.status === "failed" ||
            test.status === "cancelled"
          ) {
            unsubscribe()
            resolve(test.status)
          }
        }
        const unsubscribe = store.subscribe(check)
        check()
      })
    },

    cancel: async (key) => {
      const t = get().testsByKey[key]
      requests.delete(key)
      announce.delete(key)
      if (!t) return
      // 先在界面上结束，不等后端的 cancelled 事件
      set((s) => ({
        testsByKey: {
          ...s.testsByKey,
          [key]: { ...t, status: "cancelled", hostKey: undefined },
        },
      }))
      // invoke 尚未返回时，test() 会在拿到 ID 后补发取消。
      if (!t.testId) return
      try {
        await ipc.cancelConnectionTest(t.testId)
      } catch (e) {
        throw toIpcError(e)
      }
    },

    trustHostKey: async (key) => {
      const t = get().testsByKey[key]
      if (!t?.testId || !t.hostKey || t.status !== "host-key") return
      const request = requests.get(key)
      // 指纹一经确认就写入 known_hosts（后端在认证前保存），界面上这一步随即完成
      const trusted: HostKeyInfo = { fingerprint: t.hostKey.fingerprint, known: "trusted" }
      set((s) => ({
        testsByKey: {
          ...s.testsByKey,
          [key]: { ...t, status: "running", hostKey: trusted },
        },
      }))
      try {
        await ipc.trustHostKey(t.testId, trusted.fingerprint)
      } catch (e) {
        const current = get().testsByKey[key]
        if (
          requests.get(key) !== request ||
          current?.testId !== t.testId ||
          current.status !== "running"
        )
          return
        const err = toIpcError(e)
        set((s) => ({
          testsByKey: {
            ...s.testsByKey,
            [key]: {
              ...current,
              status: "failed",
              // 没能信任：这次的指纹没有写入 known_hosts
              hostKey: undefined,
              error: { id: "unknown", params: err.params },
            },
          },
        }))
        throw err
      }
    },

    clear: (key) => {
      const previous = get().testsByKey[key]
      requests.delete(key)
      announce.delete(key)
      if (previous?.testId) early.delete(previous.testId)
      set((s) => {
        if (!s.testsByKey[key]) return s
        const testsByKey = { ...s.testsByKey }
        delete testsByKey[key]
        return { testsByKey }
      })
      if (previous?.testId && running(previous))
        void cancelRetired(previous.testId)
    },

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
      const entry = Object.entries(get().testsByKey).find(
        ([, t]) => t.testId === e.testId
      )
      if (!entry) {
        if (pending.size) early.set(e.testId, e)
        return
      }
      const [key, t] = entry
      if (!running(t)) return
      set((s) => ({ testsByKey: { ...s.testsByKey, [key]: apply(t, e) } }))
      notifyResult(key, e)
      // 已保存的服务器：后端可能更新了验证结果（参数与已保存的一致时）
      if (key !== NEW_KEY && (e.status === "ok" || e.status === "failed"))
        void useAssetStore.getState().refresh()
    },
  }
})

/** 表单参数改过之后，旧的测试结果不再算数 */
export function isTestCurrent(
  t: ConnectionTest | undefined,
  connection: ConnectionInput
): boolean {
  return !!t && t.signature === connectionSignature(connection)
}
