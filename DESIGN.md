---
name: CloudLink
description: 把录入的服务器（SSH）与云平台（CLI）编译成一个总 Skill，分发给 Claude Code 等 Agent，并用护栏约束它们操作基础设施的桌面工具。视觉体系是 shadcn/ui Nova（base-nova）加上「安静钢面」：灰底白卡、发丝线、状态圆点、弹出按钮式控件，唯一强调色 Signal Cyan。
colors:
  bg: "oklch(0.964 0.003 264.5)"
  bg-dark: "oklch(0.213 0.007 258.4)"
  card: "oklch(1 0 0)"
  card-dark: "oklch(0.255 0.009 255.6)"
  card-2: "oklch(0.982 0.002 247.8)"
  card-2-dark: "oklch(0.237 0.007 248.1)"
  pill: "oklch(0.954 0.003 247.9)"
  pill-dark: "oklch(0.299 0.011 254.0)"
  pill-hover: "oklch(0.930 0.005 247.9)"
  pill-hover-dark: "oklch(0.338 0.013 253.0)"
  seg-track: "oklch(0.923 0.005 247.9)"
  seg-track-dark: "oklch(1 0 0 / 4%)"
  line: "oklch(0.915 0.006 255.5)"
  line-dark: "oklch(0.327 0.012 258.4)"
  line-2: "oklch(0.942 0.005 258.3)"
  line-2-dark: "oklch(0.299 0.011 254.0)"
  fg: "oklch(0.208 0.009 255.6)"
  fg-dark: "oklch(0.948 0.005 258.3)"
  fg-2: "oklch(0.410 0.016 255.6)"
  fg-2-dark: "oklch(0.793 0.012 252.1)"
  ctl-fg: "oklch(0.507 0.015 251.7)"
  ctl-fg-dark: "oklch(0.732 0.012 252.1)"
  muted: "oklch(0.535 0.017 251.3)"
  muted-dark: "oklch(0.706 0.014 251.6)"
  faint: "oklch(0.787 0.013 255.5)"
  faint-dark: "oklch(0.493 0.013 252.2)"
  ink: "oklch(0.252 0.013 243.4)"
  ink-dark: "oklch(0.933 0.005 247.9)"
  signal: "oklch(0.530 0.103 229.3)"
  signal-dark: "oklch(0.766 0.113 221.7)"
  signal-soft: "oklch(0.951 0.019 222.2)"
  signal-soft-dark: "oklch(0.310 0.038 230.5)"
  green: "oklch(0.530 0.121 157.3)"
  green-dark: "oklch(0.789 0.128 157.6)"
  amber: "oklch(0.554 0.143 50.3)"
  amber-dark: "oklch(0.807 0.139 78.5)"
  red: "oklch(0.578 0.181 24.8)"
  red-dark: "oklch(0.741 0.126 25.3)"
typography:
  base:
    fontFamily: "'Segoe UI Variable Text', 'Segoe UI', 'Microsoft YaHei UI', 'Microsoft YaHei', system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.45
  page-title:
    fontSize: "18px"
    fontWeight: 600
    lineHeight: 1.3
  group-title:
    fontSize: "13px"
    fontWeight: 600
  row-name:
    fontSize: "13.5px"
    fontWeight: 500
  sub:
    fontSize: "12px"
    fontWeight: 400
  mono:
    fontFamily: "'Cascadia Mono', Consolas, 'Microsoft YaHei UI', monospace"
    fontSize: "12px"
rounded:
  control: "6px"
  button: "7px"
  tile: "8px"
  popover: "11px"
  list: "12px"
  dialog: "14px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.card}"
    rounded: "{rounded.button}"
    height: "28px"
  button-secondary:
    backgroundColor: "{colors.pill}"
    textColor: "{colors.fg}"
    rounded: "{rounded.button}"
    height: "28px"
  pop-up-field:
    backgroundColor: "{colors.pill}"
    textColor: "{colors.fg}"
    rounded: "{rounded.control}"
    height: "26px"
  list:
    backgroundColor: "{colors.card}"
    border: "1px {colors.line}"
    rounded: "{rounded.list}"
  row:
    minHeight: "56px"
    divider: "1px {colors.line-2}"
  target-toggle-on:
    backgroundColor: "{colors.signal-soft}"
    ring: "inset 1px {colors.signal} / 35%"
    size: "28px"
