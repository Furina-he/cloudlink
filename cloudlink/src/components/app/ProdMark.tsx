import { copy } from "@/lib/copy"
import { cn } from "@/lib/utils"

/** 「生产」标记（F-109 AC2）：只给生产资源，红色文字不加底色；非生产不显示任何环境标记 */
export function ProdMark({ production, className }: { production: boolean; className?: string }) {
  if (!production) return null
  return <span className={cn("text-xs font-medium text-destructive", className)}>{copy.row.prod}</span>
}
