// 手写契约（PRD 3.4、7.8）。P4 起由 ts-rs 从 Rust 结构体生成，届时以生成结果为准
import type { DetectedAgent } from "./delivery"

export type EnvId = "windows" | "macos" | "linux" | `wsl:${string}`

export interface Environment {
  id: EnvId
  /** 例如 "WSL - Ubuntu-24.04" */
  label: string
  /** 例如 "C:\\Users\\me" 或 "/home/me" */
  home: string
  sshConfigPath: string
  available: boolean
  /** 托管文件位置；用户的 ~/.ssh/config 是否已加入 Include（F-107） */
  managedSshConfig: { path: string; included: boolean }
  /** ssh-agent 中已加载的密钥数（ssh-add -l）；agent 不可用时为 null（2026-10-31 补充） */
  sshAgentKeys: number | null
  /** 这个环境里检测到的 Agent（2026-11-07） */
  agents: DetectedAgent[]
}

/** ssh config 中的一个 Host（list_ssh_hosts）。通配 Host 和 CloudLink 托管文件里的 Host 不在其中（F-102 AC1、AC4） */
export interface SshHost {
  alias: string
  /** 这个别名在哪些运行环境的 ssh config 里存在（F-102 AC2 合并后的结果） */
  definedIn: EnvId[]
  hostname: string | null
  user: string | null
  port: number | null
  /** 已有服务器使用这个别名（F-102 AC3） */
  imported: boolean
}

export interface SshHostList {
  hosts: SshHost[]
  /** 已扫描的 ssh config */
  scanned: { envId: EnvId; path: string }[]
  /** 被跳过的通配或否定 Host 的原始模式，例如 "*"、"*.internal" */
  skippedPatterns: string[]
}

/** 设置 / ssh 配置的一行（F-107） */
export interface SshConfigStatus {
  envId: EnvId
  /** 托管文件 ~/.ssh/cloudlink.conf */
  managedPath: string
  /** 用户的 ~/.ssh/config */
  userConfigPath: string
  /** 用户 config 开头是否已有 Include 这一行 */
  included: boolean
  /** 要加进用户 config 开头的那一行，同意对话框和手动说明都展示它 */
  includeLine: string
  knownHostsPath: string
}
