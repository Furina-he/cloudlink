import { EllipsisIcon, FolderOpenIcon, RefreshCwIcon, ScrollTextIcon, ShieldCheckIcon, ShieldOffIcon, Trash2Icon, WrenchIcon } from "lucide-react"
import type { ReactNode } from "react"

import type { AgentBrand, Delivery, Environment, GuardStatus, Target } from "@/bindings"
import { AgentMark, BrandMark } from "@/components/app/AgentMark"
import { DELIVERY_STATE, GuardBadge, StateBadge } from "@/components/app/StateBadge"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { copy } from "@/lib/copy"
import { isDeliveryProblem } from "@/stores/deliveries"
import { readersOf } from "./agentKeys"
import { useGuardDialog } from "./GuardDialogs"
import { targetActions, targetLabel, useTargetUI } from "./targetActions"

/** 家目录下的路径写成 `~` 开头，完整路径放在 Tooltip 里 */
export function homeRelative(path: string, home: string | undefined, windows: boolean): string {
  if (!home) return path
  const base = home.replace(/[\\/]+$/, "")
  const same = windows ? path.toLowerCase().startsWith(base.toLowerCase()) : path.startsWith(base)
  const rest = path.slice(base.length)
  return same && (rest === "" || rest.startsWith("\\") || rest.startsWith("/")) ? `~${rest}` : path
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "")

/** 自定义目录的名称是某个已检测到的 Agent，而它已经读取一个启用的内置目录：会看到两份 */
function duplicateOf(target: Target, env: Environment | undefined, targets: Target[]): { brand: AgentBrand; via: Target } | null {
  if (target.agent !== "custom" || !target.enabled || !env) return null
  const found = env.agents.find((a) => norm(copy.brand[a.brand]) === norm(target.label))
  if (!found) return null
  const via = targets.find((t) => t.envId === target.envId && t.enabled && t.agent !== "custom" && found.reads.includes(t.agent))
  return via ? { brand: found.brand, via } : null
}

/** 副本状态（6.11 状态词表）：已同步 N 项 / 副本缺失 / 副本被改动 / 待同步 / 冲突 / 同步中 */
function DeliveryState({ target, delivery, included, busy }: { target: Target; delivery: Delivery | undefined; included: number; busy: boolean }) {
  if (busy) {
    return (
      <StateBadge tone="neutral" icon={null}>
        {copy.delivery.pending}
      </StateBadge>
    )
  }
  if (!target.enabled) return <span className="text-xs text-muted-foreground">{copy.targets.disabled}</span>
  if (!delivery) return <span className="text-xs text-muted-foreground">{copy.deliveryNone}</span>
  const { tone, icon } = DELIVERY_STATE[delivery.status]
  return (
    <StateBadge tone={tone} icon={icon}>
      {delivery.status === "ok" ? copy.deliveryOk(included) : copy.delivery[delivery.status]}
    </StateBadge>
  )
}

/** 一行里的说明（读取的 Agent、问题、护栏原因），和名称左对齐 */
function Note({ children }: { children: ReactNode }) {
  return <div className="pl-9.5 text-xs text-muted-foreground">{children}</div>
}

/** 通用目录下面一行：检测到的、把它当作主要目录的 Agent，官方 Logo 加名称 */
function Readers({ brands }: { brands: AgentBrand[] }) {
  if (brands.length === 0) return <Note>{copy.agents.readersNone}</Note>
  return (
    <Note>
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <ul aria-label={copy.agents.readersLabel} className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          {brands.map((b) => (
            <li key={b} className="inline-flex items-center gap-1 text-foreground/80">
              <BrandMark brand={b} className="size-3.5" />
              {copy.brand[b]}
            </li>
          ))}
        </ul>
        {/* 列表本身已经由 aria-label 说明，这句只给视觉读者 */}
        <span aria-hidden>{copy.agents.readersSuffix}</span>
      </div>
    </Note>
  )
}

/**
 * Agent 页的一个目录（PRD 6.6，2026-11-07 重新设计）：标识与名称、`~` 开头的目录、副本状态、启用开关、更多操作；
 * Claude Code 那一行同时显示这个运行环境的护栏，通用目录下面列出读取它的 Agent
 */
