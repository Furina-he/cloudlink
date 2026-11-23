import {
  ChevronDownIcon,
  CircleXIcon,
  CopyIcon,
  FileCodeIcon,
  FileTextIcon,
  FolderOpenIcon,
  InfoIcon,
  TriangleAlertIcon,
  type LucideIcon,
} from "lucide-react"
import { isValidElement, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { Streamdown, type DefaultComponents } from "streamdown"

import type { Asset, CompileBudget, CompilePreview, LintItem, LintLevel } from "@/bindings"
import { Truncate } from "@/components/app/Truncate"
import { Button } from "@/components/ui/button"
import { CodeBlock, CodeBlockActions, CodeBlockContent, CodeBlockCopyButton, CodeBlockLine } from "@/components/ui/code-block"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Item, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item"
import { toast } from "@/components/ui/toast"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useHighlightedCode } from "@/hooks/use-highlighted-code"
import { copy } from "@/lib/copy"
import { ipc } from "@/lib/ipc"
import { cn } from "@/lib/utils"
import { useAssetStore } from "@/stores/assets"
import { useUIStore } from "@/stores/ui"

const LEVEL: Record<LintLevel, { icon: LucideIcon; className: string }> = {
  error: { icon: CircleXIcon, className: "text-destructive" },
  warning: { icon: TriangleAlertIcon, className: "text-warning" },
  info: { icon: InfoIcon, className: "text-muted-foreground" },
}

export const fileLabel = (path: string) => path.split("/").pop() ?? path

/** 返回某个文件上的最高告警级别（error 优先于 warning）；无问题返回 null */
export function fileLintLevel(issues: LintItem[], path: string): "error" | "warning" | null {
  let found: "error" | "warning" | null = null
  for (const item of issues) {
    if (item.file !== path) continue
    if (item.level === "error") return "error"
    if (item.level === "warning") found = "warning"
  }
  return found
}

/** SKILL.md 的 frontmatter 单独拿出来，渲染视图折叠在顶部卡片里，正文交给 streamdown */
function splitFrontmatter(content: string): { front: string | null; name: string; body: string } {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(content)
  if (!m) return { front: null, name: "cloudlink-servers", body: content }
  const nameMatch = /^name:\s*(.+)$/m.exec(m[1])
  const name = nameMatch ? nameMatch[1].trim().replace(/^["']|["']$/g, "") : "cloudlink-servers"
  return { front: m[0].trimEnd(), name, body: content.slice(m[0].length) }
}

/** 从 Markdown 代码块子节点中提取纯文本，供柔和底色 CodeBlock 和复制按钮共用 */
function extractText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(extractText).join("")
  if (isValidElement<{ children?: ReactNode }>(node)) return extractText(node.props.children)
  return ""
}

const MARKDOWN_COMPONENTS: Partial<DefaultComponents> = {
  table({ node: _node, className, ...props }) {
    void _node
    return (
      <div className="my-4 w-full overflow-x-auto">
        <table {...props} className={cn("mt-0! w-full max-w-none [&_td_code]:whitespace-nowrap", className)} />
      </div>
    )
  },
  pre({ node: _node, children }) {
    void _node
    const text = extractText(children).replace(/\n$/, "")
    return (
      <CodeBlock size="sm" className="my-3 border-line bg-muted/55 dark:bg-background/60">
        {text && (
          <CodeBlockActions>
            <CodeBlockCopyButton value={text} labels={{ copy: copy.common.copy, copied: copy.common.copied }} />
          </CodeBlockActions>
        )}
        <CodeBlockContent wrap>{text}</CodeBlockContent>
      </CodeBlock>
    )
  },
}

/** 左侧目录树（P10c）：展示 SKILL.md 与 references/ 下全部文件，附带 Lint 状态圆点 */
export function FileTree({
  files,
  activePath,
  issues,
  onSelect,
}: {
  files: CompilePreview["files"]
  activePath: string
  issues: LintItem[]
  onSelect: (path: string) => void
}) {
  const rootFiles = useMemo(() => files.filter((f) => !f.path.includes("/")), [files])
  const refFiles = useMemo(() => files.filter((f) => f.path.startsWith("references/")), [files])
  const otherFiles = useMemo(() => files.filter((f) => f.path.includes("/") && !f.path.startsWith("references/")), [files])

  const renderRow = (path: string, indented = false) => {
    const active = path === activePath
    const level = fileLintLevel(issues, path)
    return (
      <button
        key={path}
        type="button"
        aria-current={active ? "page" : undefined}
        onClick={() => onSelect(path)}
        className={cn(
          "flex w-full items-center gap-1.5 rounded-control py-1.5 pr-2 text-left text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
          indented ? "pl-5" : "pl-2",
          active
            ? "bg-card font-medium text-foreground ring-1 ring-line"
            : "text-fg-2 hover:bg-pill/70 hover:text-foreground"
        )}
      >
        <FileTextIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1 truncate font-mono">{fileLabel(path)}</span>
        {level && (
          <>
            <span
              aria-hidden
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                level === "error" ? "bg-destructive" : "bg-warning"
              )}
            />
            <span className="sr-only">{copy.lintLevel[level]}</span>
          </>
        )}
      </button>
    )
  }

  return (
    <nav aria-label={copy.preview.files} className="flex flex-col gap-0.5 p-2">
      {rootFiles.map((f) => renderRow(f.path))}
      {refFiles.length > 0 && (
        <div className="mt-1 flex flex-col gap-0.5">
          <div className="flex items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground">
            <FolderOpenIcon className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate font-mono">{copy.preview.referencesGroup}/</span>
          </div>
          {refFiles.map((f) => renderRow(f.path, true))}
        </div>
      )}
      {otherFiles.map((f) => renderRow(f.path))}
    </nav>
  )
}

