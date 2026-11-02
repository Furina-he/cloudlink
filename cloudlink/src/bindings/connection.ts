// 手写契约（PRD F-106、F-108、7.8）：测试连接与主机指纹
import type { ConnectionInput } from "./asset"
import type { EnvId } from "./env"
import type { SshError } from "./probe"

/**
 * test_connection 的请求。新建表单里还没有 assetId；编辑时带 assetId，连接参数取表单草稿。
 * 密码只在这次请求里经 IPC 交给后端，不进 store、不进日志（F-108）
 */
export interface ConnectionTestRequest {
  assetId?: string
  connection: ConnectionInput
  /** 仅密码方式、且凭据库里还没有这台服务器的密码时 */
  password?: string
  /** 在哪个运行环境里执行 ssh；缺省取 definedIn 的第一个 */
  envId?: EnvId
}

export type ConnectionTestStatus = "ok" | "failed" | "cancelled" | "host-key"

/** connection://tested 的载荷 */
export interface ConnectionTestedEvent {
  testId: string
  status: ConnectionTestStatus
  ms?: number
  /** 远端系统，例如 "Ubuntu 24.04 LTS" */
  remoteOs?: string
  error?: SshError
  /** 首次连接（new）要用户核对后信任；指纹与已知记录不符（changed）时阻断（F-106 AC2） */
  hostKey?: { fingerprint: string; known: "new" | "changed" }
}
