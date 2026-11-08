import { expect, test, type Page } from "@playwright/test"

import { collectConsoleErrors, inspector, openServer, ready } from "./helpers"

// 检测更新（F-406，PRD 6.13）：正常即隐身；提醒、对话框、下载、取消、失败、等待任务和设置开关。状态截图是验收证据，不随提交
const SHOTS = "../test-results/p6"

const reminder = (page: Page) => page.getByRole("banner").getByRole("button", { name: /新版本|下载中|正在安装/ })
const dialog = (page: Page) => page.getByRole("dialog", { name: "新版本 0.2.0" })
const button = (page: Page, name: string) => dialog(page).getByRole("button", { name, exact: true })
const shot = (page: Page, name: string) => page.screenshot({ path: `${SHOTS}/${name}.png`, animations: "disabled" })

async function openDialog(page: Page) {
  await reminder(page).click()
  await expect(dialog(page)).toBeVisible()
}

test.describe("检测更新", () => {
  test("AC1：没有新版本时，界面上没有任何更新元素，顶栏也不占位", async ({ page }) => {
    const errors = collectConsoleErrors(page)
    await ready(page)
    await expect(reminder(page)).toHaveCount(0)
    await page.keyboard.press("Control+k")
    await page.getByRole("combobox").fill("安装更新")
    await expect(page.getByRole("option", { name: /安装更新/ })).toHaveCount(0)
    expect(errors).toEqual([])
  })

  test("AC1：发现新版本后，各视图的顶栏右侧都有提醒；不抢焦点、不弹 Toast，只播报一次", async ({ page }) => {
    const errors = collectConsoleErrors(page)
    await ready(page, "?update=available")
    await expect(reminder(page)).toHaveAccessibleName("有新版本 0.2.0，查看并更新")
    await expect(reminder(page)).toHaveText("新版本 0.2.0")
    await expect(reminder(page)).not.toBeFocused()
    await expect(page.getByRole("banner").locator("[aria-live=polite]")).toHaveText("有新版本 0.2.0")
    await expect(page.locator("[data-slot=toast]")).toHaveCount(0)
    for (const view of ["Control+2", "Control+3", "Control+4", "Control+1"]) {
      await page.keyboard.press(view)
      await expect(reminder(page)).toBeVisible()
    }
    expect(errors).toEqual([])
  })

  test("窗口宽度不够时只留图标，文字放进 Tooltip，顶栏不换行", async ({ page }) => {
    await page.setViewportSize({ width: 760, height: 520 })
    await ready(page, "?update=available")
    await expect(reminder(page)).toHaveAccessibleName("有新版本 0.2.0，查看并更新")
    await expect(reminder(page)).toHaveText("")
    const header = page.getByRole("banner")
    expect(await header.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
    await reminder(page).hover()
    await expect(page.locator("[data-slot=tooltip-content]")).toHaveText("新版本 0.2.0")
    await shot(page, "update-tooltip-760")
  })

  test("AC2：对话框显示版本、日期和纯文本说明；焦点落在「下载并安装」；「稍后」只关闭对话框", async ({ page }) => {
    const errors = collectConsoleErrors(page)
    await ready(page, "?update=available")
    await openDialog(page)
    await expect(dialog(page).getByText("当前版本 0.1.0 · 发布于 2026-11-20")).toBeVisible()
    await expect(button(page, "下载并安装")).toBeFocused()
    await expect(dialog(page).getByText("安装时 CloudLink 会自动关闭并重新打开；护栏和已分发的 Skill 照常工作。")).toBeVisible()
    // 说明不在签名范围内：Markdown 和链接都原样显示，没有可点击的链接，换行保留
    const notes = dialog(page).locator("[data-slot=scroll-area] p")
    await expect(notes).toContainText("**详情**见 [发布说明](https://example.com/release)")
    await expect(dialog(page).locator("a")).toHaveCount(0)
    expect(await notes.evaluate((el) => getComputedStyle(el).whiteSpace)).toBe("pre-wrap")
    await button(page, "稍后").click()
    await expect(dialog(page)).toHaveCount(0)
    await expect(reminder(page)).toBeFocused()
    await expect(reminder(page)).toHaveText("新版本 0.2.0")
    expect(errors).toEqual([])
  })

  test("命令面板的「系统」组有「安装更新 0.2.0」，打开同一个对话框", async ({ page }) => {
    await ready(page, "?update=available")
    await page.keyboard.press("Control+k")
    await page.getByRole("combobox").fill("安装更新")
    await page.getByRole("option", { name: "安装更新 0.2.0" }).click()
    await expect(dialog(page)).toBeVisible()
    await expect(button(page, "下载并安装")).toBeFocused()
  })

  test("AC2：下载中显示进度，关掉对话框顶栏也能看到；可以取消，取消后回到有新版本且没有错误", async ({ page }) => {
    const errors = collectConsoleErrors(page)
    await ready(page, "?update=available")
    await openDialog(page)
    await button(page, "下载并安装").click()
    await expect(button(page, "取消下载")).toBeVisible()
    await expect(dialog(page).getByRole("progressbar")).toBeVisible()
    await expect(dialog(page).getByText(/^已下载 .+ MB \/ 8\.5 MB$/)).toBeVisible()

    await button(page, "稍后").click()
    await expect(reminder(page)).toHaveText(/^下载中 \d+%$/)
    await expect(reminder(page)).toHaveAccessibleName(/^下载中 \d+%，查看更新$/)

    await openDialog(page)
    await button(page, "取消下载").click()
    await expect(button(page, "下载并安装")).toBeVisible()
    await expect(dialog(page).getByRole("progressbar")).toHaveCount(0)
    await expect(dialog(page).locator("[data-slot=alert]")).toHaveCount(0)
    // 模态对话框打开时顶栏不在无障碍树里，关掉再看提醒
    await button(page, "稍后").click()
    await expect(reminder(page)).toHaveText("新版本 0.2.0")
    expect(errors).toEqual([])
  })

  test("AC5：下载完成后进入「正在安装」并写一条活动记录", async ({ page }) => {
    await ready(page, "?update=available")
    await openDialog(page)
    await button(page, "下载并安装").click()
    await expect(dialog(page).locator("[aria-live=polite]")).toHaveText("下载完成，正在安装。CloudLink 即将关闭并重新打开。", { timeout: 10_000 })
    await expect(button(page, "正在安装")).toBeDisabled()
    await shot(page, "update-installing-900")

    await button(page, "稍后").click()
    await expect(reminder(page)).toHaveText("正在安装")
    await page.keyboard.press("Control+4")
    await page.getByRole("button", { name: /^活动/ }).click()
    await expect(page.getByText("开始把 CloudLink 从 0.1.0 更新到 0.2.0")).toBeVisible()
  })

  test("AC3：签名校验失败时丢弃安装包，写清原因和下一步，按钮变为「重试」", async ({ page }) => {
    await ready(page, "?update=signature")
    await openDialog(page)
    await button(page, "下载并安装").click()
    const alert = dialog(page).locator("[data-slot=alert]")
    await expect(alert).toContainText("更新失败", { timeout: 10_000 })
    await expect(alert).toContainText("安装包签名校验失败，已丢弃。请稍后重试，或到 GitHub Releases 手动下载。")
    await expect(dialog(page).locator("[aria-live=polite]")).toContainText("安装包签名校验失败")
    await shot(page, "update-signature-failed-900")

    await button(page, "重试").click()
    await expect(button(page, "取消下载")).toBeVisible()
    await expect(alert).toHaveCount(0)
  })

  test("AC4：后端说正在发布时不开始下载，说明在等什么；再点一次就开始", async ({ page }) => {
    await ready(page, "?update=busy")
    await openDialog(page)
    await button(page, "下载并安装").click()
    await expect(dialog(page).locator("[aria-live=polite]")).toHaveText("正在发布 Skill，结束后再安装")
    await expect(dialog(page).locator("[data-slot=alert]")).toHaveCount(0)
    await expect(dialog(page).getByRole("progressbar")).toHaveCount(0)
    await button(page, "重试").click()
    await expect(button(page, "取消下载")).toBeVisible()
  })

  test("AC4：探测进行中时「下载并安装」不可用并说明在等谁，探测结束后恢复；焦点落在「稍后」", async ({ page }) => {
    await ready(page, "?update=available")
    await openServer(page, "hk-edge")
    await inspector(page).getByRole("button", { name: "重新探测", exact: true }).click()
    await page.keyboard.press("Escape")
    await expect(page.getByRole("dialog", { name: /探测/ })).toHaveCount(0)
    await openDialog(page)
    await expect(button(page, "下载并安装")).toBeDisabled()
    await expect(button(page, "稍后")).toBeFocused()
    await expect(dialog(page).locator("[aria-live=polite]")).toHaveText("正在探测 hk-edge，结束后再安装")
    await shot(page, "update-waiting-900")
    await expect(button(page, "下载并安装")).toBeEnabled({ timeout: 10_000 })
    await expect(dialog(page).locator("[aria-live=polite]")).toHaveText("")
  })

  test("AC6：关闭开关立即隐藏提醒，重新打开时立即检查一次；通用分区显示当前版本", async ({ page }) => {
    await ready(page, "?update=available")
    await page.keyboard.press("Control+4")
    await expect(page.getByText("当前版本 0.1.0")).toBeVisible()
    const toggle = page.getByRole("switch", { name: "自动检查更新" })
    await expect(toggle).toBeChecked()
    await expect(page.getByText("启动后和每 24 小时向 GitHub Releases 请求一次版本清单，只读取版本号和更新说明，不上传任何数据。")).toBeVisible()
    await expect(page.getByRole("button", { name: /立即检查/ })).toHaveCount(0)

    await toggle.click()
    await expect(toggle).not.toBeChecked()
    await expect(reminder(page)).toHaveCount(0)
    await expect(page.getByText("当前版本 0.1.0")).toBeVisible()

    await toggle.click()
    await expect(reminder(page)).toBeVisible()
  })

  test("不可信的长说明不能撑开对话框：最矮的窗口里按钮仍在窗口内", async ({ page }) => {
    await page.setViewportSize({ width: 760, height: 520 })
    await ready(page, "?update=long")
    await openDialog(page)
    const notes = dialog(page).locator("[data-slot=scroll-area-viewport]")
    expect(await notes.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
    expect(await notes.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true)
    const box = (await dialog(page).boundingBox())!
    expect(box.y).toBeGreaterThanOrEqual(0)
    expect(box.y + box.height).toBeLessThanOrEqual(520)
    expect(box.width).toBeLessThanOrEqual(448)
    for (const name of ["稍后", "下载并安装"]) await expect(button(page, name)).toBeInViewport({ ratio: 1 })
    await shot(page, "update-long-notes-760")
  })
})
