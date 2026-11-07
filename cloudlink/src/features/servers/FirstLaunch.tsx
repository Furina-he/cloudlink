import type { CliProvider } from "@/bindings"
import { ChevronRightIcon, FileInputIcon, PlusIcon, ServerIcon } from "lucide-react"
import { useEffect, type ReactNode } from "react"

import { ProviderMark } from "@/components/app/ProviderMark"
import { ViewShell } from "@/components/app/ViewShell"
import { buttonVariants } from "@/components/ui/button"
import { CLI_BINARY, CLI_PROVIDERS } from "@/lib/cliProviders"
import { copy } from "@/lib/copy"
import { handleGridKeyDown } from "@/lib/grid-nav"
import { cn } from "@/lib/utils"
import { useTargetStore } from "@/stores/targets"
import { useUIStore } from "@/stores/ui"

/** 一条入口：和配电盘的回路行同高、同样的分组外框，首次启动就是列表将来的样子 */
function EntryRow({ icon, title, meta, blurb, end, onPick }: { icon: ReactNode; title: string; meta?: string; blurb: string; end?: ReactNode; onPick: () => void }) {
  return (
    <div role="listitem">
      <button
        type="button"
        data-grid-cell
        onClick={onPick}
        className="group/entry flex min-h-12 w-full items-center gap-3 px-3 py-2 text-left outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
          {icon}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex flex-wrap items-baseline gap-x-2 text-sm font-medium">
            {title}
            {meta && <span className="font-mono text-xs font-normal text-muted-foreground">{meta}</span>}
          </span>
          <span className="text-xs text-muted-foreground">{blurb}</span>
        </span>
        {end ?? <ChevronRightIcon aria-hidden className="size-4 shrink-0 text-muted-foreground transition-transform group-hover/entry:translate-x-0.5" />}
      </button>
    </div>
  )
}

function EntryGroup({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-1.5">
      <h3 id={id} className="px-1 text-sm font-semibold">
        {title}
      </h3>
      <div role="list" aria-labelledby={id} className="divide-y overflow-hidden rounded-xl border">
        {children}
      </div>
    </section>
  )
}

/**
 * 首次启动（PRD 6.8）：不铺满屏的虚线大框，而是和配电盘同一套分组与行——
 * 「服务器」「云平台」两组入口，导入那一行直接告诉用户 ssh config 里有几台主机可以导入
 */
export function FirstLaunch({ focusTitle }: { focusTitle: boolean }) {
  const ui = useUIStore.getState
  const importable = useTargetStore((s) => s.sshHosts?.hosts.filter((h) => !h.imported).length ?? 0)
  useEffect(() => {
    // 只读：列出各环境 ssh config 里的 Host，和导入对话框共用一份
    void useTargetStore.getState().loadSshHosts()
  }, [])

  return (
    <ViewShell view="servers" title={copy.nav.servers} focusTitle={focusTitle} titleHidden>
      <div className="mx-auto flex w-full max-w-xl flex-col gap-5 pt-[6vh] pb-6" onKeyDown={handleGridKeyDown}>
        <header className="flex flex-col gap-1 px-1">
          <h2 className="text-base font-semibold">{copy.onboarding.title}</h2>
          <p className="text-sm text-muted-foreground">{copy.onboarding.description}</p>
        </header>

        <EntryGroup id="onboarding-servers" title={copy.servers.groupServers}>
          <EntryRow
            icon={<ServerIcon className="size-4" />}
            title={copy.onboarding.addSsh}
            blurb={copy.onboarding.addSshBlurb}
            onPick={() => ui().startCreate("ssh")}
            end={
              <span aria-hidden className={cn(buttonVariants({ size: "xs" }), "pointer-events-none shrink-0")}>
                <PlusIcon data-icon="inline-start" />
                {copy.onboarding.add}
              </span>
            }
          />
          <EntryRow
            icon={<FileInputIcon className="size-4" />}
            title={copy.onboarding.importSsh}
            blurb={importable > 0 ? copy.onboarding.importFound(importable) : copy.onboarding.importNone}
            onPick={() => ui().setImportOpen(true)}
          />
        </EntryGroup>

        <EntryGroup id="onboarding-clis" title={copy.servers.groupClis}>
          {CLI_PROVIDERS.map((p: CliProvider) => (
            <EntryRow
              key={p}
              icon={<ProviderMark provider={p} className="size-5" />}
              title={copy.onboarding.connectCli(copy.cli.name[p])}
              meta={CLI_BINARY[p]}
              blurb={copy.cli.blurb[p]}
              onPick={() => ui().startCreate(p)}
            />
          ))}
        </EntryGroup>

        <ol aria-label={copy.onboarding.stepsLabel} className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 px-1 text-xs text-muted-foreground">
          {copy.onboarding.steps.map((s, i) => (
            <li key={s} className="flex items-center gap-2">
              {i > 0 && <ChevronRightIcon aria-hidden className="size-3" />}
              <span className="font-mono tabular-nums">{i + 1}</span>
              {s}
            </li>
          ))}
        </ol>
      </div>
    </ViewShell>
  )
}