export function TargetRow({
  target,
  delivery,
  included,
  env,
  targets,
  guard,
  onShowRules,
}: {
  target: Target
  delivery: Delivery | undefined
  included: number
  env: Environment | undefined
  targets: Target[]
  /** 只有 Claude Code 那一行有；undefined 表示还没加载 */
  guard?: GuardStatus | null
  onShowRules: () => void
}) {
  const busy = useTargetUI((s) => s.busy.includes(target.id))
  const label = targetLabel(target)
  const envName = copy.env.long(target.envId)
  const problem = target.enabled && !!delivery && isDeliveryProblem(delivery)
  const isClaude = target.agent === "claude-code"
  // 加载完但没有这个环境的状态：按「未安装」处理（与原护栏分区一致）
  const guardState = guard === undefined ? undefined : (guard?.state ?? "not-installed")
  const showGuard = isClaude && target.enabled && guard !== undefined
  const guardProblem = showGuard && guardState === "broken"
  const readers = target.agent === "universal" ? readersOf(env ? [env] : [], target.envId, "universal") : []
  const duplicate = duplicateOf(target, env, targets)
  const requestGuard = (kind: "install" | "remove") => useGuardDialog.getState().set({ kind, envId: target.envId })

  return (
    <div role="listitem" data-problem={problem || guardProblem || undefined} className="flex flex-col gap-1.5 px-3 py-2.5">
      <div className="flex min-h-8 items-center gap-2.5">
        <span aria-hidden className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted">
          <AgentMark agent={target.agent} label={label} lit={target.enabled} />
        </span>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-1">
          <span className="text-sm font-medium">{label}</span>
          <Tooltip>
            <TooltipTrigger render={<span tabIndex={0} className="rounded-sm font-mono text-xs text-muted-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50" />}>
              {homeRelative(target.path, env?.home, target.envId === "windows")}
            </TooltipTrigger>
            <TooltipContent className="font-mono">{target.path}</TooltipContent>
          </Tooltip>
          <DeliveryState target={target} delivery={delivery} included={included} busy={busy} />
          {!target.detected && target.agent !== "custom" && <Badge variant="outline">{copy.targets.notDetected}</Badge>}
          {showGuard && guardState && (
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              {copy.agents.guard}
              <GuardBadge state={guardState} />
              {guardState === "active" && <span className="tabular-nums">{copy.guard.deniedToday(guard?.deniedToday ?? 0)}</span>}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {problem && delivery && delivery.status !== "conflict" && (
            <Button variant="outline" size="sm" disabled={busy} onClick={() => targetActions.repair(target, delivery)} aria-label={`${copy.targets.repair}：${label}（${envName}）`}>
              {busy ? <Spinner data-icon="inline-start" aria-hidden /> : <WrenchIcon data-icon="inline-start" />}
              {copy.targets.repair}
            </Button>
          )}
          {problem && delivery?.status === "conflict" && (
            <Button variant="outline" size="sm" onClick={() => void targetActions.checkAll()} aria-label={`${copy.targets.check}：${label}（${envName}）`}>
              <RefreshCwIcon data-icon="inline-start" />
              {copy.targets.check}
            </Button>
          )}
          {showGuard && (guardState === "not-installed" || guardState === "broken") && (
            <Button variant="outline" size="sm" onClick={() => requestGuard("install")} aria-label={`${guardState === "broken" ? copy.agents.reinstallGuard : copy.agents.installGuard}：${envName}`}>
              <ShieldCheckIcon data-icon="inline-start" />
              {guardState === "broken" ? copy.agents.reinstallGuard : copy.agents.installGuard}
            </Button>
          )}
          <Switch checked={target.enabled} disabled={busy} onCheckedChange={(on) => targetActions.toggle(target, on)} aria-label={copy.targets.enable(label, envName)} />
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={copy.targets.actions(`${label}（${envName}）`)} />}>
              <EllipsisIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-auto min-w-40">
              <DropdownMenuItem onClick={() => targetActions.reveal(target, delivery)}>
                <FolderOpenIcon />
                {copy.common.reveal}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void targetActions.checkAll()}>
                <RefreshCwIcon />
                {copy.targets.check}
              </DropdownMenuItem>
              {isClaude && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={onShowRules}>
                    <ScrollTextIcon />
                    {copy.agents.guardRules}
                  </DropdownMenuItem>
                  {guardState === "active" && (
                    <DropdownMenuItem onClick={() => requestGuard("remove")}>
                      <ShieldOffIcon />
                      {copy.agents.removeGuard}
                    </DropdownMenuItem>
                  )}
                </>
              )}
              {target.agent === "custom" && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onClick={() => useTargetUI.getState().set({ kind: "remove", targetId: target.id })}>
                    <Trash2Icon />
                    {copy.targets.removeCustom}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {target.agent === "universal" && <Readers brands={readers} />}
      {problem && delivery && <Note>{copy.deliveryDetail[delivery.status]}</Note>}
      {showGuard && guard?.detail && <Note>{copy.guardDetail[guard.detail.id](guard.detail.params)}</Note>}
      {duplicate && <Note>{copy.agents.duplicate(copy.brand[duplicate.brand], targetLabel(duplicate.via))}</Note>}
    </div>
  )
}
