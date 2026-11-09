import { ChevronDownIcon, EllipsisIcon, FolderOpenIcon, PlusIcon, ScrollTextIcon, ShieldCheckIcon, ShieldOffIcon, Trash2Icon } from "lucide-react"
import { useMemo, useState } from "react"

import type { AgentBrand, Delivery, EnvId, Environment, GuardStatus, Target } from "@/bindings"
import { AgentMark, BrandMark } from "@/components/app/AgentMark"
import { ListGroup } from "@/components/app/SettingsList"
import { BrandTile, StatusDot } from "@/components/app/StatusDot"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { copy } from "@/lib/copy"
import { sortEnvs } from "@/features/servers/serverForm"
import { useDeliveryStore } from "@/stores/deliveries"
import { useGuardStore } from "@/stores/guard"
import { useSettingsStore } from "@/stores/settings"
import { selectAvailableEnvs, useTargetStore } from "@/stores/targets"
import { useUIStore } from "@/stores/ui"
import { AGENT_ORDER, readersOf } from "./agentKeys"
import { CustomTargetDialog } from "./CustomTargetDialog"
import { useGuardDialog } from "./GuardDialogs"
import { TargetDialogs, targetActions, targetLabel, useTargetUI } from "./targetActions"

const ALL_BRANDS = Object.keys(copy.brand) as AgentBrand[]

/** 一行：一个 Agent（按 agentKey），合并它在各个可用运行环境里的目录 */
interface AgentGroup {
  key: string
  targets: Target[]
  deliveries: (Delivery | undefined)[]
  readers: AgentBrand[]
  resources: number
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "")

/** 自定义目录的名称是某个已检测到的 Agent，而它已经读取一个启用的内置目录：会看到两份 */
function duplicateOf(target: Target, envs: Environment[], targets: Target[]): { brand: AgentBrand; via: Target } | null {
  if (target.agent !== "custom" || !target.enabled) return null
  const env = envs.find((e) => e.id === target.envId)
  const found = env?.agents.find((a) => norm(copy.brand[a.brand]) === norm(target.label))
  if (!found) return null
  const via = targets.find((t) => t.envId === target.envId && t.enabled && t.agent !== "custom" && found.reads.includes(t.agent))
  return via ? { brand: found.brand, via } : null
}

/** 通用目录名称后面的小 Logo（悬停显示名字） */
function ReaderLogos({ brands }: { brands: AgentBrand[] }) {
  if (brands.length === 0) return null
  return (
    <ul aria-label={copy.agents.readersLabel} className="flex items-center gap-1">
      {brands.slice(0, 6).map((b) => (
        <li key={b}>
          <Tooltip>
            <TooltipTrigger render={<span tabIndex={0} className="flex size-4.5 items-center justify-center rounded-[5px] border border-line bg-card outline-none focus-visible:ring-2 focus-visible:ring-ring" />}>
              <BrandMark brand={b} className="size-3" />
              <span className="sr-only">{copy.brand[b]}</span>
            </TooltipTrigger>
            <TooltipContent>{copy.brand[b]}</TooltipContent>
          </Tooltip>
        </li>
      ))}
    </ul>
  )
}

/** 右边的护栏状态：Claude Code 可点（跳到动态），其他 Agent 是 muted「无护栏」 */
function GuardState({ group, guards }: { group: AgentGroup; guards: (GuardStatus | null)[] }) {
  if (group.targets[0].agent !== "claude-code") {
    return (
      <Tooltip>
        <TooltipTrigger render={<span tabIndex={0} className="rounded-sm text-xs text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring" />}>
          {copy.agents.guardNone}
        </TooltipTrigger>
        <TooltipContent>{copy.agents.guardNoneTip}</TooltipContent>
      </Tooltip>
    )
  }
  const active = guards.filter((g) => g?.state === "active")
  if (active.length === 0) {
    const env = group.targets.find((t) => t.enabled)?.envId
    if (!env || guards.some((g) => g?.state === "broken")) return null
    return (
      <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={() => useGuardDialog.getState().set({ kind: "install", envId: env })}>
        <ShieldCheckIcon data-icon="inline-start" />
        {copy.agents.guardInstall}
      </Button>
    )
  }
  const denied = active.reduce((n, g) => n + (g?.deniedToday ?? 0), 0)
  return (
    <Tooltip>
      <TooltipTrigger render={<Button variant="ghost" size="xs" className="text-fg-2" onClick={() => useUIStore.getState().setView("activity")} />}>
        <ShieldCheckIcon data-icon="inline-start" className="text-success" />
        {copy.agents.guardOn}
      </TooltipTrigger>
      <TooltipContent>{copy.agents.guardOnTip(denied)}</TooltipContent>
    </Tooltip>
  )
}

