import { expect, test, type Page } from "@playwright/test"

// P1 验收：外壳、快捷键、控制台无报错
const SHOTS = "../test-results/p1"

function collectConsoleErrors(page: Page) {
  const errors: string[] = []
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") errors.push(`[${m.type()}] ${m.text()}`)
  })
  page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`))
  return errors
}

/** 等外壳渲染完、夹具数据加载完（侧栏环境状态出现） */
async function ready(page: Page) {
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
  await expect(page.locator("[data-slot=sidebar-footer] [data-sidebar=menu-button]").first()).toBeAttached()
  await expect(page.locator("[data-sidebar=menu-badge]").first()).toBeAttached()
}

const VIEWS = ["资产", "Skills", "挂载", "活动", "设置"]

test.describe("应用外壳（Mock 模式）", () => {
  test("完整外壳渲染，计数与环境状态来自夹具", async ({ page }) => {
    const errors = collectConsoleErrors(page)
    await page.goto("/")
    const nav = page.locator("[data-slot=sidebar]")
    for (const v of VIEWS) await expect(nav.getByRole("button", { name: v, exact: true })).toBeVisible()
    // 资产 3；Skills 受阻 1；挂载失效 1 + 冲突 1
    await expect(nav.getByText("共 3 个资产")).toBeAttached()
    await expect(nav.getByText("1 个 Skill 编译受阻")).toBeAttached()
    await expect(nav.getByText("2 个挂载失效或冲突")).toBeAttached()
    await expect(nav.getByText("WSL Ubuntu-24.04")).toBeVisible()
    await ready(page)
    await page.screenshot({ path: `${SHOTS}/shell-light-1280.png` })
    expect(errors).toEqual([])
  })

  test("Ctrl+1 到 Ctrl+5 切换视图，焦点移到新视图标题", async ({ page }) => {
    const errors = collectConsoleErrors(page)
    await page.goto("/")
    await ready(page)
    for (const [i, v] of [...VIEWS.entries()].reverse()) {
      await page.keyboard.press(`Control+${i + 1}`)
      const h1 = page.getByRole("heading", { level: 1, name: v })
      await expect(h1).toBeVisible()
      await expect(h1).toBeFocused()
    }
    expect(errors).toEqual([])
  })

  test("Ctrl+K 打开命令面板，可跳转视图、打开资产", async ({ page }) => {
    const errors = collectConsoleErrors(page)
    await page.goto("/")
    await ready(page)
    await page.keyboard.press("Control+k")
    const dialog = page.getByRole("dialog")
    await expect(dialog.getByPlaceholder("输入视图、资产名称、别名或操作")).toBeFocused()
    for (const g of ["跳转", "资产", "操作", "挂载"]) await expect(dialog.getByText(g, { exact: true })).toBeVisible()
    await page.screenshot({ path: `${SHOTS}/command-light-1280.png` })

    await page.keyboard.type("hk-edge")
    await expect(dialog.getByRole("option", { selected: true })).toContainText("香港轻量反代与边缘节点")
    await page.keyboard.press("Enter")
    await expect(dialog).toBeHidden()
    // 面包屑：资产 / 当前对象
    await expect(page.getByRole("navigation", { name: "当前位置" })).toContainText("香港轻量反代与边缘节点")

    await page.keyboard.press("Control+k")
    // 等输入框拿到焦点再输入，否则按键可能在对话框打开前丢失
    await expect(page.getByPlaceholder("输入视图、资产名称、别名或操作")).toBeFocused()
    await page.keyboard.type("前往活动")
    await expect(page.getByRole("option", { selected: true })).toContainText("前往活动")
    await page.keyboard.press("Enter")
    await expect(page.getByRole("heading", { level: 1, name: "活动" })).toBeVisible()
    // 切回资产后，选中项保留
    await page.keyboard.press("Control+1")
    await expect(page.getByRole("navigation", { name: "当前位置" })).toContainText("香港轻量反代与边缘节点")
    expect(errors).toEqual([])
  })

  test("Ctrl+B 折叠和展开侧栏", async ({ page }) => {
    await page.goto("/")
    await ready(page)
    const sidebar = page.locator("[data-slot=sidebar][data-state]")
    await expect(sidebar).toHaveAttribute("data-state", "expanded")
    await page.keyboard.press("Control+b")
    await expect(sidebar).toHaveAttribute("data-state", "collapsed")
    await page.screenshot({ path: `${SHOTS}/shell-collapsed-light-1280.png` })
    await page.keyboard.press("Control+b")
    await expect(sidebar).toHaveAttribute("data-state", "expanded")
  })

  test("跳到主内容链接", async ({ page }) => {
    await page.goto("/")
    await ready(page)
    await page.keyboard.press("Tab")
    const skip = page.getByRole("link", { name: "跳到主内容" })
    await expect(skip).toBeFocused()
    await page.screenshot({ path: `${SHOTS}/skip-link-light-1280.png` })
    await page.keyboard.press("Enter")
    await expect(page.getByRole("heading", { level: 1, name: "资产" })).toBeFocused()
  })

  test("深色主题与 1024 宽度", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" })
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto("/")
    await expect(page.locator("html")).toHaveClass(/dark/)
    await ready(page)
    await page.screenshot({ path: `${SHOTS}/shell-dark-1280.png` })
    await page.keyboard.press("Control+k")
    await page.screenshot({ path: `${SHOTS}/command-dark-1280.png` })
    await page.keyboard.press("Escape")

    // 小于 1024 时侧栏默认图标模式；恰好 1024 时展开
    await page.setViewportSize({ width: 1000, height: 700 })
    await page.reload()
    await ready(page)
    await expect(page.locator("[data-slot=sidebar][data-state]")).toHaveAttribute("data-state", "collapsed")
    await page.screenshot({ path: `${SHOTS}/shell-dark-1000.png` })
  })
})
