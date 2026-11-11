// 设置式列表（DESIGN.md「Settings-style List」）：详情页、Agent 页、设置页共用。
// 一张列表卡一行一个设置：左边名称 + 可选说明，右边控件或值；问题行用琥珀浅底
import { ChevronDownIcon, CopyIcon } from "lucide-react"
import { useRef, type ReactNode } from "react"

import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
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

/**
 * 折叠行（DESIGN.md「折叠行」）：很少用的设置收进一行，左边名称 + 一行摘要，右边 ChevronDown（展开后转 180°）。
 * 展开的内容是同一张卡里接着往下的行；默认收起。展开后把它滚进视野（对话框里内容会被底栏挡住）
 */
export function FoldRow({
  label,
  hint,
  children,
  open,
  defaultOpen,
  onOpenChange,
  plain,
}: {
  label: ReactNode
  hint?: ReactNode
  children: ReactNode
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  /** 内容不是一行行的设置（表单字段、表格）时不加行间发丝线 */
  plain?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  return (
    <Collapsible
      ref={ref}
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={(next) => {
        onOpenChange?.(next)
        // 等展开动画走完再滚，否则高度还没算出来
        if (next) window.setTimeout(() => ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }), 220)
      }}
    >
      <CollapsibleTrigger className="group/fold flex min-h-[50px] w-full items-center gap-4 px-3.5 py-2.5 text-left outline-none hover:bg-card-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset">
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[13px] font-medium">{label}</span>
          {hint && <span className="truncate text-xs leading-normal text-muted-foreground">{hint}</span>}
        </span>
        <ChevronDownIcon aria-hidden className="size-4 shrink-0 text-muted-foreground transition-transform duration-150 group-data-panel-open/fold:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent className="h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-200 data-ending-style:h-0 data-starting-style:h-0">
        <div className={cn("border-t border-line-2", !plain && "divide-y divide-line-2")}>{children}</div>
      </CollapsibleContent>
    </Collapsible>
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
