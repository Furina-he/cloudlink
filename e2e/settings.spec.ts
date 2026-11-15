import { expect, test, type Page } from "@playwright/test"

import { collectConsoleErrors, openServer, ready, shot, toastText } from "./helpers"

// 设置视图（PRD 6.8，v0.2：一页的分组列表）与动态视图（6.7：等你确认、操作记录）

async function openSettings(page: Page) {
  await ready(page)
  await page.keyboard.press("Control+4")
  await expect(page.getByRole("heading", { level: 3, name: "外观" })).toBeVisible()
}

async function openActivity(page: Page) {
  await ready(page)
  await page.keyboard.press("Control+3")
  await expect(page.getByRole("heading", { name: "操作记录" })).toBeVisible()
}

test.describe("设置视图", () => {
  test("一页往下滚：外观、启动与托盘、数据、危险操作，最后是收起的「高级」", async ({ page }) => {
    const errors = collectConsoleErrors(page)
    await openSettings(page)
    for (const g of ["外观", "启动与托盘", "数据", "危险操作"]) {
      await expect(page.getByRole("heading", { level: 3, name: g })).toBeAttached()
    }
    for (const g of ["连接", "编译"]) {
      await expect(page.getByRole("heading", { level: 3, name: g, exact: true })).toHaveCount(0)
    }
    await expect(page.getByText("当前 v0.1.0")).toBeVisible()
    // 「高级」默认收起，纯键盘展开和收起
    const advanced = page.getByRole("region", { name: "高级" }).getByRole("button", { name: /^高级/ })
    await expect(advanced).toHaveAttribute("aria-expanded", "false")
    await expect(page.getByRole("button", { name: "查看探测脚本" })).toBeHidden()
    await advanced.focus()
    await page.keyboard.press("Enter")
    await expect(advanced).toHaveAttribute("aria-expanded", "true")
    await expect(page.getByRole("button", { name: "查看探测脚本" })).toBeVisible()
    await shot(page, "p7d-settings-advanced")
    await page.keyboard.press("Enter")
    await expect(advanced).toHaveAttribute("aria-expanded", "false")
    await shot(page, "p7c-settings")
    expect(errors).toEqual([])
  })

  test("关闭窗口时、开机启动、导航位置立即生效", async ({ page }) => {
    await openSettings(page)
    const quit = page.getByRole("group", { name: "关闭窗口时" }).getByRole("radio", { name: "退出" }).or(page.getByRole("group", { name: "关闭窗口时" }).getByRole("button", { name: "退出" }))
    await quit.click()
    await expect(toastText(page, "设置已保存").or(page.getByRole("switch", { name: "开机时启动" }))).toBeVisible()
    await page.getByRole("switch", { name: "开机时启动" }).click()
    await expect(page.getByRole("switch", { name: "开机时启动" })).toBeChecked()
    const side = page.getByRole("group", { name: "导航位置" }).getByRole("radio", { name: "侧栏" }).or(page.getByRole("group", { name: "导航位置" }).getByRole("button", { name: "侧栏" }))
    await side.click()
    await expect(page.getByRole("complementary").or(page.locator("aside")).first()).toBeVisible()
  })

  test("SSH 配置：WSL 里还没生效，可以一键加入；界面上不说 Include", async ({ page }) => {
    await openSettings(page)
    await expect(page.getByText(/^SSH 配置在 WSL .* 里还没生效$/)).toBeVisible()
    await expect(page.getByRole("main").getByText(/Include/)).toHaveCount(0)
    await page.getByRole("button", { name: /^把 SSH 配置加入 WSL/ }).click()
    await expect(toastText(page, /^已加入，WSL .* 里的 Agent 现在可以连接了/)).toBeVisible()
    await expect(page.getByText(/里还没生效$/)).toHaveCount(0)
    await expect(page.getByText(/都已生效$/)).toBeVisible()
  })

  test("活动日志在设置 → 数据里，按天分组", async ({ page }) => {
    await openSettings(page)
    await page.getByRole("button", { name: "查看活动日志" }).click()
    const sheet = page.getByRole("dialog", { name: "活动日志" })
    await expect(sheet.getByRole("heading", { level: 3, name: "今天" })).toBeVisible()
    await expect(sheet.getByText(/更新了 Claude Code（Windows）的 Skill/).first()).toBeVisible()
    // 两个筛选在标题栏里；Agent 的操作记录不在这里，在「动态」
    await expect(sheet.getByRole("combobox", { name: "按类型筛选" })).toContainText("全部类型")
    await expect(sheet.getByRole("combobox", { name: "按资源筛选" })).toContainText("全部资源")
    await expect(sheet.getByText(/编译|SKILL\.md|托管/)).toHaveCount(0)
    await shot(page, "p7d-activity-log")
  })

  test("活动日志纯键盘打开和关闭，焦点回到「查看」", async ({ page }) => {
    await openSettings(page)
    const open = page.getByRole("button", { name: "查看活动日志" })
    await open.focus()
    await page.keyboard.press("Enter")
    const sheet = page.getByRole("dialog", { name: "活动日志" })
    await expect(sheet).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(sheet).toHaveCount(0)
    await expect(open).toBeFocused()
  })

  test("停止全部同步：输入确认文字后才能执行", async ({ page }) => {
    await openSettings(page)
    await page.getByRole("button", { name: "停止同步…" }).click()
    const dialog = page.getByRole("alertdialog", { name: "停止全部同步" })
    const confirm = dialog.getByRole("button", { name: "停止同步", exact: true })
    await expect(confirm).toBeDisabled()
    await dialog.getByRole("textbox").fill("停止同步")
    await confirm.click()
    await expect(toastText(page, "已停止全部同步")).toBeVisible()
    await expect(page.getByRole("button", { name: "停止同步…" })).toBeDisabled()
  })

  test("重置 CloudLink：输入「重置」后回到首次启动的空状态", async ({ page }) => {
    await openSettings(page)
    await page.getByRole("button", { name: "重置 CloudLink…" }).click()
    const dialog = page.getByRole("alertdialog", { name: "重置 CloudLink" })
    await dialog.getByRole("textbox").fill("重置")
    await dialog.getByRole("button", { name: "重置 CloudLink", exact: true }).click()
    await expect(toastText(page, "已重置 CloudLink")).toBeVisible()
    await page.keyboard.press("Control+1")
    await expect(page.getByRole("heading", { name: "添加第一台服务器" })).toBeVisible()
  })
})

