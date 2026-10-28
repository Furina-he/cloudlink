import {
  ChevronDownIcon,
  CircleCheckIcon,
  CircleXIcon,
  FileCodeIcon,
  MinusIcon,
  PanelBottomCloseIcon,
  PencilLineIcon,
  PlusIcon,
  TriangleAlertIcon,
  type LucideIcon,
} from "lucide-react"
import { motion } from "motion/react"
import { useId, useState } from "react"

import type { IpcError, ProbeChange, ProbeChangeKind, ProbeError } from "@/bindings"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockLine,
} from "@/components/ui/code-block"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "@/components/ui/toast"
import { Trace, TraceDescription, TraceIcon, TraceLine, TraceTitle } from "@/components/ui/trace"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useMinuteTick } from "@/hooks/use-minute-tick"
import { copy, ipcErrorText } from "@/lib/copy"
import { formatDateTime, formatDuration, formatRelative } from "@/lib/format"
import { useAssetStore } from "@/stores/assets"
import { selectActiveRun, useProbeStore, type ProbeRun } from "@/stores/probe"
import { useSkillStore } from "@/stores/skills"

const KIND_ICON: Record<ProbeChangeKind, LucideIcon> = {
  added: PlusIcon,
  changed: PencilLineIcon,
  missing: MinusIcon,
}

/** 探测步骤逐条出现（PRD 7.7：新步骤 150ms 淡入）；回看已结束的探测时不再播放 */
function Steps({ run }: { run: ProbeRun }) {
  const animate = run.status === "running"
  return (
    <Trace role="list" aria-label={copy.probePanel.title}>
      {run.steps.map((s) => {
        const Icon = s.status === "done" ? CircleCheckIcon : s.status === "error" ? CircleXIcon : null
        return (
          <motion.div
            key={s.step}
            role="listitem"
            initial={animate ? { opacity: 0, y: 4 } : false}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.15 }}
          >
            <TraceLine status={s.status === "running" ? "running" : s.status === "error" ? "error" : undefined}>
              <TraceIcon>
                {Icon ? <Icon className={s.status === "done" ? "text-success" : undefined} /> : <Spinner aria-hidden />}
              </TraceIcon>
              <TraceTitle>{copy.probeStep[s.step]}</TraceTitle>
              <span className="sr-only">{copy.probePanel.stepStatus[s.status]}</span>
              {s.ms != null && <TraceDescription>{formatDuration(s.ms)}</TraceDescription>}
            </TraceLine>
          </motion.div>
        )
      })}
    </Trace>
  )
}

function Commands({ commands }: { commands: string[] }) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs text-muted-foreground">{copy.probePanel.commands}</p>
      {commands.map((c) => (
        <CodeBlock key={c} size="sm">
          <CodeBlockActions>
            <CodeBlockCopyButton value={c} labels={{ copy: copy.common.copy, copied: copy.common.copied }} />
          </CodeBlockActions>
          <CodeBlockContent>{c}</CodeBlockContent>
        </CodeBlock>
      ))}
    </div>
  )
}

/** 失败：分类文案 + 建议；要在终端执行的命令用 CodeBlock 配复制按钮（PRD 6.5、8.3） */
function Failure({ error }: { error: ProbeError | undefined }) {
  const e = error ?? { id: "unknown" as const }
  const commands = copy.probeCommands[e.id]?.(e.params)
  return (
    <div className="flex flex-col gap-3">
      <Alert variant="destructive">
        <CircleXIcon />
        <AlertTitle>{copy.probeError[e.id].title(e.params)}</AlertTitle>
        <AlertDescription>{copy.probeError[e.id].hint(e.params)}</AlertDescription>
      </Alert>
      {commands && <Commands commands={commands} />}
    </div>
  )
}

