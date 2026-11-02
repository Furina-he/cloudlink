import { describe, expect, it } from "vitest"

import { nextCardIndex, type CardBox } from "./grid-nav"

const box = (top: number, left: number): CardBox => ({ top, left, width: 200 })
// 生产组两行（3 + 1 张），开发组一行 2 张；组标题让 top 有落差，同一行的 top 有 1~2px 抖动
const boxes = [box(0, 0), box(1, 210), box(0, 420), box(120, 0), box(280, 0), box(281, 210)]

describe("服务器卡片的方向键导航（PRD 6.4）", () => {
  it("左右按 DOM 顺序移动，到头不再动", () => {
    expect(nextCardIndex(boxes, 0, "ArrowRight")).toBe(1)
    expect(nextCardIndex(boxes, 2, "ArrowRight")).toBe(3)
    expect(nextCardIndex(boxes, 0, "ArrowLeft")).toBe(0)
    expect(nextCardIndex(boxes, 5, "ArrowRight")).toBe(5)
  })

  it("上下移到相邻一行里水平位置最近的卡片", () => {
    expect(nextCardIndex(boxes, 1, "ArrowDown")).toBe(3)
    expect(nextCardIndex(boxes, 3, "ArrowUp")).toBe(0)
    expect(nextCardIndex(boxes, 2, "ArrowUp")).toBe(2)
  })

  it("可以跨分组上下移动", () => {
    expect(nextCardIndex(boxes, 3, "ArrowDown")).toBe(4)
    expect(nextCardIndex(boxes, 5, "ArrowUp")).toBe(3)
  })

  it("Home、End 跳到第一张和最后一张；没有卡片时返回 -1", () => {
    expect(nextCardIndex(boxes, 3, "Home")).toBe(0)
    expect(nextCardIndex(boxes, 0, "End")).toBe(5)
    expect(nextCardIndex([], 0, "ArrowDown")).toBe(-1)
  })
})
