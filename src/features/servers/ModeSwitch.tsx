import { EyeIcon, WrenchIcon } from "lucide-react"

import type { Asset, Mode } from "@/bindings"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { copy } from "@/lib/copy"
import { serverActions } from "./actions"

export const MODE_ICON: Record<Mode, typeof EyeIcon> = { "confirm-changes": EyeIcon, "auto-ops": WrenchIcon }

/** 详情控制头的执行模式切换器：两个选项并排，当前模式按下，保持中性样式 */
export function ModeToggle({ asset, labelledBy }: { asset: Asset; labelledBy: string }) {
  return (
    <ToggleGroup
      aria-labelledby={labelledBy}
      variant="outline"
      size="sm"
      spacing={0}
      value={[asset.agent.mode]}
      onValueChange={(next) => next[0] && serverActions.requestMode(asset, next[0] as Mode)}
    >
      {(["confirm-changes", "auto-ops"] as const).map((mode) => {
        const Icon = MODE_ICON[mode]
        return (
          <ToggleGroupItem key={mode} value={mode} className="px-3">
            <Icon />
            {copy.mode[mode]}
          </ToggleGroupItem>
        )
      })}
    </ToggleGroup>
  )
}
