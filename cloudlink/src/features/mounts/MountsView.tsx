import {
  CircleXIcon,
  Link2OffIcon,
  PlusIcon,
  RefreshCwIcon,
  ScanEyeIcon,
  ShieldAlertIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"

import type { EnvId, Target } from "@/bindings"
import { StateBadge } from "@/components/app/StateBadge"
import { useToolbarSlot, useViewTitleFocus } from "@/components/app/ViewShell"
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useDelayedFlag } from "@/hooks/use-delayed-flag"
import { copy } from "@/lib/copy"
import { selectHealth, useMountStore } from "@/stores/mounts"
import { useSkillStore } from "@/stores/skills"
import { useTargetStore } from "@/stores/targets"
import { useUIStore } from "@/stores/ui"
import { useAddProject } from "./AddProjectDialog"
import { BoardView } from "./BoardView"
import { MatrixView } from "./MatrixView"
import { prodGlobalMounts } from "./mountRules"
import { RemoveTargetDialog } from "./RemoveTargetDialog"
import { checkLinks } from "./TargetCard"
import { useLens, useMountsData, type LensView } from "./useMountsData"
import { useMountPipeline } from "./useMountPipeline"

/** 视角横幅（DESIGN.md Agent Lens）：说明当前视角与可见数量，AlertAction 退出视角 */
function LensBanner({ lens }: { lens: LensView }) {
  const { target, result } = lens
  const env = copy.env.long(target.envId)
  const subject =
    target.kind === "agent-global"
      ? copy.lens.subjectGlobal(target.label, env)
      : copy.lens.subject(copy.agent[lens.lens.agent], target.label, env)
  const total = result.project.length + result.global.length
  const count =
    target.kind === "agent-global"
      ? copy.lens.countGlobal(total)
      : copy.lens.count(total, result.project.length, result.global.length)
  return (
    <Alert className="ring-1 ring-ring" role="status">
      <ScanEyeIcon />
      <AlertTitle>
        {copy.lens.title}：{subject}
      </AlertTitle>
      <AlertDescription>
        {count}
        {result.unhealthy.length > 0 && copy.lens.unhealthy(result.unhealthy.length)}。
      </AlertDescription>
      <AlertAction>
        <Button size="sm" variant="outline" onClick={() => useUIStore.getState().setLens(null)}>
          {copy.lens.exit}
        </Button>
      </AlertAction>
    </Alert>
  )
}

function BoardSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 gap-3 border-t p-3" aria-busy="true" aria-label={copy.mounts.loadingTargets}>
      <div className="flex w-1/4 flex-col gap-2">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-7" />
        ))}
      </div>
      <div className="grid flex-1 grid-cols-2 content-start gap-3">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-32 rounded-xl" />
        ))}
      </div>
    </div>
  )
}

