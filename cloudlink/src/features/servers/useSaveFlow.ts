// 保存流程（PRD 6.4、6.5）：校验 → 未验证提示 → Include 同意 → 保存 → 密码进凭据库 → 首次探测
import { useState } from "react"
import type { FieldErrors, UseFormReturn } from "react-hook-form"

import type { ServerAsset, EnvId, IpcError } from "@/bindings"
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
import { connectionEditValues, connectionInputOf, connectionInputOfForm, firstError, formValuesOf, sortEnvs, toAssetInput } from "./serverForm"

export type RevealTarget = NonNullable<ReturnType<typeof firstError>>

export interface SubmitOptions {
  /** 保存成功之后接着做的事 */
  after?: (a: ServerAsset) => void
  /** 保存失败、校验未通过或确认被关闭时结束调用方的流水线 */
  onInterrupted?: () => void
  /** 「连接并启用」的流水线：留在添加面板显示阶段进度，保存后不跳转、不自动探测，也不再问「未验证」 */
  pipeline?: boolean
  /** 「仅保存（暂不启用）」：用户已经看到连接失败，不再问「未验证」 */
  skipUnverified?: boolean
}

/** 等用户确认的一步：连接未验证（6.5）、首次写入托管 ssh 配置前征得同意（F-107 AC1） */
export type SaveConfirm =
  | { stage: "unverified"; values: ServerFormValues; opts: SubmitOptions }
  | { stage: "include"; values: ServerFormValues; envIds: EnvId[]; opts: SubmitOptions }

