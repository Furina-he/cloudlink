import { CircleCheckIcon, CircleXIcon, CopyIcon, EllipsisIcon, FolderOpenIcon, PackageIcon, RadarIcon, Trash2Icon, TriangleAlertIcon } from "lucide-react"
import { useMemo, type RefObject } from "react"
import { useFormContext, useWatch } from "react-hook-form"

import type { Asset } from "@/bindings"
import { EnvBadge } from "@/components/app/EnvBadge"
import { CONN_STATE, StateText, TONE_TEXT, PROBE_STATE } from "@/components/app/StateBadge"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Spinner } from "@/components/ui/spinner"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useMinuteTick } from "@/hooks/use-minute-tick"
import { copy } from "@/lib/copy"
import { formatRelative } from "@/lib/format"
import { detailFileOf } from "@/lib/paths"
import type { ServerFormValues } from "@/lib/schemas"
import { cn } from "@/lib/utils"
import { connState, useAssetStore } from "@/stores/assets"
import { isProbing, useProbeStore } from "@/stores/probe"
import { compileLabel, useAgentOptions } from "@/features/agents/agentKeys"
import { compileKey, selectAssetCompile, useSkillStore } from "@/stores/skills"
import { useUIStore } from "@/stores/ui"
import { serverActions } from "./actions"
import { TestButton, TestResult, type ConnTest } from "./ConnectionTest"

/** 系统摘要：「Ubuntu 24.04 · 2C/2G」 */
function factsSummary(f: Asset["facts"]): string[] {
  const size = [f.cpuCores ? copy.detail.cores(f.cpuCores) : "", f.memoryTotalMiB ? copy.detail.memory(Math.round(f.memoryTotalMiB / 1024)) : ""].filter(Boolean)
  return [f.os ?? "", size.join("/")].filter(Boolean)
}

function probeText(asset: Asset, probing: boolean, now: number): string {
  if (probing) return copy.probing
  const { status, lastSuccessAt } = asset.probe
  if (status === "never") return copy.detail.neverProbed
  if (status === "failed") return copy.detail.probeFailed
  if (!lastSuccessAt) return copy.probeState[status]
  return (status === "stale" ? copy.detail.staleAt : copy.detail.probedAt)(formatRelative(lastSuccessAt, now))
}

/** 编译摘要（PRD 6.4）：受阻或有警告时显示一行，点击打开预览并定位到 Lint；刚保存时显示「已保存，已编译」 */
function CompileSummary({ asset, dirty }: { asset: Asset; dirty: boolean }) {
  const statusByKey = useSkillStore((s) => s.statusByKey)
  const saved = useAssetStore((s) => !!s.lastSaved[asset.id])
  const { compileTargets } = useAgentOptions()
  const statuses = useMemo(() => Object.values(statusByKey), [statusByKey])
  const { errors, warnings, blockedByOthers } = useMemo(() => selectAssetCompile(statuses, asset.id), [statuses, asset.id])
  // 定位到出问题的那一份：这台服务器自己的错误、警告优先，其次是被其他服务器拖累受阻的
  const showLint = () => {
    const own = (level: "error" | "warning") => statuses.find((s) => s.lint.some((l) => l.assetId === asset.id && l.level === level))
    const target = own("error") ?? blockedByOthers[0] ?? own("warning")
    if (target) useUIStore.getState().setPreviewKey(compileKey(target))
    useUIStore.getState().openPreview({ file: "SKILL.md", lint: true })
  }
  const link = "h-auto gap-1 p-0 text-xs"
  const blocked = errors > 0 || blockedByOthers.length > 0

  let body = null
  if (errors > 0) {
    body = (
      <Button variant="link" size="xs" className={cn(link, "text-destructive")} onClick={showLint}>
        <CircleXIcon />
        {copy.detail.compileBlocked(errors)} · {copy.detail.showLint}
      </Button>
    )
  } else if (blockedByOthers.length > 0) {
    body = (
      <Button variant="link" size="xs" className={cn(link, "text-destructive")} onClick={showLint}>
        <CircleXIcon />
        {copy.detail.compileBlockedOther(blockedByOthers.map((s) => compileLabel(compileTargets, s)).join("、"))} · {copy.detail.showLint}
      </Button>
    )
  } else if (warnings > 0) {
    body = (
      <Button variant="link" size="xs" className={cn(link, "text-warning")} onClick={showLint}>
        <TriangleAlertIcon />
        {copy.detail.compileWarnings(warnings)} · {copy.detail.showLint}
      </Button>
    )
  }
  return (
    <div role="status" className="mt-1 flex flex-wrap items-center gap-x-3 text-xs empty:mt-0">
      {/* 保存成功后显示「已保存，已编译」，不弹 Toast（6.4）；只在本次会话保存过、而且没有受阻时出现 */}
      {saved && !dirty && !blocked && (
        <span className="flex items-center gap-1 text-success">
          <CircleCheckIcon className="size-3.5" aria-hidden />
          {copy.detail.savedCompiled}
        </span>
      )}
      {body}
    </div>
  )
}

