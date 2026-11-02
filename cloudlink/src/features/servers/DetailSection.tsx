import { ChevronRightIcon } from "lucide-react"
import type { ReactNode } from "react"

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { copy } from "@/lib/copy"
import { isSectionOpen, useUIStore, type DetailSection as SectionId } from "@/stores/ui"

/**
 * 详情的一个可折叠分段（PRD 6.4）。折叠状态按分段持久化；折叠时标题行右侧显示一句摘要。
 * 标题是 h3（详情标题是 h2），层级不跳级
 */
export function DetailSection({
  id,
  summary,
  pendingNotes = 0,
  children,
}: {
  id: SectionId
  summary?: ReactNode
  pendingNotes?: number
  children: ReactNode
}) {
  const open = useUIStore((s) => isSectionOpen(s.sectionsOpen, id, pendingNotes))
  const title = copy.detail.sections[id]
  return (
    <Collapsible
      open={open}
      onOpenChange={(next) => useUIStore.getState().toggleSection(id, next)}
      data-section={id}
      className="border-b last:border-b-0"
    >
      <h3 className="flex">
        <CollapsibleTrigger className="group/section flex min-w-0 flex-1 items-center gap-2 px-3 py-2.5 text-left text-sm font-semibold outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset">
          <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-aria-expanded/section:rotate-90" aria-hidden />
          <span className="shrink-0">{title}</span>
          {summary && <span className="ml-auto min-w-0 truncate text-xs font-normal text-muted-foreground">{summary}</span>}
        </CollapsibleTrigger>
      </h3>
      <CollapsibleContent className="h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-200 data-ending-style:h-0 data-starting-style:h-0">
        <div className="px-3 pt-1 pb-4">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  )
}
