// 服务器详情的标题行、状态行和问题行（PRD 6.4）
import { CopyIcon, EllipsisIcon, FolderOpenIcon, PackageIcon, RadarIcon, RefreshCwIcon, ServerIcon, Trash2Icon } from "lucide-react"
import type { RefObject } from "react"

import type { ServerAsset } from "@/bindings"
import { CONN_STATE, StateText, TONE_TEXT, PROBE_STATE } from "@/components/app/StateBadge"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "@/components/ui/toast"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useMinuteTick } from "@/hooks/use-minute-tick"
import { copy } from "@/lib/copy"
import { formatRelative } from "@/lib/format"
import { detailFileOf } from "@/lib/paths"
import { cn } from "@/lib/utils"
import { connState, selectCanDistribute } from "@/stores/assets"
import { isProbing, useProbeStore } from "@/stores/probe"
import { useTargetStore } from "@/stores/targets"
import { useUIStore } from "@/stores/ui"
import { serverActions, toastError, useConverting } from "./actions"
import type { ConnTest } from "./ConnectionTest"
import { DetailTitle, ProblemRow } from "./DetailParts"
import { useInclusionProblems } from "./InspectorParts"

/** 系统摘要：「Ubuntu 24.04 · 2C/2G」 */
function factsSummary(f: ServerAsset["facts"]): string[] {
  const size = [f.cpuCores ? copy.detail.cores(f.cpuCores) : "", f.memoryTotalMiB ? copy.detail.memory(Math.round(f.memoryTotalMiB / 1024)) : ""].filter(Boolean)
  return [f.os ?? "", size.join("/")].filter(Boolean)
}

function probeText(asset: ServerAsset, probing: boolean, now: number): string {
  if (probing) return copy.probing
  const { status, lastSuccessAt } = asset.probe
  if (status === "never") return copy.detail.neverProbed
  if (status === "failed") return copy.detail.probeFailed
  if (!lastSuccessAt) return copy.probeState[status]
  return (status === "stale" ? copy.detail.staleAt : copy.detail.probedAt)(formatRelative(lastSuccessAt, now))
}

/** 打开连接编辑并定位到某个字段 */
export type EditConnection = () => void

/**
 * Agent 权限卡里的问题行（「正常即隐身」，PRD 6.4、F-303 AC2）：不能分发、连接改过、某个运行环境用不了。
 * 没有问题时什么都不出现
 */
export function ServerProblems({ asset, onTest, onConvert, onEdit }: { asset: ServerAsset; onTest: () => void; onConvert: () => void; onEdit: EditConnection }) {
  const problems = useInclusionProblems(asset)
  const converting = useConverting((s) => s.ids.includes(asset.id))
  const can = selectCanDistribute(asset)
  const state = connState(asset)
  // 依赖 ssh-agent 的服务器，Windows 上的 Claude Code 读不到 Windows 服务里的密钥（8.3）
  const agentKey = asset.connection.auth?.method === "agent" && asset.agent.agents.includes("claude-code") && asset.connection.definedIn.includes("windows")

  const fixOf = (p: (typeof problems)[number]) => {
    if (p.reasonId === "password-only") return { label: copy.inclusionFix["password-only"], run: onConvert }
    if (p.reasonId === "not-written" || p.reasonId === "no-key-in-env") return { label: copy.inclusionFix[p.reasonId], run: onEdit }
    if (p.reasonId === "include-missing") {
      return {
        label: copy.inclusionFix["include-missing"],
        run: () =>
          void useTargetStore
            .getState()
            .addSshInclude(p.envId)
            .then(() => toast.add({ title: copy.include.added(copy.env.long(p.envId)), type: "success" }))
            .catch(toastError),
      }
    }
    return null
  }

  const blocked = !can.ok && asset.agent.agents.length === 0
  const passwordOnly = !can.ok && can.reason === "password-only"
  const shown = problems.filter((p) => p.reasonId !== "password-only" || !blocked)

  return (
    <>
      {blocked && (
        <ProblemRow
          title={copy.distributeBlock[can.reason]}
          action={passwordOnly ? copy.test.convertKey : copy.test.button}
          busy={converting}
          onAction={passwordOnly ? onConvert : onTest}
        />
      )}
      {state === "changed" && <ProblemRow title={copy.connChangedHint} action={copy.test.button} onAction={onTest} />}
      {shown.map((p) => {
        const fix = fixOf(p)
        return <ProblemRow key={p.key} title={p.text} action={fix?.label} onAction={fix?.run} />
      })}
      {agentKey && <ProblemRow title={copy.agentSection.agentKeyWarning} />}
    </>
  )
}

