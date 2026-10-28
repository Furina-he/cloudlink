import { InfoIcon } from "lucide-react"

import type { CompileBudget } from "@/bindings"
import { Item, ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item"
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { copy } from "@/lib/copy"
import { formatTokens } from "@/lib/format"
import { DESCRIPTION_MAX } from "@/lib/schemas"
import { cn } from "@/lib/utils"

/** 指示条：低于 90% 钢墨色，达到 90% 变琥珀，超过 100% 变红并配文字（DESIGN.md Context Budget） */
function toneOf(used: number, max: number) {
  const ratio = max > 0 ? used / max : 0
  return ratio > 1 ? "destructive" : ratio >= 0.9 ? "warning" : "default"
}

function TokenItem({ label, tokens, tip }: { label: string; tokens: number; tip: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Item
            size="xs"
            variant="muted"
            tabIndex={0}
            className="min-w-0 flex-1 cursor-default flex-nowrap px-2 py-1.5"
          />
        }
      >
        <ItemContent className="min-w-0">
          <ItemDescription className="flex items-center gap-1">
            {label}
            <InfoIcon className="size-3" aria-hidden />
          </ItemDescription>
          <ItemTitle className="font-mono text-[0.8125rem] font-normal tabular-nums">
            {formatTokens(tokens)}
          </ItemTitle>
        </ItemContent>
      </TooltipTrigger>
      <TooltipContent className="max-w-72 flex-col items-start gap-1">
        <span>{tip}</span>
        <span className="opacity-80">{copy.budget.estimateNote}</span>
      </TooltipContent>
    </Tooltip>
  )
}

function LimitBar({ label, used, max, text }: { label: string; used: number; max: number; text: string }) {
  const tone = toneOf(used, max)
  return (
    <Progress value={Math.min(100, max ? (used / max) * 100 : 0)} tone={tone} className="gap-1.5">
      <ProgressLabel className="text-xs font-normal text-muted-foreground">{label}</ProgressLabel>
      <ProgressValue
        className={cn(
          "font-mono text-xs",
          tone === "warning" && "text-warning",
          tone === "destructive" && "text-destructive"
        )}
      >
        {() => (
          <>
            {text}
            {tone !== "default" && <span className="ml-1 font-sans">{tone === "warning" ? copy.budget.near : copy.budget.over}</span>}
          </>
        )}
      </ProgressValue>
    </Progress>
  )
}

/** 上下文预算：三层 Token 估算 + description 字符数、正文行数两条上限 */
export function ContextBudget({ budget }: { budget: CompileBudget }) {
  return (
    <section aria-label={copy.budget.label} className="flex flex-col gap-2.5">
      <div className="flex gap-1.5">
        <TokenItem label={copy.budget.resident} tokens={budget.resident} tip={copy.budget.residentTip} />
        <TokenItem label={copy.budget.triggered} tokens={budget.triggered} tip={copy.budget.triggeredTip} />
        <TokenItem label={copy.budget.onDemand} tokens={budget.onDemand} tip={copy.budget.onDemandTip} />
      </div>
      <LimitBar
        label={copy.budget.description}
        used={budget.descriptionChars}
        max={DESCRIPTION_MAX}
        text={copy.budget.chars(budget.descriptionChars, DESCRIPTION_MAX)}
      />
      <LimitBar
        label={copy.budget.body}
        used={budget.bodyLines}
        max={budget.bodyLineLimit}
        text={copy.budget.lines(budget.bodyLines, budget.bodyLineLimit)}
      />
    </section>
  )
}