/** 挂载视图（PRD 6.6）：看板与矩阵、Agent 视角、目标管理 */
export function MountsView({ focusTitle }: { focusTitle: boolean }) {
  const titleRef = useRef<HTMLHeadingElement>(null)
  useViewTitleFocus(titleRef, focusTitle)

  const mode = useUIStore((s) => s.mountsMode)
  const env = useUIStore((s) => s.mountsEnv)
  const environments = useTargetStore((s) => s.environments)
  const loading = [
    useTargetStore((s) => s.status),
    useMountStore((s) => s.status),
    useSkillStore((s) => s.status),
  ].some((s) => s === "idle" || s === "loading")
  const showSkeleton = useDelayedFlag(loading)

  const data = useMountsData()
  const lens = useLens()
  const { requestMount, dialog } = useMountPipeline()
  const addProject = useAddProject()
  const [removing, setRemoving] = useState<Target | null>(null)

  const health = selectHealth(data.mounts, [])
  const prodGlobal = useMemo(
    () => prodGlobalMounts(data.mounts, data.allTargets, (id) => data.skillById.get(id)?.asset),
    [data]
  )
  const prodGlobalSkills = new Set(prodGlobal.map((m) => m.skillId)).size

  const slot = useToolbarSlot()
  const ui = useUIStore.getState
  const actions = (
    <>
      <ToggleGroup
        aria-label={copy.mounts.modeLabel}
        variant="outline"
        size="sm"
        spacing={0}
        value={[mode]}
        onValueChange={(v) => v[0] && ui().setMountsMode(v[0] as "board" | "matrix")}
      >
        <ToggleGroupItem value="board">{copy.mounts.board}</ToggleGroupItem>
        <ToggleGroupItem value="matrix">{copy.mounts.matrix}</ToggleGroupItem>
      </ToggleGroup>
      <Select
        items={[{ value: "all", label: copy.mounts.envAll }, ...environments.map((e) => ({ value: e.id, label: copy.env.long(e.id) }))]}
        value={env}
        onValueChange={(v) => v && ui().setMountsEnv(v as EnvId | "all")}
      >
        <SelectTrigger size="sm" aria-label={copy.mounts.envFilter} className="min-w-32">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{copy.mounts.envAll}</SelectItem>
          {environments.map((e) => (
            <SelectItem key={e.id} value={e.id}>
              {copy.env.long(e.id)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button size="sm" onClick={() => void addProject.start()}>
        <PlusIcon data-icon="inline-start" />
        {copy.mounts.addProject}
      </Button>
      <Tooltip>
        <TooltipTrigger
          render={<Button variant="ghost" size="icon-sm" aria-label={copy.mounts.checkAll} onClick={checkLinks} />}
        >
          <RefreshCwIcon />
        </TooltipTrigger>
        <TooltipContent>{copy.mounts.checkAll}</TooltipContent>
      </Tooltip>
      <Separator orientation="vertical" className="mx-1 data-vertical:h-4 data-vertical:self-center" />
      <div role="group" aria-label={copy.mounts.healthLabel} className="flex items-center gap-1 text-xs whitespace-nowrap text-muted-foreground tabular-nums">
        <span>{copy.mounts.health(data.mounts.length)}</span>
        <StateBadge tone={health.broken ? "danger" : "neutral"} icon={health.broken ? Link2OffIcon : CircleXIcon}>
          {copy.mounts.healthBroken(health.broken)}
        </StateBadge>
        <StateBadge tone={health.conflict ? "warning" : "neutral"} icon={TriangleAlertIcon}>
          {copy.mounts.healthConflict(health.conflict)}
        </StateBadge>
      </div>
      <Separator orientation="vertical" className="mx-1 data-vertical:h-4 data-vertical:self-center" />
    </>
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-col gap-3 px-3 pt-3 pb-3">
        <h1 ref={titleRef} id="view-title" tabIndex={-1} className="text-base font-semibold outline-none">
          {copy.nav.mounts}
        </h1>
        {prodGlobal.length > 0 && (
          // 不能关闭，全部取消后才消失（PRD 6.6）
          <Alert>
            <ShieldAlertIcon className="text-warning" />
            <AlertDescription className="text-foreground">{copy.mounts.prodGlobal(prodGlobalSkills)}</AlertDescription>
            <AlertAction>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  ui().setMountsMode("matrix")
                  ui().setMatrixProdGlobal(true)
                }}
              >
                {copy.mounts.prodGlobalView}
              </Button>
            </AlertAction>
          </Alert>
        )}
        {lens && <LensBanner lens={lens} />}
      </div>

      {loading ? (
        showSkeleton && <BoardSkeleton />
      ) : mode === "board" ? (
        <BoardView
          data={data}
          lens={lens}
          requestMount={requestMount}
          onAddProject={() => void addProject.start()}
          onRemove={setRemoving}
        />
      ) : (
        <MatrixView data={data} lens={lens} requestMount={requestMount} />
      )}

      <RemoveTargetDialog
        target={removing}
        mounts={removing ? (data.byTarget.get(removing.id) ?? []) : []}
        skillById={data.skillById}
        onClose={() => setRemoving(null)}
      />
      {addProject.dialog}
      {dialog}
      {slot && createPortal(actions, slot)}
    </div>
  )
}
