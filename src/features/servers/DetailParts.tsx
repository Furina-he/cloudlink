// 全宽资源详情的公共部分：资料以查看为主，权限仍独立即时控制（P8 D6）。
import { ChevronLeftIcon, ChevronRightIcon, InfoIcon } from "lucide-react"
import { useEffect, type ReactNode, type RefObject } from "react"
import { Controller, useFormContext } from "react-hook-form"
import { useShallow } from "zustand/react/shallow"
import type { Asset, Operation } from "@/bindings"
import { ListGroup, ListNote, PrefRow } from "@/components/app/SettingsList"
import { ProdMark } from "@/components/app/ProdMark"
import { Button } from "@/components/ui/button"
import { Item } from "@/components/ui/item"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Switch } from "@/components/ui/switch"
import { Trace } from "@/components/ui/trace"
import { useAgentOptions } from "@/features/agents/agentKeys"
import { copy } from "@/lib/copy"
import type { ProfileFormValues } from "@/lib/schemas"
import { countDeliveredForAsset, useDeliveryStore } from "@/stores/deliveries"
import { useNotesStore } from "@/stores/notes"
import { useOperationStore } from "@/stores/operations"
import { useTargetStore } from "@/stores/targets"
import { useSkillStore } from "@/stores/skills"
import { useUIStore } from "@/stores/ui"
import { AgentPicker } from "./AgentPicker"
import { ModeToggle } from "./ModeSwitch"
import { OperationLine } from "./sections/OperationsSection"

const NO_OPS: Operation[] = []

