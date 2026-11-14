import { expect, test, type Page } from "@playwright/test"
import type { AssetInput } from "../src/bindings"
import { collectConsoleErrors, detailTitle, inspector, openServer, ready, row, toastText } from "./helpers"

// P8a/b 行为回归；全部通过 Mock IPC，不访问用户的 Skills、SSH 或凭据库。
type ObservedWindow = Window & {
  __TAURI_INTERNALS__: { invoke: (command: string, args?: unknown, options?: unknown) => Promise<unknown> }
  __p8Saves: AssetInput[]
}

async function snapshot(page: Page) {
  return page.evaluate(async () => {
    const url = performance.getEntriesByType("resource").map((e) => e.name).find((url) => new URL(url).pathname === "/src/lib/ipc.ts")!
    const { ipc } = await import(/* @vite-ignore */ url) as typeof import("../src/lib/ipc")
    const [assets, targets, deliveries, inclusions, statuses] = await Promise.all([ipc.listAssets(), ipc.listTargets(), ipc.listDeliveries(), ipc.listInclusions(), ipc.getCompileStatus()])
    return { assets, targets, deliveries, inclusions, statuses }
  })
}

async function observeSaves(page: Page) {
  await page.evaluate(() => {
    const w = window as ObservedWindow
    w.__p8Saves = []
    const invoke = w.__TAURI_INTERNALS__.invoke
    w.__TAURI_INTERNALS__.invoke = (command, args, options) => {
      if (command === "save_asset") w.__p8Saves.push(structuredClone((args as { input: AssetInput }).input))
      return invoke(command, args, options)
    }
  })
}
const saves = (page: Page) => page.evaluate(() => (window as ObservedWindow).__p8Saves)

async function edit(page: Page, kind: "profile" | "connection" = "profile") {
  await inspector(page).getByRole("button", { name: "更多操作" }).click()
  await page.getByRole("menuitem", { name: kind === "profile" ? "编辑资料" : "编辑连接", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: kind === "profile" ? "编辑资料" : "编辑连接", exact: true })
  await expect(dialog).toBeVisible()
  return dialog
}

const agentRow = (page: Page, label: string) => page.getByRole("list", { name: "已检测到" }).getByRole("listitem").filter({ has: page.getByRole("switch", { name: `给 ${label} 同步` }) })

