import { expect, test, type Page } from "@playwright/test"

import { collectConsoleErrors, ready, shot, toastText } from "./helpers"

// Agent 视图（PRD 6.6，v0.2）：一行一个 Agent（Windows 与 WSL 合并）、同名冲突「备份并接管」、护栏、Skill 内容二级页、运行环境

async function openAgents(page: Page, query = "") {
  await ready(page, query)
  await page.keyboard.press("Control+2")
  await expect(page.getByText("CloudLink 把服务器和云平台写成一个 Skill，自动同步给下面这些 Agent。")).toBeVisible()
}

const detected = (page: Page) => page.getByRole("list", { name: "已检测到" })
const agentRow = (page: Page, label: string) =>
  detected(page).getByRole("listitem").filter({ has: page.getByRole("switch", { name: `给 ${label} 同步` }) })

test.describe("Agent 视图", () => {
  test("一行一个 Agent：已同步与资源数、通用目录的读取者、Claude Code 的护栏，其余未检测到折叠", async ({ page }) => {
    const errors = collectConsoleErrors(page)
    await openAgents(page)
    await expect(detected(page).getByRole("switch")).toHaveCount(3)
    const claude = agentRow(page, "Claude Code")
    await expect(claude).toContainText(/已同步·\d+ 项资源·Windows、WSL/)
    await expect(claude.getByRole("button", { name: "护栏已开启" })).toBeVisible()
    const universal = agentRow(page, "通用目录")
    await expect(universal).toContainText(/个 Agent 读取这里/)
    await expect(universal).toContainText("无护栏")
    // 正常时没有「修复」按钮（F-309）
    await expect(page.getByRole("button", { name: "修复" })).toHaveCount(0)
    await page.getByRole("button", { name: /^其余 \d+ 个未检测到/ }).click()
    await expect(page.getByText(/Windsurf/)).toBeVisible()
    await shot(page, "p7c-agents")
    expect(errors).toEqual([])
  })

  test("同名冲突：「备份并接管」后提示条带撤销，撤销后这个 Agent 暂停同步", async ({ page }) => {
    await openAgents(page)
    const cursor = agentRow(page, "Cursor")
    await expect(cursor).toContainText("目录里已有同名 Skill")
    await cursor.getByRole("button", { name: "备份并接管 Cursor 目录里的同名 Skill" }).click()
    await expect(cursor).toContainText("已同步")
    const toast = toastText(page, /已接管 Cursor 里的同名 Skill/)
    await expect(toast).toBeVisible()
    await toast.getByRole("button", { name: "撤销" }).click()
    await expect(toastText(page, /Cursor 暂停自动同步/)).toBeVisible()
    await expect(cursor.getByRole("switch")).not.toBeChecked()
  })

  test("开关：关闭前确认，Windows 与 WSL 一起停止；Space 也能切换", async ({ page }) => {
    await openAgents(page)
    const sw = agentRow(page, "通用目录").getByRole("switch")
    await sw.focus()
    await page.keyboard.press("Space")
    await page.getByRole("alertdialog").getByRole("button", { name: "停止同步" }).click()
    await expect(sw).not.toBeChecked()
    await expect(agentRow(page, "通用目录")).toContainText("已停用")
    await sw.click()
    await expect(sw).toBeChecked()
  })

  test("护栏已开启：点击跳到动态页；未生效时副行写明并给「重新安装」", async ({ page }) => {
    await openAgents(page, "?mock=degraded")
    const claude = agentRow(page, "Claude Code")
    await expect(claude).toContainText("护栏未生效")
    await expect(claude.getByRole("button", { name: "重新安装" })).toBeVisible()
    await page.goto("/")
    await openAgents(page)
    await agentRow(page, "Claude Code").getByRole("button", { name: "护栏已开启" }).click()
    await expect(page.getByRole("heading", { name: "操作记录" })).toBeVisible()
  })

  test("Skill 内容二级页：资源关系隐藏后可恢复并保存；Esc 和「‹ Agent」返回", async ({ page }) => {
    await openAgents(page)
    const relRow = page.getByRole("button", { name: /^资源关系/ })
    const autoBefore = Number((await relRow.textContent())!.match(/自动整理 (\d+) 条/)![1])
    await relRow.click()
    await expect(page.getByRole("heading", { level: 1, name: "资源关系" })).toBeFocused()
    const rel = page.getByRole("list", { name: "资源关系" })
    const before = await rel.getByRole("listitem").count()
    await page.getByRole("button", { name: "隐藏自动整理的第 1 条关系" }).click()
    await expect(rel.getByRole("listitem")).toHaveCount(before - 1)
    await page.getByRole("button", { name: "保存" }).click()
    await expect(toastText(page, "已保存").first()).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(page.getByRole("button", { name: /^资源关系/ })).toContainText(`自动整理 ${autoBefore - 1} 条`)

    await page.getByRole("button", { name: /^运维约定/ }).click()
    await page.getByRole("button", { name: "添加约定" }).click()
    await page.getByRole("textbox", { name: "第 3 条运维约定" }).fill("Run migrations before deploying")
    await page.getByRole("button", { name: "保存" }).click()
    await expect(toastText(page, "已保存").first()).toBeVisible()
    await page.getByRole("button", { name: "返回 Agent" }).click()
    await expect(page.getByRole("button", { name: /^运维约定/ })).toContainText("3 条")

    // 护栏规则：先讲拦什么，再讲只读巡检时放行什么；放行清单默认收起，展开后分四组
    const rulesRow = page.getByRole("button", { name: /^护栏规则/ })
    await expect(rulesRow).toContainText(/拦截 \d+ 类危险操作/)
    await rulesRow.click()
    await expect(page.getByRole("heading", { name: "标准运维时拦下" })).toBeVisible()
    await expect(page.getByRole("heading", { name: "任何档位都拦下" })).toBeVisible()
    const allow = page.getByRole("button", { name: /^只放行查看类命令，其余都拦下/ })
    await expect(allow).toHaveAttribute("aria-expanded", "false")
    await expect(allow).toContainText(/\d+ 条，例如 df、docker ps、journalctl/)
    await allow.click()
    for (const g of ["系统", "服务与日志", "Docker", "云平台"]) {
      await expect(page.getByRole("list", { name: g, exact: true })).toBeVisible()
    }
    await shot(page, "p7d-guard-rules")
  })

  test("添加自定义目录：组标题右边的「⋯」菜单", async ({ page }) => {
    await openAgents(page)
    await page.getByRole("button", { name: "Agent 目录的更多操作" }).click()
    await page.getByRole("menuitem", { name: "添加自定义目录" }).click()
    const dialog = page.getByRole("dialog", { name: "添加自定义目录" })
    await dialog.getByRole("textbox", { name: /名称/ }).fill("Aider")
    await dialog.getByRole("textbox", { name: /目录/ }).fill("C:\\Users\\me\\.aider\\skills")
    await dialog.getByRole("button", { name: "添加目录" }).click()
    await expect(agentRow(page, "Aider")).toBeVisible()
  })

  test("运行环境：每个环境一行开关，重新检测", async ({ page }) => {
    await openAgents(page)
    await expect(page.getByRole("switch", { name: "启用 WSL Ubuntu-24.04" })).toBeChecked()
    await page.getByRole("button", { name: "重新检测" }).click()
    await expect(toastText(page, "已重新检测运行环境与 Agent")).toBeVisible()
  })
})
