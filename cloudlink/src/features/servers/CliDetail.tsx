import { zodResolver } from "@hookform/resolvers/zod"
import { EllipsisIcon, FolderOpenIcon, PackageIcon, RefreshCwIcon, Trash2Icon } from "lucide-react"
import { useEffect, useMemo, useRef, useState, type RefObject } from "react"
import { FormProvider, useForm, useWatch, type Control } from "react-hook-form"
import { useHotkeys } from "react-hotkeys-hook"
import { useShallow } from "zustand/react/shallow"

import type { CliAsset, CliAssetInput, IpcError } from "@/bindings"
import { EnvBadge } from "@/components/app/EnvBadge"
import { PreviewSheet } from "@/components/app/PreviewSheet"
import { ProviderMark } from "@/components/app/ProviderMark"
import { CONN_STATE, StateText } from "@/components/app/StateBadge"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { FieldGroup } from "@/components/ui/field"
import { Spinner } from "@/components/ui/spinner"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { copy } from "@/lib/copy"
import { HOTKEY_OPTIONS, HOTKEYS, isModalOpen } from "@/lib/hotkeys"
import { detailFileOf } from "@/lib/paths"
import { cliFormSchema, type CliFormValues } from "@/lib/schemas"
import { selectCanDistribute, selectCliAccount, selectCliProblem, useAssetStore } from "@/stores/assets"
import { useCliStore } from "@/stores/cli"
import { selectInclusionsByAsset, useDeliveryStore } from "@/stores/deliveries"
import { useOperationStore } from "@/stores/operations"
import { useUIStore } from "@/stores/ui"
import { serverActions, toastError } from "./actions"
import { scopeSummary, useLinkedAliases } from "./BreakerRow"
import { CliEnvList, CliScopeList, RecheckButton } from "./CliParts"
import { SaveErrorAlert } from "./DraftPreview"
import { BackButton, CompileSummary, ControlRows, Notice, useInclusionProblems } from "./InspectorParts"
import { LeaveDialog, useLeaveGuard } from "./LeaveDialog"
import { SaveBar } from "./SaveBar"
import { EnvTagField, NameField, SummaryField } from "./sections/BasicSection"
import { GuardrailsSection } from "./sections/GuardrailsSection"
import { NotesSection } from "./sections/NotesSection"
import { OperationsSection } from "./sections/OperationsSection"
import { DetailGroup, DetailTabs } from "./ServerDetail"

const valuesOf = (a: CliAsset): CliFormValues => ({ name: a.name, envTag: a.envTag, summary: a.summary, rules: a.guardrails.rules, notes: a.notes })

export const cliInputOf = (v: CliFormValues, a: Pick<CliAsset, "id" | "cliProvider" | "account">): CliAssetInput => ({
  id: a.id,
  type: "cli",
  cliProvider: a.cliProvider,
  account: a.account,
  name: v.name.trim(),
  envTag: v.envTag,
  summary: v.summary,
  guardrails: { rules: v.rules },
  notes: v.notes,
})

/** 这项云平台的预览（F-204）：当前草稿的编译结果，默认定位到它的详情文件 */
function CliPreview({ asset, control, dirty }: { asset: CliAsset; control: Control<CliFormValues>; dirty: boolean }) {
  const values = useWatch({ control }) as CliFormValues
  const inclusions = useDeliveryStore(useShallow((s) => selectInclusionsByAsset(s.inclusions, asset.id)))
  const own = detailFileOf(asset.handle)
  return (
    <PreviewSheet
      scope={asset.id}
      draft={{ asset: cliInputOf(values, asset) }}
      dirty={dirty}
      fileFilter={(path) => path === "SKILL.md" || path === "references/health-check.md" || path === own}
      defaultFile={own}
      note={(target) => {
        const inc = inclusions.find((i) => i.envId === target.envId && i.agentKey === target.agentKey)
        if (inc?.included) return null
        const reason = inc?.reason ? copy.inclusionReason[inc.reason.id](inc.reason.params) : copy.inclusionReason["agent-off"](undefined)
        return copy.preview.notIncluded(asset.cliProvider, target.label, reason)
      }}
    />
  )
}

