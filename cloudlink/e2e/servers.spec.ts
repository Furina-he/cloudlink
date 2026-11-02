import { expect, test, type Page } from "@playwright/test"

import { back, collectConsoleErrors, detailTitle, inspector, openServer, ready, refocusWindow, row, shot, toastText } from "./helpers"

// 资源视图（PRD 6.4、6.5、6.10）：单行双闸刀配电盘、全宽详情（← 返回）、添加弹窗、SSH 一步到位、云平台 CLI 向导

const sshForm = (page: Page) => page.getByRole("region", { name: "添加 SSH 服务器" })
const connectEnable = (page: Page) => sshForm(page).getByRole("button", { name: /连接并启用/ })

/** 添加 SSH 服务器：填地址、用户和名称；认证方式默认选 ssh-agent，不用选私钥文件 */
async function fillNew(page: Page, name: string, host: string, user = "root", method = "ssh-agent") {
  await page.keyboard.press("Control+n")
  await page.getByRole("button", { name: /^SSH 服务器/ }).click()
  const form = sshForm(page)
  await expect(form.getByLabel("地址")).toBeFocused()
  await form.getByLabel("地址").fill(host)
  await form.getByLabel("用户").fill(user)
  await form.getByRole("radio", { name: method, exact: true }).or(form.getByRole("button", { name: method, exact: true })).click()
  await form.getByLabel(/^名称/).fill(name)
  return form
}