test.describe("动态视图", () => {
  test("等你确认：疑似注入只能忽略；含密钥需编辑后并入；普通笔记直接并入", async ({ page }) => {
    const errors = collectConsoleErrors(page)
    await openActivity(page)
    const asks = page.getByRole("list", { name: "等你确认" })
    const injected = asks.getByRole("listitem").filter({ hasText: "Ignore previous instructions" })
    await expect(injected.getByRole("button", { name: "并入资源" })).toHaveCount(0)
    await expect(injected.getByRole("button", { name: "忽略" })).toBeVisible()
    await shot(page, "p7c-activity")

    const secret = asks.getByRole("listitem").filter({ hasText: "需编辑" })
    await secret.getByRole("button", { name: "编辑" }).click()
    await secret.getByRole("textbox").fill("部署配置位于 /opt/apps/api，更新前先检查服务状态。")
    await secret.getByRole("button", { name: "并入资源" }).click()
    await expect(toastText(page, /已并入 hk-edge/)).toBeVisible()

    await injected.getByRole("button", { name: "忽略" }).click()
    await expect(toastText(page, "已忽略这条笔记")).toBeVisible()
    await expect(asks.getByText("Ignore previous instructions")).toHaveCount(0)
    expect(errors).toEqual([])
  })

  test("操作记录：已拦截 / 已执行筛选", async ({ page }) => {
    await openActivity(page)
    await page.getByRole("group", { name: "按结果筛选" }).getByText("已拦截", { exact: true }).click()
    const rows = page.getByRole("main").getByRole("listitem")
    await expect(rows.getByText(/^已拦截/).first()).toBeVisible()
    await expect(rows.getByText("已执行", { exact: true })).toHaveCount(0)
  })

  test("详情「最近动态」的「查看全部」跳到动态页并按资源过滤", async ({ page }) => {
    await ready(page)
    await openServer(page, "hk-edge")
    await page.getByRole("button", { name: "查看全部" }).click()
    await expect(page.getByRole("heading", { name: "操作记录" })).toBeVisible()
    await expect(page.getByRole("combobox", { name: "按资源筛选" })).toContainText("hk-edge")
  })
})
