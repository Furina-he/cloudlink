import { CircleXIcon } from "lucide-react"
import { useEffect, type ComponentType } from "react"
import { useHotkeys } from "react-hotkeys-hook"

import { AppSidebar } from "@/components/app/AppSidebar"
import { AppToolbar } from "@/components/app/AppToolbar"
import { CommandMenu } from "@/components/app/CommandMenu"
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { ActivityView } from "@/features/activity/ActivityView"
import { AssetsView } from "@/features/assets/AssetsView"
import { MountsView } from "@/features/mounts/MountsView"
import { SettingsView } from "@/features/settings/SettingsView"
import { SkillsView } from "@/features/skills/SkillsView"
import { copy, ipcErrorText, type ViewId } from "@/lib/copy"
import { HOTKEYS, HOTKEY_OPTIONS, VIEW_BY_DIGIT } from "@/lib/hotkeys"
import { useActivityStore } from "@/stores/activity"
import { useAssetStore } from "@/stores/assets"
import { useMountStore } from "@/stores/mounts"
import { useSkillStore } from "@/stores/skills"
import { useTargetStore } from "@/stores/targets"
import { useUIStore } from "@/stores/ui"

const VIEW_COMPONENT: Record<ViewId, ComponentType<{ focusTitle: boolean }>> = {
  assets: AssetsView,
  skills: SkillsView,
  mounts: MountsView,
  activity: ActivityView,
  settings: SettingsView,
}

function loadAll() {
  void useTargetStore.getState().detect()
  void useAssetStore.getState().load()
  void useSkillStore.getState().refresh()
  void useMountStore.getState().load()
  void useActivityStore.getState().load()
}

/** 任一数据源加载失败时，在视图上方给出错误和「重试」（PRD 6.11） */
function LoadErrorAlert() {
  const errors = [
    useAssetStore((s) => s.error),
    useTargetStore((s) => s.error),
    useSkillStore((s) => s.error),
    useMountStore((s) => s.error),
    useActivityStore((s) => s.error),
  ]
  const first = errors.find(Boolean)
  if (!first) return null
  return (
    <Alert variant="destructive" className="m-3 mb-0 w-auto">
      <CircleXIcon />
      <AlertTitle>{copy.shell.loadFailed}</AlertTitle>
      <AlertDescription>{ipcErrorText(first.id, first.params)}</AlertDescription>
      <AlertAction>
        <Button size="sm" variant="outline" onClick={loadAll}>
          {copy.shell.retry}
        </Button>
      </AlertAction>
    </Alert>
  )
}

function useGlobalHotkeys() {
  const lens = useUIStore((s) => s.lens)
  useHotkeys(
    HOTKEYS.command,
    () => useUIStore.getState().setCommandOpen(!useUIStore.getState().commandOpen),
    HOTKEY_OPTIONS
  )
  useHotkeys(
    HOTKEYS.views,
    (e) => {
      const view = VIEW_BY_DIGIT[e.code.replace("Digit", "").replace("Numpad", "")]
      if (view) useUIStore.getState().setView(view)
    },
    HOTKEY_OPTIONS
  )
  // Esc 退出 Agent 视角；浮层打开时由浮层自己处理 Esc
  useHotkeys(HOTKEYS.escape, () => useUIStore.getState().setLens(null), {
    enabled: lens !== null && !useUIStore.getState().commandOpen,
  })
}

export function App() {
  const view = useUIStore((s) => s.view)
  // 首次渲染不抢焦点；之后每次切换视图，焦点移到新视图标题（PRD 6.14）
  const switched = useUIStore((s) => s.viewSwitches > 0)
  const View = VIEW_COMPONENT[view]

  useGlobalHotkeys()
  useEffect(() => {
    loadAll()
  }, [])

  return (
    // 窗口小于 1024px 时，侧栏默认进入图标模式（PRD 6.11）
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
    </SidebarProvider>
  )
}

export default App
