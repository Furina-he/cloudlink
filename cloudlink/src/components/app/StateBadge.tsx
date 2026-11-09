import {
  CircleCheckIcon,
  CircleDashedIcon,
  CircleXIcon,
  ClockIcon,
  MonitorIcon,
  ShieldCheckIcon,
  ShieldOffIcon,
  ShieldXIcon,
  SquareTerminalIcon,
  TriangleAlertIcon,
  type LucideIcon,
} from "lucide-react"
import type { ReactNode } from "react"

import type { GuardState, ProbeState } from "@/bindings"
import { Badge } from "@/components/ui/badge"
import { Spinner } from "@/components/ui/spinner"
import { copy } from "@/lib/copy"
import { cn } from "@/lib/utils"
import type { ConnState } from "@/stores/assets"

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

/** 状态的图标 + 文字（不加底色），用在资源行和列表行里 */
export function StateText({ tone, icon: Icon, children, className }: { tone: StateTone; icon: LucideIcon; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1", TONE_TEXT[tone], className)}>
      <Icon className="size-3.5 shrink-0" aria-hidden />
      <span className="truncate">{children}</span>
    </span>
  )
}

export const CONN_STATE: Record<ConnState, { tone: StateTone; icon: LucideIcon }> = {
  connected: { tone: "success", icon: CircleCheckIcon },
  unverified: { tone: "neutral", icon: CircleDashedIcon },
  failed: { tone: "danger", icon: CircleXIcon },
  changed: { tone: "warning", icon: TriangleAlertIcon },
}


export const GUARD_STATE: Record<GuardState, { tone: StateTone; icon: LucideIcon }> = {
  active: { tone: "success", icon: ShieldCheckIcon },
  "not-installed": { tone: "neutral", icon: ShieldOffIcon },
  broken: { tone: "danger", icon: ShieldXIcon },
  unavailable: { tone: "neutral", icon: ShieldOffIcon },
}

export const PROBE_STATE: Record<ProbeState, { tone: StateTone; icon: LucideIcon }> = {
  never: { tone: "neutral", icon: CircleDashedIcon },
  ok: { tone: "success", icon: CircleCheckIcon },
  stale: { tone: "warning", icon: ClockIcon },
  failed: { tone: "danger", icon: CircleXIcon },
}

/** 运行环境图标（DESIGN.md 图标表）：Windows 用 MonitorIcon，WSL 用 SquareTerminalIcon */
export function EnvIcon({ envId, className }: { envId: string; className?: string }) {
  const Icon = envId === "windows" ? MonitorIcon : SquareTerminalIcon
  return <Icon className={cn("size-4 shrink-0", className)} aria-hidden />
}

/** 护栏状态徽章（6.11 状态词表） */
export function GuardBadge({ state, className }: { state: GuardState; className?: string }) {
  const { tone, icon } = GUARD_STATE[state]
  return (
    <StateBadge tone={tone} icon={icon} className={className}>
      {copy.guardState[state]}
    </StateBadge>
  )
}
