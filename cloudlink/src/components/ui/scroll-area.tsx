import { ScrollArea as ScrollAreaPrimitive } from "@base-ui/react/scroll-area"
import { cn } from "cn"

function ScrollArea({
  className,
  contentClassName,
  layout = "block",
  children,
  ...props
}: ScrollAreaPrimitive.Root.Props & {
  /** 内容容器的类名。默认是普通块级盒子，子元素的布局和直接放在视口里一样 */
  contentClassName?: string
  /** max-height 弹窗中的 flex 子项：让视口跟随分配的高度，不能让 100% 退回内容高度。 */
  layout?: "block" | "flex"
}) {
  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      className={cn("relative", layout === "flex" && "flex min-h-0 flex-col", className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        data-slot="scroll-area-viewport"
        className={cn("size-full rounded-[inherit] transition-[color,box-shadow] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1", layout === "flex" && "min-h-0 flex-1")}
      >
        {/*
          Base UI 的 Content 监听内容高度：内容异步加载或展开后重新计算是否可滚动，滚动条和视口的 Tab 停靠点才跟得上
          （只靠视口自身尺寸变化时，加载完才变长的内容会一直被当成不可滚动，键盘滚不动）。
          它默认的 minWidth: fit-content 会让单行截断的文字把内容撑宽，这里改回跟随视口宽度
        */}
        <ScrollAreaPrimitive.Content data-slot="scroll-area-content" className={contentClassName} style={{ minWidth: 0 }}>
          {children}
        </ScrollAreaPrimitive.Content>
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  )
}

function ScrollBar({
  className,
  orientation = "vertical",
  ...props
}: ScrollAreaPrimitive.Scrollbar.Props) {
  return (
    <ScrollAreaPrimitive.Scrollbar
      data-slot="scroll-area-scrollbar"
      data-orientation={orientation}
      orientation={orientation}
      className={cn(
        "flex touch-none p-px transition-colors select-none data-horizontal:h-2.5 data-horizontal:flex-col data-horizontal:border-t data-horizontal:border-t-transparent data-vertical:h-full data-vertical:w-2.5 data-vertical:border-l data-vertical:border-l-transparent",
        className
      )}
      {...props}
    >
      <ScrollAreaPrimitive.Thumb
        data-slot="scroll-area-thumb"
        className="relative flex-1 rounded-full bg-border"
      />
    </ScrollAreaPrimitive.Scrollbar>
  )
}

export { ScrollArea, ScrollBar }
