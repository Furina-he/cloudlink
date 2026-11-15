import { CircleCheckIcon, ClockIcon, ShieldXIcon } from "lucide-react"

import type { Operation } from "@/bindings"
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
import { formatDateTime, formatDuration, formatRelative } from "@/lib/format"
import { operationStatus } from "@/lib/operation-status"
import { cn } from "@/lib/utils"

/**
 * 一条护栏记录：结果图标、相对时间（和动态页一致）、命令（等宽、截断，可以展开）。
 * 工作目录只在展开后显示完整路径：放在行尾只有一个文件夹名，在资源详情里看不出是什么
 */
export function OperationLine({ op }: { op: Operation }) {
  const status = operationStatus(op)
  const Icon = status.tone === "ok" ? CircleCheckIcon : status.tone === "err" ? ShieldXIcon : ClockIcon
  const className = status.tone === "ok" ? "text-success" : status.tone === "err" ? "text-destructive" : "text-muted-foreground"
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
          <span className="sr-only">{status.text}</span>
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent className="flex flex-col gap-1 text-xs">
        <code className="font-mono break-all text-foreground">{op.command}</code>
        <span className={cn(op.decision === "denied" && "text-destructive")}>
          {/* 标准运维资源上解析不了的命令：放行并在记录中标注（F-306 AC3） */}
          {reason ? `${status.text}：${reason}` : status.text}
        </span>
        <span>{op.source === "runner" ? copy.execution.runnerSource : copy.execution.hookSource}</span>
        {op.exitCode !== undefined && <span className="tabular-nums">{copy.execution.exitCode(op.exitCode)}</span>}
        {op.durationMs !== undefined && <span className="tabular-nums">{copy.execution.duration(formatDuration(op.durationMs))}</span>}
        <span className="font-mono">{op.cwd}</span>
        <span>{copy.operations.meta(formatDateTime(op.at), copy.env.long(op.envId), op.sessionId)}</span>
      </TraceCollapsibleContent>
    </TraceCollapsible>
  )
}
