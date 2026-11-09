// 资源详情的公共部分（PRD 6.4）：全宽一页、没有 Tab。返回、标题行、Agent 权限、红线、最近动态
import { ChevronLeftIcon, ChevronRightIcon, InfoIcon, PlusIcon, XIcon } from "lucide-react"
import { useEffect, type ReactNode, type RefObject } from "react"
import { Controller, useFieldArray, useFormContext, useWatch } from "react-hook-form"

import type { Asset, Operation } from "@/bindings"
import { ListGroup, ListNote, PrefRow } from "@/components/app/SettingsList"
import { ProdMark } from "@/components/app/ProdMark"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { Trace } from "@/components/ui/trace"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useAgentOptions } from "@/features/agents/agentKeys"
import { copy } from "@/lib/copy"
import type { ProfileFormValues } from "@/lib/schemas"
import { selectInclusionsByAsset, useDeliveryStore } from "@/stores/deliveries"
import { useNotesStore } from "@/stores/notes"
import { useOperationStore } from "@/stores/operations"
import { useUIStore } from "@/stores/ui"
import { useShallow } from "zustand/react/shallow"
import { AgentPicker } from "./AgentPicker"
import { ModeToggle } from "./ModeSwitch"
import { shortId } from "./serverForm"
import { OperationLine } from "./sections/OperationsSection"
import { ValidationError } from "./ValidationError"

const NO_OPS: Operation[] = []

/** 表单里的一组内容（添加对话框用）：标题是 h3，层级不跳级 */
export function DetailGroup({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex min-h-7 items-center gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        {action && <span className="ml-auto">{action}</span>}
      </div>
      {children}
    </section>
  )
}

/** 详情页外壳：内容居中，最宽 760px；失焦保存挂在最外层 */
export function DetailPage({ children, onBlurCapture }: { children: ReactNode; onBlurCapture?: (e: React.FocusEvent) => void }) {
  return (
    <section aria-labelledby="detail-title" className="flex h-full min-h-0 flex-col">
      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto flex w-full max-w-190 flex-col gap-5 px-5 pt-3 pb-10" onBlurCapture={onBlurCapture}>
          {children}
        </div>
      </ScrollArea>
    </section>
  )
}

/** 左上角「‹ 资源」：回到资源列表，Esc 同样返回 */
export function BackLink() {
  return (
    <Button variant="ghost" size="sm" className="-ml-2 w-fit text-muted-foreground" onClick={() => useUIStore.getState().closeInspector()}>
      <ChevronLeftIcon data-icon="inline-start" />
      {copy.detail.back}
    </Button>
  )
}

/** 标题行：品牌方块（40px）+ 名称 + 别名 +「生产」；右边主操作和「⋯」 */
export function DetailTitle({
  mark,
  name,
  alias,
  handle,
  production,
  titleRef,
  actions,
  status,
}: {
  mark: ReactNode
  name: string
  alias?: string
  /** 资源标识（别名或 cloudflare-2），测试用 data-handle 定位 */
  handle: string
  production: boolean
  titleRef: RefObject<HTMLHeadingElement | null>
  actions: ReactNode
  status: ReactNode
}) {
  // 从列表进入详情：焦点移到标题，读屏和键盘都从这里开始
  useEffect(() => titleRef.current?.focus({ preventScroll: true }), [titleRef])
  return (
    <header className="flex flex-col gap-1.5">
      <BackLink />
      <div className="flex min-w-0 items-center gap-3" data-handle={handle}>
        <div className="flex size-10 shrink-0 items-center justify-center rounded-[10px] border border-line bg-card text-fg-2">{mark}</div>
        <div className="flex min-w-0 items-baseline gap-2">
          <h2 id="detail-title" ref={titleRef} tabIndex={-1} className="min-w-0 truncate text-lg font-semibold outline-none">
            {name}
          </h2>
          {alias && <span className="shrink-0 font-mono text-xs text-muted-foreground">{alias}</span>}
          <ProdMark production={production} className="shrink-0" />
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">{actions}</div>
      </div>
      <div className="flex min-h-5 flex-wrap items-center gap-x-2 gap-y-1 pl-13 text-xs text-muted-foreground" aria-live="polite">
        {status}
      </div>
    </header>
  )
}

