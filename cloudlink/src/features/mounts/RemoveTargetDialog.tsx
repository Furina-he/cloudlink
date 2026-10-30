import { Trash2Icon } from "lucide-react"
import { useState } from "react"

import type { IpcError, Mount, Target } from "@/bindings"
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
import { useTargetStore } from "@/stores/targets"
import { useUIStore } from "@/stores/ui"
import { ModeIcon } from "./MountChip"
import type { SkillEntry } from "./useMountsData"

/** 移除目标：确认框列出会被级联卸载的挂载（2026-10-29 用户确认） */
export function RemoveTargetDialog({
  target,
  mounts,
  skillById,
  onClose,
}: {
  target: Target | null
  mounts: Mount[]
  skillById: Map<string, SkillEntry>
  onClose: () => void
}) {
  const [busy, setBusy] = useState(false)
  // 关闭动画期间仍显示刚才那个目标
  const [shown, setShown] = useState(target)
  if (target && target !== shown) setShown(target)

  const confirm = async () => {
    if (!target) return
    setBusy(true)
    try {
      await useTargetStore.getState().removeTarget(target.id)
      if (useUIStore.getState().lens?.targetId === target.id) useUIStore.getState().setLens(null)
      toast.add({ title: copy.removeTarget.removed(target.label, mounts.length) })
      onClose()
    } catch (e) {
      const err = e as IpcError
      toast.add({ title: ipcErrorText(err.id, err.params), type: "error" })
    } finally {
      setBusy(false)
    }
  }

  return (
    <AlertDialog open={target !== null} onOpenChange={(next) => !next && !busy && onClose()}>
      <AlertDialogContent className="grid-cols-[minmax(0,1fr)]">
        <AlertDialogHeader>
          <AlertDialogMedia>
            <Trash2Icon className="text-destructive" />
          </AlertDialogMedia>
          <AlertDialogTitle>{copy.removeTarget.title(shown?.label ?? "")}</AlertDialogTitle>
          <AlertDialogDescription>{copy.removeTarget.description}</AlertDialogDescription>
        </AlertDialogHeader>
        {mounts.length > 0 ? (
          <section aria-labelledby="remove-target-cascade" className="flex min-w-0 flex-col gap-1.5">
            <h3 id="remove-target-cascade" className="text-sm">
              {copy.removeTarget.cascade(mounts.length)}
            </h3>
            <ItemGroup className="gap-1">
              {mounts.map((m) => (
                <Item key={m.id} size="xs" variant="muted">
                  <ItemMedia>
                    <ModeIcon mode={m.mode} />
                  </ItemMedia>
                  <ItemContent className="min-w-0">
                    <ItemTitle className="font-mono">{skillById.get(m.skillId)?.skill.slug ?? m.skillId}</ItemTitle>
                    <ItemDescription className="truncate font-mono text-xs">
                      {m.links.map((l) => l.path).join("、")}
                    </ItemDescription>
                  </ItemContent>
                </Item>
              ))}
            </ItemGroup>
          </section>
        ) : (
          <p className="text-sm text-muted-foreground">{copy.removeTarget.noMounts}</p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{copy.common.cancel}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" disabled={busy} onClick={() => void confirm()}>
            {busy && <Spinner data-icon="inline-start" aria-hidden />}
            {copy.removeTarget.submit}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
