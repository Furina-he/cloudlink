// 手写契约（PRD F-106、F-108、7.8）：测试连接、主机指纹与私钥预检
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

/**
 * new：第一次见到，等用户核对；changed：与已保存的记录不符，阻断（F-106 AC2）；
 * trusted：用户刚核对并信任，已写入 known_hosts；adopted：known_hosts 里这个地址已有同一把公钥，直接沿用
 */
export type HostKeyKnown = "new" | "changed" | "trusted" | "adopted"

export interface HostKeyInfo {
  fingerprint: string
  known: HostKeyKnown
  /** adopted：known_hosts 里记录这把公钥的名字，例如 `203.0.113.10` 或 `[203.0.113.10]:2222` */
  knownAs?: string
}

/** connection://tested 的载荷 */
export interface ConnectionTestedEvent {
  testId: string
  status: ConnectionTestStatus
  ms?: number
  /** 远端系统，例如 "Ubuntu 24.04 LTS" */
  remoteOs?: string
  error?: SshError
  /** host-key 状态时等待核对（new）或已阻断（changed）；成功或认证失败时说明指纹已信任（trusted）或沿用（adopted） */
  hostKey?: HostKeyInfo
}

/** 私钥文件预检的结论（F-108「检测常见问题」）；unchecked 表示没能检查，不下结论 */
export type KeyCheckStatus =
  | "ok"
  | "missing"
  | "permissions"
  | "passphrase"
  | "putty"
  | "public-key"
  | "invalid"
  | "unchecked"

export interface KeyCheck {
  status: KeyCheckStatus
  /** 例如 `ED25519` */
  keyType?: string
  /** 公钥的 SHA256 指纹 */
  fingerprint?: string
}

export interface KeyCheckRequest {
  envId: EnvId
  /** 该运行环境里的写法 */
  path: string
}