function AgentRow({ group, envs, allTargets }: { group: AgentGroup; envs: Environment[]; allTargets: Target[] }) {
  const first = group.targets[0]
  const label = targetLabel(first)
  const busy = useTargetUI((s) => group.targets.some((t) => s.busy.includes(t.id)))
  const guardByEnv = useGuardStore((s) => s.statusByEnv)
  const guardLoaded = useGuardStore((s) => s.status === "ready" || s.status === "error")
  const enabled = group.targets.filter((t) => t.enabled)
  const on = enabled.length > 0
  const isClaude = first.agent === "claude-code"
  const guards = isClaude && guardLoaded ? enabled.map((t) => guardByEnv[t.envId] ?? null) : []
  const broken = guards.filter((g) => g?.state === "broken")
  const conflicted = enabled.filter((t) => group.deliveries[group.targets.indexOf(t)]?.status === "conflict")
  const failed = enabled.some((t) => group.deliveries[group.targets.indexOf(t)]?.statusDetail)
  const syncing = busy || enabled.some((t) => group.deliveries[group.targets.indexOf(t)]?.status === "pending")
  const duplicate = group.targets.map((t) => duplicateOf(t, envs, allTargets)).find(Boolean)
  const envNames = sortEnvs(enabled.map((t) => t.envId)).map((id: EnvId) => copy.env.short(id)).join("、")

  let sub
  if (!on) {
    sub = (
      <>
        <StatusDot tone="off" />
        {copy.agents.disabled}
      </>
    )
  } else if (conflicted.length > 0) {
    sub = (
      <span className="flex items-center text-warning">
        <StatusDot tone="warn" />
        {copy.agents.conflict}
      </span>
    )
  } else if (broken.length > 0) {
    sub = (
      <span className="flex items-center text-warning">
        <StatusDot tone="warn" />
        {copy.agents.guardBroken}
      </span>
    )
  } else if (syncing) {
    sub = (
      <>
        <Spinner className="mr-1 size-3" aria-hidden />
        {copy.agents.syncing}
      </>
    )
  } else {
    sub = (
      <>
        <StatusDot tone={failed ? "warn" : "ok"} />
        {failed ? copy.agents.syncFailed : copy.agents.synced}
        <span aria-hidden className="px-1.5 text-faint">·</span>
        {copy.agents.resources(group.resources)}
        {first.agent === "universal" && group.readers.length > 0 ? (
          <>
            <span aria-hidden className="px-1.5 text-faint">·</span>
            {copy.agents.readers(group.readers.length)}
          </>
        ) : (
          envNames && (
            <>
              <span aria-hidden className="px-1.5 text-faint">·</span>
              {envNames}
            </>
          )
        )}
      </>
    )
  }

  const reveal = () => targetActions.reveal(enabled[0] ?? first, group.deliveries[group.targets.indexOf(enabled[0] ?? first)])
  return (
    <div role="listitem" data-problem={conflicted.length > 0 || broken.length > 0 || undefined} className="flex min-h-14 items-center gap-3 px-3.5 py-2.5">
      <BrandTile>
        <AgentMark agent={first.agent} label={label} lit={on} className="size-4.5" />
      </BrandTile>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[13px] font-medium">{label}</span>
          {first.agent === "universal" && <ReaderLogos brands={group.readers} />}
        </div>
        <div className="flex min-w-0 items-center text-xs text-muted-foreground">{sub}</div>
        {duplicate && <p className="text-xs text-muted-foreground">{copy.agents.duplicate(copy.brand[duplicate.brand], targetLabel(duplicate.via))}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {on && conflicted.length > 0 ? (
          <Button variant="outline" size="sm" disabled={busy} onClick={() => targetActions.takeOver(conflicted)} aria-label={copy.agents.takeOverLabel(label)}>
            {busy && <Spinner data-icon="inline-start" aria-hidden />}
            {copy.agents.takeOver}
          </Button>
        ) : on && broken.length > 0 ? (
          <Button variant="outline" size="sm" onClick={() => useGuardDialog.getState().set({ kind: "install", envId: broken[0]!.envId })}>
            {copy.agents.guardReinstall}
          </Button>
        ) : (
          on && <GuardState group={group} guards={guards} />
        )}
        <Switch checked={on} disabled={busy} onCheckedChange={(v) => targetActions.toggle(group.targets, v)} aria-label={copy.agents.enable(label)} />
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label={copy.agents.rowActions(label)} />}>
            <EllipsisIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-auto min-w-40">
            <DropdownMenuItem onClick={reveal}>
              <FolderOpenIcon />
              {copy.agents.reveal}
            </DropdownMenuItem>
            {isClaude && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => useUIStore.getState().setAgentsPage("rules")}>
                  <ScrollTextIcon />
                  {copy.agents.guardRules}
                </DropdownMenuItem>
                {guards
                  .filter((g) => g?.state === "active")
                  .map((g) => (
                    <DropdownMenuItem key={g!.envId} onClick={() => useGuardDialog.getState().set({ kind: "remove", envId: g!.envId })}>
                      <ShieldOffIcon />
                      {guards.length > 1 ? `${copy.agents.removeGuard}（${copy.env.short(g!.envId)}）` : copy.agents.removeGuard}
                    </DropdownMenuItem>
                  ))}
              </>
            )}
            {first.agent === "custom" && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={() => useTargetUI.getState().set({ kind: "remove", targetIds: group.targets.map((t) => t.id) })}>
                  <Trash2Icon />
                  {copy.agents.removeCustom}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}

