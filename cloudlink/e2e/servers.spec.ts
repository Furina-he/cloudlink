import { expect, test, type Page } from "@playwright/test"

import { back, collectConsoleErrors, detailTitle, inspector, openServer, ready, refocusWindow, row, shot, toastText } from "./helpers"

// 资源视图（PRD 6.4、6.5、6.10）：单行双闸刀配电盘、全宽详情（← 返回）、添加弹窗、SSH 一步到位、云平台 CLI 向导

// 填表时标题是「添加 SSH 服务器」，点连接后同一个区域切到「连接 <别名>」的连接过程
const sshForm = (page: Page) => page.getByRole("region", { name: /^(添加 SSH 服务器|连接 )/ })
const connectEnable = (page: Page) => sshForm(page).getByRole("button", { name: /^(连接并启用|重新连接)/ })

/** 连接过程里就地问的「让 Agent 能用别名连接」（PRD 6.5） */
const includeAsk = (page: Page) => sshForm(page).getByTestId("connect-include")

/** 添加 SSH 服务器：填地址、用户和名称；这里默认改选 ssh-agent，不用填密码或选私钥文件 */
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

  test("列表为空：居中引导、可复制的示例话术、添加和导入；顶栏不显示 +", async ({ page }) => {
    const errors = collectConsoleErrors(page)
    await page.goto("/?mock=empty")
    await expect(page.getByRole("heading", { name: "添加第一台服务器" })).toBeVisible()
    await expect(page.getByText("看看 hk-edge 的磁盘还剩多少")).toBeVisible()
    await expect(page.getByRole("button", { name: "复制示例" })).toBeVisible()
    await expect(page.getByRole("button", { name: "从 ~/.ssh/config 导入 · 3 台" })).toBeVisible()
    // 列的是 Agent 品牌，不列「通用目录」这样的目录名（PRD 6.9）
    const detected = page.getByText(/检测到.*添加后会自动同步给它们/)
    await expect(detected).toBeVisible()
    await expect(detected).toContainText("Claude Code")
    await expect(detected).not.toContainText("通用目录")
    await expect(page.getByRole("button", { name: "添加资源" })).toHaveCount(0)
    // 没有资源时导航上的「资源」不显示 0
    await expect(page.getByRole("navigation", { name: "主导航" }).getByRole("button", { name: /^资源/ })).toHaveText("资源")
    // 内容在可视高度里上下居中
    const viewport = (await page.locator("main [data-slot=scroll-area-viewport]").first().boundingBox())!
    const block = (await page.getByRole("heading", { name: "添加第一台服务器" }).locator("xpath=../..").boundingBox())!
    expect(Math.abs(block.y + block.height / 2 - (viewport.y + viewport.height / 2))).toBeLessThan(24)
    await shot(page, "state-02-empty")
    await page.getByRole("button", { name: "添加服务器" }).click()
    await expect(sshForm(page)).toBeVisible()
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

  test("首屏：两组两行资源行；生产标准运维琥珀色；异常就地给出修复按钮；正常即隐身", async ({ page }) => {
    const errors = collectConsoleErrors(page)
    await ready(page)
    await expect(page.locator("#detail-title")).toHaveCount(0)
    await expect(page.getByRole("heading", { level: 2, name: /^服务器/ })).toBeVisible()
    await expect(page.getByRole("heading", { level: 2, name: /^云平台/ })).toBeVisible()
    await expect(page.getByText("权限档位")).toHaveCount(0)
    // sg-db 是生产服务器，开着标准运维：档位文字带提醒文案（状态不只靠颜色）
    await expect(page.getByRole("button", { name: /^sg-db 的档位：标准运维.*生产环境已开启写权限/ })).toHaveClass(/text-warning/)
    await expect(page.getByRole("button", { name: /^hk-edge 的档位：只读巡检$/ })).toBeVisible()
    // dev-box 只用密码；vercel 在 WSL 未登录
    const list = page.locator("#server-list")
    await expect(list.getByRole("button", { name: "改用密钥登录" })).toBeVisible()
    await expect(list.getByText("WSL 未登录")).toBeVisible()
    await expect(list.getByRole("button", { name: "去登录" })).toBeVisible()
    // 云平台不写账号和范围摘要，这些在详情里
    await expect(list.getByText(/me@example.com|2 个域名/)).toHaveCount(0)
    await expect(list.getByText("生产", { exact: true })).toHaveCount(4)
    // 正常连接不写「已连接 · Ubuntu …」，云平台不写「vercel Vercel · vercel」
    await expect(list.getByText(/已连接|Ubuntu|已就绪|生产环境已开启写权限/)).toHaveCount(0)
    await expect(list.getByText("wrangler")).toHaveCount(0)
    await shot(page, "state-05-panel")
    expect(errors).toEqual([])
  })

  test("点击资源行进入全宽详情，焦点在标题；Esc、「‹ 资源」都回到列表，焦点回到那一行", async ({ page }) => {
    await ready(page)
    await openServer(page, "hk-edge")
    await expect(detailTitle(page)).toBeFocused()
    await expect(detailTitle(page)).toHaveText("香港边缘节点")
    const panel = inspector(page)
    // 没有 Tab：一路向下是分组的设置式列表
    await expect(panel.getByRole("tab")).toHaveCount(0)
    for (const g of ["Agent 权限", "连接", "Agent 需要知道的", "服务与目录", "红线", "最近动态"]) {
      await expect(panel.getByRole("heading", { level: 3, name: new RegExp(`^${g}`) })).toBeVisible()
    }
    await page.keyboard.press("Escape")
    await expect(detailTitle(page)).toHaveCount(0)
    await expect(row(page, "hk-edge")).toBeFocused()
    await openServer(page, "sg-db")
    await back(page)
    await expect(row(page, "sg-db")).toBeFocused()
  })

  test("详情：未列入时才浮现问题行和修复入口；编译警告；最近动态有笔记和操作记录", async ({ page }) => {
    const errors = collectConsoleErrors(page)
    await ready(page)
    await openServer(page, "hk-edge")
    const panel = inspector(page)
    await expect(panel.getByText("WSL Ubuntu-24.04 里的 Claude Code 还用不了这台服务器")).toBeVisible()
    await expect(panel.getByRole("button", { name: "配置私钥" })).toBeVisible()
    await expect(panel.getByText("红线写给 Agent 看。Claude Code 上护栏会强制拦截，能防手滑，防不了刻意绕过。")).toBeVisible()
    await shot(page, "state-06-detail-hk-edge")
    await expect(panel.getByRole("button", { name: /条 Agent 笔记等你确认/ })).toBeVisible()
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
    const sheet = page.getByRole("dialog", { name: "预览 Skill" })
    await expect(sheet).toBeVisible()
    await shot(page, "state-11-preview-lint")
    // 文件用下拉选；点检查结果跳到对应文件
    await sheet.getByRole("combobox", { name: "文件" }).click()
    await page.getByRole("option", { name: "SKILL.md" }).click()
    await expect(sheet.getByRole("combobox", { name: "文件" })).toContainText("SKILL.md")
    await sheet.getByRole("button", { name: /定位到 references\/hk-edge\.md 第 32 行/ }).click()
    await expect(sheet.getByRole("combobox", { name: "文件" })).toContainText("hk-edge.md")
  })

  test("编辑即保存：停止输入 600ms 后保存，提示条「已保存」；连接字段在「编辑」里改", async ({ page }) => {
    const errors = collectConsoleErrors(page)
    await ready(page)
    await openServer(page, "dev-box")
    const panel = inspector(page)
    await panel.getByRole("textbox", { name: "名称" }).fill("开发机（改）")
    await expect(toastText(page, "已保存")).toBeVisible()
    await expect(detailTitle(page)).toHaveText("开发机（改）")
    await expect(page.getByText("未保存的修改")).toHaveCount(0)
    await shot(page, "state-12-autosave")
    // 连接：编辑打开对话框，取消不保存
    await panel.getByRole("button", { name: "编辑" }).first().click()
    const dialog = page.getByRole("dialog", { name: "编辑连接" })
    await expect(dialog.getByLabel("地址")).toBeVisible()
    await shot(page, "state-13-edit-connection")
    await dialog.getByRole("button", { name: "取消" }).click()
    await expect(dialog).toHaveCount(0)
    await back(page)
    await expect(row(page, "dev-box")).toHaveAccessibleName(/开发机（改）/)
    expect(errors).toEqual([])
  })
})

