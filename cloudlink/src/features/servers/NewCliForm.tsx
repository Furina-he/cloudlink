import { useEffect, useState } from "react"
import { useShallow } from "zustand/react/shallow"

import type { CliAsset, CliProvider } from "@/bindings"
import { ProviderMark } from "@/components/app/ProviderMark"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "@/components/ui/toast"
import { useAgentOptions } from "@/features/agents/agentKeys"
import { copy, ipcErrorText } from "@/lib/copy"
import { deliveryOutcome, deliveryProblemsText } from "@/lib/deliveryFeedback"
import { cliEnvStatus, useAssetStore } from "@/stores/assets"
import { emptyDetection, scopeIsReady, useCliStore } from "@/stores/cli"
import { useUIStore } from "@/stores/ui"
import { useTargetStore } from "@/stores/targets"
import { loginCommand } from "@/lib/cliProviders"
import { currentDeliverySnapshot, serverActions, toastError } from "./actions"
import { CliEnvList, CliScopeList, RecheckButton } from "./CliParts"
import { CreateHeader } from "./CreateParts"
import { DetailGroup } from "./DetailParts"

/**
 * 添加云平台 CLI（PRD 6.5 分支 B）：只检测已启用 Agent 所在的运行环境，展示版本和 whoami 账号；
 * 未安装或未登录时给出单行命令和「打开终端」，切回窗口自动重新检测（F-104 AC1、AC2）。
 * 至少一个环境就绪后拉取账号下的资源，勾选公开的范围，「保存并启用」。
 * 和 SSH 表单一样不选 Agent、不选档位（2026-11-10）：从只读巡检开始，同步给全部已启用的 Agent。
 * 同一家可以接多个账号：登录能看到几个账号（Cloudflare Account、Vercel Team、OCI Profile）就列几个，已接入的标「已添加」
 */
