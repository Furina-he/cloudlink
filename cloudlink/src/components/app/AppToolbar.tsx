import { CommandIcon } from "lucide-react"

import { Keys } from "@/components/app/Keys"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { copy } from "@/lib/copy"
import { KEY_HINT } from "@/lib/hotkeys"
import { cn } from "@/lib/utils"
import { useAssetStore } from "@/stores/assets"
import { useUIStore } from "@/stores/ui"

/** 面包屑第二级（PRD 6.3）：服务器视图是别名（等宽）或「新建服务器」，设置视图是当前分区 */
function useCurrentObject(): { text: string; mono: boolean } | null {
  const view = useUIStore((s) => s.view)
  const selectedAssetId = useUIStore((s) => s.selectedAssetId)
  const creating = useUIStore((s) => s.creating)
  const section = useUIStore((s) => s.settingsSection)
  const alias = useAssetStore((s) => (selectedAssetId ? s.byId[selectedAssetId]?.connection.sshAlias : undefined))
  if (view === "servers") {
    if (creating) return { text: copy.detail.newTitle, mono: false }
    return alias ? { text: alias, mono: true } : null
  }
  if (view === "settings") return { text: copy.settings.section[section], mono: false }
  return null
}

/** 工具栏（PRD 6.3）：SidebarTrigger、Separator、Breadcrumb、弹性空白、视图操作、命令面板按钮 */
export function AppToolbar() {
  const view = useUIStore((s) => s.view)
  const setCommandOpen = useUIStore((s) => s.setCommandOpen)
  const current = useCurrentObject()

  return (
    <header className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
      <Tooltip>
        <TooltipTrigger
          render={<SidebarTrigger aria-label={copy.shell.toggleSidebar} />}
        />
        <TooltipContent>
          {copy.shell.toggleSidebar} <Keys keys={KEY_HINT.sidebar} />
        </TooltipContent>
      </Tooltip>
      <Separator orientation="vertical" className="data-vertical:h-4 data-vertical:self-center" />
      <Breadcrumb aria-label={copy.shell.breadcrumb} className="min-w-0 whitespace-nowrap">
        <BreadcrumbList className="flex-nowrap">
          <BreadcrumbItem>
            {current ? copy.nav[view] : <BreadcrumbPage>{copy.nav[view]}</BreadcrumbPage>}
          </BreadcrumbItem>
          {current && (
            <>
              <BreadcrumbSeparator />
              <BreadcrumbItem className="min-w-0">
                <BreadcrumbPage className={cn("truncate", current.mono && "font-mono")}>{current.text}</BreadcrumbPage>
              </BreadcrumbItem>
            </>
          )}
        </BreadcrumbList>
      </Breadcrumb>
      <div className="flex-1" />
      {/* 当前视图的操作区：各视图用 createPortal 渲染到这里 */}
      <div id="view-actions" className="flex shrink-0 items-center gap-1" />
      <Button variant="outline" size="sm" className="shrink-0" onClick={() => setCommandOpen(true)}>
        <CommandIcon data-icon="inline-start" />
        {/* 窄窗口下工具栏放不下，只留图标和快捷键 */}
        <span className="max-xl:sr-only">{copy.shell.openCommand}</span>
        <Keys keys={KEY_HINT.command} />
      </Button>
    </header>
  )
}
