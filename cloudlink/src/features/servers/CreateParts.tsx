import { ArrowLeftIcon } from "lucide-react"
import type { ReactNode } from "react"

import { Button } from "@/components/ui/button"
import { DialogTitle } from "@/components/ui/dialog"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { copy } from "@/lib/copy"
import { useUIStore } from "@/stores/ui"
import { ClosePanelButton } from "./InspectorParts"

/** 添加弹窗的标题行：返回选择类型、标题、关闭 */
/** `onBack`：覆盖默认的「返回选择类型」，例如连接过程里返回表单 */
export function CreateHeader({ title, icon, back = true, onBack }: { title: string; icon?: ReactNode; back?: boolean; onBack?: { label: string; run: () => void } }) {
  const backLabel = onBack?.label ?? copy.create.back
  return (
    <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2.5">
      {back && (
        <Tooltip>
          <TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label={backLabel} onClick={() => (onBack ? onBack.run() : useUIStore.getState().startCreate())} />}>
            <ArrowLeftIcon />
          </TooltipTrigger>
          <TooltipContent>{backLabel}</TooltipContent>
        </Tooltip>
      )}
      {icon}
      <DialogTitle id="detail-title" className="min-w-0 truncate text-base font-semibold">
        {title}
      </DialogTitle>
      <span className="ml-auto" />
      <ClosePanelButton />
    </div>
  )
}
