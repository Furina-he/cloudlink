import { EyeIcon, WrenchIcon } from "lucide-react"

import type { Asset, Mode } from "@/bindings"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { copy } from "@/lib/copy"
import { cn } from "@/lib/utils"
import { isProdWritable } from "@/stores/assets"
import { serverActions } from "./actions"

export const MODE_ICON: Record<Mode, typeof EyeIcon> = { "read-only": EyeIcon, standard: WrenchIcon }

/** 生产资源处于标准运维时的琥珀色提醒（DESIGN.md Breaker Row） */
export const PROD_WRITABLE = "border-warning/35 bg-warning/12 text-warning hover:bg-warning/18 hover:text-warning aria-pressed:bg-warning/12"

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
