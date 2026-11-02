import { expect, test, type Page } from "@playwright/test"

import { breadcrumb, card, collectConsoleErrors, openServer, ready, shot, toastText } from "./helpers"

// 服务器视图（PRD 6.4、6.5、6.10）：状态、测试连接的 5 种结果、探测的 3 种结果、纯键盘流程

/** 新建表单：填名称和地址；认证方式选 ssh-agent，不用选私钥文件 */
async function fillNew(page: Page, name: string, host: string, user = "root") {
  await page.keyboard.press("Control+n")
  const form = page.getByRole("region", { name: "新建服务器" })
  await expect(form.getByLabel("名称")).toBeFocused()
  await page.keyboard.type(name)
  await form.getByLabel("地址").fill(host)
  await form.getByLabel("用户").fill(user)
  await form.getByRole("radio", { name: "ssh-agent" }).or(form.getByRole("button", { name: "ssh-agent" })).click()
  return form
}

const testButton = (page: Page) => page.getByRole("region", { name: "新建服务器" }).getByRole("button", { name: "测试连接" })

test.describe("服务器视图：PRD 6.10 状态", () => {
  test("首次加载：超过 150ms 显示 Skeleton", async ({ page }) => {
    await page.goto("/?mock=slow")
    await expect(page.locator("#server-list [data-slot=skeleton]").first()).toBeVisible()
    await shot(page, "state-01-loading")
    await expect(card(page, "hk-edge")).toBeVisible({ timeout: 10_000 })
  })

  test("列表为空：首次启动四步清单，可新建或导入", async ({ page }) => {
    const errors = collectConsoleErrors(page)
    await page.goto("/?mock=empty")
    const steps = page.getByRole("list", { name: "开始使用" }).getByRole("listitem")
    await expect(steps).toHaveCount(4)
    await expect(steps.nth(0)).toContainText("已完成")
    await expect(steps.nth(1)).toContainText("未完成")
    await expect(page.getByRole("button", { name: "新建服务器" })).toBeVisible()
    await expect(page.getByRole("button", { name: "从 ssh config 导入" })).toBeVisible()
    await shot(page, "state-02-empty")
    expect(errors).toEqual([])
  })

  test("搜索无结果：没有匹配的服务器，清除搜索", async ({ page }) => {
    await ready(page)
    await page.keyboard.press("/")
    await page.keyboard.type("不存在的主机")
    await expect(page.getByText("没有匹配的服务器")).toBeVisible()
    await shot(page, "state-03-no-match")
    await page.locator("#server-list").getByRole("button", { name: "清除搜索" }).click()
    await expect(card(page, "dev-box")).toBeVisible()
  })

  test("IPC 失败：错误提示带重试和打开日志目录，重试后恢复", async ({ page }) => {
    await page.goto("/?mock=fail")
    const alert = page.getByRole("alert").filter({ hasText: "加载数据失败" })
    await expect(alert).toContainText("database is locked")
    await expect(alert.getByRole("button", { name: "打开日志目录" })).toBeVisible()
    await shot(page, "state-04-ipc-error")
    await alert.getByRole("button", { name: "重试" }).click()
    await expect(card(page, "hk-edge")).toBeVisible()
    await expect(alert).toBeHidden()
  })

  test("详情：Agent 分段、列入原因、笔记、编译警告、临时解锁", async ({ page }) => {
    const errors = collectConsoleErrors(page)
    await ready(page)
    await openServer(page, "hk-edge")
    const detail = page.locator("#detail-title").locator("xpath=ancestor::section[1]")
    await expect(detail.getByText("WSL Ubuntu-24.04 中没有配置私钥")).toBeVisible()
    await expect(detail.getByText("3 条 Agent 笔记待处理")).toBeVisible()
    await shot(page, "state-05-detail-hk-edge")

    await openServer(page, "sg-db")
    await expect(page.getByText(/有警告：1 条/)).toBeVisible()
    await expect(page.getByText(/已解锁，还剩 2\d 分钟/)).toBeVisible()
    await expect(page.getByText("疑似注入").first()).toBeVisible()
    await shot(page, "state-06-detail-sg-db")

    await openServer(page, "dev-box")
    await expect(page.getByText("未验证").first()).toBeVisible()
    await shot(page, "state-07-detail-dev-box")
    expect(errors).toEqual([])
  })

  test("编译受阻：详情头部摘要，点击打开预览并定位到检查结果", async ({ page }) => {
    await ready(page, "?mock=degraded")
    await openServer(page, "hk-edge")
    const blocked = page.getByRole("button", { name: /编译受阻/ })
    await expect(blocked).toBeVisible()
    await shot(page, "state-08-compile-blocked")
    await blocked.click()
    await expect(page.getByRole("dialog", { name: "预览 Skill" })).toBeVisible()
    await shot(page, "state-09-preview-lint")
  })

  test("未保存修改：底部操作条；切换服务器时确认放弃", async ({ page }) => {
    await ready(page)
    await openServer(page, "dev-box")
    await page.getByRole("button", { name: /基本信息/ }).click()
    await page.getByRole("textbox", { name: /^名称/ }).fill("开发机（改）")
    await expect(page.getByText("未保存的修改")).toBeVisible()
    await shot(page, "state-10-draft")
    await card(page, "hk-edge").click()
    const leave = page.getByRole("alertdialog", { name: "放弃未保存的修改？" })
    await expect(leave).toBeVisible()
    await shot(page, "state-11-leave")
    await leave.getByRole("button", { name: "继续编辑" }).click()
    await expect(breadcrumb(page)).toContainText("dev-box")
    await page.getByRole("button", { name: "放弃", exact: true }).click()
    await expect(page.getByText("未保存的修改")).toBeHidden()
  })
  test("卡片上点选 Agent：分发给通用后，详情列出它在各运行环境的列入情况；不能分发的卡片只显示原因", async ({ page }) => {
    const errors = collectConsoleErrors(page)
    await ready(page)
    const list = page.locator("#server-list")
    const universal = list.getByRole("button", { name: "将 hk-edge 分发给 通用（Codex 等）" })
    await expect(list.getByRole("button", { name: "将 hk-edge 分发给 Claude Code" })).toHaveAttribute("aria-pressed", "true")
    await expect(universal).toHaveAttribute("aria-pressed", "false")
    await universal.click()
    await expect(universal).toHaveAttribute("aria-pressed", "true")
    await expect(toastText(page, "已把 hk-edge 分发给 通用（Codex 等）")).toBeVisible()
    // 点按钮不打开详情
    await expect(breadcrumb(page)).not.toContainText("hk-edge")

    await openServer(page, "hk-edge")
    // 通用只在 WSL 启用；hk-edge 在 WSL 没有配置私钥，所以未列入
    const row = page.getByRole("listitem").filter({ hasText: "通用（WSL Ubuntu-24.04）" })
    await expect(row).toContainText("未列入")
    await expect(row.getByRole("button", { name: "配置私钥" })).toBeVisible()
    await expect(page.getByRole("listitem").filter({ hasText: "Claude Code（Windows）" })).toContainText("已列入")
    await shot(page, "state-15-agent-picker")

    // dev-box 只用密码：没有 Agent 按钮，只说明原因
    await expect(list.getByText("先改用密钥登录才能分发")).toBeVisible()
    await expect(list.getByRole("button", { name: /^将 dev-box 分发给/ })).toHaveCount(0)
    expect(errors).toEqual([])
  })
})
test.describe("测试连接：5 种结果（PRD 6.5、7.8）", () => {
  test("成功：已信任的地址直接连上", async ({ page }) => {
    await ready(page)
    await fillNew(page, "Edge Copy", "203.0.113.10")
    await testButton(page).click()
    await expect(page.getByText(/^已连接 · /)).toBeVisible()
    await shot(page, "test-01-ok")
  })

  test("超时", async ({ page }) => {
    await ready(page)
    await fillNew(page, "Slow Box", "timeout.example.com")
    await testButton(page).click()
    await expect(page.getByText("正在连接…")).toBeVisible()
    await expect(page.getByText(/超时（10 秒）/)).toBeVisible({ timeout: 5000 })
    await shot(page, "test-02-timeout")
  })

  test("拒绝连接", async ({ page }) => {
    await ready(page)
    await fillNew(page, "Closed Box", "refused.example.com")
    await testButton(page).click()
    await expect(page.getByText(/SSH 端口拒绝连接/)).toBeVisible()
    await shot(page, "test-03-refused")
  })

  test("认证失败", async ({ page }) => {
    await ready(page)
    await fillNew(page, "Bad User", "203.0.113.10", "bad")
    await testButton(page).click()
    await expect(page.getByText(/拒绝了密钥认证/)).toBeVisible()
    await shot(page, "test-04-auth-failed")
  })

  test("首次连接：核对指纹后信任，接着连上并保存", async ({ page }) => {
    const errors = collectConsoleErrors(page)
    await ready(page)
    await fillNew(page, "Tokyo Relay", "198.51.100.20")
    await testButton(page).click()
    const dialog = page.getByRole("alertdialog", { name: "首次连接，请核对主机指纹" })
    await expect(dialog).toContainText("SHA256:")
    await shot(page, "test-05-host-key")
    await dialog.getByRole("button", { name: "信任并继续" }).click()
    await expect(page.getByText(/^已连接 · /)).toBeVisible()
    await page.keyboard.press("Control+s")
    // WSL 还没有加入 Include：先问一次（F-107 AC1）
    const include = page.getByRole("alertdialog", { name: "把托管配置加入 ~/.ssh/config？" })
    await expect(include).toBeVisible()
    await include.getByRole("button", { name: "暂不加入" }).click()
    // 测试通过后保存即「保存并探测」：探测 Sheet 打开（F-106）
    await expect(page.getByRole("dialog", { name: "探测完成 tokyo-relay" })).toBeVisible({ timeout: 10_000 })
    await page.keyboard.press("Escape")
    await expect(breadcrumb(page)).toContainText("tokyo-relay")
    await expect(card(page, "tokyo-relay")).toBeVisible()
    expect(errors).toEqual([])
  })
})

