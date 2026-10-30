import {
  CircleCheckIcon,
  CircleDashedIcon,
  CircleXIcon,
  ClockIcon,
  Link2OffIcon,
  TriangleAlertIcon,
  type LucideIcon,
} from "lucide-react"
import type { ReactNode } from "react"

import type { Mount, MountStatus, ProbeState } from "@/bindings"
import { Badge } from "@/components/ui/badge"
import { Spinner } from "@/components/ui/spinner"
import { copy } from "@/lib/copy"
import { cn } from "@/lib/utils"

export type StateTone = "success" | "warning" | "danger" | "neutral"

const BADGE_VARIANT = {
  success: "success",
  warning: "warning",
  danger: "destructive",
  neutral: "secondary",
} as const

export const TONE_TEXT: Record<StateTone, string> = {
  success: "text-success",
  warning: "text-warning",
  danger: "text-destructive",
  neutral: "text-muted-foreground",
}

/** 状态徽章：淡色实底 + 图标 + 中文状态词（DESIGN.md State Badge）。icon 为 null 时显示 Spinner */
export function StateBadge({
  tone,
  icon: Icon,
  children,
  className,
}: {
  tone: StateTone
  icon: LucideIcon | null
  children: ReactNode
  className?: string
}) {
  return (
    <Badge variant={BADGE_VARIANT[tone]} className={className}>
      {Icon ? <Icon data-icon="inline-start" /> : <Spinner data-icon="inline-start" aria-hidden />}
      {children}
    </Badge>
  )
}

export const MOUNT_STATE: Record<MountStatus, { tone: StateTone; icon: LucideIcon | null }> = {
  ok: { tone: "success", icon: CircleCheckIcon },
  pending: { tone: "neutral", icon: null },
  broken: { tone: "danger", icon: Link2OffIcon },
  conflict: { tone: "warning", icon: TriangleAlertIcon },
  "stale-copy": { tone: "warning", icon: ClockIcon },
  "alias-missing": { tone: "danger", icon: CircleXIcon },
}

/** 挂载状态（PRD 6.13 状态词表）；复制模式的正常挂载写作「已挂载（复制）」 */
export function MountStatusBadge({ mount, className }: { mount: Mount; className?: string }) {
  const { tone, icon } = MOUNT_STATE[mount.status]
  const isCopy = mount.links.length > 0 && mount.links.every((l) => l.kind === "copy")
  const text = mount.status === "ok" && isCopy ? copy.mountOkCopy : copy.mountStatus[mount.status]
  return (
    <StateBadge tone={tone} icon={icon} className={className}>
      {text}
    </StateBadge>
  )
}

export const PROBE_STATE: Record<ProbeState, { tone: StateTone; icon: LucideIcon }> = {
  never: { tone: "neutral", icon: CircleDashedIcon },
  ok: { tone: "success", icon: CircleCheckIcon },
  stale: { tone: "warning", icon: ClockIcon },
  failed: { tone: "danger", icon: CircleXIcon },
}

/** 探测状态图标；探测中显示 Spinner。附屏幕阅读器文字，颜色不是唯一线索 */
export function ProbeStateIcon({
  state,
  probing,
  className,
}: {
  state: ProbeState
  probing?: boolean
  className?: string
}) {
  const label = probing ? copy.probing : copy.probeState[state]
  if (probing) {
    return (
      <span className={cn("flex shrink-0", className)}>
        <Spinner aria-hidden className="text-muted-foreground" />
        <span className="sr-only">{label}</span>
      </span>
    )
  }
  const { tone, icon: Icon } = PROBE_STATE[state]
  return (
    <span className={cn("flex shrink-0", className)}>
      <Icon aria-hidden className={cn("size-4", TONE_TEXT[tone])} />
      <span className="sr-only">{label}</span>
    </span>
  )
}
