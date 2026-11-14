import { PanelLeftIcon, PanelTopIcon, PlusIcon, SearchIcon, XIcon } from "lucide-react"
import { useEffect, useMemo, useRef, type ReactNode } from "react"

import { Keys } from "@/components/app/Keys"
import { UpdateReminder } from "@/components/app/UpdateReminder"
import { Button } from "@/components/ui/button"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { copy, type ViewId } from "@/lib/copy"
import { KEY_HINT } from "@/lib/hotkeys"
import { cn } from "@/lib/utils"
import { useAssetStore } from "@/stores/assets"
import { useGuardStore } from "@/stores/guard"
import { useNotesStore } from "@/stores/notes"
import { VIEWS, useUIStore } from "@/stores/ui"

/** 资源数（muted，没有资源时不显示 0）与「动态」的待确认圆点（PRD 6.2） */
function useNavMarks() {
  const count = useAssetStore((s) => (s.status === "ready" ? s.ids.length : null))
  const pending = useNotesStore((s) => Object.values(s.byAsset).some((list) => list.length > 0))
  return { count, pending }
}

function NavMark({ id }: { id: ViewId }) {
  const { count, pending } = useNavMarks()
  if (id === "servers" && count)
    return <><span aria-hidden className="text-xs text-muted-foreground tabular-nums">{count}</span><span className="sr-only">{copy.navBadge.servers(count)}</span></>
  if (id === "activity" && pending)
    return <><span aria-hidden className="size-1.5 rounded-full bg-signal" /><span className="sr-only">{copy.shell.activityPending}</span></>
  return null
}

function IconButton({ label, hint, onClick, children }: { label: string; hint?: readonly string[]; onClick: () => void; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<Button variant="toolbar" size="icon-sm" aria-label={label} onClick={onClick} />}>
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}{hint && <Keys keys={hint} />}</TooltipContent>
    </Tooltip>
  )
}

/** 顶栏搜索（PRD 6.3）：按钮或 Ctrl+F、/ 展开，过滤资源 */
function SearchControl() {
  const open = useUIStore((s) => s.searchOpen)
  const query = useUIStore((s) => s.query)
  const ref = useRef<HTMLInputElement>(null)
  const ui = useUIStore.getState
  useEffect(() => { if (open) ref.current?.focus() }, [open])
  if (!open) return <IconButton label={copy.shell.search} hint={KEY_HINT.focusSearch} onClick={() => ui().setSearchOpen(true)}><SearchIcon /></IconButton>
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
        onChange={(e) => { if (ui().view !== "servers") ui().setView("servers"); ui().setQuery(e.target.value) }}
        onKeyDown={(e) => { if (e.key !== "Escape") return; e.stopPropagation(); if (query) ui().setQuery(""); else ui().setSearchOpen(false) }}
        onBlur={() => !query && ui().setSearchOpen(false)}
      />
      {query && <Button variant="toolbar" size="icon-xs" aria-label={copy.servers.clearSearch} onMouseDown={(e) => e.preventDefault()} onClick={() => ui().setQuery("")}><XIcon /></Button>}
    </div>
  )
}

/** 右侧操作：搜索、切换导航位置、+；系统负责窗口控制。 */
function Actions() {
  const side = useUIStore((s) => s.navPosition === "side")
  const onServers = useUIStore((s) => s.view === "servers")
  const noAssets = useAssetStore((s) => s.status === "ready" && s.ids.length === 0)
  const ui = useUIStore.getState
  return (
    <div className="flex shrink-0 items-center gap-1">
      <UpdateReminder />
      <SearchControl />
      <IconButton label={side ? copy.shell.navToTop : copy.shell.navToSide} hint={KEY_HINT.navPosition} onClick={() => ui().toggleNavPosition()}>{side ? <PanelTopIcon /> : <PanelLeftIcon />}</IconButton>
      {!(onServers && noAssets) && <Tooltip>
        <TooltipTrigger render={<Button variant="add" size="icon-sm" className="ml-0.5" aria-label={copy.shell.add} onClick={() => ui().startCreate()} />}><PlusIcon /></TooltipTrigger>
        <TooltipContent>{copy.shell.add} <Keys keys={KEY_HINT.newServer} /></TooltipContent>
      </Tooltip>}
    </div>
  )
}

/** 两种导航都使用 Base UI 的选择/键盘行为，不自写 roving tabindex。 */
function NavItems({ side = false }: { side?: boolean }) {
  const view = useUIStore((s) => s.view)
  return (
    <nav aria-label={copy.shell.nav} className={side ? "px-2 pt-3" : undefined}>
      <ToggleGroup variant={side ? "nav-side" : "nav"} size={side ? "nav-side" : "nav"} spacing={0.5} orientation={side ? "vertical" : "horizontal"} className={side ? "w-full flex-col items-stretch" : "shrink-0"} value={[view]} onValueChange={(next) => { if (next[0] && VIEWS.includes(next[0] as ViewId)) useUIStore.getState().goToView(next[0] as ViewId) }}>
        {VIEWS.map((id) => <ToggleGroupItem key={id} value={id} aria-current={view === id ? "page" : undefined} onClick={() => { if (view === id) useUIStore.getState().goToView(id) }}>
          <span className={side ? "flex-1" : undefined}>{copy.nav[id]}</span>
          <NavMark id={id} />
        </ToggleGroupItem>)}
      </ToggleGroup>
    </nav>
  )
}

/** 原生系统栏下方的 48px 应用导航：靠左导航、靠右操作，不重复应用名或拖动区。 */
export function AppHeader() {
  const side = useUIStore((s) => s.navPosition === "side")
  const view = useUIStore((s) => s.view)
  return (
    <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-line bg-background px-3 select-none">
      {side ? <h2 className="min-w-0 flex-1 text-[15px] font-semibold">{copy.nav[view]}</h2> : <NavItems />}
      <Actions />
    </header>
  )
}

function GuardFooter() {
  const guards = useGuardStore((s) => s.statusByEnv)
  const list = useMemo(() => Object.values(guards).filter((g) => g !== undefined), [guards])
  if (list.length === 0) return null
  const active = list.some((g) => g.state === "active")
  const denied = list.reduce((n, g) => n + g.deniedToday, 0)
  return <div className="flex items-center gap-2 px-3 py-3 text-xs text-muted-foreground"><span aria-hidden className={cn("size-1.5 rounded-full", active ? "bg-success" : "bg-warning")} />{active ? copy.shell.guardOn(denied) : copy.shell.guardOff}</div>
}

/** 侧栏模式（F-408）：200px、四个导航项与底部护栏状态；应用名只在系统标题栏。 */
export function AppSidebar() {
  return <aside className="flex w-50 shrink-0 flex-col border-r border-line bg-background"><NavItems side /><div className="mt-auto"><GuardFooter /></div></aside>
}
