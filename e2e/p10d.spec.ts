// P10d 验收测试与截图：去进度条与「检查通过」、按文件归属展示告警、一键直达编辑弹窗与「查看位置」
import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { expect, test, type Page } from "@playwright/test"

import { collectConsoleErrors, detailTitle, inspector, openServer, ready } from "./helpers"

const SHOT_DIR = join(process.cwd(), "test-results", "p10d")

async function saveShot(page: Page, name: string) {
  mkdirSync(SHOT_DIR, { recursive: true })
  await page.screenshot({ path: join(SHOT_DIR, `${name}.png`) })
}

test.describe("P10d 验收：Skill 预览降噪、按文件归属告警与一键直达修复", () => {
  test("干净无告警预览态（1000×680 与 760×520，浅/深色）：无进度条、无「检查通过」、安静字数参考", async ({ page }) => {
    const errors = collectConsoleErrors(page)
    await page.setViewportSize({ width: 1000, height: 680 })
    await page.emulateMedia({ colorScheme: "light" })
    await ready(page)

    await page.keyboard.press("Control+Backslash")
    const dialog = page.getByRole("dialog", { name: "预览 Skill" })
    await expect(dialog).toBeVisible()

    // 切换到 Cursor（Windows）目标（仅含 hk-edge，无任何安全告警）
    await dialog.getByRole("combobox", { name: "Agent 与运行环境" }).click()
    await page.getByRole("option", { name: /Cursor/ }).click()

    const aside = dialog.getByRole("complementary")
    await expect(aside.getByText(/\d+ 字 · \d+ 行/)).toBeVisible()
    await expect(dialog.getByRole("progressbar")).toHaveCount(0)
    await expect(dialog.getByText("检查通过")).toHaveCount(0)
    await expect(dialog.locator("#preview-lint-heading")).toHaveCount(0)
    expect(await dialog.evaluate((el) => el.scrollWidth > el.clientWidth + 1)).toBe(false)
    await saveShot(page, "p10d-clean-wide-light-1000")

    await page.emulateMedia({ colorScheme: "dark" })
    await saveShot(page, "p10d-clean-wide-dark-1000")

    // 窄窗 760×520 降级态（浅/深色）
    await page.setViewportSize({ width: 760, height: 520 })
    await page.emulateMedia({ colorScheme: "light" })
    await expect(dialog.getByRole("navigation", { name: "文件" })).toBeHidden()
    await expect(dialog.getByRole("combobox", { name: "文件" })).toBeVisible()
    await expect(dialog.getByRole("progressbar")).toHaveCount(0)
    await expect(dialog.getByText(/\d+ 字 · \d+ 行/).last()).toBeVisible()
    expect(await dialog.evaluate((el) => el.scrollWidth > el.clientWidth + 1)).toBe(false)
    await saveShot(page, "p10d-clean-narrow-light-760")

    await page.emulateMedia({ colorScheme: "dark" })
    await saveShot(page, "p10d-clean-narrow-dark-760")
    expect(errors).toEqual([])
  })

  test("按文件过滤告警 + 一键直达「去编辑资料」「导出设置」「查看资源」与次要「查看位置」", async ({ page }) => {
    const errors = collectConsoleErrors(page)
    await page.setViewportSize({ width: 1000, height: 680 })
    await page.emulateMedia({ colorScheme: "light" })
    await ready(page)

    // 给香港边缘节点写入未开启导出的 IP（203.0.113.10），触发 export-disabled-field 错误
    await openServer(page, "hk-edge")
    await inspector(page).locator("[data-detail-more]").click()
    await page.getByRole("menuitem", { name: "编辑资料", exact: true }).click()
    const profileDialog = page.getByRole("dialog", { name: "编辑资料" })
    await expect(profileDialog).toBeVisible()
    await profileDialog.getByLabel("笔记").fill("Origin IP is 203.0.113.10")
    await profileDialog.getByRole("button", { name: "保存修改" }).click()
    await expect(profileDialog).toHaveCount(0)

    // 切到 Agent 页再打开预览（验证跨视图一键直达编辑弹窗）
    await page.keyboard.press("Control+2")
    await expect(page.getByRole("heading", { level: 3, name: "已检测到" })).toBeVisible()
    await page.getByRole("button", { name: "预览 Skill" }).click()

    const dialog = page.getByRole("dialog", { name: "预览 Skill" })
    await expect(dialog).toBeVisible()
    const tree = dialog.getByRole("navigation", { name: "文件" })

    // 1. 当前在 SKILL.md：正文区干净无跨文件霸屏；左侧树标记 hk-edge.md（错误）与 sg-db.md（警告）
    await expect(tree.getByRole("button", { name: /^SKILL\.md/ })).toHaveAttribute("aria-current", "page")
    await expect(dialog.locator("#preview-lint-heading")).toHaveCount(0)
    await expect(tree.getByRole("button", { name: /^hk-edge\.md.*错误/ })).toBeVisible()
    await expect(tree.getByRole("button", { name: /^sg-db\.md.*警告/ })).toBeVisible()
    await saveShot(page, "p10d-lint-skill-clean-light-1000")

    // 2. 点击左下角错误计数 → 跳到 hk-edge.md，顶部显示「去编辑资料」「导出设置」「查看位置」
    await dialog.getByRole("complementary").getByRole("button", { name: /1 错误 · 1 警告/ }).click()
    await expect(tree.getByRole("button", { name: /^hk-edge\.md/ })).toHaveAttribute("aria-current", "page")
    await expect(dialog.getByText(/已关闭导出的「HostName」出现在 香港边缘节点/)).toBeVisible()
    await expect(dialog.getByRole("button", { name: "去编辑资料" })).toBeVisible()
    await expect(dialog.getByRole("button", { name: "导出设置" })).toBeVisible()
    await expect(dialog.getByRole("button", { name: "查看位置" })).toBeVisible()
    await saveShot(page, "p10d-lint-file-error-light-1000")

    await page.emulateMedia({ colorScheme: "dark" })
    await saveShot(page, "p10d-lint-file-error-dark-1000")
    await page.emulateMedia({ colorScheme: "light" })

    // 3. 点击「查看位置」才切源码高亮行
    await dialog.getByRole("button", { name: "查看位置" }).click()
    await expect(dialog.locator('[data-slot="code-block-line"][aria-current="true"]')).toContainText("203.0.113.10")

    // 4. 切到 sg-db.md：探测来源疑似注入给出「查看资源」+「查看位置」
    await tree.getByRole("button", { name: /^sg-db\.md/ }).click()
    await dialog.getByRole("button", { name: "渲染", exact: true }).click()
    await expect(dialog.getByText(/新加坡数据库 的服务器探测结果中出现「ignore-previous-instructions」/)).toBeVisible()
    await expect(dialog.getByRole("button", { name: "查看资源" })).toBeVisible()
    await saveShot(page, "p10d-lint-probe-warning-light-1000")

    // 5. 回到 hk-edge.md，点「去编辑资料」→ 关闭预览、跨视图跳转香港边缘节点并自动弹出「编辑资料」
    await tree.getByRole("button", { name: /^hk-edge\.md/ }).click()
    await dialog.getByRole("button", { name: "去编辑资料" }).click()
    await expect(dialog).toHaveCount(0)
    await expect(detailTitle(page)).toHaveText("香港边缘节点")
    const reopenedProfile = page.getByRole("dialog", { name: "编辑资料" })
    await expect(reopenedProfile).toBeVisible()
    await reopenedProfile.getByRole("button", { name: "取消" }).click()
    await expect(reopenedProfile).toHaveCount(0)

    // 6. 再次从 Agent 页打开预览，跳到 hk-edge.md 点「导出设置」→ 关闭预览并自动弹出「编辑连接」
    await page.keyboard.press("Control+2")
    await page.getByRole("button", { name: "预览 Skill" }).click()
    await expect(dialog).toBeVisible()
    await dialog.getByRole("navigation", { name: "文件" }).getByRole("button", { name: /^hk-edge\.md/ }).click()
    await dialog.getByRole("button", { name: "导出设置" }).click()
    await expect(dialog).toHaveCount(0)
    await expect(detailTitle(page)).toHaveText("香港边缘节点")
    const connDialog = page.getByRole("dialog", { name: /编辑连接|连接信息/ })
    await expect(connDialog).toBeVisible()
    await connDialog.getByRole("button", { name: "取消" }).click()
    await expect(connDialog).toHaveCount(0)

    // 7. 打开预览切到 sg-db.md 点「查看资源」→ 关闭预览并打开新加坡数据库详情
    await page.keyboard.press("Control+Backslash")
    await expect(dialog).toBeVisible()
    await dialog.getByRole("navigation", { name: "文件" }).getByRole("button", { name: /^sg-db\.md/ }).click()
    await dialog.getByRole("button", { name: "查看资源" }).click()
    await expect(dialog).toHaveCount(0)
    await expect(detailTitle(page)).toHaveText("新加坡数据库")
    expect(errors).toEqual([])
  })
})
