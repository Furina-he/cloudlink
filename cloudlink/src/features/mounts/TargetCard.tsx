import { useDroppable } from "@dnd-kit/core"
import {
  BotIcon,
  EllipsisIcon,
  FolderGit2Icon,
  FolderInputIcon,
  FolderOpenIcon,
  MonitorIcon,
  RefreshCwIcon,
  ScanEyeIcon,
  SquareTerminalIcon,
  Trash2Icon,
} from "lucide-react"
import { AnimatePresence } from "motion/react"

import type { AgentId, LinkMode, Mount, Target } from "@/bindings"
import { Truncate } from "@/components/app/Truncate"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { toast } from "@/components/ui/toast"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { CONVENTION_DIRS, lensAgentsFor } from "@/lib/agents"
import { copy, ipcErrorText } from "@/lib/copy"
import { ipc } from "@/lib/ipc"
import { cn } from "@/lib/utils"
import type { IpcError } from "@/bindings"
import { useMountStore } from "@/stores/mounts"
import { useTargetStore } from "@/stores/targets"
import { useUIStore } from "@/stores/ui"
import { dropId } from "./dnd"
import { MountChip } from "./MountChip"
import type { SkillEntry } from "./useMountsData"

const LINK_MODES: LinkMode[] = ["auto", "link", "copy"]

export const TargetIcon = ({ target, className }: { target: Target; className?: string }) =>
  target.kind === "agent-global" ? <BotIcon className={className} aria-hidden /> : <FolderGit2Icon className={className} aria-hidden />

export const EnvIcon = ({ envId, className }: { envId: string; className?: string }) =>
  envId === "windows" ? <MonitorIcon className={className} aria-hidden /> : <SquareTerminalIcon className={className} aria-hidden />

const toastError = (e: IpcError) => toast.add({ title: ipcErrorText(e.id, e.params), type: "error" })

/** 目标卡片的操作，矩阵列头也会用到「进入视角」 */
export function enterLens(target: Target, agent: AgentId) {
  useUIStore.getState().setLens({ targetId: target.id, agent })
}

export function setLinkMode(target: Target, linkMode: LinkMode) {
  if (target.linkMode === linkMode) return
  useTargetStore
    .getState()
    .updateTarget(target.id, { linkMode })
    .then(() => toast.add({ title: copy.targetCard.linkModeChanged(target.label, copy.targetCard.linkModeOption[linkMode]) }))
    .catch(toastError)
}

/** F-305：目标路径不存在时，引导用户更新项目路径 */
export async function changeProjectPath(target: Target) {
  const picked = await ipc.pickDirectory()
  if (typeof picked !== "string") return
  useTargetStore
    .getState()
    .updateTarget(target.id, { path: picked })
    .then(() => toast.add({ title: copy.targetCard.pathChanged(target.label) }))
    .catch(toastError)
}

export function checkLinks() {
  useMountStore
    .getState()
    .checkAll()
    .then((list) => toast.add({ title: copy.mounts.checkDone(list.length) }))
    .catch(() => {})
}

