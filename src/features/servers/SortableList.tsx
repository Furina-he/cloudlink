import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type UniqueIdentifier,
} from "@dnd-kit/core"
import { restrictToParentElement, restrictToVerticalAxis } from "@dnd-kit/modifiers"
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import type { ReactNode } from "react"

import { copy } from "@/lib/copy"

/**
 * 可排序列表（PRD 7.3）：DndContext + SortableContext + useSortable，键盘用 KeyboardSensor 与
 * sortableKeyboardCoordinates（空格拿起、方向键移动、空格放下、Esc 取消），拖完调用 RHF 的 move()
 */
export function SortableList({
  ids,
  onMove,
  children,
}: {
  ids: string[]
  onMove: (from: number, to: number) => void
  children: ReactNode
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )
  const position = (id: UniqueIdentifier) => ids.indexOf(String(id)) + 1

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis, restrictToParentElement]}
      onDragEnd={({ active, over }) => {
        if (over && active.id !== over.id) {
          onMove(ids.indexOf(String(active.id)), ids.indexOf(String(over.id)))
        }
      }}
      accessibility={{
        screenReaderInstructions: { draggable: copy.sortable.instructions },
        announcements: {
          onDragStart: ({ active }) => copy.sortable.pickup(position(active.id), ids.length),
          onDragOver: ({ over }) => (over ? copy.sortable.over(position(over.id)) : undefined),
          onDragEnd: ({ over }) => (over ? copy.sortable.drop(position(over.id)) : copy.sortable.cancel),
          onDragCancel: () => copy.sortable.cancel,
        },
      }}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </DndContext>
  )
}

/** 一行可排序项：rowProps 给行容器，handleProps 给拖拽手柄按钮（只有手柄能拿起） */
export function useSortableRow(id: string) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id })
  return {
    rowProps: {
      ref: setNodeRef,
      style: { transform: CSS.Translate.toString(transform), transition },
      "data-dragging": isDragging || undefined,
    },
    handleProps: { ref: setActivatorNodeRef, ...attributes, ...listeners },
  }
}
