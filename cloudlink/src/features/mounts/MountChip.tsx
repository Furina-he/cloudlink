import {
  EllipsisIcon,
  EyeIcon,
  FolderOpenIcon,
  UnlinkIcon,
  WrenchIcon,
  XIcon,
} from "lucide-react"
import { motion } from "motion/react"

import type { Mode, Mount } from "@/bindings"
import { MOUNT_STATE, TONE_TEXT } from "@/components/app/StateBadge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Item, ItemActions, ItemContent, ItemMedia, ItemTitle } from "@/components/ui/item"
import { Spinner } from "@/components/ui/spinner"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { copy } from "@/lib/copy"
import { ipc } from "@/lib/ipc"
import { cn } from "@/lib/utils"
import { useMountStore } from "@/stores/mounts"

export const MODES: Mode[] = ["read-only", "standard"]

/** 档位图标：只读巡检 EyeIcon，标准运维 WrenchIcon（DESIGN.md 图标表） */
export function ModeIcon({ mode, className }: { mode: Mode; className?: string }) {
  const Icon = mode === "read-only" ? EyeIcon : WrenchIcon
  return <Icon className={cn("size-3.5", className)} aria-hidden />
}

/** 复制模式下的正常挂载写作「已挂载（复制）」（PRD 6.13） */
export const isCopyMount = (m: Mount) => m.links.length > 0 && m.links.every((l) => l.kind === "copy")
export const needsRepair = (m: Mount) => m.status === "broken" || m.status === "stale-copy"

export function mountStatusText(m: Mount) {
  return m.status === "ok" && isCopyMount(m) ? copy.mountOkCopy : copy.mountStatus[m.status]
}

/** 挂载状态：图标 + 状态词（正常的符号链接只有读屏文字），悬停用 Tooltip 解释 */
export function MountStatusInline({ mount, compact }: { mount: Mount; compact?: boolean }) {
  const text = mountStatusText(mount)
  if (mount.status === "ok" && !isCopyMount(mount)) {
    return <span className="sr-only">{text}</span>
  }
  const { tone, icon: Icon } = MOUNT_STATE[mount.status]
  const detail = copy.chip.statusDetail[mount.status]
  const body = (
    <span className={cn("flex shrink-0 items-center gap-1 text-xs", mount.status === "ok" ? "text-muted-foreground" : TONE_TEXT[tone])}>
      {Icon ? <Icon className="size-3.5" aria-hidden /> : <Spinner className="size-3.5" aria-hidden />}
      <span className={cn(compact && "sr-only")}>{text}</span>
    </span>
  )
  if (!detail) return body
  return (
    <Tooltip>
      <TooltipTrigger render={<span tabIndex={compact ? 0 : undefined} className="flex shrink-0 rounded-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50" />}>
        {body}
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{detail}</TooltipContent>
    </Tooltip>
  )
}

/** 挂载芯片（DESIGN.md Mount Chip）：档位图标、slug、状态，修复或查看，菜单与卸载 */
export function MountChip({ mount, slug, targetLabel }: { mount: Mount; slug: string; targetLabel: string }) {
  const store = useMountStore.getState
  const pending = mount.status === "pending"
  const firstLink = mount.links[0]?.path

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, transition: { duration: 0.12 } }}
      className="list-none"
    >
      <Item size="xs" variant="muted" className="min-h-7 flex-nowrap gap-1.5 rounded-md py-0.5 pr-0.5 pl-2">
        <ItemMedia>
          <ModeIcon mode={mount.mode} />
          <span className="sr-only">{copy.mode[mount.mode]}</span>
        </ItemMedia>
        <ItemContent className="min-w-0">
          <ItemTitle className="block w-full truncate font-mono text-[0.8125rem] font-normal">{slug}</ItemTitle>
        </ItemContent>
        <MountStatusInline mount={mount} />
        <ItemActions className="gap-0">
          {needsRepair(mount) && (
            <Button variant="ghost" size="xs" onClick={() => void store().repair(mount.id)}>
              {copy.chip.repair}
            </Button>
          )}
          {mount.status === "conflict" && firstLink && (
            <Button variant="ghost" size="xs" onClick={() => void ipc.revealInDir(firstLink)}>
              {copy.chip.view}
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="ghost" size="icon-xs" aria-label={copy.chip.actions(slug)} disabled={pending} />}
            >
              <EllipsisIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-auto min-w-44">
              <DropdownMenuGroup>
                <DropdownMenuLabel>{copy.chip.mode}</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={mount.mode}
                  onValueChange={(v) => v !== mount.mode && void store().setMode(mount.id, v as Mode)}
                >
                  {MODES.map((m) => (
                    <DropdownMenuRadioItem key={m} value={m}>
                      <ModeIcon mode={m} />
                      {copy.mode[m]}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={!firstLink} onClick={() => firstLink && void ipc.revealInDir(firstLink)}>
                <FolderOpenIcon />
                {copy.chip.reveal}
              </DropdownMenuItem>
              <DropdownMenuItem disabled={!needsRepair(mount)} onClick={() => void store().repair(mount.id)}>
                <WrenchIcon />
                {copy.chip.repair}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => void store().unmount(mount.id)}>
                <UnlinkIcon />
                {copy.chip.unmount}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={copy.chip.unmountLabel(slug, targetLabel)}
                  disabled={pending}
                  onClick={() => void store().unmount(mount.id)}
                />
              }
            >
              <XIcon />
            </TooltipTrigger>
            <TooltipContent>{copy.chip.unmount}</TooltipContent>
          </Tooltip>
        </ItemActions>
      </Item>
    </motion.li>
  )
}
