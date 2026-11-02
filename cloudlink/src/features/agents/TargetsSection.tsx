import { PlusIcon } from "lucide-react"
import { useMemo, useState } from "react"

import { EnvIcon } from "@/components/app/StateBadge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { copy } from "@/lib/copy"
import { sortEnvs } from "@/features/servers/serverForm"
import { countIncluded, useDeliveryStore } from "@/stores/deliveries"
import { useTargetStore } from "@/stores/targets"
import { AGENT_ORDER } from "./agentKeys"
import { CustomTargetDialog } from "./CustomTargetDialog"
import { TargetCard } from "./TargetCard"
import { TargetDialogs } from "./targetActions"

/** 分发目标（PRD 6.6）：按运行环境分组，每个目标一张 Card */
export function TargetsSection() {
  const targets = useTargetStore((s) => s.targets)
  const loading = useTargetStore((s) => s.status === "idle" || s.status === "loading") && targets.length === 0
  const byId = useDeliveryStore((s) => s.byId)
  const inclusions = useDeliveryStore((s) => s.inclusions)
  const [customOpen, setCustomOpen] = useState(false)

  const groups = useMemo(() => {
    const deliveries = Object.values(byId)
    return sortEnvs([...new Set(targets.map((t) => t.envId))]).map((envId) => ({
      envId,
      items: targets
        .filter((t) => t.envId === envId)
        .sort((a, b) => AGENT_ORDER[a.agent] - AGENT_ORDER[b.agent] || a.label.localeCompare(b.label))
        .map((t) => ({ target: t, delivery: deliveries.find((d) => d.targetId === t.id), included: countIncluded(inclusions, t) })),
    }))
  }, [targets, byId, inclusions])

  return (
    <section aria-labelledby="agents-targets" className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <h2 id="agents-targets" className="text-sm font-semibold">
          {copy.targets.title}
        </h2>
        <Button variant="outline" size="sm" className="ml-auto" onClick={() => setCustomOpen(true)}>
          <PlusIcon data-icon="inline-start" />
          {copy.targets.addCustom}
        </Button>
      </div>
      {loading ? (
        <div className="flex flex-col gap-2" aria-busy="true" aria-label={copy.agents.loading}>
          <Skeleton className="h-16 rounded-xl" />
          <Skeleton className="h-16 rounded-xl" />
        </div>
      ) : (
        groups.map((g) => (
          <div key={g.envId} role="group" aria-labelledby={`targets-${g.envId}`} className="flex flex-col gap-2">
            <h3 id={`targets-${g.envId}`} className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <EnvIcon envId={g.envId} className="size-3.5" />
              {copy.env.long(g.envId)}
            </h3>
            {g.items.map(({ target, delivery, included }) => (
              <TargetCard key={target.id} target={target} delivery={delivery} included={included} />
            ))}
          </div>
        ))
      )}
      <TargetDialogs />
      <CustomTargetDialog open={customOpen} onOpenChange={setCustomOpen} />
    </section>
  )
}
