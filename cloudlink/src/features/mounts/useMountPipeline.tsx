import { ShieldAlertIcon, TriangleAlertIcon } from "lucide-react"
import { useRef, useState } from "react"

import type { IpcError, Mode } from "@/bindings"
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
import { toast } from "@/components/ui/toast"
import { copy, ipcErrorText } from "@/lib/copy"
import { useAssetStore } from "@/stores/assets"
import { useMountStore } from "@/stores/mounts"
import { useSkillStore } from "@/stores/skills"
import { useTargetStore } from "@/stores/targets"
import { effectHints, mountChecks } from "./mountRules"

type ConfirmKind = "prod-global" | "alias-missing"

interface Pending {
  kind: ConfirmKind
  text: string
}

/**
 * 挂载管线（PRD 6.6）：依次检查「生产挂全局」「已挂载」「别名不可达」，需要时弹 AlertDialog，
 * 成功后弹生效提示。资产编辑器、看板、矩阵、命令面板走同一条管线。返回的 dialog 需要渲染出来
 */
export function useMountPipeline() {
  const [pending, setPending] = useState<Pending | null>(null)
  const resolveRef = useRef<(ok: boolean) => void>(() => {})

  const ask = (kind: ConfirmKind, text: string) =>
    new Promise<boolean>((resolve) => {
      resolveRef.current = resolve
      setPending({ kind, text })
    })

  const settle = (ok: boolean) => {
    resolveRef.current(ok)
    resolveRef.current = () => {}
    setPending(null)
  }

  const requestMount = async (req: { skillId: string; targetId: string; mode: Mode }) => {
    const skill = useSkillStore.getState().statusById[req.skillId]
    const asset = skill && useAssetStore.getState().byId[skill.assetId]
    const target = useTargetStore.getState().targets.find((t) => t.id === req.targetId)
    if (!skill || !asset || !target) return
    const checks = mountChecks(asset, target)
    const alias = asset.connection.sshAlias

    if (checks.prodGlobal && !(await ask("prod-global", ipcErrorText("needs-confirm-prod-global", { slug: skill.slug })))) return
    const mounted = Object.values(useMountStore.getState().byId).some(
      (m) => m.skillId === req.skillId && m.targetId === req.targetId
    )
    if (mounted) {
      toast.add({ title: ipcErrorText("already-mounted", { slug: skill.slug }) })
      return
    }
    if (checks.aliasMissing && !(await ask("alias-missing", ipcErrorText("needs-confirm-alias-missing", { alias, env: target.envId })))) return

    const mount = (confirmed: boolean) => useMountStore.getState().mount({ ...req, confirmed })
    try {
      await mount(checks.prodGlobal || checks.aliasMissing)
    } catch (e) {
      const err = e as IpcError
      // 其余错误 store 已经弹过 Toast；这里只兜底「后端认为需要确认、界面没问到」的情况
      if (!err.id.startsWith("needs-confirm")) return
      const kind = err.id === "needs-confirm-prod-global" ? "prod-global" : "alias-missing"
      if (!(await ask(kind, ipcErrorText(err.id, err.params)))) return
      try {
        await mount(true)
      } catch {
        return
      }
    }
    toast.add({
      title: copy.mountFlow.done(skill.slug, target.label),
      description: effectHints(target).join(" "),
      type: "success",
    })
  }

  const Icon = pending?.kind === "prod-global" ? ShieldAlertIcon : TriangleAlertIcon
  const dialog = (
    <AlertDialog open={pending !== null} onOpenChange={(open) => !open && settle(false)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia>
            <Icon className="text-warning" />
          </AlertDialogMedia>
          <AlertDialogTitle>
            {pending?.kind === "prod-global" ? copy.mountFlow.prodGlobalTitle : copy.mountFlow.aliasMissingTitle}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {pending?.text}
            {pending?.kind === "alias-missing" && ` ${copy.mountFlow.aliasMissingNote}`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{copy.common.cancel}</AlertDialogCancel>
          <AlertDialogAction onClick={() => settle(true)}>{copy.mountFlow.confirm}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )

  return { requestMount, dialog }
}
