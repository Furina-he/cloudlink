import { zodResolver } from "@hookform/resolvers/zod"
import { EllipsisIcon, FolderOpenIcon, PackageIcon, PencilIcon, RefreshCwIcon, Trash2Icon } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { FormProvider, useForm, useWatch, type Control } from "react-hook-form"
import { useShallow } from "zustand/react/shallow"

import type { CliAsset } from "@/bindings"
import { PreviewSheet } from "@/components/app/PreviewSheet"
import { ProviderMark } from "@/components/app/ProviderMark"
import { ListGroup } from "@/components/app/SettingsList"
import { CONN_STATE, StateText } from "@/components/app/StateBadge"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Spinner } from "@/components/ui/spinner"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { copy } from "@/lib/copy"
import { detailFileOf } from "@/lib/paths"
import { cliFormSchema, type CliFormValues } from "@/lib/schemas"
import { cliEnvStatus, selectCanDistribute, selectCliAccount, selectCliProblem } from "@/stores/assets"
import { useCliStore } from "@/stores/cli"
import { emptyGithubScope, useGithubStore } from "@/stores/github"
import { selectInclusionsByAsset, useDeliveryStore } from "@/stores/deliveries"
import { useUIStore } from "@/stores/ui"
import { serverActions } from "./actions"
import { useLinkedAliases } from "./cliSummary"
import { CliEnvList } from "./CliParts"
import { CloudAccountGroup, CloudResourcesGroup, CloudSnapshotNote } from "./CloudScopeParts"
import { CloudScopeDialog } from "./CloudScopeDialog"
import { GithubAccountGroup, GithubReposGroup, GithubSnapshotNote } from "./GithubParts"
import { GithubScopeDialog } from "./GithubScopeDialog"
import { DetailPage, DetailTitle, NotesRow, PermissionGroup, ProblemRow, RecentActivityGroup, RulesGroup, SummaryRow } from "./DetailParts"
import { ProfileDialog } from "./ProfileDialog"
import { ResourceName } from "./ResourceName"
import { cliInputOf, cliValuesOf } from "./profileForm"
import { CompileSummary, useInclusionProblems } from "./InspectorParts"

/** 这项云平台的预览（F-204）：展示整份总 Skill 目录树，默认定位到它的详情文件 */
function CliPreview({ asset, control, dirty }: { asset: CliAsset; control: Control<CliFormValues>; dirty: boolean }) {
  const values = useWatch({ control }) as CliFormValues
  const inclusions = useDeliveryStore(useShallow((s) => selectInclusionsByAsset(s.inclusions, asset.id)))
  const own = detailFileOf(asset.handle)
  return (
    <PreviewSheet
      scope={asset.id}
      draft={{ asset: cliInputOf(values, asset) }}
      dirty={dirty}
      defaultFile={own}
      note={(target) => {
        const inc = inclusions.find((i) => i.envId === target.envId && i.agentKey === target.agentKey)
        if (inc?.included) return null
        const reason = inc?.reason ? copy.inclusionReason[inc.reason.id](inc.reason.params) : copy.inclusionReason["agent-off"](undefined)
        return copy.preview.notIncluded(asset.name, target.label, reason)
      }}
    />
  )
}

