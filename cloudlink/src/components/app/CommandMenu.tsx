import {
  ArrowLeftIcon,
  BotIcon,
  CableIcon,
  FileInputIcon,
  FolderGit2Icon,
  HistoryIcon,
  LinkIcon,
  PackageIcon,
  PlusIcon,
  RadarIcon,
  RefreshCwIcon,
  ServerIcon,
  SettingsIcon,
  SunMoonIcon,
  type LucideIcon,
} from "lucide-react"
import { useState } from "react"
import { useShallow } from "zustand/react/shallow"

import { useTheme } from "@/components/theme-provider"
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command"
import { toast } from "@/components/ui/toast"
import type { IpcError, Mode } from "@/bindings"
import { useMountPipeline } from "@/features/mounts/useMountPipeline"
import { copy, ipcErrorText, type ViewId } from "@/lib/copy"
import { KEY_HINT } from "@/lib/hotkeys"
import { useAssetStore } from "@/stores/assets"
import { useMountStore } from "@/stores/mounts"
import { useProbeStore } from "@/stores/probe"
import { selectSkillOfAsset, useSkillStore } from "@/stores/skills"
import { useTargetStore } from "@/stores/targets"
import { VIEWS, useUIStore } from "@/stores/ui"

const VIEW_ICON: Record<ViewId, LucideIcon> = {
  assets: ServerIcon,
  skills: PackageIcon,
  mounts: CableIcon,
  activity: HistoryIcon,
  settings: SettingsIcon,
}

type Page = "root" | "mount" | "theme"

/** 命令面板（PRD 6.12）：跳转、资产、操作、挂载四组 */
export function CommandMenu() {
  const open = useUIStore((s) => s.commandOpen)
  const setOpen = useUIStore((s) => s.setCommandOpen)
  const [page, setPage] = useState<Page>("root")
  const [search, setSearch] = useState("")
  // 「挂载当前 Skill 到…」与看板、矩阵走同一条挂载管线；面板关闭后确认框仍要显示，所以放在 CommandDialog 外面
  const { requestMount, dialog } = useMountPipeline()

  const onOpenChange = (next: boolean) => {
    setOpen(next)
    if (!next) {
      setPage("root")
      setSearch("")
    }
  }
  const goPage = (p: Page) => {
    setPage(p)
    setSearch("")
  }

  return (
    <>
      <CommandDialog
        open={open}
        onOpenChange={onOpenChange}
        title={copy.command.title}
        description={copy.command.description}
      >
        <Command
          onKeyDown={(e) => {
            // 二级页里，空输入时按退格返回
            if (page !== "root" && e.key === "Backspace" && !search) {
              e.preventDefault()
              goPage("root")
            }
          }}
        >
          <CommandInput
            placeholder={
              page === "mount"
                ? copy.command.mountPageTitle
                : copy.command.placeholder
            }
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>{copy.command.empty}</CommandEmpty>
            {page === "root" && (
              <RootPage close={() => onOpenChange(false)} goPage={goPage} />
            )}
            {page === "mount" && (
              <MountPage
                close={() => onOpenChange(false)}
                back={() => goPage("root")}
                requestMount={requestMount}
              />
            )}
            {page === "theme" && (
              <ThemePage
                close={() => onOpenChange(false)}
                back={() => goPage("root")}
              />
            )}
          </CommandList>
        </Command>
      </CommandDialog>
      {dialog}
    </>
  )
}

