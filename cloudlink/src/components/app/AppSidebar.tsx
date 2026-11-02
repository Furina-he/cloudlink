import { BotIcon, CircleCheckIcon, CircleXIcon, ServerIcon, SettingsIcon, type LucideIcon } from "lucide-react"
import { useMemo } from "react"
import { useShallow } from "zustand/react/shallow"

import { EnvIcon } from "@/components/app/StateBadge"
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
import { useDeliveryStore } from "@/stores/deliveries"
import { useGuardStore } from "@/stores/guard"
import { selectHealth } from "@/stores/health"
import { useSkillStore } from "@/stores/skills"
import { useTargetStore } from "@/stores/targets"
import { VIEWS, useUIStore } from "@/stores/ui"

const NAV_ICON: Record<ViewId, LucideIcon> = {
  servers: ServerIcon,
  agents: BotIcon,
  settings: SettingsIcon,
}

/** 侧栏计数（PRD 6.2）：服务器总数，有编译受阻时改为红色受阻数；Agent 页需要处理的问题数（红色） */
function useNavCounts(): Partial<Record<ViewId, { n: number; danger: boolean; label: string }>> {
  const serverCount = useAssetStore((s) => (s.status === "ready" ? s.ids.length : null))
  const deliveries = useDeliveryStore((s) => s.byId)
  const guards = useGuardStore((s) => s.statusByEnv)
  const statusByKey = useSkillStore((s) => s.statusByKey)
  const health = useMemo(() => selectHealth(Object.values(deliveries), Object.values(guards), Object.values(statusByKey)), [deliveries, guards, statusByKey])
  const problems = health.deliveryProblems + health.guardProblems
  const blocked = health.blockedAssets

  return {
    ...(blocked > 0
      ? { servers: { n: blocked, danger: true, label: copy.navBadge.blocked(blocked) } }
      : serverCount !== null && { servers: { n: serverCount, danger: false, label: copy.navBadge.servers(serverCount) } }),
    ...(problems > 0 && { agents: { n: problems, danger: true, label: copy.navBadge.agents(problems) } }),
  }
}

/** 侧栏底部的运行环境状态（PRD 6.2）：点击后跳到「设置 / 运行环境」 */
function EnvStatus() {
  const { environments, status } = useTargetStore(useShallow((s) => ({ environments: s.environments, status: s.status })))
  // 切换视图可能被「未保存的修改」拦下：真的离开了再定位分区
  const openSettings = () =>
    useUIStore.getState().setView("settings", { then: () => useUIStore.getState().setSettingsSection("environments") })

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
          className="hidden group-data-[collapsible=icon]:flex"
        >
          {allOk ? <CircleCheckIcon className="text-success" /> : <CircleXIcon className="text-destructive" />}
        </SidebarMenuButton>
      </SidebarMenuItem>
      {environments.map((e) => (
        <SidebarMenuItem key={e.id} className="group-data-[collapsible=icon]:hidden">
          <SidebarMenuButton size="sm" onClick={openSettings}>
            <EnvIcon envId={e.id} />
            <span className="truncate">{copy.env.long(e.id)}</span>
            <span className={cn("ml-auto flex shrink-0 items-center gap-1 text-xs", e.available ? "text-success" : "text-destructive")}>
              {e.available ? <CircleCheckIcon className="size-3" /> : <CircleXIcon className="size-3" />}
              {e.available ? copy.shell.envAvailable : copy.shell.envUnavailable}
            </span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ))}
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
        <div className="flex h-8 items-center px-2 text-sm font-semibold group-data-[collapsible=icon]:sr-only">{copy.app.name}</div>
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
