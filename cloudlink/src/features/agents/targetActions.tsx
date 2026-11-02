// Agent 目标的操作（PRD 6.6、F-302、F-305）：启用开关、修复、检查、在文件夹中显示、移除自定义目录
import { FolderMinusIcon, TriangleAlertIcon } from "lucide-react"
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
import { useGuardStore } from "@/stores/guard"
import { useTargetStore } from "@/stores/targets"

type PendingTarget = { kind: "disable" | "repair" | "remove"; targetId: string } | null

interface TargetUI {
  pending: PendingTarget
  /** 正在切换启用、正在修复的目标 */
  busy: string[]
  set: (p: PendingTarget) => void
  mark: (id: string, on: boolean) => void
}

export const useTargetUI = create<TargetUI>()((set) => ({
  pending: null,
  busy: [],
  set: (pending) => set({ pending }),
  mark: (id, on) => set((s) => ({ busy: on ? [...s.busy, id] : s.busy.filter((x) => x !== id) })),
}))

export const targetLabel = (t: Target) => (t.agent === "custom" ? t.label : copy.agent[t.agent])

async function withBusy(id: string, fn: () => Promise<void>) {
  useTargetUI.getState().mark(id, true)
  try {
    await fn()
  } catch (e) {
    toastError(e)
  } finally {
    useTargetUI.getState().mark(id, false)
  }
}

export const targetActions = {
  /** 启用后自动写入副本（F-302 AC1）；停用前确认（AC2） */
  toggle(t: Target, on: boolean) {
    if (!on) {
      useTargetUI.getState().set({ kind: "disable", targetId: t.id })
      return
    }
    void withBusy(t.id, async () => {
      await useTargetStore.getState().setEnabled(t.id, true)
      toast.add({ title: copy.targets.enabledToast(targetLabel(t)), type: "success" })
    })
  },

  /** 副本被改动过时先提示修复会覆盖改动（F-305 AC） */
  repair(t: Target, d: Delivery) {
    if (d.status === "modified") {
      useTargetUI.getState().set({ kind: "repair", targetId: t.id })
      return
    }
    void targetActions.doRepair(t, d)
  },

  async doRepair(t: Target, d: Delivery) {
    await withBusy(t.id, async () => {
      await useDeliveryStore.getState().repair(d.id)
      toast.add({ title: copy.targets.repaired(targetLabel(t)), type: "success" })
    })
  },

  /** 检查全部副本，同时重新计算列入情况、对护栏做自检（F-305） */
  async checkAll() {
    try {
      const list = await useDeliveryStore.getState().checkAll()
      void useGuardStore.getState().load()
      toast.add({ title: copy.agents.checked(list.length) })
    } catch (e) {
      toastError(e)
    }
  },

  reveal(t: Target, d: Delivery | undefined) {
    void ipc.revealInDir(d && d.status !== "missing" ? d.path : t.path)
  },
}

/** 停用目标、覆盖被改动的副本、移除自定义目录：都先确认。在 Agent 页挂一份 */
export function TargetDialogs() {
  const pending = useTargetUI((s) => s.pending)
  // 关闭后保留最后一次的内容，退场动画期间文字不消失
  const [last, setLast] = useState(pending)
  if (pending && pending !== last) setLast(pending)
  const shown = pending ?? last
  const target = useTargetStore((s) => s.targets.find((t) => t.id === shown?.targetId))
  const delivery = useDeliveryStore((s) => Object.values(s.byId).find((d) => d.targetId === shown?.targetId))
  const [busy, setBusy] = useState(false)
  const close = () => useTargetUI.getState().set(null)
  const label = target ? targetLabel(target) : ""

  const confirm = async () => {
    if (!shown || !target) return
    setBusy(true)
    try {
      if (shown.kind === "disable") {
        await useTargetStore.getState().setEnabled(target.id, false)
        toast.add({ title: copy.targets.disabledToast(label) })
      } else if (shown.kind === "remove") {
        await useTargetStore.getState().removeCustom(target.id)
        toast.add({ title: copy.targets.removed(label) })
      } else if (delivery) {
        await targetActions.doRepair(target, delivery)
      }
      close()
    } catch (e) {
      toastError(e)
    } finally {
      setBusy(false)
    }
  }

  const text =
    shown?.kind === "repair"
      ? { title: copy.targets.repairTitle, description: copy.targets.repairDescription(delivery?.path ?? ""), confirm: copy.targets.repairConfirm }
      : shown?.kind === "remove"
        ? { title: copy.targets.removeTitle(label), description: copy.targets.removeDescription, confirm: copy.targets.removeCustom }
        : { title: copy.targets.disableTitle(label), description: copy.targets.disableDescription, confirm: copy.targets.disableConfirm }

  return (
    <AlertDialog open={!!pending && !!target} onOpenChange={(open) => !open && !busy && close()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia>{shown?.kind === "repair" ? <TriangleAlertIcon className="text-warning" /> : <FolderMinusIcon className="text-destructive" />}</AlertDialogMedia>
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
