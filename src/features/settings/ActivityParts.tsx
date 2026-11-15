import {
  CircleArrowUpIcon,
  FileCogIcon,
  FolderMinusIcon,
  FolderSyncIcon,
  HammerIcon,
  NotebookPenIcon,
  PlugIcon,
  RadarIcon,
  ShieldIcon,
  SquareTerminalIcon,
  TerminalIcon,
  WrenchIcon,
  type LucideIcon,
} from "lucide-react"
import { useMemo } from "react"

import type { ActivityItem, ActivityKind } from "@/bindings"
import { TextWithCode } from "@/components/app/TextWithCode"
import { CodeBlock, CodeBlockContent } from "@/components/ui/code-block"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { copy } from "@/lib/copy"
import { formatDuration, formatTime } from "@/lib/format"
import { cn } from "@/lib/utils"
import { OWN_ACTIVITY_KINDS, useActivityStore } from "@/stores/activity"
import { handleOf, useAssetStore } from "@/stores/assets"

/** 图标按类型区分（PRD 6.8） */
const KIND_ICON: Record<ActivityKind, LucideIcon> = {
  connection: PlugIcon,
  probe: RadarIcon,
  compile: HammerIcon,
  deliver: FolderSyncIcon,
  remove: FolderMinusIcon,
  repair: WrenchIcon,
  "ssh-config": FileCogIcon,
  guard: ShieldIcon,
  mode: WrenchIcon,
  cli: SquareTerminalIcon,
  note: NotebookPenIcon,
  "agent-op": TerminalIcon,
  update: CircleArrowUpIcon,
}

const ROW = "flex min-h-10 w-full items-center gap-2.5 px-3.5 py-2 text-left text-[13px]"

/**
 * 一条记录一行（DESIGN.md Activity Log Sheet）：14px 图标 → 一句话（单行，放不下省略）→ 时间（44px 固定列，右对齐）。
 * 失败的行文字用红色；带详情的行点开看命令清单或差异摘要
 */
export function ActivityLine({ item }: { item: ActivityItem }) {
  const Icon = KIND_ICON[item.kind]
  const text = copy.activity[item.messageId](item.params)
  const time = formatTime(item.at)
  const body = (
    <>
      <Icon aria-hidden className={cn("size-3.5 shrink-0", item.ok ? "text-muted-foreground" : "text-destructive")} />
      <span className={cn("min-w-0 flex-1 truncate", !item.ok && "text-destructive")} title={item.durationMs != null ? `${time} · ${formatDuration(item.durationMs)}` : undefined}>
        <span className="sr-only">{copy.activityKind[item.kind]}：</span>
        <TextWithCode text={text} />
        {!item.ok && <span className="sr-only">（{copy.activityView.failed}）</span>}
      </span>
      <span className="w-11 shrink-0 text-right text-xs text-muted-foreground tabular-nums">{time}</span>
    </>
  )
  if (!item.detail) {
    return (
      <div role="listitem" data-ok={item.ok} className={ROW}>
        {body}
      </div>
    )
  }
  return (
    <Collapsible role="listitem" data-ok={item.ok}>
      <CollapsibleTrigger className={cn(ROW, "outline-none hover:bg-card-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset")}>{body}</CollapsibleTrigger>
      <CollapsibleContent className="h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-200 data-ending-style:h-0 data-starting-style:h-0">
        <div className="px-3.5 pb-2.5 pl-9.5">
          <CodeBlock size="sm">
            <CodeBlockContent wrap>{item.detail}</CodeBlockContent>
          </CodeBlock>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

const ALL = "__all__"

/** 筛选（F-402）：「全部类型」「全部资源」两个弹出按钮，放在面板标题行。改动后从第一页重新加载 */
export function ActivityFilters() {
  const query = useActivityStore((s) => s.query)
  const byId = useAssetStore((s) => s.byId)
  const assets = useMemo(() => Object.values(byId).sort((a, b) => handleOf(a).localeCompare(handleOf(b))), [byId])
  const load = useActivityStore.getState().load
  const kind = query.kinds?.length === 1 ? query.kinds[0] : ALL
  const assetId = query.assetId ?? ALL

  return (
    <>
      <Select value={kind} onValueChange={(v) => void load({ ...query, kinds: v === ALL ? undefined : [v as ActivityKind] })}>
        <SelectTrigger size="sm" aria-label={copy.activityView.kindFilter} className="h-6.5 w-28">
          <SelectValue>{(v: string) => (v === ALL ? copy.activityView.allKinds : copy.activityKind[v as ActivityKind])}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{copy.activityView.allKinds}</SelectItem>
          {OWN_ACTIVITY_KINDS.map((k) => (
            <SelectItem key={k} value={k}>
              {copy.activityKind[k]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={assetId} onValueChange={(v) => void load({ ...query, assetId: v === ALL ? undefined : (v as string) })}>
        <SelectTrigger size="sm" aria-label={copy.activityView.assetFilter} className="h-6.5 w-32">
          <SelectValue>{(v: string) => (v === ALL ? copy.activityView.allAssets : byId[v] ? handleOf(byId[v]) : copy.feed.deletedAsset)}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{copy.activityView.allAssets}</SelectItem>
          {assets.map((a) => (
            <SelectItem key={a.id} value={a.id}>
              {handleOf(a)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  )
}
