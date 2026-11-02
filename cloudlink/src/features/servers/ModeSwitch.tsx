import { EyeIcon, TriangleAlertIcon, WrenchIcon } from "lucide-react"

import type { Asset, Mode } from "@/bindings"
import { Button } from "@/components/ui/button"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { copy } from "@/lib/copy"
import { cn } from "@/lib/utils"
import { handleOf, isProdWritable } from "@/stores/assets"
import { serverActions } from "./actions"

export const MODE_ICON: Record<Mode, typeof EyeIcon> = { "read-only": EyeIcon, standard: WrenchIcon }
const NEXT: Record<Mode, Mode> = { "read-only": "standard", standard: "read-only" }

/** 生产资源处于标准运维时的琥珀色提醒（DESIGN.md Breaker Row） */
export const PROD_WRITABLE = "border-warning/35 bg-warning/12 text-warning hover:bg-warning/18 hover:text-warning aria-pressed:bg-warning/12"

/**
 * 回路行右侧的档位闸刀（PRD 6.4）：点一下在只读巡检和标准运维之间切换。
 * 生产资源切到标准运维先确认（F-202 AC2），切回只读巡检一键完成。状态同时用图标、文字和颜色表达（6.12）
 */
export function ModeBreaker({ asset }: { asset: Asset }) {
  const mode = asset.agent.mode
  const Icon = MODE_ICON[mode]
  const warn = isProdWritable(asset)
  const label = copy.servers.modeToggle(handleOf(asset), copy.mode[mode], copy.mode[NEXT[mode]])
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            aria-label={warn ? `${label}。${copy.servers.prodWritable}` : label}
            onClick={() => serverActions.requestMode(asset, NEXT[mode])}
            className={cn("w-8 justify-center px-0 @md/rows:w-27 @md/rows:justify-start @md/rows:px-2.5", warn && PROD_WRITABLE)}
          />
        }
      >
        <Icon data-icon="inline-start" />
        <span className="hidden @md/rows:inline">{copy.mode[mode]}</span>
        {warn && <TriangleAlertIcon className="ml-auto hidden @md/rows:block" aria-hidden />}
      </TooltipTrigger>
      <TooltipContent>{warn ? copy.servers.prodWritable : copy.modeHint[mode]}</TooltipContent>
    </Tooltip>
  )
}

/** 检视面板控制头的档位切换器：两个选项并排，当前档位按下 */
export function ModeToggle({ asset, labelledBy }: { asset: Asset; labelledBy: string }) {
  const warn = isProdWritable(asset)
  return (
    <ToggleGroup
      aria-labelledby={labelledBy}
      variant="outline"
      size="sm"
      spacing={0}
      value={[asset.agent.mode]}
      onValueChange={(next) => next[0] && serverActions.requestMode(asset, next[0] as Mode)}
    >
      {(["read-only", "standard"] as const).map((mode) => {
        const Icon = MODE_ICON[mode]
        return (
          <ToggleGroupItem key={mode} value={mode} className={cn("px-3", mode === "standard" && warn && PROD_WRITABLE)}>
            <Icon />
            {copy.mode[mode]}
          </ToggleGroupItem>
        )
      })}
    </ToggleGroup>
  )
}
