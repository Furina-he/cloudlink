import { CommandIcon } from "lucide-react"
import { useMemo } from "react"

import { Keys } from "@/components/app/Keys"
import { UpdateReminder } from "@/components/app/UpdateReminder"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { copy, type ViewId } from "@/lib/copy"
import { KEY_HINT } from "@/lib/hotkeys"
import { cn } from "@/lib/utils"
import { useAssetStore } from "@/stores/assets"
import { useDeliveryStore } from "@/stores/deliveries"
import { useGuardStore } from "@/stores/guard"
import { selectHealth } from "@/stores/health"
import { useSkillStore } from "@/stores/skills"
import { VIEWS, useUIStore } from "@/stores/ui"

/** 导航计数（PRD 6.2）：资源总数，有编译受阻时改为红色受阻数；Agent 页需要处理的问题数（红色） */
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

/**
 * 顶部 48px 一体栏（PRD 6.2、DESIGN.md Layout）：左侧应用名和三项视图切换，右侧是当前视图的操作、命令面板和更新提醒。
 * 整个应用只有这一条导航，没有侧栏和面包屑
 */
export function AppHeader() {
  const view = useUIStore((s) => s.view)
  const setCommandOpen = useUIStore((s) => s.setCommandOpen)
  const counts = useNavCounts()

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b px-3">
      <span className="text-sm font-semibold">{copy.app.name}</span>
      <nav aria-label={copy.shell.nav} className="flex items-center gap-0.5 rounded-lg bg-muted p-0.5">
        {VIEWS.map((id) => {
          const count = counts[id]
          const active = view === id
          return (
            <Button
              key={id}
              variant="ghost"
              size="xs"
              aria-current={active ? "page" : undefined}
              onClick={() => useUIStore.getState().goToView(id)}
              className={cn("h-7 gap-1.5 px-2.5 text-muted-foreground hover:text-foreground", active && "bg-background text-foreground shadow-none hover:bg-background")}
            >
              {copy.nav[id]}
              {count && (
                <>
                  <span aria-hidden className={cn("text-xs tabular-nums", count.danger ? "text-destructive" : "text-muted-foreground")}>
                    {count.n}
                  </span>
                  <span className="sr-only">{count.label}</span>
                </>
              )}
            </Button>
          )
        })}
      </nav>
      {/* 当前视图的操作区：各视图用 createPortal 渲染到这里 */}
      <div id="view-actions" className="ml-auto flex min-w-0 items-center gap-1.5" />
      <Tooltip>
        <TooltipTrigger render={<Button variant="outline" size="icon-sm" className="shrink-0" aria-label={copy.shell.openCommand} onClick={() => setCommandOpen(true)} />}>
          <CommandIcon />
        </TooltipTrigger>
        <TooltipContent>
          {copy.shell.openCommand} <Keys keys={KEY_HINT.command} />
        </TooltipContent>
      </Tooltip>
      {/* 最右侧：只在发现新版本时出现，不占位（F-406） */}
      <UpdateReminder />
    </header>
  )
}
