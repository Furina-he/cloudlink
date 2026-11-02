import { CircleCheckIcon, ShieldXIcon, type LucideIcon } from "lucide-react"

import type { Operation, OperationDecision } from "@/bindings"
import { Button } from "@/components/ui/button"
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@/components/ui/trace"
import { copy } from "@/lib/copy"
import { formatDateTime } from "@/lib/format"
import { folderName } from "@/lib/paths"
import { cn } from "@/lib/utils"
import { useActivityStore } from "@/stores/activity"
import { useOperationStore } from "@/stores/operations"
import { useUIStore } from "@/stores/ui"

const EMPTY: Operation[] = []

/** 结果图标（PRD 6.4）：放行、拦下 */
const DECISION: Record<OperationDecision, { icon: LucideIcon; className: string }> = {
  allowed: { icon: CircleCheckIcon, className: "text-success" },
  denied: { icon: ShieldXIcon, className: "text-destructive" },
}

/** 一条护栏记录：时间、结果图标、命令（等宽、截断，可以展开）、工作目录（只显示文件夹名） */
function OperationLine({ op }: { op: Operation }) {
  const { icon: Icon, className } = DECISION[op.decision]
  const reason = op.reasonId ? copy.guardReason[op.reasonId] : null
  return (
    <TraceCollapsible role="listitem">
      <TraceCollapsibleTrigger aria-label={`${copy.operations.expand}：${op.command}`} className="max-w-full">
        <TraceLine status={op.decision === "denied" ? "error" : undefined} className="max-w-full">
          <TraceIcon>
            <Icon className={className} />
          </TraceIcon>
          <TraceDescription>{formatDateTime(op.at)}</TraceDescription>
          <TraceTitle className="font-mono text-xs text-foreground">{op.command}</TraceTitle>
          <span className="sr-only">{copy.decision[op.decision]}</span>
          <TraceDescription className="font-mono">{folderName(op.cwd)}</TraceDescription>
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent className="flex flex-col gap-1 text-xs">
        <code className="font-mono break-all text-foreground">{op.command}</code>
        <span className={cn(op.decision === "denied" && "text-destructive")}>
          {/* 标准运维资源上解析不了的命令：放行并在记录中标注（F-306 AC3） */}
          {op.decision === "allowed" && op.reasonId === "unparsed" ? copy.unparsedAllowed : reason ? `${copy.decision[op.decision]}：${reason}` : copy.decision[op.decision]}
        </span>
        <span className="font-mono">{op.cwd}</span>
        <span>
          {copy.env.long(op.envId)} · {copy.operations.session(op.sessionId)}
        </span>
      </TraceCollapsibleContent>
    </TraceCollapsible>
  )
}

/** 操作记录（F-307）：最近 50 条护栏记录；完整列表在设置的「活动」里按资源筛选 */
export function OperationsSection({ assetId }: { assetId: string }) {
  const list = useOperationStore((s) => s.recentByAsset[assetId] ?? EMPTY)
  // 切换视图可能被「未保存的修改」拦下（确认后才继续）；真的离开了再定位和筛选
  const viewAll = () =>
    useUIStore.getState().setView("settings", {
      then: () => {
        useUIStore.getState().setSettingsSection("activity")
        void useActivityStore.getState().load({ assetId, kinds: ["agent-op"] })
      },
    })

  return (
    <div className="flex flex-col gap-3">
      {list.length === 0 ? (
        <p className="text-xs text-muted-foreground">{copy.operations.empty}</p>
      ) : (
        <Trace role="list" aria-label={copy.operations.listLabel}>
          {list.map((op) => (
            <OperationLine key={op.id} op={op} />
          ))}
        </Trace>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>{copy.operations.onlyGuarded}</span>
        <Button variant="link" size="xs" className="ml-auto h-auto p-0" onClick={viewAll}>
          {copy.operations.viewAll}
        </Button>
      </div>
    </div>
  )
}
