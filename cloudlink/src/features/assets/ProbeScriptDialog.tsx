import { useEffect, useState } from "react"

import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockLine,
} from "@/components/ui/code-block"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { useHighlightedCode } from "@/hooks/use-highlighted-code"
import { copy } from "@/lib/copy"
import { ipc } from "@/lib/ipc"

function Script({ script }: { script: string }) {
  const lines = useHighlightedCode(script, "bash")
  return (
    <CodeBlock size="sm">
      <CodeBlockActions>
        <CodeBlockCopyButton value={script} labels={{ copy: copy.common.copy, copied: copy.common.copied }} />
      </CodeBlockActions>
      <CodeBlockContent lineNumbers className="max-h-[60vh]">
        {lines.map((line, i) => (
          <CodeBlockLine key={i}>{line}</CodeBlockLine>
        ))}
      </CodeBlockContent>
    </CodeBlock>
  )
}

/** 查看探测脚本（PRD 6.5、6.9）：只读，语言为 bash。懒加载，Shiki 不进首屏 */
export default function ProbeScriptDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [script, setScript] = useState<string | null>(null)
  useEffect(() => {
    if (!open) return
    let cancelled = false
    ipc.getProbeScript().then(
      (s) => !cancelled && setScript(s),
      () => undefined
    )
    return () => {
      cancelled = true
    }
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="grid-cols-[minmax(0,1fr)] sm:max-w-2xl" closeLabel={copy.common.close}>
        <DialogHeader>
          <DialogTitle>{copy.probePanel.scriptTitle}</DialogTitle>
          <DialogDescription>{copy.probePanel.scriptDescription}</DialogDescription>
        </DialogHeader>
        {script === null ? <Skeleton className="h-64" /> : <Script script={script} />}
      </DialogContent>
    </Dialog>
  )
}