test.describe("探测：3 种结果（PRD 6.4 探测流程）", () => {
  test("已更新并有待确认项；合并所选；撤销本次更新", async ({ page }) => {
    const errors = collectConsoleErrors(page)
    await ready(page)
    await openServer(page, "hk-edge")
    await page.getByRole("button", { name: "探测", exact: true }).click()
    const sheet = page.getByRole("dialog", { name: /探测/ })
    await expect(sheet.getByText(/已更新 \d+ 处，已重新编译/)).toBeVisible({ timeout: 10_000 })
    await expect(sheet.getByText(/待确认 1 处/)).toBeVisible()
    await shot(page, "probe-01-updated-held")

    await sheet.getByRole("checkbox").first().check()
    await sheet.getByRole("button", { name: /合并所选 1 项/ }).click()
    await expect(sheet.getByText(/已合并 1 处待确认项/)).toBeVisible()
    await shot(page, "probe-02-merged")

    await sheet.getByRole("button", { name: "撤销本次更新" }).click()
    await expect(sheet.getByText("已撤销本次更新，已重新编译")).toBeVisible()
    await shot(page, "probe-03-undone")
    expect(errors).toEqual([])
  })

  test("失败：主机密钥未信任，给出分类文案和测试连接入口", async ({ page }) => {
    await ready(page)
    await openServer(page, "sg-db")
    await page.getByRole("button", { name: "探测", exact: true }).click()
    const sheet = page.getByRole("dialog", { name: /探测/ })
    await expect(sheet.getByText(/还不认识 sg-db 的主机密钥/)).toBeVisible({ timeout: 10_000 })
    await expect(sheet.getByRole("button", { name: "测试连接" })).toBeVisible()
    await shot(page, "probe-04-failed")
  })
})