---

<!-- 2026-11-08 重设计（v4）：对标 CC Switch 与 magpie，从「钢制配电盘」改为「安静钢面」。决策过程与可点击原型见 docs/prototype/redesign/（静态 HTML），截图在 test-results/redesign/。色值从原型换算成 OKLCH，前景/背景组合已按 WCAG 公式验算（见 Colors）。实现完成后运行 `/impeccable document`，以实际代码重新校准本文件。 -->

# Design System: CloudLink

## Overview

**Creative North Star: "安静钢面（Quiet Steel）"**：一块安静的表面、真实的品牌 Logo、像弹出按钮的控件，颜色只表达状态。

CloudLink 是和终端并排打开的小工具，用来决定「Agent 能看见哪些服务器与云平台、在上面能做什么」。它向两个参照学习：

- **magpie** 的表面：灰色画布上放白色列表卡，行与行之间用发丝线分隔；状态用圆点表达；控件是灰色的「弹出按钮」；阴影只出现在浮层上。
- **CC Switch** 的识别：品牌 Logo 统一装进同尺寸的圆角方块；一组 Agent 图标点亮或熄灭，就是这项资源给不给这个 Agent。

整个应用只有一种强调色 Signal Cyan，主按钮是钢墨色；红、琥珀、绿只表达状态。

这个系统明确拒绝：

- 一行塞满胶囊：别名胶囊、笔记胶囊、档位胶囊、三个无标注图标、编辑、更多……徽章、按钮、开关长得一样，分不清什么能点。
- 在列表行里写排错长段落，或者把编译、目录、运行环境这些内部机制直接摆给用户看。
- 帮助文字讲提示词工程（「会写进 description……」）。说用户得到什么，不说实现。
- 仪表盘式的环形图和大数字、AI 工具常见的紫色渐变和发光、满屏等宽绿字。

**Key Characteristics:**

- **默认 1000×680 窗口**（最小 760×520）。默认是顶部 48px 一体栏导航，用户可以手动切换成左侧栏（`Ctrl+Shift+S` 或设置里切换，记住选择）。
- **内容居中、最宽 760px**，一页一列，从上往下读。
- **正常即隐身**：连接正常时只有一个绿点，不写「已连接」；出问题时才出现文字和修复按钮。
- **两行的资源行**：第一行名称 + 别名 + 生产标记，第二行只有状态点和档位；右侧是对齐的 Agent 图标组。
- 浅色、深色两套主题同等完成度，默认跟随系统。

## Colors

色值以 OKLCH 写在 `src/index.css`，映射到 shadcn 变量的规则见 `docs/PRD.md` 7.6。

### Surfaces（表面）

- **bg 画布**：窗口底色。比卡片暗一档，让白色列表卡浮起来，不靠阴影。
- **card 卡片**：所有列表卡、对话框的底色。
- **card-2**：行悬停、卡片里的说明条（如红线的诚实说明）。
- **pill / pill-hover**：弹出按钮、次要按钮、分段切换中的灰底。
- **seg-track**：分段切换的轨道，比 pill 深一档，白色滑块才站得住。
- **line / line-2**：line 是列表卡外框和顶栏分隔线；line-2 是卡内行与行之间更浅的分隔线。

### Text（文字）

- **fg**：正文、名称。
- **fg-2**：说明正文、值。
- **ctl-fg**：控件上的安静文字（未选中的分段、图标按钮）。对 pill 底 5.1:1。
- **muted**：副行、时间、计数。浅色对卡片 5.2:1、对画布 4.7:1；深色对卡片 6.0:1。
- **faint**：分隔点「·」、未连接的空心圈、行尾箭头。不承载文字信息。