export function DetailGroup({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return <section className="flex flex-col gap-2"><div className="flex min-h-7 items-center gap-2"><h3 className="text-sm font-semibold">{title}</h3>{action && <span className="ml-auto">{action}</span>}</div>{children}</section>
}

export function DetailPage({ children, onBlurCapture }: { children: ReactNode; onBlurCapture?: (e: React.FocusEvent) => void }) {
  return <section aria-labelledby="detail-title" className="flex h-full min-h-0 flex-col"><ScrollArea className="min-h-0 flex-1"><div className="mx-auto flex w-full max-w-190 flex-col gap-5 px-5 pt-3 pb-10" onBlurCapture={onBlurCapture}>{children}</div></ScrollArea></section>
}

export function BackLink() {
  return <Button variant="ghost" size="sm" className="-ml-2 w-fit text-muted-foreground" onClick={() => useUIStore.getState().closeInspector()}><ChevronLeftIcon data-icon="inline-start" />{copy.detail.back}</Button>
}

export function DetailTitle({ mark, name, nameControl, alias, handle, production, titleRef, actions, status }: {
  mark: ReactNode; name: string; nameControl?: ReactNode; alias?: string; handle: string; production: boolean; titleRef: RefObject<HTMLHeadingElement | null>; actions: ReactNode; status: ReactNode
}) {
  useEffect(() => titleRef.current?.focus({ preventScroll: true }), [titleRef])
  return (
    <header className="flex flex-col gap-1.5">
      <BackLink />
      <div className="flex min-w-0 items-center gap-3" data-handle={handle}>
        <div className="flex size-10 shrink-0 items-center justify-center rounded-[10px] border border-line bg-card text-fg-2">{mark}</div>
        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          <h2 id="detail-title" ref={titleRef} tabIndex={-1} className="min-w-0 text-lg font-semibold outline-none">{nameControl ?? name}</h2>
          {alias && <span className="shrink-0 font-mono text-xs text-muted-foreground">{alias}</span>}
          <ProdMark production={production} className="shrink-0" />
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">{actions}</div>
      </div>
      <div className="flex min-h-5 flex-wrap items-center gap-x-2 gap-y-1 pl-13 text-xs text-muted-foreground" aria-live="polite">{status}</div>
    </header>
  )
}

function useSyncedCount(asset: Asset): number {
  const targets = useTargetStore((s) => s.targets)
  const statuses = useSkillStore((s) => s.statusByKey)
  return useDeliveryStore(useShallow((s) => countDeliveredForAsset(asset.id, s.inclusions, Object.values(s.byId), targets, Object.values(statuses))))
}

export function PermissionGroup({ asset, problems }: { asset: Asset; problems?: ReactNode }) {
  const { control } = useFormContext<ProfileFormValues>()
  const { known, agents } = useAgentOptions()
  const synced = useSyncedCount(asset)
  return (
    <ListGroup id="detail-permission" title={copy.detail.groups.permission}>
      <Controller name="production" control={control} render={({ field }) => <PrefRow label={copy.detail.rows.production} labelFor="asset-production" hint={copy.detail.rows.productionHint}><Switch id="asset-production" checked={field.value} onCheckedChange={field.onChange} /></PrefRow>} />
      <PrefRow label={copy.detail.rows.mode} labelId="detail-mode-label" hint={copy.row.modeShort[asset.agent.mode]}><ModeToggle asset={asset} labelledBy="detail-mode-label" /></PrefRow>
      <PrefRow label={copy.detail.rows.agents} labelId="detail-agents-label" hint={copy.detail.rows.agentsSynced(synced)}>
        {agents.length > 0 ? <AgentPicker asset={asset} agents={agents} compact labelledBy="detail-agents-label" /> : known ? <Button variant="link" size="xs" className="h-auto p-0" onClick={() => useUIStore.getState().setView("agents")}>{copy.agentSection.goAgents}</Button> : null}
      </PrefRow>
      {problems}
    </ListGroup>
  )
}

export function ProblemRow({ title, reason, action, onAction, busy }: { title: string; reason?: string; action?: string; onAction?: () => void; busy?: boolean }) {
  return <PrefRow warn label={title} hint={reason}>{action ? <Button variant="outline" size="sm" disabled={busy} onClick={onAction}>{action}</Button> : undefined}</PrefRow>
}

export function RulesGroup({ rules }: { rules: Asset["guardrails"]["rules"] }) {
  return (
    <ListGroup id="detail-rules" title={copy.detail.groups.guardrails} count={rules.length}>
      {rules.length === 0 ? <p className="px-3.5 py-3 text-sm text-muted-foreground">{copy.guardrails.empty}</p> : <ol className="divide-y divide-line-2" aria-labelledby="detail-rules">{rules.map((r, i) => <Item key={r.id} render={<li />} className="flex-nowrap items-start rounded-none"><span aria-hidden className="w-4 shrink-0 text-right text-xs text-muted-foreground tabular-nums">{i + 1}</span><span className="min-w-0 whitespace-pre-wrap wrap-anywhere select-text">{r.text}</span></Item>)}</ol>}
      <ListNote icon={<InfoIcon />}>{copy.detail.honest}</ListNote>
    </ListGroup>
  )
}

export function RecentActivityGroup({ assetId }: { assetId: string }) {
  const ops = useOperationStore((s) => s.recentByAsset[assetId] ?? NO_OPS)
  const pendingNotes = useNotesStore((s) => s.byAsset[assetId]?.length ?? 0)
  const openFeed = () => useUIStore.getState().setView("activity", { then: () => void useOperationStore.getState().loadFeed(assetId) })
  useEffect(() => { void useOperationStore.getState().load(assetId) }, [assetId])
  const recent = ops.slice(0, 3)
  return (
    <ListGroup id="detail-activity" title={copy.detail.groups.activity} action={<Button variant="ghost" size="sm" onClick={openFeed}>{copy.detail.viewAll}<ChevronRightIcon data-icon="inline-end" /></Button>}>
      {pendingNotes > 0 && <button type="button" onClick={openFeed} className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-[13px] outline-none hover:bg-card-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"><span aria-hidden className="size-1.5 rounded-full bg-signal" /><span className="flex-1">{copy.detail.notesPending(pendingNotes)}</span><ChevronRightIcon aria-hidden className="size-4 text-faint" /></button>}
      {recent.length > 0 ? <Trace role="list" aria-label={copy.operations.listLabel} className="px-3.5 py-2">{recent.map((op) => <OperationLine key={op.id} op={op} />)}</Trace> : <p className="px-3.5 py-3 text-sm text-muted-foreground">{copy.detail.activityEmpty}</p>}
    </ListGroup>
  )
}

export function SummaryRow({ summary }: { summary: string }) {
  return <PrefRow label={copy.basic.summary} block><p className="whitespace-pre-wrap wrap-anywhere select-text">{summary || copy.detail.summaryEmpty}</p></PrefRow>
}
export function NotesRow({ notes }: { notes: string }) {
  return <PrefRow label={copy.detail.rows.notes} block><p className="whitespace-pre-wrap wrap-anywhere select-text">{notes || copy.detail.notesEmpty}</p></PrefRow>
}
