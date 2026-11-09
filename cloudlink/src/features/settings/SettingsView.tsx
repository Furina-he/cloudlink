import { FolderMinusIcon, Trash2Icon } from "lucide-react"
import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from "react"

import type { EnvId, IpcError, Settings } from "@/bindings"
import { CopyValue, ListGroup, ListNote, PrefRow } from "@/components/app/SettingsList"
import { useScrollRestore, useViewTitleFocus } from "@/components/app/ViewShell"
import { useTheme } from "@/components/theme-provider"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { toast } from "@/components/ui/toast"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useDelayedFlag } from "@/hooks/use-delayed-flag"
import { copy, ipcErrorText } from "@/lib/copy"
import { ipc } from "@/lib/ipc"
import { useDeliveryStore } from "@/stores/deliveries"
import { useSettingsStore } from "@/stores/settings"
import { useTargetStore } from "@/stores/targets"
import { useUIStore } from "@/stores/ui"
import { useUpdateStore } from "@/stores/update"
import { ActivitySection } from "./ActivitySection"
import { TypedConfirm, useDangerActions } from "./DangerSection"
import { update } from "./settingsUpdate"

const ProbeScriptDialog = lazy(() => import("@/features/servers/ProbeScriptDialog"))

/** 分段切换（DESIGN.md Segmented）：单选，不允许取消选中 */
function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <ToggleGroup aria-label={label} variant="outline" size="sm" spacing={0} value={[value]} onValueChange={(next) => next[0] && onChange(next[0] as T)}>
      {options.map(([v, text]) => (
        <ToggleGroupItem key={v} value={v} className="px-3">
          {text}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}

/** 数字设置：失焦时校验范围再保存，超出范围恢复原值 */
function NumberSetting({ id, value, min, max, onSave }: { id: string; value: number; min: number; max: number; onSave: (v: number) => void }) {
  const [text, setText] = useState(String(value))
  const [last, setLast] = useState(value)
  if (value !== last) {
    setLast(value)
    setText(String(value))
  }
  const commit = () => {
    const n = Number(text)
    if (!Number.isInteger(n) || n < min || n > max) {
      setText(String(value))
      return
    }
    if (n !== value) {
      onSave(n)
      toast.add({ title: copy.settings.saved })
    }
  }
  return (
    <Input
      id={id}
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      className="h-7 w-20 font-mono tabular-nums"
    />
  )
}

function AppearanceGroup() {
  const { theme, setTheme } = useTheme()
  const nav = useUIStore((s) => s.navPosition)
  return (
    <ListGroup id="settings-appearance" title={copy.settings.groups.appearance}>
      <PrefRow label={copy.settings.theme}>
        <Segmented
          label={copy.settings.theme}
          value={theme}
          options={[
            ["light", copy.settings.themeOption.light],
            ["dark", copy.settings.themeOption.dark],
            ["system", copy.settings.themeOption.system],
          ]}
          onChange={(next) => {
            setTheme(next)
            update({ theme: next })
          }}
        />
      </PrefRow>
      <PrefRow label={copy.settings.navPosition}>
        <Segmented
          label={copy.settings.navPosition}
          value={nav}
          options={[
            ["top", copy.settings.navOption.top],
            ["side", copy.settings.navOption.side],
          ]}
          onChange={(next) => useUIStore.getState().setNavPosition(next)}
        />
      </PrefRow>
    </ListGroup>
  )
}

function StartupGroup({ settings }: { settings: Settings }) {
  const version = useUpdateStore((s) => s.status?.currentVersion ?? null)
  return (
    <ListGroup id="settings-startup" title={copy.settings.groups.startup}>
      <PrefRow label={copy.settings.closeWindow} hint={copy.settings.closeHint}>
        <Segmented
          label={copy.settings.closeWindow}
          value={settings.closeToTray ? "tray" : "quit"}
          options={[
            ["tray", copy.settings.closeOption.tray],
            ["quit", copy.settings.closeOption.quit],
          ]}
          onChange={(next) => update({ closeToTray: next === "tray" })}
        />
      </PrefRow>
      <PrefRow label={copy.settings.launchAtLogin} labelFor="launch-at-login">
        <Switch id="launch-at-login" checked={settings.launchAtLogin} onCheckedChange={(on) => update({ launchAtLogin: on })} />
      </PrefRow>
      {/* 不放「立即检查」：关闭后重新打开开关时，后端立即检查一次（PRD 6.15） */}
      <PrefRow
        label={copy.settings.autoCheckUpdates}
        labelFor="auto-check-updates"
        hint={
          <>
            {copy.settings.autoCheckUpdatesHint}
            {version && <span className="block tabular-nums">{copy.settings.currentVersion(version)}</span>}
          </>
        }
      >
        <Switch id="auto-check-updates" checked={settings.autoCheckUpdates} onCheckedChange={(on) => update({ autoCheckUpdates: on })} />
      </PrefRow>
    </ListGroup>
  )
}

/** 连接：每个运行环境一行 ssh 配置（托管文件与 Include 状态，未加入时「加入 Include」）；探测超时；探测脚本 */
function ConnectionGroup({ settings }: { settings: Settings }) {
  const list = useTargetStore((s) => s.sshConfig)
  const [adding, setAdding] = useState<EnvId | null>(null)
  const [script, setScript] = useState({ open: false, mounted: false })
  // 托管文件和用户 config 可能在外部被改过：每次打开设置重新读取
  useEffect(() => {
    void useTargetStore.getState().loadSshConfig().catch(() => {})
  }, [])
  const add = (envId: EnvId) => {
    setAdding(envId)
    useTargetStore
      .getState()
      .addSshInclude(envId)
      .then(() => toast.add({ title: copy.include.added(copy.env.long(envId)), type: "success" }))
      .catch((e: IpcError) => toast.add({ title: ipcErrorText(e.id, e.params), type: "error" }))
      .finally(() => setAdding(null))
  }
  return (
    <ListGroup id="settings-connection" title={copy.settings.groups.connection}>
      {list.map((c) => (
        <div key={c.envId}>
          <PrefRow
            warn={!c.included}
            label={copy.settings.sshConfig(copy.env.long(c.envId))}
            hint={c.included ? copy.settings.sshIncludedHint(c.managedPath) : copy.settings.sshMissingHint(c.managedPath)}
          >
            {c.included ? (
              <Button variant="outline" size="sm" onClick={() => void ipc.revealInDir(c.managedPath)}>
                {copy.settings.open}
              </Button>
            ) : (
              <Button variant="outline" size="sm" disabled={adding !== null} onClick={() => add(c.envId)}>
                {adding === c.envId && <Spinner data-icon="inline-start" aria-hidden />}
                {copy.settings.sshAddInclude}
              </Button>
            )}
          </PrefRow>
          {!c.included && (
            <ListNote>
              <span className="flex flex-col gap-1">
                {copy.settings.sshManual}
                <CopyValue value={c.includeLine} />
              </span>
            </ListNote>
          )}
        </div>
      ))}
      <PrefRow label={copy.settings.probeTimeout} labelFor="probe-timeout" hint={copy.settings.probeTimeoutHint}>
        <NumberSetting id="probe-timeout" value={settings.probeTimeoutSec} min={10} max={120} onSave={(v) => update({ probeTimeoutSec: v })} />
      </PrefRow>
      <PrefRow label={copy.settings.probeScript} hint={copy.settings.probeScriptHint}>
        <Button variant="outline" size="sm" onClick={() => setScript({ open: true, mounted: true })}>
          {copy.probeSheet.viewScript}
        </Button>
      </PrefRow>
      {script.mounted && (
        <Suspense fallback={null}>
          <ProbeScriptDialog open={script.open} onOpenChange={(open) => setScript((s) => ({ ...s, open }))} />
        </Suspense>
      )}
    </ListGroup>
  )
}

function CompileGroup({ settings }: { settings: Settings }) {
  return (
    <ListGroup id="settings-compile" title={copy.settings.groups.compile}>
      <PrefRow label={copy.settings.bodyLineLimit} labelFor="body-line-limit" hint={copy.settings.bodyLineLimitHint}>
        <NumberSetting id="body-line-limit" value={settings.bodyLineLimit} min={20} max={500} onSave={(v) => update({ bodyLineLimit: v })} />
      </PrefRow>
      <PrefRow label={copy.settings.snapshot} labelFor="write-snapshot" hint={copy.settings.snapshotHint}>
        <Switch id="write-snapshot" checked={settings.writeSnapshotTime} onCheckedChange={(on) => update({ writeSnapshotTime: on })} />
      </PrefRow>
    </ListGroup>
  )
}

const join = (dir: string, name: string) => `${dir.replace(/[\\/]+$/, "")}${dir.includes("\\") ? "\\" : "/"}${name}`

function DataGroup({ settings }: { settings: Settings }) {
  const backups = join(settings.dataDir, "backups")
  return (
    <ListGroup id="settings-data" title={copy.settings.groups.data}>
      <PrefRow label={copy.settings.dataDir} hint={<CopyValue value={settings.dataDir} />}>
        <Button variant="outline" size="sm" onClick={() => void ipc.revealInDir(settings.dataDir)}>
          {copy.settings.open}
        </Button>
      </PrefRow>
      <PrefRow label={copy.settings.backups} hint={copy.settings.backupsHint(backups)}>
        <Button variant="outline" size="sm" onClick={() => void ipc.revealInDir(backups).catch(() => ipc.revealInDir(settings.dataDir))}>
          {copy.settings.open}
        </Button>
      </PrefRow>
      <PrefRow label={copy.settings.activityLog} hint={copy.settings.activityLogHint}>
        <Button variant="outline" size="sm" aria-label={copy.settings.activityLogOpenLabel} onClick={() => useUIStore.getState().setActivityLogOpen(true)}>
          {copy.settings.activityLogOpen}
        </Button>
      </PrefRow>
      <PrefRow label={copy.settings.importExport} hint={copy.settings.importExportLater}>
        <Button variant="outline" size="sm" disabled>
          {copy.settings.importExport}
        </Button>
      </PrefRow>
    </ListGroup>
  )
}

function DangerGroup() {
  const hasDeliveries = useDeliveryStore((s) => Object.keys(s.byId).length > 0)
  const hasEnabled = useTargetStore((s) => s.targets.some((t) => t.enabled))
  const [dialog, setDialog] = useState<"remove" | "reset" | null>(null)
  const { removeAll, resetData } = useDangerActions()
  return (
    <ListGroup id="settings-danger" title={copy.settings.groups.danger}>
      <PrefRow label={copy.settings.removeAll} hint={copy.settings.removeAllHint}>
        <Button variant="outline" size="sm" className="text-destructive" disabled={!hasDeliveries && !hasEnabled} onClick={() => setDialog("remove")}>
          {copy.settings.removeAll}…
        </Button>
      </PrefRow>
      <PrefRow label={copy.settings.reset} hint={copy.settings.resetHint}>
        <Button variant="outline" size="sm" className="text-destructive" onClick={() => setDialog("reset")}>
          {copy.settings.reset}…
        </Button>
      </PrefRow>
      <TypedConfirm
        open={dialog === "remove"}
        onOpenChange={(o) => !o && setDialog(null)}
        icon={FolderMinusIcon}
        title={copy.settings.removeAll}
        description={copy.settings.removeAllHint}
        phrase={copy.settings.removeAllConfirm}
        onConfirm={removeAll}
      />
      <TypedConfirm
        open={dialog === "reset"}
        onOpenChange={(o) => !o && setDialog(null)}
        icon={Trash2Icon}
        title={copy.settings.reset}
        description={copy.settings.resetDataHint}
        phrase={copy.settings.resetPhrase}
        onConfirm={resetData}
      />
    </ListGroup>
  )
}

/** 设置 → 数据 →「活动日志」：应用自己的活动，不混进 Agent 的操作记录（6.7） */
function ActivityLogSheet() {
  const open = useUIStore((s) => s.activityLogOpen)
  return (
    <Sheet open={open} onOpenChange={(o) => useUIStore.getState().setActivityLogOpen(o)}>
      <SheetContent side="right" closeLabel={copy.common.close} className="gap-0 data-[side=right]:w-[min(640px,80vw)] data-[side=right]:sm:max-w-none">
        <SheetHeader className="pr-12">
          <SheetTitle>{copy.settings.activityLog}</SheetTitle>
        </SheetHeader>
        <ScrollArea className="min-h-0 flex-1">
          <div className="px-4 pb-6">
            <ActivitySection />
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  )
}

/** 设置还没加载到时显示骨架；加载失败由 App 顶部的 Alert 给出「重试」 */
function SettingsGate({ children }: { children: (settings: Settings) => ReactNode }) {
  const settings = useSettingsStore((s) => s.settings)
  const failed = useSettingsStore((s) => s.status === "error")
  const showSkeleton = useDelayedFlag(!settings && !failed)
  if (settings) return children(settings)
  return showSkeleton ? (
    <div className="flex flex-col gap-3" aria-busy="true" aria-label={copy.settings.loading}>
      <Skeleton className="h-24 rounded-list" />
      <Skeleton className="h-36 rounded-list" />
    </div>
  ) : null
}

/** 设置视图（PRD 6.8，v0.2）：一页往下滚，外观、启动与托盘、连接、编译、数据、危险操作 */
export function SettingsView({ focusTitle }: { focusTitle: boolean }) {
  const rootRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  useViewTitleFocus(titleRef, focusTitle)
  useScrollRestore("settings", () => rootRef.current?.querySelector<HTMLElement>("[data-slot=scroll-area-viewport]"))
  return (
    <ScrollArea ref={rootRef} className="min-h-0 flex-1">
      <div className="mx-auto flex w-full max-w-190 flex-col gap-5 px-5 pt-5 pb-10">
        <h1 ref={titleRef} id="view-title" tabIndex={-1} className="sr-only">
          {copy.nav.settings}
        </h1>
        <AppearanceGroup />
        <SettingsGate>
          {(s) => (
            <>
              <StartupGroup settings={s} />
              <ConnectionGroup settings={s} />
              <CompileGroup settings={s} />
              <DataGroup settings={s} />
            </>
          )}
        </SettingsGate>
        <DangerGroup />
      </div>
      <ActivityLogSheet />
    </ScrollArea>
  )
}