### Primary

- **Steel Ink 钢墨**（`ink`）：主按钮（连接并启用、并入资源、允许一次）、开关打开时的轨道（浅色）、提示条底色。每个视图最多一个主按钮。

### Signal Cyan（唯一强调色）

- `signal` 浅色对卡片 5.2:1，可以作链接文字；`signal-soft` 是它的浅底。
- 只用于四个地方：**键盘焦点环**、**点亮的 Agent 图标**（signal-soft 底 + 35% signal 内描边）、**「动态」导航上的待处理圆点**、**文字链接**。深色主题下开关打开时的轨道也用它。

### State（状态色）

- **green**：已连接、已登录、已同步、命令已执行。浅色对卡片 5.0:1。
- **amber**：生产资源处于标准运维、未验证、某个运行环境未登录、同名冲突。浅色对卡片 5.0:1。
- **red**：「生产」标记、连接失败、命令被拦截、删除。浅色对卡片 4.7:1。
- 每个状态色都有 soft 变体（约 10% 亮度的同色底），用于状态点外圈的光晕和警示行底色。

### Named Rules

**The Ink Primary Rule.** 主操作永远是钢墨实心按钮。彩色实心按钮只允许一种：确认删除时的红色按钮。

**The Signal Four Rule.** Signal Cyan 只出现在上面列出的四个地方。禁止用它做按钮底色、图标装饰或标题。

**The State Owns Color Rule.** 红、琥珀、绿只表达状态，并且必须同时有文字（悬停提示也算）。品牌 Logo 的颜色不是状态色。

**The Dot Not Stripe Rule.** 状态用圆点（带 3px 同色 soft 光晕），不用彩色左侧竖条，也不给整行染色。唯一的例外是需要处理的警示行可以用 amber-soft 浅底。

## Typography

**UI 字体：** Segoe UI Variable Text、Segoe UI，中文 Microsoft YaHei UI；不打包 Web 字体。
**等宽：** Cascadia Mono、Consolas，中文回退 Microsoft YaHei UI（避免中文 Windows 上等宽回退到宋体）。

### Hierarchy

- **Page title**（600，18px）：详情页的资源名称。
- **Group title**（600，13px）：列表卡上方的分组标题（「服务器」「云平台」「Agent 权限」），右边跟一个 muted 计数。
- **Row name**（500，13.5px）：列表行名称。
- **Body**（400，13px，1.45）：正文、表单。
- **Sub**（400，12px，muted）：副行、说明、时间。
- **Mono**（400，12px）：SSH 别名、路径、命令、指纹、地址。

### Named Rules

**The Mono Is Data Rule.** 等宽字体只给机器能读的字符串。命令在列表里直接用等宽文字，不再套灰底胶囊。

**The Tabular Numbers Rule.** 计数、端口、耗时、时间一律 `tabular-nums`。

**The Copyable Text Rule.** 内容可以选中复制（地址、命令、笔记、错误），控件不能（按钮、标签、菜单）。

## Layout

- **外壳**：
  - **顶栏模式（默认）**：48px，左边文字 `CloudLink`，正中是分段切换 `资源 5 / Agent / 动态 / 设置`（「动态」有待确认事项时带信号青圆点），右边是搜索、切换导航位置、`+`（钢墨方块按钮），然后隔一条竖线是窗口控制按钮。窗口去掉系统标题栏，顶栏可拖动。
  - **侧栏模式**：200px 侧栏，上面 `CloudLink`，中间导航（图标 + 文字 + 计数或圆点），底部是护栏状态「● 护栏运行中 · 今天拦截 2 条」。内容区顶部 48px 显示页面标题和同样的操作按钮。
- **页面**：内容居中，最宽 760px，左右各 16px，顶部 20px。列表卡之间靠分组标题分隔（标题上方 18px）。
- **详情**：点一行进入全宽详情页，左上 `‹ 资源` 返回（Esc 也返回）。没有 Tab，一路向下：标题行 → 状态行 → 分组的设置式列表。
- **浮层**：添加用居中对话框（580px）；档位用锚定在文字下方的弹出菜单；提示条在窗口底部居中。

