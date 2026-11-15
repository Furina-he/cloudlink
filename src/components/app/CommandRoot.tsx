import {
  ActivityIcon,
  BotIcon,
  CircleArrowUpIcon,
  EyeIcon,
  FileInputIcon,
  FolderMinusIcon,
  FolderSyncIcon,
  PackageIcon,
  PlugIcon,
  PlusIcon,
  RadarIcon,
  RefreshCwIcon,
  ServerIcon,
  SettingsIcon,
  ShieldCheckIcon,
  SunMoonIcon,
  WrenchIcon,
  type LucideIcon,
} from "lucide-react"
import { useShallow } from "zustand/react/shallow"

import type { Asset } from "@/bindings"
import { CommandGroup, CommandItem, CommandShortcut } from "@/components/ui/command"
import { toast } from "@/components/ui/toast"
import { useAgentOptions } from "@/features/agents/agentKeys"
import { serverActions, toastError } from "@/features/servers/actions"
import { CLI_PROVIDERS } from "@/lib/cliProviders"
import { copy, type ViewId } from "@/lib/copy"
import { KEY_HINT } from "@/lib/hotkeys"
import { handleOf, useAssetStore } from "@/stores/assets"
import { isProbing, useProbeStore } from "@/stores/probe"
import { openPreviewHere, useUIStore, VIEWS } from "@/stores/ui"
import { showReminder, useUpdateStore } from "@/stores/update"
import type { CommandPage } from "./CommandMenu"
import { ProviderMark } from "./ProviderMark"

const VIEW_ICON: Record<ViewId, LucideIcon> = {
  servers: ServerIcon,
  agents: BotIcon,
  activity: ActivityIcon,
  settings: SettingsIcon,
}

/** 跳到某项资源：不在资源视图时先切过去（可能被「未保存的修改」拦下，确认后才继续） */
function openServer(id: string) {
  const ui = useUIStore.getState()
  if (ui.view === "servers") ui.selectAsset(id)
  else ui.setView("servers", { then: () => useUIStore.getState().selectAsset(id, { force: true }) })
}

/**
 * 针对打开着的那项资源的命令：写出它的标识，输入标识也能搜到（value 里带上标识）；
 * 没打开任何资源时整组不出现，不再留一排灰掉的「当前资源」（2026-11-10）
 */
function CurrentActions({ asset, probing, close }: { asset: Asset; probing: boolean; close: () => void }) {
  const { agents } = useAgentOptions()
  const handle = handleOf(asset)
  const nextMode = asset.agent.mode === "standard" ? "read-only" : "standard"
  const run = (fn: () => void) => () => {
    fn()
    close()
  }
  const test = asset.type === "cli" ? copy.command.actions.recheckCli(handle) : copy.command.actions.testCurrent(handle)
  const mode = copy.command.actions.setMode(handle, copy.mode[nextMode])
  return (
    <>
      <CommandItem value={`${test} ${asset.name}`} onSelect={run(() => (asset.type === "cli" ? serverActions.recheckCli(asset) : serverActions.test(asset)))}>
        {asset.type === "cli" ? <RefreshCwIcon /> : <PlugIcon />}
        {test}
      </CommandItem>
      {asset.type === "vps" && (
        <CommandItem value={`${copy.command.actions.probeCurrent(handle)} ${asset.name}`} disabled={probing} onSelect={run(() => serverActions.probe(asset))}>
          <RadarIcon />
          {copy.command.actions.probeCurrent(handle)}
        </CommandItem>
      )}
      {agents.map((a) => {
        const on = asset.agent.agents.includes(a.key)
        const label = on ? copy.command.actions.stopTo(a.label, handle) : copy.command.actions.distributeTo(a.label, handle)
        return (
          <CommandItem key={a.key} value={`${label} ${asset.name}`} onSelect={run(() => serverActions.toggleAgent(asset, a, !on))}>
            {on ? <FolderMinusIcon /> : <FolderSyncIcon />}
            {label}
          </CommandItem>
        )
      })}
      <CommandItem value={`${mode} ${asset.name}`} onSelect={run(() => serverActions.requestMode(asset, nextMode))}>
        {nextMode === "standard" ? <WrenchIcon /> : <EyeIcon />}
        {mode}
      </CommandItem>
    </>
  )
}

