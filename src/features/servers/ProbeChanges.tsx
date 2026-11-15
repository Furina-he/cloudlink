import { ChevronDownIcon, MinusIcon, PencilLineIcon, PlusIcon, type LucideIcon } from "lucide-react"

import type { ProbeChange, ProbeChangeKind } from "@/bindings"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { CodeBlock, CodeBlockContent, CodeBlockLine } from "@/components/ui/code-block"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item"
import { copy } from "@/lib/copy"

const KIND_ICON: Record<ProbeChangeKind, LucideIcon> = {
  added: PlusIcon,
  changed: PencilLineIcon,
  missing: MinusIcon,
}

/** 「+ 新增服务」「~ 系统」「- 未发现」（PRD 6.4 探测流程） */
function titleOf(c: ProbeChange): string {
  const field = copy.probeSheet.field[c.field]
  if (c.kind === "added") return `${copy.probeSheet.kind.added}${field}`
  if (c.kind === "missing") return copy.probeSheet.kind.missing
  return field
}

function summaryOf(c: ProbeChange): string | undefined {
  if (c.kind === "changed") return c.before ? `${c.before} -> ${c.after ?? ""}` : c.after
  if (c.kind === "added") return c.after
  return undefined
}

/**
 * 一处变化：一个 Item，展开后用 CodeBlockLine（added、removed）展示前后对比。
 * 只有待确认的项带 Checkbox（PRD 6.4）
 */
function ChangeItem({ change, selectable }: { change: ProbeChange; selectable?: { checked: boolean; onChange: (on: boolean) => void } }) {
  const Icon = KIND_ICON[change.kind]
  const field = copy.probeSheet.field[change.field]
  const summary = summaryOf(change)

  return (
    <Collapsible role="listitem">
      <Item variant="outline" size="xs" className="items-start">
        <ItemMedia className="pt-0.5">
          {selectable ? (
            <Checkbox
              checked={selectable.checked}
              onCheckedChange={(v) => selectable.onChange(v === true)}
              aria-label={copy.probeSheet.selectHeld(change.label)}
            />
          ) : (
            <Icon className="size-3.5 text-muted-foreground" aria-hidden />
          )}
        </ItemMedia>
        <ItemContent className="min-w-0">
          <ItemTitle className="flex-wrap">
            {selectable && <Icon className="size-3.5 text-muted-foreground" aria-hidden />}
            {titleOf(change)}
            {change.label !== field && <span className="font-mono font-normal">{change.label}</span>}
          </ItemTitle>
          {change.kind === "missing" ? (
            <ItemDescription className="text-xs">{copy.probeSheet.missingNote}</ItemDescription>
          ) : (
            summary && <ItemDescription className="font-mono text-xs break-all">{summary}</ItemDescription>
          )}
        </ItemContent>
        <ItemActions>
          <CollapsibleTrigger
            render={<Button variant="ghost" size="icon-xs" aria-label={copy.probeSheet.compare(change.label)} className="group/compare" />}
          >
            <ChevronDownIcon className="transition-transform group-aria-expanded/compare:rotate-180" />
          </CollapsibleTrigger>
        </ItemActions>
        <CollapsibleContent className="h-(--collapsible-panel-height) basis-full overflow-hidden transition-[height] duration-200 data-ending-style:h-0 data-starting-style:h-0">
          <CodeBlock size="sm" className="mt-1">
            <CodeBlockContent wrap>
              {change.before && <CodeBlockLine variant="removed">{change.before}</CodeBlockLine>}
              {change.after && <CodeBlockLine variant="added">{change.after}</CodeBlockLine>}
            </CodeBlockContent>
          </CodeBlock>
        </CollapsibleContent>
      </Item>
    </Collapsible>
  )
}

/** 已自动合并的变化（F-103 AC2）；撤销后标题改为「已撤销本次更新」 */
export function AppliedChanges({ changes, undone }: { changes: ProbeChange[]; undone: boolean }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium">{undone ? copy.probeSheet.undone : copy.probeSheet.applied(changes.length)}</p>
      <ItemGroup className="gap-1.5" aria-label={copy.probeSheet.applied(changes.length)}>
        {changes.map((c) => (
          <ChangeItem key={c.id} change={c} />
        ))}
      </ItemGroup>
    </div>
  )
}

/** 疑似注入、没有自动合并的变化（F-103 AC5）：勾选后「合并所选」 */
export function HeldChanges({
  changes,
  selected,
  onSelect,
}: {
  changes: ProbeChange[]
  selected: Set<string>
  onSelect: (id: string, on: boolean) => void
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium text-warning">{copy.probeSheet.held(changes.length)}</p>
      <ItemGroup className="gap-1.5" aria-label={copy.probeSheet.held(changes.length)}>
        {changes.map((c) => (
          <ChangeItem key={c.id} change={c} selectable={{ checked: selected.has(c.id), onChange: (on) => onSelect(c.id, on) }} />
        ))}
      </ItemGroup>
    </div>
  )
}
