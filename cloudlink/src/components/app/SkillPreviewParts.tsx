import { CircleCheckIcon, CircleXIcon, CopyIcon, FolderOpenIcon, InfoIcon, TriangleAlertIcon, type LucideIcon } from "lucide-react"
import { useEffect, useRef } from "react"
import { Streamdown } from "streamdown"

import type { CompileBudget, LintItem, LintLevel } from "@/bindings"
import { Truncate } from "@/components/app/Truncate"
import { Button } from "@/components/ui/button"
import { CodeBlock, CodeBlockActions, CodeBlockContent, CodeBlockCopyButton, CodeBlockLine } from "@/components/ui/code-block"
import { Item, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item"
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress"
import { toast } from "@/components/ui/toast"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useHighlightedCode } from "@/hooks/use-highlighted-code"
import { copy } from "@/lib/copy"
import { ipc } from "@/lib/ipc"
import { cn } from "@/lib/utils"

const LEVEL: Record<LintLevel, { icon: LucideIcon; className: string }> = {
  error: { icon: CircleXIcon, className: "text-destructive" },
  warning: { icon: TriangleAlertIcon, className: "text-warning" },
  info: { icon: InfoIcon, className: "text-muted-foreground" },
}

/** SKILL.md 的 frontmatter 单独拿出来，用代码块展示；渲染视图只交给 streamdown 正文 */
function splitFrontmatter(content: string): { front: string | null; body: string } {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(content)
  return m ? { front: m[0].trimEnd(), body: content.slice(m[0].length) } : { front: null, body: content }
}

export function SourceView({ content, focusLine }: { content: string; focusLine: number | null }) {
  const lines = useHighlightedCode(content, "markdown")
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (focusLine) ref.current?.querySelector(`[data-line="${focusLine}"]`)?.scrollIntoView({ block: "center" })
  }, [focusLine, content])
  return (
    <CodeBlock ref={ref} size="sm">
      <CodeBlockActions>
        <CodeBlockCopyButton value={content} labels={{ copy: copy.common.copy, copied: copy.common.copied }} />
      </CodeBlockActions>
      <CodeBlockContent lineNumbers wrap>
        {lines.map((line, i) => (
          <CodeBlockLine
            key={i}
            data-line={i + 1}
            variant={focusLine === i + 1 ? "highlighted" : "default"}
            aria-current={focusLine === i + 1 ? "true" : undefined}
          >
            {line}
          </CodeBlockLine>
        ))}
      </CodeBlockContent>
    </CodeBlock>
  )
}

export function RenderedView({ path, content }: { path: string; content: string }) {
  const { front, body } = path === "SKILL.md" ? splitFrontmatter(content) : { front: null, body: content }
  return (
    <div className="flex flex-col gap-3">
      {front && (
        <CodeBlock size="sm">
          <CodeBlockContent wrap>{front}</CodeBlockContent>
        </CodeBlock>
      )}
      <div className="typeset max-w-[72ch] text-sm [--typeset-leading:1.7]">
        <Streamdown mode="static" controls={false} lineNumbers={false}>
          {body}
        </Streamdown>
      </div>
    </div>
  )
}

/** 指示条：低于 90% 钢墨色，达到 90% 变琥珀，超过 100% 变红并配文字（DESIGN.md 预算区） */
function LimitBar({ label, used, max, text }: { label: string; used: number; max: number; text: string }) {
  const ratio = max > 0 ? used / max : 0
  const tone = ratio > 1 ? "destructive" : ratio >= 0.9 ? "warning" : "default"
  return (
    <Progress value={Math.min(100, ratio * 100)} tone={tone} className="min-w-0 flex-1 gap-1.5">
      <ProgressLabel className="text-xs font-normal text-muted-foreground">{label}</ProgressLabel>
      <ProgressValue className={cn("font-mono text-xs tabular-nums", tone === "warning" && "text-warning", tone === "destructive" && "text-destructive")}>
        {() => (
          <>
            {text}
            {tone !== "default" && <span className="ml-1 font-sans">{tone === "warning" ? copy.preview.near : copy.preview.over}</span>}
          </>
        )}
      </ProgressValue>
    </Progress>
  )
}

