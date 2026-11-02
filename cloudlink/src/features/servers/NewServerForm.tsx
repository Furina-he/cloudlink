import { useEffect, useMemo, useState } from "react"
import { FormProvider, useWatch } from "react-hook-form"
import { useHotkeys } from "react-hotkeys-hook"

import type { Mode, ServerAsset } from "@/bindings"
import { Keys } from "@/components/app/Keys"
import { Button } from "@/components/ui/button"
import { FieldGroup } from "@/components/ui/field"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "@/components/ui/toast"
import { useAgentOptions } from "@/features/agents/agentKeys"
import { copy } from "@/lib/copy"
import { HOTKEY_OPTIONS, HOTKEYS, isAlertOpen, KEY_HINT } from "@/lib/hotkeys"
import { ipc } from "@/lib/ipc"
import { selectCanDistribute, useAssetStore } from "@/stores/assets"
import { NEW_KEY, useConnectionStore, type ConnectionTest } from "@/stores/connection"
import { useProbeStore } from "@/stores/probe"
import { useSettingsStore } from "@/stores/settings"
import { useUIStore } from "@/stores/ui"
import { serverActions, toastError } from "./actions"
import { AdvancedFields } from "./AdvancedFields"
import { ConnectionFields } from "./ConnectionFields"
import { TestResult, useConnectionTest } from "./ConnectionTest"
import { CreateHeader, GrantFields } from "./CreateParts"
import { DraftPreview, SaveErrorAlert } from "./DraftPreview"
import { LeaveDialog, useLeaveGuard } from "./LeaveDialog"
import { SaveFlowDialogs } from "./SaveFlowDialogs"
import { EnvTagField, NameField } from "./sections/BasicSection"
import { firstError, focusField } from "./serverForm"
import { useAliasContext, useAliasFollow, useServerForm } from "./useServerForm"
import { useSaveFlow, type RevealTarget } from "./useSaveFlow"

type Stage = "testing" | "converting" | "enabling"

/** 等这次测试连接出结果（主机指纹由全局的 HostKeyDialog 确认，确认后同一次测试继续） */
function awaitTest(key: string): Promise<ConnectionTest["status"]> {
  return new Promise((resolve) => {
    const check = (t: ConnectionTest | undefined) => {
      if (t && t.testId && (t.status === "ok" || t.status === "failed" || t.status === "cancelled")) {
        unsubscribe()
        resolve(t.status)
      }
    }
    const unsubscribe = useConnectionStore.subscribe((s) => check(s.testsByKey[key]))
    check(useConnectionStore.getState().testsByKey[key])
  })
}

/**
 * 添加 SSH 服务器（PRD 6.5 分支 A）：居中弹窗里填写，主按钮「连接并启用」一步到位——
 * 测试连接 → 保存并写入托管 ssh 配置 → 密码方式自动生成 ed25519 密钥、安装公钥并删除保存的密码（F-108 AC1、AC3）
 * → 授权给所选 Agent、设置档位 → 后台首次探测，然后关闭弹窗回到列表。连接失败时可以「仅保存（暂不启用）」（F-106 AC3）
 */
