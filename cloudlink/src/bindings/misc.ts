// 手写契约（PRD 4.4、6.8、6.9、7.8）
import type { Asset } from "./asset"
import type { LintItem } from "./compile"
import type { EnvId } from "./env"
import type { LinkMode, Mode, Mount } from "./mount"

export type ActivityKind = "probe" | "compile" | "mount" | "unmount" | "repair"

export type ActivityMessageId =
  | "probe-changes"
  | "probe-no-changes"
  | "probe-failed"
  | "compile-ok"
  | "compile-blocked"
  | "mount-ok"
  | "unmount-ok"
  | "repair-ok"

export interface ActivityItem {
  id: string
  kind: ActivityKind
  at: string
  assetId?: string
  /** 后端只给 id 和参数，句子由 copy.ts 拼出 */
  messageId: ActivityMessageId
  params?: Record<string, string | number>
  durationMs?: number
  /** 执行过的命令清单或差异摘要，可展开 */
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

export interface Settings {
  theme: "system" | "light" | "dark"
  /** v0.1 固定 en */
  outputLanguage: "en"
  environments: { id: EnvId; enabled: boolean }[]
  windowsJunction: boolean
  defaultLinkMode: LinkMode
  bodyLineLimit: number
  writeSnapshotTime: boolean
  defaultMode: Mode
  probeTimeoutSec: number
  /** 默认是系统 OpenSSH 的绝对路径（PRD 8.3） */
  windowsSshPath: string
  dataDir: string
  logDir: string
}

export interface SaveResult {
  asset: Asset
  lint: LintItem[]
  blocked: boolean
}

export interface DeleteResult {
  /** 被级联卸载的挂载 */
  unmounted: Mount[]
}

export type IpcErrorId =
  | "not-found"
  | "slug-taken"
  | "already-mounted"
  /** F-303 AC2：全局与项目档位不同 */
  | "mode-conflict"
  /** F-303 AC1：生产资产挂全局，需要先确认 */
  | "needs-confirm-prod-global"
  /** F-307：别名在目标环境不可达，需要先确认 */
  | "needs-confirm-alias-missing"
  /** 这个目录已经是一个目标（P3 契约扩展） */
  | "target-exists"
  | "internal"

/** IPC 失败时 invoke 抛出的对象。文案由 copy.ts 按 id 映射 */
export interface IpcError {
  id: IpcErrorId
  params?: Record<string, string | number>
}
