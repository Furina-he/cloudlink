import { zodResolver } from "@hookform/resolvers/zod"
import { ChevronDownIcon, EllipsisIcon, FolderOpenIcon, PackageIcon, PencilIcon, RefreshCwIcon, Trash2Icon } from "lucide-react"
import { useMemo, useRef, useState } from "react"
import { FormProvider, useForm, useWatch, type Control } from "react-hook-form"
import { useHotkeys } from "react-hotkeys-hook"
import { useShallow } from "zustand/react/shallow"

import type { CliAsset } from "@/bindings"
import { PreviewSheet } from "@/components/app/PreviewSheet"
import { ProviderMark } from "@/components/app/ProviderMark"
import { CopyValue, ListGroup, PrefRow } from "@/components/app/SettingsList"
import { CONN_STATE, StateText } from "@/components/app/StateBadge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Spinner } from "@/components/ui/spinner"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { copy } from "@/lib/copy"
import { HOTKEY_OPTIONS, HOTKEYS, isModalOpen } from "@/lib/hotkeys"
import { detailFileOf } from "@/lib/paths"
import { cliFormSchema, type CliFormValues } from "@/lib/schemas"
import { cliEnvStatus, selectCanDistribute, selectCliAccount, selectCliProblem, useAssetStore } from "@/stores/assets"
import { useCliStore } from "@/stores/cli"
import { selectInclusionsByAsset, useDeliveryStore } from "@/stores/deliveries"
import { useUIStore } from "@/stores/ui"
import { serverActions, toastError } from "./actions"
import { scopeSummary, useLinkedAliases } from "./cliSummary"
import { CliEnvList, CliScopeList, RecheckButton } from "./CliParts"
import { DetailPage, DetailTitle, NotesRow, PermissionGroup, ProblemRow, RecentActivityGroup, RulesGroup, SummaryRow } from "./DetailParts"
import { ProfileDialog } from "./ProfileDialog"
import { ResourceName } from "./ResourceName"
import { cliInputOf, cliValuesOf, renameInputOf } from "./profileForm"
import { SaveErrorAlert } from "./DraftPreview"
import { CompileSummary, useInclusionProblems } from "./InspectorParts"
import { useAutoSave } from "./useAutoSave"

const FIELDS = ["production"] as const

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

