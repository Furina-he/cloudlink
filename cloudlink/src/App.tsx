import { CircleXIcon } from "lucide-react"
import { useEffect, type ComponentType } from "react"
import { useHotkeys } from "react-hotkeys-hook"

import { AppSidebar } from "@/components/app/AppSidebar"
import { AppToolbar } from "@/components/app/AppToolbar"
import { CommandMenu } from "@/components/app/CommandMenu"
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { toast } from "@/components/ui/toast"
import { AgentsView } from "@/features/agents/AgentsView"
import { GuardDialogs } from "@/features/agents/GuardDialogs"
import { serverActions } from "@/features/servers/actions"
import { HostKeyDialog } from "@/features/servers/HostKeyDialog"
import { ImportDialog } from "@/features/servers/ImportDialog"
import { ServerActionDialogs } from "@/features/servers/ServerActionDialogs"
import { ServersView } from "@/features/servers/ServersView"
import { SettingsView } from "@/features/settings/SettingsView"
import { copy, ipcErrorText, type ViewId } from "@/lib/copy"
import { HOTKEY_OPTIONS, HOTKEYS, isModalOpen, VIEW_BY_DIGIT } from "@/lib/hotkeys"
import { cn } from "@/lib/utils"
import { useAssetStore } from "@/stores/assets"
import { useDeliveryStore } from "@/stores/deliveries"
import { useGuardStore } from "@/stores/guard"
import { loadAll, useLoadError } from "@/stores/load"
import { togglePreview, useUIStore } from "@/stores/ui"

const VIEW_COMPONENT: Record<ViewId, ComponentType<{ focusTitle: boolean }>> = {
  servers: ServersView,
  agents: AgentsView,
  settings: SettingsView,
}

/** 任一数据源加载失败时，在视图上方给出错误和「重试」；内部错误追加「打开日志目录」（PRD 6.10） */
function LoadErrorAlert() {
  const error = useLoadError()
  if (!error) return null
  return (
    <Alert variant="destructive" className={cn("m-3 mb-0 w-auto", error.id === "internal" && "has-data-[slot=alert-action]:pr-52")}>
      <CircleXIcon />
      <AlertTitle>{copy.shell.loadFailed}</AlertTitle>
      <AlertDescription>{ipcErrorText(error.id, error.params)}</AlertDescription>
      <AlertAction className="flex gap-1.5">
        <Button size="sm" variant="outline" onClick={loadAll}>
          {copy.shell.retry}
        </Button>
        {error.id === "internal" && (
          <Button size="sm" variant="outline" onClick={serverActions.openLogs}>
            {copy.common.openLogs}
          </Button>
        )}
      </AlertAction>
    </Alert>
  )
}

/** 副本和护栏的健康检查（F-305）：窗口重新聚焦时检查，30 秒内最多一次；启动时的检查随首次加载完成 */
const RECHECK_MS = 30_000

function useRecheckOnFocus() {
  useEffect(() => {
    let last = Date.now()
    const onFocus = () => {
      if (Date.now() - last < RECHECK_MS || useDeliveryStore.getState().status !== "ready") return
      last = Date.now()
      void useDeliveryStore.getState().checkAll().catch(() => {})
      void useGuardStore.getState().load()
    }
    window.addEventListener("focus", onFocus)
    return () => window.removeEventListener("focus", onFocus)
  }, [])
}

/** 临时解锁到期自动锁回（F-306 AC2）：按最近的到期时间定时，到期时用 Toast 播报（PRD 6.12） */
function useUnlockExpiry() {
  const byId = useAssetStore((s) => s.byId)
  useEffect(() => {
    const unlocked = Object.values(byId).filter((a) => a.agent.unlockedUntil)
    if (unlocked.length === 0) return
    const next = Math.min(...unlocked.map((a) => new Date(a.agent.unlockedUntil!).getTime()))
    const timer = setTimeout(
      () => {
        const now = Date.now()
        Object.values(useAssetStore.getState().byId)
          .filter((a) => a.agent.unlockedUntil && new Date(a.agent.unlockedUntil).getTime() <= now)
          .forEach((a) =>
            useAssetStore
              .getState()
              .lock(a.id)
              .then(() => toast.add({ title: copy.agentSection.expiredToast(a.connection.sshAlias) }))
              .catch(() => {})
          )
      },
      Math.min(Math.max(next - Date.now(), 0), 2 ** 31 - 1)
    )
    return () => clearTimeout(timer)
  }, [byId])
}

function useGlobalHotkeys() {
  const ui = useUIStore.getState
  useHotkeys(HOTKEYS.command, () => ui().setCommandOpen(!ui().commandOpen), HOTKEY_OPTIONS)
  useHotkeys(
    HOTKEYS.views,
    (e) => {
      const view = VIEW_BY_DIGIT[e.code.replace("Digit", "").replace("Numpad", "")]
      if (view && !isModalOpen()) ui().setView(view)
    },
    HOTKEY_OPTIONS
  )
  useHotkeys(HOTKEYS.newServer, () => !isModalOpen() && ui().startCreate(), HOTKEY_OPTIONS)
  // 预览开着时它就是最上层的浮层，Ctrl+\ 直接关掉；其余浮层打开时不响应
  useHotkeys(HOTKEYS.preview, () => (ui().previewOpen || !isModalOpen()) && togglePreview(), HOTKEY_OPTIONS)
}

export function App() {
  const view = useUIStore((s) => s.view)
  // 首次渲染不抢焦点；之后每次切换视图，焦点移到新视图标题（PRD 6.12）
  const switched = useUIStore((s) => s.viewSwitches > 0)
  const View = VIEW_COMPONENT[view]

  useGlobalHotkeys()
  useRecheckOnFocus()
  useUnlockExpiry()
  useEffect(() => {
    loadAll()
  }, [])

  return (
    // 窗口小于 1024px 时，侧栏默认进入图标模式（PRD 6.10）
    <SidebarProvider defaultOpen={window.innerWidth >= 1024}>
      <a
        href="#view-title"
        className="sr-only z-50 rounded-lg bg-background px-3 py-2 text-sm ring-2 ring-ring focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        {copy.app.skipToMain}
      </a>
      <AppSidebar />
      <SidebarInset className="h-svh min-w-0 overflow-hidden">
        <AppToolbar />
        <LoadErrorAlert />
        <View key={view} focusTitle={switched} />
      </SidebarInset>
      <CommandMenu />
      <ImportDialog />
      <HostKeyDialog />
      <ServerActionDialogs />
      <GuardDialogs />
    </SidebarProvider>
  )
}

export default App