/** SKILL.md 顶部的可折叠 YAML Frontmatter 卡片（默认折叠） */
function FrontmatterCard({ name, front, chars }: { name: string; front: string; chars: number }) {
  const [open, setOpen] = useState(false)
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="overflow-hidden rounded-lg border border-line bg-card-2"
    >
      <CollapsibleTrigger
        render={
          <button
            type="button"
            aria-label={copy.preview.frontmatterToggle}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs outline-none hover:bg-pill/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          />
        }
      >
        <FileCodeIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="font-mono font-medium text-foreground">{name}</span>
        <span className="text-muted-foreground tabular-nums">{copy.preview.frontmatterSummary(chars)}</span>
        <ChevronDownIcon
          aria-hidden
          className={cn("ml-auto size-3.5 shrink-0 text-muted-foreground transition-transform duration-150", open && "rotate-180")}
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <CodeBlock size="sm" className="rounded-none border-0 border-t border-line-2 bg-muted/50 dark:bg-background/60">
          <CodeBlockActions>
            <CodeBlockCopyButton value={front} labels={{ copy: copy.common.copy, copied: copy.common.copied }} />
          </CodeBlockActions>
          <CodeBlockContent wrap>{front}</CodeBlockContent>
        </CodeBlock>
      </CollapsibleContent>
    </Collapsible>
  )
}

export function SourceView({ content, focusLine }: { content: string; focusLine: number | null }) {
  const lines = useHighlightedCode(content, "markdown")
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (focusLine) ref.current?.querySelector(`[data-line="${focusLine}"]`)?.scrollIntoView({ block: "center" })
  }, [focusLine, content])
  return (
    <CodeBlock ref={ref} size="sm" className="border-line bg-muted/40 dark:bg-background/60">
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

export function RenderedView({
  path,
  content,
  descriptionChars,
}: {
  path: string
  content: string
  descriptionChars?: number
}) {
  const { front, name, body } = path === "SKILL.md" ? splitFrontmatter(content) : { front: null, name: "", body: content }
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {front && <FrontmatterCard name={name} front={front} chars={descriptionChars ?? front.length} />}
      <div className="typeset w-full min-w-0 text-[13.5px] [--typeset-leading:1.68]">
        <Streamdown mode="static" controls={false} lineNumbers={false} components={MARKDOWN_COMPONENTS}>
          {body}
        </Streamdown>
      </div>
    </div>
  )
}

/** 侧栏底部安静的字数与行数参考（P10d）：去掉进度条，自动精简过描述时悬停轻声说明 */
export function PreviewMetaRef({ budget }: { budget: CompileBudget }) {
  const label = copy.preview.metaRef(budget.descriptionChars, budget.bodyLines)
  if (!budget.descriptionTrimmed) {
    return <p className="text-[11px] text-muted-foreground tabular-nums">{label}</p>
  }
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            className="inline-flex w-fit items-center gap-1 rounded-xs text-[11px] text-muted-foreground underline decoration-dotted underline-offset-2 tabular-nums outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          />
        }
      >
        <span>{label}</span>
        <InfoIcon className="size-3 shrink-0" aria-hidden />
      </TooltipTrigger>
      <TooltipContent className="max-w-64">{copy.preview.trimmedHint}</TooltipContent>
    </Tooltip>
  )
}