test.describe("资源视图：PRD 6.10 状态", () => {
  test("首次加载：超过 150ms 显示 Skeleton", async ({ page }) => {
    await page.goto("/?mock=slow")
    await expect(page.locator("#server-list [data-slot=skeleton]").first()).toBeVisible()
    await shot(page, "state-01-loading")
    await expect(row(page, "hk-edge")).toBeVisible({ timeout: 10_000 })
  })

  test("列表为空：Empty 直接给出添加 SSH 服务器、连接云平台 CLI、导入三个入口", async ({ page }) => {
    const errors = collectConsoleErrors(page)
    await page.goto("/?mock=empty")
    await expect(page.getByText("还没有资源")).toBeVisible()
    for (const name of ["添加 SSH 服务器", "连接云平台 CLI（Cloudflare / Vercel / Oracle）", "从 ssh config 导入"]) {
      await expect(page.getByRole("button", { name })).toBeVisible()
    }
    await expect(page.getByRole("list", { name: "开始使用" })).toHaveCount(0)
    await shot(page, "state-02-empty")
    expect(errors).toEqual([])
  })

  test("搜索无结果：没有匹配的资源，清除搜索", async ({ page }) => {
    await ready(page)
    await page.keyboard.press("/")
    await page.keyboard.type("不存在的主机")
    await expect(page.getByText("没有匹配的资源")).toBeVisible()
    await shot(page, "state-03-no-match")
    await page.locator("#server-list").getByRole("button", { name: "清除搜索" }).click()
    await expect(row(page, "dev-box")).toBeVisible()
  })

  test("IPC 失败：错误提示带重试和打开日志目录，重试后恢复", async ({ page }) => {
    await page.goto("/?mock=fail")
    const alert = page.getByRole("alert").filter({ hasText: "加载数据失败" })
    await expect(alert).toContainText("database is locked")
    await expect(alert.getByRole("button", { name: "打开日志目录" })).toBeVisible()
    await shot(page, "state-04-ipc-error")
    await alert.getByRole("button", { name: "重试" }).click()
    await expect(row(page, "hk-edge")).toBeVisible()
    await expect(alert).toBeHidden()
  })

  test("首屏：单列两组单行回路；生产标准运维琥珀色提醒；异常就地给出修复按钮；没有第二行统计和重复命名", async ({ page }) => {
    const errors = collectConsoleErrors(page)
    await ready(page)
    await expect(page.locator("#detail-title")).toHaveCount(0)
    await expect(page.getByRole("heading", { level: 2, name: "服务器", exact: true })).toBeVisible()
    await expect(page.getByRole("heading", { level: 2, name: "云平台", exact: true })).toBeVisible()
    await expect(page.getByText("权限档位")).toHaveCount(0)
    // sg-db 是生产服务器，开着标准运维：闸刀按钮带提醒文案（状态不只靠颜色）
    await expect(page.getByRole("button", { name: /^sg-db 当前是标准运维.*生产环境已开启写权限/ })).toBeVisible()
    await expect(page.getByRole("button", { name: /^hk-edge 当前是只读巡检/ })).toBeVisible()
    // dev-box 只用密码；vercel 在 WSL 未登录
    const list = page.locator("#server-list")
    await expect(list.getByRole("button", { name: "改用密钥登录" })).toBeVisible()
    await expect(list.getByText("WSL 未登录")).toBeVisible()
    await expect(list.getByRole("button", { name: "去登录" })).toBeVisible()
    await expect(list.getByText("me@example.com · 2 个域名、1 个 Worker")).toBeVisible()
    // 正常连接不写「已连接 · Ubuntu …」，云平台不写「vercel Vercel · vercel」
    await expect(list.getByText(/已连接|Ubuntu|已就绪|生产环境已开启写权限/)).toHaveCount(0)
    await expect(list.getByText("wrangler")).toHaveCount(0)
    await shot(page, "state-05-panel")
    expect(errors).toEqual([])
  })

  test("点击回路行进入全宽详情，焦点在标题；Esc、「← 返回」都回到列表，焦点回到那一行", async ({ page }) => {
    await ready(page)
    await openServer(page, "hk-edge")
    await expect(detailTitle(page)).toBeFocused()
    const panel = inspector(page)
    await expect(panel.getByRole("tab", { name: "画像与规则" })).toHaveAttribute("aria-selected", "true")
    await expect(panel.getByRole("tab", { name: "动态 (3)" })).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(detailTitle(page)).toHaveCount(0)
    await expect(row(page, "hk-edge")).toBeFocused()
    await openServer(page, "sg-db")
    await back(page)
    await expect(row(page, "sg-db")).toBeFocused()
  })

  test("检视面板：未列入时才浮现提示和处理入口；编译警告；动态 Tab 有笔记和操作记录", async ({ page }) => {
    const errors = collectConsoleErrors(page)
    await ready(page)
    await openServer(page, "hk-edge")
    const panel = inspector(page)
    await expect(panel.getByText(/未列入：WSL Ubuntu-24.04 中没有配置私钥/)).toBeVisible()
    await expect(panel.getByRole("button", { name: "配置私钥" })).toBeVisible()
    await shot(page, "state-06-detail-hk-edge")
    await panel.getByRole("tab", { name: "动态 (3)" }).click()
    await expect(panel.getByText("待处理的 Agent 笔记")).toBeVisible()
    await expect(panel.getByRole("list", { name: "最近的操作记录" })).toBeVisible()
    await shot(page, "state-07-detail-activity")

    await back(page)
    await openServer(page, "sg-db")
    await expect(page.getByText(/有警告：1 条/)).toBeVisible()
    // 一切正常时不罗列环境矩阵
    await expect(inspector(page).getByText(/未列入/)).toHaveCount(0)
    await shot(page, "state-08-detail-sg-db")

    await back(page)
    await openServer(page, "dev-box")
    await expect(inspector(page).getByText(/只用密码认证，Agent 无法输入密码/)).toBeVisible()
    await shot(page, "state-09-detail-dev-box")
    expect(errors).toEqual([])
  })

  test("编译受阻：控制头的摘要，点击打开预览并定位到检查结果", async ({ page }) => {
    await ready(page, "?mock=degraded")
    await openServer(page, "hk-edge")
    const blocked = inspector(page).getByRole("button", { name: /编译受阻/ })
    await expect(blocked).toBeVisible()
    await shot(page, "state-10-compile-blocked")
    await blocked.click()
    await expect(page.getByRole("dialog", { name: "预览 Skill" })).toBeVisible()
    await shot(page, "state-11-preview-lint")
  })

  test("未保存修改：底部保存条；切换资源时确认放弃", async ({ page }) => {
    await ready(page)
    await openServer(page, "dev-box")
    await inspector(page).getByRole("tab", { name: "连接配置" }).click()
    await page.getByRole("textbox", { name: /^名称/ }).fill("开发机（改）")
    await expect(page.getByText("未保存的修改")).toBeVisible()
    await shot(page, "state-12-draft")
    await page.getByRole("button", { name: "返回", exact: true }).click()
    const leave = page.getByRole("alertdialog", { name: "放弃未保存的修改？" })
    await expect(leave).toBeVisible()
    await leave.getByRole("button", { name: "继续编辑" }).click()
    await expect(detailTitle(page)).toHaveText("dev-box")
    await page.getByRole("button", { name: "放弃", exact: true }).click()
    await expect(page.getByText("未保存的修改")).toBeHidden()
  })
})