test.describe("纯键盘流程（P3.5 门槛）", () => {
  test("Ctrl+N 新建、填写、测试、保存", async ({ page }) => {
    await ready(page)
    await page.keyboard.press("Control+n")
    // 新建表单挂载后把焦点放到名称上，等它就位再输入
    await expect(page.getByRole("textbox", { name: /^名称/ })).toBeFocused()
    await page.keyboard.type("Keyboard Box")
    await page.keyboard.press("Tab")
    await page.keyboard.type("203.0.113.10")
    // 端口、用户保持默认；用 ssh-agent 认证
    const agent = page.getByRole("radio", { name: "ssh-agent" }).or(page.getByRole("button", { name: "ssh-agent" }))
    await agent.focus()
    await page.keyboard.press("Space")
    await testButton(page).focus()
    await page.keyboard.press("Enter")
    await expect(page.getByText(/^已连接 · /)).toBeVisible()
    await page.keyboard.press("Control+s")
    const include = page.getByRole("alertdialog", { name: "把托管配置加入 ~/.ssh/config？" })
    await expect(include).toBeVisible()
    // Esc 会取消这次保存；用键盘选「暂不加入」
    await include.getByRole("button", { name: "暂不加入" }).focus()
    await page.keyboard.press("Enter")
    await expect(page.getByRole("dialog", { name: "探测完成 keyboard-box" })).toBeVisible({ timeout: 10_000 })
    await page.keyboard.press("Escape")
    await expect(card(page, "keyboard-box")).toBeVisible()
  })

  test("方向键在卡片间移动，Enter 打开；方向键在 Agent 按钮间移动，Space 切换", async ({ page }) => {
    await ready(page)
    await card(page, "hk-edge").focus()
    await page.keyboard.press("ArrowDown")
    await expect(card(page, "sg-db")).toBeFocused()
    await page.keyboard.press("ArrowDown")
    await expect(card(page, "dev-box")).toBeFocused()
    await page.keyboard.press("Home")
    await expect(card(page, "hk-edge")).toBeFocused()
    await page.keyboard.press("Enter")
    await expect(breadcrumb(page)).toContainText("hk-edge")

    // 卡片和详情各有一组 Agent 按钮，这里用卡片上的
    const list = page.locator("#server-list")
    const claude = list.getByRole("button", { name: "将 hk-edge 分发给 Claude Code" })
    const universal = list.getByRole("button", { name: "将 hk-edge 分发给 通用（Codex 等）" })
    await claude.focus()
    await page.keyboard.press("ArrowRight")
    await expect(universal).toBeFocused()
    await page.keyboard.press("ArrowLeft")
    await expect(claude).toBeFocused()
    await page.keyboard.press("Space")
    await expect(claude).toHaveAttribute("aria-pressed", "false")
    await expect(toastText(page, "hk-edge 已停止分发给 Claude Code")).toBeVisible()
    await page.keyboard.press("Space")
    await expect(claude).toHaveAttribute("aria-pressed", "true")
  })

  test("命令面板可以临时解锁、立即锁回", async ({ page }) => {
    await ready(page)
    await openServer(page, "dev-box")
    await page.keyboard.press("Control+k")
    await page.keyboard.type("临时解锁")
    await page.keyboard.press("Enter")
    await expect(toastText(page, "已解锁 dev-box 30 分钟")).toBeVisible()
    // 等解锁写回 store（详情里出现剩余时间），命令才会换成「立即锁回」
    await expect(page.getByText(/已解锁，还剩 30 分钟/)).toBeVisible()
    await page.keyboard.press("Control+k")
    await expect(page.getByRole("option", { name: "立即锁回当前服务器" })).toBeVisible()
    await page.keyboard.type("立即锁回")
    await page.keyboard.press("Enter")
    await expect(toastText(page, "已锁回 dev-box")).toBeVisible()
  })
})