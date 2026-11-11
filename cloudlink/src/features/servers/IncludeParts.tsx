import type { EnvId } from "@/bindings"
import { CommandChip } from "@/components/app/CommandChip"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { copy } from "@/lib/copy"
import { useTargetStore } from "@/stores/targets"

/** 「了解详情」（PRD 6.5、6.13）：哪些运行环境、加的是哪一行、会先备份。Include 这一行只在这里出现 */
export function IncludeDetails({ envIds }: { envIds: EnvId[] }) {
  const sshConfig = useTargetStore((s) => s.sshConfig)
  const lines = [...new Set(envIds.map((id) => sshConfig.find((s) => s.envId === id)?.includeLine ?? "Include ~/.ssh/cloudlink.conf"))]
  return (
    <Collapsible className="flex flex-col gap-1.5">
      <CollapsibleTrigger className="w-fit rounded-sm text-xs text-muted-foreground underline underline-offset-2 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
        {copy.include.more}
      </CollapsibleTrigger>
      <CollapsibleContent className="h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-200 data-ending-style:h-0 data-starting-style:h-0">
        <p className="text-xs leading-relaxed text-muted-foreground">
          {copy.include.detail.lead(envIds.map(copy.env.long).join("、"))}{" "}
          {lines.map((line) => (
            <CommandChip key={line}>{line}</CommandChip>
          ))}
          。{copy.include.detail.tail}
        </p>
      </CollapsibleContent>
    </Collapsible>
  )
}
