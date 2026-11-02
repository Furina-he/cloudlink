import { ArrowLeftIcon } from "lucide-react"
import type { ReactNode } from "react"

import type { Mode } from "@/bindings"
import { AGENT_TILE_ON, AgentMark } from "@/components/app/AgentMark"
import { Button } from "@/components/ui/button"
import { DialogTitle } from "@/components/ui/dialog"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { AgentOption } from "@/features/agents/agentKeys"
import { copy } from "@/lib/copy"
import { cn } from "@/lib/utils"
import { useUIStore } from "@/stores/ui"
import { ClosePanelButton } from "./InspectorParts"
import { MODE_ICON } from "./ModeSwitch"

/** 添加弹窗的标题行：返回选择类型、标题、关闭 */
export function CreateHeader({ title, icon, back = true }: { title: string; icon?: ReactNode; back?: boolean }) {
  return (
    <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2.5">
      {back && (
        <Tooltip>
          <TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label={copy.create.back} onClick={() => useUIStore.getState().startCreate()} />}>
            <ArrowLeftIcon />
          </TooltipTrigger>
          <TooltipContent>{copy.create.back}</TooltipContent>
        </Tooltip>
      )}
      {icon}
      <DialogTitle id="detail-title" className="min-w-0 truncate text-base font-semibold">
        {title}
      </DialogTitle>
      <span className="ml-auto" />
      <ClosePanelButton />
    </div>
  )
}

/** 「连接成功后授权给」（PRD 6.5）：保存之前的选择，用 ToggleGroup 多选，点亮的 Agent 在启用时一并分发 */
export function AgentChoice({ agents, value, onChange, labelledBy }: { agents: AgentOption[]; value: string[]; onChange: (keys: string[]) => void; labelledBy: string }) {
  if (agents.length === 0) return <span className="text-xs text-muted-foreground">{copy.agentSection.noTargets}</span>
  return (
    <ToggleGroup multiple variant="outline" size="sm" spacing={1} value={value} onValueChange={onChange} aria-labelledby={labelledBy} className="flex-wrap">
      {agents.map((a) => {
        const on = value.includes(a.key)
        return (
          <ToggleGroupItem key={a.key} value={a.key} className={cn("max-w-44", AGENT_TILE_ON[a.agent], on ? "text-foreground" : "text-muted-foreground")}>
            <AgentMark agent={a.agent} label={a.label} lit={on} />
            <span className="truncate">{a.agent === "universal" ? a.label : a.short}</span>
          </ToggleGroupItem>
        )
      })}
    </ToggleGroup>
  )
}

/** 「默认档位」：新建时的单选；生产资源选标准运维时提示会有琥珀色提醒 */
export function ModeChoice({ value, onChange, prod, labelledBy }: { value: Mode; onChange: (mode: Mode) => void; prod: boolean; labelledBy: string }) {
  return (
    <div className="flex flex-col gap-1">
      <ToggleGroup variant="outline" size="sm" spacing={0} value={[value]} onValueChange={(next) => next[0] && onChange(next[0] as Mode)} aria-labelledby={labelledBy}>
        {(["read-only", "standard"] as const).map((mode) => {
          const Icon = MODE_ICON[mode]
          return (
            <ToggleGroupItem key={mode} value={mode} className="px-3">
              <Icon />
              {copy.mode[mode]}
            </ToggleGroupItem>
          )
        })}
      </ToggleGroup>
      {prod && value === "standard" && <p className="text-xs text-warning">{copy.create.prodStandardHint}</p>}
    </div>
  )
}

/** 添加面板底部的授权和档位（两类资源共用） */
export function GrantFields({
  title,
  agents,
  selected,
  onSelected,
  mode,
  onMode,
  prod,
}: {
  title: string
  agents: AgentOption[]
  selected: string[]
  onSelected: (keys: string[]) => void
  mode: Mode
  onMode: (mode: Mode) => void
  prod: boolean
}) {
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2">
      <span id="create-grant-label" className="text-xs font-medium text-muted-foreground">
        {title}
      </span>
      <AgentChoice agents={agents} value={selected} onChange={onSelected} labelledBy="create-grant-label" />
      <span id="create-mode-label" className="self-start pt-1.5 text-xs font-medium text-muted-foreground">
        {copy.create.defaultMode}
      </span>
      <ModeChoice value={mode} onChange={onMode} prod={prod} labelledBy="create-mode-label" />
    </div>
  )
}
