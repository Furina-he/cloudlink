// 当前详情上的编辑弹窗：标题/底栏固定，只有正文滚动；草稿防丢在同一底栏完成（P8 D6）。
import { useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { useHotkeys } from "react-hotkeys-hook"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Spinner } from "@/components/ui/spinner"
import { copy } from "@/lib/copy"
import { HOTKEY_OPTIONS, HOTKEYS, isAlertOpen } from "@/lib/hotkeys"

export function DraftDialog({
  title, name, handle, hint, dirty, busy, children, onClose, onSave, saveLabel, actions, saveEnabled = true,
}: {
  title: string
  name: string
  handle: string
  hint: string
  dirty: boolean
  busy: boolean
  children: ReactNode
  onClose: () => void
  onSave: () => void
  saveLabel: string
  actions?: ReactNode
  saveEnabled?: boolean
}) {
  const [confirm, setConfirm] = useState(false)
  const keepRef = useRef<HTMLButtonElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  // 直接从详情分组打开时回到原按钮；菜单项会卸载，沿用更多按钮作为兜底。
  const openerRef = useRef(document.activeElement instanceof HTMLButtonElement ? document.activeElement : null)
  const previousFocus = useRef<HTMLElement | null>(null)
  const requestClose = () => {
    if (busy) return
    if (confirm) return setConfirm(false)
    if (!dirty) return onClose()
    previousFocus.current = document.activeElement as HTMLElement | null
    setConfirm(true)
  }
  useLayoutEffect(() => {
    // inert 已随本次提交解除；在焦点仍留在对话框内时恢复，避免卸载底栏按钮触发原语的下一帧兜底。
    if (confirm) keepRef.current?.focus({ preventScroll: true })
    else previousFocus.current?.focus({ preventScroll: true })
  }, [confirm])
  const keepEditing = () => setConfirm(false)
  const submit = () => { if (!confirm && !busy && dirty && saveEnabled && !isAlertOpen()) onSave() }
  useHotkeys(HOTKEYS.save, submit, HOTKEY_OPTIONS)

  return (
    <Dialog open onOpenChange={(open) => !open && requestClose()}>
      <DialogContent
        variant="editor"
        closeLabel={copy.detail.editor.close}
        aria-describedby="editor-resource"
        ref={contentRef}
        finalFocus={() => openerRef.current?.isConnected ? openerRef.current : document.querySelector<HTMLElement>("[data-detail-more]") ?? false}
        onKeyDownCapture={(e) => {
          if (confirm && e.key === "Escape") {
            e.preventDefault()
            e.stopPropagation()
            keepEditing()
          }
        }}
      >
        <form className="flex min-h-0 flex-1 flex-col" onSubmit={(e) => { e.preventDefault(); submit() }}>
          <DialogHeader className="shrink-0 gap-1 px-4.5 pt-3.5 pr-12 pb-1">
            <DialogTitle variant="editor">{title}</DialogTitle>
            <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground" id="editor-resource">
              <span className="wrap-anywhere">{name}</span>
              <span className="font-mono wrap-anywhere">{handle}</span>
            </p>
          </DialogHeader>
          <ScrollArea layout="flex" className="min-h-0 flex-1" aria-describedby="editor-resource">
            <div className="flex flex-col gap-4 px-4.5 pt-2.5 pb-4.5" inert={confirm || busy}>{children}</div>
          </ScrollArea>
          <Separator />
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 px-4.5 py-3" data-editor-footer>
            {confirm ? (
              <>
                <span className="mr-auto min-w-0 text-xs text-muted-foreground" role="alert">{copy.detail.editor.leave}</span>
                <Button ref={keepRef} type="button" variant="ghost" size="sm" onClick={keepEditing}>{copy.detail.leave.keep}</Button>
                <Button type="button" size="sm" onClick={onClose}>{copy.detail.leave.discard}</Button>
              </>
            ) : (
              <>
                <span className="mr-auto min-w-0 text-xs text-muted-foreground">{hint}</span>
                {actions}
                <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={requestClose}>{copy.common.cancel}</Button>
                <Button type="submit" size="sm" disabled={busy || !dirty || !saveEnabled}>
                  {busy && <Spinner data-icon="inline-start" aria-hidden />}
                  {busy ? copy.detail.editor.saving : saveLabel}
                </Button>
              </>
            )}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