test.describe("回路行右侧的双闸刀（PRD 6.4）", () => {
  test("档位闸刀：生产资源切到标准运维先确认，变成琥珀色；切回只读巡检一键完成", async ({ page }) => {
    const errors = collectConsoleErrors(page)
    await ready(page)
    await page.getByRole("button", { name: /^hk-edge 当前是只读巡检/ }).click()
    const confirm = page.getByRole("alertdialog", { name: "把 hk-edge 切换为标准运维？" })
    await expect(confirm).toBeVisible()
    await shot(page, "breaker-01-confirm")
    await confirm.getByRole("button", { name: "切换为标准运维" }).click()
    const amber = page.getByRole("button", { name: /^hk-edge 当前是标准运维.*生产环境已开启写权限/ })
    await expect(amber).toBeVisible()
    await expect(amber).toHaveClass(/text-warning/)
    // 点按钮不打开详情
    await expect(page.locator("#detail-title")).toHaveCount(0)
    await shot(page, "breaker-02-amber")
    await amber.click()
    await expect(page.getByRole("alertdialog")).toHaveCount(0)
    await expect(page.getByRole("button", { name: /^hk-edge 当前是只读巡检/ })).toBeVisible()
    // 非生产资源切到标准运维不用确认
    await page.getByRole("button", { name: /^dev-box 当前是标准运维/ }).click()
    await expect(page.getByRole("button", { name: /^dev-box 当前是只读巡检/ })).toBeVisible()
    expect(errors).toEqual([])
  })

  test("Agent 开关：点亮即分发，不打开详情；未验证的资源不能点亮新的 Agent", async ({ page }) => {
    const errors = collectConsoleErrors(page)
    await ready(page)
    const list = page.locator("#server-list")
    const universal = list.getByRole("button", { name: "将 hk-edge 分发给 通用（Codex 等）" })
    await expect(list.getByRole("button", { name: "将 hk-edge 分发给 Claude Code" })).toHaveAttribute("aria-pressed", "true")
    await expect(universal).toHaveAttribute("aria-pressed", "false")
    await universal.click()
    await expect(universal).toHaveAttribute("aria-pressed", "true")
    await expect(toastText(page, "已把 hk-edge 分发给 通用（Codex 等）")).toBeVisible()
    await expect(page.locator("#detail-title")).toHaveCount(0)

    // dev-box 只用密码：没点亮的按钮不可用
    await expect(list.getByRole("button", { name: "将 dev-box 分发给 Claude Code" })).toBeDisabled()

    // 通用只在 WSL 启用；hk-edge 在 WSL 没有私钥，提示里列出两份总 Skill
    await openServer(page, "hk-edge")
    await expect(inspector(page).getByText(/通用（WSL Ubuntu-24.04）/)).toBeVisible()
    await shot(page, "breaker-03-agent")
    expect(errors).toEqual([])
  })
})

