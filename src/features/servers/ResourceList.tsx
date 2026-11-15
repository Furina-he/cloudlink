import { PlusIcon, ServerIcon } from "lucide-react"
import { AnimatePresence } from "motion/react"
import { useEffect, useMemo, type ReactNode, type RefObject } from "react"
import { useShallow } from "zustand/react/shallow"

import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import { useDelayedFlag } from "@/hooks/use-delayed-flag"
import { copy } from "@/lib/copy"
import { handleGridKeyDown } from "@/lib/grid-nav"
import { selectResourceGroups, useAssetStore } from "@/stores/assets"
import { useUIStore } from "@/stores/ui"
import { CliRow, ServerRow } from "./ResourceRow"

/** 一组资源（PRD 6.3）：组标题 + muted 计数，下面是白色列表卡，行间 line-2 发丝线 */
function Group({ id, title, count, empty, children }: { id: string; title: string; count: number; empty: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h2 id={id} className="flex items-baseline gap-1.5 px-1 text-[13px] font-semibold">
        {title}
        {count > 0 && <span className="text-xs font-normal text-muted-foreground tabular-nums">{count}</span>}
      </h2>
      <div role="list" aria-labelledby={id} className="divide-y divide-line-2 overflow-hidden rounded-list border border-line bg-card">
        {children ?? empty}
      </div>
    </section>
  )
}

function GroupEmpty({ text, action }: { text: string; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3 px-3 py-3 text-sm text-muted-foreground">
      {text}
      {action}
    </div>
  )
}

/**
 * 资源配电盘（PRD 6.4）：单列居中（max-w-3xl），「服务器」「云平台」两组单行回路，永远独占全宽。
 * 方向键在回路之间移动，Enter 进入详情；从详情返回时焦点回到刚才那一行
 */
export function ResourceList({
  titleRef,
  loading,
}: {
  titleRef: RefObject<HTMLHeadingElement | null>
  /** 首次加载中；Skeleton 超过 150ms 才显示，在那之前也不显示空状态 */
  loading: boolean
}) {
  const showSkeleton = useDelayedFlag(loading)
  const query = useUIStore((s) => s.query)
  const { byId, ids, freshIds, failed } = useAssetStore(
    useShallow((s) => ({ byId: s.byId, ids: s.ids, freshIds: s.freshIds, failed: s.status === "error" }))
  )
  const { servers, clis } = useMemo(() => selectResourceGroups({ byId, ids }, query), [byId, ids, query])
  const ui = useUIStore.getState
  const nothing = servers.length === 0 && clis.length === 0

  useEffect(() => {
    const id = useUIStore.getState().returnFocusId
    if (!id) return
    useUIStore.getState().clearReturnFocus()
    document.querySelector<HTMLElement>(`[data-asset-id="${CSS.escape(id)}"]`)?.focus({ preventScroll: false })
  }, [])

  return (
    <>
      <ScrollArea id="server-list" className="min-h-0 flex-1">
        <div className="@container/rows mx-auto flex w-full max-w-190 flex-col gap-6 px-5 pt-5 pb-10" onKeyDown={handleGridKeyDown}>
          <h1 ref={titleRef} id="view-title" tabIndex={-1} className="sr-only">
            {copy.nav.servers}
          </h1>
          {loading ? (
            showSkeleton && (
              <div className="flex flex-col gap-2" aria-busy="true" aria-label={copy.servers.loading}>
                {Array.from({ length: 5 }, (_, i) => (
                  <Skeleton key={i} className="h-14 rounded-list" />
                ))}
              </div>
            )
          ) : nothing && (query || failed) ? (
            <div className="flex flex-col items-center gap-2 py-8 text-sm text-muted-foreground">
              <ServerIcon className="size-4" aria-hidden />
              {failed ? copy.servers.loadFailedTitle : copy.servers.noMatch}
              {query && (
                <Button variant="outline" size="sm" onClick={() => ui().setQuery("")}>
                  {copy.servers.clearSearch}
                </Button>
              )}
            </div>
          ) : (
            <>
              {(servers.length > 0 || !query) && (
                <Group
                  id="group-servers"
                  title={copy.servers.groupServers}
                  count={servers.length}
                  empty={
                    <GroupEmpty
                      text={copy.servers.noServers}
                      action={
                        <Button variant="secondary" size="xs" onClick={() => ui().startCreate("ssh")}>
                          <PlusIcon data-icon="inline-start" />
                          {copy.servers.addServer}
                        </Button>
                      }
                    />
                  }
                >
                  {servers.length > 0 ? (
                    <AnimatePresence initial={false}>
                      {servers.map((a) => (
                        <ServerRow key={a.id} asset={a} fresh={freshIds.includes(a.id)} />
                      ))}
                    </AnimatePresence>
                  ) : null}
                </Group>
              )}
              {(clis.length > 0 || !query) && (
                <Group
                  id="group-clis"
                  title={copy.servers.groupClis}
                  count={clis.length}
                  empty={
                    <GroupEmpty
                      text={copy.servers.noClis}
                      action={
                        <Button variant="secondary" size="xs" onClick={() => ui().startCreate()}>
                          <PlusIcon data-icon="inline-start" />
                          {copy.servers.connectCli}
                        </Button>
                      }
                    />
                  }
                >
                  {clis.length > 0 ? (
                    <AnimatePresence initial={false}>
                      {clis.map((a) => (
                        <CliRow key={a.id} asset={a} fresh={freshIds.includes(a.id)} />
                      ))}
                    </AnimatePresence>
                  ) : null}
                </Group>
              )}
            </>
          )}
        </div>
      </ScrollArea>
    </>
  )
}