/**
 * 已检测到（PRD 6.6）：一行一个分发目标（按目录计，同一 Agent 的 Windows 和 WSL 合并）。
 * 同步和副本修复是自动的（F-309），这里只有同名冲突和护栏未生效需要处理；未检测到的 Agent 折叠在最后
 */
export function AgentList() {
  const targets = useTargetStore((s) => s.targets)
  const environments = useTargetStore((s) => s.environments)
  const enabledEnvs = useSettingsStore((s) => s.settings?.environments)
  const loading = useTargetStore((s) => s.status === "idle" || s.status === "loading") && targets.length === 0
  const byId = useDeliveryStore((s) => s.byId)
  const inclusions = useDeliveryStore((s) => s.inclusions)
  const [customOpen, setCustomOpen] = useState(false)

  const { groups, envs, others } = useMemo(() => {
    const envs = selectAvailableEnvs(environments, enabledEnvs)
    const envIds = envs.map((e) => e.id)
    const deliveries = Object.values(byId)
    const keys = [...new Set(targets.filter((t) => envIds.includes(t.envId)).sort((a, b) => AGENT_ORDER[a.agent] - AGENT_ORDER[b.agent] || a.label.localeCompare(b.label)).map((t) => t.agentKey))]
    const groups: AgentGroup[] = keys.map((key) => {
      const list = sortEnvs(envIds)
        .flatMap((envId) => targets.filter((t) => t.agentKey === key && t.envId === envId))
      return {
        key,
        targets: list,
        deliveries: list.map((t) => deliveries.find((d) => d.targetId === t.id)),
        readers: [...new Set(envIds.flatMap((envId) => readersOf(envs, envId, list[0].agent)))],
        resources: new Set(inclusions.filter((i) => i.included && i.agentKey === key && envIds.includes(i.envId)).map((i) => i.assetId)).size,
      }
    })
    const detected = new Set(envs.flatMap((e) => e.agents.map((a) => a.brand)))
    return { groups, envs, others: ALL_BRANDS.filter((b) => !detected.has(b)) }
  }, [targets, environments, enabledEnvs, byId, inclusions])

  const actions = (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label={copy.agents.groupActions} />}>
        <EllipsisIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto min-w-40">
        <DropdownMenuItem onClick={() => setCustomOpen(true)}>
          <PlusIcon />
          {copy.agents.addCustom}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )

  return (
    <>
      <ListGroup id="agents-detected" title={copy.agents.detected} count={loading ? undefined : groups.length} action={actions}>
        {loading ? (
          <div className="flex flex-col gap-2 p-3.5" aria-busy="true" aria-label={copy.agents.loading}>
            <Skeleton className="h-9" />
            <Skeleton className="h-9" />
          </div>
        ) : (
          <>
            <div role="list" aria-labelledby="agents-detected" className="divide-y divide-line-2">
              {groups.map((g) => (
                <AgentRow key={g.key} group={g} envs={envs} allTargets={targets} />
              ))}
            </div>
            {others.length > 0 && (
              <Collapsible>
                <CollapsibleTrigger className="group/fold flex w-full items-center justify-center gap-1 px-3.5 py-2.5 text-xs text-muted-foreground outline-none hover:bg-card-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset">
                  <span className="group-data-panel-open/fold:hidden">{copy.agents.others(others.length)}</span>
                  <span className="hidden group-data-panel-open/fold:inline">{copy.agents.othersCollapse}</span>
                  <ChevronDownIcon aria-hidden className="size-3.5 transition-transform group-data-panel-open/fold:rotate-180" />
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <p className="border-t border-line-2 px-3.5 py-2.5 text-xs text-muted-foreground">{others.map((b) => copy.brand[b]).join("、")}</p>
                </CollapsibleContent>
              </Collapsible>
            )}
          </>
        )}
      </ListGroup>
      <TargetDialogs />
      <CustomTargetDialog open={customOpen} onOpenChange={setCustomOpen} />
    </>
  )
}
