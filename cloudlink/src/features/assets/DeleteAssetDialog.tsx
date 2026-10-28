import { BotIcon, FolderGit2Icon, Trash2Icon } from "lucide-react"
import { useState } from "react"

import type { Asset, IpcError, Mount } from "@/bindings"
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
import { Item, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "@/components/ui/toast"
import { copy, ipcErrorText } from "@/lib/copy"
import { useAssetStore } from "@/stores/assets"
import { useSkillStore } from "@/stores/skills"
import { useTargetStore } from "@/stores/targets"
import { useUIStore } from "@/stores/ui"

/** 删除资产（F-101 AC3）：确认框列出会被级联卸载的挂载 */
export function DeleteAssetDialog({
  open,
  onOpenChange,
  asset,
  mounts,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  asset: Asset
  mounts: Mount[]
}) {
  const targets = useTargetStore((s) => s.targets)
  const [busy, setBusy] = useState(false)

  const confirm = async () => {
    setBusy(true)
    try {
      const result = await useAssetStore.getState().remove(asset.id)
      useUIStore.getState().selectAsset(null, { force: true })
      void useSkillStore.getState().refresh()
      toast.add({ title: copy.editor.deleted(asset.name, result.unmounted.length) })
      onOpenChange(false)
    } catch (e) {
      const err = e as IpcError
      toast.add({ title: ipcErrorText(err.id, err.params), type: "error" })
    } finally {
      setBusy(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia>
            <Trash2Icon className="text-destructive" />
          </AlertDialogMedia>
          <AlertDialogTitle>{copy.deleteDialog.title(asset.name)}</AlertDialogTitle>
          <AlertDialogDescription>{copy.deleteDialog.description}</AlertDialogDescription>
        </AlertDialogHeader>
        {mounts.length > 0 ? (
          <section aria-labelledby="delete-cascade" className="flex flex-col gap-1.5">
            <h3 id="delete-cascade" className="text-sm">
              {copy.deleteDialog.cascade(mounts.length)}
            </h3>
            <ItemGroup className="gap-1">
              {mounts.map((m) => {
                const t = targets.find((x) => x.id === m.targetId)
                return (
                  <Item key={m.id} size="xs" variant="muted">
                    <ItemMedia>
                      {t?.kind === "agent-global" ? <BotIcon className="size-4" /> : <FolderGit2Icon className="size-4" />}
                    </ItemMedia>
                    <ItemContent className="min-w-0">
                      <ItemTitle>{t?.label ?? m.targetId}</ItemTitle>
                      <ItemDescription>
                        {t ? `${copy.env.long(t.envId)} · ` : ""}
                        {copy.mode[m.mode]}
                      </ItemDescription>
                    </ItemContent>
                  </Item>
                )
              })}
            </ItemGroup>
          </section>
        ) : (
          <p className="text-sm text-muted-foreground">{copy.deleteDialog.noMounts}</p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{copy.common.cancel}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" disabled={busy} onClick={() => void confirm()}>
            {busy && <Spinner data-icon="inline-start" aria-hidden />}
            {copy.deleteDialog.submit}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
