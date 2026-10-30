import {
  ArrowDownUpIcon,
  CircleCheckIcon,
  CircleXIcon,
  PackageIcon,
  PlusIcon,
  SearchIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { lazy, Suspense, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useDefaultLayout } from "react-resizable-panels"

import type { Mode } from "@/bindings"
import { EmptyState } from "@/components/app/EmptyState"
import { StateBadge, type StateTone } from "@/components/app/StateBadge"
import { useScrollRestore, useToolbarSlot, useViewTitleFocus } from "@/components/app/ViewShell"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { formValuesOf, toAssetInput } from "@/features/assets/assetForm"
import { usePreviewCompile } from "@/features/assets/usePreviewCompile"
import { ModeIcon } from "@/features/mounts/MountChip"
import { useDelayedFlag } from "@/hooks/use-delayed-flag"
import { copy } from "@/lib/copy"
import { formatTokens } from "@/lib/format"
import { cn } from "@/lib/utils"
import { useAssetStore } from "@/stores/assets"
import { useMountStore } from "@/stores/mounts"
import {
  selectSkillRows,
  skillCompileState,
  useSkillStore,
  type SkillCompileState,
  type SkillRow,
} from "@/stores/skills"
import { useUIStore, type SkillSort, type SkillStateFilter } from "@/stores/ui"

// 与资产视图共用的预览组件，按需加载（PRD 6.7）
const SkillPreview = lazy(() => import("@/components/app/SkillPreview"))

const STATE_BADGE: Record<SkillCompileState, { tone: StateTone; icon: typeof CircleCheckIcon }> = {
  ok: { tone: "success", icon: CircleCheckIcon },
  warning: { tone: "warning", icon: TriangleAlertIcon },
  blocked: { tone: "danger", icon: CircleXIcon },
}
const STATE_TEXT: Record<SkillCompileState, string> = {
  ok: copy.compileState.ok,
  warning: copy.compileState.warning,
  blocked: copy.compileState.blocked,
}
const UNHEALTHY = new Set(["broken", "conflict", "alias-missing"])

function useSkillRows(): SkillRow[] {
  const statusById = useSkillStore((s) => s.statusById)
  const assets = useAssetStore((s) => s.byId)
  const mounts = useMountStore((s) => s.byId)
  return useMemo(() => {
    const counts = new Map<string, number>()
    Object.values(mounts).forEach((m) => counts.set(m.skillId, (counts.get(m.skillId) ?? 0) + 1))
    return Object.values(statusById).flatMap((skill) => {
      const asset = assets[skill.assetId]
      if (!asset) return []
      const variant =
        skill.variants.find((v) => v.mode === asset.guardrails.defaultMode) ?? skill.variants[0]
      return [
        {
          skill,
          asset,
          mounts: counts.get(skill.id) ?? 0,
          resident: variant && !variant.blocked ? variant.residentTokens : null,
        },
      ]
    })
  }, [statusById, assets, mounts])
}

/** 右侧详情：「来源」「变体」「挂载」摘要加复用的 SkillPreview（PRD 6.7） */
function SkillDetail({ row }: { row: SkillRow }) {
  const { skill, asset } = row
  const [modeChoice, setModeChoice] = useState<{ id: string; mode: Mode } | null>(null)
  const mode = modeChoice?.id === skill.id ? modeChoice.mode : asset.guardrails.defaultMode
  const input = useMemo(() => toAssetInput(formValuesOf(asset), asset), [asset])
  const { preview, pending, error } = usePreviewCompile(input, mode, skill.id, 0)
  const mounts = useMountStore((s) => s.byId)
  const own = Object.values(mounts).filter((m) => m.skillId === skill.id)
  const unhealthy = own.filter((m) => UNHEALTHY.has(m.status)).length
  const path = skill.variants.find((v) => v.mode === mode)?.path

  return (
    <div className="flex h-full min-h-0 flex-col">
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5 border-b p-3 text-sm">
        <dt className="text-xs text-muted-foreground">{copy.skills.sourceAsset}</dt>
        <dd className="min-w-0">
          <Button
            variant="link"
            className="h-auto max-w-full justify-start p-0"
            aria-label={copy.skills.openAsset(asset.name)}
            onClick={() => {
              useUIStore.getState().selectAsset(asset.id)
              useUIStore.getState().setView("assets")
            }}
          >
            <span className="truncate font-mono">{asset.connection.sshAlias || asset.slug}</span>
            <span className="truncate text-muted-foreground">{asset.name}</span>
          </Button>
        </dd>
        <dt className="text-xs text-muted-foreground">{copy.skills.variants}</dt>
        <dd className="flex flex-wrap gap-2">
          {skill.variants.map((v) => (
            <span key={v.mode} className="flex items-center gap-1">
              <ModeIcon mode={v.mode} />
              {copy.mode[v.mode]}
            </span>
          ))}
        </dd>
        <dt className="text-xs text-muted-foreground">{copy.skills.mounts}</dt>
        <dd className={cn("tabular-nums", unhealthy > 0 && "text-destructive")}>
          {copy.skills.mountsSummary(own.length, unhealthy)}
        </dd>
      </dl>
      <div className="min-h-0 flex-1">
        <Suspense fallback={<Skeleton className="m-3 h-40" />}>
          <SkillPreview
            preview={preview}
            pending={pending}
            error={error}
            draft={false}
            mode={mode}
            onModeChange={(m) => setModeChoice({ id: skill.id, mode: m })}
            publish={path ? { kind: "path", path } : { kind: "unpublished" }}
            lintRequest={0}
          />
        </Suspense>
      </div>
    </div>
  )
}

function TableSkeleton() {
  return (
    <div className="flex flex-col gap-2 p-3" aria-busy="true" aria-label={copy.skills.loading}>
      {Array.from({ length: 5 }, (_, i) => (
        <Skeleton key={i} className="h-7" />
      ))}
    </div>
  )
}

/** Skills 视图（PRD 6.7）：左边 Table（状态筛选、排序菜单），右边复用资产视图的预览组件 */
export function SkillsView({ focusTitle }: { focusTitle: boolean }) {
  const titleRef = useRef<HTMLHeadingElement>(null)
  const tableRef = useRef<HTMLDivElement>(null)
  useViewTitleFocus(titleRef, focusTitle)

  const layout = useDefaultLayout({ id: "skills" })
  const status = useSkillStore((s) => s.status)
  const loading = status === "idle" || status === "loading"
  const showSkeleton = useDelayedFlag(loading)
  useScrollRestore("skills", () => tableRef.current?.querySelector<HTMLElement>("[data-slot=scroll-area-viewport]"), !loading)

  const query = useUIStore((s) => s.skillQuery)
  const state = useUIStore((s) => s.skillState)
  const sort = useUIStore((s) => s.skillSort)
  const selectedId = useUIStore((s) => s.selectedSkillId)
  const all = useSkillRows()
  const rows = useMemo(() => selectSkillRows(all, query, state, sort), [all, query, state, sort])
  const selected = all.find((r) => r.skill.id === selectedId)
  const filtered = query !== "" || state !== "all"
  const ui = useUIStore.getState

  const slot = useToolbarSlot()
  const actions = (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex" />}>
        <Button size="sm" variant="outline" disabled>
          <PlusIcon data-icon="inline-start" />
          {copy.skills.newBundle}
          <span className="sr-only">（{copy.skills.bundleLater}）</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>{copy.skills.bundleLater}</TooltipContent>
    </Tooltip>
  )

  return (
    <ResizablePanelGroup
      id="skills"
      orientation="horizontal"
      defaultLayout={layout.defaultLayout}
      onLayoutChanged={layout.onLayoutChanged}
      className="min-h-0 flex-1"
    >
      <ResizablePanel id="table" defaultSize="58%" minSize="440px">
        <div className="flex h-full min-h-0 flex-col">
          <div className="flex flex-col gap-3 p-3 pb-2">
            <h1 ref={titleRef} id="view-title" tabIndex={-1} className="text-base font-semibold outline-none">
              {copy.nav.skills}
            </h1>
            <div className="flex flex-wrap items-center gap-2">
              <InputGroup className="w-56">
                <InputGroupAddon>
                  <SearchIcon />
                </InputGroupAddon>
                <InputGroupInput
                  type="search"
                  aria-label={copy.skills.search}
                  placeholder={copy.skills.search}
                  value={query}
                  onChange={(e) => ui().setSkillQuery(e.target.value)}
                />
              </InputGroup>
              <Select
                items={(Object.keys(copy.skills.state) as SkillStateFilter[]).map((k) => ({ value: k, label: copy.skills.state[k] }))}
                value={state}
                onValueChange={(v) => v && ui().setSkillState(v as SkillStateFilter)}
              >
                <SelectTrigger size="sm" aria-label={copy.skills.stateFilter} className="min-w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(copy.skills.state) as SkillStateFilter[]).map((k) => (
                    <SelectItem key={k} value={k}>
                      {copy.skills.state[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={<Button variant="outline" size="sm" aria-label={`${copy.skills.sort}：${copy.skills.sortBy[sort]}`} />}
                >
                  <ArrowDownUpIcon data-icon="inline-start" />
                  {copy.skills.sortBy[sort]}
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-auto min-w-32">
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>{copy.skills.sort}</DropdownMenuLabel>
                    <DropdownMenuRadioGroup value={sort} onValueChange={(v) => ui().setSkillSort(v as SkillSort)}>
                      {(Object.keys(copy.skills.sortBy) as SkillSort[]).map((k) => (
                        <DropdownMenuRadioItem key={k} value={k}>
                          {copy.skills.sortBy[k]}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {loading ? (
            showSkeleton && <TableSkeleton />
          ) : all.length === 0 ? (
            <div className="p-3">
              <EmptyState icon={PackageIcon} title={copy.skills.emptyTitle} description={copy.skills.emptyDescription}>
                <Button variant="outline" onClick={() => ui().setView("assets")}>
                  {copy.skills.goAssets}
                </Button>
              </EmptyState>
            </div>
          ) : (
            <ScrollArea ref={tableRef} className="min-h-0 flex-1">
              <Table aria-label={copy.skills.tableLabel}>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-3">{copy.skills.columns.skill}</TableHead>
                    <TableHead>{copy.skills.columns.source}</TableHead>
                    <TableHead>{copy.skills.columns.variants}</TableHead>
                    <TableHead>{copy.skills.columns.state}</TableHead>
                    <TableHead className="text-right">{copy.skills.columns.resident}</TableHead>
                    <TableHead className="pr-3 text-right">{copy.skills.columns.mounts}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => {
                    const s = skillCompileState(r.skill)
                    const current = r.skill.id === selectedId
                    return (
                      <TableRow
                        key={r.skill.id}
                        aria-current={current ? "true" : undefined}
                        onClick={() => ui().selectSkill(r.skill.id)}
                        className="cursor-default aria-[current=true]:bg-muted aria-[current=true]:font-medium"
                      >
                        <TableCell className="pl-3">
                          <Button
                            variant="link"
                            className="h-auto p-0 font-mono text-[0.8125rem] text-foreground"
                            onClick={() => ui().selectSkill(r.skill.id)}
                          >
                            {r.skill.slug}
                          </Button>
                        </TableCell>
                        <TableCell className="font-mono text-[0.8125rem] font-normal text-muted-foreground">
                          {r.asset.connection.sshAlias}
                        </TableCell>
                        <TableCell className="font-normal">
                          {r.skill.variants.map((v) => copy.mode[v.mode]).join("、")}
                        </TableCell>
                        <TableCell>
                          <StateBadge tone={STATE_BADGE[s].tone} icon={STATE_BADGE[s].icon}>
                            {STATE_TEXT[s]}
                          </StateBadge>
                        </TableCell>
                        <TableCell className="text-right font-mono font-normal tabular-nums">
                          {r.resident === null ? "-" : formatTokens(r.resident)}
                        </TableCell>
                        <TableCell className="pr-3 text-right font-normal tabular-nums">{r.mounts}</TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
              {rows.length === 0 && (
                <div className="flex flex-col items-center gap-2 py-6 text-sm text-muted-foreground">
                  {copy.skills.noMatch}
                  {filtered && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        ui().setSkillQuery("")
                        ui().setSkillState("all")
                      }}
                    >
                      {copy.skills.clearFilter}
                    </Button>
                  )}
                </div>
              )}
            </ScrollArea>
          )}
        </div>
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel id="detail" minSize="320px">
        {selected ? (
          <SkillDetail row={selected} />
        ) : (
          <div className="flex h-full items-start justify-center p-6">
            <Empty className="max-w-md flex-none border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <PackageIcon />
                </EmptyMedia>
                <EmptyTitle>{copy.skills.selectTitle}</EmptyTitle>
                <EmptyDescription>{copy.skills.selectDescription}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          </div>
        )}
      </ResizablePanel>
      {slot && createPortal(actions, slot)}
    </ResizablePanelGroup>
  )
}