function ChangeItem({
  change,
  checked,
  onCheckedChange,
}: {
  change: ProbeChange
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  const titleId = useId()
  const field = copy.probePanel.field[change.field]
  const Icon = KIND_ICON[change.kind]
  const title =
    change.kind === "added" ? `${copy.probePanel.kind.added}${field}` : change.kind === "missing" ? copy.probePanel.kind.missing : field
  const summary =
    change.kind === "changed"
      ? `${change.before ?? ""} → ${change.after ?? ""}`
      : change.kind === "added"
        ? change.after
        : `${change.before ?? ""}（${copy.probePanel.missingNote}）`

  return (
    <Collapsible>
      <Item variant="outline" size="xs" className="items-start">
        <ItemMedia className="pt-0.5">
          <Checkbox
            checked={checked}
            onCheckedChange={(v) => onCheckedChange(v === true)}
            aria-labelledby={titleId}
          />
        </ItemMedia>
        <ItemContent className="min-w-0">
          <ItemTitle id={titleId}>
            <Icon className="size-3.5 text-muted-foreground" aria-hidden />
            {title}
            {change.label !== field && <span className="font-mono font-normal">{change.label}</span>}
          </ItemTitle>
          {summary && <ItemDescription className="font-mono text-xs break-all">{summary}</ItemDescription>}
        </ItemContent>
        <ItemActions>
          <CollapsibleTrigger
            render={
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`${copy.probePanel.compare}：${change.label}`}
                className="group/compare"
              />
            }
          >
            <ChevronDownIcon className="transition-transform group-aria-expanded/compare:rotate-180" />
          </CollapsibleTrigger>
        </ItemActions>
        <CollapsibleContent className="h-(--collapsible-panel-height) basis-full overflow-hidden transition-[height] duration-200 data-ending-style:h-0 data-starting-style:h-0">
          <CodeBlock size="sm" className="mt-1">
            <CodeBlockContent wrap>
              {change.before && <CodeBlockLine variant="removed">{change.before}</CodeBlockLine>}
              {change.after && <CodeBlockLine variant="added">{change.after}</CodeBlockLine>}
            </CodeBlockContent>
          </CodeBlock>
        </CollapsibleContent>
      </Item>
    </Collapsible>
  )
}

