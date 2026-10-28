import {
  CircleCheckIcon,
  CircleXIcon,
  CopyIcon,
  FolderOpenIcon,
  InfoIcon,
  PackageIcon,
  TriangleAlertIcon,
  type LucideIcon,
} from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { Streamdown } from "streamdown"

import type { CompilePreview, IpcError, LintItem, LintLevel, Mode } from "@/bindings"
import { ContextBudget } from "@/components/app/ContextBudget"
import { Truncate } from "@/components/app/Truncate"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockLine,
} from "@/components/ui/code-block"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Item, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { toast } from "@/components/ui/toast"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useHighlightedCode } from "@/hooks/use-highlighted-code"
import { copy, ipcErrorText } from "@/lib/copy"
import { ipc } from "@/lib/ipc"
import { cn } from "@/lib/utils"

export type PublishInfo = { kind: "path"; path: string } | { kind: "unpublished" } | { kind: "unsaved" }

export interface SkillPreviewProps {
  preview: CompilePreview | null
  /** 有请求在路上：显示上一次的结果，标题旁转圈 */
  pending: boolean
  error: IpcError | null
  /** 有未保存修改：标题显示「草稿预览」 */
  draft: boolean
  mode: Mode
  onModeChange: (mode: Mode) => void
  /** null：没有打开资产，底栏不显示 */
  publish: PublishInfo | null
  /** 每加一，滚到 Lint 区并聚焦第一条错误（编辑器头部「编译受阻」点进来） */
  lintRequest: number
}

const MODE_ITEMS = (["read-only", "standard"] as Mode[]).map((m) => ({ value: m, label: copy.mode[m] }))

const LEVEL: Record<LintLevel, { icon: LucideIcon; className: string }> = {
  error: { icon: CircleXIcon, className: "text-destructive" },
  warning: { icon: TriangleAlertIcon, className: "text-warning" },
  info: { icon: InfoIcon, className: "text-muted-foreground" },
}

const fileLabel = (path: string) => path.split("/").pop() ?? path

/** SKILL.md 的 frontmatter 单独拿出来，用代码块展示；渲染视图只交给 streamdown 正文 */
function splitFrontmatter(content: string): { front: string | null; body: string } {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(content)
  return m ? { front: m[0].trimEnd(), body: content.slice(m[0].length) } : { front: null, body: content }
}

