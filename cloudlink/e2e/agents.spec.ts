import { expect, test, type Page } from "@playwright/test"

import { collectConsoleErrors, ready, shot, toastText } from "./helpers"

// Agent 视图（PRD 6.6、6.10）：交给 Agent 的内容、护栏、分发目标；副本与护栏的各种状态

async function openAgents(page: Page, query = "") {
  await ready(page, query)
  await page.keyboard.press("Control+2")
  await expect(page.getByRole("heading", { level: 1, name: "Agent" })).toBeVisible()
  await expect(page.getByRole("heading", { level: 2, name: "Agent 与目录" })).toBeVisible()
}

const targets = (page: Page) => page.getByRole("region", { name: "Agent 与目录" })
/** 一个运行环境下的目录行；护栏挂在 Claude Code 那一行上 */
const envRows = (page: Page, env: string) => targets(page).getByRole("list", { name: env, exact: true })
const targetRow = (page: Page, env: string, label: string) =>
  envRows(page, env).getByRole("listitem").filter({ has: page.getByRole("switch", { name: `启用 ${label}（${env}）` }) })
const relations = (page: Page) => page.getByRole("list", { name: "资源关系" })

test.describe("Agent 视图", () => {
  test("顶部摘要；按环境分组的目录行：副本状态、读取通用目录的 Agent、Claude Code 行上的护栏", async ({ page }) => {
    const errors = collectConsoleErrors(page)
    await openAgents(page)
    await expect(page.getByText(/\d+ 项资源已列入 · 4 个目录已启用/)).toBeVisible()
    await expect(page.getByRole("main").getByRole("button", { name: /3 个问题/ })).toBeVisible()
    for (const s of ["已同步", "副本缺失", "副本被改动", "冲突", "已停用"]) await expect(targets(page).getByText(s).first()).toBeVisible()
    const winClaude = targetRow(page, "Windows", "Claude Code")
    await expect(winClaude).toContainText("已生效")
    await expect(winClaude).toContainText("今天拦下 2 条")
    await expect(targetRow(page, "WSL Ubuntu-24.04", "Claude Code")).toContainText("未安装")
    // 通用目录列出检测到的、读取它的 Agent，而不是只写 Codex
    const readers = targetRow(page, "Windows", "通用目录").getByRole("list", { name: "读取这个目录的 Agent" })
    await expect(readers.getByRole("listitem")).toHaveText(["Codex", "Cursor", "Windsurf", "Augment"])
    await shot(page, "agents-01-states")
    expect(errors).toEqual([])
  })

  test("护栏未生效、不可用（带原因）", async ({ page }) => {
    await openAgents(page, "?mock=degraded")
    const win = targetRow(page, "Windows", "Claude Code")
    await expect(win).toContainText("未生效")
    await expect(win).toContainText("settings.json 设置了 disableAllHooks")
    await expect(targetRow(page, "WSL Ubuntu-24.04", "Claude Code")).toContainText("不可用")
    await expect(page.getByText(/编译受阻：1 个错误/)).toBeVisible()
    await shot(page, "agents-02-degraded")
  })

  test("问题数跳到第一个有问题的目标，焦点在它的处理按钮上", async ({ page }) => {
    await openAgents(page)
    await page.getByRole("main").getByRole("button", { name: /3 个问题/ }).click()
    await expect(page.locator("[data-problem] button:focus")).toHaveCount(1)
  })

  test("安装护栏：先展示将要写入的 JSON 和备份位置", async ({ page }) => {
    await openAgents(page)
    const wsl = targetRow(page, "WSL Ubuntu-24.04", "Claude Code")
    await wsl.getByRole("button", { name: "安装护栏：WSL Ubuntu-24.04" }).click()
    const dialog = page.getByRole("alertdialog", { name: /安装护栏？/ })
    await expect(dialog).toContainText("PreToolUse")
    await expect(dialog).toContainText("settings.json.cloudlink-bak")
    await shot(page, "agents-03-install-guard")
    await dialog.getByRole("button", { name: "安装护栏" }).click()
    await expect(toastText(page, /安装护栏/)).toBeVisible()
    await expect(wsl.getByText("未安装")).toBeHidden()
  })

  test("修复被改动的副本要确认覆盖；Space 切换目录启用开关", async ({ page }) => {
    await openAgents(page)
    const modified = targets(page).locator("[data-problem]").filter({ hasText: "副本被改动" })
    await modified.getByRole("button", { name: /^修复/ }).click()
    const dialog = page.getByRole("alertdialog", { name: "修复会覆盖副本里的改动" })
    await expect(dialog).toBeVisible()
    await dialog.getByRole("button", { name: "覆盖并修复" }).click()
    await expect(toastText(page, /已修复/)).toBeVisible()

    const sw = page.getByRole("switch", { name: "启用 通用目录（Windows）" })
    await expect(sw).not.toBeChecked()
    await sw.focus()
    await page.keyboard.press("Space")
    await expect(sw).toBeChecked()
    await expect(toastText(page, /已启用/)).toBeVisible()
    // 停用要确认
    await page.keyboard.press("Space")
    const disable = page.getByRole("alertdialog", { name: /^停用/ })
    await expect(disable).toBeVisible()
    await disable.getByRole("button", { name: "停用" }).click()
    await expect(sw).not.toBeChecked()
  })

  test("资源关系由 CloudLink 自动整理：隐藏后可恢复，改写变成补充的一条，保存后重新编译", async ({ page }) => {
    await openAgents(page)
    const auto = relations(page).getByRole("listitem").filter({ hasText: "经跳板机" })
    await expect(auto).toContainText("sg-db")
    await auto.getByRole("button", { name: /^隐藏自动整理的/ }).click()
    await expect(relations(page).getByRole("listitem").filter({ hasText: "经跳板机" })).toHaveCount(0)
    await expect(page.getByText("未保存的修改")).toBeVisible()
    await page.getByRole("button", { name: /已隐藏 1 条/ }).click()
    await page.getByRole("button", { name: /^恢复/ }).first().click()
    await expect(relations(page).getByRole("listitem").filter({ hasText: "经跳板机" })).toHaveCount(1)

    await relations(page).getByRole("listitem").filter({ hasText: "经跳板机" }).getByRole("button", { name: /^改写自动整理的/ }).click()
    // 改写就在原来那一行的位置上变成输入框，光标直接落进去
    const rewritten = relations(page).getByRole("textbox", { name: /^改写的第 \d+ 条关系/ })
    await expect(rewritten).toBeFocused()
    await expect(rewritten).toHaveValue(/sg-db/)
    await rewritten.fill("sg-db is reached through hk-edge; open a tunnel for psql.")
    await shot(page, "agents-04-relations")
    await page.keyboard.press("Control+s")
    await expect(page.getByText("已保存，已重新编译")).toBeVisible()
    await expect(relations(page).getByRole("listitem").filter({ hasText: "经跳板机" })).toHaveCount(0)
  })

  test("编辑运维约定：底部操作条，保存后显示「已保存，已重新编译」", async ({ page }) => {
    await openAgents(page)
    await page.getByRole("button", { name: "添加约定" }).click()
    await page.keyboard.type("Back up before any migration")
    await expect(page.getByText("未保存的修改")).toBeVisible()
    await shot(page, "agents-05-draft")
    await page.keyboard.press("Control+s")
    await expect(page.getByText("已保存，已重新编译")).toBeVisible()
    await expect(page.getByText("未保存的修改")).toBeHidden()
  })

  test("添加自定义目录", async ({ page }) => {
    await openAgents(page)
    await targets(page).getByRole("button", { name: "自定义目录" }).click()
    const dialog = page.getByRole("dialog", { name: /自定义目录/ })
    await dialog.getByRole("textbox", { name: /^名称/ }).fill("Agent Tools")
    await dialog.getByRole("button", { name: "选择" }).click()
    await expect(dialog.getByRole("textbox", { name: /^目录/ })).toHaveValue("D:\\tools\\agent-skills")
    await shot(page, "agents-06-custom")
    await dialog.getByRole("button", { name: /^添加/ }).click()
    await expect(dialog).toBeHidden()
    await expect(targets(page).getByText("Agent Tools")).toBeVisible()
  })
})
