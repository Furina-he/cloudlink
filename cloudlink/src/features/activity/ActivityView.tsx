import { ChevronDownIcon, CircleXIcon, CopyIcon, TriangleAlertIcon } from "lucide-react"
import { AnimatePresence, motion } from "motion/react"
import { useEffect, useMemo, useState } from "react"

import type { AgentNote, Operation } from "@/bindings"
import { AgentMark } from "@/components/app/AgentMark"
import { ListGroup } from "@/components/app/SettingsList"
import { StatusDot } from "@/components/app/StatusDot"
import { ViewShell } from "@/components/app/ViewShell"
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/toast"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useDelayedFlag } from "@/hooks/use-delayed-flag"
import { copy, ipcErrorText } from "@/lib/copy"
import { dayKey, formatDay, formatRelative } from "@/lib/format"
import { cn } from "@/lib/utils"
import { toastError } from "@/features/servers/actions"
import { handleOf, useAssetStore } from "@/stores/assets"
import { useNotesStore } from "@/stores/notes"
import { useOperationStore } from "@/stores/operations"

type Filter = "all" | "denied" | "allowed"

const AgentAvatar = () => (
  <span aria-hidden className="flex size-5.5 shrink-0 items-center justify-center rounded-[6px] border border-line bg-card">
    <AgentMark agent="claude-code" label="Claude Code" lit className="size-3.5" />
  </span>
)

