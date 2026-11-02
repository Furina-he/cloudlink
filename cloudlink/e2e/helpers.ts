import { expect, type Page } from "@playwright/test"

// P3.5 验收的公共部分。状态截图是验收证据，放仓库根目录 test-results/p3.5（本目录的 test-results 每次运行前会被清空）；
// 门槛要求的视图截图放 e2e/__screenshots__，随提交
export const SHOTS = "../test-results/p3.5"
export const GATE = "e2e/__screenshots__"

export function collectConsoleErrors(page: Page) {
  const errors: string[] = []
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") errors.push(`[${m.type()}] ${m.text()}`)
  })
  page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`))
  return errors
}

/** 打开应用并等夹具加载完：服务器卡片出现 */
export async function ready(page: Page, query = "") {
  await page.goto(`/${query}`)
  await expect(page.getByRole("heading", { level: 1, name: "服务器" })).toBeVisible()
  await expect(card(page, "hk-edge")).toBeVisible()
}

/** 卡片上打开详情的按钮，名称是「别名，名称，状态」 */
export const card = (page: Page, alias: string) => page.getByRole("button", { name: new RegExp(`^${alias}，`) })

export const breadcrumb = (page: Page) => page.getByRole("navigation", { name: "当前位置" })

export async function openServer(page: Page, alias: string) {
  await card(page, alias).click()
  await expect(breadcrumb(page)).toContainText(alias)
}

export const shot = (page: Page, name: string) => page.screenshot({ path: `${SHOTS}/${name}.png`, animations: "disabled" })

/** Toast 里的一句话 */
export const toastText = (page: Page, text: string | RegExp) => page.locator("[data-slot=toast], [role=status], [role=alert]").filter({ hasText: text }).first()
