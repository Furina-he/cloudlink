// 自动同步的备份与撤销（F-309）、托盘（F-407）发到主窗口的请求
import type { BackupEvent, Target } from "@/bindings"
import { toast } from "@/components/ui/toast"
import { copy, ipcErrorText } from "@/lib/copy"
import { ipc, toIpcError } from "@/lib/ipc"
import { usePendingAction } from "@/features/servers/actions"
import { useAssetStore } from "./assets"
import { useTargetStore } from "./targets"
import { useDeliveryStore } from "./deliveries"
import { useSkillStore } from "./skills"

const nameOf = (t: Target | undefined) => (t ? (t.agent === "custom" ? t.label : copy.agent[t.agent]) : "")

/** 撤销：备份写回原处，这个目标停用，直到用户再次启用（AC2） */
export async function undoBackup(backupId: string) {
  try {
    const target = await ipc.undoBackup(backupId)
    const [targets, deliveries, inclusions, statuses] = await Promise.all([ipc.listTargets(), ipc.listDeliveries(), ipc.listInclusions(), ipc.getCompileStatus()])
    useTargetStore.setState({ targets })
    useDeliveryStore.getState()._onChanged({ deliveries, inclusions })
    useSkillStore.getState()._onCompiled(statuses)
    toast.add({ title: copy.backups.undone(nameOf(target)) })
  } catch (e) {
    const err = toIpcError(e)
    toast.add({ title: ipcErrorText(err.id, err.params), type: "error" })
  }
}

/** deliveries://backed-up：提示条「Kiro 里的 Skill 被改动过，已恢复；改动的版本已备份 · 撤销」 */
export function onBackedUp(e: BackupEvent) {
  const target = useTargetStore.getState().targets.find((t) => t.id === e.targetId)
  const name = nameOf(target)
  const id: string = toast.add({
    title: e.reason === "takeover" ? copy.backups.takenOver(name) : copy.backups.restored(name),
    timeout: 10_000,
    actionProps: {
      children: copy.common.undo,
      onClick: () => {
        toast.close(id)
        void undoBackup(e.backupId)
      },
    },
  })
}

/** 托盘里把生产资源切到标准运维：主窗口已经显示，这里弹出同一个确认（AC1） */
export function onTrayConfirmMode(assetId: string) {
  const asset = useAssetStore.getState().byId[assetId]
  if (!asset) return
  usePendingAction.getState().set({ kind: "mode", assetId })
}

/** 托盘菜单的文字只在 copy.ts，启动时交给 Rust 创建托盘 */
export function syncTrayCopy() {
  void ipc.setTrayCopy(copy.tray).catch(() => undefined)
}