function RootPage({
  close,
  goPage,
}: {
  close: () => void
  goPage: (p: Page) => void
}) {
  const assets = useAssetStore(useShallow((s) => s.ids.map((id) => s.byId[id])))
  const selectedAssetId = useUIStore((s) => s.selectedAssetId)
  const run = (fn: () => void) => () => {
    fn()
    close()
  }
  const ui = useUIStore.getState
  const probeCurrent = run(() => {
    if (!selectedAssetId) return
    useProbeStore
      .getState()
      .start(selectedAssetId)
      .then(() => ui().requestProbePanel())
      .catch((e: IpcError) =>
        toast.add({ title: ipcErrorText(e.id, e.params), type: "error" })
      )
  })
  const probeAll = run(() => {
    void useProbeStore
      .getState()
      .startAll()
      .then((n) =>
        toast.add({
          title: n
            ? copy.probeToast.startedAll(n)
            : copy.probeToast.nothingToProbe,
        })
      )
  })

  return (
    <>
      <CommandGroup heading={copy.command.groups.navigate}>
        {VIEWS.map((id, i) => {
          const Icon = VIEW_ICON[id]
          return (
            <CommandItem
              key={id}
              value={`${copy.command.goTo(copy.nav[id])} ${id}`}
              onSelect={run(() => ui().setView(id))}
            >
              <Icon />
              {copy.command.goTo(copy.nav[id])}
              <CommandShortcut>
                {KEY_HINT.view(i + 1).join("+")}
              </CommandShortcut>
            </CommandItem>
          )
        })}
      </CommandGroup>
      {assets.length > 0 && (
        <CommandGroup heading={copy.command.groups.assets}>
          {assets.map((a) => (
            <CommandItem
              key={a.id}
              value={`${a.name} ${a.connection.sshAlias} ${a.slug}`}
              onSelect={run(() => {
                ui().selectAsset(a.id)
                ui().setView("assets")
              })}
            >
              <ServerIcon />
              <span className="truncate">{a.name}</span>
              <span className="truncate font-mono text-xs text-muted-foreground">
                {a.connection.sshAlias}
              </span>
            </CommandItem>
          ))}
        </CommandGroup>
      )}
      <CommandGroup heading={copy.command.groups.actions}>
        <CommandItem
          value={copy.command.actions.newAsset}
          onSelect={run(() => ui().startNewAsset())}
        >
          <PlusIcon />
          {copy.command.actions.newAsset}
        </CommandItem>
        <CommandItem
          value={copy.command.actions.importSsh}
          onSelect={run(() => ui().setImportOpen(true))}
        >
          <FileInputIcon />
          {copy.command.actions.importSsh}
        </CommandItem>
        <CommandItem
          value={copy.command.actions.probeCurrent}
          disabled={!selectedAssetId}
          onSelect={probeCurrent}
        >
          <RadarIcon />
          {copy.command.actions.probeCurrent}
        </CommandItem>
        <CommandItem value={copy.command.actions.probeAll} onSelect={probeAll}>
          <RadarIcon />
          {copy.command.actions.probeAll}
        </CommandItem>
        <CommandItem
          value={copy.command.actions.checkAll}
          onSelect={run(
            () =>
              void useMountStore
                .getState()
                .checkAll()
                .then((list) =>
                  toast.add({ title: copy.command.checkAllDone(list.length) })
                )
                .catch(() => {})
          )}
        >
          <RefreshCwIcon />
          {copy.command.actions.checkAll}
        </CommandItem>
        <CommandItem
          value={copy.command.actions.theme}
          onSelect={() => goPage("theme")}
        >
          <SunMoonIcon />
          {copy.command.actions.theme}
        </CommandItem>
      </CommandGroup>
      <CommandGroup heading={copy.command.groups.mount}>
        <CommandItem
          value={copy.command.mountCurrent}
          disabled={!selectedAssetId}
          onSelect={() => goPage("mount")}
        >
          <LinkIcon />
          {selectedAssetId
            ? copy.command.mountCurrent
            : copy.command.mountCurrentNone}
        </CommandItem>
      </CommandGroup>
    </>
  )
}

function BackItem({ back }: { back: () => void }) {
  return (
    <CommandItem value={copy.command.back} onSelect={back}>
      <ArrowLeftIcon />
      {copy.command.back}
    </CommandItem>
  )
}

function MountPage({
  close,
  back,
  requestMount,
}: {
  close: () => void
  back: () => void
  requestMount: (req: {
    skillId: string
    targetId: string
    mode: Mode
  }) => Promise<void>
}) {
  const targets = useTargetStore((s) => s.targets)
  const selectedAssetId = useUIStore((s) => s.selectedAssetId)
  const asset = useAssetStore((s) =>
    selectedAssetId ? s.byId[selectedAssetId] : undefined
  )
  const skill = useSkillStore((s) =>
    selectSkillOfAsset(s.statusById, selectedAssetId)
  )
  const mountsById = useMountStore((s) => s.byId)
  if (!asset || !skill) return null
  const mounted = new Set(
    Object.values(mountsById)
      .filter((m) => m.skillId === skill.id)
      .map((m) => m.targetId)
  )

  return (
    <CommandGroup heading={`${copy.command.mountPageTitle} · ${asset.slug}`}>
      <BackItem back={back} />
      {targets.map((t) => (
        <CommandItem
          key={t.id}
          value={`${t.label} ${t.path}`}
          disabled={mounted.has(t.id)}
          onSelect={() => {
            close()
            void requestMount({
              skillId: skill.id,
              targetId: t.id,
              mode: asset.guardrails.defaultMode,
            })
          }}
        >
          {t.kind === "agent-global" ? <BotIcon /> : <FolderGit2Icon />}
          <span className="truncate">{t.label}</span>
          <span className="ml-auto shrink-0 text-xs text-muted-foreground">
            {mounted.has(t.id)
              ? copy.mountsTab.already
              : copy.env.long(t.envId)}
          </span>
        </CommandItem>
      ))}
    </CommandGroup>
  )
}

function ThemePage({ close, back }: { close: () => void; back: () => void }) {
  const { theme, setTheme } = useTheme()
  const options = ["system", "light", "dark"] as const
  return (
    <CommandGroup heading={copy.command.actions.theme}>
      <BackItem back={back} />
      {options.map((t) => (
        <CommandItem
          key={t}
          value={copy.command.theme[t]}
          data-checked={theme === t}
          onSelect={() => {
            setTheme(t)
            toast.add({ title: copy.command.themeSet[t] })
            close()
          }}
        >
          <SunMoonIcon />
          {copy.command.theme[t]}
        </CommandItem>
      ))}
    </CommandGroup>
  )
}
