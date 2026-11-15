import { CodeBlock, CodeBlockContent, CodeBlockLine } from "@/components/ui/code-block"
import { useHighlightedCode } from "@/hooks/use-highlighted-code"

/** 将要加入 settings.json 的 JSON 原文（F-306 AC1），高亮显示。懒加载，Shiki 不进首屏（PRD 第九章） */
export default function GuardPlannedEntry({ entry }: { entry: string }) {
  const lines = useHighlightedCode(entry, "json")
  return (
    <CodeBlock size="sm">
      <CodeBlockContent wrap className="max-h-64">
        {lines.map((line, i) => (
          <CodeBlockLine key={i}>{line}</CodeBlockLine>
        ))}
      </CodeBlockContent>
    </CodeBlock>
  )
}