/** 托管配置要写入、还没加 Include、也还没问过的运行环境 */
export function includeMissing(v: ServerFormValues): EnvId[] {
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
  quiet,
  connectionOnly,
}: {
  asset: ServerAsset | undefined
  form: UseFormReturn<ServerFormValues>
  testKey: string
  /** 切到出错字段所在的 Tab 并聚焦它 */
  reveal: (target: RevealTarget) => void
  /** 添加流程：加入与否写在过程页的步骤里，最后只出一条提示（PRD 6.5），这里不另出提示条 */
  quiet?: boolean
  /** 连接弹窗只保存连接和导出，其他资料以最新持久化资源为准。 */
  connectionOnly?: boolean
}) {
  const [confirm, setConfirm] = useState<SaveConfirm | null>(null)
  const [saving, setSaving] = useState(false)
  const [including, setIncluding] = useState(false)
  const [error, setError] = useState<IpcError | null>(null)

  const valuesFor = (v: ServerFormValues) => {
    const latest = asset ? useAssetStore.getState().byId[asset.id] : undefined
    const base = latest?.type === "vps" ? latest : asset
    return { base, values: connectionOnly && asset && base ? connectionEditValues(v, asset, base) : v }
  }

  /** 验证证明必须对应实际将保存的连接，而不只是打开弹窗时的旧参数。 */
  const verifiedFor = (v: ServerFormValues) => {
    const { values, base } = valuesFor(v)
    const input = connectionInputOfForm(values)
    if (base && connectionSignature(connectionInputOf(base)) === connectionSignature(input)) return true
    const t = useConnectionStore.getState().testsByKey[testKey]
    return isTestCurrent(t, input) && t?.status === "ok"
  }

  const doSave = async (v: ServerFormValues, opts: SubmitOptions) => {
    setSaving(true)
    setError(null)
    let values = v
    let tested = false
    const inputFor = (base: ServerAsset | undefined) => {
      values = connectionOnly && asset && base ? connectionEditValues(v, asset, base) : v
      const input = connectionInputOfForm(values)
      const t = useConnectionStore.getState().testsByKey[testKey]
      tested = isTestCurrent(t, input) && t?.status === "ok"
      return { ...toAssetInput(values, base), testId: tested ? (t?.testId ?? undefined) : undefined }
    }
    try {
      const store = useAssetStore.getState()
      const result = asset ? await store.update(asset.id, (latest) => {
        if (latest.type !== "vps") throw { id: "not-found" } satisfies IpcError
        return inputFor(latest)
      }) : await store.save(inputFor(undefined))
      const saved = result.asset as ServerAsset
      // 密码只经这一次 IPC 进系统凭据库（F-108）；新建时要等拿到 id
      if (values.source === "managed" && values.connection.method === "password" && values.connection.password) {
        await ipc.setPassword(saved.id, values.connection.password)
        await useAssetStore.getState().refresh()
      }
      // 必须关掉 keepDirtyValues：它只用于后台同步，RHF 的 reset() 也会带上 useForm 的 resetOptions
      form.reset(formValuesOf((useAssetStore.getState().byId[saved.id] as ServerAsset | undefined) ?? saved), { keepDirtyValues: false })
      setLeaveGuard(null)
      if (!opts.pipeline) {
        if (!asset) {
          // 新建的保存完关闭添加弹窗，回到主列表（PRD 6.5）
          useConnectionStore.getState().clear(NEW_KEY)
          useUIStore.getState().closeInspector({ force: true })
        }
        // 测试已通过时自动发起首次探测（F-106 AC1）
        if (tested && saved.probe.status === "never") serverActions.probe(saved)
      }
      opts.after?.(saved)
    } catch (e) {
      const err = e as IpcError
      if (err.id === "alias-conflict" || err.id === "alias-taken") {
        form.setError("alias", { message: err.id })
        reveal({ advanced: true, path: "alias" })
      } else {
        setError(err)
      }
      opts.onInterrupted?.()
    } finally {
      setSaving(false)
    }
  }

  const proceed = (stage: SaveConfirm["stage"], v: ServerFormValues, opts: SubmitOptions) => {
    setError(null)
    if (stage === "unverified" && !opts.pipeline && !opts.skipUnverified && !verifiedFor(v)) {
      setConfirm({ stage: "unverified", values: v, opts })
      return
    }
    const envIds = includeMissing(valuesFor(v).values)
    if (envIds.length) setConfirm({ stage: "include", values: v, envIds, opts })
    else void doSave(v, opts)
  }

  const submit = (opts: SubmitOptions = {}) => {
    if (saving || confirm || form.formState.isSubmitting) return
    void form.handleSubmit(
      (v) => proceed("unverified", v, opts),
      (errors: FieldErrors<ServerFormValues>) => {
        const target = firstError(errors)
        if (target) reveal(target)
        opts.onInterrupted?.()
      }
    )()
  }

  return {
    submit,
    saving,
    including,
    error,
    clearError: () => setError(null),
    confirm,
    cancelConfirm: () => {
      setConfirm(null)
      confirm?.opts.onInterrupted?.()
    },
    confirmUnverified: () => {
      if (confirm?.stage !== "unverified") return
      setConfirm(null)
      proceed("include", confirm.values, confirm.opts)
    },
    /** 加入 Include（F-107 AC1）：先备份再在 config 开头加一行；失败时不保存 */
    acceptInclude: async (onAdded?: () => void) => {
      if (confirm?.stage !== "include") return
      const { values, envIds, opts } = confirm
      setConfirm(null)
      setSaving(true)
      setIncluding(true)
      try {
        for (const env of envIds) {
          await useTargetStore.getState().addSshInclude(env)
          if (!quiet) toast.add({ title: copy.include.added(copy.env.long(env)), type: "success" })
        }
      } catch (e) {
        toastError(e)
        setSaving(false)
        setIncluding(false)
        opts.onInterrupted?.()
        return
      }
      setIncluding(false)
      onAdded?.()
      await doSave(values, opts)
    },
    /** 暂不加入：记下已经问过，不再弹窗；服务器在这些环境里记为「未列入」 */
    declineInclude: () => {
      if (confirm?.stage !== "include") return
      const { values, envIds, opts } = confirm
      setConfirm(null)
      const asked = useSettingsStore.getState().settings?.sshIncludeAsked ?? []
      void useSettingsStore.getState().update({ sshIncludeAsked: [...new Set([...asked, ...envIds])] })
      if (!quiet) toast.add({ title: copy.include.skipped })
      void doSave(values, opts)
    },
  }
}

export type SaveFlow = ReturnType<typeof useSaveFlow>