test.describe("资源行右侧的档位与 Agent（PRD 6.4）", () => {
  test("档位菜单：生产资源切到标准运维在菜单底部确认，变成琥珀色，提示条可撤销；切回只读不确认", async ({ page }) => {
    const errors = collectConsoleErrors(page)
    await ready(page)
    await page.getByRole("button", { name: /^hk-edge 的档位：只读巡检/ }).click()
    const menu = page.getByRole("menu")
    await menu.getByRole("menuitemradio", { name: /^标准运维/ }).click()
    await expect(menu.getByRole("alert")).toHaveText(/hk-edge 是生产环境/)
    await shot(page, "mode-01-confirm")
    await menu.getByRole("button", { name: "切换" }).click()
    const amber = page.getByRole("button", { name: /^hk-edge 的档位：标准运维.*生产环境已开启写权限/ })
    await expect(amber).toHaveClass(/text-warning/)
    await expect(page.locator("#detail-title")).toHaveCount(0)
    await shot(page, "mode-02-amber")
    // 提示条「撤销」回到只读巡检
    await page.locator("[data-slot=toast]").getByRole("button", { name: "撤销" }).click()
    await expect(page.getByRole("button", { name: /^hk-edge 的档位：只读巡检/ })).toBeVisible()
    // 非生产资源切到标准运维不用确认
    await page.getByRole("button", { name: /^dev-box 的档位：标准运维/ }).click()
    await page.getByRole("menu").getByRole("menuitemradio", { name: /^只读巡检/ }).click()
    await expect(page.getByRole("button", { name: /^dev-box 的档位：只读巡检/ })).toBeVisible()
    expect(errors).toEqual([])
  })

  test("Agent 开关：点亮即分发，不打开详情；未验证的资源不能点亮新的 Agent", async ({ page }) => {
    const errors = collectConsoleErrors(page)
    await ready(page)
    const list = page.locator("#server-list")
    const universal = list.getByRole("button", { name: "将 hk-edge 分发给 通用目录" })
    await expect(list.getByRole("button", { name: "将 hk-edge 分发给 Claude Code" })).toHaveAttribute("aria-pressed", "true")
    await expect(universal).toHaveAttribute("aria-pressed", "false")
    await universal.click()
    await expect(universal).toHaveAttribute("aria-pressed", "true")
    await expect(toastText(page, "已把 hk-edge 分发给 通用目录")).toBeVisible()
    await expect(page.locator("#detail-title")).toHaveCount(0)

    // dev-box 只用密码：没点亮的按钮不可用
    await expect(list.getByRole("button", { name: "将 dev-box 分发给 Claude Code" })).toBeDisabled()

    // 通用目录只在 WSL 启用；hk-edge 在 WSL 没有私钥，问题行标题列出两个 Agent
    await openServer(page, "hk-edge")
    await expect(inspector(page).getByText(/^WSL Ubuntu-24.04 里的 .*通用.* 还用不了这台服务器$/)).toBeVisible()
    await shot(page, "breaker-03-agent")
    expect(errors).toEqual([])
  })
})

