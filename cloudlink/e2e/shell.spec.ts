import { expect, test } from "@playwright/test"

import { breadcrumb, card, collectConsoleErrors, ready, shot } from "./helpers"

// 应用外壳（PRD 6.2、6.3、6.9、6.12）：三项导航、计数、快捷键、命令面板
const VIEWS = ["服务器", "Agent", "设置"]

test.describe("应用外壳", () => {
  test("三项导航；计数和环境状态来自夹具", async ({ page }) => {
    const errors = collectConsoleErrors(page)
    await ready(page)
    const nav = page.locator("[data-slot=sidebar]")
    for (const v of VIEWS) await expect(nav.getByRole("button", { name: v, exact: true })).toBeVisible()
    await expect(nav.getByText("共 3 台服务器")).toBeAttached()
    // 副本缺失、被改动、冲突各 1
    await expect(nav.getByText("3 个问题需要处理")).toBeAttached()
    await expect(nav.getByText("WSL Ubuntu-24.04")).toBeVisible()
    expect(errors).toEqual([])
  })

  test("编译受阻时，服务器计数改为红色受阻数", async ({ page }) => {
    await ready(page, "?mock=degraded")
    await expect(page.locator("[data-slot=sidebar]").getByText("1 台服务器导致编译受阻")).toBeAttached()
  })

  test("Ctrl+1 到 Ctrl+3 切换视图，焦点移到新视图标题", async ({ page }) => {
    const errors = collectConsoleErrors(page)
    await ready(page)
    for (const [i, v] of [...VIEWS.entries()].reverse()) {
      await page.keyboard.press(`Control+${i + 1}`)
      const h1 = page.getByRole("heading", { level: 1, name: v })
      await expect(h1).toBeVisible()
      await expect(h1).toBeFocused()
    }
    expect(errors).toEqual([])
  })

  test("命令面板：三组；按别名打开服务器；跨视图跳转后选中项保留", async ({ page }) => {
    const errors = collectConsoleErrors(page)
    await ready(page)
    await page.keyboard.press("Control+k")
    const dialog = page.getByRole("dialog")
    const input = dialog.getByPlaceholder("输入视图、服务器名称、别名或操作")
    await expect(input).toBeFocused()
    for (const g of ["跳转", "服务器", "系统"]) await expect(dialog.getByText(g, { exact: true })).toBeVisible()
    await shot(page, "shell-command")

    await page.keyboard.type("sg-db")
    await expect(dialog.getByRole("option", { selected: true })).toContainText("新加坡数据库")
    await page.keyboard.press("Enter")
    await expect(dialog).toBeHidden()
    await expect(breadcrumb(page)).toContainText("sg-db")

    await page.keyboard.press("Control+k")
    await expect(input).toBeFocused()
    await page.keyboard.type("前往设置")
    await page.keyboard.press("Enter")
    await expect(page.getByRole("heading", { level: 1, name: "设置" })).toBeVisible()
    await page.keyboard.press("Control+1")
    await expect(breadcrumb(page)).toContainText("sg-db")
    await expect(card(page, "sg-db")).toHaveAttribute("aria-current", "true")
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

  test("Ctrl+B 折叠侧栏；跳到主内容链接", async ({ page }) => {
    await ready(page)
    const sidebar = page.locator("[data-slot=sidebar][data-state]")
    await page.keyboard.press("Control+b")
    await expect(sidebar).toHaveAttribute("data-state", "collapsed")
    await page.keyboard.press("Control+b")
    await expect(sidebar).toHaveAttribute("data-state", "expanded")

    await page.reload()
    await expect(card(page, "hk-edge")).toBeVisible()
    await page.keyboard.press("Tab")
    await expect(page.getByRole("link", { name: "跳到主内容" })).toBeFocused()
    await page.keyboard.press("Enter")
    await expect(page.getByRole("heading", { level: 1, name: "服务器" })).toBeFocused()
  })

  test("窗口小于 1024 时侧栏是图标模式，卡片单列", async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 700 })
    await ready(page)
    await expect(page.locator("[data-slot=sidebar][data-state]")).toHaveAttribute("data-state", "collapsed")
    await shot(page, "shell-1000")
  })
})
