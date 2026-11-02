import { LockOpenIcon, Trash2Icon, WrenchIcon } from "lucide-react"
import { useState } from "react"

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
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "@/components/ui/toast"
import { copy } from "@/lib/copy"
import { useAssetStore } from "@/stores/assets"
import { useUIStore } from "@/stores/ui"
import { serverActions, toastError, usePendingAction } from "./actions"

/** 删除服务器（F-101 AC2）：managed 同时删除托管 ssh 配置的条目和凭据库中的密码；CloudLink 生成的密钥单独勾选 */
function DeleteBody({ assetId, close }: { assetId: string; close: () => void }) {
  const asset = useAssetStore((s) => s.byId[assetId])
  const [removeKey, setRemoveKey] = useState(true)
  const [busy, setBusy] = useState(false)
  if (!asset) return null
  const alias = asset.connection.sshAlias
  const generated = asset.connection.auth?.generatedByCloudLink
  const keyPaths = Object.values(asset.connection.auth?.identityFile ?? {}).join("、")

  const confirm = async () => {
    setBusy(true)
    try {
      await useAssetStore.getState().remove(asset.id, !!generated && removeKey)
      if (useUIStore.getState().selectedAssetId === asset.id) useUIStore.getState().selectAsset(null, { force: true })
      toast.add({ title: copy.deleteDialog.deleted(alias) })
      close()
    } catch (e) {
      toastError(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <AlertDialogHeader>
        <AlertDialogMedia>
          <Trash2Icon className="text-destructive" />
        </AlertDialogMedia>
        <AlertDialogTitle>{copy.deleteDialog.title(alias)}</AlertDialogTitle>
        <AlertDialogDescription>
          {copy.deleteDialog.description}
          {asset.connection.source === "managed" ? copy.deleteDialog.managed : copy.deleteDialog.imported}
        </AlertDialogDescription>
      </AlertDialogHeader>
      {generated && (
        <Field orientation="horizontal">
          <Checkbox id="delete-remove-key" checked={removeKey} onCheckedChange={(v) => setRemoveKey(v === true)} />
          <div className="flex min-w-0 flex-col gap-0.5">
            <FieldLabel htmlFor="delete-remove-key" className="font-normal">
              {copy.deleteDialog.removeKey}
            </FieldLabel>
            <FieldDescription className="font-mono text-xs break-all">{copy.deleteDialog.removeKeyHint(keyPaths)}</FieldDescription>
          </div>
        </Field>
      )}
      <AlertDialogFooter>
        <AlertDialogCancel disabled={busy}>{copy.common.cancel}</AlertDialogCancel>
        <AlertDialogAction variant="destructive" disabled={busy} onClick={() => void confirm()}>
          {busy && <Spinner data-icon="inline-start" aria-hidden />}
          {copy.deleteDialog.submit}
        </AlertDialogAction>
      </AlertDialogFooter>
    </>
  )
}

/** 需要确认的服务器操作（F-202 AC2、F-306 AC2、F-101 AC2）。在 App 上挂一份，右键菜单、命令面板、详情共用 */
export function ServerActionDialogs() {
  const pending = usePendingAction((s) => s.pending)
  const asset = useAssetStore((s) => (pending ? s.byId[pending.assetId] : undefined))
  // 关闭后保留最后一次的内容，退场动画期间文字不消失
  const [last, setLast] = useState(pending)
  if (pending && pending !== last) setLast(pending)
  const shown = pending ?? last
  const close = () => usePendingAction.getState().set(null)
  const alias = asset?.connection.sshAlias ?? ""

  return (
    <AlertDialog open={!!pending && !!asset} onOpenChange={(open) => !open && close()}>
      <AlertDialogContent>
        {shown?.kind === "delete" ? (
          <DeleteBody assetId={shown.assetId} close={close} />
        ) : (
          <>
            <AlertDialogHeader>
              <AlertDialogMedia>{shown?.kind === "mode" ? <WrenchIcon /> : <LockOpenIcon />}</AlertDialogMedia>
              <AlertDialogTitle>{shown?.kind === "mode" ? copy.modeConfirm.title(alias) : copy.unlockConfirm.title(alias)}</AlertDialogTitle>
              <AlertDialogDescription>
                {shown?.kind === "mode" ? copy.modeConfirm.description : copy.unlockConfirm.description}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{copy.common.cancel}</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  close()
                  if (!asset) return
                  if (shown?.kind === "mode") void serverActions.setMode(asset, "standard")
                  else void serverActions.unlock(asset)
                }}
              >
                {shown?.kind === "mode" ? copy.modeConfirm.confirm : copy.unlockConfirm.confirm}
              </AlertDialogAction>
            </AlertDialogFooter>
          </>
        )}
      </AlertDialogContent>
    </AlertDialog>
  )
}