test.describe("添加 SSH 服务器：连接并启用（PRD 6.5、F-106、F-108）", () => {
  test("成功：已信任的地址，一步测试、保存、授权、后台探测", async ({ page }) => {
    const errors = collectConsoleErrors(page)
    await ready(page)
    await fillNew(page, "Edge Copy", "203.0.113.10")
    // 别名行：「Agent 会用 ssh [别名] 连接它」，别名跟着名称变
    await expect(sshForm(page).getByRole("textbox", { name: "别名" })).toHaveValue("edge-copy")
    await expect(sshForm(page).getByText("添加后先是只读巡检，并同步给全部 Agent")).toBeVisible()
    // 表单里不选 Agent、不选档位
    await expect(sshForm(page).getByText(/授权给|默认档位/)).toHaveCount(0)
    await shot(page, "ssh-01-form")
    await connectEnable(page).click()
    // WSL 还没有加入 SSH 配置：在过程里就地问一次（F-107 AC1），不叠对话框
    const include = includeAsk(page)
    await expect(sshForm(page).locator("[data-step=include]")).toHaveAttribute("data-state", "attention")
    await expect(page.getByRole("alertdialog")).toHaveCount(0)
    // 这一屏只有卡片里的「加入」一个主按钮
    await expect(connectEnable(page)).toHaveCount(0)
    await expect(include).not.toContainText("Include")
    await include.getByRole("button", { name: "了解详情" }).click()
    await expect(include).toContainText("Include ~/.ssh/")
    await shot(page, "ssh-01b-include")
    await include.getByRole("button", { name: "暂不加入" }).click()
    await expect(toastText(page, /Edge Copy 已添加，并同步给 \d+ 个目录/)).toBeVisible()
    // 完成后关闭弹窗回到列表，新服务器直接出现在列表里
    await expect(sshForm(page)).toHaveCount(0)
    await expect(page.locator("#server-list").getByRole("button", { name: "将 edge-copy 分发给 Claude Code" })).toHaveAttribute("aria-pressed", "true")
    expect(errors).toEqual([])
  })

  test("只在 WSL 里可用、又选了「暂不加入」：先不同步，资源行写「Agent 还连不上」，点「加入 SSH 配置」后同步", async ({ page }) => {
    const errors = collectConsoleErrors(page)
    await ready(page)
    const form = await fillNew(page, "Wsl Only", "203.0.113.10")
    await form.getByRole("button", { name: /^高级/ }).click()
    await form.getByRole("checkbox", { name: /^Windows/ }).uncheck()
    await connectEnable(page).click()
    await includeAsk(page).getByRole("button", { name: "暂不加入" }).click()
    await expect(toastText(page, "Wsl Only 已添加。加入 SSH 配置后才会同步给 Agent")).toBeVisible()
    await expect(sshForm(page)).toHaveCount(0)
    await expect(row(page, "wsl-only")).toHaveAccessibleName(/Agent 还连不上/)
    const list = page.locator("#server-list")
    const claude = list.getByRole("button", { name: "将 wsl-only 分发给 Claude Code" })
    await expect(claude).toHaveAttribute("aria-pressed", "false")
    await shot(page, "ssh-08-unreachable-row")
    await list.getByRole("button", { name: "加入 SSH 配置" }).click()
    await expect(toastText(page, /^已加入 SSH 配置，Wsl Only 已同步给 \d+ 个目录/)).toBeVisible()
    await expect(row(page, "wsl-only")).toHaveAccessibleName(/已连接/)
    await expect(claude).toHaveAttribute("aria-pressed", "true")
    expect(errors).toEqual([])
  })

  test("等着决定要不要加入 SSH 配置时按 Esc：先问要不要放弃，草稿不会直接丢", async ({ page }) => {
    await ready(page)
    await fillNew(page, "Esc Box", "203.0.113.10")
    await connectEnable(page).click()
    await expect(includeAsk(page)).toBeVisible()
    await page.keyboard.press("Escape")
    const leave = page.getByRole("alertdialog", { name: "放弃未保存的修改？" })
    await leave.getByRole("button", { name: "继续编辑" }).click()
    await expect(includeAsk(page)).toBeVisible()
    await includeAsk(page).getByRole("button", { name: "加入", exact: true }).click()
    await expect(row(page, "esc-box")).toBeVisible()
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
      await includeAsk(page).getByRole("button", { name: "暂不加入" }).click()
      await expect(sshForm(page)).toHaveCount(0)
      await expect(page.locator("#server-list").getByRole("button", { name: /^box-ssh-02-timeout，.*未验证/ })).toBeVisible()
    })
  }

  test("首次连接核对指纹；密码自动改用密钥登录并删除保存的密码", async ({ page }) => {
    const errors = collectConsoleErrors(page)
    await ready(page)
    const form = await fillNew(page, "Tokyo Relay", "198.51.100.20", "root", "密码")
    await expect(form.getByText("只用这一次。连接后换成免密密钥，密码不会保存。")).toBeVisible()
    await form.getByLabel(/^密码/).fill("secret-pass")
    await connectEnable(page).click()
    // 指纹在连接过程的「核对主机指纹」一步里就地核对，不再叠一层对话框
    const steps = sshForm(page).getByRole("list", { name: "连接 tokyo-relay" })
    await expect(steps.locator("[data-step=hostKey]")).toHaveAttribute("data-state", "attention")
    const fingerprint = sshForm(page).getByTestId("connect-fingerprint")
    await expect(fingerprint).toContainText("SHA256:")
    await expect(page.getByRole("alertdialog", { name: "首次连接，请核对主机指纹" })).toHaveCount(0)
    await shot(page, "ssh-05-host-key")
    await expect(fingerprint.getByRole("button", { name: "返回修改" })).toBeVisible()
    await fingerprint.getByRole("button", { name: "指纹一致，继续" }).click()
    await includeAsk(page).getByRole("button", { name: "加入", exact: true }).click()
    await expect(steps.locator("[data-step=convert]")).toHaveAttribute("data-state", "running")
    await expect(steps.locator("[data-step=include]")).toHaveAttribute("data-state", "done")
    await expect(sshForm(page).getByRole("button", { name: "正在添加…" })).toBeDisabled()
    await shot(page, "ssh-06-converting")
    await expect(toastText(page, /Tokyo Relay 已添加，并同步给 \d+ 个目录/)).toBeVisible({ timeout: 10_000 })
    // 新行短暂用中性色高亮
    await expect(page.locator("#server-list [data-fresh]").first()).toBeVisible()
    await expect(row(page, "tokyo-relay")).toHaveAccessibleName(/已连接/)
    await openServer(page, "tokyo-relay")
    await inspector(page).getByRole("button", { name: "编辑" }).first().click()
    const edit = page.getByRole("dialog", { name: "编辑连接" })
    await expect(edit.getByRole("radio", { name: "私钥文件" }).or(edit.getByRole("button", { name: "私钥文件", exact: true }))).toHaveAttribute("aria-pressed", "true")
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
    // 分组：服务器、云平台、代码托管；选项块上一行状态
    for (const g of ["服务器", "云平台", "代码托管"]) await expect(picker.getByRole("heading", { level: 3, name: g })).toBeVisible()
    await expect(picker.getByRole("button", { name: /Cloudflare/ })).toContainText("已登录 · wrangler")
    await expect(picker.getByRole("button", { name: /GitHub/ })).toContainText("仓库，以及它们部署到哪里")
    await expect(picker.getByRole("button", { name: /从 ~\/\.ssh\/config 导入/ })).toContainText("发现 2 台")
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
    await expect(row(page, "oracle")).toHaveAccessibleName(/已登录/)
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
    await expect(panel.getByText("vercel 还没有登录")).toBeVisible()
    // 状态行只写整体：Windows 已就绪，WSL 的问题只在问题行里说；「重新检测」只在标题行
    const status = panel.locator("div[aria-live=polite]").first()
    await expect(status).toContainText("已就绪")
    await expect(status).not.toContainText("未登录")
    await expect(panel.getByRole("button", { name: "重新检测", exact: true })).toHaveCount(1)
    await shot(page, "cli-04-vercel")
    await panel.getByRole("button", { name: "去登录" }).click()
    await refocusWindow(page)
    await expect(panel.getByText(/还没有登录/)).toHaveCount(0)

    await panel.getByRole("button", { name: /^2 个项目/ }).click()
    const scope = page.getByRole("dialog", { name: "选择开放范围" })
    const playground = scope.getByRole("checkbox", { name: "playground" })
    // 勾选立即生效：等后端回写后才显示勾上
    await playground.click()
    await expect(playground).toBeChecked()
    await shot(page, "cli-05-scope-dialog")
    await scope.getByRole("button", { name: "完成" }).click()
    await expect(panel.getByRole("button", { name: "打开终端切换账号" }).first()).toBeVisible()
    await shot(page, "cli-05-vercel-ready")
    await back(page)
    await expect(row(page, "vercel")).toHaveAccessibleName(/已登录/)
    expect(errors).toEqual([])
  })

  test("Cloudflare：域名自动关联 hk-edge", async ({ page }) => {
    await ready(page)
    await openServer(page, "cloudflare", "Cloudflare")
    await inspector(page).getByRole("button", { name: /个域名/ }).click()
    await expect(page.getByRole("dialog", { name: "选择开放范围" }).getByText("已关联服务器 hk-edge")).toBeVisible()
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
    await expect(sheet.getByText(/已更新 \d+ 处/)).toBeVisible({ timeout: 10_000 })
    await expect(sheet.getByText(/待确认 1 处/)).toBeVisible()
    await shot(page, "probe-01-updated-held")

    await sheet.getByRole("checkbox").first().check()
    await sheet.getByRole("button", { name: /合并所选 1 项/ }).click()
    await expect(sheet.getByText(/已合并 1 处待确认项/)).toBeVisible()

    await sheet.getByRole("button", { name: "撤销本次更新" }).click()
    await expect(sheet.getByText("已撤销本次更新")).toBeVisible()
    await expect(sheet.getByText(/重新编译/)).toHaveCount(0)
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
  for (const choice of ["加入", "暂不加入"] as const) {
    test(`Ctrl+N 添加 SSH 服务器、填写、Ctrl+S 连接并启用，键盘选「${choice}」`, async ({ page }) => {
      await ready(page)
      await page.keyboard.press("Control+n")
      await page.getByRole("dialog").getByRole("button", { name: /^SSH 服务器/ }).focus()
      await page.keyboard.press("Enter")
      await expect(sshForm(page).getByLabel("地址")).toBeFocused()
      await page.keyboard.type("203.0.113.10")
      // 端口、用户保持默认；登录方式先选中的是密码，改用 ssh-agent
      const agent = page.getByRole("radio", { name: "ssh-agent" }).or(page.getByRole("button", { name: "ssh-agent" }))
      await agent.focus()
      await page.keyboard.press("Space")
      await expect(agent).toHaveAttribute("aria-pressed", "true")
      await sshForm(page).getByLabel(/^名称/).focus()
      await page.keyboard.type("Keyboard Box")
      await page.keyboard.press("Control+s")
      const include = includeAsk(page)
      await expect(include).toBeVisible()
      // 焦点落在卡片里的主按钮「加入」上；Shift+Tab 到「暂不加入」
      await expect(include.getByRole("button", { name: "加入", exact: true })).toBeFocused()
      if (choice === "暂不加入") {
        await page.keyboard.press("Shift+Tab")
        await expect(include.getByRole("button", { name: "暂不加入" })).toBeFocused()
      }
      await page.keyboard.press("Enter")
      await expect(toastText(page, /Keyboard Box 已添加，并同步给 \d+ 个目录/)).toBeVisible()
      await expect(row(page, "keyboard-box")).toBeVisible()
      await expect(page.locator("#server-list").getByRole("button", { name: "将 keyboard-box 分发给 Claude Code" })).toHaveAttribute("aria-pressed", "true")
    })
  }

  test("方向键在资源行之间移动，Enter 进入详情；方向键在 Agent 按钮间移动，Space 切换", async ({ page }) => {
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
    await expect(detailTitle(page)).toHaveText("香港边缘节点")
    await page.keyboard.press("Escape")

    const list = page.locator("#server-list")
    const claude = list.getByRole("button", { name: "将 hk-edge 分发给 Claude Code" })
    const universal = list.getByRole("button", { name: "将 hk-edge 分发给 通用目录" })
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

  test("服务表在 760 宽窗口里不横向滚动：「关键」开关和角色都在表内看得到", async ({ page }) => {
    await page.setViewportSize({ width: 760, height: 520 })
    await ready(page)
    await openServer(page, "hk-edge")
    // 服务表收在「探测结果」折叠行里
    await inspector(page).getByRole("button", { name: /^探测结果/ }).click()
    const table = inspector(page).getByRole("table")
    await expect(table.getByRole("columnheader")).toHaveText(["名称", "镜像", "端口", "角色", "关键", "操作"])
    const fit = await table.evaluate((t) => {
      const box = t.parentElement!.getBoundingClientRect()
      const switches = [...t.querySelectorAll("[role=switch]")].map((s) => s.getBoundingClientRect())
      return { noScroll: t.parentElement!.scrollWidth <= t.parentElement!.clientWidth, inside: switches.every((s) => s.left >= box.left && s.right <= box.right + 0.5) }
    })
    expect(fit).toEqual({ noScroll: true, inside: true })
    // 类型写在名称下面；角色写得下
    await expect(table.getByRole("row").filter({ hasText: "openresty" })).toContainText("Docker")
    const role = table.getByRole("textbox", { name: "openresty 的角色" })
    expect(await role.evaluate((el: HTMLInputElement) => el.scrollWidth <= el.clientWidth)).toBe(true)
  })

  test("命令面板切换当前资源的档位", async ({ page }) => {
    await ready(page)
    await openServer(page, "dev-box")
    await page.keyboard.press("Control+k")
    await page.keyboard.type("切换为「只读巡检」")
    await page.keyboard.press("Enter")
    await expect(toastText(page, "dev-box 已切换为「只读巡检」")).toBeVisible()
    await back(page)
    await expect(page.getByRole("button", { name: /^dev-box 的档位：只读巡检/ })).toBeVisible()
  })
})
