import {
  BotIcon,
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
  SunMoonIcon,
  WrenchIcon,
  type LucideIcon,
} from "lucide-react"
import { useShallow } from "zustand/react/shallow"

import { CommandGroup, CommandItem, CommandShortcut } from "@/components/ui/command"
import { toast } from "@/components/ui/toast"
import { useAgentOptions } from "@/features/agents/agentKeys"
import { targetActions } from "@/features/agents/targetActions"
import { serverActions, toastError } from "@/features/servers/actions"
import { CLI_PROVIDERS } from "@/lib/cliProviders"
import { copy, type ViewId } from "@/lib/copy"
import { KEY_HINT } from "@/lib/hotkeys"
import { handleOf, useAssetStore } from "@/stores/assets"
import { isProbing, useProbeStore } from "@/stores/probe"
import { openPreviewHere, useUIStore, VIEWS } from "@/stores/ui"
import type { CommandPage } from "./CommandMenu"
import { ProviderMark } from "./ProviderMark"

const VIEW_ICON: Record<ViewId, LucideIcon> = {
  servers: ServerIcon,
  agents: BotIcon,
  settings: SettingsIcon,
}

/** 跳到某项资源：不在资源视图时先切过去（可能被「未保存的修改」拦下，确认后才继续） */
function openServer(id: string) {
  const ui = useUIStore.getState()
  if (ui.view === "servers") ui.selectAsset(id)
  else ui.setView("servers", { then: () => useUIStore.getState().selectAsset(id, { force: true }) })
}

/** 命令面板的首页（PRD 6.9）。「当前资源」是资源视图里选中的那项 */
export function RootPage({ close, goPage }: { close: () => void; goPage: (p: CommandPage) => void }) {
  const assets = useAssetStore(useShallow((s) => s.ids.map((id) => s.byId[id])))
  const selectedId = useUIStore((s) => (s.creating ? null : s.selectedAssetId))
  const current = useAssetStore((s) => (selectedId ? s.byId[selectedId] : undefined))
  const probing = useProbeStore((s) => (current ? isProbing(s, current.id) : false))
  const nextMode = current?.agent.mode === "standard" ? "read-only" : "standard"
  const { agents } = useAgentOptions()
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
        <CommandItem
          value={current?.type === "cli" ? copy.command.actions.recheckCli : copy.command.actions.testCurrent}
          disabled={!current}
          onSelect={run(() => current && (current.type === "cli" ? serverActions.recheckCli(current) : serverActions.test(current)))}
        >
          {current?.type === "cli" ? <RefreshCwIcon /> : <PlugIcon />}
          {current?.type === "cli" ? copy.command.actions.recheckCli : copy.command.actions.testCurrent}
        </CommandItem>
        <CommandItem
          value={copy.command.actions.probeCurrent}
          disabled={current?.type !== "vps" || probing}
          onSelect={run(() => current?.type === "vps" && serverActions.probe(current))}
        >
          <RadarIcon />
          {copy.command.actions.probeCurrent}
        </CommandItem>
        <CommandItem value={copy.command.actions.probeAll} onSelect={run(probeAll)}>
          <RadarIcon />
          {copy.command.actions.probeAll}
        </CommandItem>
        {agents.map((a) => {
          const on = !!current?.agent.agents.includes(a.key)
          const label = on ? copy.command.actions.stopTo(a.label) : copy.command.actions.distributeTo(a.label)
          return (
            <CommandItem key={a.key} value={label} disabled={!current} onSelect={run(() => current && serverActions.toggleAgent(current, a, !on))}>
              {on ? <FolderMinusIcon /> : <FolderSyncIcon />}
              {label}
            </CommandItem>
          )
        })}
        <CommandItem
          value={copy.command.actions.setMode(copy.mode[nextMode])}
          disabled={!current}
          onSelect={run(() => current && serverActions.requestMode(current, nextMode))}
        >
          {nextMode === "standard" ? <WrenchIcon /> : <EyeIcon />}
          {copy.command.actions.setMode(copy.mode[nextMode])}
        </CommandItem>
      </CommandGroup>
      <CommandGroup heading={copy.command.groups.system}>
        <CommandItem value={copy.command.actions.preview} onSelect={run(openPreviewHere)}>
          <PackageIcon />
          {copy.command.actions.preview}
          <CommandShortcut>{KEY_HINT.preview.join("+")}</CommandShortcut>
        </CommandItem>
        <CommandItem value={copy.command.actions.checkAll} onSelect={run(() => void targetActions.checkAll())}>
          <RefreshCwIcon />
          {copy.command.actions.checkAll}
        </CommandItem>
        <CommandItem value={copy.command.actions.theme} onSelect={() => goPage("theme")}>
          <SunMoonIcon />
          {copy.command.actions.theme}
        </CommandItem>
      </CommandGroup>
    </>
  )
}
