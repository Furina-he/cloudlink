import type { Asset } from "@/bindings"
import { AGENT_TILE_ON, AgentMark } from "@/components/app/AgentMark"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { copy } from "@/lib/copy"
import { sharingKeys } from "@/lib/deliveryFeedback"
import { cn } from "@/lib/utils"
import type { AgentOption } from "@/features/agents/agentKeys"
import { handleOf, selectCanDistribute } from "@/stores/assets"
import { useDeliveryStore } from "@/stores/deliveries"
import { serverActions } from "./actions"

/** 检测/目标数据决定图标；同环境共用目录的提示只附在现有图标上（P8a）。 */
export function AgentPicker({
  asset,
  agents,
  compact = false,
  className,
  labelledBy,
  describedBy,
}: {
  asset: Asset
  agents: AgentOption[]
  compact?: boolean
  className?: string
  labelledBy?: string
  describedBy?: string
}) {
  const alias = handleOf(asset)
  const can = selectCanDistribute(asset)
  const byId = useDeliveryStore((s) => s.byId)
  const deliveries = Object.values(byId)
  const selected = agents.map((a) => a.key).filter((k) => asset.agent.agents.includes(k))

  const onChange = (next: string[]) => {
    const added = next.find((k) => !selected.includes(k))
    const removed = selected.find((k) => !next.includes(k))
    const key = added ?? removed
    const agent = agents.find((a) => a.key === key)
    if (agent) serverActions.toggleAgent(asset, agent, !!added)
  }

  return (
    <ToggleGroup
      multiple
      variant="outline"
      size="sm"
      spacing={1}
      value={selected}
      onValueChange={onChange}
      aria-label={labelledBy ? undefined : copy.servers.agentsLabel(alias)}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      className={cn("flex-wrap", className)}
    >
      {agents.map((a) => {
        const on = selected.includes(a.key)
        const shared = sharingKeys(a.key, deliveries).flatMap((key) => {
          const option = agents.find((a) => a.key === key)
          return option ? [option.label] : []
        })
        const tip = [
          a.readers.length ? copy.agents.readersTooltip(a.label, a.readers.map((b) => copy.brand[b]).join("、")) : a.label,
          shared.length > 1 ? copy.deliveryFeedback.sharedHint(shared) : "",
          !on && !can.ok ? copy.distributeBlock[can.reason] : "",
        ].filter(Boolean).join("\n")
        const tile = compact ? "size-7 border-transparent bg-transparent px-0 hover:bg-foreground/6" : "max-w-44"
        return (
          <Tooltip key={a.key}>
            <TooltipTrigger render={<ToggleGroupItem value={a.key} disabled={!on && !can.ok} aria-label={copy.servers.agentToggle(alias, a.label)} className={cn(tile, AGENT_TILE_ON[a.agent], !compact && (on ? "text-foreground" : "text-muted-foreground"))} />}>
              <AgentMark agent={a.agent} label={a.label} lit={on} />
              {!compact && <span className="truncate">{a.short}</span>}
            </TooltipTrigger>
            <TooltipContent className="whitespace-pre-line">{tip}</TooltipContent>
          </Tooltip>
        )
      })}
    </ToggleGroup>
  )
}