/** 预算区（F-204）：description 字符数和正文行数相对上限的占用 */
export function BudgetBars({ budget }: { budget: CompileBudget }) {
  return (
    <section aria-label={copy.preview.budget} className="flex flex-wrap gap-4">
      <LimitBar
        label={copy.preview.description}
        used={budget.descriptionChars}
        max={budget.descriptionLimit}
        text={copy.preview.chars(budget.descriptionChars, budget.descriptionLimit)}
      />
      <LimitBar label={copy.preview.body} used={budget.bodyLines} max={budget.bodyLineLimit} text={copy.preview.lines(budget.bodyLines, budget.bodyLineLimit)} />
    </section>
  )
}

export function LintList({
  lint,
  onLocate,
  focusRequest,
}: {
  lint: LintItem[]
  onLocate: (item: LintItem) => void
  /** 每加一，滚到 Lint 区并聚焦第一条错误（详情头部「编译受阻」点进来） */
  focusRequest: number
}) {
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!focusRequest || !ref.current) return
    const target = ref.current.querySelector<HTMLElement>("button[data-level=error]") ?? ref.current
    target.scrollIntoView({ block: "nearest" })
    target.focus()
  }, [focusRequest])

  return (
    <section
      ref={ref}
      tabIndex={-1}
      aria-labelledby="preview-lint-heading"
      className="flex flex-col gap-1.5 rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <h3 id="preview-lint-heading" className="text-xs font-medium text-muted-foreground">
        {copy.preview.lint}
      </h3>
      {lint.length === 0 ? (
        <p className="flex items-center gap-1.5 text-sm">
          <CircleCheckIcon className="size-4 text-success" aria-hidden />
          {copy.preview.lintNone}
        </p>
      ) : (
        <ItemGroup className="gap-1">
          {lint.map((item, i) => {
            const { icon: Icon, className } = LEVEL[item.level]
            const locatable = !!item.file && !!item.line
            const text = copy.lint[item.id](item.params)
            return (
              <Item
                key={`${item.id}-${i}`}
                size="xs"
                variant="outline"
                data-level={item.level}
                render={
                  locatable ? (
                    <button
                      type="button"
                      onClick={() => onLocate(item)}
                      aria-label={`${copy.lintLevel[item.level]}：${text}。${copy.preview.lintLocate(item.file!, item.line!)}`}
                    />
                  ) : undefined
                }
                className="flex-nowrap items-start text-left [&:is(button)]:hover:bg-muted"
              >
                <ItemMedia className="pt-0.5">
                  <Icon className={cn("size-4", className)} aria-hidden />
                </ItemMedia>
                <ItemContent className="min-w-0">
                  <ItemTitle className="line-clamp-none font-normal">
                    <span className="sr-only">{copy.lintLevel[item.level]}：</span>
                    {text}
                  </ItemTitle>
                  {locatable && (
                    <ItemDescription className="font-mono text-xs">
                      {item.file}:{item.line}
                    </ItemDescription>
                  )}
                </ItemContent>
              </Item>
            )
          })}
        </ItemGroup>
      )}
    </section>
  )
}

/** 底栏（PRD 6.4）：编译目录，「复制路径」「在文件夹中显示」 */
export function CompiledFooter({ path }: { path: string }) {
  const copyPath = () => void navigator.clipboard.writeText(path).then(() => toast.add({ title: copy.preview.pathCopied }))
  return (
    <div className="flex min-h-10 items-center gap-1 border-t px-4 py-1.5">
      <span className="sr-only">{copy.preview.compiledDir}</span>
      <Truncate text={path} className="flex-1 font-mono text-xs text-muted-foreground" />
      <Tooltip>
        <TooltipTrigger render={<Button variant="ghost" size="icon-xs" aria-label={copy.preview.copyPath} onClick={copyPath} />}>
          <CopyIcon />
        </TooltipTrigger>
        <TooltipContent>{copy.preview.copyPath}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={<Button variant="ghost" size="icon-xs" aria-label={copy.common.reveal} onClick={() => void ipc.revealInDir(path)} />}
        >
          <FolderOpenIcon />
        </TooltipTrigger>
        <TooltipContent>{copy.common.reveal}</TooltipContent>
      </Tooltip>
    </div>
  )
}
