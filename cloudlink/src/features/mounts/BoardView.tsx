import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragStartEvent,
} from "@dnd-kit/core"
import { CableIcon, GripVerticalIcon, PlusIcon } from "lucide-react"
import { motion } from "motion/react"
import { useState } from "react"
import { useDefaultLayout } from "react-resizable-panels"

import type { Mode, Target } from "@/bindings"
import { EmptyState } from "@/components/app/EmptyState"
import { Button } from "@/components/ui/button"
import { Item, ItemContent, ItemMedia, ItemTitle } from "@/components/ui/item"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { ScrollArea } from "@/components/ui/scroll-area"
import { copy } from "@/lib/copy"
import { mountCollision, skillOfDrag, targetKeyboardCoordinates, targetOfDrop } from "./dnd"
import { ModeIcon } from "./MountChip"
import { SkillSource } from "./SkillSource"
import { TargetCard } from "./TargetCard"
import type { LensView, useMountsData } from "./useMountsData"

type Data = ReturnType<typeof useMountsData>

const labelOf = (data: { current?: Record<string, unknown> } | undefined) => String(data?.current?.label ?? "")
const slugOf = (data: { current?: Record<string, unknown> } | undefined) => String(data?.current?.slug ?? "")

/** dnd-kit 的屏幕阅读器播报（PRD 6.13） */
const announcements: Announcements = {
  onDragStart: ({ active }) => copy.dnd.pickup(slugOf(active.data)),
  onDragOver: ({ over }) => (over ? copy.dnd.over(labelOf(over.data)) : undefined),
  onDragEnd: ({ over }) => (over ? copy.dnd.drop(labelOf(over.data)) : copy.dnd.cancel),
  onDragCancel: () => copy.dnd.cancel,
}

function TargetSection({
  title,
  targets,
  data,
  onRemove,
}: {
  title: string
  targets: Target[]
  data: Data
  onRemove: (t: Target) => void
}) {
  if (targets.length === 0) return null
  return (
    <section className="flex flex-col gap-2" aria-label={title}>
      <h2 className="text-sm font-semibold">{title}</h2>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] items-start gap-3">
        {targets.map((t) => (
          <TargetCard
            key={t.id}
            target={t}
            mounts={data.byTarget.get(t.id) ?? []}
            skillById={data.skillById}
            onRemove={onRemove}
          />
        ))}
      </div>
    </section>
  )
}

/** 看板模式（PRD 6.6）：左侧 Skill 源列表，右侧目标卡片；拖拽、「挂载到…」菜单走同一条挂载管线 */
export function BoardView({
  data,
  lens,
  requestMount,
  onAddProject,
  onRemove,
}: {
  data: Data
  lens: LensView | null
  requestMount: (req: { skillId: string; targetId: string; mode: Mode }) => Promise<void>
  onAddProject: () => void
  onRemove: (t: Target) => void
}) {
  const layout = useDefaultLayout({ id: "mounts-board" })
  const [dragging, setDragging] = useState<string | null>(null)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: targetKeyboardCoordinates })
  )
  const dragged = dragging ? data.skillById.get(dragging) : undefined
  const globals = data.targets.filter((t) => t.kind === "agent-global")
  const projects = data.targets.filter((t) => t.kind === "project")

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={mountCollision}
      accessibility={{ announcements, screenReaderInstructions: { draggable: copy.board.dragInstructions } }}
      onDragStart={({ active }: DragStartEvent) => setDragging(skillOfDrag(active.id))}
      onDragCancel={() => setDragging(null)}
      onDragEnd={({ active, over }) => {
        setDragging(null)
        if (!over) return
        const entry = data.skillById.get(skillOfDrag(active.id))
        if (!entry) return
        void requestMount({
          skillId: entry.skill.id,
          targetId: targetOfDrop(over.id),
          mode: entry.asset.guardrails.defaultMode,
        })
      }}
    >
      <ResizablePanelGroup
        id="mounts-board"
        orientation="horizontal"
        defaultLayout={layout.defaultLayout}
        onLayoutChanged={layout.onLayoutChanged}
        className="min-h-0 flex-1 border-t"
      >
        <ResizablePanel id="source" defaultSize="30%" minSize="260px" maxSize="40%">
          <div className="flex h-full min-h-0 flex-col pt-2">
            <SkillSource
              skills={data.skills}
              targets={data.allTargets}
              mounts={data.mounts}
              lens={lens}
              requestMount={requestMount}
            />
          </div>
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel id="targets" minSize="320px">
          <ScrollArea className="h-full">
            <div className="flex flex-col gap-5 p-3">
              {data.allTargets.length === 0 ? (
                <EmptyState
                  icon={CableIcon}
                  title={copy.mounts.noTargetsTitle}
                  description={copy.mounts.noTargetsDescription}
                >
                  <Button onClick={onAddProject}>
                    <PlusIcon data-icon="inline-start" />
                    {copy.mounts.addProject}
                  </Button>
                </EmptyState>
              ) : data.targets.length === 0 ? (
                <p className="text-sm text-muted-foreground">{copy.mounts.envEmpty}</p>
              ) : (
                <>
                  <TargetSection title={copy.board.groupGlobal} targets={globals} data={data} onRemove={onRemove} />
                  <TargetSection title={copy.board.groupProject} targets={projects} data={data} onRemove={onRemove} />
                </>
              )}
            </div>
          </ScrollArea>
        </ResizablePanel>
      </ResizablePanelGroup>

      <DragOverlay>
        {dragged && (
          <motion.div initial={{ scale: 1 }} animate={{ scale: 1.02 }} transition={{ duration: 0.15 }}>
            <Item
              size="xs"
              variant="muted"
              className="w-64 flex-nowrap gap-1.5 rounded-md border-border bg-popover py-1 pl-1.5 shadow-[0_8px_24px_--theme(--color-black/18%)]"
            >
              <ItemMedia>
                <GripVerticalIcon className="size-4 text-muted-foreground" aria-hidden />
              </ItemMedia>
              <ItemContent className="min-w-0">
                <ItemTitle className="block w-full truncate font-mono text-[0.8125rem] font-normal">
                  {dragged.skill.slug}
                </ItemTitle>
              </ItemContent>
              <ModeIcon mode={dragged.asset.guardrails.defaultMode} className="text-muted-foreground" />
            </Item>
          </motion.div>
        )}
      </DragOverlay>
    </DndContext>
  )
}
