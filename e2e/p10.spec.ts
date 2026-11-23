// P10 验收测试与截图（P10a 移除生产标识、P10b 服务器单名称体验、P10c 居中宽 Skill 预览 + 左侧文件树）
import { expect, test } from "@playwright/test"

import { collectConsoleErrors, detailTitle, inspector, openServer, ready, row, shot } from "./helpers"

test.describe("P10 验收：移除生产、单名称体验、居中宽 Skill 预览", () => {
  test("资源列表（1000×680 浅/深色）：单名称、自然排序、无生产标记、自动运维中性样式", async ({ page }) => {
    const errors = collectConsoleErrors(page)
    await page.setViewportSize({ width: 1000, height: 680 })
    await page.emulateMedia({ colorScheme: "light" })
    await ready(page)

    const list = page.locator("#server-list")
    await expect(list.getByText("生产", { exact: true })).toHaveCount(0)
    await expect(list.getByText("hk-edge", { exact: true })).toHaveCount(0)
    await expect(list.getByText("sg-db", { exact: true })).toHaveCount(0)
    await expect(list.getByText("dev-box", { exact: true })).toHaveCount(0)

    // 组内按名称自然排序：开发机 → 香港边缘节点 → 新加坡数据库；Cloudflare → GitHub → Vercel
    const serverHandles = await page.locator("#group-servers ~ div [data-grid-cell]").evaluateAll((els) => els.map((e) => e.getAttribute("data-handle")))
    expect(serverHandles).toEqual(["dev-box", "hk-edge", "sg-db"])
    const cliHandles = await page.locator("#group-clis ~ div [data-grid-cell]").evaluateAll((els) => els.map((e) => e.getAttribute("data-handle")))
    expect(cliHandles).toEqual(["cloudflare", "github", "vercel"])

    const autoMode = page.getByRole("button", { name: /^新加坡数据库 的档位：自动运维$/ })
    await expect(autoMode).toBeVisible()
    await expect(autoMode).not.toHaveClass(/text-warning/)
    await shot(page, "p10-list-light-1000")

    await page.emulateMedia({ colorScheme: "dark" })
    await shot(page, "p10-list-dark-1000")
    expect(errors).toEqual([])
  })

  test("服务器详情与切自动运维轻确认（1000×680）：单名称标题、两行 Agent 权限、连接组 SSH Host", async ({ page }) => {
    const errors = collectConsoleErrors(page)
    await page.setViewportSize({ width: 1000, height: 680 })
    await page.emulateMedia({ colorScheme: "light" })
    await ready(page)

    // 资源行档位菜单轻确认（不含生产字样）
    await page.getByRole("button", { name: /^香港边缘节点 的档位：确认变更$/ }).click()
    const menu = page.getByRole("menu")
    await menu.getByRole("menuitemradio", { name: /^自动运维/ }).click()
    await expect(menu.getByRole("alert")).toContainText("为 香港边缘节点 启用自动运维")
    await expect(menu.getByRole("alert")).not.toContainText("生产")
    await shot(page, "p10-mode-confirm-row-light-1000")
    await page.keyboard.press("Escape")

    // 服务器详情：仅显示名称，Agent 权限只有执行模式与给哪些 Agent，连接组含 SSH Host
    await openServer(page, "hk-edge")
    const panel = inspector(page)
    await expect(detailTitle(page)).toHaveText("香港边缘节点")
    await expect(panel.locator("header").getByText("hk-edge", { exact: true })).toHaveCount(0)
    await expect(panel.getByRole("switch", { name: "生产环境" })).toHaveCount(0)
    const permSection = panel.locator("section").filter({ has: page.locator("#detail-permission") })
    const connSection = panel.locator("section").filter({ has: page.locator("#detail-connection") })
    await expect(permSection.getByText("执行模式", { exact: true })).toBeVisible()
    await expect(connSection.getByText("SSH Host", { exact: true })).toBeVisible()
    await expect(connSection.getByText("hk-edge", { exact: true })).toBeVisible()
    await shot(page, "p10-detail-light-1000")

    // 详情分段切换触发轻确认弹窗
    await panel.getByRole("button", { name: "自动运维", exact: true }).click()
    const confirm = page.getByRole("alertdialog", { name: "为 香港边缘节点 启用自动运维？" })
    await expect(confirm).toBeVisible()
    await expect(confirm).not.toContainText("生产")
    await shot(page, "p10-mode-confirm-dialog-light-1000")
    await confirm.getByRole("button", { name: "取消", exact: true }).click()
    await expect(confirm).toHaveCount(0)
    expect(errors).toEqual([])
  })

  test("居中宽 Skill 预览（1000×680 浅/深色、Frontmatter 折叠/展开、Lint 警告态与正常隐身态）", async ({ page }) => {
    const errors = collectConsoleErrors(page)
    await page.setViewportSize({ width: 1000, height: 680 })
    await page.emulateMedia({ colorScheme: "light" })
    await ready(page)

    // 打开总 Skill 预览（Claude Code Windows 包含 sg-db 的疑似注入警告）
    await page.keyboard.press("Control+Backslash")
    const dialog = page.getByRole("dialog", { name: "预览 Skill" })
    await expect(dialog).toBeVisible()

    // 宽弹窗尺寸、单行顶栏、左侧文件树、无横向溢出
    const box = await dialog.boundingBox()
    expect(box?.width).toBeGreaterThanOrEqual(880)
    expect(box?.height).toBeGreaterThanOrEqual(560)
    const headerHeight = await dialog.locator("header").evaluate((el) => el.getBoundingClientRect().height)
    expect(headerHeight).toBeLessThanOrEqual(52)

    const tree = dialog.getByRole("navigation", { name: "文件" })
    await expect(tree).toBeVisible()
    await expect(tree.getByRole("button", { name: /^SKILL\.md/ })).toHaveAttribute("aria-current", "page")
    await expect(tree.getByRole("button", { name: /^hk-edge\.md/ })).toBeVisible()
    await expect(tree.getByRole("button", { name: /^sg-db\.md.*警告/ })).toBeVisible()
    // P10d：SKILL.md 自身无告警时不跨文件霸屏；左下角仅展示安静字数参考与告警计数入口
    await expect(dialog.locator("#preview-lint-heading")).toHaveCount(0)
    await expect(dialog.getByRole("complementary").getByText(/\d+ 字 · \d+ 行/)).toBeVisible()
    await expect(dialog.getByRole("complementary").getByRole("button", { name: /1 警告/ })).toBeVisible()
    // Frontmatter 默认折叠
    const fmTrigger = dialog.getByRole("button", { name: "展开或收起 YAML 元信息" })
    await expect(fmTrigger).toHaveAttribute("aria-expanded", "false")
    await shot(page, "p10-preview-wide-light-1000")

    // 深色主题
    await page.emulateMedia({ colorScheme: "dark" })
    await shot(page, "p10-preview-wide-dark-1000")
    await page.emulateMedia({ colorScheme: "light" })

    // 展开 Frontmatter
    await fmTrigger.click()
    await expect(fmTrigger).toHaveAttribute("aria-expanded", "true")
    await expect(dialog.getByText(/name: cloudlink-servers/)).toBeVisible()
    await shot(page, "p10-preview-frontmatter-open-light-1000")

    // 切到 Cursor（Windows）目标（只含 hk-edge，无 warning/error）：正常即隐身，去掉进度条和「检查通过」
    await dialog.getByRole("combobox", { name: "Agent 与运行环境" }).click()
    await page.getByRole("option", { name: /Cursor/ }).click()
    await expect(dialog.getByRole("complementary").getByText(/\d+ 字 · \d+ 行/)).toBeVisible()
    await expect(dialog.getByRole("complementary").getByText("检查通过")).toHaveCount(0)
    await expect(dialog.getByRole("progressbar")).toHaveCount(0)
    await expect(dialog.locator("#preview-lint-heading")).toHaveCount(0)
    await tree.getByRole("button", { name: /^hk-edge\.md/ }).click()
    await expect(tree.getByRole("button", { name: /^hk-edge\.md/ })).toHaveAttribute("aria-current", "page")
    // 确认无横向撑爆
    const overflow = await dialog.evaluate((el) => el.scrollWidth > el.clientWidth + 1)
    expect(overflow).toBe(false)
    await shot(page, "p10-preview-detail-clean-light-1000")

    // Esc 关闭回到原位
    await page.keyboard.press("Escape")
    await expect(dialog).toHaveCount(0)
    await expect(row(page, "hk-edge")).toBeVisible()
    expect(errors).toEqual([])
  })

  test("窄窗 Skill 预览（760×520 浅/深色）：左侧文件树退化为顶栏文件下拉、无裁切溢出", async ({ page }) => {
    const errors = collectConsoleErrors(page)
    await page.setViewportSize({ width: 760, height: 520 })
    await page.emulateMedia({ colorScheme: "light" })
    await ready(page)

    await openServer(page, "hk-edge")
    await inspector(page).locator("[data-detail-more]").click()
    await page.getByRole("menuitem", { name: "预览 Skill", exact: true }).click()

    const dialog = page.getByRole("dialog", { name: "预览 Skill" })
    await expect(dialog).toBeVisible()
    // 窄窗下隐藏左侧目录树，顶栏显示文件下拉且默认选中 hk-edge.md
    await expect(dialog.getByRole("navigation", { name: "文件" })).toBeHidden()
    const fileSelect = dialog.getByRole("combobox", { name: "文件" })
    await expect(fileSelect).toBeVisible()
    await expect(fileSelect).toContainText("hk-edge.md")
    // 完整目录树里的其他文件也可通过下拉切换
    await fileSelect.click()
    await expect(page.getByRole("option", { name: /SKILL\.md/ })).toBeVisible()
    await expect(page.getByRole("option", { name: /sg-db\.md/ })).toBeVisible()
    await page.getByRole("option", { name: /SKILL\.md/ }).click()
    await expect(fileSelect).toContainText("SKILL.md")

    const headerHeight = await dialog.locator("header").evaluate((el) => el.getBoundingClientRect().height)
    expect(headerHeight).toBeLessThanOrEqual(52)
    const overflow = await dialog.evaluate((el) => el.scrollWidth > el.clientWidth + 1)
    expect(overflow).toBe(false)
    await shot(page, "p10-preview-narrow-light-760")

    await page.emulateMedia({ colorScheme: "dark" })
    await shot(page, "p10-preview-narrow-dark-760")
    expect(errors).toEqual([])
  })
})
