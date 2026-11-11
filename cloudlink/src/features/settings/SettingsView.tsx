import { CirclePauseIcon, Trash2Icon } from "lucide-react"
import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from "react"

import type { EnvId, IpcError, Settings } from "@/bindings"
import { CopyValue, FoldRow, ListGroup, PrefRow } from "@/components/app/SettingsList"
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
import { downloadPercent, hasUpdate, useUpdateStore } from "@/stores/update"
import { ActivityFilters } from "./ActivityParts"
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
function NumberSetting({ id, value, min, max, unit, onSave }: { id: string; value: number; min: number; max: number; unit: string; onSave: (v: number) => void }) {
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
    <>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        className="h-7 w-18 font-mono tabular-nums"
      />
      <span className="text-xs text-muted-foreground">{unit}</span>
    </>
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
  const release = useUpdateStore((s) => s.status)
  // 后台下载的进度只在这里显示，顶栏不出现（magpie 式，PRD 6.15）
  const updateLine = !hasUpdate(release)
    ? null
    : release.state === "downloading"
      ? copy.update.settingsDownloading(release.version, downloadPercent(release))
      : release.state === "ready"
        ? copy.update.settingsReady(release.version)
        : null
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
            {updateLine && <span className="block tabular-nums">{updateLine}</span>}
          </>
        }
      >
        {version && <span className="text-xs text-muted-foreground tabular-nums">{copy.settings.currentVersion(version)}</span>}
        <Switch id="auto-check-updates" checked={settings.autoCheckUpdates} onCheckedChange={(on) => update({ autoCheckUpdates: on })} />
      </PrefRow>
    </ListGroup>
  )
}

/**
 * SSH 配置（PRD 6.8）：都生效时只有一行；哪个运行环境还没加入，就多一条问题行 +「加入」，
 * 手动添加的说明（Include 那一行）默认收起
 */
function SshConfigRows() {
  const list = useTargetStore((s) => s.sshConfig)
  const [adding, setAdding] = useState<EnvId | null>(null)
  const [manual, setManual] = useState<EnvId | null>(null)
  // 用户 config 可能在外部被改过：每次打开设置重新读取
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
  const missing = list.filter((c) => !c.included)
  if (list.length === 0) return null
  if (missing.length === 0) {
    return (
      <PrefRow label={copy.settings.sshConfig} hint={copy.settings.sshConfigOk(list.map((c) => copy.env.long(c.envId)))}>
        <Button variant="outline" size="sm" aria-label={copy.settings.sshConfigOpen} onClick={() => void ipc.revealInDir(list[0].managedPath)}>
          {copy.settings.open}
        </Button>
      </PrefRow>
    )
  }
  return (
    <>
      {missing.map((c) => {
        const open = manual === c.envId
        return (
          <PrefRow
            key={c.envId}
            warn
            label={copy.settings.sshConfigMissing(copy.env.long(c.envId))}
            hint={
              <>
                {copy.settings.sshConfigMissingHint(copy.env.short(c.envId))}
                <button
                  type="button"
                  aria-expanded={open}
                  className="rounded-sm underline underline-offset-2 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => setManual(open ? null : c.envId)}
                >
                  {open ? copy.settings.sshManualHide : copy.settings.sshManualShow}
                </button>
                {open && (
                  <span className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1">
                    {copy.settings.sshManual(copy.env.short(c.envId))}
                    <CopyValue value={c.includeLine} />
                  </span>
                )}
              </>
            }
          >
            <Button variant="outline" size="sm" aria-label={copy.settings.sshJoinLabel(copy.env.long(c.envId))} disabled={adding !== null} onClick={() => add(c.envId)}>
              {adding === c.envId && <Spinner data-icon="inline-start" aria-hidden />}
              {copy.include.add}
            </Button>
          </PrefRow>
        )
      })}
    </>
  )
}

const join = (dir: string, name: string) => `${dir.replace(/[\\/]+$/, "")}${dir.includes("\\") ? "\\" : "/"}${name}`

function DataGroup({ settings }: { settings: Settings }) {
  const backups = join(settings.dataDir, "backups")
  return (
    <ListGroup id="settings-data" title={copy.settings.groups.data}>
      <SshConfigRows />
      <PrefRow label={copy.settings.backups} hint={copy.settings.backupsHint}>
        <Button variant="outline" size="sm" aria-label={copy.settings.backupsOpen} onClick={() => void ipc.revealInDir(backups).catch(() => ipc.revealInDir(settings.dataDir))}>
          {copy.settings.open}
        </Button>
      </PrefRow>
      <PrefRow label={copy.settings.activityLog} hint={copy.settings.activityLogHint}>
        <Button variant="outline" size="sm" aria-label={copy.settings.activityLogOpenLabel} onClick={() => useUIStore.getState().setActivityLogOpen(true)}>
          {copy.settings.activityLogOpen}
        </Button>
      </PrefRow>
    </ListGroup>
  )
}

