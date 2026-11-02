import { CircleXIcon, ServerIcon } from "lucide-react"
import { useRef } from "react"
import { useHotkeys } from "react-hotkeys-hook"
import { useDefaultLayout } from "react-resizable-panels"

import { PreviewSheet } from "@/components/app/PreviewSheet"
import { useScrollRestore, useViewTitleFocus } from "@/components/app/ViewShell"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { Skeleton } from "@/components/ui/skeleton"
import { useDelayedFlag } from "@/hooks/use-delayed-flag"
import { copy } from "@/lib/copy"
import { HOTKEYS, isModalOpen, SINGLE_KEY_OPTIONS } from "@/lib/hotkeys"
import { useAssetStore } from "@/stores/assets"
import { useUIStore } from "@/stores/ui"
import { NewServerForm } from "./NewServerForm"
import { FirstLaunch, OnboardingChecklist, useOnboardingSteps } from "./Onboarding"
import { ProbeSheet } from "./ProbeSheet"
import { ServerDetail } from "./ServerDetail"
import { ServerList } from "./ServerList"

/** 没有选中服务器时的预览：已发布的总 Skill，列出全部文件 */
function WholePreview() {
  return <PreviewSheet scope="all" draft={{}} dirty={false} defaultFile="SKILL.md" />
}

/** 服务器视图（PRD 6.4）：没有服务器时是首次启动的空状态，否则是列表加详情 */
export function ServersView({ focusTitle }: { focusTitle: boolean }) {
  const status = useAssetStore((s) => s.status)
  const count = useAssetStore((s) => s.ids.length)
  const creating = useUIStore((s) => s.creating)
  const loading = (status === "idle" || status === "loading") && count === 0
  if (!loading && count === 0 && !creating && status !== "error") {
    return (
      <>
        <FirstLaunch focusTitle={focusTitle} />
        <WholePreview />
      </>
    )
  }
  return <Workspace focusTitle={focusTitle} loading={loading} />
}

function NoSelection() {
  const { steps, complete } = useOnboardingSteps()
  const failed = useAssetStore((s) => s.status === "error" && s.ids.length === 0)
  return (
    <div className="flex h-full items-start justify-center overflow-auto p-6">
      <Empty className="max-w-lg flex-none border">
        <EmptyHeader>
          <EmptyMedia variant="icon">{failed ? <CircleXIcon /> : <ServerIcon />}</EmptyMedia>
          <EmptyTitle>{failed ? copy.servers.loadFailedTitle : copy.servers.noSelectionTitle}</EmptyTitle>
          <EmptyDescription>{failed ? copy.servers.loadFailedDescription : copy.servers.noSelectionDescription}</EmptyDescription>
        </EmptyHeader>
        {!failed && !complete && <OnboardingChecklist steps={steps} />}
      </Empty>
    </div>
  )
}

function DetailSkeleton() {
  return (
    <div className="flex flex-col gap-4 p-3" aria-busy="true" aria-label={copy.servers.loading}>
      <Skeleton className="h-5 w-1/2" />
      <Skeleton className="h-3.5 w-1/3" />
      <Skeleton className="h-8 w-2/3" />
      <div className="flex flex-col gap-3 pt-2">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="flex flex-col gap-1.5">
            <Skeleton className="h-3.5 w-16" />
            <Skeleton className="h-8" />
          </div>
        ))}
      </div>
    </div>
  )
}

function Workspace({ focusTitle, loading }: { focusTitle: boolean; loading: boolean }) {
  const titleRef = useRef<HTMLHeadingElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  useViewTitleFocus(titleRef, focusTitle)
  useScrollRestore("servers", () => document.querySelector<HTMLElement>("#server-list [data-slot=scroll-area-viewport]"), !loading)
  const showSkeleton = useDelayedFlag(loading)

  const selectedAssetId = useUIStore((s) => s.selectedAssetId)
  const creating = useUIStore((s) => s.creating)
  const asset = useAssetStore((s) => (selectedAssetId ? s.byId[selectedAssetId] : undefined))
  const layout = useDefaultLayout({ id: "servers" })

  useHotkeys(HOTKEYS.focusSearch, () => !isModalOpen() && searchRef.current?.focus(), SINGLE_KEY_OPTIONS)

  return (
    <>
      <ResizablePanelGroup
        id="servers"
        orientation="horizontal"
        defaultLayout={layout.defaultLayout}
        onLayoutChanged={layout.onLayoutChanged}
        className="min-h-0 flex-1"
      >
        <ResizablePanel id="list" defaultSize="42%" minSize="300px">
          <ServerList titleRef={titleRef} searchRef={searchRef} loading={loading} />
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel id="detail" minSize="420px">
          {loading ? (
            showSkeleton && <DetailSkeleton />
          ) : creating ? (
            <NewServerForm />
          ) : asset ? (
            <ServerDetail key={asset.id} asset={asset} />
          ) : (
            <NoSelection />
          )}
        </ResizablePanel>
      </ResizablePanelGroup>
      {!creating && !asset && <WholePreview />}
      <ProbeSheet />
    </>
  )
}
