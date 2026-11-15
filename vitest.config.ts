import { resolve } from "node:path"
import { defineConfig } from "vitest/config"

// 只扫 src/ 下的单元测试，避免和 e2e/ 下的 Playwright 用例互相扫到
export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "./src"),
    },
  },
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "node",
  },
})
