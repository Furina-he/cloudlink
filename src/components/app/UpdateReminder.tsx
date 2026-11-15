import { CircleArrowUpIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useMediaQuery } from "@/hooks/use-media-query"
import { copy } from "@/lib/copy"
import { showReminder, useUpdateStore } from "@/stores/update"

/** 顶栏放得下文字的窗口宽度；更窄时只留图标，保证顶栏不换行（PRD 6.15） */
const LABEL_QUERY = "(min-width: 880px)"

/**
 * 顶栏最右侧的更新提醒（F-406 AC1，PRD 6.15）：新版本在后台下好才出现，用中性色，按钮上永远只写「更新」，
 * 宽度不随状态变化；版本号和失败原因放在悬停提示里。出现时不抢焦点、不弹 Toast，只经 sr-only 的 aria-live 区域播报一次
 */
export function UpdateReminder() {
  const status = useUpdateStore((s) => s.status)
  const wide = useMediaQuery(LABEL_QUERY)
  const visible = showReminder(status)

  let button = null
  if (visible) {
    const installing = status.state === "installing"
    const failed = status.state === "available"
    const name = installing ? copy.update.installingLabel : failed ? copy.update.failedLabel(status.version) : copy.update.reminderLabel(status.version)
    const tip = installing ? copy.update.installingLabel : failed ? copy.update.failedLabel(status.version) : copy.update.announce(status.version)
    button = (
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="outline"
              size={wide ? "sm" : "icon-sm"}
              className="shrink-0"
              aria-label={name}
              onClick={() => useUpdateStore.getState().setDialogOpen(true)}
            />
          }
        >
          {installing ? <Spinner data-icon={wide ? "inline-start" : undefined} aria-hidden /> : <CircleArrowUpIcon data-icon={wide ? "inline-start" : undefined} />}
          {wide && copy.update.reminder}
        </TooltipTrigger>
        <TooltipContent>{tip}</TooltipContent>
      </Tooltip>
    )
  }

  return (
    <>
      {/* 版本号不变时内容不变，安装、失败都不会重复播报 */}
      <span className="sr-only" aria-live="polite">
        {visible ? copy.update.announce(status.version) : ""}
      </span>
      {button}
    </>
  )
}