/** 同步给了几个目录（已列入的「运行环境 × 目录」） */
function useSyncedCount(asset: Asset): number {
  const inclusions = useDeliveryStore(useShallow((s) => selectInclusionsByAsset(s.inclusions, asset.id)))
  return new Set(inclusions.filter((i) => i.included && asset.agent.agents.includes(i.agentKey)).map((i) => `${i.envId}|${i.agentKey}`)).size
}

/** Agent 权限：生产环境开关（表单字段，编辑即保存）、档位、给哪些 Agent；problems 是琥珀色的问题行 */
export function PermissionGroup({ asset, problems }: { asset: Asset; problems?: ReactNode }) {
  const { control } = useFormContext<ProfileFormValues>()
  const { known, agents } = useAgentOptions()
  const synced = useSyncedCount(asset)
  return (
    <ListGroup id="detail-permission" title={copy.detail.groups.permission}>
      <Controller
        name="production"
        control={control}
        render={({ field }) => (
          <PrefRow label={copy.detail.rows.production} labelFor="asset-production" hint={copy.detail.rows.productionHint}>
            <Switch id="asset-production" checked={field.value} onCheckedChange={(v) => field.onChange(v)} />
          </PrefRow>
        )}
      />
      <PrefRow label={copy.detail.rows.mode} labelId="detail-mode-label" hint={copy.row.modeShort[asset.agent.mode]}>
        <ModeToggle asset={asset} labelledBy="detail-mode-label" />
      </PrefRow>
      <PrefRow label={copy.detail.rows.agents} labelId="detail-agents-label" hint={copy.detail.rows.agentsSynced(synced)}>
        {agents.length > 0 ? (
          <AgentPicker asset={asset} agents={agents} compact labelledBy="detail-agents-label" />
        ) : known ? (
          <Button variant="link" size="xs" className="h-auto p-0" onClick={() => useUIStore.getState().setView("agents")}>
            {copy.agentSection.goAgents}
          </Button>
        ) : null}
      </PrefRow>
      {problems}
    </ListGroup>
  )
}

/** 琥珀色的问题行：标题 + 原因 + 右侧一个修复按钮 */
export function ProblemRow({ title, reason, action, onAction, busy }: { title: string; reason?: string; action?: string; onAction?: () => void; busy?: boolean }) {
  return (
    <PrefRow warn label={title} hint={reason}>
      {action ? (
        <Button variant="outline" size="sm" disabled={busy} onClick={onAction}>
          {action}
        </Button>
      ) : undefined}
    </PrefRow>
  )
}

/** 红线：编号列表，悬停出现删除；组标题右边「添加」；卡片底部一条诚实说明 */
export function RulesGroup() {
  const {
    control,
    register,
    formState: { errors },
  } = useFormContext<ProfileFormValues>()
  // keyName "key"：领域数据自带 id，不能被 RHF 覆盖（PRD 7.2）
  const { fields, append, remove } = useFieldArray({ control, name: "rules", keyName: "key" })
  const add = () => {
    append({ id: shortId("r"), text: "" }, { shouldFocus: true })
  }
  return (
    <ListGroup
      id="detail-rules"
      title={copy.detail.groups.guardrails}
      count={fields.length}
      action={
        <Button variant="ghost" size="sm" onClick={add}>
          <PlusIcon data-icon="inline-start" />
          {copy.detail.addRule}
        </Button>
      }
    >
      {fields.length === 0 && <p className="px-3.5 py-3 text-sm text-muted-foreground">{copy.guardrails.empty}</p>}
      <ol aria-labelledby="detail-rules" className="divide-y divide-line-2 empty:hidden">
        {fields.map((f, i) => {
          const error = errors.rules?.[i]?.text
          return (
            <li key={f.key} className="group/rule flex items-start gap-3 px-3.5 py-2">
              <span className="mt-1.5 w-4 shrink-0 text-right text-xs text-muted-foreground tabular-nums" aria-hidden>
                {i + 1}
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <Textarea
                  rows={1}
                  className="field-sizing-content min-h-8 resize-none border-transparent bg-transparent px-1.5 py-1 shadow-none hover:border-line focus-visible:border-ring dark:bg-transparent"
                  aria-label={copy.guardrails.ruleAria(i + 1)}
                  aria-invalid={!!error || undefined}
                  {...register(`rules.${i}.text`)}
                />
                <ValidationError error={error} />
              </div>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="mt-1 text-muted-foreground opacity-0 group-hover/rule:opacity-100 focus-visible:opacity-100"
                      aria-label={copy.guardrails.removeAria(i + 1)}
                      onClick={() => remove(i)}
                    />
                  }
                >
                  <XIcon />
                </TooltipTrigger>
                <TooltipContent>{copy.guardrails.removeAria(i + 1)}</TooltipContent>
              </Tooltip>
            </li>
          )
        })}
      </ol>
      <ListNote icon={<InfoIcon />}>{copy.detail.honest}</ListNote>
    </ListGroup>
  )
}