/** 标题行 + 状态行：右边「重新检测」和「⋯」（刷新范围、预览 Skill、在文件夹中显示、删除） */
function CliHeader({ asset, name, titleRef, onEditProfile, onRefresh, onRefreshScope }: { asset: CliAsset; name: string; titleRef: React.RefObject<HTMLHeadingElement | null>; onEditProfile: () => void; onRefresh: () => void; onRefreshScope: () => void }) {
  const cliDetecting = useCliStore((s) => !!s.byProvider[asset.cliProvider]?.detecting)
  const githubDetecting = useGithubStore((s) => !!s.byKey[asset.id]?.loading)
  const detecting = asset.cliProvider === "github" ? githubDetecting : cliDetecting
  // 状态行只写整体（2026-11-10，和服务器详情一致）：有一个运行环境就绪就是「已就绪」，
  // 单个环境的问题交给「Agent 权限」卡里带修复按钮的问题行；所有环境都用不了才写出第一个问题
  const anyReady = Object.values(asset.cli.envStates).some((s) => !!s && cliEnvStatus(s) === "ready")
  const problem = anyReady ? null : selectCliProblem(asset)
  const identity = [...new Set(Object.values(asset.cli.envStates).flatMap((state) => state && cliEnvStatus(state) === "ready" && state.account ? [state.account] : []))].join("、")
  const account = asset.cliProvider === "github" ? identity : selectCliAccount(asset)
  const linked = useLinkedAliases(asset)
  const word = problem ? copy.cli.envProblem(copy.env.long(problem.envId), copy.cli.status[problem.status]) : asset.cliProvider === "github" ? copy.github.loginValid : copy.cli.status.ready
  const sep = <span className="text-faint" aria-hidden>·</span>

  const actions = (
    <>
      <Button variant="outline" size="sm" disabled={detecting} onClick={onRefresh}>
        {detecting && <Spinner data-icon="inline-start" aria-hidden />}
        {asset.cliProvider === "github" ? copy.github.recheck : copy.detail.recheck}
      </Button>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger render={<DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={copy.common.more} data-detail-more />} />}>
            <EllipsisIcon />
          </TooltipTrigger>
          <TooltipContent>{copy.common.more}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end" className="w-auto min-w-48">
          <DropdownMenuGroup><DropdownMenuItem onClick={onEditProfile}><PencilIcon />{copy.detail.editProfile}</DropdownMenuItem></DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
          {asset.cliProvider !== "github" && <DropdownMenuItem disabled={detecting} onClick={onRefreshScope}>
            <RefreshCwIcon />
            {copy.cli.refreshScope}
          </DropdownMenuItem>}
          <DropdownMenuItem onClick={() => useUIStore.getState().openPreview({ file: detailFileOf(asset.handle) })}>
            <PackageIcon />
            {copy.detail.preview}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => serverActions.revealCompiled(asset)}>
            <FolderOpenIcon />
            {copy.detail.revealCompiled}
          </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup><DropdownMenuItem variant="destructive" onClick={() => serverActions.requestDelete(asset)}>
            <Trash2Icon />
            {copy.cli.delete}
          </DropdownMenuItem></DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  )

  return (
    <DetailTitle
      mark={<ProviderMark provider={asset.cliProvider} className="size-5" />}
      name={name}
      nameControl={<ResourceName asset={asset} />}
      handle={asset.handle}
      titleRef={titleRef}
      actions={actions}
      status={
        detecting ? (
          <span className="flex items-center gap-1">
            <Spinner className="size-3.5" aria-hidden />
            {copy.cli.checking}
          </span>
        ) : (
          <>
            <StateText tone={problem ? "warning" : "success"} icon={problem ? CONN_STATE.changed.icon : CONN_STATE.connected.icon}>
              {word}
            </StateText>
            {account && (
              <>
                {sep}
                <span>{account}</span>
              </>
            )}
            {linked.length > 0 && (
              <>
                {sep}
                <span>{copy.servers.linkedTo(linked.join("、"))}</span>
              </>
            )}
          </>
        )
      }
    />
  )
}

/**
 * 云平台和代码托管的详情视图（PRD 6.4）：全宽一页，没有 Tab。名称、环境、用途、红线、笔记编辑即保存；
 * 范围统一为「自动跟随 / 手动选择」动态模型，点击「管理范围」在弹窗中修改
 */