/** 控制头（PRD 6.4）：返回、官方 Logo、名称、环境；CLI 状态、账号、已选范围；档位与授权；「⋯」里是低频操作 */
function CliHeader({ asset, dirty, titleRef }: { asset: CliAsset; dirty: boolean; titleRef: RefObject<HTMLHeadingElement | null> }) {
  const detecting = useCliStore((s) => !!s.byProvider[asset.cliProvider]?.detecting)
  const problems = useInclusionProblems(asset)
  const problem = selectCliProblem(asset)
  const account = selectCliAccount(asset)
  const linked = useLinkedAliases(asset)
  const can = selectCanDistribute(asset)
  const blocked = !can.ok && asset.agent.agents.length === 0
  const word = problem ? copy.cli.envProblem(copy.env.long(problem.envId), copy.cli.status[problem.status]) : copy.cli.status.ready

  const more = (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger render={<DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={copy.common.more} />} />}>
          <EllipsisIcon />
        </TooltipTrigger>
        <TooltipContent>{copy.common.more}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-auto min-w-48">
        <DropdownMenuItem disabled={detecting} onClick={() => serverActions.recheckCli(asset)}>
          <RefreshCwIcon />
          {copy.cli.recheck}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={detecting} onClick={() => serverActions.recheckCli(asset)}>
          <RefreshCwIcon />
          {copy.cli.refreshScope}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => useUIStore.getState().openPreview({ file: detailFileOf(asset.handle) })}>
          <PackageIcon />
          {copy.detail.preview}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => serverActions.revealCompiled(asset)}>
          <FolderOpenIcon />
          {copy.detail.revealCompiled}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={() => serverActions.requestDelete(asset)}>
          <Trash2Icon />
          {copy.cli.delete}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )

  return (
    <header className="flex shrink-0 flex-col border-b px-4 py-2.5">
      <div className="flex min-w-0 items-center gap-2">
        <BackButton />
        <ProviderMark provider={asset.cliProvider} />
        <h2 id="detail-title" ref={titleRef} tabIndex={-1} className="min-w-0 truncate text-base font-semibold outline-none">
          {asset.name}
        </h2>
        <span className="shrink-0 font-mono text-sm text-muted-foreground">{asset.cli.binary}</span>
        <EnvBadge env={asset.envTag} className="ml-auto shrink-0" />
      </div>
      <div className="mt-1 flex min-h-5 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground" aria-live="polite">
        {detecting ? (
          <span className="flex items-center gap-1">
            <Spinner className="size-3.5" aria-hidden />
            {copy.cli.checking}
          </span>
        ) : (
          <StateText tone={problem ? "warning" : "success"} icon={problem ? CONN_STATE.changed.icon : CONN_STATE.connected.icon}>
            {word}
          </StateText>
        )}
        {account && <span>{account}</span>}
        <span>{scopeSummary(asset)}</span>
        {linked.length > 0 && <span>{copy.servers.linkedTo(linked.join("、"))}</span>}
      </div>
      <ControlRows asset={asset} more={more} />
      {(blocked || problems.length > 0) && (
        <div className="mt-2 flex flex-col gap-1.5">
          {blocked && (
            <Notice action={copy.cli.recheck} busy={detecting} onAction={() => serverActions.recheckCli(asset)}>
              {copy.distributeBlock["cli-not-ready"]}
            </Notice>
          )}
          {problems.map((p) => (
            <Notice key={p.key} action={copy.inclusionFix[p.reasonId]} onAction={() => serverActions.openCliTerminal(asset, p.envId)}>
              {p.text}
            </Notice>
          ))}
        </div>
      )}
      <div className="mt-1.5 empty:hidden">
        <CompileSummary asset={asset} dirty={dirty} />
      </div>
    </header>
  )
}

/**
 * 云平台的详情视图（PRD 6.4）：画像与规则（范围勾选立即生效、用途、红线）、连接配置（各运行环境的 CLI 状态）、
 * 动态（笔记与操作记录）。名称、环境、用途、红线、笔记是表单，有修改时出现保存条
 */