/** 命令面板的首页（PRD 6.9）。「当前资源」是资源视图里选中的那项 */
export function RootPage({ close, goPage }: { close: () => void; goPage: (p: CommandPage) => void }) {
  const assets = useAssetStore(useShallow((s) => s.ids.map((id) => s.byId[id])))
  const selectedId = useUIStore((s) => (s.creating ? null : s.selectedAssetId))
  const current = useAssetStore((s) => (selectedId ? s.byId[selectedId] : undefined))
  const probing = useProbeStore((s) => (current ? isProbing(s, current.id) : false))
  const update = useUpdateStore((s) => (showReminder(s.status) ? s.status.version : null))
  const ui = useUIStore.getState
  const run = (fn: () => void) => () => {
    fn()
    close()
  }
  const probeAll = () =>
    void useProbeStore
      .getState()
      .startAll()
      .then((n) => toast.add({ title: n ? copy.probeToast.startedAll(n) : copy.probeToast.nothingToProbe }))
      .catch(toastError)

  return (
    <>
      <CommandGroup heading={copy.command.groups.navigate}>
        {VIEWS.map((id, i) => {
          const Icon = VIEW_ICON[id]
          return (
            <CommandItem key={id} value={`${copy.command.goTo(copy.nav[id])} ${id}`} onSelect={run(() => ui().setView(id))}>
              <Icon />
              {copy.command.goTo(copy.nav[id])}
              <CommandShortcut>{KEY_HINT.view(i + 1).join("+")}</CommandShortcut>
            </CommandItem>
          )
        })}
        {assets.map((a) => (
          <CommandItem key={a.id} value={`${a.name} ${handleOf(a)} ${a.id}`} onSelect={run(() => openServer(a.id))}>
            {a.type === "cli" ? <ProviderMark provider={a.cliProvider} /> : <ServerIcon />}
            <span className="truncate">{a.name}</span>
            <span className="truncate font-mono text-xs text-muted-foreground">{handleOf(a)}</span>
          </CommandItem>
        ))}
      </CommandGroup>
      <CommandGroup heading={copy.command.groups.servers}>
        <CommandItem value={copy.command.actions.newServer} onSelect={run(() => ui().startCreate("ssh"))}>
          <PlusIcon />
          {copy.command.actions.newServer}
        </CommandItem>
        {CLI_PROVIDERS.map((p) => (
          <CommandItem key={p} value={copy.command.actions.addCli(copy.cli.name[p])} onSelect={run(() => ui().startCreate(p))}>
            <ProviderMark provider={p} />
            {copy.command.actions.addCli(copy.cli.name[p])}
          </CommandItem>
        ))}
        <CommandItem value={copy.command.actions.importSsh} onSelect={run(() => ui().setImportOpen(true))}>
          <FileInputIcon />
          {copy.command.actions.importSsh}
        </CommandItem>
        <CommandItem value={copy.command.actions.probeAll} onSelect={run(probeAll)}>
          <RadarIcon />
          {copy.command.actions.probeAll}
        </CommandItem>
        {current && <CurrentActions asset={current} probing={probing} close={close} />}
      </CommandGroup>
      <CommandGroup heading={copy.command.groups.system}>
        <CommandItem value={copy.command.actions.preview} onSelect={run(openPreviewHere)}>
          <PackageIcon />
          {copy.command.actions.preview}
          <CommandShortcut>{KEY_HINT.preview.join("+")}</CommandShortcut>
        </CommandItem>
        <CommandItem value={copy.command.actions.allReadOnly} onSelect={run(() => void serverActions.allReadOnly())}>
          <ShieldCheckIcon />
          {copy.command.actions.allReadOnly}
        </CommandItem>
        <CommandItem value={copy.command.actions.theme} onSelect={() => goPage("theme")}>
          <SunMoonIcon />
          {copy.command.actions.theme}
        </CommandItem>
        {/* 和顶栏提醒同时出现，打开同一个更新对话框（F-406） */}
        {update && (
          <CommandItem value={copy.update.command(update)} onSelect={run(() => useUpdateStore.getState().setDialogOpen(true))}>
            <CircleArrowUpIcon />
            {copy.update.command(update)}
          </CommandItem>
        )}
      </CommandGroup>
    </>
  )
}
