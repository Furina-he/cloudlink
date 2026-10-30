import { EyeIcon, EyeOffIcon, FolderOpenIcon, ScanEyeIcon, ShieldAlertIcon, WrenchIcon } from "lucide-react"
import { useMemo } from "react"

import type { Mode, Mount, Target } from "@/bindings"
import { EnvBadge } from "@/components/app/EnvBadge"
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { lensAgentsFor } from "@/lib/agents"
import { copy } from "@/lib/copy"
import { ipc } from "@/lib/ipc"
import { cn } from "@/lib/utils"
import { useMountStore } from "@/stores/mounts"
import { useUIStore } from "@/stores/ui"
import { prodGlobalMounts } from "./mountRules"
import { MODES, ModeIcon, MountStatusInline, needsRepair } from "./MountChip"
import { EnvIcon, enterLens, TargetIcon } from "./TargetCard"
import type { LensView, SkillEntry, useMountsData } from "./useMountsData"

type Data = ReturnType<typeof useMountsData>

/** 列头：点击进入这个目标的 Agent 视角；项目列弹出 Agent 选择（PRD 6.6） */
function TargetHead({ target, allTargets, lensOn }: { target: Target; allTargets: Target[]; lensOn: boolean }) {
  const agents = lensAgentsFor(target, allTargets)
  const kind = target.kind === "agent-global" ? copy.board.groupGlobal : copy.board.groupProject
  const label = (
    <span className="flex min-w-0 flex-col items-start gap-0.5 text-left">
      <span className="flex max-w-full items-center gap-1 font-medium">
        <TargetIcon target={target} className="size-3.5 shrink-0" />
        <span className="truncate">{target.label}</span>
        {lensOn && <ScanEyeIcon className="size-3.5 shrink-0" aria-hidden />}
      </span>
      <span className="flex items-center gap-1 text-xs font-normal text-muted-foreground">
        <EnvIcon envId={target.envId} className="size-3" />
        {kind} · {copy.env.short(target.envId)}
      </span>
    </span>
  )
  const buttonClass = "h-auto w-full max-w-44 justify-start px-1.5 py-1"
  if (target.kind === "agent-global") {
    return (
      <Button
        variant="ghost"
        className={buttonClass}
        aria-pressed={lensOn}
        aria-label={`${target.label}，${copy.lens.enter(target.label)}`}
        onClick={() => (lensOn ? useUIStore.getState().setLens(null) : agents[0] && enterLens(target, agents[0]))}
      >
        {label}
      </Button>
    )
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            className={buttonClass}
            aria-pressed={lensOn}
            aria-label={`${target.label}，${copy.lens.enter(target.label)}`}
          />
        }
      >
        {label}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-auto min-w-44">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{copy.targetCard.lens}</DropdownMenuLabel>
          {agents.map((a) => (
            <DropdownMenuItem key={a} onClick={() => enterLens(target, a)}>
              {copy.agent[a]}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function ModeRadios({ mount, Group, Item }: { mount: Mount; Group: typeof DropdownMenuRadioGroup | typeof ContextMenuRadioGroup; Item: typeof DropdownMenuRadioItem | typeof ContextMenuRadioItem }) {
  return (
    <Group value={mount.mode} onValueChange={(v: unknown) => v !== mount.mode && void useMountStore.getState().setMode(mount.id, v as Mode)}>
      {MODES.map((m) => (
        <Item key={m} value={m}>
          <ModeIcon mode={m} />
          {copy.mode[m]}
        </Item>
      ))}
    </Group>
  )
}

/** 单元格：开关、档位按钮（挂上后出现）、状态图标；右键菜单切换档位、修复、在文件夹中显示 */
function Cell({
  entry,
  target,
  mount,
  requestMount,
}: {
  entry: SkillEntry
  target: Target
  mount: Mount | undefined
  requestMount: (req: { skillId: string; targetId: string; mode: Mode }) => Promise<void>
}) {
  const { skill, asset } = entry
  const pending = mount?.status === "pending"
  const firstLink = mount?.links[0]?.path
  const toggle = (on: boolean) => {
    if (on) void requestMount({ skillId: skill.id, targetId: target.id, mode: asset.guardrails.defaultMode })
    else if (mount) void useMountStore.getState().unmount(mount.id)
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger render={<TableCell className="h-9 px-2" data-target-id={target.id} />}>
        <div className="flex items-center gap-1">
          <Switch
            size="sm"
            checked={!!mount}
            disabled={pending}
            onCheckedChange={toggle}
            aria-label={copy.matrix.switchLabel(skill.slug, target.label)}
          />
          {mount && (
            <>
              <DropdownMenu>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <DropdownMenuTrigger
                        render={
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            disabled={pending}
                            aria-label={copy.matrix.modeButton(skill.slug, target.label, copy.mode[mount.mode])}
                          />
                        }
                      />
                    }
                  >
                    <ModeIcon mode={mount.mode} />
                  </TooltipTrigger>
                  <TooltipContent>{copy.mode[mount.mode]}</TooltipContent>
                </Tooltip>
                <DropdownMenuContent align="start" className="w-auto min-w-36">
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>{copy.chip.mode}</DropdownMenuLabel>
                    <ModeRadios mount={mount} Group={DropdownMenuRadioGroup} Item={DropdownMenuRadioItem} />
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
              <MountStatusInline mount={mount} compact />
            </>
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-auto min-w-44">
        <ContextMenuGroup>
          <ContextMenuLabel>{copy.chip.mode}</ContextMenuLabel>
          {mount ? (
            <ModeRadios mount={mount} Group={ContextMenuRadioGroup} Item={ContextMenuRadioItem} />
          ) : (
            <ContextMenuItem disabled>{copy.mountsTab.empty}</ContextMenuItem>
          )}
        </ContextMenuGroup>
        <ContextMenuSeparator />
        <ContextMenuItem disabled={!mount || !needsRepair(mount)} onClick={() => mount && void useMountStore.getState().repair(mount.id)}>
          <WrenchIcon />
          {copy.chip.repair}
        </ContextMenuItem>
        <ContextMenuItem disabled={!firstLink} onClick={() => firstLink && void ipc.revealInDir(firstLink)}>
          <FolderOpenIcon />
          {copy.chip.reveal}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

/** 矩阵模式（PRD 6.6）：Table + sticky 首列，单元格里是 Switch、档位菜单和 ContextMenu；与看板共用挂载管线 */
export function MatrixView({
  data,
  lens,
  requestMount,
}: {
  data: Data
  lens: LensView | null
  requestMount: (req: { skillId: string; targetId: string; mode: Mode }) => Promise<void>
}) {
  const prodOnly = useUIStore((s) => s.matrixProdGlobal)

  // 常驻提示的「查看」：只显示生产资产挂在全局目标上的那些行和列
  const { rows, columns } = useMemo(() => {
    if (!prodOnly) return { rows: data.skills, columns: data.targets }
    const list = prodGlobalMounts(data.mounts, data.targets, (id) => data.skillById.get(id)?.asset)
    return {
      rows: data.skills.filter((e) => list.some((m) => m.skillId === e.skill.id)),
      columns: data.targets.filter((t) => list.some((m) => m.targetId === t.id)),
    }
  }, [prodOnly, data])
  const globals = columns.filter((t) => t.kind === "agent-global")
  const projects = columns.filter((t) => t.kind === "project")
  const ordered = [...globals, ...projects]
  const mountAt = (skillId: string, targetId: string) =>
    data.byTarget.get(targetId)?.find((m) => m.skillId === skillId)

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 border-t pt-3">
      {prodOnly && (
        <Alert className="mx-3 w-auto">
          <ShieldAlertIcon />
          <AlertDescription>{copy.mounts.prodGlobalFiltered}</AlertDescription>
          <AlertAction>
            <Button size="sm" variant="outline" onClick={() => useUIStore.getState().setMatrixProdGlobal(false)}>
              {copy.mounts.prodGlobalShowAll}
            </Button>
          </AlertAction>
        </Alert>
      )}
      {rows.length === 0 || ordered.length === 0 ? (
        <p className="px-3 text-sm text-muted-foreground">{copy.matrix.empty}</p>
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <Table aria-label={copy.matrix.label} className="w-max min-w-full">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead rowSpan={2} className="sticky left-0 z-10 min-w-56 bg-background pl-3 align-bottom">
                  {copy.matrix.skillColumn}
                </TableHead>
                {globals.length > 0 && (
                  <TableHead colSpan={globals.length} className="h-7 border-l text-xs">
                    {copy.board.groupGlobal}
                  </TableHead>
                )}
                {projects.length > 0 && (
                  <TableHead colSpan={projects.length} className="h-7 border-l text-xs">
                    {copy.board.groupProject}
                  </TableHead>
                )}
              </TableRow>
              <TableRow className="hover:bg-transparent">
                {ordered.map((t, i) => (
                  <TableHead
                    key={t.id}
                    className={cn("h-auto px-1 py-1", (i === 0 || i === globals.length) && "border-l")}
                  >
                    <TargetHead target={t} allTargets={data.allTargets} lensOn={lens?.target.id === t.id} />
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((e) => {
                const visible = lens ? lens.visible.has(e.skill.id) : null
                return (
                  <TableRow key={e.skill.id}>
                    <TableCell className="sticky left-0 z-10 bg-background pl-3">
                      <span className="flex items-center gap-2">
                        <span
                          className={cn(
                            "min-w-0 truncate rounded-sm font-mono text-[0.8125rem]",
                            visible === true && "ring-1 ring-ring ring-offset-2 ring-offset-background",
                            visible === false && "text-muted-foreground"
                          )}
                        >
                          {e.skill.slug}
                        </span>
                        <EnvBadge env={e.asset.envTag} />
                        {visible !== null &&
                          (visible ? (
                            <EyeIcon className="size-3.5 shrink-0" aria-hidden />
                          ) : (
                            <EyeOffIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                          ))}
                        {visible !== null && (
                          <span className="sr-only">{visible ? copy.lens.visible : copy.lens.invisible}</span>
                        )}
                      </span>
                    </TableCell>
                    {ordered.map((t) => (
                      <Cell key={t.id} entry={e} target={t} mount={mountAt(e.skill.id, t.id)} requestMount={requestMount} />
                    ))}
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
      )}
    </div>
  )
}
