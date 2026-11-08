import { expect, test, type Page } from "@playwright/test"

import { GATE, collectConsoleErrors, openServer, ready } from "./helpers"

// P3.6 门槛截图：资源（配电盘、首次启动、服务器详情、云平台详情）、添加 SSH 服务器、添加云平台、Agent、设置，以及有新版本时的顶栏提醒和更新对话框 × 浅色 / 深色 × 900×640 / 760×520，随提交

const VIEWS: { name: string; query?: string; empty?: boolean; open: (page: Page) => Promise<void> }[] = [
  { name: "servers-list", open: async () => {} },
  // 首次启动：居中引导，添加和导入
  {
    name: "servers-empty",
    query: "?mock=empty",
    empty: true,
    open: async (page) => {
      await expect(page.getByRole("button", { name: "从 ~/.ssh/config 导入 · 3 台" })).toBeVisible()
    },
  },
  { name: "servers-detail", open: (page) => openServer(page, "hk-edge") },
  { name: "servers-cli", open: (page) => openServer(page, "vercel", "Vercel") },
  {
    name: "servers-new",
    open: async (page) => {
      await page.keyboard.press("Control+n")
      await page.getByRole("button", { name: /^SSH 服务器/ }).click()
      await expect(page.getByRole("textbox", { name: /^地址/ })).toBeFocused()
      // 截图前会移走焦点，失焦即校验：先填好必填项，免得截到「请填写地址」
      await page.getByRole("textbox", { name: /^地址/ }).fill("203.0.113.10")
      await page.getByRole("button", { name: "ssh-agent", exact: true }).or(page.getByRole("radio", { name: "ssh-agent" })).click()
      await page.getByRole("textbox", { name: /^名称/ }).fill("香港边缘节点")
    },
  },
  {
    name: "servers-new-cli",
    open: async (page) => {
      await page.keyboard.press("Control+n")
      await page.getByRole("button", { name: /Oracle Cloud/ }).click()
      await expect(page.getByRole("checkbox", { name: "oci-web-1" })).toBeVisible()
    },
  },
  {
    name: "agents",
    open: async (page) => {
      await page.keyboard.press("Control+2")
      await expect(page.getByRole("heading", { level: 2, name: "Agent 与目录" })).toBeVisible()
    },
  },
  {
    name: "settings",
    open: async (page) => {
      await page.keyboard.press("Control+4")
      await expect(page.getByText("编译产物语言")).toBeVisible()
    },
  },
  // F-406：有新版本时的顶栏提醒和更新对话框（PRD 第十章验收第 5 条）
  {
    name: "update-reminder",
    query: "?update=available",
    open: async (page) => {
      await expect(page.getByRole("banner").getByRole("button", { name: "有新版本 0.2.0，查看并更新" })).toBeVisible()
    },
  },
  {
    name: "update-dialog",
    query: "?update=available",
    open: async (page) => {
      await page.getByRole("banner").getByRole("button", { name: "有新版本 0.2.0，查看并更新" }).click()
      await expect(page.getByRole("dialog", { name: "新版本 0.2.0" })).toBeVisible()
    },
  },
]

for (const scheme of ["light", "dark"] as const) {
  for (const [width, height] of [[900, 640], [760, 520]]) {
    // 每个视图使用独立的 page/context，避免同页连续重载开发模块耗尽 Chromium 资源。
    for (const v of VIEWS) {
      test(`门槛截图：${scheme} ${width} ${v.name}`, async ({ page }) => {
        const errors = collectConsoleErrors(page)
        await page.emulateMedia({ colorScheme: scheme })
        await page.setViewportSize({ width, height })
        if (v.empty) await page.goto(`/${v.query}`)
        else await ready(page, v.query)
        await v.open(page)
        // 焦点环不进截图
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
        await page.screenshot({ path: `${GATE}/${v.name}-${scheme}-${width}.png`, animations: "disabled" })
        expect(errors).toEqual([])
      })
    }
  }
}