test.describe("添加 SSH 服务器：连接并启用（PRD 6.5、F-106、F-108）", () => {
  test("成功：已信任的地址，一步测试、保存、授权、后台探测", async ({ page }) => {
    const errors = collectConsoleErrors(page)
    await ready(page)
    await fillNew(page, "Edge Copy", "203.0.113.10")
    await expect(sshForm(page).getByText("ssh edge-copy")).toBeVisible()
    await shot(page, "ssh-01-form")
    await connectEnable(page).click()
    // WSL 还没有加入 Include：先问一次（F-107 AC1）
    const include = page.getByRole("alertdialog", { name: "把托管配置加入 ~/.ssh/config？" })
    await include.getByRole("button", { name: "暂不加入" }).click()
    await expect(toastText(page, "已启用 edge-copy，正在后台探测服务")).toBeVisible()
    // 完成后关闭弹窗回到列表，新服务器直接出现在列表里
    await expect(sshForm(page)).toHaveCount(0)
    await expect(page.locator("#server-list").getByRole("button", { name: "将 edge-copy 分发给 Claude Code" })).toHaveAttribute("aria-pressed", "true")
    expect(errors).toEqual([])
  })

  for (const [name, host, user, text, file] of [
    ["超时", "timeout.example.com", "root", /超时（10 秒）/, "ssh-02-timeout"],
    ["拒绝连接", "refused.example.com", "root", /SSH 端口拒绝连接/, "ssh-03-refused"],
    ["认证失败", "203.0.113.10", "bad", /拒绝了密钥认证/, "ssh-04-auth-failed"],
  ] as const) {
    test(`${name}：原地给出分类原因，可以「仅保存（暂不启用）」`, async ({ page }) => {
      await ready(page)
      await fillNew(page, `Box ${file}`, host, user)
      await connectEnable(page).click()
      await expect(page.getByText(text)).toBeVisible({ timeout: 5000 })
      const saveOnly = sshForm(page).getByRole("button", { name: "仅保存（暂不启用）" })
      await expect(saveOnly).toBeVisible()
      await shot(page, file)
      if (name !== "超时") return
      await saveOnly.click()
      await page.getByRole("alertdialog", { name: "把托管配置加入 ~/.ssh/config？" }).getByRole("button", { name: "暂不加入" }).click()
      await expect(sshForm(page)).toHaveCount(0)
      await expect(page.locator("#server-list").getByRole("button", { name: /^box-ssh-02-timeout，.*未验证/ })).toBeVisible()
    })
  }

  test("首次连接核对指纹；密码自动改用密钥登录并删除保存的密码", async ({ page }) => {
    const errors = collectConsoleErrors(page)
    await ready(page)
    const form = await fillNew(page, "Tokyo Relay", "198.51.100.20", "root", "密码")
    await expect(form.getByText("连接后自动配置免密密钥供 Agent 使用，不保留明文密码。")).toBeVisible()
    await form.getByLabel(/^密码/).fill("secret-pass")
    await connectEnable(page).click()
    await expect(sshForm(page).getByRole("button", { name: "正在验证连接…" })).toBeVisible()
    const dialog = page.getByRole("alertdialog", { name: "首次连接，请核对主机指纹" })
    await expect(dialog).toContainText("SHA256:")
    await shot(page, "ssh-05-host-key")
    await dialog.getByRole("button", { name: "信任并继续" }).click()
    await page.getByRole("alertdialog", { name: "把托管配置加入 ~/.ssh/config？" }).getByRole("button", { name: "加入 Include" }).click()
    await expect(sshForm(page).getByRole("button", { name: "正在生成并安装免密密钥…" })).toBeVisible()
    await shot(page, "ssh-06-converting")
    await expect(toastText(page, "已启用 tokyo-relay，正在后台探测服务")).toBeVisible({ timeout: 10_000 })
    await expect(row(page, "tokyo-relay")).toHaveAccessibleName(/已连接/)
    await openServer(page, "tokyo-relay")
    await inspector(page).getByRole("tab", { name: "连接配置" }).click()
    await expect(inspector(page).getByRole("radio", { name: "私钥文件" }).or(inspector(page).getByRole("button", { name: "私钥文件", exact: true }))).toHaveAttribute("aria-pressed", "true")
    await shot(page, "ssh-07-enabled")
    expect(errors).toEqual([])
  })
})