test.describe("P8 当前详情上的编辑", () => {
  for (const [width, height] of [[1000, 680], [760, 520]]) {
    test(`编辑正文真正滚动，标题和底栏不移动 ${width}`, async ({ page }) => {
      const errors = collectConsoleErrors(page)
      await page.setViewportSize({ width, height })
      await ready(page)
      await openServer(page, "hk-edge")
      const dialog = await edit(page)
      await expect(dialog.getByRole("button", { name: "保存修改" })).toBeDisabled()
      const fold = dialog.getByRole("button", { name: /^服务与目录/ })
      await fold.click()
      // 等面板达到实际高度、展开引发的自动定位也停稳，再模拟用户滚到底。
      // 不绑定 scrollIntoView({ block: "nearest" }) 的某种对齐语义：面板高度和视口相当时，
      // 对齐到上缘或下缘都合法；绑定对齐会在慢机器上跟随动画时序抖成假失败。
      await expect.poll(() => fold.evaluate((button) => {
        const row = button.closest<HTMLElement>("[data-slot=collapsible]")!
        const panel = row.querySelector<HTMLElement>("[data-slot=collapsible-content]")!
        const viewport = row.closest<HTMLElement>("[data-slot=scroll-area-viewport]")!
        // Base UI 在展开动画结束后把测量值交还给 auto。
        const fullHeight = getComputedStyle(panel).getPropertyValue("--collapsible-panel-height").trim()
        const expanded = fullHeight === "auto" || Math.abs(panel.getBoundingClientRect().height - Number.parseFloat(fullHeight)) < 1
        // 连续三次轮询滚动位置一致（约 200ms 未再移动）才算停稳；之后再手动滚到底才不会被自动定位抢走。
        const top = String(viewport.scrollTop)
        const stable = viewport.dataset.p8ScrollTop === top ? Number(viewport.dataset.p8ScrollStable ?? "0") + 1 : 0
        viewport.dataset.p8ScrollTop = top
        viewport.dataset.p8ScrollStable = String(stable)
        return expanded && stable >= 2
      }), { timeout: 10_000 }).toBe(true)
      const geometry = await dialog.evaluate((d) => {
        const root = d.querySelector<HTMLElement>("[data-slot=scroll-area]")!
        const viewport = d.querySelector<HTMLElement>("[data-slot=scroll-area-viewport]")!
        return { root: root.clientHeight, viewport: viewport.clientHeight, content: viewport.scrollHeight, height: d.getBoundingClientRect().height }
      })
      expect(geometry.viewport).toBeGreaterThan(100)
      expect(geometry.viewport).toBeLessThanOrEqual(geometry.root + 1)
      expect(geometry.content).toBeGreaterThan(geometry.viewport)
      expect(geometry.height).toBeLessThanOrEqual(Math.min(600, height - 32) + 1)
      expect(await dialog.evaluate((d) => d.scrollTop)).toBe(0)
      const headerBefore = await dialog.locator("[data-slot=dialog-header]").boundingBox()
      const footerBefore = await dialog.locator("[data-editor-footer]").boundingBox()
      await dialog.locator("[data-slot=scroll-area-viewport]").evaluate((e) => { e.scrollTop = e.scrollHeight })
      await expect(dialog.locator("#editor-notes")).toBeInViewport({ ratio: 1 })
      expect(await dialog.locator("[data-slot=dialog-header]").boundingBox()).toEqual(headerBefore)
      expect(await dialog.locator("[data-editor-footer]").boundingBox()).toEqual(footerBefore)
      expect(errors).toEqual([])
    })
  }

  test("脏草稿只在同一底栏确认，Esc 回编辑，Ctrl+S 不保存", async ({ page }) => {
    await ready(page)
    await openServer(page, "hk-edge")
    await observeSaves(page)
    const dialog = await edit(page)
    await dialog.getByLabel(/^名称/).fill("还没保存的名称")
    await expect(detailTitle(page)).toHaveText("香港边缘节点")
    await page.keyboard.press("Escape")
    await expect(dialog.getByRole("button", { name: "继续编辑" })).toBeFocused()
    await expect(page.getByRole("dialog")).toHaveCount(1)
    await expect(page.getByRole("alertdialog")).toHaveCount(0)
    expect(await dialog.getByLabel(/^名称/).evaluate((e) => !!e.closest("[inert]"))).toBe(true)
    await page.keyboard.press("Control+s")
    expect(await saves(page)).toEqual([])
    await page.keyboard.press("Escape")
    await expect(dialog.getByLabel(/^名称/)).toBeFocused()
    await expect(dialog.getByLabel(/^名称/)).toHaveValue("还没保存的名称")
    await page.keyboard.press("Escape")
    await dialog.getByRole("button", { name: "放弃修改" }).click()
    await expect(dialog).toHaveCount(0)
    await expect(detailTitle(page)).toHaveText("香港边缘节点")
    await expect(inspector(page).getByRole("button", { name: "更多操作" })).toBeFocused()
  })

  test("底栏确认刚出现的微任务里 Ctrl+S 也不能保存", async ({ page }) => {
    await ready(page)
    await openServer(page, "hk-edge")
    await observeSaves(page)
    const dialog = await edit(page)
    await dialog.getByLabel(/^名称/).fill("保留这份草稿")
    await expect(dialog.getByRole("button", { name: "保存修改" })).toBeEnabled()
    await page.evaluate(() => {
      const w = window as Window & { __p8ConfirmCtrlS?: boolean }
      w.__p8ConfirmCtrlS = false
      const fire = () => {
        if (!document.querySelector("[data-editor-footer] [role=alert]")) return false
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "s", code: "KeyS", ctrlKey: true, bubbles: true, cancelable: true }))
        w.__p8ConfirmCtrlS = true
        return true
      }
      const observer = new MutationObserver(() => {
        if (fire()) observer.disconnect()
      })
      observer.observe(document.documentElement, { childList: true, subtree: true })
    })
    await page.keyboard.press("Escape")
    await expect.poll(() => page.evaluate(() => (window as Window & { __p8ConfirmCtrlS?: boolean }).__p8ConfirmCtrlS)).toBe(true)
    await expect(dialog.getByRole("button", { name: "继续编辑" })).toBeVisible()
    expect(await saves(page)).toEqual([])
    await dialog.getByRole("button", { name: "放弃修改" }).click()
  })

  test("保存失败保留输入，重试成功后同页更新；没有普通资料的即时保存", async ({ page }) => {
    await ready(page)
    await openServer(page, "hk-edge")
    const dialog = await edit(page)
    await dialog.getByLabel(/^名称/).fill("保存失败仍保留")
    await page.evaluate(async () => {
      const url = performance.getEntriesByType("resource").map((e) => e.name).find((url) => new URL(url).pathname === "/src/lib/ipc.ts")!
      const { ipc } = await import(/* @vite-ignore */ url) as typeof import("../src/lib/ipc")
      const save = ipc.saveAsset
      ipc.saveAsset = async () => { ipc.saveAsset = save; throw { id: "internal", params: { message: "p8-save-failed" } } }
    })
    await dialog.getByRole("button", { name: "保存修改" }).click()
    await expect(dialog.getByRole("alert").filter({ hasText: "保存失败" })).toBeVisible()
    await expect(dialog.getByLabel(/^名称/)).toHaveValue("保存失败仍保留")
    await expect(detailTitle(page)).toHaveText("香港边缘节点")
    await dialog.getByRole("button", { name: "保存修改" }).click()
    await expect(dialog).toHaveCount(0)
    await expect(detailTitle(page)).toHaveText("保存失败仍保留")
  })

  test("手工服务仍能维护镜像与端口，重复与无效输入不能保存", async ({ page }) => {
    await ready(page)
    await openServer(page, "hk-edge")
    const dialog = await edit(page)
    await dialog.getByRole("button", { name: /^服务与目录/ }).click()
    await dialog.getByRole("button", { name: "手动添加" }).click()
    const name = dialog.locator('[name="services.2.name"]')
    await expect(name).toBeFocused()
    await name.fill("openresty")
    await dialog.getByRole("button", { name: "保存修改" }).click()
    await expect(dialog.getByText("已经有同类型、同名称的服务")).toBeVisible()
    await name.fill("manual-worker")
    await dialog.locator('[name="services.2.image"]').fill("worker:2")
    const ports = dialog.locator('[name="services.2.portsText"]')
    await ports.fill("invalid")
    await dialog.getByRole("button", { name: "保存修改" }).click()
    await expect(ports).toHaveAttribute("aria-invalid", "true")
    await ports.fill("127.0.0.1:8080->80")
    await dialog.getByRole("button", { name: "保存修改" }).click()
    await expect(dialog).toHaveCount(0)
    const asset = (await snapshot(page)).assets.find((a) => a.id === "ast_hk_edge")!
    expect(asset.type).toBe("vps")
    if (asset.type !== "vps") throw new Error("wrong asset type")
    expect(asset.services.find((s) => s.name === "manual-worker")).toMatchObject({ image: "worker:2", ports: [{ hostIp: "127.0.0.1", hostPort: 8080, containerPort: 80, proto: "tcp" }] })
  })

  test("连接保存确认锁住字段；取消后继续修改，最终保存最新确认的草稿", async ({ page }) => {
    await ready(page)
    await openServer(page, "hk-edge")
    const dialog = await edit(page, "connection")
    const host = dialog.getByLabel(/^地址/)
    await host.fill("first.example.com")
    await dialog.getByRole("button", { name: "保存连接", exact: true }).click()
    const unverified = dialog.getByRole("alert").filter({ hasText: "连接还没有通过验证" })
    await expect(unverified).toBeVisible()
    expect(await host.evaluate((e) => !!e.closest("[inert]"))).toBe(true)
    await expect(dialog.getByRole("button", { name: "测试连接", exact: true })).toBeDisabled()
    await unverified.getByRole("button", { name: "取消", exact: true }).click()
    await expect(host).toBeEditable()
    await host.fill("latest.example.com")
    await dialog.getByRole("button", { name: "保存连接", exact: true }).click()
    await unverified.getByRole("button", { name: "仍然保存", exact: true }).click()
    const include = dialog.getByRole("alert").filter({ hasText: "让 Agent 能用别名连接" })
    await expect(include).toBeVisible()
    expect(await host.evaluate((e) => !!e.closest("[inert]"))).toBe(true)
    await include.getByRole("button", { name: "暂不加入", exact: true }).click()
    await expect(dialog).toHaveCount(0)
    const asset = (await snapshot(page)).assets.find((a) => a.id === "ast_hk_edge")!
    if (asset.type !== "vps") throw new Error("wrong fixture")
    expect(asset.connection.host).toBe("latest.example.com")
    expect(asset.connection.sshAlias).toBe("hk-edge")
  })

  for (const width of [1000, 760]) {
    test(`服务表文字留在自己的列内，长端口不盖住角色 ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 760 ? 520 : 680 })
      await ready(page)
      if (width === 760) await page.keyboard.press("Control+Shift+s")
      await openServer(page, "hk-edge")
      await page.getByRole("button", { name: /^探测结果/ }).click()
      const table = page.getByRole("table")
      await expect(table.getByRole("columnheader")).toHaveCount(5)
      const cells = await table.locator("tbody tr").first().locator("td").evaluateAll((cells) => cells.map((cell) => {
        const range = document.createRange()
        range.selectNodeContents(cell)
        const bounds = cell.getBoundingClientRect(), text = range.getBoundingClientRect()
        return { text: cell.textContent, cellRight: bounds.right, textRight: text.right }
      }))
      for (const cell of cells) expect(cell.textRight, cell.text ?? "").toBeLessThanOrEqual(cell.cellRight)
      expect(await table.evaluate((e) => e.parentElement!.scrollWidth > e.parentElement!.clientWidth)).toBe(false)
    })
  }

  test("最小侧栏窗口里的长私钥路径不挤出卡片，复制仍保留完整值", async ({ page }) => {
    await page.setViewportSize({ width: 760, height: 520 })
    await ready(page)
    await page.keyboard.press("Control+Shift+s")
    const path = "D:\\desk\\Desktop\\cloudlink\\test-results\\desktop\\run-p8\\home 测试\\.ssh\\cloudlink_ed25519_long_filename_for_layout_check"
    await page.evaluate(async (path) => {
      const url = performance.getEntriesByType("resource").map((e) => e.name).find((url) => new URL(url).pathname === "/src/stores/assets.ts")!
      const { useAssetStore } = await import(/* @vite-ignore */ url) as typeof import("../src/stores/assets")
      const formUrl = performance.getEntriesByType("resource").map((e) => e.name).find((url) => new URL(url).pathname === "/src/features/servers/profileForm.ts")!
      const { renameInputOf } = await import(/* @vite-ignore */ formUrl) as typeof import("../src/features/servers/profileForm")
      // 写进 Mock 后端而不只注入前端缓存；启动健康刷新不应把布局夹具覆盖回原值。
      await useAssetStore.getState().update("ast_hk_edge", (asset) => {
        const input = renameInputOf(asset, asset.name)
        if (input.type !== "vps" || !input.connection.auth) throw new Error("wrong fixture")
        input.connection.auth.identityFile.windows = path
        return input
      })
      Object.defineProperty(navigator.clipboard, "writeText", { configurable: true, value: async (text: string) => { document.documentElement.dataset.p8Copied = text } })
    }, path)
    await openServer(page, "hk-edge")
    const region = page.getByRole("region", { name: "连接", exact: true })
    const value = region.locator("[class~='group/copy']").filter({ hasText: path })
    const bounds = await value.evaluate((e) => ({ right: e.getBoundingClientRect().right, regionRight: e.closest("section")!.getBoundingClientRect().right }))
    expect(bounds.right).toBeLessThanOrEqual(bounds.regionRight)
    await value.getByRole("button", { name: "复制 登录方式", exact: true }).click()
    expect(await page.evaluate(() => document.documentElement.dataset.p8Copied)).toBe(path)
  })

  test("从连接分组打开编辑后，关闭焦点回到该入口而不是更多菜单", async ({ page }) => {
    await ready(page)
    await openServer(page, "hk-edge")
    const opener = page.getByRole("region", { name: "连接", exact: true }).getByRole("button", { name: "编辑", exact: true })
    await opener.click()
    const dialog = page.getByRole("dialog", { name: "编辑连接", exact: true })
    await expect(dialog.getByRole("button", { name: "保存连接", exact: true })).toBeDisabled()
    await page.keyboard.press("Escape")
    await expect(dialog).toHaveCount(0)
    await expect(opener).toBeFocused()
  })

  test("导出开关仍完整；改资料不把后台转换的新密钥覆盖回密码", async ({ page }) => {
    await ready(page)
    await openServer(page, "dev-box")
    const dialog = await edit(page)
    await dialog.locator("#editor-summary").fill("修改用途，不改认证")
    await page.evaluate(async () => {
      const url = performance.getEntriesByType("resource").map((e) => e.name).find((url) => new URL(url).pathname === "/src/stores/connection.ts")!
      const { useConnectionStore } = await import(/* @vite-ignore */ url) as typeof import("../src/stores/connection")
      await useConnectionStore.getState().convertToKey("ast_dev_box")
    })
    await dialog.getByRole("button", { name: "保存修改" }).click()
    await expect(dialog).toHaveCount(0)
    const asset = (await snapshot(page)).assets.find((a) => a.id === "ast_dev_box")!
    if (asset.type !== "vps") throw new Error("wrong asset type")
    expect(asset.connection.auth?.method).toBe("key")
    expect(asset.summary).toBe("修改用途，不改认证")
    const connection = await edit(page, "connection")
    await connection.getByRole("button", { name: /^高级/ }).click()
    await expect(connection.getByRole("switch", { name: "导出镜像版本" })).toBeAttached()
    await expect(connection.getByRole("switch")).toHaveCount(3)
  })
})

test.describe("P8 标题与默认名称", () => {
  test("Enter 加 blur 只提交一次，改名不影响 SSH 别名与验证", async ({ page }) => {
    await ready(page)
    await openServer(page, "hk-edge")
    const initial = (await snapshot(page)).assets.find((a) => a.id === "ast_hk_edge")!
    await observeSaves(page)
    await page.getByRole("button", { name: "重命名 香港边缘节点" }).click()
    const input = page.getByRole("textbox", { name: "资源名称", exact: true })
    await expect(input).toBeFocused()
    await input.fill("新的标题")
    await page.keyboard.press("Enter")
    await expect(input).toHaveCount(0)
    const changed = (await snapshot(page)).assets.find((a) => a.id === initial.id)!
    expect((await saves(page)).length).toBe(1)
    if (initial.type !== "vps" || changed.type !== "vps") throw new Error("wrong asset type")
    expect(changed.connection).toEqual(initial.connection)
    await expect(detailTitle(page)).toHaveText("新的标题")
  })

  test("组词 Enter 不提交，空名称失败后 Esc 仍只取消改名，不返回列表", async ({ page }) => {
    await ready(page)
    await openServer(page, "hk-edge")
    await observeSaves(page)
    await page.getByRole("button", { name: "重命名 香港边缘节点" }).click()
    const input = page.getByRole("textbox", { name: "资源名称", exact: true })
    await input.fill("中文组词")
    await input.dispatchEvent("keydown", { key: "Enter", code: "Enter", keyCode: 229, isComposing: true })
    expect(await saves(page)).toEqual([])
    await expect(input).toBeVisible()
    await input.fill(" ")
    await page.keyboard.press("Enter")
    await expect(page.getByText(/^名称不能为空/)).toBeVisible()
    await expect(input).toBeFocused()
    await page.keyboard.press("Escape")
    await expect(input).toHaveCount(0)
    await expect(detailTitle(page)).toHaveText("香港边缘节点")
    expect(await saves(page)).toEqual([])
  })

  test("名称留空使用中性名称，默认别名稳定且不含地址；有实际副本才计同步", async ({ page }) => {
    await ready(page)
    await page.keyboard.press("Control+n")
    await page.getByRole("button", { name: /^SSH 服务器/ }).click()
    const form = page.getByRole("region", { name: "添加 SSH 服务器" })
    await expect(form.getByLabel(/^名称/)).toHaveAttribute("placeholder", "留空将使用“服务器 1”")
    await expect(form.getByRole("textbox", { name: /^SSH 别名/ })).toHaveCount(0)
    await form.getByLabel("地址").fill("203.0.113.10")
    await form.getByRole("button", { name: "ssh-agent", exact: true }).click()
    await form.getByRole("button", { name: /^高级/ }).click()
    await expect(form.getByRole("textbox", { name: /^SSH 别名/ })).toHaveValue("cloudlink-1")
    await form.getByRole("button", { name: /^高级/ }).click()
    await form.getByRole("button", { name: /^连接并启用/ }).click()
    await expect(page.getByRole("region", { name: "连接 服务器 1" })).toBeVisible()
    await page.getByTestId("connect-include").getByRole("button", { name: "加入", exact: true }).click()
    await expect(row(page, "cloudlink-1")).toHaveAccessibleName(/服务器 1/)
    const state = await snapshot(page), created = state.assets.find((a) => a.name === "服务器 1")!
    if (created.type !== "vps") throw new Error("wrong asset type")
    expect(created.connection.sshAlias).toBe("cloudlink-1")
    expect(created.name).not.toContain("203.0.113.10")
    expect(state.statuses.every((s) => !s.blocked)).toBe(true)
    await expect(toastText(page, /服务器 1 已添加，\d+ 个目录已同步，其余尚未完成/)).toBeVisible()
  })
})

test.describe("P8 动态 Agent 与真实送达", () => {
  test("检测数据决定行数，空交集保留提示，健康检查不丢；开关联动并按物理目录去重", async ({ page }) => {
    await ready(page, "?mock=shared")
    const before = await snapshot(page)
    await page.keyboard.press("Control+2")
    await expect(page.getByRole("list", { name: "已检测到" }).getByRole("switch")).toHaveCount(new Set(before.targets.map((t) => t.agentKey)).size)
    await expect(agentRow(page, "Kiro")).toBeVisible()
    await expect(agentRow(page, "Trae")).toBeVisible()
    await expect(agentRow(page, "通用目录")).toContainText("与 Trae 共用同一目录，资源选择不一致")
    const missing = before.deliveries.filter((d) => d.statusDetail?.id === "shared-selection-mismatch")
    expect(missing.length).toBe(2)
    expect(missing.every((d) => d.status === "missing")).toBe(true)
    await page.evaluate(async () => {
      const url = performance.getEntriesByType("resource").map((e) => e.name).find((url) => new URL(url).pathname === "/src/lib/ipc.ts")!
      const { ipc } = await import(/* @vite-ignore */ url) as typeof import("../src/lib/ipc")
      await ipc.checkDeliveries()
    })
    await expect(agentRow(page, "通用目录")).toContainText("资源选择不一致")
    await page.keyboard.press("Control+1")
    const common = page.getByRole("button", { name: "将 cloudflare 分发给 通用目录", exact: true })
    const trae = page.getByRole("button", { name: "将 cloudflare 分发给 Trae", exact: true })
    await common.click()
    await expect(common).toHaveAttribute("aria-pressed", "true")
    await expect(trae).toHaveAttribute("aria-pressed", "true")
    await expect(toastText(page, /通用目录 与 Trae 共用同一目录.*已一起提供/)).toBeVisible()
    const after = await snapshot(page)
    const windows = after.deliveries.filter((d) => d.envId === "windows" && d.sharedAgentKeys?.includes("trae"))
    expect(windows.length).toBe(2)
    expect(new Set(windows.map((d) => d.unitId)).size).toBe(1)
    expect(windows.every((d) => d.status === "ok")).toBe(true)
    await trae.click()
    await expect(common).toHaveAttribute("aria-pressed", "false")
    await expect(trae).toHaveAttribute("aria-pressed", "false")
  })

  test("停用一个共用成员不会撤回另一个成员仍在使用的目录", async ({ page }) => {
    await ready(page, "?mock=shared")
    await page.getByRole("button", { name: "将 cloudflare 分发给 通用目录", exact: true }).click()
    await page.keyboard.press("Control+2")
    await agentRow(page, "Trae").getByRole("switch").click()
    const confirm = page.getByRole("alertdialog")
    await expect(confirm).toContainText("共用目录仍有其他 Agent 在用时会保留 Skill")
    await confirm.getByRole("button", { name: "停止同步", exact: true }).click()
    await expect(agentRow(page, "Trae").getByRole("switch")).not.toBeChecked()
    await expect(agentRow(page, "Trae")).toContainText("目录仍由共用的其他 Agent 使用")
    const state = await snapshot(page)
    const common = state.targets.find((t) => t.agentKey === "universal" && t.envId === "windows")!
    expect(state.deliveries.find((d) => d.targetId === common.id)?.status).toBe("ok")
  })

  test("WSL 共用 Windows 只显示未单独提供，不报冲突或同步失败", async ({ page }) => {
    await ready(page, "?mock=cross-env")
    await page.keyboard.press("Control+2")
    const common = agentRow(page, "通用目录")
    await expect(common).toContainText("与 Windows 共用目录，未单独提供")
    await expect(common).not.toContainText(/同名 Skill|同步没有成功/)
    const state = await snapshot(page)
    const wsl = state.targets.find((t) => t.agentKey === "universal" && t.envId.startsWith("wsl:"))!
    expect(state.deliveries.find((d) => d.targetId === wsl.id)).toMatchObject({ status: "shared", statusDetail: { id: "shared-windows" } })
  })

  test("写入失败的 Promise resolve 不冒报已同步，Agent 行展示路径原因", async ({ page }) => {
    await ready(page, "?mock=delivery-failed")
    const cursor = page.getByRole("button", { name: "将 hk-edge 分发给 Cursor", exact: true })
    await cursor.click()
    await expect(cursor).toHaveAttribute("aria-pressed", "false")
    await cursor.click()
    await expect(cursor).toHaveAttribute("aria-pressed", "true")
    await expect(toastText(page, /香港边缘节点 的选择已保存，但还没有同步成功/)).toContainText("目录链接目标不存在或无法访问")
    await page.keyboard.press("Control+2")
    await expect(agentRow(page, "Cursor")).toContainText("目录链接目标不存在或无法访问")
    await expect(agentRow(page, "Cursor")).not.toContainText("目录里已有同名 Skill")
  })
})
