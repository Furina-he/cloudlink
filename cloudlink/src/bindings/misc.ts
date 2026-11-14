// 手写契约（PRD 4.4、6.7、7.8）
import type { Asset, Mode } from "./asset"
import type { CompileStatus } from "./compile"
import type { Delivery, Inclusion } from "./delivery"
import type { EnvId } from "./env"

/** 活动日志的类型（F-402、6.7）。「Agent 操作」来自护栏记录（F-307），在活动里单独一项 */
export type ActivityKind =
  | "connection"
  | "probe"
  | "compile"
  | "deliver"
  | "remove"
  | "repair"
  | "ssh-config"
  | "guard"
  | "mode"
  | "cli"
  | "note"
  | "agent-op"
  /** 应用更新的安装（F-406） */
  | "update"

export type ActivityMessageId =
  | "test-ok"
  | "test-failed"
  | "probe-updated"
  | "probe-held"
  | "probe-no-changes"
  | "probe-failed"
  | "probe-undone"
  | "compile-ok"
  | "compile-blocked"
  | "deliver-ok"
  | "remove-ok"
  | "repair-ok"
  /** F-309：被改动的副本已备份并恢复；params：target、env、backup */
  | "copy-restored"
  /** F-309：外来的同名 Skill 已移进备份并接管；params：target、env、backup */
  | "copy-taken-over"
  /** F-309：备份已写回，这个目标停用；params：target、env */
  | "backup-undone"
  | "ssh-config-written"
  | "ssh-include-added"
  | "guard-installed"
  | "guard-removed"
  | "mode-changed"
  | "cli-detected"
  | "cli-scope-updated"
  | "notes-merged"
  | "notes-dismissed"
  | "agent-op-allowed"
  | "agent-op-denied"
  /** 开始安装更新、CloudLink 即将退出（F-406 AC5）；params：from、to */
  | "update-installing"

export interface ActivityItem {
  id: string
  kind: ActivityKind
  at: string
  assetId?: string
  /** 后端只给 id 和参数，句子由 copy.ts 拼出 */
  messageId: ActivityMessageId
  params?: Record<string, string | number>
  durationMs?: number
  /** 执行过的命令清单、差异摘要或完整命令，可展开 */
  detail?: string
  ok: boolean
}

export interface ActivityQuery {
  /** 返回 at 早于它的记录，分页用 */
  before?: string
  limit: number
  kinds?: ActivityKind[]
  assetId?: string
}

export type Theme = "system" | "light" | "dark"

export interface Settings {
  theme: Theme
  /** v0.1 固定 en */
  outputLanguage: "en"
  environments: { id: EnvId; enabled: boolean }[]
  /** 正文行数上限，默认 100（5.4） */
  bodyLineLimit: number
  writeSnapshotTime: boolean
  /** 新建非生产服务器的默认档位；生产服务器固定为只读巡检（F-202 AC2） */
  defaultMode: Mode
  probeTimeoutSec: number
  /** 默认是系统 OpenSSH 的绝对路径（PRD 8.3） */
  windowsSshPath: string
  dataDir: string
  logDir: string
  /** 已经问过「加入 Include」的运行环境：拒绝后不再弹窗，改在设置里给出手动说明（F-107 AC1） */
  sshIncludeAsked: EnvId[]
  /** 定时检查更新，默认开启（F-406） */
  autoCheckUpdates: boolean
  /** 关闭窗口时留在托盘，默认开启（F-407） */
  closeToTray: boolean
  /** 开机时启动 */
  launchAtLogin: boolean
}

/** 托盘菜单的文字（F-407）：文案只在 copy.ts，启动时经 setTrayCopy 交给 Rust；{n} 由 Rust 替换 */
export interface TrayCopy {
  tooltip: string
  guardOn: string
  guardOff: string
  modesHeader: string
  readOnly: string
  standard: string
  allReadOnly: string
  prodInStandard: string
  open: string
  quit: string
  notifyTitle: string
  notifyAllReadOnly: string
}

/** tray://confirm-mode：托盘里把生产资源切到标准运维，主窗口弹出确认（F-407 AC1） */
export interface TrayConfirmMode {
  assetId: string
}

export interface SaveResult {
  asset: Asset
  /** 这次保存触发的重新编译，每个运行环境一条 */
  statuses: CompileStatus[]
  inclusions: Inclusion[]
  deliveries: Delivery[]
}

/** P8a：资源授权后的真实送达快照，开启选择本身不代表写入成功 */
export interface DistributeResult {
  asset: Asset
  inclusions: Inclusion[]
  deliveries: Delivery[]
  statuses: CompileStatus[]
  affectedAgentKeys: string[]
}

export interface DeleteResult {
  statuses: CompileStatus[]
}

/** 分发开关打不开的原因（F-303 AC1） */
export type DistributeBlockReason =
  "unverified" | "failed" | "password-only" | "cli-not-ready"

export type IpcErrorId =
  | "not-found"
  /** 别名在全部服务器中唯一，不区分大小写（F-101 AC1） */
  | "alias-taken"
  /** 与该环境 ssh config 中已有的 Host 重名（F-107 AC3） */
  | "alias-conflict"
  | "cannot-distribute"
  /** 「改用密钥登录」需要凭据库里已有密码 */
  | "password-missing"
  /** 没有填新密码，而连接目标（地址、端口、用户、认证方式）和已保存的记录不同：已保存的密码不会发往新目标（P4a） */
  | "password-target-changed"
  /** 「改用密钥登录」时连接失败，认证方式没有切换（F-108 AC2） */
  | "connection-failed"
  /** settings.json 不是合法 JSON，没有修改（8.5） */
  | "settings-invalid"
  | "interop-disabled"
  | "target-exists"
  /** 复制到 WSL 的源文件不存在 */
  | "source-missing"
  /** 编译受阻期间不能用旧产物创建或修复副本 */
  | "compile-blocked"
  | "cli-account-unavailable"
  | "cli-scope-permission"
  | "cli-scope-failed"
  | "cli-command-unsupported"
  | "terminal-command-invalid"
  /** 并入的笔记仍然命中密钥（F-308 AC2） */
  | "note-has-secret"
  | "reset-incomplete"
  /** 有进行中的任务，暂不安装更新；params.task 为 connection、probe、cli 或 publish，params.name 说明是哪一项（F-406 AC4） */
  | "update-busy"
  | "update-download-failed"
  /** 安装包没有通过内置公钥的签名校验，已丢弃（F-406 AC3） */
  | "update-signature-invalid"
  | "update-install-failed"
  | "internal"

/** IPC 失败时 invoke 抛出的对象。文案由 copy.ts 按 id 映射 */
export interface IpcError {
  id: IpcErrorId
  params?: Record<string, string | number>
}

/**
 * F-406：发现新版本后在后台下载并校验，下好（ready）才在顶栏提醒。
 * idle：没有新版本、尚未检查或已关闭检查，界面不显示任何更新元素；available 只有带着失败原因时才提醒
 */
export type UpdateState = "idle" | "available" | "downloading" | "ready" | "installing"

/** 检测更新的完整快照：getUpdateStatus 的返回值和 update://changed 的载荷（PRD 7.8） */
export interface UpdateStatus {
  state: UpdateState
  currentVersion: string
  /** 以下来自 latest.json；notes 不在签名范围内，按不可信纯文本展示 */
  version?: string
  date?: string
  notes?: string
  /** downloading 时的字节数；total 可能未知 */
  downloaded?: number
  total?: number
  /** 后台下载失败时 state 回到 available；安装失败时回到 ready（安装包还在） */
  error?: IpcError
}