## Elevation & Depth

表面是平的。层次靠「画布比卡片暗一档」和发丝线。阴影只出现在浮层：弹出菜单、对话框、提示条、悬停提示、托盘菜单。

## Shapes

- 控件 6px，按钮 7px，品牌方块 8px（详情页 10px），弹出菜单 11px，列表卡 12px，对话框 14px。
- 不用胶囊形（9999px）。开关和状态点是唯一的圆形。
- 边框一律 1px。

## Components

所有组件来自 `src/components/ui`（shadcn CLI 生成）。业务组件只做组合。

### Signature 1: Resource Row（资源行）

首页分「服务器」「云平台」两组，每组一张列表卡。行高至少 56px，两行文字：

- **左：品牌方块**（32px，8px 圆角）。SSH 服务器是 pill 底 + `ServerIcon`；云平台是白底 + 1px line 描边 + 官方 Logo（18px）。
- **中：两行**
  - 第一行：名称（row-name）+ 别名（mono，muted）+ 生产标记（11px、500、红色文字「生产」，不加底色）。非生产资源什么都不加。
  - 第二行：状态 + 档位。连接正常时只有绿点（悬停显示「已连接」或「已登录 账号」）；有问题时是「状态点 + 问题文字 · 」，如「○ 未验证 · 」「● WSL 未登录 · 」。档位是可点的文字「只读巡检 ⌄」；生产资源在标准运维时变成琥珀色、500 字重。
- **右**：按需出现的一个修复按钮（`测试连接`、`去登录`，次要按钮 sm）→ Agent 图标组 → 行尾 `ChevronRight`（faint，悬停变 muted）。
- 整行可点，进入详情；档位文字、Agent 图标、修复按钮自己处理点击，不进入详情。右键菜单提供编辑、复制别名、删除。
- 所有行的 Agent 图标组右边缘对齐，不随修复按钮移动位置。

### Signature 2: Target Toggles（Agent 图标组）

- 每个**已启用的分发目标**一个 28px 方块按钮，按目录而不是按品牌：Claude Code、通用目录（`BlocksIcon`，悬停提示列出读取它的 Agent）、Trae、Kiro 等各一个。同一个 Agent 的 Windows 和 WSL 合并成一个按钮。
- 点亮：signal-soft 底 + 35% signal 内描边 + 彩色 Logo。熄灭：透明底 + 灰度 50% 透明的 Logo。
- 资源未通过连接验证时，熄灭的按钮不能点亮（`cursor: not-allowed`，提示「先通过连接测试才能分发」）；已点亮的可以取消。
- 点击立即生效，底部提示条「hk-edge 已同步给 Claude Code · 撤销」。
- `aria-pressed` 表达状态，悬停提示写目标名称。

### Signature 3: Mode Pop-up（档位弹出菜单）

- 点副行里的档位文字，在文字下方弹出菜单（11px 圆角，浮层阴影，从文字处展开）：两个选项「只读巡检 / Agent 只能查看，写操作会被拦下」「标准运维 / 允许部署和重启，危险命令仍会拦下」，当前项前面打勾。
- 生产资源切到标准运维时，菜单底部展开一段确认：「sg-db 是生产环境。切到标准运维后，Agent 可以部署和重启。」+「取消」「切换」。切回只读不需要确认。
- 详情页里同一设置用分段切换（只读巡检 | 标准运维）。

### Settings-style List（设置式列表）

详情页、Agent 页、设置页共用。一张列表卡里一行一个设置：左边名称（500）+ 可选的一行说明（sub，可以换行，不截断），右边是控件或值。值用 mono，悬停时出现复制按钮。需要处理的问题作为同一卡片里的一行，用 amber-soft 浅底 + 琥珀色标题 + 右侧一个修复按钮，例如「WSL Ubuntu-24.04 还用不了这台服务器 / WSL 里没有这把私钥 / [复制到 WSL]」。

