import { CopyIcon, MinusIcon, PanelLeftIcon, PanelTopIcon, PlusIcon, SearchIcon, XIcon } from "lucide-react"
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"

import { Keys } from "@/components/app/Keys"
import { UpdateReminder } from "@/components/app/UpdateReminder"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { copy, type ViewId } from "@/lib/copy"
import { ipc } from "@/lib/ipc"
import { KEY_HINT } from "@/lib/hotkeys"
import { cn } from "@/lib/utils"
import { useAssetStore } from "@/stores/assets"
import { useGuardStore } from "@/stores/guard"
import { useNotesStore } from "@/stores/notes"
import { VIEWS, useUIStore } from "@/stores/ui"

/** 资源数（muted）与「动态」的待确认圆点（PRD 6.2） */
function useNavMarks() {
  const count = useAssetStore((s) => (s.status === "ready" ? s.ids.length : null))
  const pending = useNotesStore((s) => Object.values(s.byAsset).some((list) => list.length > 0))
  return { count, pending }
}

function NavMark({ id }: { id: ViewId }) {
  const { count, pending } = useNavMarks()
  if (id === "servers" && count !== null)
    return (
      <>
        <span aria-hidden className="text-xs text-muted-foreground tabular-nums">
          {count}
        </span>
        <span className="sr-only">{copy.navBadge.servers(count)}</span>
      </>
    )
  if (id === "activity" && pending)
    return (
      <>
        <span aria-hidden className="size-1.5 rounded-full bg-signal" />
        <span className="sr-only">{copy.shell.activityPending}</span>
      </>
    )
  return null
}

function IconButton({ label, hint, onClick, children, className }: { label: string; hint?: readonly string[]; onClick: () => void; children: ReactNode; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={label}
            onClick={onClick}
            className={cn(
              "inline-flex size-7 shrink-0 items-center justify-center rounded-button text-ctl-fg outline-none hover:bg-pill-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-4",
              className
            )}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>
        {label}
        {hint && <Keys keys={hint} />}
      </TooltipContent>
    </Tooltip>
  )
}

/** 顶栏搜索（PRD 6.3）：按钮或 Ctrl+F、/ 展开，过滤资源 */
function SearchControl() {
  const open = useUIStore((s) => s.searchOpen)
  const query = useUIStore((s) => s.query)
  const ref = useRef<HTMLInputElement>(null)
  const ui = useUIStore.getState
  useEffect(() => {
    if (open) ref.current?.focus()
  }, [open])
  if (!open)
    return (
      <IconButton label={copy.shell.search} hint={KEY_HINT.focusSearch} onClick={() => ui().setSearchOpen(true)}>
        <SearchIcon />
      </IconButton>
    )
  return (
    <div className="flex h-7 w-44 items-center gap-1.5 rounded-control bg-pill px-2 text-ctl-fg focus-within:ring-2 focus-within:ring-ring max-[859px]:w-36">
      <SearchIcon className="size-3.5 shrink-0" aria-hidden />
      <input
        ref={ref}
        id="resource-search"
        value={query}
        placeholder={copy.servers.searchPlaceholder}
        aria-label={copy.servers.searchLabel}
        className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
        onChange={(e) => {
          if (ui().view !== "servers") ui().setView("servers")
          ui().setQuery(e.target.value)
        }}
        onKeyDown={(e) => {
          if (e.key !== "Escape") return
          e.stopPropagation()
          if (query) ui().setQuery("")
          else ui().setSearchOpen(false)
        }}
        onBlur={() => !query && ui().setSearchOpen(false)}
      />
      {query && (
        <button type="button" aria-label={copy.servers.clearSearch} className="rounded-sm hover:text-foreground" onMouseDown={(e) => e.preventDefault()} onClick={() => ui().setQuery("")}>
          <XIcon className="size-3.5" />
        </button>
      )}
    </div>
  )
}

