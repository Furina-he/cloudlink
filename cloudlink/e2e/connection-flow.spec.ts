import { expect, test, type Page } from "@playwright/test"

import { collectConsoleErrors, ready, row, toastText } from "./helpers"

// 填表时标题是「添加 SSH 服务器」，点连接后同一个区域切到「连接 <别名>」的连接过程
const sshForm = (page: Page) =>
  page.getByRole("region", { name: /^(添加 SSH 服务器|连接 )/ })
const connectEnable = (page: Page) =>
  sshForm(page).getByRole("button", { name: /^(连接并启用|重新连接)/ })
const includeDialog = (page: Page) =>
  page.getByRole("alertdialog", { name: "把托管配置加入 ~/.ssh/config？" })

async function fillNew(page: Page, name: string, password = false) {
  await page.keyboard.press("Control+n")
  await page.getByRole("button", { name: /^SSH 服务器/ }).click()
  const form = sshForm(page)
  await form.getByLabel("地址").fill("203.0.113.10")
  await form.getByLabel("用户").fill("root")
  const method = password ? "密码" : "ssh-agent"
  await form
    .getByRole("radio", { name: method, exact: true })
    .or(form.getByRole("button", { name: method, exact: true }))
    .click()
  if (password) await form.getByLabel(/^密码/).fill("fixture-pass")
  await form.getByLabel(/^名称/).fill(name)
}

/** 一次受控拒绝后恢复真实 IPC 封装；后续重试仍走现有 Mock 后端完整流程。 */
async function rejectOnce(
  page: Page,
  method: "testConnection" | "saveAsset" | "addSshInclude"
) {
  await page.evaluate(async (method) => {
    // Vite 的热更新 URL 可能带 ?t=；必须修改应用已经加载的同一个模块实例。
    const modulePath = performance
      .getEntriesByType("resource")
      .map((entry) => entry.name)
      .find((url) => new URL(url).pathname === "/src/lib/ipc.ts")
    if (!modulePath) throw new Error("IPC module was not loaded")
    const { ipc } = (await import(
      /* @vite-ignore */ modulePath
    )) as typeof import("../src/lib/ipc")
    const error = {
      id: "internal",
      params: { message: `fixture ${method} rejection` },
    }
    if (method === "testConnection") {
      const original = ipc.testConnection
      ipc.testConnection = async () => {
        ipc.testConnection = original
        throw error
      }
    } else if (method === "saveAsset") {
      const original = ipc.saveAsset
      ipc.saveAsset = async () => {
        ipc.saveAsset = original
        throw error
      }
    } else {
      const original = ipc.addSshInclude
      ipc.addSshInclude = async () => {
        ipc.addSshInclude = original
        throw error
      }
    }
  }, method)
}

