import { HammerIcon, HistoryIcon, LinkIcon, RadarIcon, UnlinkIcon, WrenchIcon, type LucideIcon } from "lucide-react"
import { useMemo, useRef } from "react"

import type { ActivityItem, ActivityKind, Asset } from "@/bindings"
import { EmptyState } from "@/components/app/EmptyState"
import { useScrollRestore, useViewTitleFocus } from "@/components/app/ViewShell"
import { Button } from "@/components/ui/button"
import { CodeBlock, CodeBlockContent } from "@/components/ui/code-block"
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@/components/ui/trace"
import { useDelayedFlag } from "@/hooks/use-delayed-flag"
import { copy } from "@/lib/copy"
import { dayKey, formatDay, formatDuration, formatTime } from "@/lib/format"
import { useActivityStore } from "@/stores/activity"
import { useAssetStore } from "@/stores/assets"

const KINDS: ActivityKind[] = ["probe", "compile", "mount", "unmount", "repair"]

/** 图标按类型区分（PRD 6.8） */
const KIND_ICON: Record<ActivityKind, LucideIcon> = {
  probe: RadarIcon,
  compile: HammerIcon,
  mount: LinkIcon,
  unmount: UnlinkIcon,
  repair: WrenchIcon,
}

function dayTitle(iso: string) {
  const key = dayKey(iso)
  const today = new Date()
  if (key === dayKey(today.toISOString())) return copy.activityView.today
  today.setDate(today.getDate() - 1)
  if (key === dayKey(today.toISOString())) return copy.activityView.yesterday
  return formatDay(iso)
}

/** 一条记录是一行 TraceLine；有详情的用 TraceCollapsible 展开，里面是命令清单或差异摘要 */
function ActivityLine({ item }: { item: ActivityItem }) {
  const Icon = KIND_ICON[item.kind]
  const line = (
    <TraceLine status={item.ok ? undefined : "error"}>
      <TraceIcon>
        <Icon />
      </TraceIcon>
      <TraceTitle className="text-foreground">
        <span className="sr-only">{copy.activityKind[item.kind]}：</span>
        {copy.activity[item.messageId](item.params)}
        {!item.ok && <span className="sr-only">（{copy.activityView.failed}）</span>}
      </TraceTitle>
      <TraceDescription className="tabular-nums">
        {formatTime(item.at)}
        {item.durationMs != null && ` · ${formatDuration(item.durationMs)}`}
      </TraceDescription>
    </TraceLine>
  )
  if (!item.detail) return <div role="listitem">{line}</div>
  return (
    <TraceCollapsible role="listitem">
      <TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
      <TraceCollapsibleContent>
        <CodeBlock size="sm">
          <CodeBlockContent wrap>{item.detail}</CodeBlockContent>
        </CodeBlock>
      </TraceCollapsibleContent>
    </TraceCollapsible>
  )
}

function ActivitySkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-label={copy.activityView.loading}>
      <Skeleton className="h-4 w-24" />
      {Array.from({ length: 6 }, (_, i) => (
        <Skeleton key={i} className="h-5 w-2/3" />
      ))}
    </div>
  )
}

