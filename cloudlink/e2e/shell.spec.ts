import { expect, test } from "@playwright/test"

import { collectConsoleErrors, detailTitle, ready, row, shot } from "./helpers"

// 应用外壳（PRD 6.2、6.3、6.9、6.12）：紧凑窗口的顶部一体栏、三项导航与计数、快捷键、命令面板
const VIEWS = ["资源", "Agent", "设置"]

test.describe("应用外壳", () => {
  test("顶部一体栏：三项导航和计数；没有侧栏、面包屑，也不常驻运行环境列表", async ({ page }) => {
    const errors = collectConsoleErrors(page)
    await ready(page)
    const nav = page.getByRole("navigation", { name: "主导航" })
    for (const v of VIEWS) await expect(nav.getByRole("button", { name: new RegExp(`^${v}`) })).toBeVisible()
    await expect(nav.getByRole("button", { name: /^资源/ })).toHaveAttribute("aria-current", "page")
    await expect(nav.getByText("共 5 项资源")).toBeAttached()
    // 副本缺失、被改动、冲突各 1
    await expect(nav.getByText("3 个问题需要处理")).toBeAttached()
    await expect(page.locator("[data-slot=sidebar]")).toHaveCount(0)
    await expect(page.getByRole("navigation", { name: "当前位置" })).toHaveCount(0)
    await expect(page.getByText("WSL Ubuntu-24.04")).toHaveCount(0)
    // 资源页的操作在顶栏右侧
    await expect(page.getByRole("button", { name: "添加服务器" })).toBeVisible()
    await expect(page.getByRole("button", { name: "云平台" })).toBeVisible()
    await shot(page, "shell-01-header")
    expect(errors).toEqual([])
  })

  test("编译受阻时，资源计数改为红色受阻数", async ({ page }) => {
    await ready(page, "?mock=degraded")
    await expect(page.getByRole("navigation", { name: "主导航" }).getByText("1 项资源导致编译受阻")).toBeAttached()
  })

  test("Ctrl+1 到 Ctrl+3 切换视图，焦点移到新视图标题", async ({ page }) => {
    const errors = collectConsoleErrors(page)
    await ready(page)
    for (const [i, v] of [...VIEWS.entries()].reverse()) {
      await page.keyboard.press(`Control+${i + 1}`)
      const h1 = page.getByRole("heading", { level: 1, name: v })
      await expect(h1).toBeAttached()
      await expect(h1).toBeFocused()
    }
    expect(errors).toEqual([])
  })

  test("命令面板：三组；按标识打开资源；跨视图跳转后仍停在那项资源的详情", async ({ page }) => {
    const errors = collectConsoleErrors(page)
    await ready(page)
    await page.keyboard.press("Control+k")
    const dialog = page.getByRole("dialog")
    const input = dialog.getByPlaceholder("输入视图、资源名称、标识或操作")
    await expect(input).toBeFocused()
    for (const g of ["跳转", "资源", "系统"]) await expect(dialog.getByText(g, { exact: true })).toBeVisible()
    await shot(page, "shell-02-command")

    await page.keyboard.type("sg-db")
    await expect(dialog.getByRole("option", { selected: true })).toContainText("新加坡数据库")
    await page.keyboard.press("Enter")
    await expect(dialog).toBeHidden()
    await expect(detailTitle(page)).toHaveText("sg-db")

    await page.keyboard.press("Control+k")
    await expect(input).toBeFocused()
    await page.keyboard.type("前往设置")
    await page.keyboard.press("Enter")
    await expect(page.getByRole("heading", { level: 1, name: "设置" })).toBeVisible()
    await page.keyboard.press("Control+1")
    await expect(detailTitle(page)).toHaveText("sg-db")
    // 再点顶栏「资源」回到列表
    await page.getByRole("navigation", { name: "主导航" }).getByRole("button", { name: /^资源/ }).click()
    await expect(detailTitle(page)).toHaveCount(0)
    await expect(row(page, "sg-db")).toBeVisible()
    expect(errors).toEqual([])
  })

  test("Ctrl+\\ 打开和关闭预览；设置页会先切到 Agent 页", async ({ page }) => {
    await ready(page)
    await page.keyboard.press("Control+Backslash")
    const sheet = page.getByRole("dialog", { name: "预览 Skill" })
    await expect(sheet).toBeVisible()
    await page.keyboard.press("Control+Backslash")
    await expect(sheet).toBeHidden()

    await page.keyboard.press("Control+3")
    await page.keyboard.press("Control+Backslash")
    await expect(sheet).toBeVisible()
    // Sheet 是模态的，背后的页面不在无障碍树里，用 DOM 确认已切到 Agent 页
    await expect(page.locator("h1#view-title")).toHaveText("Agent")
  })

  test("跳到主内容链接", async ({ page }) => {
    await ready(page)
    await page.keyboard.press("Tab")
    await expect(page.getByRole("link", { name: "跳到主内容" })).toBeFocused()
    await page.keyboard.press("Enter")
    await expect(page.getByRole("heading", { level: 1, name: "资源" })).toBeFocused()
  })

  test("最小窗口 760×520：回路行仍是单行，名称不被截断", async ({ page }) => {
    await page.setViewportSize({ width: 760, height: 520 })
    await ready(page)
    const rows = page.locator("[role=listitem]")
    await expect(rows).toHaveCount(5)
    for (const box of await rows.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height))) {
      expect(box).toBeLessThanOrEqual(48)
    }
    // 名称都完整显示（没有省略号）
    const clipped = await page.locator("#server-list .truncate").evaluateAll((els) => els.filter((el) => el.scrollWidth > el.clientWidth).map((el) => el.textContent))
    expect(clipped).toEqual([])
    await shot(page, "shell-03-760")
  })
})
