import { lazy, Suspense, useState } from "react"
import { XIcon } from "lucide-react"

import type { AssetInput, SkillConfig } from "@/bindings"
import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { usePreviewSkill } from "@/hooks/use-preview-skill"
import { copy } from "@/lib/copy"
import { compiledDir } from "@/lib/paths"
import { useAgentOptions, type CompileTarget } from "@/features/agents/agentKeys"
import { useSettingsStore } from "@/stores/settings"
import { useSkillStore } from "@/stores/skills"
import { useUIStore } from "@/stores/ui"

// 预览带 streamdown 和 Shiki：按需加载（PRD 9）
const SkillPreview = lazy(() => import("@/components/app/SkillPreview"))

function PreviewFallback({ dirty }: { dirty: boolean }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-11 shrink-0 items-center gap-2 border-b border-line bg-card px-3.5 py-1.5">
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
        <DialogClose
          render={<Button type="button" variant="ghost" size="icon-sm" className="ml-auto" aria-label={copy.common.close} />}
        >
          <XIcon />
        </DialogClose>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="hidden w-[190px] shrink-0 flex-col gap-2 border-r border-line bg-background p-3 min-[780px]:flex">
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-5 w-4/5" />
          <Skeleton className="h-5 w-3/4" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-3 p-5">
          <Skeleton className="h-7 w-1/3" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-44 w-full" />
        </div>
      </div>
    </div>
  )
}

/**
 * 预览 Skill（居中宽阅读 Dialog，PRD 6.4、F-204、DESIGN.md）：Ctrl+\ 切换。
 * 服务器详情传这台服务器的草稿，Agent 页传全局内容的草稿；内容就是草稿的编译结果
 */
export function PreviewSheet({
  scope,
  draft,
  dirty,
  defaultFile,
  note,
}: {
  /** 当前对象：换了服务器就不再显示上一台的旧结果 */
  scope: string
  draft: { asset?: AssetInput; config?: SkillConfig }
  dirty: boolean
  defaultFile: string
  /** 某一份总 Skill 的顶部说明（例如「目前未列入」） */
  note?: (target: CompileTarget) => string | null
}) {
  const open = useUIStore((s) => s.previewOpen)
  const focus = useUIStore((s) => s.previewFocus)
  const chosen = useUIStore((s) => s.previewKey)
  const dataDir = useSettingsStore((s) => s.settings?.dataDir)
  const logDir = useSettingsStore((s) => s.settings?.logDir ?? null)
  const [refresh, setRefresh] = useState(0)
  const { compileTargets } = useAgentOptions()
  // 一份都没有（还没启用 Agent）时按 Claude Code（Windows）计算，顶部注明
  const current = compileTargets.find((t) => t.key === chosen) ?? compileTargets[0]
  const envId = current?.envId ?? "windows"
  const agentKey = current?.agentKey ?? "claude-code"

  const { preview, pending, error } = usePreviewSkill(open ? { envId, agentKey, ...draft } : null, `${scope}:${envId}|${agentKey}`, dirty ? 200 : 0, refresh)
  const onRetry = () => {
    setRefresh((n) => n + 1)
    void useSkillStore.getState().load()
  }

  return (
    <Dialog open={open} onOpenChange={(next) => useUIStore.getState().setPreviewOpen(next)}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[min(600px,calc(100svh-2.5rem))] w-[min(920px,calc(100vw-2.5rem))] max-w-none flex-col gap-0 overflow-clip rounded-dialog bg-card p-0 text-foreground sm:max-w-none"
      >
        <Suspense fallback={<PreviewFallback dirty={dirty} />}>
          <SkillPreview
            dirty={dirty}
            preview={preview}
            pending={pending}
            error={error}
            targetKey={current?.key ?? ""}
            targets={compileTargets.map((t) => ({ key: t.key, label: t.label }))}
            onTargetChange={(key) => useUIStore.getState().setPreviewKey(key)}
            defaultFile={defaultFile}
            focus={focus}
            compiledPath={dataDir ? compiledDir(dataDir, envId, agentKey) : null}
            logDir={logDir}
            onRetry={onRetry}
            note={current ? note?.(current) : copy.preview.noTargets}
          />
        </Suspense>
      </DialogContent>
    </Dialog>
  )
}