/** 挂载目标卡片（PRD 6.6）：Card + useDroppable，内容是挂载芯片 */
export function TargetCard({
  target,
  mounts,
  skillById,
  onRemove,
}: {
  target: Target
  mounts: Mount[]
  skillById: Map<string, SkillEntry>
  onRemove: (target: Target) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: dropId(target.id), data: { label: target.label } })
  const allTargets = useTargetStore((s) => s.targets)
  const lens = useUIStore((s) => s.lens)
  const agents = lensAgentsFor(target, allTargets)
  const lensOn = lens?.targetId === target.id
  const isProject = target.kind === "project"
  const conventions = (target.conventions ?? []).map((c) => CONVENTION_DIRS[c].split("/")[0]).join(" + ")

  const lensButton = (
    <Tooltip>
      <TooltipTrigger
        render={
          isProject ? (
            <DropdownMenuTrigger
              render={<Button variant="ghost" size="icon-xs" aria-label={copy.targetCard.lens} aria-pressed={lensOn} />}
            />
          ) : (
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={copy.targetCard.lens}
              aria-pressed={lensOn}
              onClick={() => (lensOn ? useUIStore.getState().setLens(null) : agents[0] && enterLens(target, agents[0]))}
            />
          )
        }
      >
        <ScanEyeIcon />
      </TooltipTrigger>
      <TooltipContent>{copy.targetCard.lens}</TooltipContent>
    </Tooltip>
  )

  const agentItems = agents.map((a) => (
    <DropdownMenuItem key={a} onClick={() => enterLens(target, a)}>
      {copy.agent[a]}
    </DropdownMenuItem>
  ))

  return (
    <Card
      ref={setNodeRef}
      size="sm"
      data-target-id={target.id}
      aria-label={target.label}
      role="region"
      className={cn("min-w-0 gap-2 transition-colors", isOver && "bg-ring/8 ring-2 ring-ring")}
    >
      <CardHeader className="gap-0.5">
        <CardTitle className="flex min-w-0 items-center gap-1.5">
          <TargetIcon target={target} className="size-4 shrink-0 text-muted-foreground" />
          <Truncate text={target.label} />
        </CardTitle>
        <CardDescription className="flex min-w-0 flex-col gap-0.5 text-xs">
          <span className="flex min-w-0 items-center gap-1">
            <EnvIcon envId={target.envId} className="size-3.5 shrink-0" />
            <span className="shrink-0">{copy.env.long(target.envId)}</span>
            {isProject && conventions && (
              <>
                <span aria-hidden>·</span>
                <span className="truncate font-mono">{conventions}</span>
              </>
            )}
            {isProject && target.gitExclude && (
              <>
                <span aria-hidden>·</span>
                <span className="shrink-0">{copy.targetCard.gitExcluded}</span>
              </>
            )}
          </span>
          <Truncate text={target.path} className="font-mono" />
        </CardDescription>
        <CardAction className="flex gap-0.5">
          {isProject ? (
            <DropdownMenu>
              {lensButton}
              <DropdownMenuContent align="end" className="w-auto min-w-44">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>{copy.targetCard.lens}</DropdownMenuLabel>
                  {agentItems}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            lensButton
          )}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="ghost" size="icon-xs" aria-label={copy.targetCard.actions(target.label)} />}
            >
              <EllipsisIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-auto min-w-48">
              {isProject ? (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <ScanEyeIcon />
                    {copy.targetCard.lens}
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="w-auto min-w-44">{agentItems}</DropdownMenuSubContent>
                </DropdownMenuSub>
              ) : (
                <DropdownMenuItem onClick={() => agents[0] && enterLens(target, agents[0])}>
                  <ScanEyeIcon />
                  {copy.targetCard.lens}
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>{copy.targetCard.linkMode}</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={target.linkMode} onValueChange={(v) => setLinkMode(target, v as LinkMode)}>
                  {LINK_MODES.map((m) => (
                    <DropdownMenuRadioItem key={m} value={m}>
                      {copy.targetCard.linkModeOption[m]}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => void ipc.revealInDir(target.path)}>
                <FolderOpenIcon />
                {copy.targetCard.reveal}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={checkLinks}>
                <RefreshCwIcon />
                {copy.targetCard.check}
              </DropdownMenuItem>
              {isProject && (
                <DropdownMenuItem onClick={() => void changeProjectPath(target)}>
                  <FolderInputIcon />
                  {copy.targetCard.changePath}
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => onRemove(target)}>
                <Trash2Icon />
                {copy.targetCard.remove}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </CardAction>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-1">
          <AnimatePresence initial={false}>
            {mounts.map((m) => (
              <MountChip
                key={`${m.skillId}:${m.targetId}`}
                mount={m}
                slug={skillById.get(m.skillId)?.skill.slug ?? m.skillId}
                targetLabel={target.label}
              />
            ))}
          </AnimatePresence>
        </ul>
        <p
          className={cn(
            "flex h-7 items-center justify-center rounded-md border border-dashed text-xs text-muted-foreground",
            mounts.length > 0 && "mt-1"
          )}
        >
          {copy.board.dropHint}
        </p>
      </CardContent>
    </Card>
  )
}
