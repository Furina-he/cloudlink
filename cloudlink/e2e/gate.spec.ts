import { expect, test, type Page } from "@playwright/test"

import { GATE, collectConsoleErrors, openServer, ready } from "./helpers"

// P3.5 门槛截图：服务器（列表 + 详情）、新建服务器、Agent、设置 × 浅色 / 深色 × 1280 / 1024，随提交

const VIEWS: { name: string; open: (page: Page) => Promise<void> }[] = [
  { name: "servers-list", open: async () => {} },
  { name: "servers-detail", open: (page) => openServer(page, "hk-edge") },
  {
    name: "servers-new",
    open: async (page) => {
      await page.keyboard.press("Control+n")
      await expect(page.getByRole("textbox", { name: /^名称/ })).toBeFocused()
    },
  },
  {
    name: "agents",
    open: async (page) => {
      await page.keyboard.press("Control+2")
      await expect(page.getByRole("heading", { level: 2, name: "分发目标" })).toBeVisible()
    },
  },
  {
    name: "settings",
    open: async (page) => {
      await page.keyboard.press("Control+3")
      await expect(page.getByText("编译产物语言")).toBeVisible()
    },
  },
]

for (const scheme of ["light", "dark"] as const) {
  for (const width of [1280, 1024]) {
    test(`门槛截图：${scheme} ${width}`, async ({ page }) => {
      const errors = collectConsoleErrors(page)
      await page.emulateMedia({ colorScheme: scheme })
      await page.setViewportSize({ width, height: 800 })
      for (const v of VIEWS) {
        await ready(page)
        await v.open(page)
        // 焦点环不进截图
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
        await page.screenshot({ path: `${GATE}/${v.name}-${scheme}-${width}.png`, animations: "disabled" })
      }
      expect(errors).toEqual([])
    })
  }
}
