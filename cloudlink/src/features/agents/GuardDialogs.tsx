import { ShieldCheckIcon, ShieldOffIcon } from "lucide-react"
import { lazy, Suspense, useState } from "react"
import { create } from "zustand"

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
import { CodeBlock, CodeBlockContent, CodeBlockLine } from "@/components/ui/code-block"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "@/components/ui/toast"
import { copy } from "@/lib/copy"
import { cn } from "@/lib/utils"
import { toastError } from "@/features/servers/actions"
import { useGuardStore } from "@/stores/guard"

type PendingGuard = { kind: "install" | "remove"; envId: EnvId } | null

/** 等用户确认的护栏操作。Agent 页的护栏分区和首次启动清单共用，对话框在 App 上挂一份 */
export const useGuardDialog = create<{ pending: PendingGuard; set: (p: PendingGuard) => void }>()((set) => ({
  pending: null,
  set: (pending) => set({ pending }),
}))

// 高亮带 Shiki：按需加载；加载完成前先显示原文
const GuardPlannedEntry = lazy(() => import("./GuardPlannedEntry"))

/** 将要加入 settings.json 的 JSON 原文（F-306 AC1） */
function PlannedEntry({ entry }: { entry: string }) {
  const plain = (
    <CodeBlock size="sm">
      <CodeBlockContent wrap className="max-h-64">
        {entry.split("\n").map((line, i) => (
          <CodeBlockLine key={i}>{line}</CodeBlockLine>
        ))}
      </CodeBlockContent>
    </CodeBlock>
  )
  return (
    <Suspense fallback={plain}>
      <GuardPlannedEntry entry={entry} />
    </Suspense>
  )
}

/** 安装前展示将要写入的内容和备份位置，征得同意才写入；移除只删 CloudLink 加的那一条（F-306 AC1） */
export function GuardDialogs() {
  const pending = useGuardDialog((s) => s.pending)
  // 关闭后保留最后一次的内容，退场动画期间文字不消失
  const [last, setLast] = useState(pending)
  if (pending && pending !== last) setLast(pending)
  const shown = pending ?? last
  const status = useGuardStore((s) => (shown ? s.statusByEnv[shown.envId] : undefined))
  const [busy, setBusy] = useState(false)
  const close = () => useGuardDialog.getState().set(null)
  const install = shown?.kind === "install"
  const env = shown ? copy.env.long(shown.envId) : ""

  const confirm = async () => {
    if (!shown) return
    setBusy(true)
    try {
      if (install) await useGuardStore.getState().install(shown.envId)
      else await useGuardStore.getState().remove(shown.envId)
      toast.add({ title: install ? copy.guard.installed(env) : copy.guard.removed(env), type: install ? "success" : undefined })
      close()
    } catch (e) {
      toastError(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <AlertDialog open={!!pending} onOpenChange={(open) => !open && !busy && close()}>
      <AlertDialogContent className={cn(install && "data-[size=default]:sm:max-w-lg")}>
        <AlertDialogHeader>
          <AlertDialogMedia>{install ? <ShieldCheckIcon /> : <ShieldOffIcon className="text-destructive" />}</AlertDialogMedia>
          <AlertDialogTitle>{install ? copy.guard.installTitle(env) : copy.guard.removeTitle(env)}</AlertDialogTitle>
          <AlertDialogDescription>{install ? copy.guard.installDescription : copy.guard.removeDescription}</AlertDialogDescription>
        </AlertDialogHeader>
        {install && status && (
          <div className="flex min-w-0 flex-col gap-3 text-xs">
            <div className="flex min-w-0 flex-col gap-1.5">
              <p className="text-muted-foreground">
                {copy.guard.entryLabel} · <span className="font-mono break-all">{status.settingsPath}</span>
              </p>
              <PlannedEntry entry={status.planned.entry} />
            </div>
            <p className="flex min-w-0 flex-col gap-0.5">
              <span className="text-muted-foreground">{copy.guard.backupLabel}</span>
              <span className="font-mono break-all">{status.planned.backupPath}</span>
            </p>
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{copy.common.cancel}</AlertDialogCancel>
          <AlertDialogAction variant={install ? "default" : "destructive"} disabled={busy} onClick={() => void confirm()}>
            {busy && <Spinner data-icon="inline-start" aria-hidden />}
            {install ? copy.guard.installConfirm : copy.guard.removeConfirm}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
