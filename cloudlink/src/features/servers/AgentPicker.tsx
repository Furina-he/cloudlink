import type { Asset } from "@/bindings"
import { AGENT_TILE_ON, AgentMark } from "@/components/app/AgentMark"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { copy } from "@/lib/copy"
import { cn } from "@/lib/utils"
import type { AgentOption } from "@/features/agents/agentKeys"
import { handleOf, selectCanDistribute } from "@/stores/assets"
import { serverActions } from "./actions"

/**
 * 分发给哪些 Agent（F-303，参考 CC Switch，2026-11-01 用户确认）：每个启用的 Agent 一个按钮，点亮即分发，可以多选。
 * 回路行上是只有标识的小方块，名称在 Tooltip 里（compact）；详情的 Agent 分段是标识加名称。
 * 不能分发时（未验证、只用密码），没点亮的按钮不可用，已点亮的仍然可以取消
 */
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
  const can = selectCanDistribute(asset).ok
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
        const props = { value: a.key, disabled: !on && !can, "aria-label": copy.servers.agentToggle(alias, a.label) }
        if (!compact) {
          // 详情里保留描边，未点亮的也看得出是按钮
          return (
            <ToggleGroupItem key={a.key} {...props} className={cn("max-w-44", AGENT_TILE_ON[a.agent], on ? "text-foreground" : "text-muted-foreground")}>
              <AgentMark agent={a.agent} label={a.label} lit={on} />
              <span className="truncate">{a.short}</span>
            </ToggleGroupItem>
          )
        }
        // 回路行上同 CC Switch：未点亮时没有底色和描边，只有灰色标识；悬停用墨色淡底（选中的回路行本身就是 muted 底，bg-muted 看不出来）
        const tile = cn("size-7 border-transparent bg-transparent px-0 hover:bg-foreground/6", AGENT_TILE_ON[a.agent])
        return (
          <Tooltip key={a.key}>
            <TooltipTrigger render={<ToggleGroupItem {...props} className={tile} />}>
              <AgentMark agent={a.agent} label={a.label} lit={on} />
            </TooltipTrigger>
            <TooltipContent>{a.label}</TooltipContent>
          </Tooltip>
        )
      })}
    </ToggleGroup>
  )
}
