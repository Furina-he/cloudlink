import { defineConfig, devices } from "@playwright/test"

// e2e 跑在 Mock 模式下（PRD 7.8）。截图证据另存到仓库根目录 test-results/，本目录的 test-results/ 每次运行前会被清空
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  reporter: "list",
  use: {
    baseURL: "http://localhost:5173",
    ...devices["Desktop Chrome"],
    viewport: { width: 1280, height: 800 },
    locale: "zh-CN",
  },
  webServer: {
    command: "pnpm dev:mock",
    url: "http://localhost:5173",
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
