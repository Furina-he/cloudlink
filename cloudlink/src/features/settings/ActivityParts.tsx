import {
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

import type { ActivityItem, ActivityKind, Asset } from "@/bindings"
import { TextWithCode } from "@/components/app/TextWithCode"
import { CodeBlock, CodeBlockContent } from "@/components/ui/code-block"
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList } from "@/components/ui/combobox"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { TraceCollapsible, TraceCollapsibleContent, TraceCollapsibleTrigger, TraceDescription, TraceIcon, TraceLine, TraceTitle } from "@/components/ui/trace"
import { copy } from "@/lib/copy"
import { formatDuration, formatTime } from "@/lib/format"
import { useActivityStore } from "@/stores/activity"
import { handleOf, useAssetStore } from "@/stores/assets"

/** 图标按类型区分（PRD 6.7） */
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
}

/** CloudLink 自己的操作；「Agent 操作」单独一项（PRD 6.7） */
const OWN_KINDS: ActivityKind[] = ["connection", "probe", "compile", "deliver", "remove", "repair", "ssh-config", "guard", "mode", "cli", "note"]
const AGENT_KIND: ActivityKind = "agent-op"

/** 一条记录是一行 TraceLine；有详情的用 TraceCollapsible 展开，里面是命令清单、差异摘要或完整命令 */
export function ActivityLine({ item }: { item: ActivityItem }) {
  const Icon = KIND_ICON[item.kind]
  const line = (
    <TraceLine status={item.ok ? undefined : "error"}>
      <TraceIcon>
        <Icon />
      </TraceIcon>
      <TraceTitle className="text-foreground">
        <span className="sr-only">{copy.activityKind[item.kind]}：</span>
        <TextWithCode text={copy.activity[item.messageId](item.params)} />
        {/* Agent 操作被拦下时，句子里已经写明 */}
        {!item.ok && item.kind !== AGENT_KIND && <span className="sr-only">（{copy.activityView.failed}）</span>}
      </TraceTitle>
      <TraceDescription className="tabular-nums">
        {formatTime(item.at)}
        {item.durationMs != null && ` · ${formatDuration(item.durationMs)}`}
      </TraceDescription>
    </TraceLine>
  )
  if (!item.detail) return <div role="listitem">{line}</div>
  return (
    <TraceCollapsible role="listitem">
      <TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
      <TraceCollapsibleContent>
        <CodeBlock size="sm">
          <CodeBlockContent wrap>{item.detail}</CodeBlockContent>
        </CodeBlock>
      </TraceCollapsibleContent>
    </TraceCollapsible>
  )
}

/** 筛选（PRD 6.7）：类型用 ToggleGroup，「Agent 操作」单独一组；服务器用 Combobox。改动后从第一页重新加载 */
export function ActivityFilters() {
  const query = useActivityStore((s) => s.query)
  const byId = useAssetStore((s) => s.byId)
  const assets = useMemo(() => Object.values(byId).sort((a, b) => a.name.localeCompare(b.name)), [byId])
  const selected = query.assetId ? (byId[query.assetId] ?? null) : null
  const kinds = query.kinds ?? []
  const load = useActivityStore.getState().load
  const setKinds = (own: string[], agent: string[]) => void load({ ...query, kinds: [...own, ...agent] as ActivityKind[] })
  const own = kinds.filter((k) => k !== AGENT_KIND)
  const agent = kinds.filter((k) => k === AGENT_KIND)

  return (
    <div className="flex flex-col gap-2">
      <ToggleGroup
        multiple
        aria-label={copy.activityView.kindFilter}
        variant="outline"
        size="sm"
        spacing={1}
        value={own}
        onValueChange={(v) => setKinds(v, agent)}
        className="flex-wrap"
      >
        {OWN_KINDS.map((k) => {
          const Icon = KIND_ICON[k]
          return (
            <ToggleGroupItem key={k} value={k}>
              <Icon data-icon="inline-start" />
              {copy.activityKind[k]}
            </ToggleGroupItem>
          )
        })}
      </ToggleGroup>
      <div className="flex flex-wrap items-center gap-2">
        <ToggleGroup
          multiple
          aria-label={copy.activityKind[AGENT_KIND]}
          variant="outline"
          size="sm"
          value={agent}
          onValueChange={(v) => setKinds(own, v)}
        >
          <ToggleGroupItem value={AGENT_KIND}>
            <TerminalIcon data-icon="inline-start" />
            {copy.activityKind[AGENT_KIND]}
          </ToggleGroupItem>
        </ToggleGroup>
        <Combobox
          items={assets}
          value={selected}
          onValueChange={(a: Asset | null) => void load({ ...query, assetId: a?.id })}
          itemToStringLabel={(a: Asset) => handleOf(a)}
          isItemEqualToValue={(a: Asset, b: Asset) => a.id === b.id}
          filter={(a: Asset, q: string) => {
            const needle = q.trim().toLowerCase()
            return !needle || handleOf(a).toLowerCase().includes(needle) || a.name.toLowerCase().includes(needle)
          }}
          autoHighlight
        >
          <ComboboxInput
            aria-label={copy.activityView.assetFilter}
            placeholder={copy.activityView.assetPlaceholder}
            className="w-52"
            showClear={!!selected}
            triggerLabel={copy.common.showOptions}
            clearLabel={copy.common.clear}
          />
          <ComboboxContent>
            <ComboboxEmpty>{copy.common.noOptions}</ComboboxEmpty>
            <ComboboxList>
              {(a: Asset) => (
                <ComboboxItem key={a.id} value={a}>
                  <span className="truncate font-mono">{handleOf(a)}</span>
                  <span className="ml-auto shrink-0 truncate text-xs text-muted-foreground">{a.name}</span>
                </ComboboxItem>
              )}
            </ComboboxList>
          </ComboboxContent>
        </Combobox>
      </div>
    </div>
  )
}