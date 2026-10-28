// 手写契约（PRD 3.4）。P4 起由 ts-rs 从 Rust 结构体生成，届时以生成结果为准
export type EnvId = "windows" | "macos" | "linux" | `wsl:${string}`

export interface Environment {
  id: EnvId
  /** 例如 "WSL - Ubuntu-24.04" */
  label: string
  /** 例如 "C:\\Users\\me" 或 "/home/me" */
  home: string
  sshConfigPath: string
  available: boolean
}

/** ssh config 中的一个 Host（list_ssh_hosts）。通配 Host 不在其中 */
export interface SshHost {
  alias: string
  /** 这个别名在哪些运行环境的 ssh config 里存在（F-102 AC2 合并后的结果） */
  definedIn: EnvId[]
  hostname: string | null
  user: string | null
  port: number | null
  /** 已有资产使用这个别名（F-102 AC3） */
  imported: boolean
}

export interface SshHostList {
  hosts: SshHost[]
  /** 已扫描的 ssh config */
  scanned: { envId: EnvId; path: string }[]
  /** 被跳过的通配或否定 Host 的原始模式，例如 "*"、"*.internal" */
  skippedPatterns: string[]
}
