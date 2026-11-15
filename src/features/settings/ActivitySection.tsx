import { CircleXIcon, HistoryIcon } from "lucide-react"
import { useEffect, useMemo } from "react"

import type { ActivityItem } from "@/bindings"
import { EmptyState } from "@/components/app/EmptyState"
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { useDelayedFlag } from "@/hooks/use-delayed-flag"
import { copy, ipcErrorText } from "@/lib/copy"
import { dayKey, formatDay } from "@/lib/format"
import { useActivityStore } from "@/stores/activity"
import { useUIStore } from "@/stores/ui"
import { ActivityLine } from "./ActivityParts"

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
      <Skeleton className="h-40 rounded-list" />
    </div>
  )
}

/**
 * 活动日志（PRD 6.8、F-402）：按天分组，每天一张列表卡，每次加载 100 条；筛选在面板标题行（ActivityFilters）。
 * 只记 CloudLink 自己做的事，Agent 执行的命令在「动态」页，底部一句话指过去
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
    <section aria-label={copy.settings.activityLog} className="flex min-w-0 flex-col gap-4">
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
              <section key={key} aria-labelledby={`day-${key}`} className="flex flex-col gap-1.5">
                <h3 id={`day-${key}`} className="px-1 text-xs font-medium text-muted-foreground">
                  {dayTitle(list[0].at)}
                </h3>
                <div role="list" className="divide-y divide-line-2 overflow-hidden rounded-list border border-line bg-card">
                  {list.map((item) => (
                    <ActivityLine key={item.id} item={item} />
                  ))}
                </div>
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
      <p className="px-1 text-xs leading-relaxed text-muted-foreground">
        {copy.activityView.footLead}
        <button
          type="button"
          className="rounded-sm underline underline-offset-2 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => {
            useUIStore.getState().setActivityLogOpen(false)
            useUIStore.getState().setView("activity")
          }}
        >
          {copy.nav.activity}
        </button>
        {copy.activityView.footTail}
      </p>
    </section>
  )
}
