import { expect, type Locator, type Page } from "@playwright/test"

// 本批次状态与视图截图是 P8 验收证据，放仓库根目录（应用目录的 test-results 每次运行前会被清空）。
// 既有 e2e/__screenshots__ 门禁 PNG 保持不动；P7d 专属可选截图仍由 p7d.spec.ts 写到原路径。
export const SHOTS = process.env.CLOUDLINK_E2E_SHOTS ?? "../test-results/p8"

export function collectConsoleErrors(page: Page) {
  const errors: string[] = []
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") errors.push(`[${m.type()}] ${m.text()}`)
  })
  page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`))
  return errors
}

/** 打开应用并等夹具加载完：资源行出现 */
export async function ready(page: Page, query = "") {
  await page.goto(`/${query}`)
  await expect(page.getByRole("heading", { level: 1, name: "资源" })).toBeAttached()
  await expect(row(page, "hk-edge")).toBeVisible()
}

/** 资源行上进入详情的按钮，名称是「标识，名称，状态」 */
export const row = (page: Page, handle: string) => page.getByRole("button", { name: new RegExp(`^${handle}，`) })

/** 详情视图的标题：资源的显示名称，不是 SSH 别名 */
export const detailTitle = (page: Page) => page.locator("h2#detail-title")

/** 当前全宽详情（或添加表单）：标题是 #detail-title 的那个 section */
export const inspector = (page: Page) => page.locator("section").filter({ has: page.locator("#detail-title") }).last()

/** 进入某项资源的详情。打开按钮铺满资源行左侧，状态旁的修复按钮叠在它上面；点左上角，避开修复按钮 */
export async function openServer(page: Page, handle: string, title?: string) {
  await row(page, handle).click({ position: { x: 6, y: 6 } })
  await expect(detailOf(page, handle)).toBeVisible()
  if (title) await expect(detailTitle(page)).toHaveText(title)
}

/** 某项资源的详情标题行（data-handle 是别名或 cloudflare-2） */
export const detailOf = (page: Page, handle: string) => page.locator(`[data-handle="${handle}"]`)

/** 从当前详情的更多菜单打开资料／连接草稿，不跳页。 */
export async function editResource(page: Page, task: "编辑资料" | "编辑连接" | "让 Agent 知道哪些信息") {
  await inspector(page).locator("[data-detail-more]").click()
  await page.getByRole("menuitem", { name: task, exact: true }).click()
  const dialog = page.getByRole("dialog", { name: task, exact: true })
  await expect(dialog).toBeVisible()
  return dialog
}

/** 需要固定自定义连接标识的用例必须显式展开高级并填写，不能依赖名称自动生成。 */
export async function setSshAlias(form: Locator, alias: string) {
  const advanced = form.getByRole("button", { name: /^高级/ })
  if ((await advanced.getAttribute("aria-expanded")) !== "true") await advanced.click()
  await form.getByRole("textbox", { name: /^SSH 别名/ }).fill(alias)
}

/** 详情视图的「‹ 资源」 */
export async function back(page: Page) {
  await page.getByRole("button", { name: "资源", exact: true }).click()
  await expect(detailTitle(page)).toHaveCount(0)
}

export const shot = (page: Page, name: string) => page.screenshot({ path: `${SHOTS}/${name}.png`, animations: "disabled" })

/** Toast 里的一句话 */
export const toastText = (page: Page, text: string | RegExp) => page.locator("[data-slot=toast], [role=status], [role=alert]").filter({ hasText: text }).first()

/** 模拟用户从终端切回 CloudLink 窗口（F-104 AC2） */
export const refocusWindow = (page: Page) => page.evaluate(() => window.dispatchEvent(new Event("focus")))
