import { CircleIcon } from "lucide-react"

import type { EnvTag } from "@/bindings"
import { Badge } from "@/components/ui/badge"
import { copy } from "@/lib/copy"
import { cn } from "@/lib/utils"

/** 环境色点：生产红、预发琥珀、开发注记灰（DESIGN.md Env Badge） */
export const ENV_DOT: Record<EnvTag, string> = {
  prod: "text-destructive",
  staging: "text-warning",
  dev: "text-muted-foreground",
}

/** 环境徽章：描边加色点，与状态徽章的淡色实底在外形上区分 */
export function EnvBadge({ env, className }: { env: EnvTag; className?: string }) {
  return (
    <Badge variant="outline" className={cn("[&>svg]:size-2!", className)}>
      <CircleIcon data-icon="inline-start" className={cn("fill-current", ENV_DOT[env])} />
      {copy.env.tag[env]}
    </Badge>
  )
}
