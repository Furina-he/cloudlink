import { useDndContext, useDraggable } from "@dnd-kit/core"
import { EyeIcon, EyeOffIcon, GripVerticalIcon, LinkIcon, PackageIcon } from "lucide-react"
import { AnimatePresence, motion } from "motion/react"
import { useMemo, useState, type KeyboardEvent } from "react"

import type { Mode, Mount, Target } from "@/bindings"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { copy } from "@/lib/copy"
import { cn } from "@/lib/utils"
import { ENV_ORDER } from "@/stores/assets"
import { useMountStore } from "@/stores/mounts"
import { dragId } from "./dnd"
import { ModeIcon } from "./MountChip"
import { TargetIcon } from "./TargetCard"
import type { LensView, SkillEntry } from "./useMountsData"

/** 「挂载到…」菜单（PRD 6.6 拖拽的替代入口）：Checkbox 项列出全部目标，勾选即挂载，取消即卸载 */
function MountToMenu({
  entry,
  targets,
  mounts,
  open,
  onOpenChange,
  requestMount,
}: {
  entry: SkillEntry
  targets: Target[]
  mounts: Mount[]
  open: boolean
  onOpenChange: (open: boolean) => void
  requestMount: (req: { skillId: string; targetId: string; mode: Mode }) => Promise<void>
}) {
  const { skill, asset } = entry
  const mountOn = (targetId: string) => mounts.find((m) => m.skillId === skill.id && m.targetId === targetId)
  const groups = [
    { label: copy.board.groupGlobal, items: targets.filter((t) => t.kind === "agent-global") },
    { label: copy.board.groupProject, items: targets.filter((t) => t.kind === "project") },
  ].filter((g) => g.items.length > 0)

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={copy.board.mountTo(skill.slug)}
                  // 菜单按钮在 cmdk 的选项里，点击时不要让选项也响应
                  onPointerDown={(e) => e.stopPropagation()}
                />
              }
            />
          }
        >
          <LinkIcon />
        </TooltipTrigger>
        <TooltipContent>{copy.board.mountTo(skill.slug)}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-auto max-w-80 min-w-56">
        {groups.map((g, i) => (
          <DropdownMenuGroup key={g.label}>
            {i > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel>{g.label}</DropdownMenuLabel>
            {g.items.map((t) => {
              const m = mountOn(t.id)
              return (
                <DropdownMenuCheckboxItem
                  key={t.id}
                  checked={!!m}
                  disabled={m?.status === "pending"}
                  closeOnClick
                  onCheckedChange={(on) => {
                    if (on) void requestMount({ skillId: skill.id, targetId: t.id, mode: asset.guardrails.defaultMode })
                    else if (m) void useMountStore.getState().unmount(m.id)
                  }}
                >
                  <TargetIcon target={t} />
                  <span className="truncate">{t.label}</span>
                  <span className="ml-auto shrink-0 pl-3 text-xs text-muted-foreground">{copy.env.long(t.envId)}</span>
                </DropdownMenuCheckboxItem>
              )
            })}
          </DropdownMenuGroup>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Agent 视角下的可见性标记（DESIGN.md Agent Lens）：不降低透明度，可见加信号青描边与 EyeIcon */
function LensMark({ visible }: { visible: boolean | null }) {
  return (
    <AnimatePresence initial={false} mode="popLayout">
      {visible !== null && (
        <motion.span
          key={visible ? "on" : "off"}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="flex shrink-0 items-center"
        >
          {visible ? (
            <EyeIcon className="size-3.5 text-foreground" aria-hidden />
          ) : (
            <EyeOffIcon className="size-3.5 text-muted-foreground" aria-hidden />
          )}
          <span className="sr-only">{visible ? copy.lens.visible : copy.lens.invisible}</span>
        </motion.span>
      )}
    </AnimatePresence>
  )
}

function SourceRow({
  entry,
  visible,
  children,
  onOpenMenu,
}: {
  entry: SkillEntry
  /** null：没有视角 */
  visible: boolean | null
  children: React.ReactNode
  onOpenMenu: () => void
}) {
  const { skill, asset } = entry
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({
    id: dragId(skill.id),
    data: { slug: skill.slug },
  })
  const mode = asset.guardrails.defaultMode

  return (
    <CommandItem
      ref={setNodeRef}
      value={skill.id}
      onSelect={onOpenMenu}
      data-dragging={isDragging || undefined}
      className="relative gap-1.5 py-1 pr-1 pl-0.5 data-dragging:bg-muted [&>svg:last-child]:hidden"
    >
      <AnimatePresence initial={false}>
        {visible && (
          <motion.span
            aria-hidden
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="pointer-events-none absolute inset-0 rounded-[inherit] ring-1 ring-ring ring-inset"
          />
        )}
      </AnimatePresence>
      <Button
        ref={setActivatorNodeRef}
        type="button"
        variant="ghost"
        size="icon-xs"
        data-drag-handle
        aria-label={copy.board.dragHandle(skill.slug)}
        className="cursor-grab touch-none text-muted-foreground active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <GripVerticalIcon />
      </Button>
      <span className={cn("min-w-0 flex-1 truncate font-mono text-[0.8125rem]", visible === false && "text-muted-foreground")}>
        {skill.slug}
      </span>
      <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
        <ModeIcon mode={mode} />
        {copy.mode[mode]}
      </span>
      <LensMark visible={visible} />
      {children}
    </CommandItem>
  )
}

/** 看板左侧的 Skill 源列表（PRD 6.6、7.3）：Command 负责筛选后的键盘导航，每项可拖拽，也可用「挂载到…」菜单 */
export function SkillSource({
  skills,
  targets,
  mounts,
  lens,
  requestMount,
}: {
  skills: SkillEntry[]
  targets: Target[]
  mounts: Mount[]
  lens: LensView | null
  requestMount: (req: { skillId: string; targetId: string; mode: Mode }) => Promise<void>
}) {
  const [query, setQuery] = useState("")
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const { active } = useDndContext()

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const hit = (e: SkillEntry) =>
      !q ||
      [e.skill.slug, e.asset.name, e.asset.connection.sshAlias].some((s) => s.toLowerCase().includes(q))
    return ENV_ORDER.map((env) => ({ env, items: skills.filter((e) => e.asset.envTag === env && hit(e)) })).filter(
      (g) => g.items.length > 0
    )
  }, [skills, query])

  // 键盘拖拽期间按键交给 dnd-kit；在拖拽手柄上按空格或回车是拿起，不触发 cmdk 的选择
  const onKeyDown = (e: KeyboardEvent) => {
    const onHandle = (e.target as HTMLElement).closest("[data-drag-handle]")
    if (active || (onHandle && (e.key === " " || e.key === "Enter"))) e.preventDefault()
  }

  return (
    <Command
      shouldFilter={false}
      vimBindings={false}
      label={copy.board.sourceSearch}
      onKeyDown={onKeyDown}
      className="min-h-0 flex-1 rounded-none! bg-transparent p-0"
    >
      <div className="px-2 [&:has([data-slot=command-input]:focus-visible)_[data-slot=input-group]]:border-ring [&:has([data-slot=command-input]:focus-visible)_[data-slot=input-group]]:ring-3 [&:has([data-slot=command-input]:focus-visible)_[data-slot=input-group]]:ring-ring/50">
        <CommandInput value={query} onValueChange={setQuery} placeholder={copy.board.sourceSearch} />
      </div>
      <CommandList label={copy.board.sourceLabel} className="max-h-none min-h-0 flex-1 px-1.5 pt-1 pb-2">
        <CommandEmpty className="flex flex-col items-center gap-2 py-6 text-muted-foreground">
          <PackageIcon className="size-4" aria-hidden />
          {skills.length === 0 ? copy.mounts.noSkillsTitle : copy.board.noMatch}
        </CommandEmpty>
        {groups.map((g) => (
          <CommandGroup key={g.env} heading={copy.env.tag[g.env]}>
            {g.items.map((e) => (
              <SourceRow
                key={e.skill.id}
                entry={e}
                visible={lens ? lens.visible.has(e.skill.id) : null}
                onOpenMenu={() => setMenuFor(e.skill.id)}
              >
                <MountToMenu
                  entry={e}
                  targets={targets}
                  mounts={mounts}
                  open={menuFor === e.skill.id}
                  onOpenChange={(open) => setMenuFor(open ? e.skill.id : null)}
                  requestMount={requestMount}
                />
              </SourceRow>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
    </Command>
  )
}