export function CliDetail({ asset }: { asset: CliAsset }) {
  const values = useMemo(() => valuesOf(asset), [asset])
  const form = useForm<CliFormValues>({
    resolver: zodResolver(cliFormSchema),
    values,
    resetOptions: { keepDirtyValues: true },
    mode: "onBlur",
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<IpcError | null>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  // 从列表进入详情：焦点移到标题，读屏和键盘都从这里开始
  useEffect(() => titleRef.current?.focus({ preventScroll: true }), [])
  const detection = useCliStore((s) => s.byProvider[asset.cliProvider])
  const detecting = !!detection?.detecting
  const dirty = form.formState.isDirty

  const discard = () => {
    form.reset(undefined, { keepDirtyValues: false })
    setError(null)
  }
  const guard = useLeaveGuard(dirty, discard)

  const save = () =>
    void form.handleSubmit(
      async (v) => {
        setSaving(true)
        setError(null)
        try {
          const { asset: saved } = await useAssetStore.getState().save(cliInputOf(v, asset))
          form.reset(valuesOf(saved as CliAsset), { keepDirtyValues: false })
        } catch (e) {
          setError(e as IpcError)
        } finally {
          setSaving(false)
        }
      },
      () => useUIStore.getState().setDetailTab(form.formState.errors.name ? "connection" : "profile")
    )()

  useEffect(() => {
    void useOperationStore.getState().load(asset.id)
  }, [asset.id])
  useHotkeys(HOTKEYS.save, () => !isModalOpen() && save(), HOTKEY_OPTIONS)

  const setScope = (ids: string[]) => useAssetStore.getState().setCliScope(asset.id, ids).catch(toastError)
  const addAsServer = (item: { name: string; address?: string }) =>
    useUIStore.getState().startCreate("ssh", { prefill: { host: item.address ?? "", name: item.name } })

  return (
    <FormProvider {...form}>
      <section aria-labelledby="detail-title" className="flex h-full min-h-0 flex-col">
        <CliHeader asset={asset} dirty={dirty} titleRef={titleRef} />
        {error && (
          <div className="px-3 pt-3">
            <SaveErrorAlert error={error} onRetry={save} />
          </div>
        )}
        <DetailTabs assetId={asset.id}>
          {{
            profile: (
              <>
                <DetailGroup title={copy.cli.scopeTitle} action={<RecheckButton detecting={detecting} onClick={() => serverActions.recheckCli(asset)} />}>
                  <p className="text-xs text-muted-foreground">{copy.cli.scopeHint}</p>
                  <CliScopeList
                    provider={asset.cliProvider}
                    items={asset.cli.scope}
                    loading={!!detection?.scopeLoading}
                    waiting={!selectCanDistribute(asset).ok}
                    onChange={(ids) => void setScope(ids)}
                    onAddAsServer={addAsServer}
                  />
                </DetailGroup>
                <SummaryField />
                <DetailGroup title={copy.detail.groups.guardrails}>
                  <GuardrailsSection />
                </DetailGroup>
              </>
            ),
            connection: (
              <>
                <FieldGroup className="gap-4">
                  <NameField />
                  <EnvTagField />
                </FieldGroup>
                <DetailGroup title={copy.cli.envCheckTitle} action={<RecheckButton detecting={detecting} onClick={() => serverActions.recheckCli(asset)} />}>
                  <CliEnvList
                    provider={asset.cliProvider}
                    envStates={asset.cli.envStates}
                    detecting={detecting}
                    showDetail
                    onOpenTerminal={(envId, command) => serverActions.openTerminal(envId, command, asset.cliProvider, asset.id)}
                  />
                  <p className="text-xs text-muted-foreground">{copy.cli.autoRefreshHint}</p>
                </DetailGroup>
              </>
            ),
            activity: (
              <>
                <DetailGroup title={copy.detail.groups.notes}>
                  <NotesSection assetId={asset.id} />
                </DetailGroup>
                <DetailGroup title={copy.detail.groups.operations}>
                  <OperationsSection assetId={asset.id} />
                </DetailGroup>
              </>
            ),
          }}
        </DetailTabs>
        {dirty && <SaveBar saving={saving} onDiscard={discard} onSave={save} />}
        <LeaveDialog guard={guard} />
        <CliPreview asset={asset} control={form.control} dirty={dirty} />
      </section>
    </FormProvider>
  )
}
