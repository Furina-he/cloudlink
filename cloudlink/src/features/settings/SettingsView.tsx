import { CircleXIcon } from "lucide-react"
import { useEffect, useRef } from "react"

import { useScrollRestore, useViewTitleFocus } from "@/components/app/ViewShell"
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import { useDelayedFlag } from "@/hooks/use-delayed-flag"
import { copy, ipcErrorText } from "@/lib/copy"
import { cn } from "@/lib/utils"
import { useSettingsStore } from "@/stores/settings"
import { useUIStore, type SettingsSection } from "@/stores/ui"
import {
  AgentsSection,
  CompileSection,
  DangerSection,
  DataSection,
  EnvironmentsSection,
  GeneralSection,
  ProbeSection,
} from "./sections"

const SECTIONS: SettingsSection[] = ["general", "environments", "agents", "compile", "probe", "data", "danger"]

/** 设置视图（PRD 6.9）：左侧 Item 分区导航，右侧对应表单 */
export function SettingsView({ focusTitle }: { focusTitle: boolean }) {
  const rootRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  useViewTitleFocus(titleRef, focusTitle)

  const section = useUIStore((s) => s.settingsSection)
  const { settings, status, error } = useSettingsStore()
  const showSkeleton = useDelayedFlag(!settings && status !== "error")
  useEffect(() => {
    void useSettingsStore.getState().load()
  }, [])
  useScrollRestore(
    "settings",
    () => rootRef.current?.querySelector<HTMLElement>("[data-slot=scroll-area-viewport]"),
    !!settings
  )

  const content = !settings ? null : section === "general" ? (
    <GeneralSection />
  ) : section === "environments" ? (
    <EnvironmentsSection settings={settings} />
  ) : section === "agents" ? (
    <AgentsSection settings={settings} />
  ) : section === "compile" ? (
    <CompileSection settings={settings} />
  ) : section === "probe" ? (
    <ProbeSection settings={settings} />
  ) : section === "data" ? (
    <DataSection settings={settings} />
  ) : (
    <DangerSection />
  )

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
              render={
                <button
                  type="button"
                  aria-current={section === id ? "page" : undefined}
                  onClick={() => useUIStore.getState().setSettingsSection(id)}
                />
              }
              className={cn(
                "rounded-md text-left hover:bg-muted aria-[current=page]:bg-muted",
                id === "danger" && "mt-2"
              )}
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
          {error && (
            <Alert variant="destructive" className="max-w-2xl">
              <CircleXIcon />
              <AlertTitle>{copy.shell.loadFailed}</AlertTitle>
              <AlertDescription>{ipcErrorText(error.id, error.params)}</AlertDescription>
              <AlertAction>
                <Button size="sm" variant="outline" onClick={() => void useSettingsStore.getState().load()}>
                  {copy.shell.retry}
                </Button>
              </AlertAction>
            </Alert>
          )}
          {showSkeleton && (
            <div className="flex max-w-2xl flex-col gap-3" aria-busy="true" aria-label={copy.settings.loading}>
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-8" />
              <Skeleton className="h-8" />
            </div>
          )}
          {content}
        </div>
      </ScrollArea>
    </div>
  )
}