/** 侧栏底部安全告警计数：正常即隐身（无问题不渲染），有问题时点击跳到首个出问题的文件 */
export function LintStatusPill({
  errors,
  warnings,
  onFocusLint,
  inline = false,
}: {
  errors: number
  warnings: number
  onFocusLint: () => void
  inline?: boolean
}) {
  if (errors === 0 && warnings === 0) return null
  return (
    <button
      type="button"
      onClick={onFocusLint}
      className={cn(
        "flex items-center gap-1.5 rounded-control px-1.5 py-0.5 text-left text-xs outline-none hover:bg-pill focus-visible:ring-2 focus-visible:ring-ring",
        !inline && "-mx-1.5 w-[calc(100%+0.75rem)]",
        errors > 0 ? "text-destructive" : "text-warning"
      )}
    >
      {errors > 0 ? <CircleXIcon className="size-3.5 shrink-0" aria-hidden /> : <TriangleAlertIcon className="size-3.5 shrink-0" aria-hidden />}
      <span className="truncate font-medium tabular-nums">{copy.preview.lintSummary(errors, warnings)}</span>
    </button>
  )
}

interface FixAction {
  key: string
  label: string
  onClick: () => void
}

function helpFor(item: LintItem): string | null {
  if (item.id === "secret-detected") {
    if (item.assetId) return copy.preview.lintHelp.secretAsset
    return item.params?.section === "relations" ? copy.preview.lintHelp.secretRelations : copy.preview.lintHelp.secretConventions
  }
  if (item.id === "export-disabled-field") return copy.preview.lintHelp.exportDisabled
  if (item.id === "suspected-injection") {
    return item.params?.source === "probe" ? copy.preview.lintHelp.injectionProbe : copy.preview.lintHelp.injectionNotes
  }
  if (item.id === "publish-failed") return copy.preview.lintHelp.publishFailed
  if (item.id === "missing-reference") return copy.preview.lintHelp.missingReference
  return null
}

function fixActionsFor(
  item: LintItem,
  asset: Asset | undefined,
  compiledPath: string | null,
  logDir: string | null,
  onRetry?: () => void
): FixAction[] {
  const ui = useUIStore.getState()
  const out: FixAction[] = []
  if (item.id === "secret-detected") {
    if (item.assetId && asset) {
      out.push({ key: "edit-profile", label: copy.preview.fixActions.editProfile, onClick: () => ui.openAssetEditor(item.assetId!, "profile") })
    } else if (!item.assetId) {
      const target = item.params?.section === "relations" ? "relations" : "conventions"
      out.push({
        key: `edit-${target}`,
        label: target === "relations" ? copy.preview.fixActions.editRelations : copy.preview.fixActions.editConventions,
        onClick: () => ui.openAgentsSubpage(target),
      })
    }
  } else if (item.id === "export-disabled-field") {
    if (item.file === "SKILL.md") {
      out.push({ key: "edit-relations", label: copy.preview.fixActions.editRelations, onClick: () => ui.openAgentsSubpage("relations") })
    } else if (item.assetId && asset) {
      out.push({ key: "edit-profile", label: copy.preview.fixActions.editProfile, onClick: () => ui.openAssetEditor(item.assetId!, "profile") })
    }
    if (item.assetId && asset?.type === "vps") {
      out.push({ key: "export-settings", label: copy.preview.fixActions.exportSettings, onClick: () => ui.openAssetEditor(item.assetId!, "connection") })
    }
  } else if (item.id === "suspected-injection" && item.assetId && asset) {
    if (item.params?.source === "probe") {
      out.push({ key: "view-resource", label: copy.preview.fixActions.viewResource, onClick: () => ui.openAssetDetail(item.assetId!) })
    } else {
      out.push({ key: "edit-profile", label: copy.preview.fixActions.editProfile, onClick: () => ui.openAssetEditor(item.assetId!, "profile") })
    }
  } else if (item.id === "publish-failed") {
    if (compiledPath) out.push({ key: "open-dir", label: copy.preview.fixActions.openDir, onClick: () => void ipc.revealInDir(compiledPath) })
    if (onRetry) out.push({ key: "retry", label: copy.preview.fixActions.retry, onClick: onRetry })
  } else if (item.id === "missing-reference") {
    if (logDir) out.push({ key: "open-logs", label: copy.preview.fixActions.openLogs, onClick: () => void ipc.revealInDir(logDir) })
    if (onRetry) out.push({ key: "retry", label: copy.preview.fixActions.retry, onClick: onRetry })
  }
  return out
}

