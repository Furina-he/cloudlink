import { ChevronDownIcon, CopyIcon } from "lucide-react"

import type { ConnectionDiagnostic as Diagnostic } from "@/bindings"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { toast } from "@/components/ui/toast"
import { copy } from "@/lib/copy"

export function diagnosticText(diagnostic: Diagnostic): string {
  return [
    `${copy.diagnostic.stageLabel}：${copy.diagnostic.stage[diagnostic.stage]}`,
    `${copy.diagnostic.clientLabel}：${copy.diagnostic.client[diagnostic.client]}${diagnostic.clientVersion ? ` ${diagnostic.clientVersion}` : ""}`,
    ...(diagnostic.exitCode === undefined ? [] : [`${copy.diagnostic.exitLabel}：${diagnostic.exitCode}`]),
    ...diagnostic.summary.map((summary) => copy.diagnostic.summary[summary]),
  ].join("\n")
}

/** Expand only the safe projection supplied by Rust, never arbitrary stderr or input. */
export function ConnectionDiagnostic({ diagnostic }: { diagnostic: Diagnostic | undefined }) {
  if (!diagnostic) return null
  const text = diagnosticText(diagnostic)
  const keyPermissions = diagnostic.summary.includes("key-permissions")
  return (
    <Collapsible className="min-w-0 text-xs">
      <CollapsibleTrigger render={<Button type="button" variant="ghost" size="xs" className="px-0" />}>
        {copy.diagnostic.title}<ChevronDownIcon data-icon="inline-end" />
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-2 pt-1.5">
        <p className="text-xs whitespace-pre-wrap wrap-anywhere select-text">{text}</p>
        {keyPermissions && <p className="text-xs text-muted-foreground">{copy.diagnostic.originalKeyRisk}</p>}
        <p className="text-xs text-muted-foreground">{copy.diagnostic.privacy}</p>
        <div><Button type="button" variant="outline" size="xs" onClick={() => void navigator.clipboard.writeText(text).then(() => toast.add({ title: copy.diagnostic.copied })).catch(() => undefined)}>
          <CopyIcon data-icon="inline-start" />{copy.diagnostic.copy}
        </Button></div>
      </CollapsibleContent>
    </Collapsible>
  )
}
