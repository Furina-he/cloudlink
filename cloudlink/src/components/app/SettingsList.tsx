// 设置式列表（DESIGN.md「Settings-style List」）：详情页、Agent 页、设置页共用。
// 一张列表卡一行一个设置：左边名称 + 可选说明，右边控件或值；问题行用琥珀浅底
import { CopyIcon } from "lucide-react"
import type { ReactNode } from "react"

import { Button } from "@/components/ui/button"
import { toast } from "@/components/ui/toast"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { copy } from "@/lib/copy"
import { cn } from "@/lib/utils"

/** 一组：组标题（h3，可带计数和右侧操作）+ 列表卡 */
export function ListGroup({
  id,
  title,
  count,
  action,
  children,
  className,
}: {
  id: string
  title: string
  count?: number
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <div className="flex min-h-7 items-center gap-2 px-1">
        <h3 id={id} className="flex items-baseline gap-1.5 text-[13px] font-semibold">
          {title}
          {count !== undefined && <span className="text-xs font-normal text-muted-foreground tabular-nums">{count}</span>}
        </h3>
        {action && <span className="ml-auto flex items-center gap-1.5">{action}</span>}
      </div>
      <div className={cn("divide-y divide-line-2 overflow-hidden rounded-list border border-line bg-card", className)}>{children}</div>
    </section>
  )
}

/** 一行设置。block：控件换到说明下面占满整行（多行文本、列表）；warn：需要处理的问题行 */
export function PrefRow({
  label,
  labelFor,
  labelId,
  hint,
  children,
  block,
  warn,
  className,
}: {
  label: ReactNode
  labelFor?: string
  labelId?: string
  hint?: ReactNode
  children?: ReactNode
  block?: boolean
  warn?: boolean
  className?: string
}) {
  const Label = labelFor ? "label" : "span"
  return (
    <div
      className={cn(
        "flex min-h-[50px] gap-4 px-3.5 py-2.5",
        block ? "flex-col gap-2" : "items-center",
        warn && "bg-warning/10",
        className
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <Label htmlFor={labelFor} id={labelId} className={cn("text-[13px] font-medium", warn && "text-warning")}>
          {label}
        </Label>
        {hint && <span className="text-xs leading-normal text-muted-foreground">{hint}</span>}
      </div>
      {children !== undefined && <div className={cn("min-w-0", block ? "w-full" : "flex shrink-0 items-center gap-2")}>{children}</div>}
    </div>
  )
}

/** 卡片底部的一条说明（灰底），例如红线的诚实说明 */
export function ListNote({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return (
    <p className="flex items-start gap-2 bg-card-2 px-3.5 py-2.5 text-xs text-muted-foreground [&_svg]:mt-0.5 [&_svg]:size-3.5 [&_svg]:shrink-0">
      {icon}
      <span>{children}</span>
    </p>
  )
}

/** 等宽的值，悬停出现复制按钮（The Copyable Text Rule） */
export function CopyValue({ value, label }: { value: string; label?: string }) {
  const doCopy = () =>
    void navigator.clipboard
      .writeText(value)
      .then(() => toast.add({ title: copy.common.copiedValue(value) }))
      .catch(() => undefined)
  return (
    <span className="group/copy inline-flex min-w-0 items-center gap-1 font-mono text-xs select-text">
      <span className="min-w-0 truncate">{value}</span>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              className="opacity-0 group-hover/copy:opacity-100 focus-visible:opacity-100"
              aria-label={`${copy.common.copy} ${label ?? value}`}
              onClick={doCopy}
            />
          }
        >
          <CopyIcon />
        </TooltipTrigger>
        <TooltipContent>{copy.common.copy}</TooltipContent>
      </Tooltip>
    </span>
  )
}