function SourceView({ content, focusLine }: { content: string; focusLine: number | null }) {
  const lines = useHighlightedCode(content, "markdown")
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (focusLine) {
      ref.current?.querySelector(`[data-line="${focusLine}"]`)?.scrollIntoView({ block: "center" })
    }
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

function RenderedView({ path, content }: { path: string; content: string }) {
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

function LintList({
  lint,
  onLocate,
  focusRequest,
}: {
  lint: LintItem[]
  onLocate: (item: LintItem) => void
  focusRequest: number
}) {
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!focusRequest || !ref.current) return
    // 能定位到源码的错误项是按钮，优先聚焦它；否则聚焦整个 Lint 区
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
                      aria-label={`${copy.preview.lintLevel[item.level]}：${copy.lint[item.id](item.params)}。${copy.preview.lintLocate(item.file!, item.line!)}`}
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
                    <span className="sr-only">{copy.preview.lintLevel[item.level]}：</span>
                    {copy.lint[item.id](item.params)}
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

function PublishFooter({ publish }: { publish: PublishInfo }) {
  if (publish.kind !== "path") {
    return (
      <p className="text-xs text-muted-foreground">
        {publish.kind === "unsaved" ? copy.preview.publishAfterSave : copy.preview.unpublished}
      </p>
    )
  }
  const copyPath = () =>
    void navigator.clipboard.writeText(publish.path).then(() => toast.add({ title: copy.preview.pathCopied }))
  return (
    <>
      <span className="sr-only">{copy.preview.publishPath}</span>
      <Truncate text={publish.path} className="flex-1 font-mono text-xs text-muted-foreground" />
      <Tooltip>
        <TooltipTrigger
          render={<Button variant="ghost" size="icon-xs" aria-label={copy.preview.copyPath} onClick={copyPath} />}
        >
          <CopyIcon />
        </TooltipTrigger>
        <TooltipContent>{copy.preview.copyPath}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={copy.preview.reveal}
              onClick={() => void ipc.revealInDir(publish.path)}
            />
          }
        >
          <FolderOpenIcon />
        </TooltipTrigger>
        <TooltipContent>{copy.preview.reveal}</TooltipContent>
      </Tooltip>
    </>
  )
}

/** Skill 预览（PRD 6.4 预览面板）。资产视图和 P3 的 Skills 视图共用；用 React.lazy 按需加载 */
export default function SkillPreview({
  preview,
  pending,
  error,
  draft,
  mode,
  onModeChange,
  publish,
  lintRequest,
}: SkillPreviewProps) {
  const [file, setFile] = useState("SKILL.md")
  const [view, setView] = useState<"rendered" | "source">("rendered")
  const [focus, setFocus] = useState<{ file: string; line: number } | null>(null)
  const files = preview?.files ?? []
  const current = files.find((f) => f.path === file) ?? files[0]

  const locate = (item: LintItem) => {
    if (!item.file || !item.line) return
    setFile(item.file)
    setView("source")
    setFocus({ file: item.file, line: item.line })
  }

  return (
    <Tabs
      value={current?.path ?? "SKILL.md"}
      onValueChange={(v) => setFile(String(v))}
      className="flex h-full min-h-0 flex-col gap-0"
    >
      <div className="flex flex-col gap-2 border-b px-3 pt-3">
        <div className="flex min-h-7 items-center gap-2">
          <h2 className="text-sm font-semibold">{draft ? copy.preview.draftTitle : copy.preview.title}</h2>
          {draft && <span className="text-xs text-muted-foreground">{copy.preview.draftNote}</span>}
          {pending && preview && <Spinner aria-label={copy.preview.loading} className="ml-auto size-3.5 text-muted-foreground" />}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select items={MODE_ITEMS} value={mode} onValueChange={(v) => v && onModeChange(v as Mode)}>
            <SelectTrigger size="sm" aria-label={copy.preview.modeLabel} className="min-w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MODE_ITEMS.map((m) => (
                <SelectItem key={m.value} value={m.value}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <ToggleGroup
            aria-label={copy.preview.viewLabel}
            variant="outline"
            size="sm"
            spacing={0}
            value={[view]}
            onValueChange={(v) => v[0] && setView(v[0] as "rendered" | "source")}
          >
            <ToggleGroupItem value="rendered">{copy.preview.rendered}</ToggleGroupItem>
            <ToggleGroupItem value="source">{copy.preview.source}</ToggleGroupItem>
          </ToggleGroup>
        </div>
        {files.length > 0 ? (
          <TabsList variant="line" aria-label={copy.preview.files} className="-mb-px max-w-full justify-start overflow-x-auto">
            {files.map((f) => (
              <TabsTrigger key={f.path} value={f.path} className="flex-none font-mono text-xs">
                {fileLabel(f.path)}
              </TabsTrigger>
            ))}
          </TabsList>
        ) : (
          <div className="h-2" />
        )}
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-4 p-3">
          {error && (
            <Alert variant="destructive">
              <CircleXIcon />
              <AlertTitle>{copy.preview.failed}</AlertTitle>
              <AlertDescription>{ipcErrorText(error.id, error.params)}</AlertDescription>
            </Alert>
          )}
          {!preview && pending && (
            <div className="flex flex-col gap-3" aria-busy="true" aria-label={copy.preview.loading}>
              <div className="flex gap-1.5">
                <Skeleton className="h-12 flex-1" />
                <Skeleton className="h-12 flex-1" />
                <Skeleton className="h-12 flex-1" />
              </div>
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-40" />
            </div>
          )}
          {!preview && !pending && !error && (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <PackageIcon />
                </EmptyMedia>
                <EmptyTitle>{copy.preview.emptyTitle}</EmptyTitle>
                <EmptyDescription>{copy.preview.emptyDescription}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
          {preview && (
            <>
              <ContextBudget budget={preview.budget} />
              <LintList lint={preview.lint} onLocate={locate} focusRequest={lintRequest} />
              {files.map((f) => (
                <TabsContent key={f.path} value={f.path}>
                  {view === "source" ? (
                    <SourceView content={f.content} focusLine={focus?.file === f.path ? focus.line : null} />
                  ) : (
                    <RenderedView path={f.path} content={f.content} />
                  )}
                </TabsContent>
              ))}
            </>
          )}
        </div>
      </ScrollArea>

      {publish && (
        <div className="flex min-h-10 items-center gap-1 border-t px-3 py-1.5">
          <PublishFooter publish={publish} />
        </div>
      )}
    </Tabs>
  )
}