export function NewServerForm() {
  const ctx = useAliasContext(undefined)
  const form = useServerForm(undefined, ctx)
  const alias = useAliasFollow(form, ctx)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const conn = useConnectionTest(form, NEW_KEY, undefined)
  const [stage, setStage] = useState<Stage | null>(null)
  const [failed, setFailed] = useState(false)
  const { agents } = useAgentOptions()
  // 默认授权给全部启用的 Agent；用户点过之后以用户的选择为准（Agent 列表可能比弹窗晚到）
  const [picked, setGranted] = useState<string[] | null>(null)
  const granted = picked ?? agents.map((a) => a.key)
  const defaultMode = useSettingsStore((s) => s.settings?.defaultMode ?? "read-only")
  const [modeTouched, setModeTouched] = useState<Mode | null>(null)
  const [envTag, aliasValue] = useWatch({ control: form.control, name: ["envTag", "alias"] })
  // 生产默认只读巡检（F-202 AC2），其他取设置里的默认档位；用户选过就不再跟随环境
  const mode: Mode = modeTouched ?? (envTag === "prod" ? "read-only" : defaultMode)

  const reveal = (target: RevealTarget) => {
    if (target.advanced) setAdvancedOpen(true)
    focusField(form, target.path)
  }
  const flow = useSaveFlow({ asset: undefined, form, testKey: NEW_KEY, reveal })
  const guard = useLeaveGuard(form.formState.isDirty && !stage, () => form.reset(undefined, { keepDirtyValues: false }))

  // OCI 实例旁的「同时加为 SSH 服务器」：预填地址和名称（F-104 AC4）
  const prefill = useUIStore((s) => s.createPrefill)
  useEffect(() => {
    if (prefill) {
      form.setValue("name", prefill.name, { shouldDirty: true })
      form.setValue("connection.host", prefill.host, { shouldDirty: true })
      alias.sync()
    }
    form.setFocus(prefill ? "connection.user" : "connection.host")
    // 只在打开面板时预填一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form])

  useEffect(
    () => () => {
      // 离开添加面板时丢掉这次的测试结果，下次从头开始
      const s = useConnectionStore.getState()
      if (s.testsByKey[NEW_KEY]?.status === "running") void s.cancel(NEW_KEY).catch(() => undefined)
      s.clear(NEW_KEY)
    },
    []
  )

  /** 保存成功之后：改用密钥、授权、档位、后台探测 */
  const enable = async (saved: ServerAsset, password: boolean) => {
    let asset = saved
    try {
      if (password) {
        setStage("converting")
        try {
          asset = (await useConnectionStore.getState().convertToKey(saved.id)) as ServerAsset
          await ipc.setPassword(saved.id, null)
          await useAssetStore.getState().refresh()
        } catch {
          toast.add({ title: copy.create.keepPassword(saved.connection.sshAlias), type: "warning" })
        }
      }
      setStage("enabling")
      const current = useAssetStore.getState().byId[asset.id] ?? asset
      if (selectCanDistribute(current).ok) {
        for (const key of granted) await useAssetStore.getState().setDistribute(asset.id, key, true)
      }
      if (mode !== current.agent.mode) serverActions.requestMode(current, mode)
      if (current.type === "vps") void useProbeStore.getState().start(current.id).catch(toastError)
      toast.add({ title: copy.create.enabled(asset.connection.sshAlias), description: granted.length ? copy.agentSection.effectHint : undefined, type: "success" })
    } catch (e) {
      toastError(e)
    } finally {
      setStage(null)
      useConnectionStore.getState().clear(NEW_KEY)
      // 完成后关闭弹窗回到主列表，新服务器直接出现在列表里（PRD 6.5）
      useUIStore.getState().closeInspector({ force: true })
    }
  }

  const connectEnable = async () => {
    if (stage || flow.saving) return
    if (!(await form.trigger())) {
      const target = firstError(form.formState.errors)
      if (target) reveal(target)
      return
    }
    setFailed(false)
    setStage("testing")
    if (!(await conn.run())) {
      setStage(null)
      return
    }
    const result = await awaitTest(NEW_KEY)
    if (result !== "ok") {
      setStage(null)
      setFailed(result === "failed")
      return
    }
    const password = form.getValues("connection.method") === "password"
    flow.submit({ pipeline: true, after: (saved) => void enable(saved, password) })
  }

  /** 只保存，不授权（F-106 AC3）：标为「未验证」，回路行上有「测试连接」 */
  const saveOnly = () => flow.submit({ skipUnverified: true })

  // 表单本身就在添加弹窗里，所以只让给弹窗上面的确认对话框
  useHotkeys(HOTKEYS.save, () => !isAlertOpen() && void connectEnable(), HOTKEY_OPTIONS)

  const busy = !!stage || flow.saving
  const running = conn.test?.status === "running" || conn.test?.status === "host-key"
  const echo = aliasValue.trim()
  const label = stage ? copy.create.stage[stage] : flow.saving ? copy.serverForm.saving : copy.create.connectEnable
  const preview = useMemo(() => <DraftPreview control={form.control} asset={undefined} dirty />, [form.control])

  return (
    <FormProvider {...form}>
      <section aria-labelledby="detail-title" className="flex h-full min-h-0 flex-col">
        <CreateHeader title={copy.create.titleSsh} />

        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-4 p-3 pb-6">
            {flow.error && <SaveErrorAlert error={flow.error} onRetry={() => flow.submit()} />}
            <p className="text-xs text-muted-foreground">{copy.serverForm.required}</p>
            <FieldGroup className="@container/field-group gap-4">
              <ConnectionFields onHostChange={alias.sync} />
              <NameField onChange={alias.sync} />
              <EnvTagField />
              <p className="text-sm text-muted-foreground" aria-live="polite">
                {echo ? (
                  <>
                    {copy.create.aliasEchoPrefix} <code className="rounded-sm bg-muted px-1 font-mono text-[0.8125rem] text-foreground">{copy.create.aliasEcho(echo)}</code> {copy.create.aliasEchoSuffix}
                  </>
                ) : (
                  copy.create.aliasEmpty
                )}
              </p>
              <AdvancedFields open={advancedOpen} onOpenChange={setAdvancedOpen} ctx={ctx} onAliasChange={alias.markTouched} />
            </FieldGroup>
          </div>
        </ScrollArea>

        <div className="flex shrink-0 flex-col gap-3 border-t px-3 py-2.5">
          <GrantFields
            title={copy.create.grantAfter}
            agents={agents}
            selected={granted}
            onSelected={setGranted}
            mode={mode}
            onMode={setModeTouched}
            prod={envTag === "prod"}
          />
          <TestResult test={conn.test} current={conn.current} method={conn.method} />
          <div className="flex flex-wrap items-center justify-end gap-2">
            {running && stage === "testing" && (
              <Button variant="ghost" size="sm" onClick={conn.cancel}>
                {copy.test.cancel}
              </Button>
            )}
            {!stage && (
              <Button variant="ghost" size="sm" disabled={flow.saving} onClick={() => useUIStore.getState().closeInspector()}>
                {copy.serverForm.cancel}
              </Button>
            )}
            {failed && !stage && (
              <Button variant="outline" size="sm" disabled={flow.saving} onClick={saveOnly}>
                {copy.create.saveOnly}
              </Button>
            )}
            <Button size="sm" disabled={busy} onClick={() => void connectEnable()}>
              {busy && <Spinner data-icon="inline-start" aria-hidden />}
              <span aria-live="polite">{label}</span>
              {!busy && <Keys keys={KEY_HINT.save} className="[&>kbd]:bg-primary-foreground/15 [&>kbd]:text-primary-foreground" />}
            </Button>
          </div>
        </div>
      </section>

      <SaveFlowDialogs flow={flow} />
      <LeaveDialog guard={guard} />
      {preview}
    </FormProvider>
  )
}
