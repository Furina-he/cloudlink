import { CircleXIcon } from "lucide-react"
import { useShallow } from "zustand/react/shallow"
import { useWatch, type Control } from "react-hook-form"

import type { ServerAsset, IpcError } from "@/bindings"
import { PreviewSheet } from "@/components/app/PreviewSheet"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { copy, ipcErrorText } from "@/lib/copy"
import { detailFileOf } from "@/lib/paths"
import type { ServerFormValues } from "@/lib/schemas"
import { selectInclusionsByAsset, useDeliveryStore } from "@/stores/deliveries"
import { serverActions } from "./actions"
import { toAssetInput } from "./serverForm"

/**
 * 这台服务器的预览（F-204）：展示整份总 Skill 目录树，默认高亮并定位到当前服务器的详情文件。
 * 未列入所选的那一份（运行环境 × Agent）时按「已列入」计算，顶部注明原因（2026-10-31 用户确认）
 */
export function DraftPreview({ control, asset, dirty }: { control: Control<ServerFormValues>; asset: ServerAsset | undefined; dirty: boolean }) {
  const values = useWatch({ control }) as ServerFormValues
  const inclusions = useDeliveryStore(useShallow((s) => (asset ? selectInclusionsByAsset(s.inclusions, asset.id) : [])))
  const alias = (values.alias ?? "").trim()
  const displayName = (values.name ?? "").trim() || asset?.name || alias || copy.create.titleSsh

  return (
    <PreviewSheet
      scope={asset?.id ?? "new"}
      draft={{ asset: toAssetInput(values, asset) }}
      dirty={dirty}
      defaultFile={detailFileOf(alias)}
      note={(target) => {
        const inc = inclusions.find((i) => i.envId === target.envId && i.agentKey === target.agentKey)
        if (inc?.included) return null
        const reason = inc?.reason ? copy.inclusionReason[inc.reason.id](inc.reason.params) : copy.inclusionReason["agent-off"](undefined)
        return copy.preview.notIncluded(displayName, target.label, reason)
      }}
    />
  )
}

/** 保存失败（PRD 6.10）：说明原因，附「重试」；内部错误追加「打开日志目录」 */
export function SaveErrorAlert({ error, onRetry }: { error: IpcError; onRetry: () => void }) {
  return (
    <Alert variant="destructive">
      <CircleXIcon />
      <AlertTitle>{copy.detail.saveFailed}</AlertTitle>
      <AlertDescription className="flex flex-col gap-2">
        <span>{ipcErrorText(error.id, error.params)}</span>
        <span className="flex gap-1.5">
          <Button size="xs" variant="outline" onClick={onRetry}>
            {copy.common.retry}
          </Button>
          {error.id === "internal" && (
            <Button size="xs" variant="outline" onClick={serverActions.openLogs}>
              {copy.common.openLogs}
            </Button>
          )}
        </span>
      </AlertDescription>
    </Alert>
  )
}
