import { CopyIcon, LockIcon, LockOpenIcon, PlugIcon, RadarIcon, ServerIcon, Trash2Icon } from "lucide-react"
import { motion } from "motion/react"

import type { Asset } from "@/bindings"
import { CONN_STATE, StateText } from "@/components/app/StateBadge"
import { Truncate } from "@/components/app/Truncate"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { Spinner } from "@/components/ui/spinner"
import { useAgentOptions } from "@/features/agents/agentKeys"
import { useMinuteTick } from "@/hooks/use-minute-tick"
import { copy } from "@/lib/copy"
import { cn } from "@/lib/utils"
import { connState, selectCanDistribute, selectUnlockRemaining } from "@/stores/assets"
import { selectPendingCount, useNotesStore } from "@/stores/notes"
import { isProbing, useProbeStore } from "@/stores/probe"
import { serverActions } from "./actions"
import { AgentPicker } from "./AgentPicker"

/** 系统图标（6.4）：取探测到的发行版首字母；没有探测时用 ServerIcon。不用发行版 Logo（DESIGN.md） */
function OsMark({ os }: { os?: string }) {
  return (
    <span aria-hidden className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted font-mono text-xs font-medium text-muted-foreground">
      {os ? os[0].toUpperCase() : <ServerIcon className="size-4" />}
    </span>
  )
}

/** 服务器卡片（PRD 6.4）：打开按钮在卡片上半部；底部一排 Agent 按钮单独可操作，点按钮不打开详情 */
export function ServerCard({ asset, current, fresh, onOpen }: { asset: Asset; current: boolean; fresh: boolean; onOpen: () => void }) {
  const notes = useNotesStore((s) => selectPendingCount(s.byAsset, asset.id))
  const probing = useProbeStore((s) => isProbing(s, asset.id))
  const now = useMinuteTick()
  const remaining = selectUnlockRemaining(asset, now)
  const alias = asset.connection.sshAlias
  const state = connState(asset)
  const { tone, icon } = CONN_STATE[state]
  const can = selectCanDistribute(asset)
  const { agents } = useAgentOptions()
  const blocked = asset.agent.agents.length === 0 && !can.ok
  const stateWords = `${copy.connState[state]}，${copy.mode[asset.agent.mode]}`

  return (
    <motion.div initial={fresh ? { opacity: 0, y: 4 } : false} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }}>
      <ContextMenu>
        <ContextMenuTrigger
          render={
            <Card
              size="sm"
              className={cn(
                "gap-2 py-0 has-[[data-grid-cell]:focus-visible]:ring-2 has-[[data-grid-cell]:focus-visible]:ring-ring",
                current && "bg-muted ring-ring"
              )}
            />
          }
        >
          <button
            type="button"
            data-grid-cell
            aria-current={current ? "true" : undefined}
            aria-label={copy.servers.cardOpen(alias, asset.name, stateWords)}
            onClick={onOpen}
            className="flex min-w-0 flex-col gap-1.5 px-3 pt-3 text-left outline-none"
          >
            <span className="flex min-w-0 items-center gap-2">
              <OsMark os={asset.facts.os} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-mono text-[0.8125rem] font-medium">{alias}</span>
                <Truncate text={asset.name} className="text-xs text-muted-foreground" />
              </span>
              {probing && <Spinner aria-hidden className="size-3.5 text-muted-foreground" />}
            </span>
            <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs">
              <StateText tone={tone} icon={icon}>
                {copy.connState[state]}
              </StateText>
              <span className="text-muted-foreground">{copy.mode[asset.agent.mode]}</span>
              {notes > 0 && <Badge variant="outline">{copy.servers.notesBadge(notes)}</Badge>}
              {remaining !== null && <Badge variant="warning">{copy.servers.unlockedBadge(remaining)}</Badge>}
              {probing && <span className="sr-only">{copy.servers.probingLabel}</span>}
            </span>
            {state === "changed" && <span className="text-xs text-warning">{copy.connChangedHint}</span>}
          </button>
          <div className="flex min-h-7 items-center px-3 pb-3">
            {agents.length === 0 ? (
              <span className="text-xs text-muted-foreground">{copy.servers.noAgents}</span>
            ) : blocked ? (
              <span className="text-xs text-muted-foreground">{copy.distributeBlockShort[can.reason]}</span>
            ) : (
              <AgentPicker asset={asset} agents={agents} compact className="ml-auto" />
            )}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-auto min-w-44">
          <ContextMenuItem onClick={() => serverActions.test(asset)}>
            <PlugIcon />
            {copy.detail.test}
          </ContextMenuItem>
          <ContextMenuItem onClick={() => (probing ? serverActions.cancelProbe(asset) : serverActions.probe(asset))}>
            <RadarIcon />
            {probing ? copy.detail.cancelProbe : copy.detail.probe}
          </ContextMenuItem>
          {remaining !== null ? (
            <ContextMenuItem onClick={() => serverActions.lock(asset)}>
              <LockIcon />
              {copy.agentSection.lockNow}
            </ContextMenuItem>
          ) : (
            <ContextMenuItem onClick={() => serverActions.requestUnlock(asset)}>
              <LockOpenIcon />
              {copy.agentSection.unlock}
            </ContextMenuItem>
          )}
          <ContextMenuItem onClick={() => serverActions.copyAlias(asset)}>
            <CopyIcon />
            {copy.detail.copyAlias}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem variant="destructive" onClick={() => serverActions.requestDelete(asset)}>
            <Trash2Icon />
            {copy.detail.delete}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </motion.div>
  )
}