/** 一条待确认的 Agent 笔记（DESIGN.md Ask Card）。命中密钥的要编辑后才能并入；疑似注入的只能忽略 */
function AskCard({ note }: { note: AgentNote }) {
  const alias = useAssetStore((s) => {
    const a = s.byId[note.assetId]
    return a ? handleOf(a) : copy.feed.deletedAsset
  })
  const [editing, setEditing] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const secret = note.flags.includes("secret")
  const injection = note.flags.includes("injection")
  const textId = `ask-${note.id}`

  const merge = async (text?: string) => {
    setBusy(true)
    try {
      await useNotesStore.getState().merge([{ id: note.id, text }])
      toast.add({ title: copy.feed.merged(alias), type: "success" })
    } catch (e) {
      toastError(e)
    } finally {
      setBusy(false)
    }
  }
  const dismiss = () =>
    void useNotesStore
      .getState()
      .dismiss([note.id])
      .then(() => toast.add({ title: copy.feed.dismissed }))
      .catch(toastError)

  return (
    <div role="listitem" className="flex flex-col gap-2 px-3.5 py-3">
      <div className="flex items-center gap-2.5">
        <AgentAvatar />
        <span className="flex-1 text-[13px] font-medium">{copy.feed.noteAsk(alias)}</span>
        <time dateTime={note.writtenAt} className="text-xs text-muted-foreground">
          {formatDay(note.writtenAt)}
        </time>
      </div>
      <div className="flex flex-col gap-2 pl-8">
        {editing === null ? (
          <p id={textId} className="text-[13px] break-words whitespace-pre-wrap">
            {note.text}
          </p>
        ) : (
          <Textarea aria-label={copy.feed.editLabel} value={editing} onChange={(e) => setEditing(e.target.value)} rows={3} autoFocus />
        )}
        {secret && (
          <p className="flex items-center gap-1.5 text-xs text-warning">
            <TriangleAlertIcon className="size-3.5 shrink-0" aria-hidden />
            <span className="font-medium">{copy.feed.needsEdit}</span>
            {copy.feed.secretHint}
          </p>
        )}
        {injection && (
          <p className="flex items-center gap-1.5 text-xs text-destructive">
            <CircleXIcon className="size-3.5 shrink-0" aria-hidden />
            {copy.feed.injectionHint}
          </p>
        )}
        <div className="flex gap-1.5">
          {editing === null ? (
            <>
              {!injection &&
                (secret ? (
                  <Button size="sm" disabled={busy} onClick={() => setEditing(note.text)} aria-describedby={textId}>
                    {copy.feed.edit}
                  </Button>
                ) : (
                  <Button size="sm" disabled={busy} onClick={() => void merge()} aria-describedby={textId}>
                    {busy && <Spinner data-icon="inline-start" aria-hidden />}
                    {copy.feed.merge}
                  </Button>
                ))}
              <Button variant="outline" size="sm" disabled={busy} onClick={dismiss} aria-describedby={textId}>
                {copy.feed.dismiss}
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" disabled={busy || !editing.trim()} onClick={() => void merge(editing.trim())}>
                {busy && <Spinner data-icon="inline-start" aria-hidden />}
                {copy.feed.merge}
              </Button>
              <Button variant="outline" size="sm" onClick={() => setEditing(null)}>
                {copy.feed.cancelEdit}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/** 默认只展开这么多条，其余折叠，免得把操作记录挤出首屏 */
const ASKS_SHOWN = 2

function Asks() {
  const byAsset = useNotesStore((s) => s.byAsset)
  const notes = useMemo(() => Object.values(byAsset).flat().sort((a, b) => b.writtenAt.localeCompare(a.writtenAt)), [byAsset])
  const [expanded, setExpanded] = useState(false)
  if (notes.length === 0) return null
  const hidden = notes.length - ASKS_SHOWN
  const shown = expanded || hidden <= 0 ? notes : notes.slice(0, ASKS_SHOWN)
  return (
    <ListGroup id="feed-asks" title={copy.feed.asks} count={notes.length}>
      <div role="list" aria-labelledby="feed-asks" className="divide-y divide-line-2">
        {/* 处理后离场：淡出并上移 4px，120ms（PRD 7.7） */}
        <AnimatePresence initial={false}>
          {shown.map((n) => (
            <motion.div key={n.id} layout exit={{ opacity: 0, y: -4, transition: { duration: 0.12 } }}>
              <AskCard note={n} />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
      {hidden > 0 && (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
          className="flex w-full items-center justify-center gap-1 border-t border-line-2 px-3.5 py-2.5 text-xs text-muted-foreground outline-none hover:bg-card-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        >
          {expanded ? copy.feed.asksCollapse : copy.feed.asksMore(hidden)}
          <ChevronDownIcon aria-hidden className={cn("size-3.5 transition-transform", expanded && "rotate-180")} />
        </button>
      )}
    </ListGroup>
  )
}

/** 一条操作记录（DESIGN.md Feed Row）：头像 → 命令 → 资源 → 结果 → 时间，列宽固定 */
function FeedRow({ op }: { op: Operation }) {
  const alias = useAssetStore((s) => {
    const a = s.byId[op.assetId]
    return a ? handleOf(a) : copy.feed.deletedAsset
  })
  const denied = op.decision === "denied"
  const unparsed = !denied && op.reasonId === "unparsed"
  const copyCommand = () => void navigator.clipboard.writeText(op.command).then(() => toast.add({ title: copy.common.copiedValue(op.command) })).catch(() => undefined)
  return (
    <div role="listitem" className="group/feed flex min-h-11 items-center gap-3 px-3.5 py-2">
      <AgentAvatar />
      <div className="flex min-w-0 flex-1 items-center gap-1">
        <code className="truncate font-mono text-xs select-text" title={op.command}>
          {op.command}
        </code>
        <Button variant="ghost" size="icon-xs" className="shrink-0 opacity-0 group-hover/feed:opacity-100 focus-visible:opacity-100" aria-label={copy.feed.copyCommand} onClick={copyCommand}>
          <CopyIcon />
        </Button>
      </div>
      <span className="w-24 shrink-0 truncate text-xs text-muted-foreground">{alias}</span>
      <span className="flex w-36 shrink-0 items-center text-xs">
        {denied ? (
          <Tooltip>
            <TooltipTrigger render={<span tabIndex={0} className="flex min-w-0 items-center rounded-sm text-destructive outline-none focus-visible:ring-2 focus-visible:ring-ring" />}>
              <StatusDot tone="err" />
              <span className="truncate">
                {copy.feed.denied}
                {op.reasonId && ` · ${copy.feed.reasonShort(op.reasonId)}`}
              </span>
            </TooltipTrigger>
            {op.reasonId && <TooltipContent>{copy.guardReason[op.reasonId]}</TooltipContent>}
          </Tooltip>
        ) : (
          <span className="flex min-w-0 items-center text-fg-2">
            <StatusDot tone={unparsed ? "warn" : "ok"} />
            <span className="truncate">{unparsed ? copy.feed.unparsed : copy.feed.allowed}</span>
          </span>
        )}
      </span>
      <time dateTime={op.at} className="w-16 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
        {formatRelative(op.at)}
      </time>
    </div>
  )
}

function dayTitle(iso: string) {
  const key = dayKey(iso)
  const today = new Date()
  if (key === dayKey(today.toISOString())) return copy.activityView.today
  today.setDate(today.getDate() - 1)
  if (key === dayKey(today.toISOString())) return copy.activityView.yesterday
  return formatDay(iso)
}

const ALL = "__all__"

/** 操作记录：分段筛选「全部 / 已拦截 / 已执行」，可按资源过滤；按天分组 */
function OperationLog() {
  const feed = useOperationStore((s) => s.feed)
  const status = useOperationStore((s) => s.feedStatus)
  const error = useOperationStore((s) => s.feedError)
  const hasMore = useOperationStore((s) => s.feedHasMore)
  const assetId = useOperationStore((s) => s.feedAssetId)
  const ids = useAssetStore((s) => s.ids)
  const byId = useAssetStore((s) => s.byId)
  const assets = useMemo(() => ids.map((id) => byId[id]).filter(Boolean), [ids, byId])
  const nameOf = (id: string) => (byId[id] ? handleOf(byId[id]) : copy.feed.deletedAsset)
  const [filter, setFilter] = useState<Filter>("all")
  const firstLoad = (status === "idle" || status === "loading") && feed.length === 0
  const showSkeleton = useDelayedFlag(firstLoad)

  useEffect(() => {
    if (useOperationStore.getState().feedStatus === "idle") void useOperationStore.getState().loadFeed(null)
  }, [])

  const shown = useMemo(() => feed.filter((o) => filter === "all" || o.decision === filter), [feed, filter])
  const days = useMemo(() => {
    const map = new Map<string, Operation[]>()
    for (const o of shown) map.set(dayKey(o.at), [...(map.get(dayKey(o.at)) ?? []), o])
    return [...map.values()]
  }, [shown])
  const filtered = filter !== "all" || assetId !== null
  const clear = () => {
    setFilter("all")
    void useOperationStore.getState().loadFeed(null)
  }

  const controls = (
    <>
      <Select value={assetId ?? ALL} onValueChange={(v) => void useOperationStore.getState().loadFeed(v === ALL ? null : (v as string))}>
        <SelectTrigger size="sm" aria-label={copy.feed.assetFilter} className="h-7 w-36">
          <SelectValue>{(v: string) => (v === ALL ? copy.feed.allAssets : nameOf(v))}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{copy.feed.allAssets}</SelectItem>
          {assets.map((a) => (
            <SelectItem key={a.id} value={a.id}>
              {handleOf(a)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <ToggleGroup aria-label={copy.feed.filterLabel} variant="outline" size="sm" spacing={0} value={[filter]} onValueChange={(next) => next[0] && setFilter(next[0] as Filter)}>
        {(["all", "denied", "allowed"] as const).map((f) => (
          <ToggleGroupItem key={f} value={f} className="px-3">
            {copy.feed.filter[f]}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </>
  )

  return (
    <section aria-labelledby="feed-log" className="flex flex-col gap-2">
      <div className="flex min-h-7 flex-wrap items-center gap-2 px-1">
        <h3 id="feed-log" className="text-[13px] font-semibold">
          {copy.feed.log}
        </h3>
        <span className="ml-auto flex items-center gap-2">{controls}</span>
      </div>
      {error && (
        <Alert variant="destructive">
          <CircleXIcon />
          <AlertTitle>{copy.shell.loadFailed}</AlertTitle>
          <AlertDescription>{ipcErrorText(error.id, error.params)}</AlertDescription>
          <AlertAction>
            <Button size="sm" variant="outline" onClick={() => void useOperationStore.getState().loadFeed(assetId)}>
              {copy.common.retry}
            </Button>
          </AlertAction>
        </Alert>
      )}
      {firstLoad ? (
        showSkeleton && (
          <div className="flex flex-col gap-2" aria-busy="true" aria-label={copy.feed.loading}>
            <Skeleton className="h-11 rounded-list" />
            <Skeleton className="h-11 rounded-list" />
          </div>
        )
      ) : shown.length === 0 ? (
        !error && (
          <div className="flex flex-col items-start gap-2 rounded-list border border-line bg-card px-3.5 py-3 text-[13px] text-muted-foreground">
            {filtered ? copy.feed.noMatch : copy.feed.empty}
            {filtered && (
              <Button variant="outline" size="sm" onClick={clear}>
                {copy.feed.clearFilter}
              </Button>
            )}
          </div>
        )
      ) : (
        days.map((list) => {
          const key = dayKey(list[0].at)
          return (
            <div key={key} className="flex flex-col gap-1.5">
              <h4 id={`feed-day-${key}`} className="px-1 pt-1 text-xs text-muted-foreground">
                {dayTitle(list[0].at)}
              </h4>
              <div role="list" aria-labelledby={`feed-day-${key}`} className="divide-y divide-line-2 overflow-hidden rounded-list border border-line bg-card">
                {list.map((op) => (
                  <FeedRow key={op.id} op={op} />
                ))}
              </div>
            </div>
          )
        })
      )}
      {hasMore && (
        <div>
          <Button variant="outline" size="sm" disabled={status === "loading"} onClick={() => void useOperationStore.getState().loadFeed(assetId, true)}>
            {status === "loading" && <Spinner data-icon="inline-start" aria-hidden />}
            {copy.feed.loadMore}
          </Button>
        </div>
      )}
      <p className="px-1 pt-1 text-xs text-muted-foreground">{copy.feed.scopeNote}</p>
    </section>
  )
}

/** 动态视图（PRD 6.7）：等你确认（Agent 笔记；v0.3 起加命令审批）、操作记录。应用自己的活动日志在设置 → 数据 */
export function ActivityView({ focusTitle }: { focusTitle: boolean }) {
  return (
    <ViewShell view="activity" title={copy.nav.activity} focusTitle={focusTitle} titleHidden>
      <div className="mx-auto flex w-full max-w-180 flex-col gap-5 pt-2 pb-8">
        <Asks />
        <OperationLog />
      </div>
    </ViewShell>
  )
}
