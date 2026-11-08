import { expect, test, type Page } from "@playwright/test"

import { collectConsoleErrors, openServer, ready, shot, toastText } from "./helpers"

// 设置视图（PRD 6.7、6.10）：分区导航、ssh Include、活动筛选、危险操作的输入确认

async function openSettings(page: Page, section?: string) {
  await ready(page)
  await page.keyboard.press("Control+4")
  await expect(page.getByRole("heading", { level: 1, name: "设置" })).toBeVisible()
  if (section) await nav(page).getByRole("button", { name: new RegExp(`^${section}`) }).click()
}

const nav = (page: Page) => page.getByRole("navigation", { name: "设置分区" })
const activityList = (page: Page) => page.locator("main")

test.describe("设置视图", () => {
  test("各分区都能打开，当前分区标记 aria-current", async ({ page }) => {
    const errors = collectConsoleErrors(page)
    await openSettings(page)
    await expect(page.getByText("编译产物语言")).toBeVisible()
    await shot(page, "settings-01-general")
    const checks: [string, string][] = [
      ["运行环境", "已检测到的运行环境"],
      ["ssh 配置", "托管文件"],
      ["编译", "正文行数上限"],
      ["探测", "主机密钥策略"],
      ["数据", "数据目录"],
      ["危险操作", "移除全部分发"],
    ]
    for (const [section, text] of checks) {
      const item = nav(page).getByRole("button", { name: new RegExp(`^${section}`) })
      await item.click()
      await expect(item).toHaveAttribute("aria-current", "page")
      await expect(page.getByText(text).first()).toBeVisible()
    }
    expect(errors).toEqual([])
  })

  test("ssh 配置：WSL 未加入 Include，可以一键加入", async ({ page }) => {
    await openSettings(page, "ssh 配置")
    await expect(page.getByText("未加入 Include")).toBeVisible()
    await expect(page.getByText("Include ~/.ssh/cloudlink.conf").first()).toBeVisible()
    await shot(page, "settings-02-ssh")
    await page.getByRole("button", { name: "加入 Include" }).click()
    await expect(toastText(page, /开头加入 Include/)).toBeVisible()
    await expect(page.getByText("未加入 Include")).toBeHidden()
  })

  test("活动：按天分组；筛选 Agent 操作和资源", async ({ page }) => {
    const errors = collectConsoleErrors(page)
    await openSettings(page, "活动")
    await expect(page.getByRole("heading", { level: 3, name: "今天" })).toBeVisible()
    await expect(page.getByText(/编译了 Claude Code（Windows）的总 Skill/)).toBeVisible()
    await shot(page, "settings-03-activity")

    await page.getByRole("button", { name: "Agent 操作", exact: true }).click()
    await expect(page.getByText(/被护栏拦下/).first()).toBeVisible()
    await expect(page.getByText(/编译了.*的总 Skill/)).toHaveCount(0)

    const combo = page.getByRole("combobox", { name: "资源" })
    await combo.click()
    await combo.fill("sg")
    await page.getByRole("option", { name: /sg-db/ }).click()
    await expect(combo).toHaveValue("sg-db")
    await expect(page.getByText(/在 hk-edge 上执行/)).toHaveCount(0)
    await shot(page, "settings-04-activity-filtered")
    expect(errors).toEqual([])
  })

  test("详情「最近动态」的「查看全部」跳到动态页并按资源、Agent 操作筛选", async ({ page }) => {
    await ready(page)
    await openServer(page, "hk-edge")
    await page.getByRole("button", { name: "查看全部" }).click()
    await expect(page.getByRole("heading", { level: 1, name: "动态" })).toBeAttached()
    await expect(page.getByRole("combobox", { name: "资源" })).toHaveValue("hk-edge")
    await expect(page.getByRole("button", { name: "Agent 操作", exact: true })).toHaveAttribute("aria-pressed", "true")
    await expect(activityList(page).getByText(/在 hk-edge 上执行/).first()).toBeVisible()
  })

  test("移除全部分发：输入确认文字后才能执行", async ({ page }) => {
    await openSettings(page, "危险操作")
    await page.getByRole("button", { name: "移除全部分发", exact: true }).click()
    const dialog = page.getByRole("alertdialog", { name: "移除全部分发" })
    const confirm = dialog.getByRole("button", { name: "移除全部分发", exact: true })
    await expect(confirm).toBeDisabled()
    await dialog.getByRole("textbox").fill("移除全部")
    await shot(page, "settings-05-danger")
    await confirm.click()
    await expect(toastText(page, "已移除全部分发")).toBeVisible()
    await expect(dialog).toBeHidden()
    await expect(page.getByRole("button", { name: "移除全部分发", exact: true })).toBeDisabled()
  })

  test("清空数据：回到首次启动的空状态", async ({ page }) => {
    await openSettings(page, "危险操作")
    await page.getByRole("button", { name: "清空数据", exact: true }).click()
    const dialog = page.getByRole("alertdialog", { name: "清空数据" })
    await dialog.getByRole("textbox").fill("清空数据")
    await dialog.getByRole("button", { name: "清空数据", exact: true }).click()
    await expect(toastText(page, "已清空数据")).toBeVisible()
    await page.keyboard.press("Control+1")
    await expect(page.getByRole("heading", { name: "添加第一台服务器" })).toBeVisible()
  })
})
