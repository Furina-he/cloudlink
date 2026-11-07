import { PlusIcon } from "lucide-react"
import { useMemo, useState } from "react"

import { EnvIcon } from "@/components/app/StateBadge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { copy } from "@/lib/copy"
import { sortEnvs } from "@/features/servers/serverForm"
import { countIncluded, useDeliveryStore } from "@/stores/deliveries"
import { useGuardStore } from "@/stores/guard"
import { useTargetStore } from "@/stores/targets"
import { AGENT_ORDER } from "./agentKeys"
import { CustomTargetDialog } from "./CustomTargetDialog"
import { GuardRulesSheet } from "./GuardRulesSheet"
import { TargetDialogs } from "./targetActions"
import { TargetRow } from "./TargetRow"

/**
 * Agent 与目录（PRD 6.6，2026-11-07 重新设计）：按运行环境分组，每个目录一行。
 * 通用目录下面列出读取它的 Agent；Claude Code 那一行带这个运行环境的护栏（原来的护栏分区并入这里）
 */
export function TargetsSection() {
  const targets = useTargetStore((s) => s.targets)
  const environments = useTargetStore((s) => s.environments)
  const loading = useTargetStore((s) => s.status === "idle" || s.status === "loading") && targets.length === 0
  const byId = useDeliveryStore((s) => s.byId)
  const inclusions = useDeliveryStore((s) => s.inclusions)
  const guardByEnv = useGuardStore((s) => s.statusByEnv)
  const guardLoaded = useGuardStore((s) => s.status === "ready" || s.status === "error")
  const [customOpen, setCustomOpen] = useState(false)
  const [rulesOpen, setRulesOpen] = useState(false)

  const groups = useMemo(() => {
    const deliveries = Object.values(byId)
    return sortEnvs([...new Set(targets.map((t) => t.envId))]).map((envId) => ({
      envId,
      env: environments.find((e) => e.id === envId),
      items: targets
        .filter((t) => t.envId === envId)
        .sort((a, b) => AGENT_ORDER[a.agent] - AGENT_ORDER[b.agent] || a.label.localeCompare(b.label))
        .map((t) => ({ target: t, delivery: deliveries.find((d) => d.targetId === t.id), included: countIncluded(inclusions, t) })),
    }))
  }, [targets, environments, byId, inclusions])

  return (
    <section aria-labelledby="agents-targets" className="flex flex-col gap-3">
      <div className="flex items-start gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 id="agents-targets" className="text-sm font-semibold">
            {copy.agents.targetsTitle}
          </h2>
          <p className="text-xs text-muted-foreground">{copy.agents.targetsHint}</p>
        </div>
        <Button variant="outline" size="sm" className="ml-auto shrink-0" onClick={() => setCustomOpen(true)}>
          <PlusIcon data-icon="inline-start" />
          {copy.targets.addCustom}
        </Button>
      </div>
      {loading ? (
        <div className="flex flex-col gap-2" aria-busy="true" aria-label={copy.agents.loading}>
          <Skeleton className="h-14 rounded-xl" />
          <Skeleton className="h-14 rounded-xl" />
        </div>
      ) : (
        groups.map((g) => (
          <div key={g.envId} className="flex flex-col gap-1.5">
            <h3 id={`targets-${g.envId}`} className="flex items-center gap-1.5 px-1 text-xs font-medium text-muted-foreground">
              <EnvIcon envId={g.envId} className="size-3.5" />
              {copy.env.long(g.envId)}
            </h3>
            <div role="list" aria-labelledby={`targets-${g.envId}`} className="divide-y overflow-hidden rounded-xl border">
              {g.items.map(({ target, delivery, included }) => (
                <TargetRow
                  key={target.id}
                  target={target}
                  delivery={delivery}
                  included={included}
                  env={g.env}
                  targets={targets}
                  guard={target.agent === "claude-code" ? (guardLoaded ? (guardByEnv[g.envId] ?? null) : undefined) : undefined}
                  onShowRules={() => setRulesOpen(true)}
                />
              ))}
            </div>
          </div>
        ))
      )}
      <TargetDialogs />
      <CustomTargetDialog open={customOpen} onOpenChange={setCustomOpen} />
      <GuardRulesSheet open={rulesOpen} onOpenChange={setRulesOpen} />
    </section>
  )
}
