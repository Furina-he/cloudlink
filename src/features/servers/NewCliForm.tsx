import { zodResolver } from "@hookform/resolvers/zod"
import { useEffect, useState } from "react"
import { FormProvider, useForm, useWatch } from "react-hook-form"
import { useShallow } from "zustand/react/shallow"

import type { CliAsset, CliProvider, IpcError } from "@/bindings"
import { ProviderMark } from "@/components/app/ProviderMark"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "@/components/ui/toast"
import { useAgentOptions } from "@/features/agents/agentKeys"
import { loginCommand } from "@/lib/cliProviders"
import { copy, ipcErrorText } from "@/lib/copy"
import { deliveryOutcome, deliveryProblemsText } from "@/lib/deliveryFeedback"
import { toIpcError } from "@/lib/ipc"
import { cliEnvStatus, useAssetStore } from "@/stores/assets"
import { emptyDetection, useCliStore } from "@/stores/cli"
import { useTargetStore } from "@/stores/targets"
import { useUIStore } from "@/stores/ui"
import { currentDeliverySnapshot, serverActions, toastError } from "./actions"
import { CliEnvList, RecheckButton } from "./CliParts"
import { CloudScopeFields, CloudSnapshotNote } from "./CloudScopeParts"
import { cloudScopeSchema, type CloudScopeDraft } from "./cloudScopeForm"
import { CreateHeader } from "./CreateParts"
import { DetailGroup } from "./DetailParts"
import { NewGithubForm } from "./NewGithubForm"

/**
 * 添加云平台 CLI（F-104，2026-11-21 对齐 GitHub 动态范围）：
 * 只检测已启用 Agent 所在的运行环境，未安装或未登录时一键安装并登录；
 * 至少一个环境就绪后选择账号，默认「自动跟随」该账号当前及未来全部资源（含其他云产品），
 * 后台非阻塞拉取已知资源列表供查看与排除，拉取失败不阻塞「保存并启用」。
 */
export function NewCliForm({ provider }: { provider: CliProvider }) {
  return provider === "github" ? <NewGithubForm /> : <StandardCliForm provider={provider} />
}

