import { CircleXIcon, HistoryIcon } from "lucide-react"
import { useEffect, useMemo } from "react"

import type { ActivityItem } from "@/bindings"
import { EmptyState } from "@/components/app/EmptyState"
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { Trace } from "@/components/ui/trace"
import { useDelayedFlag } from "@/hooks/use-delayed-flag"
import { copy, ipcErrorText } from "@/lib/copy"
import { dayKey, formatDay } from "@/lib/format"
import { useActivityStore } from "@/stores/activity"
import { ActivityFilters, ActivityLine } from "./ActivityParts"
import { Section } from "./Section"

function dayTitle(iso: string) {
  const key = dayKey(iso)
  const today = new Date()
  if (key === dayKey(today.toISOString())) return copy.activityView.today
  today.setDate(today.getDate() - 1)
  if (key === dayKey(today.toISOString())) return copy.activityView.yesterday
  return formatDay(iso)
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

/**
 * 活动（PRD 6.7、F-402）：按天分组的 Trace，每次加载 100 条，按类型和服务器筛选。
 * 「Agent 操作」来自护栏记录（F-307）；从服务器详情「在活动中查看全部」进来时已经按服务器筛选好
 */
export function ActivitySection() {
  const items = useActivityStore((s) => s.items)
  const status = useActivityStore((s) => s.status)
  const error = useActivityStore((s) => s.error)
  const hasMore = useActivityStore((s) => s.hasMore)
  const query = useActivityStore((s) => s.query)
  const firstLoad = (status === "idle" || status === "loading") && items.length === 0
  const showSkeleton = useDelayedFlag(firstLoad)
  const filtered = (query.kinds?.length ?? 0) > 0 || !!query.assetId
  const load = useActivityStore.getState().load

  // 第一次打开才加载；之后的新记录由事件推送（lib/events.ts），筛选改动时各自重新加载
  useEffect(() => {
    if (useActivityStore.getState().status === "idle") void useActivityStore.getState().load()
  }, [])

  const groups = useMemo(() => {
    const map = new Map<string, ActivityItem[]>()
    for (const item of items) map.set(dayKey(item.at), [...(map.get(dayKey(item.at)) ?? []), item])
    return [...map.values()]
  }, [items])

  return (
    // 类型筛选有 10 项，放宽到 3xl，1280 宽时一行放得下
    <Section id="activity" title={copy.settings.section.activity} hint={copy.activityView.retention} wide>
      <ActivityFilters />
      {error && (
        <Alert variant="destructive">
          <CircleXIcon />
          <AlertTitle>{copy.shell.loadFailed}</AlertTitle>
          <AlertDescription>{ipcErrorText(error.id, error.params)}</AlertDescription>
          <AlertAction>
            <Button size="sm" variant="outline" onClick={() => void load(query, items.length > 0)}>
              {copy.common.retry}
            </Button>
          </AlertAction>
        </Alert>
      )}
      {firstLoad ? (
        showSkeleton && <ActivitySkeleton />
      ) : items.length === 0 ? (
        error ? null : filtered ? (
          <div className="flex flex-col items-start gap-2 text-sm text-muted-foreground">
            {copy.activityView.noMatch}
            <Button variant="outline" size="sm" onClick={() => void load({})}>
              {copy.activityView.clearFilter}
            </Button>
          </div>
        ) : (
          <EmptyState icon={HistoryIcon} title={copy.activityView.emptyTitle} description={copy.activityView.emptyDescription} />
        )
      ) : (
        <>
          {groups.map((list) => {
            const key = dayKey(list[0].at)
            return (
              <section key={key} aria-labelledby={`day-${key}`} className="flex flex-col gap-2">
                <h3 id={`day-${key}`} className="text-xs font-medium text-muted-foreground">
                  {dayTitle(list[0].at)}
                </h3>
                <Trace role="list">
                  {list.map((item) => (
                    <ActivityLine key={item.id} item={item} />
                  ))}
                </Trace>
              </section>
            )
          })}
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
    </Section>
  )
}
