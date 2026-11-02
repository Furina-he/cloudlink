import { CircleCheckIcon, CircleMinusIcon, EyeIcon, LockIcon, LockOpenIcon, TriangleAlertIcon, WrenchIcon } from "lucide-react"
import { useMemo } from "react"
import { useShallow } from "zustand/react/shallow"

import type { Asset, Inclusion, Mode } from "@/bindings"
import { EnvIcon, GuardBadge } from "@/components/app/StateBadge"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "@/components/ui/toast"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useMinuteTick } from "@/hooks/use-minute-tick"
import { copy } from "@/lib/copy"
import { compileLabel, useAgentOptions, type CompileTarget } from "@/features/agents/agentKeys"
import { connState, selectCanDistribute, selectUnlockRemaining } from "@/stores/assets"
import { selectInclusionsByAsset, useDeliveryStore } from "@/stores/deliveries"
import { selectWorstGuard, useGuardStore } from "@/stores/guard"
import { useTargetStore } from "@/stores/targets"
import { useUIStore } from "@/stores/ui"
import { serverActions, toastError, useConverting } from "../actions"
import { AgentPicker } from "../AgentPicker"

const MODES: { mode: Mode; icon: typeof EyeIcon }[] = [
  { mode: "read-only", icon: EyeIcon },
  { mode: "standard", icon: WrenchIcon },
]

/** 详情 Agent 分段里的处理入口 */
export interface AgentFixes {
  test: () => void
  convert: () => void
  /** 打开连接编辑并聚焦某个字段（写入的运行环境、私钥） */
  editConnection: (path: "connection.definedIn" | "connection.identityFile") => void
}

/** 临时解锁（F-306 AC2）：解锁期间换成剩余时间和「立即锁回」；剩余时间每分钟更新，不设 aria-live（6.12） */
function UnlockControl({ asset }: { asset: Asset }) {
  const now = useMinuteTick()
  const remaining = selectUnlockRemaining(asset, now)
  if (remaining === null) {
    return (
      <Button variant="outline" size="sm" onClick={() => serverActions.requestUnlock(asset)}>
        <LockOpenIcon data-icon="inline-start" />
        {copy.agentSection.unlock}
      </Button>
    )
  }
  return (
    <span className="flex items-center gap-2">
      <Badge variant="warning">{copy.agentSection.unlocked(remaining)}</Badge>
      <Button variant="outline" size="sm" onClick={() => serverActions.lock(asset)}>
        <LockIcon data-icon="inline-start" />
        {copy.agentSection.lockNow}
      </Button>
    </span>
  )
}

/** 列入情况的一行（F-303 AC2）：点选的一个 Agent 在一个运行环境里是否列入；未列入时写明原因、给出处理入口 */
function InclusionRow({ inc, label, fixes, agentWarning }: { inc: Inclusion; label: string; fixes: AgentFixes; agentWarning: boolean }) {
  const reason = inc.reason
  const fixLabel = reason ? copy.inclusionFix[reason.id] : undefined
  const fix = () => {
    if (!reason) return
    if (reason.id === "password-only") fixes.convert()
    else if (reason.id === "not-written") fixes.editConnection("connection.definedIn")
    else if (reason.id === "no-key-in-env") fixes.editConnection("connection.identityFile")
    else if (reason.id === "include-missing") {
      useTargetStore
        .getState()
        .addSshInclude(inc.envId)
        .then(() => toast.add({ title: copy.include.added(copy.env.long(inc.envId)), type: "success" }))
        .catch(toastError)
    }
  }
  return (
    <Item role="listitem" variant="outline" size="xs" className="items-start">
      <ItemMedia className="pt-0.5">
        <EnvIcon envId={inc.envId} className="text-muted-foreground" />
      </ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle className="flex-wrap">
          {label}
          {inc.included ? (
            <span className="flex items-center gap-1 font-normal text-success">
              <CircleCheckIcon className="size-3.5" aria-hidden />
              {copy.inclusion.included}
            </span>
          ) : (
            <span className="flex items-center gap-1 font-normal text-muted-foreground">
              <CircleMinusIcon className="size-3.5" aria-hidden />
              {copy.inclusion.excluded}
            </span>
          )}
        </ItemTitle>
        {reason && <ItemDescription className="line-clamp-none">{copy.inclusionReason[reason.id](reason.params)}</ItemDescription>}
        {agentWarning && (
          <ItemDescription className="line-clamp-none text-warning">
            <TriangleAlertIcon className="mr-1 inline size-3.5 align-[-2px]" aria-hidden />
            {copy.agentSection.agentKeyWarning}
          </ItemDescription>
        )}
      </ItemContent>
      {fixLabel && (
        <ItemActions>
          <Button variant="outline" size="xs" onClick={fix}>
            {fixLabel}
          </Button>
        </ItemActions>
      )}
    </Item>
  )
}

