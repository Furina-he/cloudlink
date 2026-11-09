import { expect, test, type Page } from "@playwright/test"

import { collectConsoleErrors, ready } from "./helpers"

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