/** 标题行 + 状态行（PRD 6.4）：右边「测试连接」和「⋯」（重新探测、复制别名、预览 Skill、在文件夹中显示、删除） */
export function DetailHeader({
  asset,
  name,
  production,
  titleRef,
  conn,
  onTest,
}: {
  asset: ServerAsset
  name: string
  production: boolean
  titleRef: RefObject<HTMLHeadingElement | null>
  conn: ConnTest
  onTest: () => void
}) {
  const probing = useProbeStore((s) => isProbing(s, asset.id))
  const now = useMinuteTick()
  const alias = asset.connection.sshAlias
  const state = connState(asset)
  const { tone, icon } = CONN_STATE[state]
  const facts = factsSummary(asset.facts)
  const probeTone = probing ? "neutral" : PROBE_STATE[asset.probe.status].tone
  const running = conn.test?.status === "running" || conn.test?.status === "host-key"
  const probe = () => (probing ? serverActions.cancelProbe(asset) : serverActions.probe(asset))

  const actions = (
    <>
      <Button variant="outline" size="sm" onClick={running ? conn.cancel : onTest}>
        {running && <Spinner data-icon="inline-start" aria-hidden />}
        {running ? copy.test.cancel : copy.detail.test}
      </Button>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger render={<DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={copy.common.more} />} />}>
            <EllipsisIcon />
          </TooltipTrigger>
          <TooltipContent>{copy.common.more}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end" className="w-auto min-w-48">
          <DropdownMenuItem onClick={probe}>
            {probing ? <Spinner aria-hidden /> : <RadarIcon />}
            {probing ? copy.detail.cancelProbe : copy.detail.probe}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => serverActions.copyAlias(asset)}>
            <CopyIcon />
            {copy.detail.copyAlias}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => useUIStore.getState().openPreview({ file: detailFileOf(alias) })}>
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
            {copy.detail.delete}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  )

  const sep = <span className="text-faint" aria-hidden>·</span>
  return (
    <DetailTitle
      mark={<ServerIcon className="size-5" aria-hidden />}
      name={name}
      alias={alias !== name ? alias : undefined}
      handle={alias}
      production={production}
      titleRef={titleRef}
      actions={actions}
      status={
        <>
          <StateText tone={tone} icon={icon}>
            {copy.connState[state]}
          </StateText>
          {facts.length > 0 && (
            <>
              {sep}
              <span>{facts.join(" · ")}</span>
            </>
          )}
          {sep}
          <span className={cn("flex items-center gap-1", TONE_TEXT[probeTone])}>
            {probing && <Spinner className="size-3.5" aria-hidden />}
            {probeText(asset, probing, now)}
          </span>
          <Tooltip>
            <TooltipTrigger render={<Button variant="ghost" size="icon-xs" aria-label={probing ? copy.detail.cancelProbe : copy.detail.refreshProbe} onClick={probe} />}>
              <RefreshCwIcon />
            </TooltipTrigger>
            <TooltipContent>{probing ? copy.detail.cancelProbe : copy.detail.refreshProbe}</TooltipContent>
          </Tooltip>
        </>
      }
    />
  )
}