function StandardCliForm({ provider }: { provider: CliProvider }) {
  const form = useForm<CloudScopeDraft>({
    resolver: zodResolver(cloudScopeSchema),
    defaultValues: { mode: "auto", selectedIds: [], excludedIds: [] },
  })
  const draft = useWatch({ control: form.control }) as CloudScopeDraft
  const detection = useCliStore((s) => s.byProvider[provider]) ?? emptyDetection
  const setup = useCliStore((s) => s.setups[provider])
  const { agents } = useAgentOptions()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<IpcError | null>(null)
  const ready = Object.values(detection.envStates).some((s) => s && cliEnvStatus(s) === "ready")
  const bound = useAssetStore(
    useShallow((s) =>
      s.ids
        .map((id) => s.byId[id])
        .flatMap((a) => (a.type === "cli" && a.cliProvider === provider ? [a.account ?? ""] : []))
    )
  )
  const accounts = [
    ...new Set(
      Object.values(detection.envStates).flatMap((s) =>
        s && cliEnvStatus(s) === "ready" ? (s.accounts ?? (s.account ? [s.account] : [])) : []
      )
    ),
  ]
  const [pickedAccount, setAccount] = useState<string | null>(null)
  const account = pickedAccount ?? accounts.find((a) => !bound.includes(a)) ?? null
  const allBound = ready && accounts.length > 0 && accounts.every((a) => bound.includes(a))
  const noEnvs = !detection.detecting && Object.keys(detection.envStates).length === 0 && !detection.failed
  const scope = detection.scopeAccount === account ? (detection.scope ?? []) : []
  const scopeLoading =
    detection.scopeLoading ||
    (ready && !allBound && !!account && detection.scopeAccount === account && detection.scope === null && !detection.scopeError)
  // 自动跟随模式不依赖已知资源列表拉取成功；手动模式若带已选 ID 需要有列表支撑
  const canSave =
    !saving &&
    ready &&
    !allBound &&
    !!account &&
    (draft.mode === "auto" || !detection.scopeError || draft.selectedIds.length === 0)

  useEffect(() => {
    const detect = () => {
      void useCliStore.getState().detect(provider).catch(toastError)
    }
    detect()
    window.addEventListener("focus", detect)
    return () => {
      window.removeEventListener("focus", detect)
      useCliStore.getState().clear(provider)
    }
  }, [provider])

  useEffect(() => {
    if (ready && !allBound && account) {
      // 拉取已知资源是非阻塞的背景信息；失败由 CloudSnapshotNote 温和展示，不弹红色错误 Toast
      void useCliStore.getState().refreshScope(provider, account).catch(() => undefined)
    }
  }, [provider, account, ready, allBound])

  const selectAccount = (value: string) => {
    useCliStore.getState().clearScope(provider, value)
    form.reset({ mode: "auto", selectedIds: [], excludedIds: [] })
    setError(null)
    setAccount(value)
  }

  const refreshKnown = () => {
    if (!account) return
    void useCliStore.getState().refreshScope(provider, account).catch(() => undefined)
  }

  const save = async () => {
    if (!canSave) return
    setSaving(true)
    setError(null)
    try {
      const values = form.getValues()
      const { asset } = await useAssetStore.getState().save({
        type: "cli",
        cliProvider: provider,
        account,
        // 这家的第一个账号直接用云平台的名字，之后的带上账号区分
        name:
          bound.length === 0 || !account
            ? copy.cli.name[provider]
            : `${copy.cli.name[provider]} · ${account}`,
        production: true,
        summary: "",
        guardrails: { rules: [] },
        notes: "",
        scope,
        cloudScope: {
          mode: values.mode,
          selectedIds: values.mode === "manual" ? values.selectedIds : [],
          excludedIds: values.mode === "auto" ? values.excludedIds : [],
        },
      })
      const saved = asset as CliAsset
      // 云平台按生产对待，从确认变更开始（F-202 AC2）；同步给全部已启用的 Agent
      for (const a of agents) await useAssetStore.getState().setDistribute(saved.id, a.key, true)
      const outcome = deliveryOutcome(
        saved.id,
        agents.map((a) => a.key),
        true,
        currentDeliverySnapshot(),
        useTargetStore.getState().targets
      )
      toast.add({
        title: outcome.complete
          ? copy.create.added(saved.name, outcome.count)
          : copy.deliveryFeedback.addedPartial(saved.name, outcome.count),
        description: outcome.complete
          ? undefined
          : outcome.problems.length
            ? deliveryProblemsText(outcome.problems)
            : copy.deliveryFeedback.none,
        type: outcome.complete ? "success" : "warning",
      })
      useAssetStore.getState().flash([saved.id])
      useUIStore.getState().closeInspector({ force: true })
    } catch (e) {
      setError(toIpcError(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <FormProvider {...form}>
      <section aria-labelledby="detail-title" className="flex h-full min-h-0 flex-col">
        <CreateHeader title={copy.create.titleCli(copy.cli.name[provider])} icon={<ProviderMark provider={provider} />} />
        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-5 px-4.5 py-3.5">
            <DetailGroup
              title={copy.cli.envCheckTitle}
              action={
                <RecheckButton
                  detecting={detection.detecting}
                  onClick={() => useCliStore.getState().detect(provider).catch(toastError)}
                />
              }
            >
              {noEnvs ? (
                <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  {copy.cli.noAgentEnvs}
                  <Button
                    variant="link"
                    size="xs"
                    className="h-auto p-0"
                    onClick={() => useUIStore.getState().setView("agents")}
                  >
                    {copy.cli.goAgents}
                  </Button>
                </p>
              ) : (
                <>
                  <CliEnvList
                    provider={provider}
                    envStates={detection.envStates}
                    detecting={detection.detecting}
                    setup={setup}
                    onSetup={(envId, method) => serverActions.startCliSetup(provider, envId, method, null)}
                  />
                  <p className="text-xs text-muted-foreground">
                    {detection.error
                      ? ipcErrorText(detection.error.id, detection.error.params)
                      : detection.failed
                        ? copy.cli.detectFailed
                        : copy.cli.setupNoteIdle}
                  </p>
                </>
              )}
            </DetailGroup>
            {accounts.length > 0 && (
              <DetailGroup title={copy.cli.accountTitle[provider]}>
                <RadioGroup
                  value={account ?? ""}
                  onValueChange={(v) => selectAccount(v as string)}
                  aria-label={copy.cli.accountTitle[provider]}
                  className="gap-0 divide-y divide-line-2 rounded-[10px] border border-line"
                >
                  {accounts.map((a) => {
                    const taken = bound.includes(a)
                    const id = `account-${a}`
                    return (
                      <Field
                        key={a}
                        orientation="horizontal"
                        data-disabled={taken || undefined}
                        className="min-h-10 items-center gap-2.5 px-3 py-2"
                      >
                        <RadioGroupItem value={a} id={id} disabled={taken} />
                        <FieldLabel
                          htmlFor={id}
                          className="min-w-0 flex-1 truncate font-mono text-xs font-normal"
                        >
                          {a}
                        </FieldLabel>
                        {taken && (
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {copy.cli.accountAdded}
                          </span>
                        )}
                      </Field>
                    )
                  })}
                </RadioGroup>
                {allBound && (
                  <p className="text-xs text-muted-foreground">
                    {copy.cli.allAccountsAdded(loginCommand(provider))}
                  </p>
                )}
              </DetailGroup>
            )}
            {ready && !allBound && account && (
              <>
                <CloudSnapshotNote
                  error={detection.scopeError}
                  mode={draft.mode}
                  creating
                  loading={scopeLoading}
                  onRetry={refreshKnown}
                />
                <CloudScopeFields
                  form={form}
                  scope={scope}
                  initiallyProvided={[]}
                  loading={scopeLoading}
                  onRefresh={refreshKnown}
                  onAddAsServer={(item) =>
                    useUIStore.getState().startCreate("ssh", {
                      prefill: { host: item.address ?? "", name: item.name },
                    })
                  }
                />
              </>
            )}
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{ipcErrorText(error.id, error.params)}</AlertDescription>
              </Alert>
            )}
          </div>
        </ScrollArea>
        <Separator />
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 px-4.5 py-3">
          <span className="mr-auto min-w-0 text-xs text-muted-foreground">
            {!ready && !detection.detecting ? copy.cli.notReadyHint : copy.create.footHint}
          </span>
          <Button
            variant="ghost"
            size="sm"
            disabled={saving}
            onClick={() => useUIStore.getState().closeInspector()}
          >
            {copy.common.cancel}
          </Button>
          <Button size="sm" disabled={!canSave} onClick={() => void save()}>
            {saving && <Spinner data-icon="inline-start" aria-hidden />}
            {saving ? copy.cli.saving : copy.cli.saveEnable}
          </Button>
        </div>
      </section>
    </FormProvider>
  )
}
