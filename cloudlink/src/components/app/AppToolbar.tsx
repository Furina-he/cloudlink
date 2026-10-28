import { CommandIcon } from "lucide-react"

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import { Kbd, KbdGroup } from "@/components/ui/kbd"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { copy } from "@/lib/copy"
import { KEY_HINT } from "@/lib/hotkeys"
import { useAssetStore } from "@/stores/assets"
import { useSkillStore } from "@/stores/skills"
import { useUIStore } from "@/stores/ui"

function Keys({ keys }: { keys: readonly string[] }) {
  return (
    <KbdGroup>
      {keys.map((k) => (
        <Kbd key={k}>{k}</Kbd>
      ))}
    </KbdGroup>
  )
}

/** 面包屑第二级：当前对象（资产名、Skill slug） */
function useCurrentObject(): string | null {
  const view = useUIStore((s) => s.view)
  const selectedAssetId = useUIStore((s) => s.selectedAssetId)
  const selectedSkillId = useUIStore((s) => s.selectedSkillId)
  const asset = useAssetStore((s) => (selectedAssetId ? s.byId[selectedAssetId]?.name : undefined))
  const skill = useSkillStore((s) => (selectedSkillId ? s.statusById[selectedSkillId]?.slug : undefined))
  if (view === "assets") return asset ?? null
  if (view === "skills") return skill ?? null
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
      <Breadcrumb aria-label={copy.shell.breadcrumb} className="min-w-0">
        <BreadcrumbList className="flex-nowrap">
          <BreadcrumbItem>
            {current ? copy.nav[view] : <BreadcrumbPage>{copy.nav[view]}</BreadcrumbPage>}
          </BreadcrumbItem>
          {current && (
            <>
              <BreadcrumbSeparator />
              <BreadcrumbItem className="min-w-0">
                <BreadcrumbPage className="truncate">{current}</BreadcrumbPage>
              </BreadcrumbItem>
            </>
          )}
        </BreadcrumbList>
      </Breadcrumb>
      <div className="flex-1" />
      {/* 当前视图的操作区（ButtonGroup），各视图在 P2、P3 填充 */}
      <div id="view-actions" className="flex items-center gap-1" />
      <Button variant="outline" size="sm" onClick={() => setCommandOpen(true)}>
        <CommandIcon data-icon="inline-start" />
        {copy.shell.openCommand}
        <Keys keys={KEY_HINT.command} />
      </Button>
    </header>
  )
}