test.describe("连接流水线的 IPC 中断与恢复", () => {
  test("启动订阅失败时显示重试，恢复后列表和连接事件都正常", async ({
    page,
  }, testInfo) => {
    const errors = collectConsoleErrors(page)
    type StartupWindow = Window & { __cloudlinkRejectStartup: boolean }
    await page.addInitScript(() => {
      ;(window as StartupWindow).__cloudlinkRejectStartup = true
    })
    let injected = 0
    await page.route("**/src/lib/events.ts*", async (route) => {
      const response = await route.fetch()
      const body = await response.text()
      const entry = "async function subscribeBackendEvents() {"
      expect(body).toContain(entry)
      const modified = body.replace(
        entry,
        `${entry}\nif (window.__cloudlinkRejectStartup) throw new Error("fixture startup rejected");`
      )
      expect(modified).not.toBe(body)
      injected += 1
      await route.fulfill({ response, body: modified })
    })
    await page.goto("/")
    const failure = page
      .getByRole("alert")
      .filter({ hasText: "暂时无法打开 CloudLink" })
    await expect(failure).toBeVisible()
    expect(injected).toBeGreaterThan(0)
    await expect(
      page.getByRole("heading", { level: 1, name: "资源" })
    ).toHaveCount(0)
    await page.screenshot({
      path: testInfo.outputPath("startup-failed.png"),
      animations: "disabled",
    })

    await page.evaluate(() => {
      ;(window as StartupWindow).__cloudlinkRejectStartup = false
    })
    await page.getByRole("button", { name: "重试", exact: true }).click()
    await expect(failure).toBeHidden()
    await expect(row(page, "hk-edge")).toBeVisible()
    await page.screenshot({
      path: testInfo.outputPath("startup-recovered.png"),
      animations: "disabled",
    })
    // 连接完成事件必须推进到 Include 确认，验证重试后真正恢复了事件订阅。
    await fillNew(page, "Startup Recovery")
    await connectEnable(page).click()
    await expect(includeDialog(page)).toBeVisible()
    expect(errors).toEqual([])
  })

  test("测试 invoke 拒绝后可以仅保存，服务器保持未验证", async ({
    page,
  }, testInfo) => {
    const errors = collectConsoleErrors(page)
    await ready(page)
    await fillNew(page, "Invoke Recovery")
    await rejectOnce(page, "testConnection")
    await connectEnable(page).click()
    const saveOnly = sshForm(page).getByRole("button", {
      name: "仅保存（暂不启用）",
    })
    await expect(saveOnly).toBeEnabled()
    await expect(connectEnable(page)).toBeEnabled()
    await page.screenshot({
      path: testInfo.outputPath("invoke-rejected.png"),
      animations: "disabled",
    })
    await saveOnly.click()
    await includeDialog(page).getByRole("button", { name: "暂不加入" }).click()
    await expect(sshForm(page)).toHaveCount(0)
    await expect(row(page, "invoke-recovery")).toHaveAccessibleName(/未验证/)
    expect(errors).toEqual([])
  })

  test("仅保存失败后点击错误提示的重试，不重新连接、转密钥或授权", async ({
    page,
  }, testInfo) => {
    const errors = collectConsoleErrors(page)
    await ready(page)
    await fillNew(page, "Save Only Retry", true)
    await rejectOnce(page, "testConnection")
    await connectEnable(page).click()
    const saveOnly = sshForm(page).getByRole("button", {
      name: "仅保存（暂不启用）",
    })
    await expect(saveOnly).toBeEnabled()
    await rejectOnce(page, "saveAsset")
    await saveOnly.click()
    await includeDialog(page).getByRole("button", { name: "暂不加入" }).click()
    const saveError = sshForm(page)
      .getByRole("alert")
      .filter({ hasText: "保存失败" })
    await expect(saveError).toBeVisible()
    await expect(saveOnly).toBeEnabled()
    await page.screenshot({
      path: testInfo.outputPath("save-only-rejected.png"),
      animations: "disabled",
    })

    // 首次拒绝已恢复正常连接能力；重试仍必须遵守用户明确选择的「仅保存」。
    const calls = await page.evaluateHandle(async () => {
      const modulePath = performance
        .getEntriesByType("resource")
        .map((entry) => entry.name)
        .find((url) => new URL(url).pathname === "/src/lib/ipc.ts")
      if (!modulePath) throw new Error("IPC module was not loaded")
      const { ipc } = (await import(
        /* @vite-ignore */ modulePath
      )) as typeof import("../src/lib/ipc")
      const calls: string[] = []
      const testConnection = ipc.testConnection
      const convertToKeyAuth = ipc.convertToKeyAuth
      const setDistribute = ipc.setDistribute
      ipc.testConnection = (req) => {
        calls.push("testConnection")
        return testConnection(req)
      }
      ipc.convertToKeyAuth = (assetId) => {
        calls.push("convertToKeyAuth")
        return convertToKeyAuth(assetId)
      }
      ipc.setDistribute = (assetId, agentKey, on) => {
        calls.push("setDistribute")
        return setDistribute(assetId, agentKey, on)
      }
      return calls
    })
    await saveError.getByRole("button", { name: "重试", exact: true }).click()
    await expect(sshForm(page)).toHaveCount(0)
    expect(await calls.jsonValue()).toEqual([])
    await expect(row(page, "save-only-retry")).toHaveAccessibleName(/未验证/)
    await expect(
      page.getByRole("button", {
        name: "将 save-only-retry 分发给 Claude Code",
      })
    ).toHaveAttribute("aria-pressed", "false")
    expect(errors).toEqual([])
  })

  test("保存失败后点击错误提示的重试，继续转密钥并启用", async ({
    page,
  }, testInfo) => {
    const errors = collectConsoleErrors(page)
    await ready(page)
    await fillNew(page, "Save Recovery", true)
    await rejectOnce(page, "saveAsset")
    await connectEnable(page).click()
    await includeDialog(page).getByRole("button", { name: "暂不加入" }).click()
    const saveError = sshForm(page)
      .getByRole("alert")
      .filter({ hasText: "保存失败" })
    await expect(saveError).toBeVisible()
    await expect(connectEnable(page)).toBeEnabled()
    await expect(sshForm(page).getByLabel(/^名称/)).toHaveValue("Save Recovery")
    await page.screenshot({
      path: testInfo.outputPath("save-rejected.png"),
      animations: "disabled",
    })
    await saveError.getByRole("button", { name: "重试", exact: true }).click()
    const converting = sshForm(page).getByRole("button", {
      name: "正在生成并安装免密密钥…",
    })
    await expect(converting).toBeVisible()
    await expect(converting).toBeDisabled()
    await expect(sshForm(page)).toHaveCount(0)
    await expect(row(page, "save-recovery")).toHaveAccessibleName(/已连接/)
    await expect(
      page.getByRole("button", { name: "将 save-recovery 分发给 Claude Code" })
    ).toHaveAttribute("aria-pressed", "true")
    expect(errors).toEqual([])
  })

  test("关闭 Include 确认会结束本次流水线，草稿保留且可以重试", async ({
    page,
  }, testInfo) => {
    const errors = collectConsoleErrors(page)
    await ready(page)
    await fillNew(page, "Include Cancel")
    await connectEnable(page).click()
    const include = includeDialog(page)
    await expect(include).toBeVisible()
    await include.evaluate(async (element) => {
      await Promise.all(
        element.getAnimations().map((animation) => animation.finished)
      )
    })
    await page.keyboard.press("Escape")
    await expect(include).toBeHidden()
    await expect(connectEnable(page)).toBeEnabled()
    await expect(sshForm(page).getByLabel(/^名称/)).toHaveValue(
      "Include Cancel"
    )
    await expect(row(page, "include-cancel")).toHaveCount(0)
    await page.screenshot({
      path: testInfo.outputPath("include-cancelled.png"),
      animations: "disabled",
    })
    await connectEnable(page).click()
    await include.getByRole("button", { name: "暂不加入" }).click()
    await expect(sshForm(page)).toHaveCount(0)
    await expect(row(page, "include-cancel")).toHaveAccessibleName(/已连接/)
    expect(errors).toEqual([])
  })

  test("加入 Include 失败不保存资源，连接按钮恢复后可重试成功", async ({
    page,
  }, testInfo) => {
    const errors = collectConsoleErrors(page)
    await ready(page)
    await fillNew(page, "Include Recovery")
    await rejectOnce(page, "addSshInclude")
    await connectEnable(page).click()
    await includeDialog(page)
      .getByRole("button", { name: "加入 Include" })
      .click()
    await expect(
      toastText(page, "fixture addSshInclude rejection")
    ).toBeVisible()
    await expect(connectEnable(page)).toBeEnabled()
    await expect(row(page, "include-recovery")).toHaveCount(0)
    await page.screenshot({
      path: testInfo.outputPath("include-rejected.png"),
      animations: "disabled",
    })
    await connectEnable(page).click()
    await includeDialog(page)
      .getByRole("button", { name: "加入 Include" })
      .click()
    await expect(sshForm(page)).toHaveCount(0)
    await expect(row(page, "include-recovery")).toHaveAccessibleName(/已连接/)
    expect(errors).toEqual([])
  })
})