/** 活动视图（PRD 6.8）：按天分组的 Trace，每次加载 100 条，按类型和资产筛选 */
export function ActivityView({ focusTitle }: { focusTitle: boolean }) {
  const rootRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  useViewTitleFocus(titleRef, focusTitle)

  const items = useActivityStore((s) => s.items)
  const status = useActivityStore((s) => s.status)
  const hasMore = useActivityStore((s) => s.hasMore)
  const query = useActivityStore((s) => s.query)
  const assets = useAssetStore((s) => s.byId)
  const firstLoad = (status === "idle" || status === "loading") && items.length === 0
  const showSkeleton = useDelayedFlag(firstLoad)
  useScrollRestore(
    "activity",
    () => rootRef.current?.querySelector<HTMLElement>("[data-slot=scroll-area-viewport]"),
    !firstLoad
  )

  const groups = useMemo(() => {
    const map = new Map<string, ActivityItem[]>()
    for (const item of items) map.set(dayKey(item.at), [...(map.get(dayKey(item.at)) ?? []), item])
    return [...map.values()]
  }, [items])
  const assetList = useMemo(() => Object.values(assets).sort((a, b) => a.name.localeCompare(b.name)), [assets])
  const selectedAsset = query.assetId ? (assets[query.assetId] ?? null) : null
  const kinds = query.kinds ?? []
  const filtered = kinds.length > 0 || !!query.assetId
  const load = useActivityStore.getState().load

  return (
    <ScrollArea ref={rootRef} className="min-h-0 flex-1">
      <div className="flex min-h-full flex-col gap-4 p-3">
        <div className="flex flex-col gap-1">
          <h1 ref={titleRef} id="view-title" tabIndex={-1} className="text-base font-semibold outline-none">
            {copy.nav.activity}
          </h1>
          <p className="text-xs text-muted-foreground">{copy.activityView.retention}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <ToggleGroup
            multiple
            aria-label={copy.activityView.kindFilter}
            variant="outline"
            size="sm"
            spacing={0}
            value={kinds}
            onValueChange={(v) => void load({ ...query, kinds: v as ActivityKind[] })}
          >
            {KINDS.map((k) => {
              const Icon = KIND_ICON[k]
              return (
                <ToggleGroupItem key={k} value={k}>
                  <Icon data-icon="inline-start" />
                  {copy.activityKind[k]}
                </ToggleGroupItem>
              )
            })}
          </ToggleGroup>
          <Combobox
            items={assetList}
            value={selectedAsset}
            onValueChange={(a: Asset | null) => void load({ ...query, assetId: a?.id })}
            itemToStringLabel={(a: Asset) => a.name}
            isItemEqualToValue={(a: Asset, b: Asset) => a.id === b.id}
            autoHighlight
          >
            <ComboboxInput
              aria-label={copy.activityView.assetFilter}
              placeholder={copy.activityView.assetPlaceholder}
              className="w-52"
              showClear={!!selectedAsset}
              triggerLabel={copy.common.showOptions}
              clearLabel={copy.common.clear}
            />
            <ComboboxContent>
              <ComboboxEmpty>{copy.common.noOptions}</ComboboxEmpty>
              <ComboboxList>
                {(a: Asset) => (
                  <ComboboxItem key={a.id} value={a}>
                    <span className="truncate">{a.name}</span>
                    <span className="ml-auto shrink-0 font-mono text-xs text-muted-foreground">
                      {a.connection.sshAlias}
                    </span>
                  </ComboboxItem>
                )}
              </ComboboxList>
            </ComboboxContent>
          </Combobox>
        </div>

        {firstLoad ? (
          showSkeleton && <ActivitySkeleton />
        ) : items.length === 0 ? (
          filtered ? (
            <div className="flex flex-col items-start gap-2 text-sm text-muted-foreground">
              {copy.activityView.noMatch}
              <Button variant="outline" size="sm" onClick={() => void load({})}>
                {copy.activityView.clearFilter}
              </Button>
            </div>
          ) : (
            <EmptyState
              icon={HistoryIcon}
              title={copy.activityView.emptyTitle}
              description={copy.activityView.emptyDescription}
            />
          )
        ) : (
          <>
            {groups.map((list) => (
              <section key={dayKey(list[0].at)} aria-labelledby={`day-${dayKey(list[0].at)}`} className="flex flex-col gap-2">
                <h2 id={`day-${dayKey(list[0].at)}`} className="text-sm font-semibold">
                  {dayTitle(list[0].at)}
                </h2>
                <Trace role="list">
                  {list.map((item) => (
                    <ActivityLine key={item.id} item={item} />
                  ))}
                </Trace>
              </section>
            ))}
            {hasMore && (
              <div>
                <Button variant="outline" size="sm" disabled={status === "loading"} onClick={() => void load(query, true)}>
                  {status === "loading" && <Spinner data-icon="inline-start" aria-hidden />}
                  {copy.activityView.loadMore}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </ScrollArea>
  )
}
