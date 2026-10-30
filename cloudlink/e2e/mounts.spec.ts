import { expect, test, type Page } from "@playwright/test"

// P3 验收：挂载、Skills、活动、设置（PRD 6.6–6.9、F-301–F-307）
// 过程截图放仓库根目录 test-results/p3；门槛截图放 e2e/__screenshots__
const SHOTS = "../test-results/p3"
const GATE = "e2e/__screenshots__"

function collectConsoleErrors(page: Page) {
  const errors: string[] = []
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") errors.push(`[${m.type()}] ${m.text()}`)
  })
  page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`))
  return errors
}

/** 等外壳和数据加载完，再切到挂载视图 */
async function openMounts(page: Page) {
  await page.goto("/")
  await expect(page.getByRole("option").first()).toBeVisible()
  await page.keyboard.press("Control+3")
  await expect(page.getByRole("heading", { level: 1, name: "挂载" })).toBeVisible()
  await expect(card(page, "Blog-Astro")).toBeVisible()
}

const card = (page: Page, label: string) => page.getByRole("region", { name: label, exact: true })
const toast = (page: Page, text: string | RegExp) => page.locator("[data-slot=toast]").filter({ hasText: text })
/** dnd-kit 的屏幕阅读器播报区 */
const live = (page: Page) => page.locator("[id^=DndLiveRegion]")
const pause = (page: Page) => page.waitForTimeout(150)

test.describe("挂载视图", () => {
  test("六种挂载状态和复制模式都有图标和状态词；生产挂全局常驻提示", async ({ page }) => {
    const errors = collectConsoleErrors(page)
    await openMounts(page)
    await expect(card(page, "Claude Code - 全局")).toContainText("已挂载（复制）")
    await expect(card(page, "Claude Code - 全局")).toContainText("别名不可达")
    await expect(card(page, "OpenPet-Desktop")).toContainText("已失效")
    await expect(card(page, "Blog-Astro")).toContainText("冲突")
    await expect(card(page, "Blog-Astro")).toContainText("复制模式待同步")
    // ok（符号链接）只有读屏文字
    await expect(card(page, "通用 .agents - 全局").getByText("已挂载", { exact: true })).toBeAttached()
    await expect(page.getByText("2 个生产资产挂在全局目标上")).toBeVisible()
    await page.screenshot({ path: `${SHOTS}/01-states.png`, animations: "disabled" })
    expect(errors).toEqual([])
  })

  test("挂载中（pending）：芯片先以 Spinner 出现", async ({ page }) => {
    await page.goto("/?mock=slow")
    await expect(page.getByRole("option").first()).toBeVisible({ timeout: 15_000 })
    await page.keyboard.press("Control+3")
    await page.getByRole("switch").first().waitFor({ state: "detached" }).catch(() => {})
    await page.getByRole("button", { name: "把 vps-dev-box 挂载到…" }).click()
    await page.getByRole("menuitemcheckbox", { name: /OpenPet-Desktop/ }).click()
    await expect(card(page, "OpenPet-Desktop")).toContainText("挂载中")
    await page.screenshot({ path: `${SHOTS}/02-pending.png`, animations: "disabled" })
    await expect(card(page, "OpenPet-Desktop")).not.toContainText("挂载中", { timeout: 10_000 })
  })

  test("只用键盘拖拽挂载：生产挂全局先确认，成功后弹生效提示", async ({ page }) => {
    await openMounts(page)
    const handle = page.getByRole("button", { name: "拖动 vps-sg-db 到目标以挂载" })
    await handle.focus()
    await page.keyboard.press("Space")
    await expect(live(page)).toContainText("已拿起 vps-sg-db")
    await pause(page)
    await page.keyboard.press("ArrowRight")
    await pause(page)
    await page.keyboard.press("ArrowRight")
    await pause(page)
    await expect(live(page)).toContainText("当前位于 通用 .agents - 全局")
    await expect(card(page, "通用 .agents - 全局")).toHaveClass(/ring-2/)
    await page.screenshot({ path: `${SHOTS}/03-keyboard-drag.png`, animations: "disabled" })
    await page.keyboard.press("Space")
    const confirm = page.getByRole("alertdialog", { name: "把生产资产挂到全局？" })
    await expect(confirm).toBeVisible()
    await confirm.getByRole("button", { name: "仍然挂载" }).click()
    await expect(toast(page, "已把 vps-sg-db 挂载到 通用 .agents - 全局")).toBeVisible()
    await expect(card(page, "通用 .agents - 全局")).toContainText("vps-sg-db")
  })

  test("全局与项目档位不同：挂载被阻止并说明原因", async ({ page }) => {
    await openMounts(page)
    // dev-box 已以只读挂在 Blog-Astro（.claude），再以标准运维挂到 Claude Code 全局
    await page.getByRole("button", { name: "把 vps-dev-box 挂载到…" }).click()
    await page.getByRole("menuitemcheckbox", { name: /Claude Code - 全局/ }).click()
    await expect(toast(page, /无法挂载：vps-dev-box 已以「只读巡检」挂在项目 Blog-Astro/)).toBeVisible()
    await expect(card(page, "Claude Code - 全局")).not.toContainText("vps-dev-box")
    await page.screenshot({ path: `${SHOTS}/04-mode-conflict.png`, animations: "disabled" })
  })

  test("卸载后 Toast 带撤销，撤销即重新挂载", async ({ page }) => {
    await openMounts(page)
    await page.getByRole("button", { name: "从 OpenPet-Desktop 卸载 vps-hk-edge" }).click()
    const t = toast(page, "已卸载 vps-hk-edge")
    await expect(t).toBeVisible()
    await expect(card(page, "OpenPet-Desktop")).not.toContainText("vps-hk-edge")
    await t.getByRole("button", { name: "撤销" }).click()
    await expect(card(page, "OpenPet-Desktop")).toContainText("vps-hk-edge")
  })

  test("只用键盘进入和退出 Agent 视角", async ({ page }) => {
    await openMounts(page)
    const lensButton = card(page, "OpenPet-Desktop").getByRole("button", { name: "以此视角查看" })
    await lensButton.focus()
    await page.keyboard.press("Enter")
    await page.getByRole("menuitem", { name: "通用 .agents（Codex 等）" }).focus()
    await page.keyboard.press("Enter")
    const banner = page.getByRole("status").filter({ hasText: "Agent 视角" })
    await expect(banner).toContainText("通用 .agents（Codex 等） @ OpenPet-Desktop（WSL Ubuntu-24.04）")
    // 项目 .agents：hk-edge（ok）；sg-db 已失效；全局 .agents：dev-box
    await expect(banner).toContainText("可见 2 个 Skill（项目 1、全局 1）")
    await expect(banner).toContainText("另有 1 个挂载异常")
    await page.waitForTimeout(400)
    await expect(page.getByRole("option", { name: /vps-hk-edge.*此视角可见/ })).toBeVisible()
    await expect(page.getByRole("option", { name: /vps-sg-db.*此视角不可见/ })).toBeVisible()
    await page.screenshot({ path: `${SHOTS}/05-lens.png`, animations: "disabled" })
    await page.getByRole("heading", { level: 1, name: "挂载" }).focus()
    await page.keyboard.press("Escape")
    await expect(banner).toBeHidden()
  })

  test("矩阵：用空格切换开关，走同一条挂载管线", async ({ page }) => {
    await openMounts(page)
    await page.getByRole("button", { name: "矩阵" }).click()
    const sw = page.getByRole("switch", { name: "将 vps-dev-box 挂载到 OpenPet-Desktop" })
    await sw.focus()
    await page.keyboard.press("Space")
    await expect(toast(page, "已把 vps-dev-box 挂载到 OpenPet-Desktop")).toBeVisible()
    await expect(sw).toBeChecked()
    // 生产挂全局：二次确认
    await page.getByRole("switch", { name: "将 vps-hk-edge 挂载到 通用 .agents - 全局" }).focus()
    await page.keyboard.press("Space")
    await expect(page.getByRole("alertdialog", { name: "把生产资产挂到全局？" })).toBeVisible()
    await page.keyboard.press("Escape")
  })

  test("常驻提示的「查看」：矩阵只显示生产资产挂全局的挂载", async ({ page }) => {
    await openMounts(page)
    await page.getByRole("alert").filter({ hasText: "生产资产挂在全局目标上" }).getByRole("button", { name: "查看" }).click()
    await expect(page.getByText("矩阵只显示生产资产挂在全局目标上的挂载。")).toBeVisible()
    await expect(page.getByRole("switch")).toHaveCount(2)
  })

  test("添加项目与移除目标（级联卸载）", async ({ page }) => {
    await openMounts(page)
    await page.getByRole("button", { name: "添加项目" }).click()
    const dialog = page.getByRole("dialog", { name: "添加项目" })
    await expect(dialog.getByLabel("名称")).toHaveValue("infra-tools")
    await expect(dialog.getByRole("checkbox", { name: ".claude/skills" })).toBeChecked()
    await page.screenshot({ path: `${SHOTS}/06-add-project.png`, animations: "disabled" })
    await dialog.getByRole("button", { name: "添加项目" }).click()
    await expect(card(page, "infra-tools")).toBeVisible()

    await card(page, "Blog-Astro").getByRole("button", { name: "Blog-Astro 的操作" }).click()
    await page.getByRole("menuitem", { name: "移除目标" }).click()
    const confirm = page.getByRole("alertdialog", { name: "移除目标「Blog-Astro」？" })
    await expect(confirm).toContainText("以下 2 个挂载会被一并卸载")
    await confirm.getByRole("button", { name: "移除目标" }).click()
    await expect(card(page, "Blog-Astro")).toBeHidden()
  })
})

test.describe("其余视图", () => {
  test("Skills、活动、设置能完整渲染，控制台无报错", async ({ page }) => {
    const errors = collectConsoleErrors(page)
    await page.goto("/")
    await expect(page.getByRole("option").first()).toBeVisible()
    await page.keyboard.press("Control+2")
    await page.getByRole("button", { name: "vps-hk-edge" }).click()
    await expect(page.getByText("没有发现问题")).toBeVisible()
    await page.getByLabel("状态筛选").click()
    await page.getByRole("option", { name: "编译受阻" }).click()
    await expect(page.getByRole("row")).toHaveCount(2)

    await page.keyboard.press("Control+4")
    await expect(page.getByRole("heading", { level: 2, name: "今天" })).toBeVisible()
    await page.getByRole("button", { name: /探测了 hk-edge/ }).click()
    await expect(page.getByText("uname -srm")).toBeVisible()

    await page.keyboard.press("Control+5")
    await page.getByRole("button", { name: /危险操作/ }).click()
    await expect(page.getByRole("heading", { level: 2, name: "危险操作" })).toBeVisible()
    await page.getByRole("region", { name: "危险操作" }).getByRole("button", { name: "清空数据" }).click()
    const confirm = page.getByRole("alertdialog", { name: "清空数据" })
    const go = confirm.getByRole("button", { name: "清空数据" })
    await expect(go).toBeDisabled()
    await confirm.getByLabel("输入「清空数据」确认").fill("清空数据")
    await expect(go).toBeEnabled()
    await page.screenshot({ path: `${SHOTS}/07-danger-confirm.png`, animations: "disabled" })
    await page.keyboard.press("Escape")
    expect(errors).toEqual([])
  })
})

test.describe("门槛截图（1280，浅色和深色）", () => {
  for (const scheme of ["light", "dark"] as const) {
    test(`${scheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme })
      await openMounts(page)
      await page.screenshot({ path: `${GATE}/mounts-board-${scheme}-1280.png`, animations: "disabled" })

      await card(page, "OpenPet-Desktop").getByRole("button", { name: "以此视角查看" }).click()
      await page.getByRole("menuitem", { name: "通用 .agents（Codex 等）" }).click()
      await expect(page.getByText("可见 2 个 Skill")).toBeVisible()
      // 横幅把看板往下推，Motion 的 layout 动画（芯片）不受 animations: "disabled" 控制，等它结束
      await page.waitForTimeout(400)
      await page.screenshot({ path: `${GATE}/mounts-lens-${scheme}-1280.png`, animations: "disabled" })
      await page.getByRole("button", { name: "退出视角" }).click()

      await page.getByRole("button", { name: "矩阵" }).click()
      await expect(page.getByRole("switch").first()).toBeVisible()
      await page.screenshot({ path: `${GATE}/mounts-matrix-${scheme}-1280.png`, animations: "disabled" })

      await page.keyboard.press("Control+2")
      await page.getByRole("button", { name: "vps-hk-edge" }).click()
      await expect(page.getByText("没有发现问题")).toBeVisible()
      await page.screenshot({ path: `${GATE}/skills-${scheme}-1280.png`, animations: "disabled" })

      await page.keyboard.press("Control+4")
      await expect(page.getByRole("heading", { level: 2, name: "今天" })).toBeVisible()
      await page.screenshot({ path: `${GATE}/activity-${scheme}-1280.png`, animations: "disabled" })

      await page.keyboard.press("Control+5")
      await page.getByRole("button", { name: /Agent 目标/ }).click()
      await expect(page.getByRole("heading", { level: 2, name: "Agent 目标" })).toBeVisible()
      await page.screenshot({ path: `${GATE}/settings-${scheme}-1280.png`, animations: "disabled" })
    })
  }
})
