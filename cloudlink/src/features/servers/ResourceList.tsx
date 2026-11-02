import type { CliProvider } from "@/bindings"
import { ChevronDownIcon, FileInputIcon, PlusIcon, SearchIcon, ServerIcon, XIcon } from "lucide-react"
import { AnimatePresence } from "motion/react"
import { useEffect, useMemo, type ReactNode, type RefObject } from "react"
import { createPortal } from "react-dom"
import { useShallow } from "zustand/react/shallow"

import { ProviderMark } from "@/components/app/ProviderMark"
import { useToolbarSlot } from "@/components/app/ViewShell"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import { useDelayedFlag } from "@/hooks/use-delayed-flag"
import { CLI_PROVIDERS } from "@/lib/cliProviders"
import { copy } from "@/lib/copy"
import { handleGridKeyDown } from "@/lib/grid-nav"
import { selectResourceGroups, useAssetStore } from "@/stores/assets"
import { useUIStore } from "@/stores/ui"
import { CliRow, ServerRow } from "./BreakerRow"

/**
 * 顶栏右侧的资源操作（PRD 6.2）：紧凑搜索框、「+ 添加服务器」主按钮、「+ 云平台 ▾」下拉
 * （Cloudflare、Vercel、Oracle Cloud 官方 Logo，从 ssh config 导入）。v0.1 每家云平台只接入一次
 */
function HeaderActions({ searchRef }: { searchRef: RefObject<HTMLInputElement | null> }) {
  const query = useUIStore((s) => s.query)
  const providers = useAssetStore(useShallow((s) => s.ids.map((id) => s.byId[id]).flatMap((a) => (a.type === "cli" ? [a.cliProvider] : []))))
  const added = (p: CliProvider) => providers.filter((x) => x === p).length
  const ui = useUIStore.getState
  return (
    <>
      <InputGroup className="h-8 w-44 max-[819px]:w-36">
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
      <Button size="sm" className="shrink-0" onClick={() => ui().startCreate("ssh")}>
        <PlusIcon data-icon="inline-start" />
        {copy.servers.addServer}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="outline" size="sm" className="shrink-0" />}>
          <PlusIcon data-icon="inline-start" />
          {copy.servers.addCli}
          <ChevronDownIcon data-icon="inline-end" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-auto min-w-52">
          {CLI_PROVIDERS.map((p) => (
            <DropdownMenuItem key={p} onClick={() => ui().startCreate(p)}>
              <ProviderMark provider={p} />
              {copy.cli.name[p]}
              {added(p) > 0 && <span className="ml-auto pl-3 text-xs text-muted-foreground">{copy.create.addedCount(added(p))}</span>}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => ui().setImportOpen(true)}>
            <FileInputIcon />
            {copy.servers.importSsh}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  )
}

/** 一组回路：标题只写「服务器」「云平台」，不重复列头（DESIGN.md Signature 1） */
function Group({ id, title, empty, children }: { id: string; title: string; empty: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-1.5">
      <h2 id={id} className="px-1 text-sm font-semibold">
        {title}
      </h2>
      <div role="list" aria-labelledby={id} className="divide-y overflow-hidden rounded-xl border">
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
  searchRef,
  loading,
}: {
  titleRef: RefObject<HTMLHeadingElement | null>
  searchRef: RefObject<HTMLInputElement | null>
  /** 首次加载中；Skeleton 超过 150ms 才显示，在那之前也不显示空状态 */
  loading: boolean
}) {
  const showSkeleton = useDelayedFlag(loading)
  const slot = useToolbarSlot()
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
      {slot && createPortal(<HeaderActions searchRef={searchRef} />, slot)}
      <ScrollArea id="server-list" className="min-h-0 flex-1">
        <div className="@container/rows mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 pt-4 pb-8" onKeyDown={handleGridKeyDown}>
          <h1 ref={titleRef} id="view-title" tabIndex={-1} className="sr-only">
            {copy.nav.servers}
          </h1>
          {loading ? (
            showSkeleton && (
              <div className="flex flex-col gap-2" aria-busy="true" aria-label={copy.servers.loading}>
                {Array.from({ length: 5 }, (_, i) => (
                  <Skeleton key={i} className="h-11 rounded-lg" />
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
                  empty={
                    <GroupEmpty
                      text={copy.servers.noServers}
                      action={
                        <Button variant="outline" size="xs" onClick={() => ui().startCreate("ssh")}>
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
                        <ServerRow key={a.id} asset={a} current={false} fresh={freshIds.includes(a.id)} />
                      ))}
                    </AnimatePresence>
                  ) : null}
                </Group>
              )}
              {(clis.length > 0 || !query) && (
                <Group
                  id="group-clis"
                  title={copy.servers.groupClis}
                  empty={
                    <GroupEmpty
                      text={copy.servers.noClis}
                      action={
                        <Button variant="outline" size="xs" onClick={() => ui().startCreate()}>
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
                        <CliRow key={a.id} asset={a} current={false} fresh={freshIds.includes(a.id)} />
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
