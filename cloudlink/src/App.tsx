import { CircleXIcon } from "lucide-react"
import { useEffect, type ComponentType } from "react"
import { useHotkeys } from "react-hotkeys-hook"

import { AppHeader, AppSidebar } from "@/components/app/AppHeader"
import { CommandMenu } from "@/components/app/CommandMenu"
import { UpdateDialog } from "@/components/app/UpdateDialog"
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { ActivityView } from "@/features/activity/ActivityView"
import { AgentsView } from "@/features/agents/AgentsView"
import { GuardDialogs } from "@/features/agents/GuardDialogs"
import { serverActions } from "@/features/servers/actions"
import { HostKeyDialog } from "@/features/servers/HostKeyDialog"
import { ImportDialog } from "@/features/servers/ImportDialog"
import { ServerActionDialogs } from "@/features/servers/ServerActionDialogs"
import { ServersView } from "@/features/servers/ServersView"
import { SettingsView } from "@/features/settings/SettingsView"
import { copy, ipcErrorText, type ViewId } from "@/lib/copy"
import { HOTKEY_OPTIONS, HOTKEYS, isModalOpen, SINGLE_KEY_OPTIONS, VIEW_BY_DIGIT } from "@/lib/hotkeys"
import { cn } from "@/lib/utils"
import { useCliStore } from "@/stores/cli"
import { useDeliveryStore } from "@/stores/deliveries"
import { useGuardStore } from "@/stores/guard"
import { loadAll, useLoadError } from "@/stores/load"
import { useNotesStore } from "@/stores/notes"
import { togglePreview, useUIStore } from "@/stores/ui"

const VIEW_COMPONENT: Record<ViewId, ComponentType<{ focusTitle: boolean }>> = {
  servers: ServersView,
  agents: AgentsView,
  activity: ActivityView,
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

/**
 * 副本健康检查（F-305）：窗口重新聚焦时检查，30 秒内最多一次；启动时随首次加载完成。
 * 护栏与笔记在窗口可见时每 60 秒读取，重新聚焦或恢复可见时立即读取（F-307/308）。
 * 刚在终端里安装或登录云平台 CLI 的，不受节流，立即重新检测（F-104 AC2）。
 */
const RECHECK_MS = 30_000

function useRecheckOnFocus() {
  useEffect(() => {
    let last = Date.now()
    let refreshing = false
    const refreshFeedback = async () => {
      if (refreshing || document.visibilityState !== "visible") return
      refreshing = true
      try {
        // F-307/308: these reads import both the shared inbox and guard logs in the backend.
        await Promise.allSettled([useNotesStore.getState().load(), useGuardStore.getState().load()])
      } finally {
        refreshing = false
      }
    }
    const onFocus = () => {
      useCliStore.getState().onFocus()
      void refreshFeedback()
      if (Date.now() - last < RECHECK_MS || useDeliveryStore.getState().status !== "ready") return
      last = Date.now()
      void useDeliveryStore.getState().checkAll().catch(() => {})
    }
    const onVisible = () => { void refreshFeedback() }
    const timer = window.setInterval(() => { void refreshFeedback() }, 60_000)
    window.addEventListener("focus", onFocus)
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener("focus", onFocus)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [])
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
  useHotkeys(HOTKEYS.navPosition, () => ui().toggleNavPosition(), HOTKEY_OPTIONS)
  useHotkeys(HOTKEYS.settings, () => !isModalOpen() && ui().setView("settings"), HOTKEY_OPTIONS)
  useHotkeys(HOTKEYS.search, () => !isModalOpen() && ui().setSearchOpen(true), HOTKEY_OPTIONS)
  useHotkeys(HOTKEYS.focusSearch, () => !isModalOpen() && ui().setSearchOpen(true), SINGLE_KEY_OPTIONS)
  useHotkeys(HOTKEYS.newServer, () => !isModalOpen() && ui().startCreate(), HOTKEY_OPTIONS)
  // Esc 从详情返回列表（PRD 6.9）；浮层打开时交给浮层，输入框里的 Esc 留给输入框
  useHotkeys(HOTKEYS.escape, () => ui().view === "servers" && !isModalOpen() && ui().closeInspector(), SINGLE_KEY_OPTIONS)
  // 预览开着时它就是最上层的浮层，Ctrl+\ 直接关掉；其余浮层打开时不响应
  useHotkeys(HOTKEYS.preview, () => (ui().previewOpen || !isModalOpen()) && togglePreview(), HOTKEY_OPTIONS)
}

export function App() {
  const view = useUIStore((s) => s.view)
  // 首次渲染不抢焦点；之后每次切换视图，焦点移到新视图标题（PRD 6.12）
  const switched = useUIStore((s) => s.viewSwitches > 0)
  const View = VIEW_COMPONENT[view]
  const side = useUIStore((s) => s.navPosition === "side")

  useGlobalHotkeys()
  useRecheckOnFocus()
  useEffect(() => {
    loadAll()
  }, [])

  return (
    // 紧凑窗口（PRD 6.2）：顶部一体栏，下面是单个视图，没有侧栏和左右分栏
    <div className="flex h-svh min-w-0 overflow-hidden bg-background">
      <a
        href="#view-title"
        className="sr-only z-50 rounded-lg bg-background px-3 py-2 text-sm ring-2 ring-ring focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        {copy.app.skipToMain}
      </a>
      {side && <AppSidebar />}
      <div className="flex min-w-0 flex-1 flex-col">
        <AppHeader />
        <main className="flex min-h-0 flex-1 flex-col">
          <LoadErrorAlert />
          <View key={view} focusTitle={switched} />
        </main>
      </div>
      <CommandMenu />
      <ImportDialog />
      <HostKeyDialog />
      <ServerActionDialogs />
      <GuardDialogs />
      <UpdateDialog />
    </div>
  )
}

export default App