export function NewCliForm({ provider }: { provider: CliProvider }) {
  const detection = useCliStore((s) => s.byProvider[provider]) ?? emptyDetection
  const { agents } = useAgentOptions()
  const [saving, setSaving] = useState(false)
  const ready = Object.values(detection.envStates).some(
    (s) => s && cliEnvStatus(s) === "ready"
  )
  const bound = useAssetStore(
    useShallow((s) =>
      s.ids
        .map((id) => s.byId[id])
        .flatMap((a) =>
          a.type === "cli" && a.cliProvider === provider
            ? [a.account ?? ""]
            : []
        )
    )
  )
  const accounts = [
    ...new Set(
      Object.values(detection.envStates).flatMap((s) =>
        s && cliEnvStatus(s) === "ready"
          ? (s.accounts ?? (s.account ? [s.account] : []))
          : []
      )
    ),
  ]
  const [pickedAccount, setAccount] = useState<string | null>(null)
  const account =
    pickedAccount ?? accounts.find((a) => !bound.includes(a)) ?? null
  const allBound =
    ready && accounts.length > 0 && accounts.every((a) => bound.includes(a))
  const noEnvs =
    !detection.detecting &&
    Object.keys(detection.envStates).length === 0 &&
    !detection.failed
  const scope = detection.scopeAccount === account ? detection.scope : null
  const scopeReady = scopeIsReady(detection, account)
  const scopeLoading =
    detection.scopeLoading ||
    (ready && !allBound && !scope && !detection.scopeError)

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
    if (ready && !allBound)
      useCliStore
        .getState()
        .refreshScope(provider, account ?? undefined)
        .catch(toastError)
  }, [provider, account, ready, allBound])

  const selectAccount = (value: string) => {
    useCliStore.getState().clearScope(provider, value)
    setAccount(value)
  }

  const save = async () => {
    if (saving || !ready || allBound || !scopeReady) return
    setSaving(true)
    try {
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
        scope: scope ?? [],
      })
      const saved = asset as CliAsset
      // 云平台按生产对待，从只读巡检开始（F-202 AC2）；同步给全部已启用的 Agent
      for (const a of agents)
        await useAssetStore.getState().setDistribute(saved.id, a.key, true)
      const outcome = deliveryOutcome(saved.id, agents.map((a) => a.key), true, currentDeliverySnapshot(), useTargetStore.getState().targets)
      toast.add({
        title: outcome.complete ? copy.create.added(saved.name, outcome.count) : copy.deliveryFeedback.addedPartial(saved.name, outcome.count),
        description: outcome.complete ? undefined : outcome.problems.length ? deliveryProblemsText(outcome.problems) : copy.deliveryFeedback.none,
        type: outcome.complete ? "success" : "warning",
      })
      useAssetStore.getState().flash([saved.id])
      // 完成后关闭弹窗回到主列表（PRD 6.5）
      useUIStore.getState().closeInspector({ force: true })
    } catch (e) {
      toastError(e)
    } finally {
      setSaving(false)
    }
  }

  const setScope = (ids: string[]) =>
    useCliStore.getState().setDraftScope(
      provider,
      (scope ?? []).map((x) => ({ ...x, selected: ids.includes(x.id) }))
    )

  return (
    <section
      aria-labelledby="detail-title"
      className="flex h-full min-h-0 flex-col"
    >
      <CreateHeader
        title={copy.create.titleCli(copy.cli.name[provider])}
        icon={<ProviderMark provider={provider} />}
      />
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-6 p-3 pb-6">
          <p className="text-xs text-muted-foreground">
            {copy.cli.blurb[provider]}
          </p>
          <DetailGroup
            title={copy.cli.envCheckTitle}
            action={
              <RecheckButton
                detecting={detection.detecting}
                onClick={() =>
                  useCliStore.getState().detect(provider).catch(toastError)
                }
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
                  onOpenTerminal={(envId, command) =>
                    serverActions.openTerminal(envId, command, provider, null)
                  }
                />
                <p className="text-xs text-muted-foreground">
                  {detection.failed
                    ? copy.cli.detectFailed
                    : copy.cli.autoRefreshHint}
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
                className="gap-0 divide-y rounded-lg border"
              >
                {accounts.map((a) => {
                  const taken = bound.includes(a)
                  const id = `account-${a}`
                  return (
                    <Field
                      key={a}
                      orientation="horizontal"
                      data-disabled={taken || undefined}
                      className="min-h-9 items-center gap-2.5 px-2.5 py-1.5"
                    >
                      <RadioGroupItem value={a} id={id} disabled={taken} />
                      <FieldLabel
                        htmlFor={id}
                        className="min-w-0 flex-1 truncate font-mono text-[0.8125rem] font-normal"
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
          <DetailGroup title={copy.cli.scopeTitle}>
            {detection.scopeError ? (
              <Alert variant="destructive">
                <AlertDescription className="flex flex-col gap-2">
                  {ipcErrorText(
                    detection.scopeError.id,
                    detection.scopeError.params
                  )}
                  <RecheckButton
                    detecting={detection.scopeLoading}
                    onClick={() =>
                      useCliStore
                        .getState()
                        .refreshScope(provider, account ?? undefined)
                        .catch(toastError)
                    }
                  />
                </AlertDescription>
              </Alert>
            ) : (
              <CliScopeList
                provider={provider}
                items={scope}
                loading={scopeLoading}
                waiting={!ready}
                allBound={allBound}
                onChange={setScope}
                onAddAsServer={(item) =>
                  useUIStore
                    .getState()
                    .startCreate("ssh", {
                      prefill: { host: item.address ?? "", name: item.name },
                    })
                }
              />
            )}
          </DetailGroup>
        </div>
      </ScrollArea>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t px-3 py-2.5">
        <span className="mr-auto min-w-0 text-xs text-muted-foreground">
          {!ready && !detection.detecting ? copy.cli.notReadyHint : copy.create.footHint}
        </span>
        <>
          <Button
            variant="ghost"
            size="sm"
            disabled={saving}
            onClick={() => useUIStore.getState().closeInspector()}
          >
            {copy.common.cancel}
          </Button>
          <Button
            size="sm"
            disabled={saving || !ready || allBound || !scopeReady}
            onClick={() => void save()}
          >
            {saving && <Spinner data-icon="inline-start" aria-hidden />}
            {saving ? copy.cli.saving : copy.cli.saveEnable}
          </Button>
        </>
      </div>
    </section>
  )
}