test.describe("云平台 CLI（PRD 6.5 分支 B、F-104）", () => {
  test("Oracle 向导：只检测已启用 Agent 的环境；打开终端后切回窗口自动刷新；勾选范围后保存并启用", async ({ page }) => {
    const errors = collectConsoleErrors(page)
    await ready(page)
    await page.keyboard.press("Control+n")
    const picker = page.getByRole("region", { name: "添加资源" })
    // 已经接入的云平台可以继续接入别的账号，卡片上标出已接入几个
    await expect(picker.getByRole("button", { name: /Cloudflare/ })).toBeEnabled()
    await expect(picker.getByRole("button", { name: /Cloudflare/ })).toContainText("已接入 1 个账号")
    await shot(page, "cli-01-picker")
    await picker.getByRole("button", { name: /Oracle Cloud/ }).click()
    const wizard = page.getByRole("region", { name: "添加 Oracle Cloud" })
    const envs = wizard.getByRole("list", { name: "各运行环境的 CLI 状态" })
    await expect(envs.getByRole("listitem").filter({ hasText: "Windows" })).toContainText("未安装")
    await expect(envs.getByRole("listitem").filter({ hasText: "WSL Ubuntu-24.04" })).toContainText("tenancy-demo")
    // 安装指引：默认 winget，可以换成 pip，并注明要先装 Python
    const guide = envs.getByRole("listitem").filter({ hasText: "Windows" }).getByRole("group", { name: "安装指引" })
    await expect(guide).toContainText("winget install Oracle.OCICLI")
    await guide.getByRole("radio", { name: "pip" }).or(guide.getByRole("button", { name: "pip" })).click()
    await expect(guide).toContainText("pip install oci-cli")
    await expect(guide).toContainText("需要先装好 Python 3")
    await shot(page, "cli-02-install-guide")
    await expect(wizard.getByRole("checkbox", { name: "oci-web-1" })).toBeVisible()
    await shot(page, "cli-02-oracle")

    await envs.getByRole("listitem").filter({ hasText: "Windows" }).getByRole("button", { name: "打开终端" }).click()
    await expect(toastText(page, /已打开 Windows 的终端/)).toBeVisible()
    await refocusWindow(page)
    await expect(envs.getByRole("listitem").filter({ hasText: "Windows" })).toContainText("已就绪")

    await wizard.getByRole("checkbox", { name: "oci-web-1" }).check()
    await wizard.getByRole("button", { name: "保存并启用" }).click()
    await expect(toastText(page, "已接入 Oracle Cloud")).toBeVisible()
    await expect(wizard).toHaveCount(0)
    await expect(row(page, "oracle")).toHaveAccessibleName(/已就绪/)
    await shot(page, "cli-03-oracle-enabled")
    expect(errors).toEqual([])
  })

  test("同一家接入第二个账号：已接入的账号标「已添加」，新资源的标识是 cloudflare-2", async ({ page }) => {
    const errors = collectConsoleErrors(page)
    await ready(page)
    await page.keyboard.press("Control+n")
    await page.getByRole("region", { name: "添加资源" }).getByRole("button", { name: /Cloudflare/ }).click()
    const wizard = page.getByRole("region", { name: "添加 Cloudflare" })
    const accounts = wizard.getByRole("radiogroup", { name: "接入哪个账号" })
    await expect(accounts.getByRole("radio", { name: "me@example.com" })).toBeDisabled()
    await expect(accounts).toContainText("已添加")
    await expect(accounts.getByRole("radio", { name: "acme-corp" })).toBeChecked()
    await shot(page, "cli-04-second-account")
    await wizard.getByRole("button", { name: "保存并启用" }).click()
    await expect(toastText(page, "已接入 Cloudflare · acme-corp")).toBeVisible()
    await expect(row(page, "cloudflare-2")).toBeVisible()
    expect(errors).toEqual([])
  })

  test("Vercel：WSL 未登录，提示条「去登录」后切回窗口变为已就绪；范围勾选立即生效", async ({ page }) => {
    const errors = collectConsoleErrors(page)
    await ready(page)
    await openServer(page, "vercel", "Vercel")
    const panel = inspector(page)
    await expect(panel.getByText(/WSL Ubuntu-24.04 的 vercel 还没有登录/)).toBeVisible()
    await shot(page, "cli-04-vercel")
    await panel.getByRole("button", { name: "去登录" }).click()
    await refocusWindow(page)
    await expect(panel.getByText(/还没有登录/)).toHaveCount(0)

    const playground = panel.getByRole("checkbox", { name: "playground" })
    await playground.check()
    await expect(playground).toBeChecked()
    await panel.getByRole("tab", { name: "连接配置" }).click()
    await expect(panel.getByRole("button", { name: "打开终端切换账号" }).first()).toBeVisible()
    await shot(page, "cli-05-vercel-ready")
    await back(page)
    await expect(row(page, "vercel")).toHaveAccessibleName(/已就绪/)
    await expect(page.locator("#server-list").getByText("my-team · 3 个项目")).toBeVisible()
    expect(errors).toEqual([])
  })

  test("Cloudflare：域名自动关联 hk-edge", async ({ page }) => {
    await ready(page)
    await openServer(page, "cloudflare", "Cloudflare")
    await expect(inspector(page).getByText("已关联服务器 hk-edge")).toBeVisible()
    await shot(page, "cli-06-cloudflare")
  })
})

