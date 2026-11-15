import { CircleCheckIcon, CircleXIcon, TriangleAlertIcon, XIcon } from "lucide-react"
import { useMemo } from "react"
import { useShallow } from "zustand/react/shallow"

import type { Asset, EnvId, InclusionReasonId } from "@/bindings"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { compileLabel, compileShort, useAgentOptions } from "@/features/agents/agentKeys"
import { copy } from "@/lib/copy"
import { cn } from "@/lib/utils"
import { useAssetStore } from "@/stores/assets"
import { selectInclusionsByAsset, useDeliveryStore } from "@/stores/deliveries"
import { compileKey, selectAssetCompile, useSkillStore } from "@/stores/skills"
import { useUIStore } from "@/stores/ui"
import { useTargetStore } from "@/stores/targets"

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

export interface InclusionProblem {
  key: string
  envId: EnvId
  reasonId: InclusionReasonId
  /** 「WSL Ubuntu-24.04 里的 Claude Code 还用不了这台服务器」 */
  title: string
  /** 原因，不再重复运行环境：「这里没有配置私钥」 */
  reason: string
}

/**
 * 点选了的 Agent 里没有列入的运行环境（F-303 AC2）。同一个环境、同一个原因只提示一次，
 * 例如 Claude Code 和 Codex 在 WSL 里都缺私钥时，只出现一条
 */
export function useInclusionProblems(asset: Asset): InclusionProblem[] {
  const inclusions = useDeliveryStore(useShallow((s) => selectInclusionsByAsset(s.inclusions, asset.id)))
  const { compileTargets } = useAgentOptions()
  const targets = useTargetStore((s) => s.targets)
  const byId = useDeliveryStore((s) => s.byId)
  const selected = asset.agent.agents
  return useMemo(() => {
    const groups = new Map<string, Omit<InclusionProblem, "title"> & { names: string[] }>()
    for (const inc of inclusions) {
      if (inc.included || !inc.reason || !selected.includes(inc.agentKey)) continue
      const matching = targets.filter((t) => t.enabled && t.envId === inc.envId && t.agentKey === inc.agentKey)
      // WSL 共用 Windows／目标路径失败不是连接字段缺失，不能给出「编辑连接」的误导修复。
      if (matching.length && matching.every((t) => Object.values(byId).some((d) => d.targetId === t.id && (d.statusDetail?.id === "shared-windows" || d.status === "broken")))) continue
      const key = `${inc.envId}|${inc.reason.id}`
      const name = compileShort(compileTargets, inc)
      const found = groups.get(key)
      if (found) found.names.push(name)
      else groups.set(key, { key, envId: inc.envId, reasonId: inc.reason.id, reason: copy.inclusionReasonInEnv[inc.reason.id](inc.reason.params), names: [name] })
    }
    const kind = asset.type === "cli" ? "cli" : "server"
    return [...groups.values()].map(({ names, ...p }) => ({ ...p, title: copy.inclusion.cannotUse(copy.env.long(p.envId), names.join("、"), kind) }))
  }, [inclusions, selected, compileTargets, asset.type, targets, byId])
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
