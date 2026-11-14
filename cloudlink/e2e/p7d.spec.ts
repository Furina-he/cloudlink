import { expect, test, type Page } from "@playwright/test"

import { editResource, inspector, openServer, ready } from "./helpers"

// P7d 验收证据（EXECUTION-PLAN P7d 门槛）：第四轮审查改过的每个画面 × 顶栏浅色 / 深色 × 1000 / 760 宽，
// 存到仓库根目录 test-results/p7d/。只在 P7D_SHOTS=1 时运行，平时的 pnpm e2e 不重拍。
// 画面入口随 P8 契约校准，不恢复旧的日常别名输入、即时保存或全成功提示。
const OUT = "../test-results/p7d"
const sshForm = (page: Page) => page.getByRole("region", { name: /^(添加 SSH 服务器|连接 )/ })

async function openNew(page: Page, host: string, name: string) {
  await page.keyboard.press("Control+n")
  await page.getByRole("button", { name: /^SSH 服务器/ }).click()
  await sshForm(page).getByLabel("地址").fill(host)
  await sshForm(page).getByLabel(/^名称/).fill(name)
}

const SCREENS: { name: string; query?: string; open: (page: Page) => Promise<void> }[] = [
  {
    name: "01-add-form",
    open: async (page) => {
      await openNew(page, "203.0.113.10", "香港边缘节点")
      await expect(sshForm(page).getByLabel(/^名称/)).toBeInViewport({ ratio: 1 })
      await expect(sshForm(page).getByRole("button", { name: /^高级/ })).toHaveAttribute("aria-expanded", "false")
      await expect(sshForm(page).getByRole("textbox", { name: /^SSH 别名/ })).toHaveCount(0)
    },
  },
  {
    name: "02-add-form-advanced",
    open: async (page) => {
      await openNew(page, "203.0.113.10", "香港边缘节点")
      await sshForm(page).getByRole("button", { name: /^高级/ }).click()
      await expect(sshForm(page).getByRole("checkbox", { name: /^Windows/ })).toBeVisible()
      await page.waitForTimeout(400)
    },
  },
  {
    name: "03-connect-fingerprint",
    open: async (page) => {
      await openNew(page, "198.51.100.20", "Tokyo Relay")
      await sshForm(page).getByLabel(/^密码/).fill("secret-pass")
      await sshForm(page).getByRole("button", { name: /^连接并启用/ }).click()
      await expect(sshForm(page).getByTestId("connect-fingerprint")).toBeVisible()
    },
  },
  {
    name: "04-connect-include",
    open: async (page) => {
      await openNew(page, "198.51.100.20", "Tokyo Relay")
      await sshForm(page).getByLabel(/^密码/).fill("secret-pass")
      await sshForm(page).getByRole("button", { name: /^连接并启用/ }).click()
      await sshForm(page).getByRole("button", { name: "指纹一致，继续" }).click()
      await expect(sshForm(page).getByTestId("connect-include")).toBeVisible()
    },
  },
  {
    name: "05-added-toast",
    open: async (page) => {
      await openNew(page, "203.0.113.10", "Edge Copy")
      await sshForm(page).getByRole("button", { name: "ssh-agent", exact: true }).click()
      await sshForm(page).getByRole("button", { name: /^连接并启用/ }).click()
      await sshForm(page).getByTestId("connect-include").getByRole("button", { name: "加入", exact: true }).click()
      await expect(sshForm(page)).toHaveCount(0)
      await expect(page.locator("[data-slot=toast], [role=status]").filter({ hasText: "Edge Copy 已添加，3 个目录已同步，其余尚未完成" }).first()).toBeVisible()
      await expect(page.locator("#server-list [data-fresh]").first()).toBeVisible()
    },
  },
  {
    name: "06-cli-wizard",
    open: async (page) => {
      await page.keyboard.press("Control+n")
      await page.getByRole("button", { name: /Oracle Cloud/ }).click()
      await expect(page.getByRole("checkbox", { name: "oci-web-1" })).toBeVisible()
    },
  },
  {
    name: "06b-cli-wizard-scope",
    open: async (page) => {
      await page.keyboard.press("Control+n")
      await page.getByRole("button", { name: /Oracle Cloud/ }).click()
      await expect(page.getByRole("checkbox", { name: "oci-web-1" })).toBeVisible()
      await page.getByRole("button", { name: /同时加为 SSH 服务器/ }).first().scrollIntoViewIfNeeded()
    },
  },
  {
    name: "07-edit-export",
    open: async (page) => {
      await openServer(page, "sg-db")
      await editResource(page, "让 Agent 知道哪些信息")
    },
  },
  {
    name: "08-edit-connection",
    open: async (page) => {
      await openServer(page, "hk-edge")
      await editResource(page, "编辑连接")
    },
  },
  {
    name: "09-settings",
    open: async (page) => {
      await page.keyboard.press("Control+4")
      await expect(page.getByRole("heading", { level: 3, name: "危险操作" })).toBeAttached()
    },
  },
  {
    name: "10-settings-advanced",
    open: async (page) => {
      await page.keyboard.press("Control+4")
      await page.getByRole("region", { name: "高级" }).getByRole("button", { name: /^高级/ }).click()
      await expect(page.getByRole("button", { name: "查看探测脚本" })).toBeVisible()
      await page.waitForTimeout(500)
    },
  },
  {
    name: "11-activity-log",
    open: async (page) => {
      await page.keyboard.press("Control+4")
      await page.getByRole("button", { name: "查看活动日志" }).click()
      await expect(page.getByRole("dialog", { name: "活动日志" }).getByRole("heading", { level: 3, name: "今天" })).toBeVisible()
    },
  },
  {
    name: "12-agents",
    open: async (page) => {
      await page.keyboard.press("Control+2")
      await page.getByRole("button", { name: /^其余 \d+ 个未检测到/ }).click()
      await expect(page.getByText(/Windsurf/)).toBeVisible()
      await page.waitForTimeout(400)
    },
  },
  {
    name: "13-guard-rules",
    open: async (page) => {
      await page.keyboard.press("Control+2")
      await page.getByRole("button", { name: /^护栏规则/ }).click()
      await expect(page.getByRole("heading", { name: "标准运维时拦下" })).toBeVisible()
    },
  },
  {
    name: "14-guard-rules-allow",
    open: async (page) => {
      await page.keyboard.press("Control+2")
      await page.getByRole("button", { name: /^护栏规则/ }).click()
      await page.getByRole("button", { name: /^只放行查看类命令/ }).click()
      await expect(page.getByRole("list", { name: "云平台", exact: true })).toBeVisible()
      await page.waitForTimeout(500)
    },
  },
  {
    name: "15-detail-folded",
    open: async (page) => {
      await openServer(page, "hk-edge")
      await inspector(page).getByRole("button", { name: /^更多信息/ }).scrollIntoViewIfNeeded()
    },
  },
  {
    name: "16-detail-probed-open",
    open: async (page) => {
      await openServer(page, "hk-edge")
      await inspector(page).getByRole("button", { name: /^探测结果/ }).click()
      await expect(inspector(page).getByRole("table")).toBeVisible()
      await page.waitForTimeout(500)
    },
  },
  {
    name: "17-probe-updated",
    open: async (page) => {
      await openServer(page, "hk-edge")
      await inspector(page).getByRole("button", { name: "重新探测", exact: true }).click()
      await expect(page.getByRole("dialog", { name: /探测/ }).getByText(/已更新 \d+ 处/)).toBeVisible({ timeout: 10_000 })
    },
  },
  {
    name: "18-probe-failed",
    open: async (page) => {
      await openServer(page, "sg-db")
      await inspector(page).getByRole("button", { name: "重新探测", exact: true }).click()
      await expect(page.getByRole("dialog", { name: /探测/ }).getByText(/还不认识 sg-db 的主机密钥/)).toBeVisible({ timeout: 10_000 })
    },
  },
]

test.describe("P7d 验收截图", () => {
  test.skip(process.env.P7D_SHOTS !== "1", "只在 P7D_SHOTS=1 时重拍")
  for (const scheme of ["light", "dark"] as const) {
    for (const [width, height] of [[1000, 680], [760, 520]]) {
      for (const s of SCREENS) {
        test(`${s.name} ${scheme} ${width}`, async ({ page }) => {
          await page.addInitScript(() => localStorage.setItem("cloudlink-nav-position", "top"))
          await page.emulateMedia({ colorScheme: scheme })
          await page.setViewportSize({ width, height })
          await ready(page, s.query)
          await s.open(page)
          await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
          await page.screenshot({ path: `${OUT}/${s.name}-${scheme}-${width}.png`, animations: "disabled" })
        })
      }
    }
  }
})