export function CliDetail({ asset }: { asset: CliAsset }) {
  const values = useMemo(() => cliValuesOf(asset), [asset])
  const form = useForm<CliFormValues>({
    resolver: zodResolver(cliFormSchema),
    values,
    resetOptions: { keepDirtyValues: true },
    mode: "onBlur",
  })
  const titleRef = useRef<HTMLHeadingElement>(null)
  const [scopeOpen, setScopeOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const pendingProfile = useUIStore((s) => s.pendingEdit?.assetId === asset.id && s.pendingEdit.kind === "profile")
  const closeProfile = () => {
    setProfileOpen(false)
    useUIStore.getState().consumePendingEdit(asset.id)
  }
  const detection = useCliStore((s) => s.byProvider[asset.cliProvider])
  const github = useGithubStore((s) => s.byKey[asset.id]) ?? emptyGithubScope
  const setup = useCliStore((s) => s.setups[asset.cliProvider])
  const detecting = asset.cliProvider === "github" ? github.loading : !!detection?.detecting
  const scopeLoading = asset.cliProvider === "github" ? github.loading : !!detection?.scopeLoading || !!detection?.detecting
  const scopeError = detection?.scopeAccount === (asset.account ?? null) ? detection?.scopeError : null
  const refresh = () => {
    if (asset.cliProvider === "github") {
      void useGithubStore.getState().load({ assetId: asset.id, force: true })
    } else serverActions.recheckCli(asset)
  }
  const refreshScopeOnly = () => {
    void useCliStore.getState().refreshScope(asset.cliProvider, asset.account ?? undefined, asset.id).catch(() => undefined)
  }
  useEffect(() => {
    if (asset.cliProvider === "github") void useGithubStore.getState().load({ assetId: asset.id })
  }, [asset.id, asset.cliProvider])
  const problems = useInclusionProblems(asset)
  const can = selectCanDistribute(asset)
  const blocked = !can.ok && asset.agent.agents.length === 0

  return (
    <FormProvider {...form}>
      <DetailPage>
        <CliHeader asset={asset} name={asset.name} titleRef={titleRef} onEditProfile={() => setProfileOpen(true)} onRefresh={refresh} onRefreshScope={refreshScopeOnly} />
        <div className="empty:hidden">
          <CompileSummary asset={asset} dirty={form.formState.isDirty} />
        </div>
        <PermissionGroup
          asset={asset}
          problems={
            <>
              {blocked && !can.ok && <ProblemRow title={copy.distributeBlock[can.reason]} action={can.reason === "github-scope-unverified" ? undefined : copy.cli.recheck} busy={detecting} onAction={refresh} />}
              {problems.map((p) => (
                <ProblemRow key={p.key} title={p.title} reason={p.reason} action={p.reasonId === "github-scope-unverified" ? undefined : copy.inclusionFix[p.reasonId]} onAction={() => serverActions.openCliTerminal(asset, p.envId)} />
              ))}
            </>
          }
        />
        {asset.cliProvider === "github" ? <>
          <GithubAccountGroup asset={asset} onScope={() => setScopeOpen(true)} />
          <GithubSnapshotNote config={asset.github} error={github.error} loading={github.loading} />
          <GithubReposGroup asset={asset} />
        </> : <>
          <CloudAccountGroup asset={asset} onScope={() => setScopeOpen(true)} />
          <CloudSnapshotNote config={asset.cloudScope} error={scopeError} loading={scopeLoading} onRetry={refreshScopeOnly} />
          <CloudResourcesGroup asset={asset} loading={scopeLoading} onRefresh={refreshScopeOnly} />
        </>}
        {/* 「重新检测」只在标题行：这里再放一个是重复的；一键安装登录由后端轮询并自动刷新 */}
        <ListGroup id="detail-envs" title={copy.detail.groups.envs}>
          <div className="flex flex-col gap-2 px-3.5 py-3">
            <CliEnvList
              provider={asset.cliProvider}
              envStates={asset.cli.envStates}
              detecting={detecting}
              showDetail
              setup={setup}
              onSetup={(envId, method) => serverActions.startCliSetup(asset.cliProvider, envId, method, asset.id)}
            />
            <p className="text-xs text-muted-foreground">{copy.cli.setupNoteIdle}</p>
          </div>
        </ListGroup>
        <ListGroup id="detail-knowledge" title={copy.detail.groups.knowledge}>
          <SummaryRow summary={asset.summary} />
          <NotesRow notes={asset.notes} />
        </ListGroup>
        <RulesGroup rules={asset.guardrails.rules} />
        <RecentActivityGroup assetId={asset.id} />
      </DetailPage>
      {asset.cliProvider === "github" ? scopeOpen && <GithubScopeDialog asset={asset} onClose={() => setScopeOpen(false)} /> : scopeOpen && <CloudScopeDialog asset={asset} onClose={() => setScopeOpen(false)} />}
      {(profileOpen || pendingProfile) && <ProfileDialog asset={asset} onClose={closeProfile} />}
      <CliPreview asset={asset} control={form.control} dirty={form.formState.isDirty} />
    </FormProvider>
  )
}
