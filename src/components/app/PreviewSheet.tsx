import { lazy, Suspense } from "react"

import type { AssetInput, SkillConfig } from "@/bindings"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { usePreviewSkill } from "@/hooks/use-preview-skill"
import { copy } from "@/lib/copy"
import { compiledDir } from "@/lib/paths"
import { useAgentOptions, type CompileTarget } from "@/features/agents/agentKeys"
import { useSettingsStore } from "@/stores/settings"
import { useUIStore } from "@/stores/ui"

// 预览带 streamdown 和 Shiki：按需加载（PRD 9）
const SkillPreview = lazy(() => import("@/components/app/SkillPreview"))

/**
 * 预览 Skill（右侧 Sheet，PRD 6.4）：Ctrl+\ 切换，宽度 min(720px, 60vw)。
 * 服务器详情传这台服务器的草稿，Agent 页传全局内容的草稿；内容就是草稿的编译结果
 */
export function PreviewSheet({
  scope,
  draft,
  dirty,
  fileFilter,
  defaultFile,
  note,
}: {
  /** 当前对象：换了服务器就不再显示上一台的旧结果 */
  scope: string
  draft: { asset?: AssetInput; config?: SkillConfig }
  dirty: boolean
  fileFilter?: (path: string) => boolean
  defaultFile: string
  /** 某一份总 Skill 的顶部说明（例如「目前未列入」） */
  note?: (target: CompileTarget) => string | null
}) {
  const open = useUIStore((s) => s.previewOpen)
  const focus = useUIStore((s) => s.previewFocus)
  const chosen = useUIStore((s) => s.previewKey)
  const dataDir = useSettingsStore((s) => s.settings?.dataDir)
  const { compileTargets } = useAgentOptions()
  // 一份都没有（还没启用 Agent）时按 Claude Code（Windows）计算，顶部注明
  const current = compileTargets.find((t) => t.key === chosen) ?? compileTargets[0]
  const envId = current?.envId ?? "windows"
  const agentKey = current?.agentKey ?? "claude-code"

  const { preview, pending, error } = usePreviewSkill(open ? { envId, agentKey, ...draft } : null, `${scope}:${envId}|${agentKey}`, dirty ? 200 : 0)

  return (
    <Sheet open={open} onOpenChange={(next) => useUIStore.getState().setPreviewOpen(next)}>
      <SheetContent
        side="right"
        closeLabel={copy.common.close}
        className="gap-0 data-[side=right]:w-[min(720px,60vw)] data-[side=right]:min-w-[min(420px,100vw)] data-[side=right]:sm:max-w-none"
      >
        <SheetHeader className="pr-12">
          <SheetTitle>{dirty ? copy.preview.draftTitle : copy.preview.title}</SheetTitle>
          <SheetDescription>{dirty ? copy.preview.draftNote : copy.preview.publishedNote}</SheetDescription>
        </SheetHeader>
        <Suspense fallback={<Skeleton className="m-4 h-64" />}>
          <SkillPreview
            preview={preview}
            pending={pending}
            error={error}
            targetKey={current?.key ?? ""}
            targets={compileTargets.map((t) => ({ key: t.key, label: t.label }))}
            onTargetChange={(key) => useUIStore.getState().setPreviewKey(key)}
            fileFilter={fileFilter}
            defaultFile={defaultFile}
            focus={focus}
            compiledPath={dataDir ? compiledDir(dataDir, envId, agentKey) : null}
            note={current ? note?.(current) : copy.preview.noTargets}
          />
        </Suspense>
      </SheetContent>
    </Sheet>
  )
}