/** 列入情况的顺序和名称跟每一份总 Skill 一致：按运行环境、Agent 排序 */
function sortRows(rows: Inclusion[], targets: CompileTarget[]) {
  const order = (i: Inclusion) => {
    const n = targets.findIndex((t) => t.envId === i.envId && t.agentKey === i.agentKey)
    return n < 0 ? targets.length : n
  }
  return [...rows].sort((a, b) => order(a) - order(b))
}

/**
 * Agent 分段（PRD 6.4），固定在第一位、默认展开。分发给哪些 Agent、档位、临时解锁立即生效，不经过保存；
 * 护栏行取这台服务器所在运行环境里最差的一个
 */
export function AgentSection({ asset, fixes }: { asset: Asset; fixes: AgentFixes }) {
  const can = selectCanDistribute(asset)
  const converting = useConverting((s) => s.ids.includes(asset.id))
  const inclusions = useDeliveryStore(useShallow((s) => selectInclusionsByAsset(s.inclusions, asset.id)))
  const targets = useTargetStore((s) => s.targets)
  const guards = useGuardStore((s) => s.statusByEnv)
  const { agents, compileTargets } = useAgentOptions()
  const selected = asset.agent.agents
  // 只列点选了的 Agent：没点选的已经由按钮表明「不分发」
  const rows = useMemo(
    () => sortRows(inclusions.filter((i) => selected.includes(i.agentKey)), compileTargets),
    [inclusions, selected, compileTargets]
  )

  const ccEnvs = targets.filter((t) => t.agent === "claude-code").map((t) => t.envId)
  const guard = selectWorstGuard(ccEnvs.filter((e) => asset.connection.definedIn.includes(e)).map((e) => guards[e]))
  const blocked = selected.length === 0 && !can.ok
  // 8.3：依赖 ssh-agent 的服务器，Windows 上的 Claude Code 读不到 Windows 服务里的密钥
  const agentAuth = asset.connection.auth?.method === "agent"

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <span id="detail-agents-label" className="text-sm font-medium">
          {copy.agentSection.distribute}
        </span>
        {agents.length > 0 && !blocked && <AgentPicker asset={asset} agents={agents} labelledBy="detail-agents-label" describedBy="detail-agents-hint" />}
        <p id="detail-agents-hint" className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {agents.length === 0 ? (
            <>
              {copy.agentSection.noTargets}
              <Button variant="link" size="xs" className="h-auto p-0" onClick={() => useUIStore.getState().setView("agents")}>
                {copy.agentSection.goAgents}
              </Button>
            </>
          ) : selected.length === 0 && !can.ok ? (
            <>
              <span className="text-warning">{copy.distributeBlock[can.reason]}</span>
              <Button variant="outline" size="xs" disabled={converting} onClick={can.reason === "password-only" ? fixes.convert : fixes.test}>
                {converting && <Spinner data-icon="inline-start" aria-hidden />}
                {can.reason === "password-only" ? copy.test.convertKey : copy.test.button}
              </Button>
            </>
          ) : connState(asset) === "changed" ? (
            <span className="text-warning">{copy.connChangedHint}</span>
          ) : (
            copy.agentSection.distributeHint
          )}
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <span id="detail-mode-label" className="text-sm font-medium">
          {copy.agentSection.mode}
        </span>
        <ToggleGroup
          aria-labelledby="detail-mode-label"
          variant="outline"
          size="sm"
          spacing={0}
          value={[asset.agent.mode]}
          onValueChange={(next) => next[0] && serverActions.requestMode(asset, next[0] as Mode)}
        >
          {MODES.map(({ mode, icon: Icon }) => (
            <ToggleGroupItem key={mode} value={mode} className="px-3">
              <Icon />
              {copy.mode[mode]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <p className="text-xs text-muted-foreground">{copy.modeHint[asset.agent.mode]}</p>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-sm font-medium">{copy.agentSection.guard}</span>
        {guard ? <GuardBadge state={guard.state} /> : <span className="text-xs text-muted-foreground">{copy.agentSection.guardNone}</span>}
        {guard?.detail && <span className="text-xs text-muted-foreground">{copy.guardDetail[guard.detail.id](guard.detail.params)}</span>}
        <Button variant="link" size="xs" className="h-auto p-0" onClick={() => useUIStore.getState().setView("agents")}>
          {copy.agentSection.guardLink}
        </Button>
        <span className="ml-auto">
          <UnlockControl asset={asset} />
        </span>
      </div>

      {rows.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">{copy.agentSection.inclusions}</span>
          <ItemGroup className="gap-1.5" aria-label={copy.agentSection.inclusions}>
            {rows.map((inc) => (
              <InclusionRow
                key={`${inc.envId}|${inc.agentKey}`}
                inc={inc}
                label={compileLabel(compileTargets, inc)}
                fixes={fixes}
                agentWarning={agentAuth && inc.envId === "windows" && inc.agentKey === "claude-code"}
              />
            ))}
          </ItemGroup>
        </div>
      )}
    </div>
  )
}
