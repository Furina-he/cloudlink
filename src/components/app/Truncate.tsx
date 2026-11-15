import { useRef, useState } from "react"

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

/** 名称、路径过长时截断，悬停才用 Tooltip 显示全文（PRD 6.11「长内容」）；没被截断就不弹 */
export function Truncate({ text, className }: { text: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [open, setOpen] = useState(false)
  return (
    <Tooltip
      open={open}
      onOpenChange={(next) => {
        const el = ref.current
        setOpen(next && !!el && el.scrollWidth > el.clientWidth)
      }}
    >
      <TooltipTrigger render={<span ref={ref} className={cn("block min-w-0 truncate", className)} />}>
        {text}
      </TooltipTrigger>
      <TooltipContent className="max-w-sm break-all">{text}</TooltipContent>
    </Tooltip>
  )
}
