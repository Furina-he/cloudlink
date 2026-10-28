import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react"

import { ScrollArea } from "@/components/ui/scroll-area"
import type { ViewId } from "@/lib/copy"
import { useUIStore } from "@/stores/ui"

/**
 * 一级视图的外框：h1 标题（tabIndex=-1，切换视图后接收焦点，PRD 6.14），
 * 主滚动区的位置记在 useUIStore，切回来时恢复（PRD 6.3）
 */
export function ViewShell({
  view,
  title,
  focusTitle,
  children,
}: {
  view: ViewId
  title: string
  /** 由视图切换触发的挂载才移动焦点，首次启动不抢焦点 */
  focusTitle: boolean
  children: ReactNode
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)

  useLayoutEffect(() => {
    const viewport = rootRef.current?.querySelector<HTMLElement>(
      "[data-slot=scroll-area-viewport]"
    )
    if (!viewport) return
    viewport.scrollTop = useUIStore.getState().scrollByView[view] ?? 0
    return () => useUIStore.getState().saveScroll(view, viewport.scrollTop)
  }, [view])

  useEffect(() => {
    if (focusTitle) titleRef.current?.focus()
  }, [focusTitle])

  return (
    <ScrollArea ref={rootRef} className="min-h-0 flex-1">
      <div className="flex min-h-full flex-col gap-4 p-3">
        <h1
          id="view-title"
          ref={titleRef}
          tabIndex={-1}
          className="text-base font-semibold outline-none"
        >
          {title}
        </h1>
        {children}
      </div>
    </ScrollArea>
  )
}
