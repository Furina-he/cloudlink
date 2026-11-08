import { FileInputIcon, ServerIcon } from "lucide-react"
import { useRef, useState } from "react"
import { useShallow } from "zustand/react/shallow"

import type { CliProvider } from "@/bindings"
import { PreviewSheet } from "@/components/app/PreviewSheet"
import { ProviderMark } from "@/components/app/ProviderMark"
import { useScrollRestore, useViewTitleFocus } from "@/components/app/ViewShell"
import { Button } from "@/components/ui/button"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { CLI_BINARY, CLI_PROVIDERS } from "@/lib/cliProviders"
import { copy } from "@/lib/copy"
import { useAssetStore } from "@/stores/assets"
import { useUIStore, type CreateKind } from "@/stores/ui"
import { CliDetail } from "./CliDetail"
import { CreateHeader } from "./CreateParts"
import { FirstLaunch } from "./FirstLaunch"
import { NewCliForm } from "./NewCliForm"
import { NewServerForm } from "./NewServerForm"
import { ProbeSheet } from "./ProbeSheet"
import { ResourceList } from "./ResourceList"
import { ServerDetail } from "./ServerDetail"

/** 没有选中资源时的预览：已发布的总 Skill，列出全部文件 */
function WholePreview() {
  return <PreviewSheet scope="all" draft={{}} dirty={false} defaultFile="SKILL.md" />
}

/** 一个资源类型选择项（DESIGN.md：添加面板里的类型选择用 Card）。整张卡片是一个按钮 */
/** added：这家已接入的账号数；可以继续接入其他账号。first：弹窗打开时焦点落在这张卡片上 */
function TypeCard({ icon, title, meta, blurb, added = 0, first = false, onPick }: { icon: React.ReactNode; title: string; meta?: string; blurb: string; added?: number; first?: boolean; onPick: () => void }) {
  return (
    <button type="button" onClick={onPick} data-autofocus={first || undefined} className="group/type rounded-xl text-left outline-none">
      <Card size="sm" className="transition-colors group-focus-visible/type:ring-2 group-focus-visible/type:ring-ring group-hover/type:bg-muted/50">
        <CardHeader className="grid-cols-[auto_minmax(0,1fr)] gap-x-3">
          <span aria-hidden className="row-span-2 flex size-8 items-center justify-center rounded-md bg-muted">
            {icon}
          </span>
          <CardTitle className="flex items-center gap-2">
            {title}
            {meta && <span className="font-mono text-xs font-normal text-muted-foreground">{meta}</span>}
            {added > 0 && <span className="ml-auto text-xs font-normal text-muted-foreground">{copy.create.addedCount(added)}</span>}
          </CardTitle>
          <CardDescription className="text-xs">{blurb}</CardDescription>
        </CardHeader>
      </Card>
    </button>
  )
}

/** 添加资源的第一步（PRD 6.5，Ctrl+N）：选类型。云平台用官方 Logo；同一家可以接入多个账号 */
function TypePicker() {
  const providers = useAssetStore(useShallow((s) => s.ids.map((id) => s.byId[id]).flatMap((a) => (a.type === "cli" ? [a.cliProvider] : []))))
  const ui = useUIStore.getState
  return (
    <section aria-labelledby="detail-title" className="flex h-full min-h-0 flex-col">
      <CreateHeader title={copy.create.title} back={false} />
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-5 p-3 pb-6">
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">{copy.create.directGroup}</h3>
            <TypeCard icon={<ServerIcon className="size-4" />} title={copy.create.ssh} blurb={copy.create.sshBlurb} first onPick={() => ui().startCreate("ssh")} />
          </div>
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">{copy.create.cliGroup}</h3>
            {CLI_PROVIDERS.map((p: CliProvider) => (
              <TypeCard
                key={p}
                icon={<ProviderMark provider={p} className="size-5" />}
                title={copy.cli.name[p]}
                meta={CLI_BINARY[p]}
                blurb={copy.cli.blurb[p]}
                added={providers.filter((x) => x === p).length}
                onPick={() => ui().startCreate(p)}
              />
            ))}
          </div>
          <Button variant="outline" size="sm" className="w-fit" onClick={() => ui().setImportOpen(true)}>
            <FileInputIcon data-icon="inline-start" />
            {copy.servers.importSsh}
          </Button>
        </div>
      </ScrollArea>
    </section>
  )
}

function Creating({ kind }: { kind: CreateKind }) {
  if (kind === "pick") return <TypePicker />
  if (kind === "ssh") return <NewServerForm />
  return <NewCliForm key={kind} provider={kind} />
}

/**
 * 添加资源（PRD 6.5）：居中弹窗，不挤压主列表；完成后关闭并回到列表。
 * 关闭（Esc、遮罩、右上角）都走 closeInspector，表单有未保存修改时先确认
 */
function CreateDialog() {
  const creating = useUIStore((s) => s.creating)
  // 关闭后保留最后一次的内容，退场动画期间不闪空
  const [last, setLast] = useState(creating)
  if (creating && creating !== last) setLast(creating)
  const shown = creating ?? last
  const popupRef = useRef<HTMLDivElement>(null)
  return (
    <Dialog open={!!creating} onOpenChange={(open) => !open && useUIStore.getState().closeInspector()}>
      <DialogContent
        ref={popupRef}
        // 打开时焦点不经过标题栏的图标按钮：落在那里会弹出它的 Tooltip，第一下 Esc 只能关掉 Tooltip。
        // 选类型时落在第一张卡片上；SSH 表单自己把焦点放到地址（有预填时放到用户），其余先落在弹窗本身
        initialFocus={() => popupRef.current?.querySelector<HTMLElement>("[data-autofocus]") ?? popupRef.current}
        showCloseButton={false}
        className="flex h-[min(600px,calc(100svh-2rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg"
      >
        {shown && <Creating kind={shown} />}
      </DialogContent>
    </Dialog>
  )
}

/** 资源视图（PRD 6.4）：没有资源时是首次启动的空状态，否则是全宽配电盘；点某一行切到全宽详情（← 返回），添加用居中弹窗 */
export function ServersView({ focusTitle }: { focusTitle: boolean }) {
  const status = useAssetStore((s) => s.status)
  const count = useAssetStore((s) => s.ids.length)
  const loading = (status === "idle" || status === "loading") && count === 0
  const empty = !loading && count === 0 && status !== "error"
  const selectedAssetId = useUIStore((s) => s.selectedAssetId)
  const asset = useAssetStore((s) => (selectedAssetId ? s.byId[selectedAssetId] : undefined))

  return (
    <>
      {empty ? (
        <FirstLaunch focusTitle={focusTitle} />
      ) : asset ? (
        <div className="mx-auto flex min-h-0 w-full max-w-190 flex-1 flex-col">
          {asset.type === "vps" ? <ServerDetail key={asset.id} asset={asset} /> : <CliDetail key={asset.id} asset={asset} />}
        </div>
      ) : (
        <ListView focusTitle={focusTitle} loading={loading} />
      )}
      {!asset && <WholePreview />}
      <CreateDialog />
      <ProbeSheet />
    </>
  )
}

function ListView({ focusTitle, loading }: { focusTitle: boolean; loading: boolean }) {
  const titleRef = useRef<HTMLHeadingElement>(null)
  useViewTitleFocus(titleRef, focusTitle)
  useScrollRestore("servers", () => document.querySelector<HTMLElement>("#server-list [data-slot=scroll-area-viewport]"), !loading)
  return <ResourceList titleRef={titleRef} loading={loading} />
}
