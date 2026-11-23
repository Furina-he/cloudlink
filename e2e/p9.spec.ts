// P9 验收截图（2026-11-19）：自动运维新分组、档位菜单、一键安装并登录的各阶段。
// 只在 P9_SHOTS=1 时重拍；产物写到 test-results/p9，由 magpie analyze_image 检查。
import { expect, test, type Page } from "@playwright/test"

import { ready, shot } from "./helpers"

const P9 = process.env.P9_SHOTS === "1"
const schemes = ["light", "dark"] as const

async function openRules(page: Page) {
  await ready(page)
  await page.keyboard.press("Control+2")
  await page.getByRole("button", { name: /^护栏规则/ }).click()
  await expect(page.getByRole("heading", { name: "两档都先问你" })).toBeVisible()
  await page.getByRole("button", { name: /^已识别、非敏感的查看类命令/ }).click()
  // 展开后回到页首，截图里能同时看到新的四组顺序
  await page.getByRole("heading", { name: "两档都先问你" }).scrollIntoViewIfNeeded()
}

async function oracleWizard(page: Page, query: string) {
  await ready(page, query)
  await page.keyboard.press("Control+n")
  await page.getByRole("region", { name: "添加资源" }).getByRole("button", { name: /Oracle Cloud/ }).click()
  return page.getByRole("region", { name: "添加 Oracle Cloud" }).getByRole("list", { name: "各运行环境的 CLI 状态" }).getByRole("listitem").filter({ hasText: "Windows" })
}

test.describe("P9 验收截图", () => {
  test.skip(!P9, "只在 P9_SHOTS=1 时重拍")
  for (const scheme of schemes) {
    test(`rules-${scheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme })
      // 规则页较长：用高视口让四组同时出现在验收截图里
      await page.setViewportSize({ width: 900, height: 2300 })
      await openRules(page)
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
      await shot(page, `p9-rules-${scheme}`)
    })

    test(`mode-menu-${scheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme })
      await page.setViewportSize({ width: 900, height: 640 })
      await ready(page)
      await page.getByRole("button", { name: /^香港边缘节点 的档位：确认变更$/ }).click()
      const menu = page.getByRole("menu")
      await menu.getByRole("menuitemradio", { name: /^自动运维/ }).click()
      await expect(menu.getByRole("alert")).toHaveText(/为 香港边缘节点 启用自动运维/)
      await shot(page, `p9-mode-${scheme}`)
    })
  }

  test("setup-waiting-install-light", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" })
    await page.setViewportSize({ width: 900, height: 640 })
    const windows = await oracleWizard(page, "?mock=cli-setup-slow")
    await windows.getByRole("button", { name: "安装并登录" }).click()
    await expect(windows.getByText("等待安装完成…")).toBeVisible()
    await shot(page, "p9-setup-waiting-install-light")
  })

  test("setup-waiting-login-light", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" })
    await page.setViewportSize({ width: 900, height: 640 })
    const windows = await oracleWizard(page, "?mock=cli-setup-slow")
    await windows.getByRole("button", { name: "安装并登录" }).click()
    await expect(windows.getByText("等待登录…")).toBeVisible({ timeout: 8_000 })
    await shot(page, "p9-setup-waiting-login-light")
    await expect(windows).toContainText("已就绪", { timeout: 10_000 })
    await shot(page, "p9-setup-ready-light")
  })

  test("setup-waiting-login-dark-760", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" })
    await page.setViewportSize({ width: 760, height: 520 })
    const windows = await oracleWizard(page, "?mock=cli-setup-slow")
    await windows.getByRole("button", { name: "安装并登录" }).click()
    await expect(windows.getByText("等待登录…")).toBeVisible({ timeout: 8_000 })
    await shot(page, "p9-setup-waiting-login-dark-760")
  })

  test("setup-failed-light", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" })
    await page.setViewportSize({ width: 900, height: 640 })
    const windows = await oracleWizard(page, "?mock=cli-setup-failed")
    await windows.getByRole("button", { name: "安装并登录" }).click()
    await expect(windows.getByText("没有装上，原因在终端里。可以重试，或换一种安装方式。")).toBeVisible()
    await shot(page, "p9-setup-failed-light")
  })

  test("setup-failed-dark-760", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" })
    await page.setViewportSize({ width: 760, height: 520 })
    const windows = await oracleWizard(page, "?mock=cli-setup-failed")
    await windows.getByRole("button", { name: "安装并登录" }).click()
    await expect(windows.getByText("没有装上，原因在终端里。可以重试，或换一种安装方式。")).toBeVisible()
    await shot(page, "p9-setup-failed-dark-760")
  })
})