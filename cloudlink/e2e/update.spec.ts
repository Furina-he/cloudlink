import { expect, test, type Page } from "@playwright/test"

import { collectConsoleErrors, inspector, openServer, ready } from "./helpers"

// 检测更新（F-406，PRD 6.15）：magpie 式，发现新版本就在后台下载，下好才在顶栏提醒；按钮只写「更新」。
// 提醒、对话框、后台下载、失败重试、等待任务和设置开关。状态截图是验收证据，不随提交
const SHOTS = "../test-results/p6"

const reminder = (page: Page) => page.getByRole("banner").getByRole("button", { name: /新版本|下载失败|正在安装/ })
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
    await page.getByRole("combobox").fill("更新")
    await expect(page.getByRole("option", { name: /重启以更新/ })).toHaveCount(0)
    expect(errors).toEqual([])
  })

  test("AC1：下好之后各视图的顶栏右侧都有提醒，按钮只写「更新」；不抢焦点、不弹 Toast，只播报一次", async ({ page }) => {
    const errors = collectConsoleErrors(page)
    await ready(page, "?update=available")
    await expect(reminder(page)).toHaveAccessibleName("有新版本 0.2.0，查看并更新")
    await expect(reminder(page)).toHaveText("更新")
    await expect(reminder(page)).not.toBeFocused()
    await expect(page.getByRole("banner").locator("[aria-live=polite]")).toHaveText("有新版本 0.2.0")
    await expect(page.locator("[data-slot=toast]")).toHaveCount(0)
    // 版本号在悬停提示里
    await reminder(page).hover()
    await expect(page.locator("[data-slot=tooltip-content]")).toHaveText("有新版本 0.2.0")
    for (const view of ["Control+2", "Control+3", "Control+4", "Control+1"]) {
      await page.keyboard.press(view)
      await expect(reminder(page)).toBeVisible()
    }
    expect(errors).toEqual([])
  })

  test("后台下载期间顶栏什么都不显示，进度只在设置里；下好后提醒才出现", async ({ page }) => {
    const errors = collectConsoleErrors(page)
    await ready(page, "?update=downloading")
    await page.keyboard.press("Control+4")
    await expect(page.getByText(/^正在下载 0\.2\.0… \d+%$/)).toBeVisible()
    await expect(reminder(page)).toHaveCount(0)
    await shot(page, "update-background-download-900")
    await expect(page.getByText("0.2.0 已下载好，重启即可更新")).toBeVisible({ timeout: 10_000 })
    await expect(reminder(page)).toHaveText("更新")
    expect(errors).toEqual([])
  })

  test("窗口宽度不够时只留图标，版本号在 Tooltip 里，顶栏不换行", async ({ page }) => {
    await page.setViewportSize({ width: 760, height: 520 })
    await ready(page, "?update=available")
    await expect(reminder(page)).toHaveAccessibleName("有新版本 0.2.0，查看并更新")
    await expect(reminder(page)).toHaveText("")
    const header = page.getByRole("banner")
    expect(await header.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
    await reminder(page).hover()
    await expect(page.locator("[data-slot=tooltip-content]")).toHaveText("有新版本 0.2.0")
    await shot(page, "update-tooltip-760")
  })

  test("顶栏的更新提醒不会盖住居中的导航：760–1000 各宽度、搜索展开时都互不重叠", async ({ page }) => {
    await ready(page, "?update=available")
    const nav = page.getByRole("banner").getByRole("navigation")
    const gap = async () => {
      const a = await nav.boundingBox()
      const b = await reminder(page).boundingBox()
      return b!.x - (a!.x + a!.width)
    }
    for (const width of [760, 880, 900, 940, 1000]) {
      await page.setViewportSize({ width, height: 640 })
      expect(await gap(), `${width}px`).toBeGreaterThanOrEqual(8)
    }
    await page.setViewportSize({ width: 900, height: 640 })
    await page.keyboard.press("Control+f")
    expect(await gap()).toBeGreaterThanOrEqual(8)
    expect(await page.getByRole("banner").evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
  })

  test("AC2：对话框显示版本、日期和纯文本说明；焦点落在「重启以更新」；「稍后」只关闭对话框", async ({ page }) => {
    const errors = collectConsoleErrors(page)
    await ready(page, "?update=available")
    await openDialog(page)
    await expect(dialog(page).getByText("当前版本 0.1.0 · 发布于 2026-11-20")).toBeVisible()
    await expect(button(page, "重启以更新")).toBeFocused()
    await expect(dialog(page).getByText("安装时 CloudLink 会自动关闭并重新打开；护栏和已分发的 Skill 照常工作。")).toBeVisible()
    // 已经下好，对话框里没有进度条，也没有取消下载
    await expect(dialog(page).getByRole("progressbar")).toHaveCount(0)
    await expect(dialog(page).getByRole("button", { name: /取消/ })).toHaveCount(0)
    // 说明不在签名范围内：Markdown 和链接都原样显示，没有可点击的链接，换行保留
    const notes = dialog(page).locator("[data-slot=scroll-area] p")
    await expect(notes).toContainText("**详情**见 [发布说明](https://example.com/release)")
    await expect(dialog(page).locator("a")).toHaveCount(0)
    expect(await notes.evaluate((el) => getComputedStyle(el).whiteSpace)).toBe("pre-wrap")
    await button(page, "稍后").click()
    await expect(dialog(page)).toHaveCount(0)
    await expect(reminder(page)).toBeFocused()
    await expect(reminder(page)).toHaveText("更新")
    expect(errors).toEqual([])
  })

  test("命令面板的「系统」组有「重启以更新到 0.2.0」，打开同一个对话框", async ({ page }) => {
    await ready(page, "?update=available")
    await page.keyboard.press("Control+k")
    await page.getByRole("combobox").fill("重启以更新")
    await page.getByRole("option", { name: "重启以更新到 0.2.0" }).click()
    await expect(dialog(page)).toBeVisible()
    await expect(button(page, "重启以更新")).toBeFocused()
  })

  test("AC5：「重启以更新」进入「正在安装」并写一条活动记录；安装时只留一句提示，对话框关不掉", async ({ page }) => {
    await ready(page, "?update=available")
    await openDialog(page)
    await button(page, "重启以更新").click()
    await expect(dialog(page).locator("[aria-live=polite]")).toHaveText("正在安装。CloudLink 即将关闭并重新打开。")
    await expect(button(page, "正在安装")).toBeDisabled()
    // 两句意思相同的提示只留一句；「稍后」、关闭按钮和 Esc 都不能关掉对话框
    await expect(dialog(page).getByText("安装时 CloudLink 会自动关闭并重新打开；护栏和已分发的 Skill 照常工作。")).toHaveCount(0)
    await expect(button(page, "稍后")).toBeDisabled()
    await expect(dialog(page).getByRole("button", { name: "关闭" })).toHaveCount(0)
    await page.keyboard.press("Escape")
    await expect(dialog(page)).toBeVisible()
    await shot(page, "update-installing-900")

    const activity = await page.evaluate(() =>
      (window as unknown as { __TAURI_INTERNALS__: { invoke: (cmd: string, args: unknown) => Promise<{ messageId: string; params: unknown }[]> } }).__TAURI_INTERNALS__.invoke("list_activity", {
        q: { limit: 10, kinds: ["update"] },
      })
    )
    expect(activity.map((a) => [a.messageId, a.params])).toEqual([["update-installing", { from: "0.1.0", to: "0.2.0" }]])
  })

  test("AC3：后台下载的签名校验失败时丢弃安装包，提醒出现，写清原因；「重试」重新下载并显示进度", async ({ page }) => {
    await ready(page, "?update=signature")
    await expect(reminder(page)).toHaveAccessibleName("0.2.0 下载失败，查看详情", { timeout: 10_000 })
    await expect(reminder(page)).toHaveText("更新")
    await openDialog(page)
    const alert = dialog(page).locator("[data-slot=alert]")
    await expect(alert).toContainText("更新失败")
    await expect(alert).toContainText("安装包签名校验失败，已丢弃。请稍后重试，或到 GitHub Releases 手动下载。")
    await expect(dialog(page).locator("[aria-live=polite]")).toContainText("安装包签名校验失败")
    await shot(page, "update-signature-failed-900")

    await button(page, "重试").click()
    await expect(dialog(page).getByRole("progressbar")).toBeVisible()
    await expect(dialog(page).getByText(/^已下载 .+ \/ 8\.5 MB$/)).toBeVisible()
    await expect(alert).toHaveCount(0)
    await expect(button(page, "重启以更新")).toBeDisabled()
    await expect(button(page, "重启以更新")).toBeEnabled({ timeout: 10_000 })
    await expect(dialog(page).getByRole("progressbar")).toHaveCount(0)
  })

  test("AC4：后端说正在发布时不开始安装，说明在等什么；再点一次就开始", async ({ page }) => {
    await ready(page, "?update=busy")
    await openDialog(page)
    await button(page, "重启以更新").click()
    await expect(dialog(page).locator("[aria-live=polite]")).toHaveText("正在发布 Skill，结束后再安装")
    await expect(dialog(page).locator("[data-slot=alert]")).toHaveCount(0)
    await button(page, "重启以更新").click()
    await expect(button(page, "正在安装")).toBeDisabled()
  })

  test("AC4：探测进行中时「重启以更新」不可用并说明在等谁，探测结束后恢复；焦点落在「稍后」", async ({ page }) => {
    await ready(page, "?update=available")
    await openServer(page, "hk-edge")
    await inspector(page).getByRole("button", { name: "重新探测", exact: true }).click()
    await page.keyboard.press("Escape")
    await expect(page.getByRole("dialog", { name: /探测/ })).toHaveCount(0)
    await openDialog(page)
    await expect(button(page, "重启以更新")).toBeDisabled()
    await expect(button(page, "稍后")).toBeFocused()
    await expect(dialog(page).locator("[aria-live=polite]")).toHaveText("正在探测 hk-edge，结束后再安装")
    await shot(page, "update-waiting-900")
    await expect(button(page, "重启以更新")).toBeEnabled({ timeout: 10_000 })
    await expect(dialog(page).locator("[aria-live=polite]")).toHaveText("")
  })

  test("AC6：关闭开关立即隐藏提醒，重新打开时立即检查一次；通用分区显示当前版本和下载状态", async ({ page }) => {
    await ready(page, "?update=available")
    await page.keyboard.press("Control+4")
    await expect(page.getByText("当前 v0.1.0")).toBeVisible()
    await expect(page.getByText("0.2.0 已下载好，重启即可更新")).toBeVisible()
    const toggle = page.getByRole("switch", { name: "自动下载更新" })
    await expect(toggle).toBeChecked()
    await expect(page.getByText("有新版本时在后台下载好，重启后生效")).toBeVisible()
    await expect(page.getByRole("button", { name: /立即检查/ })).toHaveCount(0)

    await toggle.click()
    await expect(toggle).not.toBeChecked()
    await expect(reminder(page)).toHaveCount(0)
    await expect(page.getByText("0.2.0 已下载好，重启即可更新")).toHaveCount(0)
    await expect(page.getByText("当前 v0.1.0")).toBeVisible()

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
    for (const name of ["稍后", "重启以更新"]) await expect(button(page, name)).toBeInViewport({ ratio: 1 })
    await shot(page, "update-long-notes-760")
  })
})
