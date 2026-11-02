import { useRef, type ReactNode } from "react"

import type { Settings } from "@/bindings"
import { useScrollRestore, useViewTitleFocus } from "@/components/app/ViewShell"
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import { useDelayedFlag } from "@/hooks/use-delayed-flag"
import { copy } from "@/lib/copy"
import { cn } from "@/lib/utils"
import { useSettingsStore } from "@/stores/settings"
import { useUIStore, type SettingsSection } from "@/stores/ui"
import { ActivitySection } from "./ActivitySection"
import { CompileSection, ProbeSection } from "./CompileProbeSections"
import { DangerSection } from "./DangerSection"
import { DataSection } from "./DataSection"
import { EnvironmentsSection } from "./EnvironmentsSection"
import { GeneralSection } from "./GeneralSection"
import { SshConfigSection } from "./SshConfigSection"

const SECTIONS: SettingsSection[] = ["general", "environments", "ssh", "compile", "probe", "activity", "data", "danger"]

/** 依赖设置数据的分区；设置还没加载到时显示 Skeleton。加载失败由 App 顶部的 Alert 给出「重试」 */
function SettingsGate({ children }: { children: (settings: Settings) => ReactNode }) {
  const settings = useSettingsStore((s) => s.settings)
  const failed = useSettingsStore((s) => s.status === "error")
  const showSkeleton = useDelayedFlag(!settings && !failed)
  if (settings) return children(settings)
  return showSkeleton ? (
    <div className="flex max-w-2xl flex-col gap-3" aria-busy="true" aria-label={copy.settings.loading}>
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-8" />
      <Skeleton className="h-8" />
    </div>
  ) : null
}

function Content({ section }: { section: SettingsSection }) {
  switch (section) {
    case "ssh":
      return <SshConfigSection />
    case "activity":
      return <ActivitySection />
    case "danger":
      return <DangerSection />
    default:
      return (
        <SettingsGate>
          {(s) =>
            section === "general" ? (
              <GeneralSection settings={s} />
            ) : section === "environments" ? (
              <EnvironmentsSection settings={s} />
            ) : section === "compile" ? (
              <CompileSection settings={s} />
            ) : section === "probe" ? (
              <ProbeSection settings={s} />
            ) : (
              <DataSection settings={s} />
            )
          }
        </SettingsGate>
      )
  }
}

/** 设置视图（PRD 6.7）：左侧 Item 分区导航，右侧对应表单 */
export function SettingsView({ focusTitle }: { focusTitle: boolean }) {
  const rootRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  useViewTitleFocus(titleRef, focusTitle)
  const getViewport = () => rootRef.current?.querySelector<HTMLElement>("[data-slot=scroll-area-viewport]")
  useScrollRestore("settings", getViewport)

  const section = useUIStore((s) => s.settingsSection)
  const go = (id: SettingsSection) => {
    useUIStore.getState().setSettingsSection(id)
    const viewport = getViewport()
    if (viewport) viewport.scrollTop = 0
  }

  return (
    <div className="flex min-h-0 flex-1">
      <nav aria-label={copy.settings.nav} className="flex w-56 shrink-0 flex-col gap-3 border-r p-3">
        <h1 ref={titleRef} id="view-title" tabIndex={-1} className="text-base font-semibold outline-none">
          {copy.nav.settings}
        </h1>
        <ItemGroup className="gap-0.5">
          {SECTIONS.map((id) => (
            <Item
              key={id}
              size="xs"
              render={<button type="button" aria-current={section === id ? "page" : undefined} onClick={() => go(id)} />}
              className={cn("rounded-md text-left hover:bg-muted aria-[current=page]:bg-muted", id === "danger" && "mt-2")}
            >
              <ItemContent className="min-w-0">
                <ItemTitle className={cn("text-sm", section === id && "font-medium", id === "danger" && "text-destructive")}>
                  {copy.settings.section[id]}
                </ItemTitle>
                <ItemDescription className="truncate text-xs">{copy.settings.sectionHint[id]}</ItemDescription>
              </ItemContent>
            </Item>
          ))}
        </ItemGroup>
      </nav>
      <ScrollArea ref={rootRef} className="min-h-0 flex-1">
        <div className="p-4">
          <Content key={section} section={section} />
        </div>
      </ScrollArea>
    </div>
  )
}
