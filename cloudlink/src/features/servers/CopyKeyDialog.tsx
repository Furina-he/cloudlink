import { CopyIcon } from "lucide-react"
import { useState } from "react"

import type { EnvId } from "@/bindings"
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
import { ipc, toIpcError } from "@/lib/ipc"
import { toastError } from "./actions"

export interface CopyKeyRequest {
  source: string
  envId: EnvId
}

/**
 * 复制到 WSL（F-108 AC4，2026-10-31 用户确认由 CloudLink 复制）：先说明源文件和目标位置，
 * 确认后复制到发行版的 ~/.ssh/，600 权限，重名加后缀不覆盖，再把这一行改成副本的路径。
 * 目标是 Windows 时（权限过宽的私钥，2026-11-07）：复制到 Windows 的 ~/.ssh/，副本只有当前用户能读
 */
export function CopyKeyDialog({
  request,
  onClose,
  onCopied,
}: {
  request: CopyKeyRequest | null
  onClose: () => void
  onCopied: (envId: EnvId, path: string) => void
}) {
  const [busy, setBusy] = useState(false)
  // 关闭后保留最后一次的内容，退场动画期间文字不消失
  const [last, setLast] = useState(request)
  if (request && request !== last) setLast(request)
  const shown = request ?? last

  const confirm = async () => {
    if (!request) return
    setBusy(true)
    try {
      const { path } = request.envId === "windows" ? await ipc.copyKeyToSshDir(request) : await ipc.copyKeyToWsl(request)
      onCopied(request.envId, path)
      toast.add({ title: copy.copyKey.done(path), type: "success" })
      onClose()
    } catch (e) {
      toastError(toIpcError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AlertDialog open={!!request} onOpenChange={(open) => !open && !busy && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia>
            <CopyIcon />
          </AlertDialogMedia>
          <AlertDialogTitle>{shown?.envId === "windows" ? copy.copyKey.titleWindows : copy.copyKey.title}</AlertDialogTitle>
          <AlertDialogDescription className="break-all">
            {shown &&
              (shown.envId === "windows"
                ? copy.copyKey.descriptionWindows(shown.source)
                : copy.copyKey.description(shown.source, copy.env.long(shown.envId)))}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{copy.common.cancel}</AlertDialogCancel>
          <AlertDialogAction disabled={busy} onClick={() => void confirm()}>
            {busy && <Spinner data-icon="inline-start" aria-hidden />}
            {copy.copyKey.confirm}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
