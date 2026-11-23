import { CheckIcon, CircleXIcon, CopyIcon, InfoIcon, PackageIcon, XIcon } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import type { CompilePreview, IpcError, LintItem } from "@/bindings"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { DialogClose, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "@/components/ui/toast"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { copy, ipcErrorText } from "@/lib/copy"
import type { PreviewFocus } from "@/stores/ui"
import {
  CompiledFooter,
  FileTree,
  LintList,
  LintStatusPill,
  PreviewMetaRef,
  RenderedView,
  SourceView,
  fileLabel,
  fileLintLevel,
} from "./SkillPreviewParts"

export interface SkillPreviewProps {
  dirty: boolean
  preview: CompilePreview | null
  /** 有请求在路上：显示上一次的结果，旁边转圈 */
  pending: boolean
  error: IpcError | null
  /** 预览哪一份总 Skill（运行环境 × Agent） */
  targetKey: string
  targets: { key: string; label: string }[]
  onTargetChange: (key: string) => void
  /** 默认打开的文件 */
  defaultFile: string
  /** 打开弹窗时的定位请求 */
  focus: PreviewFocus
  compiledPath: string | null
  logDir?: string | null
  onRetry?: () => void
  /** 顶部说明，例如「目前未列入」（2026-10-31 用户确认） */
  note?: string | null
}

/** 详情文件名重名时编译器会追加 -2 后缀（PRD 5.3），按前缀回退匹配 */
function matchFile(files: CompilePreview["files"], target: string) {
  const exact = files.find((f) => f.path === target)
  if (exact) return exact
  if (target.startsWith("references/") && target.endsWith(".md")) {
    const base = target.slice(0, -3).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const suffixed = files.find((f) => new RegExp(`^${base}-\\d+\\.md$`).test(f.path))
    if (suffixed) return suffixed
  }
  return files[0]
}

/** 总 Skill 预览（PRD 6.4、F-204、DESIGN.md）：居中宽阅读弹窗 + 左侧文件树；React.lazy 按需加载 */
export default function SkillPreview({
  dirty,
  preview,
  pending,
  error,
  targetKey,
  targets,
  onTargetChange,
  defaultFile,
  focus,
  compiledPath,
  logDir,
  onRetry,
  note,
}: SkillPreviewProps) {
  const [file, setFile] = useState(focus.file ?? defaultFile)
  const [seenSeq, setSeenSeq] = useState(focus.seq)
  const [view, setView] = useState<"rendered" | "source">("rendered")
  const [located, setLocated] = useState<{ file: string; line: number } | null>(null)
  const [lintFocusTick, setLintFocusTick] = useState(focus.lint ? focus.seq : 0)
  const [copiedFile, setCopiedFile] = useState(false)
  const readerRef = useRef<HTMLDivElement>(null)
  const scrollReaderTop = () => {
    const vp = readerRef.current?.querySelector<HTMLElement>("[data-slot=scroll-area-viewport]")
    if (vp) vp.scrollTop = 0
  }

  if (seenSeq !== focus.seq) {
    setSeenSeq(focus.seq)
    setFile(focus.file ?? defaultFile)
    setLocated(null)
    if (focus.lint) {
      setView("rendered")
      setLintFocusTick(focus.seq)
    }
  }

  useEffect(() => {
    if (!copiedFile) return
    const timer = setTimeout(() => setCopiedFile(false), 1800)
    return () => clearTimeout(timer)
  }, [copiedFile])

  const files = preview?.files ?? []
  const current = files.length > 0 ? matchFile(files, file) : undefined
  const activePath = current?.path ?? file
  const issues = (preview?.lint ?? []).filter((l) => l.level === "error" || l.level === "warning")
  // P10d：告警按当前打开文件归属展示，不跨文件霸屏；无文件归属的全局问题（如 publish-failed）始终可见
  const currentIssues = issues.filter((item) => !item.file || item.file === activePath)
  const errors = issues.filter((l) => l.level === "error").length
  const warnings = issues.filter((l) => l.level === "warning").length

  const selectFile = (path: string) => {
    setFile(path)
    if (located && located.file !== path) setLocated(null)
    scrollReaderTop()
  }

  const locate = (item: LintItem) => {
    if (!item.file || !item.line) return
    setFile(item.file)
    setView("source")
    setLocated({ file: item.file, line: item.line })
  }

  const focusLint = () => {
    const first = issues.find((l) => l.level === "error") ?? issues[0]
    if (first?.file && first.file !== activePath) setFile(first.file)
    setView("rendered")
    setLintFocusTick((n) => n + 1)
    scrollReaderTop()
  }

  const copyCurrentFile = () => {
    if (!current) return
    void navigator.clipboard
      .writeText(current.content)
      .then(() => {
        setCopiedFile(true)
        toast.add({ title: copy.preview.fileCopied(fileLabel(current.path)) })
      })
      .catch(() => undefined)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 单行紧凑顶栏（~44px）：标题（草稿轻注）+ 目标切换 + 窄窗文件选择 | 渲染/源码 + 复制 + 关闭 */}
      <header className="flex min-h-11 shrink-0 items-center gap-2 border-b border-line bg-card px-3.5 py-1.5">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <DialogTitle variant="editor" className="shrink-0">
            {copy.preview.title}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {dirty ? copy.preview.draftNote : copy.preview.publishedNote}
          </DialogDescription>
          {dirty && (
            <span className="shrink-0 rounded-control bg-pill px-1.5 py-0.5 text-xs text-muted-foreground">
              {copy.preview.draftTitle}
            </span>
          )}
          {targets.length > 1 ? (
            <Select items={targets.map((t) => ({ value: t.key, label: t.label }))} value={targetKey} onValueChange={(v) => v && onTargetChange(v)}>
              <SelectTrigger size="sm" aria-label={copy.preview.targetLabel} className="h-7 max-w-52 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="w-auto min-w-(--anchor-width)">
                {targets.map((t) => (
                  <SelectItem key={t.key} value={t.key}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : targets.length === 1 ? (
            <span className="truncate text-xs text-muted-foreground">{targets[0].label}</span>
          ) : null}
          {files.length > 0 && (
            <Select
              items={files.map((f) => ({ value: f.path, label: fileLabel(f.path) }))}
              value={activePath}
              onValueChange={(v) => v && selectFile(String(v))}
            >
              <SelectTrigger size="sm" aria-label={copy.preview.files} className="h-7 max-w-40 font-mono text-xs min-[780px]:hidden">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="w-auto min-w-(--anchor-width)">
                {files.map((f) => {
                  const level = fileLintLevel(issues, f.path)
                  return (
                    <SelectItem key={f.path} value={f.path} className="font-mono text-xs">
                      <span className="flex items-center gap-1.5">
                        {fileLabel(f.path)}
                        {level && (
                          <span
                            aria-hidden
                            className={level === "error" ? "size-1.5 rounded-full bg-destructive" : "size-1.5 rounded-full bg-warning"}
                          />
                        )}
                      </span>
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {pending && preview && <Spinner aria-label={copy.preview.loading} className="size-3.5 text-muted-foreground" />}
          <ToggleGroup
            aria-label={copy.preview.viewLabel}
            variant="outline"
            size="sm"
            spacing={0}
            value={[view]}
            onValueChange={(v) => {
              if (!v[0]) return
              const next = v[0] as "rendered" | "source"
              setView(next)
              if (next === "rendered") {
                setLocated(null)
                scrollReaderTop()
              }
            }}
          >
            <ToggleGroupItem value="rendered" className="h-7 px-2.5 text-xs">
              {copy.preview.rendered}
            </ToggleGroupItem>
            <ToggleGroupItem value="source" className="h-7 px-2.5 text-xs">
              {copy.preview.source}
            </ToggleGroupItem>
          </ToggleGroup>
          {current && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={copiedFile ? copy.common.copied : copy.preview.copyFile}
                    onClick={copyCurrentFile}
                  />
                }
              >
                {copiedFile ? <CheckIcon /> : <CopyIcon />}
              </TooltipTrigger>
              <TooltipContent>{copiedFile ? copy.common.copied : copy.preview.copyFile}</TooltipContent>
            </Tooltip>
          )}
          <DialogClose
            render={<Button type="button" variant="ghost" size="icon-sm" aria-label={copy.common.close} />}
          >
            <XIcon />
          </DialogClose>
        </div>
      </header>

      {/* 双栏主体：左侧 ~190px 文件树 + 预算/状态（<780px 隐藏）；右侧 bg-card 宽阅读区 */}
      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-[190px] shrink-0 flex-col border-r border-line bg-background min-[780px]:flex">
          <ScrollArea layout="flex" className="min-h-0 flex-1" contentClassName="w-full min-w-0">
            {!preview && pending ? (
              <div className="flex flex-col gap-1.5 p-2.5" aria-busy="true">
                <Skeleton className="h-7 w-full" />
                <Skeleton className="h-6 w-4/5" />
                <Skeleton className="h-6 w-3/4" />
              </div>
            ) : (
              <FileTree files={files} activePath={activePath} issues={issues} onSelect={selectFile} />
            )}
          </ScrollArea>
          {preview && files.length > 0 && (
            <div className="flex shrink-0 flex-col gap-1.5 border-t border-line-2 px-3 py-2.5">
              <PreviewMetaRef budget={preview.budget} />
              <LintStatusPill errors={errors} warnings={warnings} onFocusLint={focusLint} />
            </div>
          )}
        </aside>

        <div ref={readerRef} className="flex min-h-0 min-w-0 flex-1 flex-col bg-card">
          <ScrollArea layout="flex" className="min-h-0 flex-1" contentClassName="w-full min-w-0">
            <div className="flex w-full min-w-0 flex-col gap-4 px-4 py-4 min-[780px]:px-6 min-[780px]:py-5">
              {note && (
                <Alert>
                  <InfoIcon />
                  <AlertDescription>{note}</AlertDescription>
                </Alert>
              )}
              {error && (
                <Alert variant="destructive">
                  <CircleXIcon />
                  <AlertTitle>{copy.preview.failed}</AlertTitle>
                  <AlertDescription>{ipcErrorText(error.id, error.params)}</AlertDescription>
                </Alert>
              )}
              {!preview && pending && (
                <div className="flex flex-col gap-3" aria-busy="true" aria-label={copy.preview.loading}>
                  <Skeleton className="h-7 w-1/3" />
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-40 w-full" />
                </div>
              )}
              {preview && files.length === 0 && (
                <Empty className="border border-line">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <PackageIcon />
                    </EmptyMedia>
                    <EmptyTitle>{copy.preview.emptyTitle}</EmptyTitle>
                    <EmptyDescription>{copy.preview.emptyDescription}</EmptyDescription>
                  </EmptyHeader>
                </Empty>
              )}
              {preview && files.length > 0 && current && (
                <>
                  {/* 正常即隐身 + 按当前文件归属展示：仅当前文件有真实安全错误/注入告警时在顶部展开 */}
                  {currentIssues.length > 0 && (
                    <LintList
                      lint={currentIssues}
                      compiledPath={compiledPath}
                      logDir={logDir ?? null}
                      onLocate={locate}
                      onRetry={onRetry}
                      focusRequest={lintFocusTick}
                    />
                  )}
                  <div className="min-w-0">
                    {view === "source" ? (
                      <SourceView content={current.content} focusLine={located?.file === current.path ? located.line : null} />
                    ) : (
                      <RenderedView
                        path={current.path}
                        content={current.content}
                        descriptionChars={preview.budget.descriptionChars}
                      />
                    )}
                  </div>
                </>
              )}
            </div>
          </ScrollArea>

          {/* 窄窗（<780px）隐藏左侧栏时，底栏上方保留一行安静字数参考；有真实安全问题时显示计数按钮 */}
          {preview && files.length > 0 && (
            <div className="flex shrink-0 items-center justify-between gap-3 border-t border-line-2 bg-background px-3.5 py-1.5 min-[780px]:hidden">
              <PreviewMetaRef budget={preview.budget} />
              <LintStatusPill errors={errors} warnings={warnings} onFocusLint={focusLint} inline />
            </div>
          )}
        </div>
      </div>

      {compiledPath && <CompiledFooter path={compiledPath} />}
    </div>
  )
}
