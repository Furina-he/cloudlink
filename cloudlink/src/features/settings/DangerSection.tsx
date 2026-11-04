import { FolderMinusIcon, Trash2Icon, type LucideIcon } from "lucide-react"
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
import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item"
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
import { Section } from "./Section"

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
function TypedConfirm({
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

/** 危险操作（PRD 6.7）：移除全部分发；清空数据。CloudLink 只删除自己创建的副本、配置和数据 */
export function DangerSection() {
  const { setTheme } = useTheme()
  const hasDeliveries = useDeliveryStore((s) => Object.keys(s.byId).length > 0)
  const hasEnabled = useTargetStore((s) => s.targets.some((t) => t.enabled))
  const [dialog, setDialog] = useState<"remove" | "reset" | null>(null)

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

  const rows = [
    { id: "remove" as const, icon: FolderMinusIcon, title: copy.settings.removeAll, hint: copy.settings.removeAllHint, disabled: !hasDeliveries && !hasEnabled },
    { id: "reset" as const, icon: Trash2Icon, title: copy.settings.resetData, hint: copy.settings.resetDataHint, disabled: false },
  ]

  return (
    <Section id="danger" title={copy.settings.section.danger} hint={copy.settings.dangerHint}>
      <ItemGroup className="gap-2">
        {rows.map(({ id, icon: Icon, title, hint, disabled }) => (
          <Item key={id} variant="outline">
            <ItemMedia>
              <Icon className="size-4" aria-hidden />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>{title}</ItemTitle>
              <ItemDescription>{hint}</ItemDescription>
            </ItemContent>
            <ItemActions>
              <Button variant="destructive" size="sm" disabled={disabled} onClick={() => setDialog(id)}>
                {title}
              </Button>
            </ItemActions>
          </Item>
        ))}
      </ItemGroup>
      <TypedConfirm
        open={dialog === "remove"}
        onOpenChange={(o) => !o && setDialog(null)}
        icon={FolderMinusIcon}
        title={copy.settings.removeAll}
        description={copy.settings.removeAllHint}
        phrase={copy.settings.removeAllConfirm}
        onConfirm={removeAll}
      />
      <TypedConfirm
        open={dialog === "reset"}
        onOpenChange={(o) => !o && setDialog(null)}
        icon={Trash2Icon}
        title={copy.settings.resetData}
        description={copy.settings.resetDataHint}
        phrase={copy.settings.resetDataConfirm}
        onConfirm={resetData}
      />
    </Section>
  )
}
