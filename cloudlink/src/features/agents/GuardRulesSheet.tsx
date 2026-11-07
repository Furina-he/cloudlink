import { useEffect } from "react"

import type { GuardRules } from "@/bindings"
import { Badge } from "@/components/ui/badge"
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { copy } from "@/lib/copy"
import { useGuardStore } from "@/stores/guard"

/** 一组拦下的类别：中文说明加英文命令示例（等宽） */
function Categories({ title, list }: { title: string; list: GuardRules["standardDeny"] }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      <ItemGroup className="gap-1.5">
        {list.map((c) => (
          <Item key={c.id} role="listitem" variant="outline" size="xs">
            <ItemContent className="min-w-0">
              <ItemTitle>{copy.guardReason[c.id]}</ItemTitle>
              <ItemDescription className="line-clamp-none font-mono text-xs break-all">{c.examples.join("  ·  ")}</ItemDescription>
            </ItemContent>
          </Item>
        ))}
      </ItemGroup>
    </section>
  )
}

/** 「查看规则」（PRD 6.6、8.6）：只读白名单、标准运维下拦下的类别、任何档位都拦下的类别 */
export function GuardRulesSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const rules = useGuardStore((s) => s.rules)
  useEffect(() => {
    if (open) useGuardStore.getState().loadRules().catch(() => undefined)
  }, [open])

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" closeLabel={copy.common.close} className="gap-0 data-[side=right]:w-[min(560px,60vw)] data-[side=right]:min-w-[min(420px,100vw)] data-[side=right]:sm:max-w-none">
        <SheetHeader className="pr-12">
          <SheetTitle>{copy.guard.rulesTitle}</SheetTitle>
          <SheetDescription>{copy.guard.rulesDescription}</SheetDescription>
        </SheetHeader>
        <ScrollArea className="min-h-0 flex-1">
          {rules ? (
            <div className="flex flex-col gap-6 px-4 pb-6">
              <section className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold">{copy.guard.readOnlyTitle}</h3>
                <ul className="flex flex-wrap gap-1.5" aria-label={copy.guard.readOnlyTitle}>
                  {rules.readOnlyAllow.map((c) => (
                    <li key={c}>
                      <Badge variant="outline" className="font-mono">
                        {c}
                      </Badge>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-muted-foreground">{copy.guard.readOnlyNote}</p>
              </section>
              <Categories title={copy.guard.standardTitle} list={rules.standardDeny} />
              <Categories title={copy.guard.alwaysTitle} list={rules.alwaysDeny} />
              <p className="text-xs text-muted-foreground">{copy.guard.unparsedNote}</p>
              <p className="text-xs text-muted-foreground">{copy.guard.boundary}</p>
            </div>
          ) : (
            <div className="flex flex-col gap-3 px-4" aria-busy="true" aria-label={copy.guard.loading}>
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-20" />
              <Skeleton className="h-32" />
            </div>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  )
}