/** 底部折叠的「高级」（PRD 6.8）：探测、Skill 篇幅、数据目录，默认收起 */
function AdvancedGroup({ settings }: { settings: Settings }) {
  const [script, setScript] = useState({ open: false, mounted: false })
  return (
    <section aria-label={copy.settings.advanced} className="overflow-hidden rounded-list border border-line bg-card">
      <FoldRow label={copy.settings.advanced} hint={copy.settings.advancedHint}>
        <PrefRow label={copy.settings.probeTimeout} labelFor="probe-timeout" hint={copy.settings.probeTimeoutHint}>
          <NumberSetting id="probe-timeout" value={settings.probeTimeoutSec} min={10} max={120} unit={copy.settings.unitSeconds} onSave={(v) => update({ probeTimeoutSec: v })} />
        </PrefRow>
        <PrefRow label={copy.settings.probeScript} hint={copy.settings.probeScriptHint}>
          <Button variant="outline" size="sm" aria-label={copy.probeSheet.viewScript} onClick={() => setScript({ open: true, mounted: true })}>
            {copy.settings.activityLogOpen}
          </Button>
        </PrefRow>
        <PrefRow label={copy.settings.bodyLineLimit} labelFor="body-line-limit" hint={copy.settings.bodyLineLimitHint}>
          <NumberSetting id="body-line-limit" value={settings.bodyLineLimit} min={20} max={500} unit={copy.settings.unitLines} onSave={(v) => update({ bodyLineLimit: v })} />
        </PrefRow>
        <PrefRow label={copy.settings.snapshot} labelFor="write-snapshot" hint={copy.settings.snapshotHint}>
          <Switch id="write-snapshot" checked={settings.writeSnapshotTime} onCheckedChange={(on) => update({ writeSnapshotTime: on })} />
        </PrefRow>
        <PrefRow label={copy.settings.dataDir} hint={<CopyValue value={settings.dataDir} />}>
          <Button variant="outline" size="sm" aria-label={copy.settings.dataDirOpen} onClick={() => void ipc.revealInDir(settings.dataDir)}>
            {copy.settings.open}
          </Button>
        </PrefRow>
      </FoldRow>
      {script.mounted && (
        <Suspense fallback={null}>
          <ProbeScriptDialog open={script.open} onOpenChange={(open) => setScript((s) => ({ ...s, open }))} />
        </Suspense>
      )}
    </section>
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
        <Button variant="outline" size="sm" disabled={!hasDeliveries && !hasEnabled} onClick={() => setDialog("remove")}>
          {copy.settings.removeAllButton}…
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
        icon={CirclePauseIcon}
        title={copy.settings.removeAll}
        description={copy.settings.removeAllHint}
        phrase={copy.settings.removeAllConfirm}
        confirmLabel={copy.settings.removeAllButton}
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

/** 设置 → 数据 →「活动日志」（DESIGN.md Activity Log Sheet）：560px 宽，标题行里两个筛选；只有 CloudLink 自己的活动（6.8） */
function ActivityLogSheet() {
  const open = useUIStore((s) => s.activityLogOpen)
  return (
    <Sheet open={open} onOpenChange={(o) => useUIStore.getState().setActivityLogOpen(o)}>
      <SheetContent side="right" closeLabel={copy.common.close} className="gap-0 bg-background data-[side=right]:w-[min(560px,calc(100vw-2.5rem))] data-[side=right]:sm:max-w-none">
        <SheetHeader className="flex-row flex-wrap items-center gap-2 py-3 pr-12">
          <SheetTitle className="mr-auto">{copy.settings.activityLog}</SheetTitle>
          <ActivityFilters />
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

/** 设置视图（PRD 6.8）：一页往下滚，外观、启动与托盘、数据、危险操作，最下面是折叠的「高级」 */
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
              <DataGroup settings={s} />
            </>
          )}
        </SettingsGate>
        <DangerGroup />
        <SettingsGate>{(s) => <AdvancedGroup settings={s} />}</SettingsGate>
      </div>
      <ActivityLogSheet />
    </ScrollArea>
  )
}
