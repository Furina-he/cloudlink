import { ScrollTextIcon, ShieldCheckIcon } from "lucide-react"
import { useState } from "react"

import type { EnvId, GuardStatus } from "@/bindings"
import { EnvIcon, GuardBadge } from "@/components/app/StateBadge"
import { Button } from "@/components/ui/button"
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item"
import { Skeleton } from "@/components/ui/skeleton"
import { copy } from "@/lib/copy"
import { sortEnvs } from "@/features/servers/serverForm"
import { useGuardStore } from "@/stores/guard"
import { useTargetStore } from "@/stores/targets"
import { GuardRulesSheet } from "./GuardRulesSheet"
import { useGuardDialog } from "./GuardDialogs"

/** 一个运行环境的护栏：状态（已生效 / 未安装 / 未生效及原因 / 不可用及原因）、今天拦下的数量、安装或移除 */
function GuardRow({ envId, status }: { envId: EnvId; status: GuardStatus | undefined }) {
  const request = (kind: "install" | "remove") => useGuardDialog.getState().set({ kind, envId })
  const state = status?.state ?? "not-installed"
  const env = copy.env.long(envId)
  let action = null
  if (state === "active") {
    action = (
      <Button variant="outline" size="sm" onClick={() => request("remove")} aria-label={`${copy.guard.remove}：${env}`}>
        {copy.guard.remove}
      </Button>
    )
  } else if (state !== "unavailable") {
    action = (
      <Button variant="outline" size="sm" onClick={() => request("install")} aria-label={`${state === "broken" ? copy.guard.reinstall : copy.guard.install}：${env}`}>
        <ShieldCheckIcon data-icon="inline-start" />
        {state === "broken" ? copy.guard.reinstall : copy.guard.install}
      </Button>
    )
  }

  return (
    <Item role="listitem" variant="outline" size="sm" data-problem={state === "broken" || undefined}>
      <ItemMedia>
        <EnvIcon envId={envId} className="text-muted-foreground" />
      </ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle className="flex-wrap">
          {env}
          <GuardBadge state={state} />
          {state === "active" && <span className="font-normal text-muted-foreground tabular-nums">{copy.guard.deniedToday(status?.deniedToday ?? 0)}</span>}
        </ItemTitle>
        {status?.detail && <ItemDescription className="line-clamp-none">{copy.guardDetail[status.detail.id](status.detail.params)}</ItemDescription>}
      </ItemContent>
      {action && <ItemActions>{action}</ItemActions>}
    </Item>
  )
}

/** Agent 页的护栏分区（PRD 6.6、F-306）：每个有 Claude Code 目标的运行环境一行 */
export function GuardSection() {
  const targets = useTargetStore((s) => s.targets)
  const statusByEnv = useGuardStore((s) => s.statusByEnv)
  const loading = useGuardStore((s) => s.status === "idle" || s.status === "loading")
  const [rulesOpen, setRulesOpen] = useState(false)
  const envs = sortEnvs([...new Set(targets.filter((t) => t.agent === "claude-code" && t.enabled).map((t) => t.envId))])

  return (
    <section aria-labelledby="agents-guard" className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <h2 id="agents-guard" className="text-sm font-semibold">
          {copy.guard.title}
        </h2>
        <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setRulesOpen(true)}>
          <ScrollTextIcon data-icon="inline-start" />
          {copy.guard.rules}
        </Button>
      </div>
      {loading && envs.length > 0 ? (
        <Skeleton className="h-14" />
      ) : envs.length === 0 ? (
        <p className="text-sm text-muted-foreground">{copy.guard.noTarget}</p>
      ) : (
        <ItemGroup className="gap-2" aria-labelledby="agents-guard">
          {envs.map((envId) => (
            <GuardRow key={envId} envId={envId} status={statusByEnv[envId]} />
          ))}
        </ItemGroup>
      )}
      <p className="text-xs text-muted-foreground">{copy.guard.boundary}</p>
      <GuardRulesSheet open={rulesOpen} onOpenChange={setRulesOpen} />
    </section>
  )
}
