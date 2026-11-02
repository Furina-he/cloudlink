import { CircleCheckIcon, CircleDashedIcon, FileInputIcon, PlusIcon, ServerIcon, ShieldCheckIcon } from "lucide-react"
import type { ReactNode } from "react"
import { useShallow } from "zustand/react/shallow"

import { ViewShell } from "@/components/app/ViewShell"
import { Button } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item"
import { copy } from "@/lib/copy"
import { useGuardDialog } from "@/features/agents/GuardDialogs"
import { useAssetStore } from "@/stores/assets"
import { useGuardStore } from "@/stores/guard"
import { useTargetStore } from "@/stores/targets"
import { useUIStore } from "@/stores/ui"
import { sortEnvs } from "./serverForm"

interface Step {
  title: string
  description: string
  done: boolean
  action?: ReactNode
}

/** 首次启动的四步清单（PRD 6.8）。完成情况由现有数据推出，全部完成后不再出现 */
export function useOnboardingSteps(): { steps: Step[]; complete: boolean } {
  const { envStatus, environments, targets } = useTargetStore(
    useShallow((s) => ({ envStatus: s.status, environments: s.environments, targets: s.targets }))
  )
  const { count, verified, distributed } = useAssetStore(
    useShallow((s) => ({
      count: s.ids.length,
      verified: s.ids.some((id) => s.byId[id].connection.verified?.ok),
      distributed: s.ids.some((id) => s.byId[id].agent.agents.length > 0),
    }))
  )
  const guards = useGuardStore((s) => s.statusByEnv)

  const detected = envStatus === "ready" && environments.length > 0
  const envs = environments.filter((e) => e.available).map((e) => copy.env.long(e.id)).join("、")
  const agents = [...new Set(targets.filter((t) => t.detected && t.agent !== "custom").map((t) => copy.agent[t.agent]))].join("、")
  // 有 Claude Code 目标的运行环境里，护栏还没生效、也不是「不可用」的
  const ccEnvs = sortEnvs([...new Set(targets.filter((t) => t.agent === "claude-code" && t.enabled).map((t) => t.envId))])
  const guardTodo = ccEnvs.filter((e) => {
    const state = guards[e]?.state
    return state !== "active" && state !== "unavailable"
  })
  const allUnavailable = ccEnvs.length > 0 && ccEnvs.every((e) => guards[e]?.state === "unavailable")

  const steps: Step[] = [
    {
      title: copy.onboarding.steps.detect,
      description: detected ? copy.onboarding.detected(envs, agents) : copy.onboarding.detecting,
      done: detected,
    },
    {
      title: copy.onboarding.steps.create,
      description: copy.onboarding.createHint,
      done: verified,
      action:
        count === 0 ? (
          <Button size="sm" onClick={() => useUIStore.getState().startCreate()}>
            <PlusIcon data-icon="inline-start" />
            {copy.onboarding.newServer}
          </Button>
        ) : undefined,
    },
    { title: copy.onboarding.steps.distribute, description: copy.onboarding.distributeHint, done: distributed },
    {
      title: copy.onboarding.steps.guard,
      description: ccEnvs.length === 0 ? copy.onboarding.guardNoTarget : allUnavailable ? copy.onboarding.guardUnavailable : copy.onboarding.guardHint,
      done: guardTodo.length === 0,
      action:
        guardTodo.length > 0 ? (
          <Button variant="outline" size="sm" onClick={() => useGuardDialog.getState().set({ kind: "install", envId: guardTodo[0] })}>
            <ShieldCheckIcon data-icon="inline-start" />
            {copy.onboarding.installGuard}
          </Button>
        ) : undefined,
    },
  ]
  return { steps, complete: steps.every((s) => s.done) }
}

/** 清单放在 Empty 里，会继承它的 text-balance，左对齐的说明被平衡成两行短句，所以改回 text-pretty */
export function OnboardingChecklist({ steps }: { steps: Step[] }) {
  return (
    <ItemGroup aria-label={copy.onboarding.checklist} className="w-full gap-2 text-left text-pretty">
      {steps.map((s, i) => (
        <Item key={s.title} role="listitem" variant="outline" size="sm">
          <ItemMedia variant="icon">
            {s.done ? <CircleCheckIcon className="text-success" aria-hidden /> : <CircleDashedIcon className="text-muted-foreground" aria-hidden />}
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

/** 还没有任何服务器：整页空状态 + 四步清单（PRD 6.8） */
export function FirstLaunch({ focusTitle }: { focusTitle: boolean }) {
  const { steps } = useOnboardingSteps()
  return (
    <ViewShell view="servers" title={copy.nav.servers} focusTitle={focusTitle}>
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
            <Button variant="outline" size="sm" onClick={() => useUIStore.getState().setImportOpen(true)}>
              <FileInputIcon data-icon="inline-start" />
              {copy.onboarding.importSsh}
            </Button>
          </p>
        </EmptyContent>
      </Empty>
    </ViewShell>
  )
}
