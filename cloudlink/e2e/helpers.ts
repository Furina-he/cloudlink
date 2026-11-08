import { expect, type Page } from "@playwright/test"

// P3.6 验收的公共部分。状态截图是验收证据，放仓库根目录 test-results/p3.7（本目录的 test-results 每次运行前会被清空）；
// 门槛要求的视图截图放 e2e/__screenshots__，随提交
export const SHOTS = "../test-results/p3.7"
export const GATE = "e2e/__screenshots__"

export function collectConsoleErrors(page: Page) {
  const errors: string[] = []
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") errors.push(`[${m.type()}] ${m.text()}`)
  })
  page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`))
  return errors
}

/** 打开应用并等夹具加载完：回路行出现 */
export async function ready(page: Page, query = "") {
  await page.goto(`/${query}`)
  await expect(page.getByRole("heading", { level: 1, name: "资源" })).toBeAttached()
  await expect(row(page, "hk-edge")).toBeVisible()
}

/** 回路行上进入详情的按钮，名称是「标识，名称，状态」 */
export const row = (page: Page, handle: string) => page.getByRole("button", { name: new RegExp(`^${handle}，`) })

/** 详情视图的标题：服务器是别名，云平台是平台名称 */
export const detailTitle = (page: Page) => page.locator("h2#detail-title")

/** 详情视图（或添加弹窗）：标题是 #detail-title 的那个 section */
export const inspector = (page: Page) => page.locator("section").filter({ has: page.locator("#detail-title") }).last()

/** 进入某项资源的详情。打开按钮铺满回路行左侧，状态旁的修复按钮叠在它上面；点左上角，避开修复按钮 */
export async function openServer(page: Page, handle: string, title?: string) {
  await row(page, handle).click({ position: { x: 6, y: 6 } })
  await expect(detailOf(page, handle)).toBeVisible()
  if (title) await expect(detailTitle(page)).toHaveText(title)
}

/** 某项资源的详情标题行（data-handle 是别名或 cloudflare-2） */
export const detailOf = (page: Page, handle: string) => page.locator(`[data-handle="${handle}"]`)

/** 详情视图的「← 返回」 */
export async function back(page: Page) {
  await page.getByRole("button", { name: "资源", exact: true }).click()
  await expect(detailTitle(page)).toHaveCount(0)
}

export const shot = (page: Page, name: string) => page.screenshot({ path: `${SHOTS}/${name}.png`, animations: "disabled" })

/** Toast 里的一句话 */
export const toastText = (page: Page, text: string | RegExp) => page.locator("[data-slot=toast], [role=status], [role=alert]").filter({ hasText: text }).first()

/** 模拟用户从终端切回 CloudLink 窗口（F-104 AC2） */
export const refocusWindow = (page: Page) => page.evaluate(() => window.dispatchEvent(new Event("focus")))
