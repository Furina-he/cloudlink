import { defineConfig, devices } from "@playwright/test"

// e2e 跑在 Mock 模式下。仅清理 Playwright 自己的输出，保留同级验收证据与桌面/更新夹具。
export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results/playwright",
  fullyParallel: false,
  reporter: "list",
  use: {
    baseURL: "http://localhost:5173",
    ...devices["Desktop Chrome"],
    viewport: { width: 900, height: 640 },
    locale: "zh-CN",
  },
  webServer: {
    command: "pnpm dev:mock",
    url: "http://localhost:5173",
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
