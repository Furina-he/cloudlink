import { CircleCheckIcon, CircleDashedIcon, ServerIcon } from "lucide-react"
import type { ReactNode } from "react"
import { useShallow } from "zustand/react/shallow"

import { ViewShell } from "@/components/app/ViewShell"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item"
import { copy } from "@/lib/copy"
import { useAssetStore } from "@/stores/assets"
import { useMountStore } from "@/stores/mounts"
import { useTargetStore } from "@/stores/targets"
import { useUIStore } from "@/stores/ui"

interface Step {
  title: string
  description: string
  done: boolean
  action?: ReactNode
}

/** 首次启动的三步清单（PRD 6.10）。完成情况由现有数据推出，全部完成后不再出现 */
export function useOnboardingSteps(): { steps: Step[]; complete: boolean } {
  const { envStatus, environments, targets } = useTargetStore(
    useShallow((s) => ({ envStatus: s.status, environments: s.environments, targets: s.targets }))
  )
  const { assetCount, probed } = useAssetStore(
    useShallow((s) => ({
      assetCount: s.ids.length,
      probed: s.ids.some((id) => s.byId[id].probe.status === "ok"),
    }))
  )
  const projectMounted = useMountStore((s) => {
    const projects = new Set(targets.filter((t) => t.kind === "project").map((t) => t.id))
    return Object.values(s.byId).some((m) => projects.has(m.targetId) && m.status !== "pending")
  })

  const detected = envStatus === "ready" && environments.length > 0
  const envs = environments.filter((e) => e.available).map((e) => copy.env.long(e.id)).join("、")
  const agents = [...new Set(targets.filter((t) => t.kind === "agent-global" && t.agent).map((t) => copy.agent[t.agent!]))].join("、")

  const steps: Step[] = [
    {
      title: copy.onboarding.steps.detect,
      description: detected ? copy.onboarding.detected(envs, agents) : copy.onboarding.detecting,
      done: detected,
    },
    {
      title: copy.onboarding.steps.import,
      description: copy.onboarding.importHint,
      done: assetCount > 0,
      action:
        assetCount > 0 ? undefined : (
          <Button size="sm" onClick={() => useUIStore.getState().setImportOpen(true)}>
            {copy.onboarding.startImport}
          </Button>
        ),
    },
    {
      title: copy.onboarding.steps.mount,
      description: copy.onboarding.mountHint,
      done: probed && projectMounted,
    },
  ]
  return { steps, complete: steps.every((s) => s.done) }
}

export function OnboardingChecklist({ steps }: { steps: Step[] }) {
  return (
    <ItemGroup aria-label={copy.onboarding.checklist} className="w-full gap-2 text-left">
      {steps.map((s, i) => (
        <Item key={s.title} role="listitem" variant="outline" size="sm">
          <ItemMedia variant="icon">
            {s.done ? (
              <CircleCheckIcon className="text-success" aria-hidden />
            ) : (
              <CircleDashedIcon className="text-muted-foreground" aria-hidden />
            )}
          </ItemMedia>
          <ItemContent>
            <ItemTitle>
              <span className="tabular-nums">{i + 1}</span>
              {s.title}
              <span className="sr-only">（{s.done ? copy.onboarding.done : copy.onboarding.todo}）</span>
            </ItemTitle>
            <ItemDescription>{s.description}</ItemDescription>
          </ItemContent>
          {s.action && <ItemActions>{s.action}</ItemActions>}
        </Item>
      ))}
    </ItemGroup>
  )
}

/** 还没有任何资产：整页空状态 + 三步清单 */
export function FirstLaunch({ focusTitle }: { focusTitle: boolean }) {
  const { steps } = useOnboardingSteps()
  return (
    <ViewShell view="assets" title={copy.nav.assets} focusTitle={focusTitle}>
      <Empty className="border">
        <EmptyHeader className="max-w-lg">
          <EmptyMedia variant="icon">
            <ServerIcon />
          </EmptyMedia>
          <EmptyTitle className="text-base">{copy.onboarding.title}</EmptyTitle>
          <EmptyDescription>{copy.onboarding.description}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent className="max-w-lg gap-4">
          <OnboardingChecklist steps={steps} />
          <p className="flex items-center gap-2 text-muted-foreground">
            {copy.onboarding.or}
            <Button variant="outline" size="sm" onClick={() => useUIStore.getState().startNewAsset()}>
              {copy.onboarding.manual}
            </Button>
          </p>
        </EmptyContent>
      </Empty>
    </ViewShell>
  )
}
