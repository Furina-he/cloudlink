import { CopyIcon, EllipsisIcon, FolderOpenIcon, PackageIcon, PlugIcon, RadarIcon, Trash2Icon } from "lucide-react"
import type { RefObject } from "react"
import { useFormContext, useWatch } from "react-hook-form"

import type { ServerAsset } from "@/bindings"
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
import { connState, selectCanDistribute } from "@/stores/assets"
import { isProbing, useProbeStore } from "@/stores/probe"
import { useTargetStore } from "@/stores/targets"
import { useUIStore } from "@/stores/ui"
import { serverActions, toastError, useConverting } from "./actions"
import { TestResult, type ConnTest } from "./ConnectionTest"
import { BackButton, CompileSummary, ControlRows, Notice, useInclusionProblems } from "./InspectorParts"
import { toast } from "@/components/ui/toast"

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

/** 打开「连接配置」Tab 并定位到某个字段 */
export type EditConnection = (path: "connection.definedIn" | "connection.identityFile") => void

/** 控制头下方的提示（「正常即隐身」，PRD 6.4、F-303 AC2）：不能分发、连接改过、某个环境未列入 */
function ServerNotices({ asset, onTest, onConvert, onEdit }: { asset: ServerAsset; onTest: () => void; onConvert: () => void; onEdit: EditConnection }) {
  const problems = useInclusionProblems(asset)
  const converting = useConverting((s) => s.ids.includes(asset.id))
  const can = selectCanDistribute(asset)
  const state = connState(asset)
  // 依赖 ssh-agent 的服务器，Windows 上的 Claude Code 读不到 Windows 服务里的密钥（8.3）
  const agentKey = asset.connection.auth?.method === "agent" && asset.agent.agents.includes("claude-code") && asset.connection.definedIn.includes("windows")

  const fixOf = (p: (typeof problems)[number]) => {
    if (p.reasonId === "password-only") return { label: copy.inclusionFix["password-only"], run: onConvert }
    if (p.reasonId === "not-written") return { label: copy.inclusionFix["not-written"], run: () => onEdit("connection.definedIn") }
    if (p.reasonId === "no-key-in-env") return { label: copy.inclusionFix["no-key-in-env"], run: () => onEdit("connection.identityFile") }
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
  if (!blocked && state !== "changed" && shown.length === 0 && !agentKey) return null

  return (
    <div className="mt-2 flex flex-col gap-1.5">
      {blocked && (
        <Notice action={passwordOnly ? copy.test.convertKey : copy.test.button} busy={converting} onAction={passwordOnly ? onConvert : onTest}>
          {copy.distributeBlock[can.reason]}
        </Notice>
      )}
      {state === "changed" && (
        <Notice action={copy.test.button} onAction={onTest}>
          {copy.connChangedHint}
        </Notice>
      )}
      {shown.map((p) => {
        const fix = fixOf(p)
        return (
          <Notice key={p.key} action={fix?.label} onAction={fix?.run}>
            {p.text}
          </Notice>
        )
      })}
      {agentKey && <Notice>{copy.agentSection.agentKeyWarning}</Notice>}
    </div>
  )
}

/**
 * 服务器的常驻控制头（PRD 6.4）：标识、名称、环境徽章、关闭；连接状态、系统摘要、探测时间；档位与授权；
 * 低频操作收进「⋯」。底部的提示和编译摘要只在异常时出现
 */
export function DetailHeader({
  asset,
  titleRef,
  conn,
  onTest,
  onConvert,
  onEdit,
}: {
  asset: ServerAsset
  titleRef: RefObject<HTMLHeadingElement | null>
  conn: ConnTest
  onTest: () => void
  onConvert: () => void
  onEdit: EditConnection
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

  const more = (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger render={<DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={copy.common.more} />} />}>
          <EllipsisIcon />
        </TooltipTrigger>
        <TooltipContent>{copy.common.more}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-auto min-w-48">
        <DropdownMenuItem onClick={running ? conn.cancel : onTest}>
          {running ? <Spinner aria-hidden /> : <PlugIcon />}
          {running ? copy.test.cancel : copy.detail.test}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => (probing ? serverActions.cancelProbe(asset) : serverActions.probe(asset))}>
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
  )

  return (
    <header className="flex shrink-0 flex-col border-b px-4 py-2.5">
      <div className="flex min-w-0 items-center gap-2">
        <BackButton />
        <h2 id="detail-title" ref={titleRef} tabIndex={-1} className="min-w-0 truncate font-mono text-base font-semibold outline-none">
          {alias}
        </h2>
        <span className="min-w-0 truncate text-sm text-muted-foreground">{draftName.trim() || asset.name}</span>
        <EnvBadge env={envTag} className="ml-auto shrink-0" />
      </div>
      <div className="mt-1 flex min-h-5 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <StateText tone={tone} icon={icon}>
          {copy.connState[state]}
        </StateText>
        {facts.length > 0 && <span>{facts.join(" · ")}</span>}
        <span className={cn("flex items-center gap-1", TONE_TEXT[probeTone])}>
          {probing && <Spinner className="size-3.5" aria-hidden />}
          {probeText(asset, probing, now)}
        </span>
      </div>
      <ControlRows asset={asset} more={more} />
      <TestResult className="mt-1.5 empty:mt-0" test={conn.test} current={conn.current} method={conn.method} assetId={asset.id} onConvert={onConvert} />
      <ServerNotices asset={asset} onTest={onTest} onConvert={onConvert} onEdit={onEdit} />
      <div className="mt-1.5 empty:hidden">
        <CompileSummary asset={asset} dirty={formState.isDirty} />
      </div>
    </header>
  )
}
