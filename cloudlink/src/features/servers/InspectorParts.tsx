import { ArrowLeftIcon, CircleCheckIcon, CircleXIcon, TriangleAlertIcon, XIcon } from "lucide-react"
import { useMemo, type ReactNode } from "react"
import { useShallow } from "zustand/react/shallow"

import type { Asset, EnvId, InclusionReasonId } from "@/bindings"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { compileLabel, useAgentOptions } from "@/features/agents/agentKeys"
import { copy } from "@/lib/copy"
import { cn } from "@/lib/utils"
import { useAssetStore } from "@/stores/assets"
import { selectInclusionsByAsset, useDeliveryStore } from "@/stores/deliveries"
import { compileKey, selectAssetCompile, useSkillStore } from "@/stores/skills"
import { useUIStore } from "@/stores/ui"
import { AgentPicker } from "./AgentPicker"
import { ModeToggle } from "./ModeSwitch"

/** 添加弹窗右上角的关闭按钮：回到资源列表；有未保存修改时先确认 */
export function ClosePanelButton() {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<Button variant="ghost" size="icon-sm" className="shrink-0" aria-label={copy.common.close} onClick={() => useUIStore.getState().closeInspector()} />}
      >
        <XIcon />
      </TooltipTrigger>
      <TooltipContent>{copy.common.close}</TooltipContent>
    </Tooltip>
  )
}

/** 详情视图左上角的「← 返回」（PRD 6.4）：回到资源列表，Esc、再点顶栏「资源」同样返回；有未保存修改时先确认 */
export function BackButton() {
  return (
    <Button variant="ghost" size="sm" className="-ml-2 shrink-0" onClick={() => useUIStore.getState().closeInspector()}>
      <ArrowLeftIcon data-icon="inline-start" />
      {copy.detail.back}
    </Button>
  )
}

/** 控制头的档位和授权（PRD 6.4）：立即生效，不经过保存。more 是右侧的「⋯」菜单；宽度够时并排一行 */
export function ControlRows({ asset, more }: { asset: Asset; more: ReactNode }) {
  const { agents } = useAgentOptions()
  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-x-5 gap-y-2">
      <div className="flex items-center gap-2">
        <span id="detail-mode-label" className="text-xs font-medium text-muted-foreground">
          {copy.agentSection.mode}
        </span>
        <ModeToggle asset={asset} labelledBy="detail-mode-label" />
      </div>
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span id="detail-agents-label" className="shrink-0 text-xs font-medium text-muted-foreground">
          {copy.agentSection.distribute}
        </span>
        {agents.length > 0 ? (
          <AgentPicker asset={asset} agents={agents} labelledBy="detail-agents-label" className="min-w-0" />
        ) : (
          <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {copy.agentSection.noTargets}
            <Button variant="link" size="xs" className="h-auto p-0" onClick={() => useUIStore.getState().setView("agents")}>
              {copy.agentSection.goAgents}
            </Button>
          </span>
        )}
        <span className="ml-auto shrink-0">{more}</span>
      </div>
    </div>
  )
}

/** 一条异常提示（「正常即隐身」，PRD 6.4）：琥珀色文字加图标，右侧一键处理 */
export function Notice({ children, action, onAction, busy }: { children: ReactNode; action?: string; onAction?: () => void; busy?: boolean }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-warning/35 bg-warning/10 px-2.5 py-1.5 text-xs">
      <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden />
      <span className="min-w-0 flex-1 text-warning">{children}</span>
      {action && (
        <Button variant="outline" size="xs" className="shrink-0" disabled={busy} onClick={onAction}>
          {action}
        </Button>
      )}
    </div>
  )
}

export interface InclusionProblem {
  key: string
  envId: EnvId
  reasonId: InclusionReasonId
  text: string
}

/**
 * 点选了的 Agent 里没有列入的运行环境（F-303 AC2）。同一个环境、同一个原因只提示一次，
 * 例如 Claude Code 和通用在 WSL 里都缺私钥时，只出现一条
 */
export function useInclusionProblems(asset: Asset): InclusionProblem[] {
  const inclusions = useDeliveryStore(useShallow((s) => selectInclusionsByAsset(s.inclusions, asset.id)))
  const { compileTargets } = useAgentOptions()
  const selected = asset.agent.agents
  return useMemo(() => {
    const groups = new Map<string, InclusionProblem & { labels: string[] }>()
    for (const inc of inclusions) {
      if (inc.included || !inc.reason || !selected.includes(inc.agentKey)) continue
      const key = `${inc.envId}|${inc.reason.id}`
      const label = compileLabel(compileTargets, inc)
      const found = groups.get(key)
      if (found) found.labels.push(label)
      else groups.set(key, { key, envId: inc.envId, reasonId: inc.reason.id, text: copy.inclusionReason[inc.reason.id](inc.reason.params), labels: [label] })
    }
    return [...groups.values()].map(({ labels, ...p }) => ({ ...p, text: `${copy.inclusion.excluded}：${p.text}（${labels.join("、")}）` }))
  }, [inclusions, selected, compileTargets])
}

/** 编译摘要（PRD 6.4）：受阻或有警告时显示一行，点击打开预览并定位到 Lint；刚保存时显示「已保存，已编译」 */
export function CompileSummary({ asset, dirty }: { asset: Asset; dirty: boolean }) {
  const statusByKey = useSkillStore((s) => s.statusByKey)
  const saved = useAssetStore((s) => !!s.lastSaved[asset.id])
  const { compileTargets } = useAgentOptions()
  const statuses = useMemo(() => Object.values(statusByKey), [statusByKey])
  const { errors, warnings, blockedByOthers } = useMemo(() => selectAssetCompile(statuses, asset.id), [statuses, asset.id])
  // 定位到出问题的那一份：这项资源自己的错误、警告优先，其次是被其他资源拖累受阻的
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
    <div role="status" className="flex flex-wrap items-center gap-x-3 text-xs empty:hidden">
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
