// 状态点（DESIGN.md The Dot Not Stripe Rule）：实心带 3px 同色 soft 光晕，未验证或停用是空心圈。
// 状态不只靠颜色：调用方总在旁边写出状态词，或传 label 给读屏器
import { cn } from "@/lib/utils"

export type DotTone = "ok" | "warn" | "err" | "off"

const DOT: Record<DotTone, string> = {
  ok: "bg-success shadow-[0_0_0_3px_var(--color-success-soft)]",
  warn: "bg-warning shadow-[0_0_0_3px_var(--color-warning-soft)]",
  err: "bg-destructive shadow-[0_0_0_3px_var(--color-destructive-soft)]",
  off: "border-[1.5px] border-faint bg-transparent",
}

export function StatusDot({ tone, label, className }: { tone: DotTone; label?: string; className?: string }) {
  return (
    <span className={cn("inline-flex size-3.5 shrink-0 items-center justify-center", className)}>
      <span aria-hidden className={cn("size-1.75 rounded-full", DOT[tone])} />
      {label && <span className="sr-only">{label}</span>}
    </span>
  )
}

/** 品牌方块（DESIGN.md Brand Tile）：资源行、Agent 行共用 */
export function BrandTile({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span aria-hidden className={cn("flex size-8 shrink-0 items-center justify-center rounded-tile border border-line bg-card text-fg-2", className)}>
      {children}
    </span>
  )
}