### Controls（控件）

- **按钮**：28px 高。主按钮钢墨；次要按钮 pill 底；ghost 按钮透明底、ctl-fg 文字；sm 24px。
- **弹出按钮**：26px，pill 底 + 值 + `ChevronDown`，点开是弹出菜单。不用原生 `<select>`。
- **分段切换**：seg-track 轨道 + 白色滑块（细阴影），26px。用于导航、档位、主题等 2–4 个互斥选项。
- **开关**：32×19。打开时浅色主题用钢墨，深色主题用信号青。
- **图标按钮**：30px，悬停 pill 底。顶栏的 `+` 是 28px 钢墨方块（深色主题下用 pill-hover 底，避免一块亮白）。
- **标签输入**（承载的站点）：mono 小方块 + `×`，末尾一个虚线「+ 添加」。

### Feed Row（动态行）

Agent 头像（22px 方块 + Logo）→ 命令（mono，可复制）→ 资源名（固定列宽）→ 结果（固定列宽：「● 已执行」或红点「已拦截 · 只读档」）→ 时间（右对齐）。列宽固定，结果在各行同一条竖线上。

### Ask Card（待确认）

「动态」页顶部的「等你确认」列表卡，一项一块：第一行 Agent 头像 + 「Claude Code 记下了一条关于 hk-edge 的笔记」；下面缩进对齐正文；再下面一个主按钮（并入资源 / 允许一次）+ 一个次要按钮（忽略 / 拒绝）。处理后有撤销。

### Empty State（空状态 = 首次使用引导）

居中：品牌方块（52px）→ 标题「添加第一台服务器」→ 一句「添加之后，就可以直接对 Agent 说：」→ 一张可复制的示例话术卡 →「+ 添加服务器」（主）+「从 ~/.ssh/config 导入 · 6 台」（次）→ 最下面一行「检测到 [Logo] Claude Code、Codex、Cursor，添加后会自动同步给它们」。空状态时顶栏不显示 `+`，避免两个入口重复。

### Add Dialog（添加）

先选类型：分组「服务器」（SSH 服务器、从 ~/.ssh/config 导入）、「云平台」（Cloudflare、Vercel、Oracle Cloud）、「代码托管」（GitHub）。每项一张可点的选项块：品牌方块 + 名称 + 一句话 + 一行信号青状态（「发现 6 台」「已登录 · wrangler」「未安装 oci」）。SSH 表单的「连接并启用」在对话框内分步展示进度：连接服务器 → 核对主机指纹（就地展开指纹和「指纹一致，继续」）→ 安装免密密钥 → 同步给 Agent。

### Toast（提示条）

钢墨底、窗口底部居中、10px 圆角。可撤销的操作带「撤销」按钮，停留 6 秒；其他 2.6 秒。错误不用提示条，就地显示在出错的行或表单里。

### Tray Menu（托盘菜单）

标题「CloudLink」+ 右侧护栏状态；「档位」分组每台服务器一项，右边是当前档位（生产在标准运维时琥珀色），点开子菜单切换；「全部切回只读」（有生产在运维档时右边注明数量）；「打开 CloudLink」「退出」。

### Iconography & Official Brand Logos

通用图标用 `lucide-react`，16px，描边 1.75。禁止 emoji。

**官方品牌 Logo（2026-11-02 起的硬规则，保留）：** Agent 与云平台一律使用官方 SVG Logo，集中封装在 `AgentMark.tsx` 和 `ProviderMark.tsx`，ESLint 限制只有这两个组件能引入 `@lobehub/icons-static-svg` 和 `src/assets/brands/*`。

