import { CircleXIcon } from "lucide-react"
import { useRef, type ReactNode } from "react"

import type { IpcError } from "@/bindings"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Spinner } from "@/components/ui/spinner"
import { copy, ipcErrorText, updateWaitText } from "@/lib/copy"
import { formatBytes, formatDate } from "@/lib/format"
import { downloadPercent, hasUpdate, useUpdateBlocker, useUpdateStore, type UpdateTask } from "@/stores/update"

/** update-busy 的参数换成和界面判断同一句的等待说明 */
function busyText(error: IpcError) {
  const name = error.params?.name
  return updateWaitText(String(error.params?.task ?? "publish") as UpdateTask, name === undefined ? undefined : String(name))
}

/**
 * 更新对话框（F-406 AC2–AC4，PRD 6.13）：版本号、发布日期和纯文本的更新说明。
 * 下载中显示进度、可以取消；失败时写清原因并改为「重试」；有进行中的任务时说明在等什么。
 * 打开后焦点落在「下载并安装」上，按钮不可用时落在「稍后」上
 */
export function UpdateDialog() {
  const status = useUpdateStore((s) => s.status)
  const open = useUpdateStore((s) => s.dialogOpen)
  const rejected = useUpdateStore((s) => s.rejected)
  const blocker = useUpdateBlocker()
  const installRef = useRef<HTMLButtonElement>(null)
  const laterRef = useRef<HTMLButtonElement>(null)
  if (!hasUpdate(status)) return null

  const { state } = status
  const store = useUpdateStore.getState()
  const error = state === "available" ? (rejected ?? status.error ?? null) : null
  const waiting = state === "available" && blocker !== null
  const date = status.date ? formatDate(status.date) : null

  // 可见的提示不放进 aria-live（它在网格里会占一行间距），读屏另用 sr-only 区域播报同一句
  let notice = ""
  let message: ReactNode = null
  if (state === "installing") {
    notice = copy.update.installingHint
  } else if (waiting) {
    notice = updateWaitText(blocker.task, blocker.name)
  } else if (error?.id === "update-busy") {
    notice = busyText(error)
  } else if (error) {
    notice = ipcErrorText(error.id, error.params)
    message = (
      <Alert variant="destructive">
        <CircleXIcon />
        <AlertTitle>{copy.update.failed}</AlertTitle>
        <AlertDescription>{notice}</AlertDescription>
      </Alert>
    )
  }
  if (notice && !message) message = <p className="text-muted-foreground">{notice}</p>

  return (
    <Dialog open={open} onOpenChange={store.setDialogOpen}>
      <DialogContent
        className="grid-cols-[minmax(0,1fr)] sm:max-w-md"
        closeLabel={copy.common.close}
        initialFocus={() => (installRef.current && !installRef.current.disabled ? installRef.current : laterRef.current)}
      >
        <DialogHeader>
          <DialogTitle>{copy.update.title(status.version)}</DialogTitle>
          <DialogDescription>{copy.update.description(status.currentVersion, date)}</DialogDescription>
        </DialogHeader>
        {/* 更新说明来自不在签名范围内的 latest.json：只按纯文本展示，不渲染 Markdown，也不生成链接。
            再长的一行也只能在这里折行，不能撑开对话框把按钮挤出窗口；最矮的窗口里连同失败提示也要放得下 */}
        <ScrollArea className="max-h-[min(15rem,calc(100svh-20rem))] rounded-lg border">
          <p className="px-3 py-2 wrap-anywhere whitespace-pre-wrap">{status.notes ?? copy.update.noNotes}</p>
        </ScrollArea>
        <p className="text-xs text-muted-foreground">{copy.update.restartHint}</p>
        {state === "downloading" && (
          <Progress value={downloadPercent(status)} className="gap-2">
            <ProgressLabel className="text-xs font-normal text-muted-foreground tabular-nums">
              {copy.update.progress(formatBytes(status.downloaded ?? 0), status.total ? formatBytes(status.total) : null)}
            </ProgressLabel>
            <ProgressValue className="text-xs" />
          </Progress>
        )}
        {message}
        {/* 下载完成、失败和等待任务的提示（PRD 6.13 无障碍） */}
        <span className="sr-only" aria-live="polite">
          {error && error.id !== "update-busy" ? `${copy.update.failed}：${notice}` : notice}
        </span>
        <DialogFooter>
          <Button ref={laterRef} variant="outline" onClick={() => store.setDialogOpen(false)}>
            {copy.update.later}
          </Button>
          {state === "downloading" ? (
            <Button variant="outline" onClick={() => void store.cancel()}>
              {copy.update.cancel}
            </Button>
          ) : (
            <Button ref={installRef} disabled={waiting || state === "installing"} onClick={() => void store.install()}>
              {state === "installing" && <Spinner data-icon="inline-start" aria-hidden />}
              {state === "installing" ? copy.update.installing : error ? copy.update.retry : copy.update.install}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
