import { CopyIcon } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { Controller, FormProvider, useWatch } from "react-hook-form"
import { useHotkeys } from "react-hotkeys-hook"

import type { EnvId, ServerAsset } from "@/bindings"
import { Keys } from "@/components/app/Keys"
import { FoldRow, PrefRow } from "@/components/app/SettingsList"
import { Button } from "@/components/ui/button"
import { FieldGroup } from "@/components/ui/field"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { toast } from "@/components/ui/toast"
import { useAgentOptions } from "@/features/agents/agentKeys"
import { copy } from "@/lib/copy"
import { deliveryOutcome, deliveryProblemsText } from "@/lib/deliveryFeedback"
import { HOTKEY_OPTIONS, HOTKEYS, isAlertOpen, KEY_HINT } from "@/lib/hotkeys"
import { ipc } from "@/lib/ipc"
import { mntToWindows } from "@/lib/paths"
import { selectCanDistribute, useAssetStore } from "@/stores/assets"
import { NEW_KEY, useConnectionStore } from "@/stores/connection"
import { useProbeStore } from "@/stores/probe"
import { useTargetStore } from "@/stores/targets"
import { useUIStore } from "@/stores/ui"
import { currentDeliverySnapshot, toastError } from "./actions"
import { AdvancedExtras } from "./AdvancedFields"
import { ConnectFlow, stepOfError, type EnableStage, type IncludeState } from "./ConnectFlow"
import { AuthMethodFields, HostPortFields, UserField } from "./ConnectionFields"
import { useConnectionTest } from "./ConnectionTest"
import { CopyKeyDialog, type CopyKeyRequest } from "./CopyKeyDialog"
import { CreateHeader } from "./CreateParts"
import { DraftPreview, SaveErrorAlert } from "./DraftPreview"
import { isUnreachableByAgents } from "./includeState"
import { forgetKeyCheck } from "./keyCheck"
import { LeaveDialog, useLeaveGuard } from "./LeaveDialog"
import { SaveFlowDialogs } from "./SaveFlowDialogs"
import { NameField } from "./sections/BasicSection"
import { firstError, focusField } from "./serverForm"
import { useAliasContext, useServerForm } from "./useServerForm"
import { includeMissing, useSaveFlow, type RevealTarget } from "./useSaveFlow"

type Stage = "testing" | EnableStage

/** 测试连接在 Windows 原生环境里执行（后端缺省），私钥那一步看这一行的路径 */
const TEST_ENV: EnvId = "windows"

/**
 * 添加 SSH 服务器（PRD 6.5 分支 A）：居中弹窗里填写，主按钮「连接并启用」一步到位——
 * 测试连接 → 第一次时问要不要加入 SSH 配置 → 保存 → 密码方式自动生成 ed25519 密钥、安装公钥并删除保存的密码（F-108 AC1、AC3）
 * → 同步给全部已启用的 Agent（档位从只读巡检开始）→ 后台首次探测，然后关闭弹窗回到列表。
 * 表单里不选 Agent、不选档位（2026-11-10）：要改就在资源行的 Agent 图标组和档位菜单上改。
 * 点了「连接并启用」之后，弹窗切到连接过程（ConnectFlow）：逐步显示进度，指纹和加入 SSH 配置都就地确认，
 * 失败时写明是哪一步、为什么，并给出「返回修改」「重新连接」「仅保存（暂不启用）」（F-106 AC3）
 */
