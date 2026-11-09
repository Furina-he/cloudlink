// Agent 目标的操作（PRD 6.6、F-302、F-309）：启用开关（同一 Agent 的 Windows 与 WSL 一起）、
// 备份并接管、在文件夹中显示、移除自定义目录。副本缺失或被改动由后端自动处理，没有「修复」
import { FolderMinusIcon } from "lucide-react"
import { useState } from "react"
import { create } from "zustand"

import type { Delivery, Target } from "@/bindings"
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
import { Spinner } from "@/components/ui/spinner"
import { toast } from "@/components/ui/toast"
import { copy } from "@/lib/copy"
import { ipc } from "@/lib/ipc"
import { toastError } from "@/features/servers/actions"
import { useDeliveryStore } from "@/stores/deliveries"
import { useTargetStore } from "@/stores/targets"

type PendingTarget = { kind: "disable" | "remove"; targetIds: string[] } | null

interface TargetUI {
  pending: PendingTarget
  /** 正在切换启用、正在接管的目标 */
  busy: string[]
  set: (p: PendingTarget) => void
  mark: (ids: string[], on: boolean) => void
}

export const useTargetUI = create<TargetUI>()((set) => ({
  pending: null,
  busy: [],
  set: (pending) => set({ pending }),
  mark: (ids, on) => set((s) => ({ busy: on ? [...s.busy, ...ids] : s.busy.filter((x) => !ids.includes(x)) })),
}))

export const targetLabel = (t: Target) => (t.agent === "custom" ? t.label : copy.agent[t.agent])

async function withBusy(ids: string[], fn: () => Promise<void>) {
  useTargetUI.getState().mark(ids, true)
  try {
    await fn()
  } catch (e) {
    toastError(e)
  } finally {
    useTargetUI.getState().mark(ids, false)
  }
}

export const targetActions = {
  /** 打开立即同步（F-302 AC1）；关闭前确认（AC2）。一行是一个 Agent，Windows 与 WSL 的目录一起切换 */
  toggle(targets: Target[], on: boolean) {
    const ids = targets.filter((t) => t.enabled !== on).map((t) => t.id)
    if (ids.length === 0) return
    if (!on) {
      useTargetUI.getState().set({ kind: "disable", targetIds: ids })
      return
    }
    void withBusy(ids, async () => {
      for (const id of ids) await useTargetStore.getState().setEnabled(id, true)
      toast.add({ title: copy.targets.enabledToast(targetLabel(targets[0])), type: "success" })
    })
  },

  /** F-309 AC3：目录里的同名 Skill 移进备份，再写入；提示条的「撤销」由 deliveries://backed-up 给出 */
  takeOver(targets: Target[]) {
    const ids = targets.map((t) => t.id)
    void withBusy(ids, async () => {
      for (const id of ids) await useDeliveryStore.getState().takeOver(id)
    })
  },

  reveal(t: Target, d: Delivery | undefined) {
    void ipc.revealInDir(d && d.status !== "missing" ? d.path : t.path)
  },
}

/** 停用目标、移除自定义目录：都先确认。在 Agent 页挂一份 */
export function TargetDialogs() {
  const pending = useTargetUI((s) => s.pending)
  // 关闭后保留最后一次的内容，退场动画期间文字不消失
  const [last, setLast] = useState(pending)
  if (pending && pending !== last) setLast(pending)
  const shown = pending ?? last
  const targets = useTargetStore((s) => s.targets)
  const chosen = targets.filter((t) => shown?.targetIds.includes(t.id))
  const [busy, setBusy] = useState(false)
  const close = () => useTargetUI.getState().set(null)
  const label = chosen[0] ? targetLabel(chosen[0]) : ""

  const confirm = async () => {
    if (!shown || chosen.length === 0) return
    setBusy(true)
    try {
      for (const t of chosen) {
        if (shown.kind === "disable") await useTargetStore.getState().setEnabled(t.id, false)
        else await useTargetStore.getState().removeCustom(t.id)
      }
      toast.add({ title: shown.kind === "disable" ? copy.targets.disabledToast(label) : copy.targets.removed(label) })
      close()
    } catch (e) {
      toastError(e)
    } finally {
      setBusy(false)
    }
  }

  const text =
    shown?.kind === "remove"
      ? { title: copy.targets.removeTitle(label), description: copy.targets.removeDescription, confirm: copy.targets.removeCustom }
      : { title: copy.targets.disableTitle(label), description: copy.targets.disableDescription, confirm: copy.targets.disableConfirm }

  return (
    <AlertDialog open={!!pending && chosen.length > 0} onOpenChange={(open) => !open && !busy && close()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia>
            <FolderMinusIcon className="text-destructive" />
          </AlertDialogMedia>
          <AlertDialogTitle>{text.title}</AlertDialogTitle>
          <AlertDialogDescription className="break-all">{text.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{copy.common.cancel}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" disabled={busy} onClick={() => void confirm()}>
            {busy && <Spinner data-icon="inline-start" aria-hidden />}
            {text.confirm}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
