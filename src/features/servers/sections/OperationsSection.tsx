import { CircleCheckIcon, ShieldXIcon, type LucideIcon } from "lucide-react"

import type { Operation, OperationDecision } from "@/bindings"
import {
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@/components/ui/trace"
import { copy } from "@/lib/copy"
import { formatDateTime, formatRelative } from "@/lib/format"
import { cn } from "@/lib/utils"

/** 结果图标（PRD 6.4）：放行、拦下 */
const DECISION: Record<OperationDecision, { icon: LucideIcon; className: string }> = {
  allowed: { icon: CircleCheckIcon, className: "text-success" },
  denied: { icon: ShieldXIcon, className: "text-destructive" },
}

/**
 * 一条护栏记录：结果图标、相对时间（和动态页一致）、命令（等宽、截断，可以展开）。
 * 工作目录只在展开后显示完整路径：放在行尾只有一个文件夹名，在资源详情里看不出是什么
 */
export function OperationLine({ op }: { op: Operation }) {
  const { icon: Icon, className } = DECISION[op.decision]
  const reason = op.reasonId ? copy.guardReason[op.reasonId] : null
  return (
    <TraceCollapsible role="listitem">
      <TraceCollapsibleTrigger aria-label={`${copy.operations.expand}：${op.command}`} className="max-w-full">
        <TraceLine status={op.decision === "denied" ? "error" : undefined} className="max-w-full">
          <TraceIcon>
            <Icon className={className} />
          </TraceIcon>
          <TraceDescription className="shrink-0">{formatRelative(op.at)}</TraceDescription>
          <TraceTitle className="font-mono text-xs text-foreground">{op.command}</TraceTitle>
          <span className="sr-only">{copy.decision[op.decision]}</span>
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent className="flex flex-col gap-1 text-xs">
        <code className="font-mono break-all text-foreground">{op.command}</code>
        <span className={cn(op.decision === "denied" && "text-destructive")}>
          {/* 标准运维资源上解析不了的命令：放行并在记录中标注（F-306 AC3） */}
          {op.decision === "allowed" && op.reasonId === "unparsed" ? copy.unparsedAllowed : reason ? `${copy.decision[op.decision]}：${reason}` : copy.decision[op.decision]}
        </span>
        <span className="font-mono">{op.cwd}</span>
        <span>{copy.operations.meta(formatDateTime(op.at), copy.env.long(op.envId), op.sessionId)}</span>
      </TraceCollapsibleContent>
    </TraceCollapsible>
  )
}
