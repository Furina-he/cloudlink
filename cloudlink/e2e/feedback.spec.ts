import { expect, test, type Page } from "@playwright/test"

import { collectConsoleErrors, openServer, ready, toastText } from "./helpers"

type ObservedWindow = Window & {
  __TAURI_INTERNALS__: { invoke: (command: string, args?: unknown, options?: unknown) => Promise<unknown> }
  __feedbackCalls: { notes: number; guards: number }
}

const calls = (page: Page) => page.evaluate(() => (window as ObservedWindow).__feedbackCalls)

test("反馈每 60 秒刷新，隐藏时暂停，重新聚焦立即读取", async ({ page }) => {
  const errors = collectConsoleErrors(page)
  await page.clock.install()
  await ready(page)
  await page.evaluate(() => {
    const observed = window as ObservedWindow
    observed.__feedbackCalls = { notes: 0, guards: 0 }
    const original = observed.__TAURI_INTERNALS__.invoke
    observed.__TAURI_INTERNALS__.invoke = (command, args, options) => {
      if (command === "list_notes") observed.__feedbackCalls.notes += 1
      if (command === "get_guard_status") observed.__feedbackCalls.guards += 1
      return original(command, args, options)
    }
  })
  await page.clock.runFor(60_300)
  await expect.poll(() => calls(page)).toEqual({ notes: 1, guards: 1 })
  await page.evaluate(() => Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" }))
  await page.clock.runFor(120_000)
  expect(await calls(page)).toEqual({ notes: 1, guards: 1 })
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" })
    window.dispatchEvent(new Event("focus"))
  })
  await page.clock.runFor(300)
  await expect.poll(() => calls(page)).toEqual({ notes: 2, guards: 2 })
  expect(errors).toEqual([])
})

test("全部并入跳过密钥笔记，编辑清理后才能并入", async ({ page }) => {
  const errors = collectConsoleErrors(page)
  await ready(page)
  await openServer(page, "hk-edge")
  await page.getByRole("tab", { name: /^动态/ }).click()
  const notes = page.getByRole("listitem").filter({ has: page.getByRole("button", { name: "编辑后并入", exact: true }) })
  await expect(notes).toHaveCount(3)
  await page.getByRole("button", { name: "全部并入", exact: true }).click()
  await expect(notes).toHaveCount(1)
  const secretNote = page.getByRole("listitem").filter({ has: page.getByText("疑似包含密钥", { exact: true }) })
  await expect(secretNote.getByRole("button", { name: "并入", exact: true })).toBeDisabled()
  await secretNote.getByRole("button", { name: "编辑后并入", exact: true }).click()
  await secretNote.getByRole("textbox").fill("部署配置位于 /opt/apps/api，更新前先检查服务状态。")
  await secretNote.getByRole("button", { name: "并入", exact: true }).click()
  await expect(toastText(page, /已并入 1 条/)).toBeVisible()
  await expect(page.locator("#server-notes")).toHaveValue(/部署配置位于 \/opt\/apps\/api/)
  expect(errors).toEqual([])
})
