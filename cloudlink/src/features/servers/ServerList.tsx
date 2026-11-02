import { ChevronDownIcon, CircleIcon, FileInputIcon, PlusIcon, SearchIcon, ServerIcon, XIcon } from "lucide-react"
import { AnimatePresence } from "motion/react"
import { useMemo, type RefObject } from "react"
import { useShallow } from "zustand/react/shallow"

import { ENV_DOT } from "@/components/app/EnvBadge"
import { Button } from "@/components/ui/button"
import { ButtonGroup } from "@/components/ui/button-group"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import { useDelayedFlag } from "@/hooks/use-delayed-flag"
import { copy } from "@/lib/copy"
import { handleGridKeyDown } from "@/lib/grid-nav"
import { cn } from "@/lib/utils"
import { selectServerGroups, useAssetStore } from "@/stores/assets"
import { useUIStore } from "@/stores/ui"
import { ServerCard } from "./ServerCard"

const GRID = "grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2 max-[1023px]:grid-cols-1"

/** 服务器列表（PRD 6.4）：一个搜索框，卡片按「生产 / 预发 / 开发」分组 */
export function ServerList({
  titleRef,
  searchRef,
  loading,
}: {
  titleRef: RefObject<HTMLHeadingElement | null>
  searchRef: RefObject<HTMLInputElement | null>
  /** 首次加载中；Skeleton 超过 150ms 才显示，在那之前也不显示空状态 */
  loading: boolean
}) {
  const showSkeleton = useDelayedFlag(loading)
  const query = useUIStore((s) => s.query)
  const selectedAssetId = useUIStore((s) => s.selectedAssetId)
  const { byId, ids, freshIds, failed } = useAssetStore(
    useShallow((s) => ({ byId: s.byId, ids: s.ids, freshIds: s.freshIds, failed: s.status === "error" }))
  )
  const groups = useMemo(() => selectServerGroups({ byId, ids }, query), [byId, ids, query])
  const ui = useUIStore.getState

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 px-3 pt-3 pb-2">
        <h1 ref={titleRef} id="view-title" tabIndex={-1} className="text-base font-semibold outline-none">
          {copy.nav.servers}
        </h1>
        <ButtonGroup className="ml-auto">
          <Button size="sm" onClick={() => ui().startCreate()}>
            <PlusIcon data-icon="inline-start" />
            {copy.servers.newServer}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button size="icon-sm" aria-label={copy.servers.moreCreate} />}>
              <ChevronDownIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-auto">
              <DropdownMenuItem onClick={() => ui().setImportOpen(true)}>
                <FileInputIcon />
                {copy.servers.importSsh}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </ButtonGroup>
      </div>
      <div className="px-3 pb-2">
        <InputGroup>
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            ref={searchRef}
            value={query}
            onChange={(e) => ui().setQuery(e.target.value)}
            onKeyDown={(e) => {
              // Esc 先清空搜索；已经是空的才交给外层
              if (e.key !== "Escape" || !query) return
              e.stopPropagation()
              ui().setQuery("")
            }}
            placeholder={copy.servers.searchPlaceholder}
            aria-label={copy.servers.searchLabel}
          />
          {query && (
            <InputGroupAddon align="inline-end">
              <InputGroupButton size="icon-xs" aria-label={copy.servers.clearSearch} onClick={() => ui().setQuery("")}>
                <XIcon />
              </InputGroupButton>
            </InputGroupAddon>
          )}
        </InputGroup>
      </div>

      <ScrollArea id="server-list" className="min-h-0 flex-1">
        <div className="flex flex-col gap-4 px-3 pb-4" onKeyDown={handleGridKeyDown}>
          {loading ? (
            showSkeleton && (
              <div className={GRID} aria-busy="true" aria-label={copy.servers.loading}>
                {Array.from({ length: 4 }, (_, i) => (
                  <Skeleton key={i} className="h-28 rounded-xl" />
                ))}
              </div>
            )
          ) : groups.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-sm text-muted-foreground">
              <ServerIcon className="size-4" aria-hidden />
              {failed ? copy.servers.loadFailedTitle : query ? copy.servers.noMatch : copy.onboarding.title}
              {query && (
                <Button variant="outline" size="sm" onClick={() => ui().setQuery("")}>
                  {copy.servers.clearSearch}
                </Button>
              )}
            </div>
          ) : (
            groups.map((g) => (
              <section key={g.env} aria-labelledby={`group-${g.env}`} className="flex flex-col gap-2">
                <h2 id={`group-${g.env}`} className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <CircleIcon className={cn("size-2 fill-current", ENV_DOT[g.env])} aria-hidden />
                  {copy.env.tag[g.env]}
                </h2>
                <div className={GRID} role="group" aria-label={copy.servers.gridLabel(copy.env.tag[g.env])}>
                  <AnimatePresence initial={false}>
                    {g.assets.map((a) => (
                      <ServerCard
                        key={a.id}
                        asset={a}
                        current={a.id === selectedAssetId}
                        fresh={freshIds.includes(a.id)}
                        onOpen={() => ui().selectAsset(a.id)}
                      />
                    ))}
                  </AnimatePresence>
                </div>
              </section>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
