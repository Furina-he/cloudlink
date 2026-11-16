import { BotIcon } from "lucide-react"

import type { InvocationSource, OperationSource } from "@/bindings"
import { BrandMark } from "@/components/app/AgentMark"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { copy } from "@/lib/copy"
import { cn } from "@/lib/utils"

function knownCaller(caller?: InvocationSource) {
  return caller?.agent && (caller.provenance === "self-reported" || caller.provenance === "hook" && caller.agent === "claude-code") ? caller : undefined
}

export const invocationName = (caller?: InvocationSource) => {
  const known = knownCaller(caller)
  return known ? copy.execution.sourceName(known.agent, known.provenance) : copy.execution.source
}

export const invocationChannel = (source?: OperationSource) => source === "runner" ? copy.execution.runnerSource : source === "hook" ? copy.execution.hookSource : copy.execution.unknownChannel

/** The caller and execution channel are separate facts; historical records never inherit a brand. */
export function InvocationAvatar({ caller, channel }: { caller?: InvocationSource; channel?: OperationSource }) {
  const known = knownCaller(caller)
  const name = invocationName(caller)
  const evidence = known?.provenance ?? "unknown"
  return (
    <Tooltip>
      <TooltipTrigger render={<span role="img" aria-label={name} tabIndex={0} className="flex size-5.5 shrink-0 items-center justify-center rounded-control border border-line bg-card outline-none focus-visible:ring-2 focus-visible:ring-ring" />}>
        {known?.agent ? <BrandMark brand={known.agent} className={cn("size-3.5", known.agent === "claude-code" ? "text-agent-claude" : "text-foreground")} /> : <BotIcon aria-hidden className="size-3.5 text-muted-foreground" />}
      </TooltipTrigger>
      <TooltipContent className="flex flex-col gap-0.5">
        <span>{name}</span>
        <span>{copy.execution.sourceEvidence[evidence]}</span>
        {channel && <span>{invocationChannel(channel)}</span>}
      </TooltipContent>
    </Tooltip>
  )
}
