import type { LucideIcon } from "lucide-react"
import { useState } from "react"

import { useTheme } from "@/components/theme-provider"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "@/components/ui/toast"
import { copy, ipcErrorText } from "@/lib/copy"
import { ipc, toIpcError } from "@/lib/ipc"
import { useActivityStore } from "@/stores/activity"
import { useDeliveryStore } from "@/stores/deliveries"
import { loadAll } from "@/stores/load"
import { useOperationStore } from "@/stores/operations"
import { useTargetStore } from "@/stores/targets"
import { useUIStore } from "@/stores/ui"

/** 失败时播报原因，并让确认对话框留在原处 */
async function attempt(action: () => Promise<unknown>) {
  try {
    await action()
  } catch (e) {
    const err = toIpcError(e)
    toast.add({ title: ipcErrorText(err.id, err.params), type: "error" })
    throw err
  }
}

/** 危险操作的确认：AlertDialog，并要求输入确认文字（PRD 6.7） */
export function TypedConfirm({
  open,
  onOpenChange,
  icon: Icon,
  title,
  description,
  phrase,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  icon: LucideIcon
  title: string
  description: string
  phrase: string
  onConfirm: () => Promise<void>
}) {
  const [text, setText] = useState("")
  const [busy, setBusy] = useState(false)
  const close = () => {
    onOpenChange(false)
    setText("")
  }
  return (
    <AlertDialog open={open} onOpenChange={(next) => !next && !busy && close()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia>
            <Icon className="text-destructive" />
          </AlertDialogMedia>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <Field>
          <FieldLabel htmlFor="danger-confirm">{copy.settings.typeToConfirm(phrase)}</FieldLabel>
          <Input id="danger-confirm" value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" />
        </Field>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{copy.common.cancel}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={busy || text.trim() !== phrase}
            onClick={() => {
              setBusy(true)
              void onConfirm()
                .then(close)
                .catch(() => {})
                .finally(() => setBusy(false))
            }}
          >
            {busy && <Spinner data-icon="inline-start" aria-hidden />}
            {title}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** 危险操作（PRD 6.8）：移除全部分发；重置 CloudLink。CloudLink 只删除自己创建的副本、配置和数据 */
export function useDangerActions() {
  const { setTheme } = useTheme()
  const removeAll = () =>
    attempt(async () => {
      await useDeliveryStore.getState().removeAll()
      // 目标全部停用了：重新读取目标列表
      await useTargetStore.getState().detect()
      toast.add({ title: copy.settings.removeAllDone, type: "success" })
    })
  const resetData = () =>
    attempt(async () => {
      await ipc.resetData()
      useUIStore.getState().selectAsset(null, { force: true })
      useOperationStore.setState({ recentByAsset: {} })
      setTheme("system")
      loadAll()
      void useActivityStore.getState().load({})
      toast.add({ title: copy.settings.resetDone })
    })
  return { removeAll, resetData }
}