/** 审阅变更：逐项勾选，应用后编译（F-103 AC2） */
function Review({ run, alias, dirty }: { run: ProbeRun; alias: string; dirty: boolean }) {
  const changes = run.diff?.changes ?? []
  // 「未发现」默认不勾：保留人工标注，由用户决定是否标记（PRD 6.5 示例）
  const [selected, setSelected] = useState(() => new Set(changes.filter((c) => c.kind !== "missing").map((c) => c.id)))
  const [busy, setBusy] = useState<"apply" | "ignore" | null>(null)

  const apply = async (ids: string[], which: "apply" | "ignore") => {
    setBusy(which)
    try {
      await useProbeStore.getState().apply(run.runId, ids)
      void useSkillStore.getState().refresh()
    } catch (e) {
      const err = e as IpcError
      toast.add({ title: ipcErrorText(err.id, err.params), type: "error" })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="flex flex-wrap items-center gap-x-2 text-sm">
        <span className="font-medium">{copy.probePanel.resultTitle}</span>
        <span className="font-mono">{alias}</span>
        {run.diff && (
          <>
            <span className="text-muted-foreground tabular-nums">{formatDateTime(run.diff.finishedAt)}</span>
            <span className="text-muted-foreground tabular-nums">
              {copy.probePanel.duration(formatDuration(run.diff.durationMs))}
            </span>
          </>
        )}
      </p>
      <ItemGroup className="gap-1.5">
        {changes.map((c) => (
          <ChangeItem
            key={c.id}
            change={c}
            checked={selected.has(c.id)}
            onCheckedChange={(on) =>
              setSelected((prev) => {
                const next = new Set(prev)
                if (on) next.add(c.id)
                else next.delete(c.id)
                return next
              })
            }
          />
        ))}
      </ItemGroup>
      {dirty && (
        <p role="note" className="flex items-center gap-1.5 text-xs text-warning">
          <TriangleAlertIcon className="size-3.5 shrink-0" aria-hidden />
          {copy.probePanel.applyDirty}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" disabled={dirty || busy !== null} onClick={() => void apply([], "ignore")}>
          {busy === "ignore" && <Spinner data-icon="inline-start" aria-hidden />}
          {copy.probePanel.ignoreAll}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          disabled={dirty || busy !== null || selected.size === 0}
          onClick={() => void apply([...selected], "apply")}
        >
          {busy === "apply" && <Spinner data-icon="inline-start" aria-hidden />}
          {copy.probePanel.apply(selected.size)}
        </Button>
      </div>
    </div>
  )
}

function Note({ children }: { children: string }) {
  return (
    <p role="status" className="text-sm text-muted-foreground">
      {children}
    </p>
  )
}

/** 探测面板（PRD 6.5），在编辑器内纵向切分，可折叠（Ctrl+J） */
export function ProbePanel({
  assetId,
  alias,
  dirty,
  onCollapse,
  onViewScript,
}: {
  assetId: string | null
  alias: string
  dirty: boolean
  onCollapse: () => void
  onViewScript: () => void
}) {
  const run = useProbeStore((s) => selectActiveRun(s, assetId))
  const probe = useAssetStore((s) => (assetId ? s.byId[assetId]?.probe : undefined))
  useMinuteTick()

  let body
  if (!assetId) body = <Note>{copy.probePanel.unsaved}</Note>
  else if (!alias) body = <Note>{copy.probePanel.noAlias}</Note>
  else if (!run) {
    body = (
      <Note>
        {probe?.lastSuccessAt
          ? copy.probePanel.idleLast(formatRelative(probe.lastSuccessAt), copy.probeState[probe.status])
          : copy.probePanel.idleNever(alias)}
      </Note>
    )
  } else if (run.status === "ok") {
    // 成功：有差异时面板切换到「审阅变更」，没有差异只显示一行（PRD 6.5）
    const changes = run.diff?.changes.length ?? 0
    body = (
      <div className="flex flex-col gap-3">
        {run.error && (
          <Alert>
            <TriangleAlertIcon className="text-warning!" />
            <AlertTitle>{copy.probePanel.partialTitle}</AlertTitle>
            <AlertDescription>{copy.probeError[run.error.id].title(run.error.params)}</AlertDescription>
          </Alert>
        )}
        {run.applied !== undefined ? (
          <Note>{copy.probePanel.applied(run.applied)}</Note>
        ) : changes === 0 ? (
          <Note>{copy.probePanel.noChanges}</Note>
        ) : (
          <Review key={run.runId} run={run} alias={alias} dirty={dirty} />
        )}
      </div>
    )
  } else {
    // 运行中、失败、已取消：逐条显示步骤；失败时最后一步标红，下方给出分类文案和建议
    body = (
      <div className="flex flex-col gap-3">
        {run.status === "running" && <p className="text-sm font-medium">{copy.probePanel.running(alias)}</p>}
        <Steps run={run} />
        {run.status === "failed" && <Failure error={run.error} />}
        {run.status === "cancelled" && <Note>{copy.probeCancelled}</Note>}
      </div>
    )
  }

  return (
    <section aria-labelledby="probe-panel-title" className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b px-3">
        <h2 id="probe-panel-title" className="text-sm font-semibold">
          {copy.probePanel.title}
        </h2>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={onViewScript}>
            <FileCodeIcon data-icon="inline-start" />
            {copy.probePanel.viewScript}
          </Button>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button variant="ghost" size="icon-sm" aria-label={copy.probePanel.collapse} onClick={onCollapse} />
              }
            >
              <PanelBottomCloseIcon />
            </TooltipTrigger>
            <TooltipContent>{copy.probePanel.collapse}</TooltipContent>
          </Tooltip>
        </div>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="p-3">{body}</div>
      </ScrollArea>
    </section>
  )
}