/** 标题行 + 状态行：右边「重新检测」和「⋯」（刷新范围、预览 Skill、在文件夹中显示、删除） */
function CliHeader({ asset, name, production, titleRef, onEditProfile }: { asset: CliAsset; name: string; production: boolean; titleRef: React.RefObject<HTMLHeadingElement | null>; onEditProfile: () => void }) {
  const detecting = useCliStore((s) => !!s.byProvider[asset.cliProvider]?.detecting)
  // 状态行只写整体（2026-11-10，和服务器详情一致）：有一个运行环境就绪就是「已就绪」，
  // 单个环境的问题交给「Agent 权限」卡里带修复按钮的问题行；所有环境都用不了才写出第一个问题
  const anyReady = Object.values(asset.cli.envStates).some((s) => !!s && cliEnvStatus(s) === "ready")
  const problem = anyReady ? null : selectCliProblem(asset)
  const account = selectCliAccount(asset)
  const linked = useLinkedAliases(asset)
  const word = problem ? copy.cli.envProblem(copy.env.long(problem.envId), copy.cli.status[problem.status]) : copy.cli.status.ready
  const sep = <span className="text-faint" aria-hidden>·</span>

  const actions = (
    <>
      <Button variant="outline" size="sm" disabled={detecting} onClick={() => serverActions.recheckCli(asset)}>
        {detecting && <Spinner data-icon="inline-start" aria-hidden />}
        {copy.detail.recheck}
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
      alias={asset.cli.binary}
      handle={asset.handle}
      production={production}
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

/** 开放范围（F-104）：弹出对话框勾选，勾选立即生效 */
function ScopeDialog({ asset, open, onOpenChange }: { asset: CliAsset; open: boolean; onOpenChange: (open: boolean) => void }) {
  const detection = useCliStore((s) => s.byProvider[asset.cliProvider])
  const setScope = (ids: string[]) => void useAssetStore.getState().setCliScope(asset.id, ids).catch(toastError)
  const addAsServer = (item: { name: string; address?: string }) => {
    onOpenChange(false)
    useUIStore.getState().startCreate("ssh", { prefill: { host: item.address ?? "", name: item.name } })
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="grid-cols-[minmax(0,1fr)] sm:max-w-[580px]" closeLabel={copy.common.close}>
        <DialogHeader>
          <DialogTitle>{copy.detail.rows.scopeEdit}</DialogTitle>
          <DialogDescription>{copy.cli.scopeHint}</DialogDescription>
        </DialogHeader>
        <ScrollArea className="-mx-4 max-h-[60vh] min-h-0">
          <div className="px-4 pb-1">
            <CliScopeList
              provider={asset.cliProvider}
              items={asset.cli.scope}
              loading={!!detection?.scopeLoading}
              waiting={!selectCanDistribute(asset).ok}
              onChange={setScope}
              onAddAsServer={addAsServer}
            />
          </div>
        </ScrollArea>
        <DialogFooter>
          <RecheckButton detecting={!!detection?.detecting} onClick={() => serverActions.recheckCli(asset)} />
          <Button onClick={() => onOpenChange(false)}>{copy.common.done}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** 账号：当前账号、开放范围（弹出按钮） */
function AccountGroup({ asset, onScope }: { asset: CliAsset; onScope: () => void }) {
  const account = selectCliAccount(asset)
  const github = asset.cliProvider === "github"
  return (
    <ListGroup id="detail-account" title={copy.detail.groups.account}>
      <PrefRow label={copy.detail.rows.account}>
        {account ? <CopyValue value={account} label={copy.detail.rows.account} /> : <span className="text-xs text-muted-foreground">{copy.common.none}</span>}
      </PrefRow>
      <PrefRow label={copy.detail.rows.scope} hint={github ? copy.detail.rows.reposHint : copy.detail.rows.scopeHint}>
        <Button variant="secondary" size="sm" aria-haspopup="dialog" onClick={onScope}>
          {scopeSummary(asset)}
          <ChevronDownIcon data-icon="inline-end" />
        </Button>
      </PrefRow>
    </ListGroup>
  )
}

/** GitHub 的「仓库」组（F-110）：开放的仓库、默认分支、可见性 */
function ReposGroup({ asset, onScope }: { asset: CliAsset; onScope: () => void }) {
  const repos = asset.cli.scope.filter((x) => x.kind === "repo" && x.selected)
  return (
    <ListGroup
      id="detail-repos"
      title={copy.detail.groups.repos}
      count={repos.length}
      action={
        <Button variant="ghost" size="sm" onClick={onScope}>
          {copy.detail.edit}
        </Button>
      }
    >
      {repos.length === 0 ? (
        <p className="px-3.5 py-3 text-sm text-muted-foreground">{copy.detail.rows.reposEmpty}</p>
      ) : (
        repos.map((r) => (
          <PrefRow
            key={r.id}
            label={<span className="font-mono text-xs">{r.name}</span>}
            hint={[r.defaultBranch && `${copy.detail.rows.repoBranch} ${r.defaultBranch}`, r.visibility && copy.detail.rows.visibility[r.visibility]].filter(Boolean).join(" · ") || undefined}
          />
        ))
      )}
    </ListGroup>
  )
}

/**
 * 云平台和代码托管的详情视图（PRD 6.4）：全宽一页，没有 Tab。名称、环境、用途、红线、笔记编辑即保存；
 * 开放范围勾选立即生效
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
  const detection = useCliStore((s) => s.byProvider[asset.cliProvider])
  const detecting = !!detection?.detecting
  const problems = useInclusionProblems(asset)
  const can = selectCanDistribute(asset)
  const blocked = !can.ok && asset.agent.agents.length === 0
  const auto = useAutoSave({
    form,
    fields: [...FIELDS],
    save: async ({ production }) => {
      await useAssetStore.getState().update(asset.id, (latest) => ({ ...renameInputOf(latest, latest.name), production }))
    },
  })
  const [name, production] = useWatch({ control: form.control, name: ["name", "production"] })
  useHotkeys(HOTKEYS.save, () => !isModalOpen() && void auto.flush(), HOTKEY_OPTIONS)

  return (
    <FormProvider {...form}>
      <DetailPage onBlurCapture={auto.onBlurCapture}>
        <CliHeader asset={asset} name={name.trim() || asset.name} production={production} titleRef={titleRef} onEditProfile={() => setProfileOpen(true)} />
        <div className="empty:hidden">
          <CompileSummary asset={asset} dirty={form.formState.isDirty} />
        </div>
        {auto.error && <SaveErrorAlert error={auto.error} onRetry={() => void auto.flush()} />}
        <PermissionGroup
          asset={asset}
          problems={
            <>
              {blocked && <ProblemRow title={copy.distributeBlock["cli-not-ready"]} action={copy.cli.recheck} busy={detecting} onAction={() => serverActions.recheckCli(asset)} />}
              {problems.map((p) => (
                <ProblemRow key={p.key} title={p.title} reason={p.reason} action={copy.inclusionFix[p.reasonId]} onAction={() => serverActions.openCliTerminal(asset, p.envId)} />
              ))}
            </>
          }
        />
        <AccountGroup asset={asset} onScope={() => setScopeOpen(true)} />
        {asset.cliProvider === "github" && <ReposGroup asset={asset} onScope={() => setScopeOpen(true)} />}
        {/* 「重新检测」只在标题行：这里再放一个是重复的；登录后切回窗口也会自动刷新 */}
        <ListGroup id="detail-envs" title={copy.detail.groups.envs}>
          <div className="flex flex-col gap-2 px-3.5 py-3">
            <CliEnvList
              provider={asset.cliProvider}
              envStates={asset.cli.envStates}
              detecting={detecting}
              showDetail
              onOpenTerminal={(envId, command) => serverActions.openTerminal(envId, command, asset.cliProvider, asset.id)}
            />
            <p className="text-xs text-muted-foreground">{copy.cli.autoRefreshHint}</p>
          </div>
        </ListGroup>
        <ListGroup id="detail-knowledge" title={copy.detail.groups.knowledge}>
          <SummaryRow summary={asset.summary} />
          <NotesRow notes={asset.notes} />
        </ListGroup>
        <RulesGroup rules={asset.guardrails.rules} />
        <RecentActivityGroup assetId={asset.id} />
      </DetailPage>
      <ScopeDialog asset={asset} open={scopeOpen} onOpenChange={setScopeOpen} />
      {profileOpen && <ProfileDialog asset={asset} onClose={() => setProfileOpen(false)} />}
      <CliPreview asset={asset} control={form.control} dirty={form.formState.isDirty} />
    </FormProvider>
  )
}
