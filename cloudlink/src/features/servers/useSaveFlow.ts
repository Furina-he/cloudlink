// 保存流程（PRD 6.4、6.5）：校验 → 未验证提示 → Include 同意 → 保存 → 密码进凭据库 → 首次探测
import { useState } from "react"
import type { FieldErrors, UseFormReturn } from "react-hook-form"

import type { Asset, EnvId, IpcError } from "@/bindings"
import { toast } from "@/components/ui/toast"
import { copy } from "@/lib/copy"
import { ipc } from "@/lib/ipc"
import type { ServerFormValues } from "@/lib/schemas"
import { useAssetStore } from "@/stores/assets"
import { connectionSignature, isTestCurrent, NEW_KEY, useConnectionStore } from "@/stores/connection"
import { useSettingsStore } from "@/stores/settings"
import { useTargetStore } from "@/stores/targets"
import { setLeaveGuard, useUIStore } from "@/stores/ui"
import { serverActions, toastError } from "./actions"
import { connectionInputOf, connectionInputOfForm, firstError, formValuesOf, sortEnvs, toAssetInput } from "./serverForm"

export type RevealTarget = NonNullable<ReturnType<typeof firstError>>

/** 等用户确认的一步：连接未验证（6.5）、首次写入托管 ssh 配置前征得同意（F-107 AC1） */
export type SaveConfirm =
  | { stage: "unverified"; values: ServerFormValues; after?: (a: Asset) => void }
  | { stage: "include"; values: ServerFormValues; envIds: EnvId[]; after?: (a: Asset) => void }

/** 托管配置要写入、还没加 Include、也还没问过的运行环境 */
function includeMissing(v: ServerFormValues): EnvId[] {
  if (v.source !== "managed") return []
  const envs = useTargetStore.getState().environments
  const asked = useSettingsStore.getState().settings?.sshIncludeAsked ?? []
  return sortEnvs(v.connection.definedIn).filter(
    (id) => !envs.find((e) => e.id === id)?.managedSshConfig.included && !asked.includes(id)
  )
}

export function useSaveFlow({
  asset,
  form,
  testKey,
  reveal,
}: {
  asset: Asset | undefined
  form: UseFormReturn<ServerFormValues>
  testKey: string
  /** 展开出错字段所在的分段并聚焦它 */
  reveal: (target: RevealTarget) => void
}) {
  const [confirm, setConfirm] = useState<SaveConfirm | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<IpcError | null>(null)

  /** 连接参数和已保存的一致，或者当前参数刚测试通过，就不用提示「未验证」 */
  const verifiedFor = (v: ServerFormValues) => {
    const input = connectionInputOfForm(v)
    if (asset && connectionSignature(connectionInputOf(asset)) === connectionSignature(input)) return true
    const t = useConnectionStore.getState().testsByKey[testKey]
    return isTestCurrent(t, input) && t?.status === "ok"
  }

  const doSave = async (v: ServerFormValues, after?: (a: Asset) => void) => {
    setSaving(true)
    setError(null)
    const t = useConnectionStore.getState().testsByKey[testKey]
    const input = connectionInputOfForm(v)
    const tested = isTestCurrent(t, input) && t?.status === "ok"
    try {
      const { asset: saved } = await useAssetStore.getState().save({ ...toAssetInput(v, asset), testId: tested ? (t?.testId ?? undefined) : undefined })
      // 密码只经这一次 IPC 进系统凭据库（F-108）；新建时要等拿到 id
      if (v.source === "managed" && v.connection.method === "password" && v.connection.password) {
        await ipc.setPassword(saved.id, v.connection.password)
        await useAssetStore.getState().refresh()
      }
      // 必须关掉 keepDirtyValues：它只用于后台同步，RHF 的 reset() 也会带上 useForm 的 resetOptions
      form.reset(formValuesOf(useAssetStore.getState().byId[saved.id] ?? saved), { keepDirtyValues: false })
      setLeaveGuard(null)
      if (!asset) {
        useConnectionStore.getState().clear(NEW_KEY)
        useUIStore.getState().selectAsset(saved.id, { force: true })
      }
      // 测试已通过时自动发起首次探测（F-106 AC4）
      if (tested && saved.probe.status === "never") serverActions.probe(saved)
      after?.(saved)
    } catch (e) {
      const err = e as IpcError
      if (err.id === "alias-conflict" || err.id === "alias-taken") {
        form.setError("alias", { message: err.id })
        reveal({ section: "connection", advanced: true, path: "alias" })
      } else {
        setError(err)
      }
    } finally {
      setSaving(false)
    }
  }

  const proceed = (stage: SaveConfirm["stage"], v: ServerFormValues, after?: (a: Asset) => void) => {
    if (stage === "unverified" && !verifiedFor(v)) {
      setConfirm({ stage: "unverified", values: v, after })
      return
    }
    const envIds = includeMissing(v)
    if (envIds.length) setConfirm({ stage: "include", values: v, envIds, after })
    else void doSave(v, after)
  }

  const submit = (after?: (a: Asset) => void) => {
    if (saving || form.formState.isSubmitting) return
    void form.handleSubmit(
      (v) => proceed("unverified", v, after),
      (errors: FieldErrors<ServerFormValues>) => {
        const target = firstError(errors)
        if (target) reveal(target)
      }
    )()
  }

  return {
    submit,
    saving,
    error,
    clearError: () => setError(null),
    confirm,
    cancelConfirm: () => setConfirm(null),
    confirmUnverified: () => {
      if (confirm?.stage !== "unverified") return
      setConfirm(null)
      proceed("include", confirm.values, confirm.after)
    },
    /** 加入 Include（F-107 AC1）：先备份再在 config 开头加一行；失败时不保存 */
    acceptInclude: async () => {
      if (confirm?.stage !== "include") return
      const { values, envIds, after } = confirm
      setConfirm(null)
      setSaving(true)
      try {
        for (const env of envIds) {
          await useTargetStore.getState().addSshInclude(env)
          toast.add({ title: copy.include.added(copy.env.long(env)), type: "success" })
        }
      } catch (e) {
        toastError(e)
        setSaving(false)
        return
      }
      await doSave(values, after)
    },
    /** 暂不加入：记下已经问过，不再弹窗；服务器在这些环境里记为「未列入」 */
    declineInclude: () => {
      if (confirm?.stage !== "include") return
      const { values, envIds, after } = confirm
      setConfirm(null)
      const asked = useSettingsStore.getState().settings?.sshIncludeAsked ?? []
      void useSettingsStore.getState().update({ sshIncludeAsked: [...new Set([...asked, ...envIds])] })
      toast.add({ title: copy.include.skipped })
      void doSave(values, after)
    },
  }
}

export type SaveFlow = ReturnType<typeof useSaveFlow>