test.describe("探测：3 种结果（PRD 6.4 探测流程）", () => {
  test("已更新并有待确认项；合并所选；撤销本次更新", async ({ page }) => {
    const errors = collectConsoleErrors(page)
    await ready(page)
    await openServer(page, "hk-edge")
    await inspector(page).getByRole("button", { name: "重新探测", exact: true }).click()
    const sheet = page.getByRole("dialog", { name: /探测/ })
    await expect(sheet.getByText(/已更新 \d+ 处，已重新编译/)).toBeVisible({ timeout: 10_000 })
    await expect(sheet.getByText(/待确认 1 处/)).toBeVisible()
    await shot(page, "probe-01-updated-held")

    await sheet.getByRole("checkbox").first().check()
    await sheet.getByRole("button", { name: /合并所选 1 项/ }).click()
    await expect(sheet.getByText(/已合并 1 处待确认项/)).toBeVisible()

    await sheet.getByRole("button", { name: "撤销本次更新" }).click()
    await expect(sheet.getByText("已撤销本次更新，已重新编译")).toBeVisible()
    await shot(page, "probe-02-undone")
    expect(errors).toEqual([])
  })

  test("失败：主机密钥未信任，给出分类文案和测试连接入口", async ({ page }) => {
    await ready(page)
    await openServer(page, "sg-db")
    await inspector(page).getByRole("button", { name: "重新探测", exact: true }).click()
    const sheet = page.getByRole("dialog", { name: /探测/ })
    await expect(sheet.getByText(/还不认识 sg-db 的主机密钥/)).toBeVisible({ timeout: 10_000 })
    await expect(sheet.getByRole("button", { name: "测试连接" })).toBeVisible()
    await shot(page, "probe-03-failed")
  })
})

test.describe("纯键盘流程", () => {
  test("Ctrl+N 添加 SSH 服务器、填写、Ctrl+S 连接并启用", async ({ page }) => {
    await ready(page)
    await page.keyboard.press("Control+n")
    await page.getByRole("dialog").getByRole("button", { name: /^SSH 服务器/ }).focus()
    await page.keyboard.press("Enter")
    await expect(sshForm(page).getByLabel("地址")).toBeFocused()
    await page.keyboard.type("203.0.113.10")
    // 端口、用户保持默认；用 ssh-agent 认证
    const agent = page.getByRole("radio", { name: "ssh-agent" }).or(page.getByRole("button", { name: "ssh-agent" }))
    await agent.focus()
    await page.keyboard.press("Space")
    await sshForm(page).getByLabel(/^名称/).focus()
    await page.keyboard.type("Keyboard Box")
    await page.keyboard.press("Control+s")
    const include = page.getByRole("alertdialog", { name: "把托管配置加入 ~/.ssh/config？" })
    await expect(include).toBeVisible()
    // Esc 会取消这次保存；用键盘选「暂不加入」
    await include.getByRole("button", { name: "暂不加入" }).focus()
    await page.keyboard.press("Enter")
    await expect(toastText(page, "已启用 keyboard-box，正在后台探测服务")).toBeVisible()
    await expect(row(page, "keyboard-box")).toBeVisible()
  })

  test("方向键在回路行之间移动，Enter 进入详情；方向键在 Agent 按钮间移动，Space 切换", async ({ page }) => {
    await ready(page)
    await row(page, "hk-edge").focus()
    await page.keyboard.press("ArrowDown")
    await expect(row(page, "sg-db")).toBeFocused()
    await page.keyboard.press("ArrowDown")
    await expect(row(page, "dev-box")).toBeFocused()
    await page.keyboard.press("ArrowDown")
    await expect(row(page, "cloudflare")).toBeFocused()
    await page.keyboard.press("Home")
    await expect(row(page, "hk-edge")).toBeFocused()
    await page.keyboard.press("Enter")
    await expect(detailTitle(page)).toHaveText("hk-edge")
    await page.keyboard.press("Escape")

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

  test("命令面板切换当前资源的档位", async ({ page }) => {
    await ready(page)
    await openServer(page, "dev-box")
    await page.keyboard.press("Control+k")
    await page.keyboard.type("切换为「只读巡检」")
    await page.keyboard.press("Enter")
    await expect(toastText(page, "dev-box 已切换为「只读巡检」")).toBeVisible()
    await back(page)
    await expect(page.getByRole("button", { name: /^dev-box 当前是只读巡检/ })).toBeVisible()
  })
})
