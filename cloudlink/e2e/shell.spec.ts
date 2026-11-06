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

  test("减少动态效果：弹层不缩放、不滑动，只淡入；没开时照常", async ({ browser }) => {
    // 取弹层上 tw-animate-css 用的缩放变量和 Sheet 的位移；动画进行中读也一样，变量在元素上而不是关键帧里
    const motionOf = async (reducedMotion: "reduce" | "no-preference") => {
      const context = await browser.newContext({ reducedMotion, viewport: { width: 900, height: 640 } })
      const page = await context.newPage()
      await ready(page)
      await page.keyboard.press("Control+n")
      const dialog = page.locator("[data-slot=dialog-content]")
      await expect(dialog).toBeVisible()
      const dialogScale = await dialog.evaluate((el) => getComputedStyle(el).getPropertyValue("--tw-enter-scale").trim())
      await page.keyboard.press("Escape")
      await expect(dialog).toHaveCount(0)
      await page.keyboard.press("Control+Backslash")
      const sheet = page.locator("[data-slot=sheet-content]")
      await expect(sheet).toBeVisible()
      // 开着的 Sheet 本来就没有位移，要看的是进场时的样式：关掉过渡、加上进场标记再读，读到的就是目标值
      const sheetShift = await sheet.evaluate((el) => {
        el.style.transition = "none"
        el.setAttribute("data-starting-style", "")
        const shift = getComputedStyle(el).translate
        el.removeAttribute("data-starting-style")
        el.style.transition = ""
        return shift
      })
      await context.close()
      return { dialogScale, sheetShift }
    }
    expect(await motionOf("reduce")).toEqual({ dialogScale: "1", sheetShift: "none" })
    const normal = await motionOf("no-preference")
    expect(normal.dialogScale).not.toBe("1")
    expect(normal.sheetShift).not.toBe("none")
  })
})

test.describe("键盘焦点（P6 无障碍复查）", () => {
  test("Ctrl+N 打开添加弹窗时焦点在第一张类型卡片上，不经过带 Tooltip 的关闭按钮，按一次 Esc 就关闭", async ({ page }) => {
    await ready(page)
    await page.keyboard.press("Control+n")
    const dialog = page.getByRole("dialog", { name: "添加资源" })
    await expect(dialog.getByRole("button", { name: /^SSH 服务器/ })).toBeFocused()
    await expect(page.locator("[data-slot=tooltip-content]")).toHaveCount(0)
    await page.keyboard.press("Escape")
    await expect(dialog).toHaveCount(0)
  })

  test("从「添加服务器」按钮打开时焦点直接在地址上，关闭后回到按钮", async ({ page }) => {
    await ready(page)
    const add = page.getByRole("button", { name: "添加服务器" })
    await add.focus()
    await page.keyboard.press("Enter")
    await expect(page.getByRole("dialog").getByLabel("地址")).toBeFocused()
    await expect(page.locator("[data-slot=tooltip-content]")).toHaveCount(0)
    await page.keyboard.press("Escape")
    await expect(page.getByRole("dialog")).toHaveCount(0)
    await expect(add).toBeFocused()
  })

  test("详情的 Tab 面板本身不是 Tab 停靠点：焦点不会落在看不见焦点环的面板上", async ({ page }) => {
    await ready(page)
    await row(page, "hk-edge").focus()
    await page.keyboard.press("Enter")
    await expect(detailTitle(page)).toHaveText("hk-edge")
    await page.getByRole("tab", { name: "画像与规则" }).focus()
    // 内容能滚动，先经过带焦点环的滚动区域，再到第一个字段
    await page.keyboard.press("Tab")
    await expect(page.locator(":focus")).toHaveAttribute("data-slot", "scroll-area-viewport")
    await page.keyboard.press("Tab")
    await expect(page.getByRole("textbox", { name: "用途", exact: true })).toBeFocused()
  })

  test("护栏规则加载完才变长，仍然能用键盘滚动：滚动区域进入 Tab 序列，PageDown 能翻页", async ({ page }) => {
    await ready(page)
    await page.keyboard.press("Control+2")
    await page.getByRole("button", { name: "查看规则" }).click()
    const sheet = page.getByRole("dialog", { name: "护栏规则" })
    await expect(sheet.getByText("只读巡检：只放行这些命令")).toBeVisible()
    const viewport = sheet.locator("[data-slot=scroll-area-viewport]")
    await expect(viewport).toHaveAttribute("tabindex", "0")
    await page.keyboard.press("Tab")
    await expect(viewport).toBeFocused()
    await page.keyboard.press("PageDown")
    await expect.poll(() => viewport.evaluate((el) => el.scrollTop)).toBeGreaterThan(100)
  })

  test("安装护栏的确认框焦点停在「取消」上，代码块的高亮版本加载完也不会把焦点弄丢", async ({ page }) => {
    await ready(page)
    await page.keyboard.press("Control+2")
    await page.getByRole("button", { name: /^安装：/ }).first().focus()
    await page.keyboard.press("Enter")
    const confirm = page.getByRole("alertdialog")
    await expect(confirm.getByRole("button", { name: "取消" })).toBeFocused()
    // 等高亮版本替换掉纯文本版本以后，焦点仍在对话框里
    await expect(confirm.locator("[data-slot=code-block-content] span[style]").first()).toBeAttached()
    await expect(confirm.getByRole("button", { name: "取消" })).toBeFocused()
  })

  test("导入对话框打开时焦点不落在底部的开关上；Tab 先到「全选」", async ({ page }) => {
    await ready(page)
    await page.keyboard.press("Control+k")
    await page.keyboard.type("从 ssh config 导入")
    await page.keyboard.press("Enter")
    const dialog = page.getByRole("dialog", { name: "从 ssh config 导入主机" })
    await expect(dialog.getByRole("checkbox", { name: "全选" })).toBeVisible()
    await expect(dialog.getByRole("switch")).not.toBeFocused()
    await page.keyboard.press("Tab")
    await expect(dialog.getByRole("checkbox", { name: "全选" })).toBeFocused()
  })
})