/** 右侧操作：搜索、切换导航位置、+（钢墨方块） */
function Actions() {
  const side = useUIStore((s) => s.navPosition === "side")
  // 资源页的空状态自己有「+ 添加服务器」，顶栏不再重复（PRD 6.9）
  const onServers = useUIStore((s) => s.view === "servers")
  const noAssets = useAssetStore((s) => s.status === "ready" && s.ids.length === 0)
  const ui = useUIStore.getState
  return (
    <div className="flex items-center gap-1" data-no-drag>
      <UpdateReminder />
      <SearchControl />
      <IconButton label={side ? copy.shell.navToTop : copy.shell.navToSide} hint={KEY_HINT.navPosition} onClick={() => ui().toggleNavPosition()}>
        {side ? <PanelTopIcon /> : <PanelLeftIcon />}
      </IconButton>
      {!(onServers && noAssets) && (
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label={copy.shell.add}
                onClick={() => ui().startCreate()}
                className="ml-0.5 inline-flex size-7 items-center justify-center rounded-button bg-ink text-primary-foreground outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 [&_svg]:size-4"
              />
            }
          >
            <PlusIcon />
          </TooltipTrigger>
          <TooltipContent>
            {copy.shell.add} <Keys keys={KEY_HINT.newServer} />
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  )
}

/** 自绘窗口按钮（decorations: false），浏览器 Mock 模式下点击无效果 */
function WindowControls() {
  const [, force] = useState(0)
  const btn = "inline-flex h-12 w-11 items-center justify-center text-ctl-fg outline-none hover:bg-pill-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&_svg]:size-4"
  return (
    <div className="-mr-3 ml-2 flex items-center border-l border-line pl-0" data-no-drag>
      <button type="button" aria-label={copy.shell.minimize} className={btn} onClick={() => void ipc.minimizeWindow().catch(() => {})}>
        <MinusIcon />
      </button>
      <button type="button" aria-label={copy.shell.maximize} className={btn} onClick={() => void ipc.toggleMaximizeWindow().then(() => force((n) => n + 1)).catch(() => {})}>
        <CopyIcon className="size-3.5! -scale-x-100" />
      </button>
      <button type="button" aria-label={copy.shell.close} className={cn(btn, "hover:bg-destructive hover:text-white")} onClick={() => void ipc.closeWindow().catch(() => {})}>
        <XIcon />
      </button>
    </div>
  )
}

function NavItemsTop() {
  const view = useUIStore((s) => s.view)
  return (
    <nav aria-label={copy.shell.nav} className="flex items-center gap-0.5 rounded-tile bg-seg-track p-0.5" data-no-drag>
      {VIEWS.map((id) => (
        <button
          key={id}
          type="button"
          aria-current={view === id ? "page" : undefined}
          onClick={() => useUIStore.getState().goToView(id)}
          className={cn(
            "inline-flex h-6.5 items-center gap-1.5 rounded-control px-3 text-[13px] text-ctl-fg outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
            view === id && "bg-card font-medium text-foreground shadow-xs"
          )}
        >
          {copy.nav[id]}
          <NavMark id={id} />
        </button>
      ))}
    </nav>
  )
}

/** 顶栏模式（PRD 6.2）：左 CloudLink、正中分段导航、右操作和窗口按钮；空白处可拖动窗口 */
export function AppHeader() {
  const side = useUIStore((s) => s.navPosition === "side")
  const view = useUIStore((s) => s.view)
  return (
    <header data-tauri-drag-region className="relative flex h-12 shrink-0 items-center gap-3 border-b border-line bg-background px-3 select-none">
      {side ? (
        <h2 data-tauri-drag-region className="text-[15px] font-semibold">
          {copy.nav[view]}
        </h2>
      ) : (
        <>
          <span data-tauri-drag-region className="text-sm font-semibold">
            {copy.app.name}
          </span>
          <div className="pointer-events-none absolute inset-x-0 flex justify-center">
            <div className="pointer-events-auto">
              <NavItemsTop />
            </div>
          </div>
        </>
      )}
      <div data-tauri-drag-region className="h-full flex-1" />
      <div className="relative">
        <Actions />
      </div>
      <WindowControls />
    </header>
  )
}

function GuardFooter() {
  const guards = useGuardStore((s) => s.statusByEnv)
  const list = useMemo(() => Object.values(guards).filter((g) => g !== undefined), [guards])
  if (list.length === 0) return null
  const active = list.some((g) => g.state === "active")
  const denied = list.reduce((n, g) => n + g.deniedToday, 0)
  return (
    <div className="flex items-center gap-2 px-3 py-3 text-xs text-muted-foreground">
      <span aria-hidden className={cn("size-1.5 rounded-full", active ? "bg-success" : "bg-warning")} />
      {active ? copy.shell.guardOn(denied) : copy.shell.guardOff}
    </div>
  )
}

/** 侧栏模式（F-408）：200px，CloudLink、四个导航项、底部护栏状态 */
export function AppSidebar() {
  const view = useUIStore((s) => s.view)
  return (
    <aside className="flex w-50 shrink-0 flex-col border-r border-line bg-background">
      <div data-tauri-drag-region className="flex h-12 items-center px-4 text-sm font-semibold select-none">
        {copy.app.name}
      </div>
      <nav aria-label={copy.shell.nav} className="flex flex-col gap-0.5 px-2">
        {VIEWS.map((id) => (
          <button
            key={id}
            type="button"
            aria-current={view === id ? "page" : undefined}
            onClick={() => useUIStore.getState().goToView(id)}
            className={cn(
              "flex h-8 items-center gap-2 rounded-control px-2.5 text-left text-[13px] text-fg-2 outline-none hover:bg-pill-hover focus-visible:ring-2 focus-visible:ring-ring",
              view === id && "bg-pill font-medium text-foreground"
            )}
          >
            <span className="flex-1">{copy.nav[id]}</span>
            <NavMark id={id} />
          </button>
        ))}
      </nav>
      <div className="mt-auto">
        <GuardFooter />
      </div>
    </aside>
  )
}
