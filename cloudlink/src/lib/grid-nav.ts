// 资源回路列表的方向键导航（单列时只有上下）（PRD 7.3：唯一允许的自写键盘逻辑）。按 DOM 顺序和卡片位置计算，跨分组（生产、开发）也能上下移动
import type { KeyboardEvent } from "react"

export interface CardBox {
  top: number
  left: number
  width: number
}

export type GridKey = "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown" | "Home" | "End"

/** 同一行的容差：卡片高度不同、有分组标题时，top 不完全相等 */
const ROW_TOLERANCE = 4

/** 下一张卡片的下标；没有可去的位置时返回原下标。纯函数，单元测试见 grid-nav.test.ts */
export function nextCardIndex(boxes: CardBox[], current: number, key: GridKey): number {
  const last = boxes.length - 1
  if (last < 0) return -1
  if (key === "Home") return 0
  if (key === "End") return last
  if (key === "ArrowLeft") return Math.max(0, current - 1)
  if (key === "ArrowRight") return Math.min(last, current + 1)

  const here = boxes[current]
  const below = key === "ArrowDown"
  // 目标行：方向上最近的那一行的 top
  const rowTops = boxes
    .map((b) => b.top)
    .filter((top) => (below ? top > here.top + ROW_TOLERANCE : top < here.top - ROW_TOLERANCE))
  if (rowTops.length === 0) return current
  const targetTop = below ? Math.min(...rowTops) : Math.max(...rowTops)
  const center = here.left + here.width / 2
  let best = current
  let bestDistance = Infinity
  boxes.forEach((b, i) => {
    if (Math.abs(b.top - targetTop) > ROW_TOLERANCE) return
    const distance = Math.abs(b.left + b.width / 2 - center)
    if (distance < bestDistance) {
      best = i
      bestDistance = distance
    }
  })
  return best
}

const GRID_KEYS = new Set<string>(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"])

/**
 * 网格容器的 onKeyDown：在带 data-grid-cell 的元素（回路行上的打开按钮）之间移动焦点。
 * 焦点在开关这类控件上时不处理，方向键留给控件自己
 */
export function handleGridKeyDown(e: KeyboardEvent<HTMLElement>) {
  if (!GRID_KEYS.has(e.key)) return
  const cells = [...e.currentTarget.querySelectorAll<HTMLElement>("[data-grid-cell]")]
  const current = cells.indexOf(e.target as HTMLElement)
  if (current < 0) return
  const boxes = cells.map((el) => {
    const r = el.getBoundingClientRect()
    return { top: r.top, left: r.left, width: r.width }
  })
  const next = nextCardIndex(boxes, current, e.key as GridKey)
  e.preventDefault()
  if (next !== current && next >= 0) {
    cells[next].focus()
    cells[next].scrollIntoView({ block: "nearest" })
  }
}