/** 当前文件顶部的可操作安全告警条（P10d）：说清怎么修 + 直达修复按钮，跳源码行退为次要「查看位置」 */
export function LintList({
  lint,
  compiledPath,
  logDir,
  onLocate,
  onRetry,
  focusRequest,
}: {
  lint: LintItem[]
  compiledPath: string | null
  logDir: string | null
  onLocate: (item: LintItem) => void
  onRetry?: () => void
  /** 每加一，滚到 Lint 区并聚焦第一条错误/警告的修复按钮 */
  focusRequest: number
}) {
  const byId = useAssetStore((s) => s.byId)
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!focusRequest || !ref.current) return
    const target =
      ref.current.querySelector<HTMLElement>("[data-level=error] button") ??
      ref.current.querySelector<HTMLElement>("button") ??
      ref.current
    target.scrollIntoView({ block: "nearest" })
    target.focus()
  }, [focusRequest])

  if (lint.length === 0) return null

  return (
    <section
      ref={ref}
      tabIndex={-1}
      aria-labelledby="preview-lint-heading"
      className="flex flex-col gap-1.5 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <h3 id="preview-lint-heading" className="sr-only">
        {copy.preview.lint}
      </h3>
      <ItemGroup className="gap-1.5">
        {lint.map((item, i) => {
          const { icon: Icon, className } = LEVEL[item.level]
          const asset = item.assetId ? byId[item.assetId] : undefined
          const displayParams = asset ? { ...item.params, alias: asset.name } : item.params
          const locatable = !!item.file && !!item.line
          const text = copy.lint[item.id](displayParams)
          const help = helpFor(item)
          const actions = fixActionsFor(item, asset, compiledPath, logDir, onRetry)
          return (
            <Item
              key={`${item.id}-${item.file ?? ""}-${item.line ?? i}`}
              size="xs"
              variant="outline"
              data-level={item.level}
              className={cn(
                "flex-wrap items-start gap-2.5 border-line bg-card-2 text-left sm:flex-nowrap",
                item.level === "warning" && "bg-warning-soft/50",
                item.level === "error" && "bg-destructive-soft/50"
              )}
            >
              <ItemMedia className="pt-0.5">
                <Icon className={cn("size-3.5", className)} aria-hidden />
              </ItemMedia>
              <ItemContent className="min-w-0 flex-1 gap-0.5">
                <ItemTitle className="line-clamp-none text-xs font-medium text-foreground">
                  <span className="sr-only">{copy.lintLevel[item.level]}：</span>
                  {text}
                </ItemTitle>
                {help && <ItemDescription className="line-clamp-none text-xs">{help}</ItemDescription>}
              </ItemContent>
              {(actions.length > 0 || locatable) && (
                <div className="flex shrink-0 flex-wrap items-center gap-1.5 self-center">
                  {actions.map((action) => (
                    <Button key={action.key} type="button" variant="outline" size="xs" className="bg-card" onClick={action.onClick}>
                      {action.label}
                    </Button>
                  ))}
                  {locatable && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      title={copy.preview.lintLocate(item.file!, item.line!)}
                      className="text-muted-foreground hover:text-foreground"
                      onClick={() => onLocate(item)}
                    >
                      {copy.preview.locateSource}
                    </Button>
                  )}
                </div>
              )}
            </Item>
          )
        })}
      </ItemGroup>
    </section>
  )
}

/** 细底栏（~32px，PRD 6.4）：编译目录，「复制路径」「在文件夹中显示」 */
export function CompiledFooter({ path }: { path: string }) {
  const copyPath = () => void navigator.clipboard.writeText(path).then(() => toast.add({ title: copy.preview.pathCopied }))
  return (
    <footer className="flex h-8 shrink-0 items-center gap-1 border-t border-line bg-card px-3.5">
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
    </footer>
  )
}
