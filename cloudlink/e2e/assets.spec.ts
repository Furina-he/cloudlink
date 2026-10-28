import { expect, test, type Page } from "@playwright/test"

// P2 验收：资产视图（PRD 6.4、6.5、6.10、6.11）
// 6.11 各状态的截图是验收证据，放仓库根目录 test-results/p2（本目录的 test-results 每次运行前会被清空）；
// 门槛要求的 4 张资产视图截图放 e2e/__screenshots__
const SHOTS = "../test-results/p2"
const GATE = "e2e/__screenshots__"

function collectConsoleErrors(page: Page) {
  const errors: string[] = []
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") errors.push(`[${m.type()}] ${m.text()}`)
  })
  page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`))
  return errors
}

/** 等外壳和夹具数据加载完：资产列表里出现选项 */
async function ready(page: Page, query = "") {
  await page.goto(`/${query}`)
  await expect(page.getByRole("heading", { level: 1, name: "资产" })).toBeVisible()
  await expect(page.getByRole("option").first()).toBeVisible()
}

const breadcrumb = (page: Page) => page.getByRole("navigation", { name: "当前位置" })

async function openAsset(page: Page, name: RegExp, title: string) {
  await page.getByRole("option", { name }).click()
  await expect(breadcrumb(page)).toContainText(title)
}

const tab = (page: Page, name: string) => page.getByRole("tab", { name: new RegExp(`^${name}`) })
const probeButton = (page: Page) => page.getByRole("button", { name: "探测", exact: true })
const saveButton = (page: Page) => page.getByRole("button", { name: /^保存/ })
const probePanel = (page: Page) => page.getByRole("region", { name: "探测" })
const preview = (page: Page) => page.locator("#preview")
/** 编辑器里的标签页内容（预览面板的文件切换也是 tabpanel，要分开） */
const editorPanel = (page: Page) => page.locator("#editor").getByRole("tabpanel")

test.describe("资产视图：PRD 6.11 状态", () => {
  test("首次加载：超过 150ms 显示 Skeleton", async ({ page }) => {
    await page.goto("/?mock=slow")
    await expect(page.locator("#assets-list [data-slot=skeleton]").first()).toBeVisible()
    await page.screenshot({ path: `${SHOTS}/state-01-loading.png`, animations: "disabled" })
    await expect(page.getByRole("option").first()).toBeVisible({ timeout: 10_000 })
  })

  test("列表为空：首次启动三步清单", async ({ page }) => {
    const errors = collectConsoleErrors(page)
    await page.goto("/?mock=empty")
    await expect(page.getByText("还没有任何云资产")).toBeVisible()
    const steps = page.getByRole("list", { name: "开始使用" }).getByRole("listitem")
    await expect(steps).toHaveCount(3)
    await expect(steps.nth(0)).toContainText("已发现 Windows、WSL Ubuntu-24.04")
    await expect(steps.nth(0)).toContainText("已完成")
    await expect(steps.nth(1)).toContainText("未完成")
    await expect(page.getByRole("button", { name: "开始导入" })).toBeVisible()
    await expect(page.getByRole("button", { name: "手动新建资产" })).toBeVisible()
    await page.screenshot({ path: `${SHOTS}/state-02-empty-first-launch.png`, animations: "disabled" })
    expect(errors).toEqual([])
  })

  test("筛选无结果：没有匹配的资产，清除筛选", async ({ page }) => {
    await ready(page)
    await page.keyboard.press("/")
    await page.keyboard.type("不存在的主机")
    await expect(page.getByText("没有匹配的资产")).toBeVisible()
    await page.screenshot({ path: `${SHOTS}/state-03-no-match.png`, animations: "disabled" })
    await page.getByRole("button", { name: "清除筛选" }).click()
    await expect(page.getByRole("option")).toHaveCount(3)
  })

  test("IPC 失败：错误提示带重试和打开日志目录，重试后恢复", async ({ page }) => {
    await page.goto("/?mock=fail")
    const alert = page.getByRole("alert").filter({ hasText: "加载数据失败" })
    await expect(alert).toContainText("database is locked")
    await expect(alert.getByRole("button", { name: "打开日志目录" })).toBeVisible()
    await expect(page.getByText("没能加载资产").first()).toBeVisible()
    await page.screenshot({ path: `${SHOTS}/state-04-ipc-error.png`, animations: "disabled" })
    await alert.getByRole("button", { name: "重试" }).click()
    await expect(page.getByRole("option")).toHaveCount(3)
    await expect(alert).toBeHidden()
  })

  test("对话框防误关：改动后按 Esc 先确认", async ({ page }) => {
    await ready(page)
    await page.getByRole("button", { name: "更多新建方式" }).click()
    await page.getByRole("menuitem", { name: "从 ssh config 导入" }).click()
    const dialog = page.getByRole("dialog", { name: "从 ssh config 导入主机" })
    await expect(dialog.getByRole("button", { name: "导入 2 台" })).toBeVisible()
    await dialog.getByRole("checkbox", { name: "选择 jp-relay" }).click()
    await page.keyboard.press("Escape")
    const confirm = page.getByRole("alertdialog", { name: "放弃这些更改？" })
    await expect(confirm).toBeVisible()
    await page.screenshot({ path: `${SHOTS}/state-05-dialog-guard.png`, animations: "disabled" })
    await confirm.getByRole("button", { name: "继续编辑" }).click()
    await expect(dialog.getByRole("button", { name: "导入 1 台" })).toBeVisible()
    await page.keyboard.press("Escape")
    await page.getByRole("button", { name: "放弃更改" }).click()
    await expect(dialog).toBeHidden()
  })

  test("编译：正常、有警告、受阻；点击受阻定位到 Lint 和源码行", async ({ page }) => {
    const errors = collectConsoleErrors(page)
    await ready(page)
    await openAsset(page, /香港轻量/, "香港轻量反代与边缘节点")
    await expect(page.getByText("编译正常")).toBeVisible()
    await expect(preview(page).getByText("没有发现问题")).toBeVisible()
    await page.screenshot({ path: `${SHOTS}/state-06a-compile-ok.png`, animations: "disabled" })

    await openAsset(page, /新加坡/, "新加坡数据库主机")
    await expect(page.getByText("有警告：1 条")).toBeVisible()
    await expect(preview(page)).toContainText("疑似包含指令")
    await page.screenshot({ path: `${SHOTS}/state-06b-compile-warning.png`, animations: "disabled" })

    await openAsset(page, /开发测试机/, "开发测试机")
    await page.getByRole("button", { name: /编译受阻：1 个错误/ }).click()
    const lintItem = preview(page).getByRole("button", { name: /疑似包含密钥/ })
    await expect(lintItem).toBeFocused()
    await page.screenshot({ path: `${SHOTS}/state-06c-compile-blocked.png`, animations: "disabled" })
    await lintItem.click()
    await expect(preview(page).getByRole("tab", { name: "notes.md" })).toHaveAttribute("aria-selected", "true")
    await expect(preview(page).locator('[data-line="3"]')).toHaveAttribute("aria-current", "true")
    await page.screenshot({ path: `${SHOTS}/state-06d-lint-located.png`, animations: "disabled" })
    expect(errors).toEqual([])
  })

  test("挂载状态：编辑器挂载页的状态词", async ({ page }) => {
    await ready(page)
    await openAsset(page, /香港轻量/, "香港轻量反代与边缘节点")
    await tab(page, "挂载").click()
    const list = editorPanel(page)
    await expect(list.getByText("已挂载（复制）")).toBeVisible()
    await expect(list.getByText("已挂载", { exact: true })).toBeVisible()
    await expect(list.getByText("复制模式待同步")).toBeVisible()
    await page.screenshot({ path: `${SHOTS}/state-07a-mounts-hk-edge.png`, animations: "disabled" })
    await openAsset(page, /新加坡/, "新加坡数据库主机")
    await expect(list.getByText("别名不可达")).toBeVisible()
    await expect(list.getByText("已失效")).toBeVisible()
    await page.screenshot({ path: `${SHOTS}/state-07b-mounts-sg-db.png`, animations: "disabled" })
    await openAsset(page, /开发测试机/, "开发测试机")
    await expect(list.getByText("冲突")).toBeVisible()
    await page.screenshot({ path: `${SHOTS}/state-07c-mounts-dev-box.png`, animations: "disabled" })
  })

  test("未保存修改：标题旁「未保存」，预览为草稿；Ctrl+S 保存", async ({ page }) => {
    const errors = collectConsoleErrors(page)
    await ready(page)
    await openAsset(page, /香港轻量/, "香港轻量反代与边缘节点")
    await page.locator("#asset-name").fill("香港边缘节点")
    await expect(page.getByText("未保存", { exact: true })).toBeVisible()
    await expect(preview(page).getByRole("heading", { name: "草稿预览" })).toBeVisible()
    await expect(preview(page).getByRole("heading", { level: 1 })).toContainText("香港边缘节点")
    await page.screenshot({ path: `${SHOTS}/state-08-draft.png`, animations: "disabled" })
    await page.keyboard.press("Control+s")
    await expect(page.getByText("已保存，已编译")).toBeVisible()
    await expect(page.getByText("未保存", { exact: true })).toBeHidden()
    await expect(page.getByRole("option", { name: /香港边缘节点/ })).toBeVisible()
    expect(errors).toEqual([])
  })

  test("长内容：名称和路径截断，悬停用 Tooltip 显示全文", async ({ page }) => {
    await ready(page)
    await openAsset(page, /香港轻量/, "香港轻量反代与边缘节点")
    await page.getByRole("option", { name: /香港轻量/ }).getByText("香港轻量反代与边缘节点").hover()
    await expect(page.locator("[data-slot=tooltip-content]")).toContainText("香港轻量反代与边缘节点")
    await page.screenshot({ path: `${SHOTS}/state-09-long-content.png`, animations: "disabled" })
  })

  test("窗口缩窄：小于 1200 预览默认折叠，小于 1024 侧栏进入图标模式", async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 760 })
    await ready(page)
    await openAsset(page, /香港轻量/, "香港轻量反代与边缘节点")
    const previewToggle = page.getByRole("button", { name: "预览" })
    const sidebar = page.locator("[data-slot=sidebar][data-state]")
    await expect(previewToggle).toHaveAttribute("aria-pressed", "false")
    await page.screenshot({ path: `${SHOTS}/state-10a-narrow-1100.png`, animations: "disabled" })
    // 放不下预览栏时，先把侧栏收成图标模式腾出空间
    await expect(sidebar).toHaveAttribute("data-state", "expanded")
    await page.keyboard.press("Control+Backslash")
    await expect(previewToggle).toHaveAttribute("aria-pressed", "true")
    await expect(sidebar).toHaveAttribute("data-state", "collapsed")
    await page.screenshot({ path: `${SHOTS}/state-10b-narrow-1100-preview.png`, animations: "disabled" })
    await page.keyboard.press("Control+Backslash")
    await expect(previewToggle).toHaveAttribute("aria-pressed", "false")
    await page.setViewportSize({ width: 1000, height: 700 })
    await page.reload()
    await expect(page.getByRole("option").first()).toBeVisible()
    await expect(page.locator("[data-slot=sidebar][data-state]")).toHaveAttribute("data-state", "collapsed")
    await page.screenshot({ path: `${SHOTS}/state-10c-narrow-1000.png`, animations: "disabled" })
  })
})

test.describe("资产视图：探测（PRD 6.5）", () => {
  test("运行中 → 审阅变更 → 应用所选并编译", async ({ page }) => {
    const errors = collectConsoleErrors(page)
    await ready(page)
    await openAsset(page, /香港轻量/, "香港轻量反代与边缘节点")
    await probeButton(page).click()
    await expect(page.getByRole("button", { name: "取消探测" })).toBeVisible()
    await expect(probePanel(page)).toContainText("正在探测 hk-edge")
    await expect(probePanel(page).getByRole("listitem").first()).toContainText("解析别名")
    await page.screenshot({ path: `${SHOTS}/state-11a-probe-running.png`, animations: "disabled" })

    await expect(probePanel(page)).toContainText("探测结果", { timeout: 8_000 })
    const changes = probePanel(page).getByRole("checkbox")
    await expect(changes).toHaveCount(4)
    // 「未发现」默认不勾
    await expect(changes.nth(2)).not.toBeChecked()
    await probePanel(page).getByRole("button", { name: "前后对比：系统" }).click()
    await expect(probePanel(page).locator("[data-variant=removed]")).toContainText("Ubuntu 22.04 LTS")
    await page.screenshot({ path: `${SHOTS}/state-11b-probe-changes.png`, animations: "disabled" })

    await probePanel(page).getByRole("button", { name: "应用所选 3 项并编译" }).click()
    await expect(probePanel(page)).toContainText("已应用 3 项变更并编译")
    await expect(page.getByText("已保存，已编译")).toBeVisible()
    await tab(page, "服务").click()
    await expect(editorPanel(page)).toContainText("api-gateway")
    expect(errors).toEqual([])
  })

  test("失败：分类文案、建议和终端命令", async ({ page }) => {
    await ready(page)
    await openAsset(page, /新加坡/, "新加坡数据库主机")
    await probeButton(page).click()
    const alert = probePanel(page).getByRole("alert")
    await expect(alert).toContainText("本机还不认识 sg-db 的主机密钥", { timeout: 8_000 })
    await expect(alert).toContainText("CloudLink 不会自动信任主机密钥")
    await expect(probePanel(page).locator("[data-slot=code-block]")).toContainText("ssh sg-db")
    await expect(page.getByRole("option", { name: /新加坡/ })).toContainText("失败")
    await page.screenshot({ path: `${SHOTS}/state-11c-probe-failed.png`, animations: "disabled" })
  })

  test("无变更只显示一行；运行中可以取消", async ({ page }) => {
    await ready(page)
    await openAsset(page, /开发测试机/, "开发测试机")
    await probeButton(page).click()
    await expect(probePanel(page)).toContainText("未发现变更，已更新探测时间", { timeout: 8_000 })
    await page.screenshot({ path: `${SHOTS}/state-11d-probe-no-changes.png`, animations: "disabled" })

    await openAsset(page, /香港轻量/, "香港轻量反代与边缘节点")
    await probeButton(page).click()
    await page.getByRole("button", { name: "取消探测" }).click()
    await expect(probePanel(page)).toContainText("已取消探测")
    await expect(probeButton(page)).toBeVisible()
    await page.screenshot({ path: `${SHOTS}/state-11e-probe-cancelled.png`, animations: "disabled" })
  })

  test("离开资产后探测完成：Toast 的「查看」回到结果", async ({ page }) => {
    await ready(page)
    await openAsset(page, /香港轻量/, "香港轻量反代与边缘节点")
    await probeButton(page).click()
    await openAsset(page, /开发测试机/, "开发测试机")
    const toast = page.locator("[data-slot=toast]").filter({ hasText: "hk-edge 探测完成，发现 4 处变更" })
    await expect(toast).toBeVisible({ timeout: 8_000 })
    await page.screenshot({ path: `${SHOTS}/state-11f-probe-toast.png`, animations: "disabled" })
    await toast.getByRole("button", { name: "查看" }).click()
    await expect(breadcrumb(page)).toContainText("香港轻量反代与边缘节点")
    await expect(probePanel(page)).toContainText("探测结果")
    await expect(toast).toBeHidden()
  })
})

test.describe("资产视图：编辑与键盘", () => {
  test("保存校验失败：标出各标签页错误数，切到第一个出错的标签页并聚焦", async ({ page }) => {
    await ready(page)
    await openAsset(page, /香港轻量/, "香港轻量反代与边缘节点")
    await page.locator("#asset-name").fill("")
    await tab(page, "路径").click()
    await page.getByRole("button", { name: "添加路径" }).click()
    await page.keyboard.press("Control+s")
    await expect(tab(page, "概览")).toHaveAttribute("aria-selected", "true")
    await expect(tab(page, "概览")).toContainText("1 处错误")
    await expect(tab(page, "路径")).toContainText("2 处错误")
    await expect(page.locator("#asset-name")).toBeFocused()
    await expect(page.getByText("请填写名称")).toBeVisible()
    await page.screenshot({ path: `${SHOTS}/state-12-save-invalid.png`, animations: "disabled" })
  })

  test("离开有未保存修改的资产要确认：切资产、切视图", async ({ page }) => {
    await ready(page)
    await openAsset(page, /香港轻量/, "香港轻量反代与边缘节点")
    await page.locator("#asset-name").fill("草稿")
    await page.getByRole("option", { name: /新加坡/ }).click()
    const confirm = page.getByRole("alertdialog", { name: "放弃未保存的修改？" })
    await expect(confirm).toBeVisible()
    await page.screenshot({ path: `${SHOTS}/state-13-leave-guard.png`, animations: "disabled" })
    await confirm.getByRole("button", { name: "继续编辑" }).click()
    await expect(breadcrumb(page)).toContainText("香港轻量反代与边缘节点")
    await expect(page.locator("#asset-name")).toHaveValue("草稿")

    await page.keyboard.press("Control+2")
    await expect(confirm).toBeVisible()
    await confirm.getByRole("button", { name: "放弃修改" }).click()
    await expect(page.getByRole("heading", { level: 1, name: "Skills" })).toBeVisible()
    await page.keyboard.press("Control+1")
    await expect(page.locator("#asset-name")).toHaveValue("香港轻量反代与边缘节点")
  })

  test("键盘：方向键移动、Enter 打开、Tab 遍历表单、键盘拖拽排序", async ({ page }) => {
    const errors = collectConsoleErrors(page)
    await ready(page)
    await page.keyboard.press("/")
    await expect(page.getByRole("combobox", { name: "搜索资产" })).toBeFocused()
    await page.keyboard.press("ArrowDown")
    const highlighted = page.locator("#assets-list [role=option][aria-selected=true]")
    await expect(highlighted).toHaveCount(1)
    const target = (await highlighted.textContent()) ?? ""
    await page.keyboard.press("Enter")
    await expect(breadcrumb(page)).toContainText(target.includes("新加坡") ? "新加坡数据库主机" : target.includes("开发") ? "开发测试机" : "香港轻量反代与边缘节点")

    // Tab 遍历表单：名称 → Slug → 重命名 → 环境
    await page.locator("#asset-name").focus()
    await page.keyboard.press("Tab")
    await expect(page.locator("#asset-slug")).toBeFocused()
    await page.keyboard.press("Tab")
    await expect(page.getByRole("button", { name: "重命名", exact: true })).toBeFocused()
    await page.keyboard.press("Tab")
    await expect(page.getByRole("button", { name: /生产|预发|开发/ }).and(page.locator(":focus"))).toHaveCount(1)

    // 键盘拖拽排序：空格拿起、方向键移动、空格放下
    await openAsset(page, /香港轻量/, "香港轻量反代与边缘节点")
    await tab(page, "路径").click()
    const labels = page.getByRole("textbox", { name: /条路径的用途/ })
    await expect(labels.first()).toHaveValue("OpenResty 站点配置目录")
    // dnd-kit 的键盘传感器拿起后要一帧才开始响应方向键，按键之间留一点间隔
    await page.getByRole("button", { name: "拖动排序：第 1 条路径" }).focus()
    for (const key of ["Space", "ArrowDown", "Space"]) {
      await page.keyboard.press(key)
      await page.waitForTimeout(150)
    }
    await expect(labels.nth(0)).toHaveValue("Docker Compose 编排目录")
    await expect(labels.nth(1)).toHaveValue("OpenResty 站点配置目录")
    await expect(page.locator("[id^=DndLiveRegion]")).toContainText("已放到第 2 项")
    await expect(page.getByText("未保存", { exact: true })).toBeVisible()
    await page.screenshot({ path: `${SHOTS}/state-14-keyboard-sorted.png`, animations: "disabled" })
    expect(errors).toEqual([])
  })

  test("承载的站点：域名写进 description，不收 IP", async ({ page }) => {
    await ready(page)
    await openAsset(page, /新加坡/, "新加坡数据库主机")
    const input = page.getByRole("combobox", { name: /承载的站点/ })
    await input.fill("203.0.113.10")
    await expect(page.getByText("输入域名，例如 api.example.com；不要写 IP 地址")).toBeVisible()
    await input.fill("Pg.Example.com")
    await page.getByRole("option", { name: "使用「pg.example.com」" }).click()
    await expect(page.getByRole("button", { name: "移除 pg.example.com" })).toBeVisible()
    // 草稿预览：description 里出现新站点
    await expect(preview(page).locator("[data-slot=code-block]").first()).toContainText("involves sg-db, pg.example.com")
    await page.screenshot({ path: `${SHOTS}/state-19-served-hostnames.png`, animations: "disabled" })
    await page.keyboard.press("Control+s")
    await expect(page.getByText("已保存，已编译")).toBeVisible()
  })

  test("新建资产：slug 跟随别名，保存后出现在列表并选中", async ({ page }) => {
    await ready(page)
    await page.getByRole("button", { name: "新建资产", exact: true }).click()
    await expect(breadcrumb(page)).toContainText("新建资产")
    await page.locator("#asset-name").fill("东京中转机")
    await tab(page, "连接").click()
    await page.locator("#asset-alias").fill("jp-relay")
    await page.getByRole("option", { name: /^jp-relay/ }).click()
    await expect(editorPanel(page)).toContainText("未定义，该环境的 Agent 无法连接")
    await tab(page, "概览").click()
    await expect(page.locator("#asset-slug")).toHaveValue("vps-jp-relay")
    await saveButton(page).click()
    await expect(breadcrumb(page)).toContainText("东京中转机")
    await expect(page.getByRole("option", { name: /东京中转机/ })).toHaveAttribute("aria-current", "true")
    await expect(page.getByText("已保存，已编译")).toBeVisible()
  })

  test("导入：默认勾选新主机，导入后立即探测，选中第一台", async ({ page }) => {
    await ready(page)
    await page.keyboard.press("Control+k")
    await page.keyboard.type("从 ssh config 导入")
    await expect(page.getByRole("dialog").getByRole("option", { selected: true })).toContainText("从 ssh config 导入")
    await page.keyboard.press("Enter")
    const dialog = page.getByRole("dialog", { name: "从 ssh config 导入主机" })
    await expect(dialog.getByRole("checkbox", { name: "选择 hk-edge" })).not.toBeChecked()
    await expect(dialog.getByRole("checkbox", { name: "选择 jp-relay" })).toBeChecked()
    await expect(dialog).toContainText("已跳过 2 个通配 Host（Host *、Host *.internal）")
    await page.screenshot({ path: `${SHOTS}/state-15-import-dialog.png`, animations: "disabled" })
    await dialog.getByRole("switch", { name: "导入后立即探测" }).click()
    await dialog.getByRole("button", { name: "导入 2 台" }).click()
    await expect(dialog).toBeHidden()
    await expect(breadcrumb(page)).toContainText("jp-relay")
    await expect(page.getByRole("option", { name: /us-backup/ })).toContainText("探测中")
    await expect(probePanel(page)).toContainText("正在探测 jp-relay")
    await page.screenshot({ path: `${SHOTS}/state-16-imported-probing.png`, animations: "disabled" })
  })

  test("重命名迁移与删除资产（列出级联卸载的挂载）", async ({ page }) => {
    await ready(page)
    await openAsset(page, /香港轻量/, "香港轻量反代与边缘节点")
    await page.getByRole("button", { name: "重命名", exact: true }).click()
    const rename = page.getByRole("dialog", { name: "重命名迁移" })
    await expect(rename).toContainText("将重建的挂载")
    await rename.getByLabel("新 slug").fill("vps-hk-proxy")
    await rename.getByRole("button", { name: "重命名并重建 3 个挂载" }).click()
    await expect(rename).toBeHidden()
    await expect(page.locator("#asset-slug")).toHaveValue("vps-hk-proxy")

    await openAsset(page, /新加坡/, "新加坡数据库主机")
    await page.getByRole("button", { name: "更多操作" }).click()
    await page.getByRole("menuitem", { name: "删除资产" }).click()
    const del = page.getByRole("alertdialog", { name: /删除资产/ })
    await expect(del).toContainText("以下 2 个挂载会被一并卸载")
    await page.screenshot({ path: `${SHOTS}/state-17-delete.png`, animations: "disabled" })
    await del.getByRole("button", { name: "删除资产" }).click()
    await expect(page.getByText("已删除 新加坡数据库主机，卸载了 2 个挂载")).toBeVisible()
    await expect(page.getByRole("option", { name: /新加坡/ })).toHaveCount(0)
  })

  test("挂载到…：生产挂全局、别名不可达要确认，成功后给出生效提示", async ({ page }) => {
    const errors = collectConsoleErrors(page)
    await ready(page)
    await openAsset(page, /新加坡/, "新加坡数据库主机")
    await tab(page, "挂载").click()
    const panel = editorPanel(page)
    await panel.getByLabel("挂载到…").click()
    await page.getByRole("option", { name: /通用 .agents - 全局/ }).click()
    const confirm = page.getByRole("alertdialog", { name: "把生产资产挂到全局？" })
    await expect(confirm).toContainText("所有项目中读取这个全局目录的 Agent 都会看到它")
    await page.screenshot({ path: `${SHOTS}/state-18-mount-confirm.png`, animations: "disabled" })
    await confirm.getByRole("button", { name: "仍然挂载" }).click()
    await expect(page.getByText("已把 vps-sg-db 挂载到 通用 .agents - 全局")).toBeVisible()
    await expect(page.getByText(/Codex：通过链接更新内容后/)).toBeVisible()

    await panel.getByLabel("挂载到…").click()
    await page.getByRole("option", { name: /Blog-Astro/ }).click()
    const alias = page.getByRole("alertdialog", { name: "该环境中的 Agent 无法连接" })
    await expect(alias).toContainText("sg-db 没有定义在 Windows 的 ssh config 里")
    await alias.getByRole("button", { name: "仍然挂载" }).click()
    await expect(panel.getByText("别名不可达")).toHaveCount(2)
    expect(errors).toEqual([])
  })
})

test.describe("资产视图：门槛截图", () => {
  for (const scheme of ["light", "dark"] as const) {
    for (const width of [1280, 1024]) {
      test(`${scheme} ${width}`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: scheme })
        await page.setViewportSize({ width, height: 800 })
        await ready(page)
        await openAsset(page, /香港轻量/, "香港轻量反代与边缘节点")
        if (width >= 1200) await expect(preview(page).getByText("没有发现问题")).toBeVisible()
        // 焦点环：键盘把焦点移到列表搜索框
        await page.keyboard.press("/")
        await expect(page.getByRole("combobox", { name: "搜索资产" })).toBeFocused()
        await page.screenshot({ path: `${GATE}/assets-${scheme}-${width}.png`, animations: "disabled" })
      })
    }
  }
})