- **Agent**：Claude Code 用 Claude Logo；通用目录用 Lucide `BlocksIcon`（不冒用任何一家的 Logo）；Codex、Cursor、Windsurf、Gemini CLI、GitHub Copilot、OpenCode、Cline、Roo Code、Kilo Code、Goose、Amp、Qwen Code、Junie、Trae、Kiro 等用 `@lobehub/icons-static-svg` 的官方 Logo；包里没有的品牌和未知自定义目录用 `BotIcon`。
- **云平台与代码托管**：Cloudflare（`cloudflare-color.svg`）、Vercel（`vercel.svg`）、Oracle Cloud（`src/assets/brands/oracle.svg`，官方红 #C74634）、GitHub（`github.svg`）。
- 单色 Logo（Vercel、GitHub、Cursor、OpenCode、Windsurf、Copilot）在深色主题下反色。

| 语义 | 图标 | 语义 | 图标 |
| :--- | :--- | :--- | :--- |
| 资源 | `ServerIcon` | Agent | `BotIcon` |
| 动态 | `ActivityIcon` | 设置 | `SettingsIcon` |
| 添加 | `PlusIcon` | 搜索 | `SearchIcon` |
| 切到侧栏 / 切到顶栏 | `PanelLeftIcon` / `PanelTopIcon` | 通用目录 | `BlocksIcon` |
| 护栏已开启 | `ShieldCheckIcon` | 诚实说明 | `InfoIcon` |
| 预览 Skill | `FileTextIcon` | 导入 ssh config | `DownloadIcon` |
| 复制 | `CopyIcon` | 编辑 | `PencilIcon` |
| 重新探测 | `RefreshCwIcon` | 主机指纹步骤 | `KeyRoundIcon` |
| 返回 | `ChevronLeftIcon` | 进入详情 | `ChevronRightIcon` |
| 弹出 | `ChevronDownIcon` | 更多 | `EllipsisIcon` |

**更新提醒（F-406）：** 规则不变：只有发现新版本时顶栏才出现中性色按钮，不用状态色、不用信号青、不弹提示条。

### App Icon（应用图标）

不变。2026-11-05 选定「交汇 · 浅色」，源文件 `docs/brand/cloudlink-icon.svg`，`src-tauri/icons/` 全部用 `tauri icon` 生成。只用于安装程序、任务栏、开始菜单、托盘和「应用和功能」列表，界面内顶栏只写文字 `CloudLink`。图标里的三个色值只属于图标，不进入界面令牌。

### Motion

- 用 `motion/react`，根节点 `<MotionConfig reducedMotion="user">`。缓动 `cubic-bezier(.2, .8, .2, 1)`，不回弹。
- 页面切换：上移 5px 淡入，240ms。弹出菜单：从锚点缩放 0.96 → 1，160ms。对话框：缩放 0.97 + 上移 6px，220ms。提示条：上移 8px 淡入，250ms。悬停提示延迟 250ms 出现。主题切换背景过渡 350ms。
- 原地更新（切档位、点亮图标、处理待确认）不重播页面入场动画，不改变滚动位置。点击永远不滚动页面。

## Do's and Don'ts

### Do:

- **Do** 让正常状态隐身：一个绿点就够了，问题出现时才写字。
- **Do** 让每个可点的东西长得像可点的：档位是带 `⌄` 的文字，修复是按钮，Agent 是图标按钮；只读信息不加边框。
- **Do** 说明文字讲结果（「站点出问题时，Agent 能找到这台服务器」），不讲实现（「会写进 description」）。
- **Do** 每个可撤销的操作都给撤销；覆盖或接管文件之前先备份。
- **Do** 浅色、深色、顶栏、侧栏四种组合都检查一遍。

### Don't:

- **Don't** 在行里堆胶囊，或放没有文字说明的图标按钮。
- **Don't** 在列表行里写多行排错说明；问题写成一行，修复放一个按钮。
- **Don't** 给非生产资源加环境标记，也不要给「生产」加底色胶囊。
- **Don't** 用彩色左侧竖条或整行染色表达状态。
- **Don't** 用原生 `<select>`，也不要让点击滚动页面。
- **Don't** 把信号青用在 The Signal Four Rule 之外的地方。
- **Don't** 把应用图标放进界面。