export function NewServerForm() {
  const ctx = useAliasContext(undefined)
  const form = useServerForm(undefined, ctx)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const conn = useConnectionTest(form, NEW_KEY, undefined)
  const [stage, setStage] = useState<Stage | null>(null)
  const [view, setView] = useState<"form" | "connect">("form")
  const [failed, setFailed] = useState(false)
  const [copyReq, setCopyReq] = useState<CopyKeyRequest | null>(null)
  const [saveIntent, setSaveIntent] = useState<"connect-enable" | "save-only">("connect-enable")
  const { agents, compileTargets } = useAgentOptions()
  // 这次要不要问「加入 SSH 配置」，以及用户的决定：决定之后这一步留在列表里
  const [askInclude, setAskInclude] = useState(false)
  const [includeDecision, setIncludeDecision] = useState<"added" | "declined" | null>(null)
  const [aliasValue, nameValue, fallbackName, connection] = useWatch({ control: form.control, name: ["alias", "name", "fallbackName", "connection"] })

  const reveal = (target: RevealTarget) => {
    if (target.advanced) setAdvancedOpen(true)
    focusField(form, target.path)
  }
  const flow = useSaveFlow({ asset: undefined, form, testKey: NEW_KEY, reveal, quiet: true })
  const guard = useLeaveGuard(form.formState.isDirty && (!stage || flow.confirm?.stage === "include"), () => form.reset(undefined, { keepDirtyValues: false }))

  // OCI 实例旁的「同时加为 SSH 服务器」：预填地址和名称（F-104 AC4）
  const prefill = useUIStore((s) => s.createPrefill)
  useEffect(() => {
    if (prefill) {
      form.setValue("name", prefill.name, { shouldDirty: true })
      form.setValue("connection.host", prefill.host, { shouldDirty: true })
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

  /** 添加成功的提示条（PRD 6.5），并让新行短暂高亮 */
  const announce = (asset: ServerAsset, wanted: boolean) => {
    const unreachable = isUnreachableByAgents(asset, useTargetStore.getState().environments)
    const outcome = deliveryOutcome(asset.id, agents.map((a) => a.key), true, currentDeliverySnapshot(), useTargetStore.getState().targets)
    const partial = wanted && !unreachable && !outcome.complete
    toast.add({
      title: unreachable && asset.connection.verified?.ok ? copy.create.addedNoSshConfig(asset.name) : partial ? copy.deliveryFeedback.addedPartial(asset.name, outcome.count) : copy.create.added(asset.name, wanted ? outcome.count : 0),
      description: partial ? outcome.problems.length ? deliveryProblemsText(outcome.problems) : copy.deliveryFeedback.none : undefined,
      type: partial ? "warning" : "success",
    })
    useAssetStore.getState().flash([asset.id])
  }

  /** 保存成功之后：改用密钥、同步给全部已启用的 Agent、后台探测 */
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
      const current = (useAssetStore.getState().byId[asset.id] ?? asset) as ServerAsset
      // 选了「暂不加入」、Agent 在哪里都连不上时先不同步；资源行上「加入 SSH 配置」之后再同步
      if (selectCanDistribute(current).ok && !isUnreachableByAgents(current, useTargetStore.getState().environments)) {
        for (const a of agents) await useAssetStore.getState().setDistribute(asset.id, a.key, true)
      }
      void useProbeStore.getState().start(current.id).catch(toastError)
      announce((useAssetStore.getState().byId[asset.id] ?? current) as ServerAsset, true)
    } catch (e) {
      toastError(e)
    } finally {
      setStage(null)
      useConnectionStore.getState().clear(NEW_KEY)
      // 完成后关闭弹窗回到主列表，新服务器直接出现在列表里（PRD 6.5）
      useUIStore.getState().closeInspector({ force: true })
    }
  }

  /** 这次保存要不要问「加入 SSH 配置」：有运行环境还没加入、也没问过 */
  const prepareInclude = () => setAskInclude(includeMissing(form.getValues()).length > 0)

  const connectEnable = async () => {
    if (stage || flow.saving) return
    setSaveIntent("connect-enable")
    if (!(await form.trigger())) {
      setView("form")
      const target = firstError(form.formState.errors)
      if (target) reveal(target)
      return
    }
    setFailed(false)
    prepareInclude()
    setView("connect")
    setStage("testing")
    if (!(await conn.run())) {
      setStage(null)
      setView("form")
      return
    }
    const result = await useConnectionStore.getState().waitForResult(NEW_KEY)
    if (result !== "ok") {
      setStage(null)
      setFailed(result === "failed")
      return
    }
    const password = form.getValues("connection.method") === "password"
    setStage("saving")
    flow.submit({ pipeline: true, after: (saved) => void enable(saved, password), onInterrupted: () => setStage(null) })
  }

  /** 只保存，不授权（F-106 AC3）：标为「未验证」，资源行上有「测试连接」 */
  const saveOnly = () => {
    if (stage || flow.saving) return
    setSaveIntent("save-only")
    prepareInclude()
    flow.submit({ skipUnverified: true, after: (saved) => announce(saved, false) })
  }

  /** 保存失败后的重试沿用用户上次的选择：「仅保存」不会重新连接、转密钥或授权 */
  const retrySave = () => (saveIntent === "save-only" ? saveOnly() : void connectEnable())

  /** 回到表单，光标停在出问题的那一项 */
  const backToForm = () => {
    setView("form")
    const error = conn.test?.status === "failed" ? conn.test.error?.id : undefined
    const step = error ? stepOfError(error) : null
    const path =
      step === "key"
        ? "connection.identityFile"
        : step === "login"
          ? connection.method === "password"
            ? "connection.password"
            : "connection.user"
          : "connection.host"
    focusField(form, path)
  }

  /** 私钥那一步的就地修复：Windows 复制一份只有自己能读的副本，WSL 复制到发行版的 ~/.ssh/ */
  const requestKeyCopy = () => {
    const env = (conn.test?.error?.params?.env as EnvId | undefined) ?? TEST_ENV
    const keys = form.getValues("connection.identityFile")
    const source = keys.windows?.trim() || mntToWindows(keys[env] ?? "") || ""
    if (!source) toast.add({ title: copy.copyKey.noSource, type: "warning" })
    else setCopyReq({ source, envId: env })
  }
  const keyCopied = (env: EnvId, path: string) => {
    forgetKeyCheck(env, path)
    form.setValue("connection.identityFile", { ...form.getValues("connection.identityFile"), [env]: path }, { shouldDirty: true })
    // 修好之后直接重新连接
    queueMicrotask(() => void connectEnable())
  }

  // 表单本身就在添加弹窗里，所以只让给弹窗上面的确认对话框
  useHotkeys(HOTKEYS.save, () => !isAlertOpen() && void connectEnable(), HOTKEY_OPTIONS)

  const busy = !!stage || flow.saving
  const test = conn.test
  const running = test?.status === "running" || test?.status === "host-key"
  const echo = aliasValue.trim()
  const preview = useMemo(() => <DraftPreview control={form.control} asset={undefined} dirty />, [form.control])
  // 等用户决定要不要加入 SSH 配置：过程停在这一步，这一屏只有卡片里的一个主按钮
  const asking = flow.confirm?.stage === "include"
  const include: IncludeState | null = asking ? "waiting" : flow.including ? "adding" : (includeDecision ?? (askInclude ? "todo" : null))
  const enableStage: EnableStage | null = asking || flow.including ? null : stage && stage !== "testing" ? stage : flow.saving ? "saving" : null
  // 会同步到几个目录：已启用的「运行环境 × 目录」里，这台服务器可用的那些
  const dirs = includeDecision === "declined" ? 0 : compileTargets.filter((t) => connection.definedIn.includes(t.envId)).length
  const keyError = test?.status === "failed" && test.error && stepOfError(test.error.id) === "key" ? test.error : undefined
  const keyFix =
    keyError?.id === "key-permissions" ? (
      <Button type="button" variant="outline" size="xs" onClick={requestKeyCopy}>
        <CopyIcon data-icon="inline-start" />
        {String(keyError.params?.env ?? "").startsWith("wsl:") ? copy.connect.copyToWsl : copy.connect.copyToSsh}
      </Button>
    ) : undefined
  const settled = !running && !busy

  return (
    <FormProvider {...form}>
      <section aria-labelledby="detail-title" className="flex h-full min-h-0 flex-col">
        <CreateHeader
          title={view === "connect" ? copy.connect.title(nameValue.trim() || fallbackName) : copy.create.titleSsh}
          back={!busy}
          onBack={view === "connect" ? { label: copy.connect.back, run: () => (running ? conn.cancel() : backToForm()) } : undefined}
        />

        <ScrollArea className="min-h-0 flex-1">
          {/* 表单保持挂载：返回修改时内容和焦点都还在 */}
          <div className="flex flex-col gap-4 p-3 pb-6" hidden={view !== "form"}>
            {flow.error && (
              <SaveErrorAlert error={flow.error} onRetry={retrySave} />
            )}
            <FieldGroup className="@container/field-group gap-3.5">
              <HostPortFields />
              <div className="grid grid-cols-[8.75rem_minmax(0,1fr)] gap-3">
                <UserField />
                <NameField optional fallbackName={fallbackName} />
              </div>
              <AuthMethodFields compact />
              <div className="divide-y divide-line-2 overflow-hidden rounded-list border border-line bg-card">
                <Controller
                  name="production"
                  control={form.control}
                  render={({ field }) => (
                    <PrefRow label={copy.basic.production} labelFor="asset-production" hint={copy.create.prodHint}>
                      <Switch id="asset-production" checked={field.value} onCheckedChange={(v) => field.onChange(v)} />
                    </PrefRow>
                  )}
                />
                <FoldRow label={copy.connection.advanced} hint={copy.create.advancedHint} open={advancedOpen} onOpenChange={setAdvancedOpen} plain>
                  <AdvancedExtras ctx={ctx} />
                </FoldRow>
              </div>
            </FieldGroup>
          </div>
          {view === "connect" && (
            <div className="flex flex-col gap-4 p-3 pb-6" aria-live="polite">
              {flow.error && (
                <SaveErrorAlert error={flow.error} onRetry={retrySave} />
              )}
              <ConnectFlow
                name={nameValue.trim() || fallbackName}
                alias={echo || connection.host}
                user={connection.user}
                host={connection.host}
                port={Number(connection.port) || 22}
                method={connection.method}
                keyEnv={TEST_ENV}
                keyPath={connection.identityFile[TEST_ENV]}
                test={test}
                enable={enableStage}
                dirs={dirs}
                include={include}
                includeEnvs={flow.confirm?.stage === "include" ? flow.confirm.envIds : []}
                onTrust={() => void useConnectionStore.getState().trustHostKey(NEW_KEY).catch(toastError)}
                onBack={() => {
                  conn.cancel()
                  backToForm()
                }}
                onInclude={() => void flow.acceptInclude(() => setIncludeDecision("added"))}
                onSkipInclude={() => {
                  setIncludeDecision("declined")
                  flow.declineInclude()
                }}
                fixKey={keyFix}
              />
            </div>
          )}
        </ScrollArea>

        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t px-3 py-2.5">
          {view === "form" && <span className="mr-auto min-w-0 text-xs text-muted-foreground">{copy.create.footHint}</span>}
          {/* 核对指纹时卡片里已经有「返回修改」，底部不再重复 */}
          {view === "connect" && running && stage === "testing" && test?.status !== "host-key" && (
            <Button variant="ghost" size="sm" onClick={conn.cancel}>
              {copy.test.cancel}
            </Button>
          )}
          {view === "connect" && asking && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                flow.cancelConfirm()
                backToForm()
              }}
            >
              {copy.connect.back}
            </Button>
          )}
          {view === "connect" && settled && !asking && (
            <Button variant="ghost" size="sm" onClick={backToForm}>
              {copy.connect.back}
            </Button>
          )}
          {view === "form" && !stage && (
            <Button variant="ghost" size="sm" disabled={flow.saving} onClick={() => useUIStore.getState().closeInspector()}>
              {copy.serverForm.cancel}
            </Button>
          )}
          {failed && settled && !asking && (
            <Button variant="outline" size="sm" disabled={flow.saving} onClick={saveOnly}>
              {copy.create.saveOnly}
            </Button>
          )}
          {/* 连接过程中，指纹卡和加入 SSH 配置卡里的按钮是这一屏唯一的主按钮；忙碌时阶段写在步骤列表里，按钮只写一句 */}
          {(view === "form" || (test?.status !== "host-key" && stage !== "testing" && !asking)) && (
            <Button size="sm" disabled={busy} onClick={() => void connectEnable()}>
              {busy && <Spinner data-icon="inline-start" aria-hidden />}
              <span aria-live="polite">{busy ? copy.create.working : view === "connect" ? copy.connect.retry : copy.create.connectEnable}</span>
              {!busy && <Keys keys={KEY_HINT.save} className="[&>kbd]:bg-primary-foreground/15 [&>kbd]:text-primary-foreground" />}
            </Button>
          )}
        </div>
      </section>

      <SaveFlowDialogs flow={flow} inlineInclude />
      <LeaveDialog guard={guard} />
      <CopyKeyDialog request={copyReq} onClose={() => setCopyReq(null)} onCopied={keyCopied} />
      {preview}
    </FormProvider>
  )
}
