import {
  CableIcon,
  CircleCheckIcon,
  CircleXIcon,
  HistoryIcon,
  MonitorIcon,
  PackageIcon,
  ServerIcon,
  SettingsIcon,
  SquareTerminalIcon,
  type LucideIcon,
} from "lucide-react"
import { useShallow } from "zustand/react/shallow"

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
} from "@/components/ui/sidebar"
import { copy, type ViewId } from "@/lib/copy"
import { cn } from "@/lib/utils"
import { useAssetStore } from "@/stores/assets"
import { selectHealth, useMountStore } from "@/stores/mounts"
import { useSkillStore } from "@/stores/skills"
import { useTargetStore } from "@/stores/targets"
import { VIEWS, useUIStore } from "@/stores/ui"

const NAV_ICON: Record<ViewId, LucideIcon> = {
  assets: ServerIcon,
  skills: PackageIcon,
  mounts: CableIcon,
  activity: HistoryIcon,
  settings: SettingsIcon,
}

/** 侧栏计数（PRD 6.2）：资产总数；Skills 受阻数、挂载失效与冲突数大于 0 时用状态红 */
function useNavCounts(): Partial<Record<ViewId, { n: number; danger: boolean; label: string }>> {
  const assetCount = useAssetStore((s) => (s.status === "ready" ? s.ids.length : null))
  const broken = useMountStore((s) => {
    const h = selectHealth(Object.values(s.byId), [])
    return h.broken + h.conflict
  })
  const blocked = useSkillStore(
    (s) => selectHealth([], Object.values(s.statusById)).blocked
  )
  return {
    ...(assetCount !== null && {
      assets: { n: assetCount, danger: false, label: copy.navBadge.assets(assetCount) },
    }),
    ...(blocked > 0 && {
      skills: { n: blocked, danger: true, label: copy.navBadge.skills(blocked) },
    }),
    ...(broken > 0 && {
      mounts: { n: broken, danger: true, label: copy.navBadge.mounts(broken) },
    }),
  }
}

function EnvStatus() {
  const { environments, status } = useTargetStore(
    useShallow((s) => ({ environments: s.environments, status: s.status }))
  )
  const openSettings = () => {
    useUIStore.getState().setSettingsSection("environments")
    useUIStore.getState().setView("settings")
  }

  if (status === "idle" || status === "loading") {
    return <SidebarMenuSkeleton showIcon aria-label={copy.shell.envLoading} />
  }

  const allOk = environments.length > 0 && environments.every((e) => e.available)
  const summary = environments
    .map((e) => `${copy.env.long(e.id)} ${e.available ? copy.shell.envAvailable : copy.shell.envUnavailable}`)
    .join("、")

  return (
    <SidebarMenu>
      {/* 折叠为图标模式时只剩这一项：一个总状态图标，Tooltip 给出完整摘要 */}
      <SidebarMenuItem>
        <SidebarMenuButton
          tooltip={summary}
          onClick={openSettings}
          aria-label={`${copy.shell.envStatusLink}：${summary}`}
          className="group-data-[collapsible=icon]:flex hidden"
        >
          {allOk ? (
            <CircleCheckIcon className="text-success" />
          ) : (
            <CircleXIcon className="text-destructive" />
          )}
        </SidebarMenuButton>
      </SidebarMenuItem>
      {environments.map((e) => {
        const EnvIcon = e.id === "windows" ? MonitorIcon : SquareTerminalIcon
        return (
          <SidebarMenuItem key={e.id} className="group-data-[collapsible=icon]:hidden">
            <SidebarMenuButton size="sm" onClick={openSettings}>
              <EnvIcon />
              <span className="truncate">{copy.env.long(e.id)}</span>
              <span
                className={cn(
                  "ml-auto flex shrink-0 items-center gap-1 text-xs",
                  e.available ? "text-success" : "text-destructive"
                )}
              >
                {e.available ? (
                  <CircleCheckIcon className="size-3" />
                ) : (
                  <CircleXIcon className="size-3" />
                )}
                {e.available ? copy.shell.envAvailable : copy.shell.envUnavailable}
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        )
      })}
    </SidebarMenu>
  )
}

export function AppSidebar() {
  const view = useUIStore((s) => s.view)
  const setView = useUIStore((s) => s.setView)
  const counts = useNavCounts()

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex h-8 items-center px-2 text-sm font-semibold group-data-[collapsible=icon]:sr-only">
          {copy.app.name}
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {VIEWS.map((id) => {
                const Icon = NAV_ICON[id]
                const count = counts[id]
                return (
                  <SidebarMenuItem key={id}>
                    <SidebarMenuButton
                      isActive={view === id}
                      aria-current={view === id ? "page" : undefined}
                      tooltip={copy.nav[id]}
                      onClick={() => setView(id)}
                    >
                      <Icon />
                      <span>{copy.nav[id]}</span>
                    </SidebarMenuButton>
                    {count && (
                      <SidebarMenuBadge className={cn(count.danger && "text-destructive")}>
                        <span aria-hidden>{count.n}</span>
                        <span className="sr-only">{count.label}</span>
                      </SidebarMenuBadge>
                    )}
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarGroup className="p-0">
          <SidebarGroupLabel>{copy.shell.envStatusTitle}</SidebarGroupLabel>
          <EnvStatus />
        </SidebarGroup>
      </SidebarFooter>
    </Sidebar>
  )
}