/** 详情头部（PRD 6.4）：别名、名称、环境徽章；系统摘要和探测时间；测试连接、探测、预览 Skill、更多 */
export function DetailHeader({
  asset,
  titleRef,
  conn,
  onTest,
  onConvert,
}: {
  asset: Asset
  titleRef: RefObject<HTMLHeadingElement | null>
  conn: ConnTest
  onTest: () => void
  onConvert: () => void
}) {
  const { control, formState } = useFormContext<ServerFormValues>()
  const [draftAlias, draftName, envTag] = useWatch({ control, name: ["alias", "name", "envTag"] })
  const probing = useProbeStore((s) => isProbing(s, asset.id))
  const now = useMinuteTick()
  const alias = draftAlias.trim() || asset.connection.sshAlias
  const state = connState(asset)
  const { tone, icon } = CONN_STATE[state]
  const facts = factsSummary(asset.facts)
  const probeTone = probing ? "neutral" : PROBE_STATE[asset.probe.status].tone
  const running = conn.test?.status === "running" || conn.test?.status === "host-key"

  return (
    <header className="flex flex-col border-b px-3 py-2.5">
      <div className="flex min-w-0 items-center gap-2">
        <h2 id="detail-title" ref={titleRef} tabIndex={-1} className="min-w-0 truncate font-mono text-base font-semibold outline-none">
          {alias}
        </h2>
        <span className="min-w-0 truncate text-sm text-muted-foreground">{draftName.trim() || asset.name}</span>
        <EnvBadge env={envTag} className="ml-auto shrink-0" />
      </div>
      <div className="mt-1.5 flex min-h-5 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <StateText tone={tone} icon={icon}>
          {copy.connState[state]}
        </StateText>
        {facts.length > 0 && <span>{facts.join(" · ")}</span>}
        <span className={cn("flex items-center gap-1", TONE_TEXT[probeTone])}>
          {probing && <Spinner className="size-3.5" aria-hidden />}
          {probeText(asset, probing, now)}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <TestButton running={running} onRun={onTest} onCancel={conn.cancel} />
        <Button variant="outline" size="sm" onClick={() => (probing ? serverActions.cancelProbe(asset) : serverActions.probe(asset))}>
          {probing ? <Spinner data-icon="inline-start" aria-hidden /> : <RadarIcon data-icon="inline-start" />}
          {probing ? copy.detail.cancelProbe : copy.detail.probe}
        </Button>
        <Button variant="outline" size="sm" onClick={() => useUIStore.getState().openPreview({ file: detailFileOf(alias) })}>
          <PackageIcon data-icon="inline-start" />
          {copy.detail.preview}
        </Button>
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger render={<DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={copy.common.more} />} />}>
              <EllipsisIcon />
            </TooltipTrigger>
            <TooltipContent>{copy.common.more}</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end" className="w-auto min-w-48">
            <DropdownMenuItem onClick={() => serverActions.copyAlias(asset)}>
              <CopyIcon />
              {copy.detail.copyAlias}
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
      </div>
      <TestResult className="mt-1.5 empty:mt-0" test={conn.test} current={conn.current} method={conn.method} assetId={asset.id} onConvert={onConvert} />
      <CompileSummary asset={asset} dirty={formState.isDirty} />
    </header>
  )
}
