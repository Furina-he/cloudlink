import { CircleXIcon, InfoIcon, PackageIcon } from "lucide-react"
import { useState } from "react"

import type { CompilePreview, IpcError, LintItem } from "@/bindings"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { copy, ipcErrorText } from "@/lib/copy"
import type { PreviewFocus } from "@/stores/ui"
import { BudgetBars, CompiledFooter, LintList, RenderedView, SourceView } from "./SkillPreviewParts"

export interface SkillPreviewProps {
  preview: CompilePreview | null
  /** 有请求在路上：显示上一次的结果，旁边转圈 */
  pending: boolean
  error: IpcError | null
  /** 预览哪一份总 Skill（运行环境 × Agent） */
  targetKey: string
  targets: { key: string; label: string }[]
  onTargetChange: (key: string) => void
  /** 只列出这些文件（服务器详情：SKILL.md、这台的详情文件、health-check.md）；Lint 定位到别的文件时临时加上 */
  fileFilter?: (path: string) => boolean
  /** 默认打开的文件 */
  defaultFile: string
  /** 打开 Sheet 时的定位请求 */
  focus: PreviewFocus
  compiledPath: string | null
  /** 顶部说明，例如「目前未列入」（2026-10-31 用户确认） */
  note?: string | null
}

const fileLabel = (path: string) => path.split("/").pop() ?? path

/** 总 Skill 预览（PRD 6.4、F-204）。服务器详情和 Agent 页共用；用 React.lazy 按需加载 */
export default function SkillPreview({
  preview,
  pending,
  error,
  targetKey,
  targets,
  onTargetChange,
  fileFilter,
  defaultFile,
  focus,
  compiledPath,
  note,
}: SkillPreviewProps) {
  // 挂载时就应用打开 Sheet 的那次定位；之后每次 seq 变化再应用一次
  const [file, setFile] = useState(focus.file ?? defaultFile)
  const [seenSeq, setSeenSeq] = useState(focus.seq)
  const [view, setView] = useState<"rendered" | "source">("rendered")
  const [located, setLocated] = useState<{ file: string; line: number } | null>(null)
  if (seenSeq !== focus.seq) {
    setSeenSeq(focus.seq)
    if (focus.file) setFile(focus.file)
  }

  const files = preview?.files ?? []
  const listed = files.filter((f) => !fileFilter || fileFilter(f.path) || f.path === file)
  const current = listed.find((f) => f.path === file) ?? listed[0]

  const locate = (item: LintItem) => {
    if (!item.file || !item.line) return
    setFile(item.file)
    setView("source")
    setLocated({ file: item.file, line: item.line })
  }

  return (
    <Tabs value={current?.path ?? file} onValueChange={(v) => setFile(String(v))} className="flex min-h-0 flex-1 flex-col gap-0">
      <div className="flex flex-col gap-2 border-b px-4 pb-0">
        <div className="flex flex-wrap items-center gap-2">
          {targets.length > 1 && (
            <Select items={targets.map((t) => ({ value: t.key, label: t.label }))} value={targetKey} onValueChange={(v) => v && onTargetChange(v)}>
              <SelectTrigger size="sm" aria-label={copy.preview.targetLabel} className="min-w-44">
                <SelectValue />
              </SelectTrigger>
              {/* 「Claude Code（WSL Ubuntu-24.04）」比当前选中的长：弹出层按内容加宽，不窄于触发器 */}
              <SelectContent className="w-auto min-w-(--anchor-width)">
                {targets.map((t) => (
                  <SelectItem key={t.key} value={t.key}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
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
          {pending && preview && <Spinner aria-label={copy.preview.loading} className="ml-auto size-3.5 text-muted-foreground" />}
        </div>
        {listed.length > 0 ? (
          <TabsList variant="line" aria-label={copy.preview.files} className="-mb-px max-w-full justify-start overflow-x-auto">
            {listed.map((f) => (
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
        <div className="flex flex-col gap-4 p-4">
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
              <Skeleton className="h-8" />
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-40" />
            </div>
          )}
          {preview && files.length === 0 && (
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
          {preview && files.length > 0 && current && (
            <>
              <BudgetBars budget={preview.budget} />
              <LintList lint={preview.lint} onLocate={locate} focusRequest={focus.lint ? focus.seq : 0} />
              {/* 面板本身不进 Tab 序列：它没有焦点样式；能滚动的是外层滚动区域和代码块，它们各自有焦点环 */}
              <TabsContent value={current.path} tabIndex={-1}>
                {view === "source" ? (
                  <SourceView content={current.content} focusLine={located?.file === current.path ? located.line : null} />
                ) : (
                  <RenderedView path={current.path} content={current.content} />
                )}
              </TabsContent>
            </>
          )}
        </div>
      </ScrollArea>

      {compiledPath && <CompiledFooter path={compiledPath} />}
    </Tabs>
  )
}
