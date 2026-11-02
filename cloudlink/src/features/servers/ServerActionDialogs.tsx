import { Trash2Icon, WrenchIcon } from "lucide-react"
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
import { handleOf, useAssetStore } from "@/stores/assets"
import { useUIStore } from "@/stores/ui"
import { serverActions, toastError, usePendingAction } from "./actions"

/**
 * 删除资源（F-101 AC2）。服务器：managed 同时删除托管 ssh 配置的条目和凭据库中的密码，CloudLink 生成的密钥单独勾选；
 * 云平台：不卸载本机 CLI，也不退出 CLI 的登录
 */
function DeleteBody({ assetId, close }: { assetId: string; close: () => void }) {
  const asset = useAssetStore((s) => s.byId[assetId])
  const [removeKey, setRemoveKey] = useState(true)
  const [busy, setBusy] = useState(false)
  if (!asset) return null
  const alias = handleOf(asset)
  const server = asset.type === "vps" ? asset : undefined
  const generated = server?.connection.auth?.generatedByCloudLink
  const keyPaths = Object.values(server?.connection.auth?.identityFile ?? {}).join("、")

  const confirm = async () => {
    setBusy(true)
    try {
      await useAssetStore.getState().remove(asset.id, !!generated && removeKey)
      if (useUIStore.getState().selectedAssetId === asset.id) useUIStore.getState().selectAsset(null, { force: true })
      toast.add({ title: server ? copy.deleteDialog.deleted(alias) : copy.cli.removed(asset.name) })
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
        <AlertDialogTitle>{server ? copy.deleteDialog.title(alias) : copy.cli.deleteTitle(asset.name)}</AlertDialogTitle>
        <AlertDialogDescription>
          {server ? copy.deleteDialog.description : copy.cli.deleteDescription}
          {server && (server.connection.source === "managed" ? copy.deleteDialog.managed : copy.deleteDialog.imported)}
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
          {server ? copy.deleteDialog.submit : copy.cli.delete}
        </AlertDialogAction>
      </AlertDialogFooter>
    </>
  )
}

/** 需要确认的资源操作（F-202 AC2、F-101 AC2）。在 App 上挂一份，回路行、右键菜单、命令面板、检视面板共用 */
export function ServerActionDialogs() {
  const pending = usePendingAction((s) => s.pending)
  const asset = useAssetStore((s) => (pending ? s.byId[pending.assetId] : undefined))
  // 关闭后保留最后一次的内容，退场动画期间文字不消失
  const [last, setLast] = useState(pending)
  if (pending && pending !== last) setLast(pending)
  const shown = pending ?? last
  const close = () => usePendingAction.getState().set(null)
  const alias = asset ? handleOf(asset) : ""

  return (
    <AlertDialog open={!!pending && !!asset} onOpenChange={(open) => !open && close()}>
      <AlertDialogContent>
        {shown?.kind === "delete" ? (
          <DeleteBody assetId={shown.assetId} close={close} />
        ) : (
          <>
            <AlertDialogHeader>
              <AlertDialogMedia>
                <WrenchIcon className="text-warning" />
              </AlertDialogMedia>
              <AlertDialogTitle>{copy.modeConfirm.title(alias)}</AlertDialogTitle>
              <AlertDialogDescription>{copy.modeConfirm.description}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{copy.common.cancel}</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  close()
                  if (asset) void serverActions.setMode(asset, "standard")
                }}
              >
                {copy.modeConfirm.confirm}
              </AlertDialogAction>
            </AlertDialogFooter>
          </>
        )}
      </AlertDialogContent>
    </AlertDialog>
  )
}
