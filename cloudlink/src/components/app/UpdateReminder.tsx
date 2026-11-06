import { CircleArrowUpIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useMediaQuery } from "@/hooks/use-media-query"
import { copy } from "@/lib/copy"
import { downloadPercent, hasUpdate, useUpdateStore } from "@/stores/update"

/** 顶栏放得下文字的窗口宽度；更窄时只留图标，文字放进 Tooltip，保证顶栏不换行（PRD 6.13） */
const LABEL_QUERY = "(min-width: 880px)"

/**
 * 顶栏最右侧的更新提醒（F-406 AC1，PRD 6.13）：只在有新版本时出现，用中性色。
 * 出现时不抢焦点、不弹 Toast，只经 sr-only 的 aria-live 区域播报一次
 */
export function UpdateReminder() {
  const status = useUpdateStore((s) => s.status)
  const wide = useMediaQuery(LABEL_QUERY)
  const visible = hasUpdate(status)

  let button = null
  if (visible) {
    const label =
      status.state === "downloading"
        ? copy.update.downloading(downloadPercent(status))
        : status.state === "installing"
          ? copy.update.installing
          : copy.update.reminder(status.version)
    const name = status.state === "available" ? copy.update.reminderLabel(status.version) : copy.update.progressLabel(label)
    button = (
      <Tooltip disabled={wide}>
        <TooltipTrigger
          render={
            <Button
              variant="outline"
              size={wide ? "sm" : "icon-sm"}
              className="shrink-0 tabular-nums"
              aria-label={name}
              onClick={() => useUpdateStore.getState().setDialogOpen(true)}
            />
          }
        >
          <CircleArrowUpIcon data-icon={wide ? "inline-start" : undefined} />
          {wide && label}
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    )
  }

  return (
    <>
      {/* 版本号不变时内容不变，下载、取消都不会重复播报 */}
      <span className="sr-only" aria-live="polite">
        {visible ? copy.update.announce(status.version) : ""}
      </span>
      {button}
    </>
  )
}
