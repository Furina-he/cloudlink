// 看板拖拽挂载的 dnd-kit 配置（PRD 6.6、7.3）
import {
  KeyboardCode,
  pointerWithin,
  rectIntersection,
  type CollisionDetection,
  type KeyboardCoordinateGetter,
} from "@dnd-kit/core"

/** 指针拖拽按指针所在的卡片判定；键盘拖拽没有指针坐标，按拖拽副本与卡片的重叠面积判定 */
export const mountCollision: CollisionDetection = (args) => {
  const hits = pointerWithin(args)
  return hits.length > 0 ? hits : rectIntersection(args)
}

const NEXT = new Set<string>([KeyboardCode.Right, KeyboardCode.Down])
const PREV = new Set<string>([KeyboardCode.Left, KeyboardCode.Up])

/**
 * 键盘拖拽时，方向键在目标卡片之间跳转（PRD 6.6「方向键在目标之间移动」），而不是每次移动 25px。
 * 卡片按阅读顺序（先上后下、先左后右）排列：右、下到下一张，左、上到上一张。
 * 返回值是拖拽副本左上角的新位置，让它的中心落在目标卡片的中心
 */
export const targetKeyboardCoordinates: KeyboardCoordinateGetter = (event, { context }) => {
  const forward = NEXT.has(event.code)
  if (!forward && !PREV.has(event.code)) return undefined
  event.preventDefault()

  const { collisionRect, droppableRects, droppableContainers, over } = context
  if (!collisionRect) return undefined
  const ordered = droppableContainers
    .getEnabled()
    .filter((c) => droppableRects.has(c.id))
    .map((c) => ({ id: c.id, rect: droppableRects.get(c.id)! }))
    .sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left)
  if (ordered.length === 0) return undefined

  const current = over ? ordered.findIndex((c) => c.id === over.id) : -1
  const index =
    current < 0
      ? forward
        ? 0
        : ordered.length - 1
      : Math.min(ordered.length - 1, Math.max(0, current + (forward ? 1 : -1)))
  const { rect } = ordered[index]
  return {
    x: rect.left + rect.width / 2 - collisionRect.width / 2,
    y: rect.top + rect.height / 2 - collisionRect.height / 2,
  }
}

/** 拖拽项与落点的 id 前缀，避免 Skill id 与目标 id 混淆 */
export const dragId = (skillId: string) => `skill:${skillId}`
export const dropId = (targetId: string) => `target:${targetId}`
export const skillOfDrag = (id: string | number) => String(id).replace(/^skill:/, "")
export const targetOfDrop = (id: string | number) => String(id).replace(/^target:/, "")