/** 最近动态：待确认的笔记提示一行（处理在动态页）+ 最近 3 条操作记录，「查看全部 ›」跳到动态页并按这项资源过滤 */
export function RecentActivityGroup({ assetId }: { assetId: string }) {
  const ops = useOperationStore((s) => s.recentByAsset[assetId] ?? NO_OPS)
  const pendingNotes = useNotesStore((s) => s.byAsset[assetId]?.length ?? 0)
  const openFeed = () => useUIStore.getState().setView("activity", { then: () => void useOperationStore.getState().loadFeed(assetId) })
  useEffect(() => {
    void useOperationStore.getState().load(assetId)
  }, [assetId])
  const recent = ops.slice(0, 3)
  return (
    <ListGroup
      id="detail-activity"
      title={copy.detail.groups.activity}
      action={
        <Button
          variant="ghost"
          size="sm"
          onClick={openFeed}
        >
          {copy.detail.viewAll}
          <ChevronRightIcon data-icon="inline-end" />
        </Button>
      }
    >
      {pendingNotes > 0 && (
        <button
          type="button"
          onClick={openFeed}
          className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-[13px] outline-none hover:bg-card-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        >
          <span aria-hidden className="size-1.5 rounded-full bg-signal" />
          <span className="flex-1">{copy.detail.notesPending(pendingNotes)}</span>
          <ChevronRightIcon aria-hidden className="size-4 text-faint" />
        </button>
      )}
      {recent.length > 0 ? (
        <Trace role="list" aria-label={copy.operations.listLabel} className="px-3.5 py-2">
          {recent.map((op) => (
            <OperationLine key={op.id} op={op} />
          ))}
        </Trace>
      ) : (
        <p className="px-3.5 py-3 text-sm text-muted-foreground">{copy.detail.activityEmpty}</p>
      )}
    </ListGroup>
  )
}

/** 名称：一行输入框（两类资源共用） */
export function NameRow({ placeholder }: { placeholder?: string }) {
  const { register, formState } = useFormContext<ProfileFormValues>()
  const error = formState.errors.name
  return (
    <PrefRow label={copy.detail.rows.name} labelFor="asset-name" hint={copy.detail.rows.nameHint}>
      <div className="flex w-60 flex-col gap-1">
        <Input id="asset-name" placeholder={placeholder} aria-invalid={!!error || undefined} {...register("name")} />
        <ValidationError error={error} />
      </div>
    </PrefRow>
  )
}

/** 用途：直接编辑的多行文本（两类资源共用） */
export function SummaryRow() {
  const { register, control } = useFormContext<ProfileFormValues>()
  const summary = useWatch({ control, name: "summary" })
  return (
    <PrefRow label={copy.basic.summary} labelFor="asset-summary" hint={copy.basic.summaryHint} block>
      <Textarea id="asset-summary" rows={2} className="field-sizing-content min-h-14" {...register("summary")} />
      <span className="mt-1 block text-right text-xs text-muted-foreground tabular-nums">{copy.basic.chars(summary.length)}</span>
    </PrefRow>
  )
}

/** 笔记：Agent 笔记并入后写在这里，也可以直接编辑（两类资源共用） */
export function NotesRow() {
  const { register } = useFormContext<ProfileFormValues>()
  return (
    <PrefRow label={copy.detail.rows.notes} labelFor="asset-notes" hint={copy.detail.rows.notesHint} block>
      <Textarea id="asset-notes" rows={3} className="field-sizing-content min-h-16" {...register("notes")} />
    </PrefRow>
  )
}
