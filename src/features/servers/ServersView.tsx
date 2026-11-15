import { ChevronRightIcon, FileInputIcon, ServerIcon } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { useShallow } from "zustand/react/shallow"

import type { CliProvider } from "@/bindings"
import { PreviewSheet } from "@/components/app/PreviewSheet"
import { ProviderMark } from "@/components/app/ProviderMark"
import { BrandTile } from "@/components/app/StatusDot"
import { useScrollRestore, useViewTitleFocus } from "@/components/app/ViewShell"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { CLI_BINARY, CLI_PROVIDERS, CLOUD_PROVIDERS, CODE_HOSTS } from "@/lib/cliProviders"
import { copy } from "@/lib/copy"
import { cn } from "@/lib/utils"
import { cliEnvStatus, useAssetStore } from "@/stores/assets"
import { useCliStore } from "@/stores/cli"
import { useUIStore, type CreateKind } from "@/stores/ui"
import { CliDetail } from "./CliDetail"
import { CreateHeader } from "./CreateParts"
import { FirstLaunch, useImportableCount } from "./FirstLaunch"
import { NewCliForm } from "./NewCliForm"
import { NewServerForm } from "./NewServerForm"
import { ProbeSheet } from "./ProbeSheet"
import { ResourceList } from "./ResourceList"
import { ServerDetail } from "./ServerDetail"

/** 没有选中资源时的预览：已发布的总 Skill，列出全部文件 */
function WholePreview() {
  return <PreviewSheet scope="all" draft={{}} dirty={false} defaultFile="SKILL.md" />
}

/**
 * 添加对话框里的一行（DESIGN.md「Add Dialog」，2026-11-09 由两列选项块改为分组列表）：
 * 品牌方块 + 名称 + 一句话，右边是状态和 ›，整行可点。和资源行、Agent 行、设置行用同一种列表卡，项数多少都不会落单
 */
function TypeRow({ icon, title, blurb, status, tone = "signal", first = false, onPick }: { icon: React.ReactNode; title: string; blurb: string; status?: string; tone?: "signal" | "muted"; first?: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      onClick={onPick}
      data-autofocus={first || undefined}
      className="group/pick flex min-h-14 w-full items-center gap-3 px-3.5 py-2.5 text-left outline-none transition-colors hover:bg-card-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
    >
      <BrandTile>{icon}</BrandTile>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[13.5px] font-medium">{title}</span>
        <span className="text-xs text-muted-foreground">{blurb}</span>
      </span>
      {status && <span className={cn("shrink-0 text-xs", tone === "signal" ? "text-signal" : "text-muted-foreground")}>{status}</span>}
      <ChevronRightIcon aria-hidden className="size-4 shrink-0 text-faint group-hover/pick:text-muted-foreground" />
    </button>
  )
}

function RowGroup({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h3 id={id} className="px-1 text-[13px] font-semibold">
        {title}
      </h3>
      <div className="divide-y divide-line-2 overflow-hidden rounded-list border border-line bg-card">{children}</div>
    </section>
  )
}

/** 每一行右边的状态：已接入的资源或这次检测的结果；还没检测过时打开选择器就检测一次 */
function useCliStatus(provider: CliProvider): { text?: string; ok: boolean } {
  const assetStates = useAssetStore(useShallow((s) => s.ids.map((id) => s.byId[id]).flatMap((a) => (a.type === "cli" && a.cliProvider === provider ? Object.values(a.cli.envStates) : []))))
  const detection = useCliStore((s) => s.byProvider[provider])
  const states = (assetStates.length ? assetStates : Object.values(detection?.envStates ?? {})).filter((x) => !!x)
  if (states.length === 0) return detection?.detecting ? { text: copy.create.cliChecking, ok: false } : { ok: false }
  const statuses = states.map(cliEnvStatus)
  const binary = CLI_BINARY[provider]
  if (statuses.includes("ready")) return { text: copy.create.cliReady(binary), ok: true }
  if (statuses.includes("expired")) return { text: copy.create.cliExpired, ok: false }
  if (statuses.includes("not-logged-in")) return { text: copy.create.cliNotLoggedIn, ok: false }
  return { text: copy.create.cliNotInstalled(binary), ok: false }
}

function ProviderTile({ provider }: { provider: CliProvider }) {
  const status = useCliStatus(provider)
  return (
    <TypeRow
      icon={<ProviderMark provider={provider} className="size-4.5" />}
      title={copy.cli.name[provider]}
      blurb={copy.create.pickBlurb[provider]}
      status={status.text}
      tone={status.ok ? "signal" : "muted"}
      onPick={() => useUIStore.getState().startCreate(provider)}
    />
  )
}

/** 添加资源的第一步（PRD 6.5，Ctrl+N）：分组「服务器」「云平台」「代码托管」，每组一张列表卡、每项一行 */
function TypePicker() {
  const importable = useImportableCount()
  const ui = useUIStore.getState
  useEffect(() => {
    // 没接入过、也没检测过的云平台检测一次，选项块上才有「已登录 · wrangler」「未安装 oci」
    const assets = Object.values(useAssetStore.getState().byId)
    for (const p of CLI_PROVIDERS) {
      if (!useCliStore.getState().byProvider[p] && !assets.some((a) => a.type === "cli" && a.cliProvider === p)) void useCliStore.getState().detect(p)
    }
  }, [])
  return (
    <section aria-labelledby="detail-title" className="flex h-full min-h-0 flex-col">
      <CreateHeader title={copy.create.title} back={false} />
      {/* 对话框这一步只限最大高度（按内容定高），视口的 100% 高度算不出来，改由 flex 分配，内容超出时才能滚动 */}
      <ScrollArea className="flex min-h-0 flex-1 flex-col *:data-[slot=scroll-area-viewport]:min-h-0 *:data-[slot=scroll-area-viewport]:flex-1">
        <div className="flex flex-col gap-5 p-4 pb-6">
          <RowGroup id="pick-servers" title={copy.create.groups.servers}>
            <TypeRow icon={<ServerIcon className="size-4" />} title={copy.create.ssh} blurb={copy.create.sshPick} first onPick={() => ui().startCreate("ssh")} />
            {importable > 0 && (
              <TypeRow
                icon={<FileInputIcon className="size-4" />}
                title={copy.create.importPick}
                blurb={copy.create.importPickBlurb}
                status={copy.create.importFound(importable)}
                onPick={() => ui().setImportOpen(true)}
              />
            )}
          </RowGroup>
          <RowGroup id="pick-clouds" title={copy.create.groups.clouds}>
            {CLOUD_PROVIDERS.map((p) => (
              <ProviderTile key={p} provider={p} />
            ))}
          </RowGroup>
          <RowGroup id="pick-code" title={copy.create.groups.codeHosts}>
            {CODE_HOSTS.map((p) => (
              <ProviderTile key={p} provider={p} />
            ))}
          </RowGroup>
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
        // 选类型这一步按内容定高（底部不留空白），之后的表单固定高度，连接过程逐步展开时对话框不跳动
        className={cn(
          "flex flex-col gap-0 overflow-hidden p-0 sm:max-w-[580px]",
          shown === "pick" ? "max-h-[min(600px,calc(100svh-2rem))]" : "h-[min(600px,calc(100svh-2rem))]"
        )}
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
