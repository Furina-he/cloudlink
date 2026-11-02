---
name: CloudLink
description: 把录入的服务器（SSH）与云平台（CLI）编译成一个总 Skill，分发给 Claude Code 等 Agent，并用护栏约束它们操作基础设施的桌面工具。视觉体系是 shadcn/ui Nova（base-nova）加上 Mist 冷钢中性色、Signal Cyan 信号色与「钢制配电盘（Steel Breaker Panel）」布局。
colors:
  canvas: "oklch(1 0 0)"
  canvas-dark: "oklch(0.148 0.004 228.8)"
  ink: "oklch(0.148 0.004 228.8)"
  ink-dark: "oklch(0.987 0.002 197.1)"
  steel: "oklch(0.218 0.008 223.9)"
  steel-dark: "oklch(0.925 0.005 214.3)"
  frost: "oklch(0.963 0.002 197.1)"
  frost-dark: "oklch(0.275 0.011 216.9)"
  shell: "oklch(0.987 0.002 197.1)"
  shell-dark: "oklch(0.218 0.008 223.9)"
  note: "oklch(0.52 0.021 213.5)"
  note-dark: "oklch(0.723 0.014 214.4)"
  hairline: "oklch(0.925 0.005 214.3)"
  hairline-dark: "oklch(1 0 0 / 10%)"
  signal: "oklch(0.609 0.126 221.723)"
  signal-dark: "oklch(0.715 0.143 215.221)"
  danger: "oklch(0.577 0.245 27.325)"
  danger-dark: "oklch(0.704 0.191 22.216)"
  success: "oklch(0.508 0.118 165.612)"
  success-dark: "oklch(0.765 0.177 163.223)"
  warning: "oklch(0.555 0.163 48.998)"
  warning-dark: "oklch(0.828 0.189 84.429)"
  agent-claude: "oklch(0.56 0.15 40)"
  agent-claude-dark: "oklch(0.72 0.14 42)"
  agent-openai: "oklch(0.6 0.13 168)"
  agent-openai-dark: "oklch(0.74 0.13 168)"
typography:
  title:
    fontFamily: "system-ui, 'Segoe UI Variable Text', 'Segoe UI', 'PingFang SC', 'Microsoft YaHei UI', 'Noto Sans CJK SC', sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: 1.4
  section:
    fontFamily: "system-ui, 'Segoe UI Variable Text', 'Segoe UI', 'PingFang SC', 'Microsoft YaHei UI', 'Noto Sans CJK SC', sans-serif"
    fontSize: "0.875rem"
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: "system-ui, 'Segoe UI Variable Text', 'Segoe UI', 'PingFang SC', 'Microsoft YaHei UI', 'Noto Sans CJK SC', sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  meta:
    fontFamily: "system-ui, 'Segoe UI Variable Text', 'Segoe UI', 'PingFang SC', 'Microsoft YaHei UI', 'Noto Sans CJK SC', sans-serif"
    fontSize: "0.8rem"
    fontWeight: 400
    lineHeight: 1.4
  label:
    fontFamily: "system-ui, 'Segoe UI Variable Text', 'Segoe UI', 'PingFang SC', 'Microsoft YaHei UI', 'Noto Sans CJK SC', sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.3
  mono:
    fontFamily: "'JetBrains Mono Variable', 'Cascadia Mono', 'SF Mono', ui-monospace, Menlo, Consolas, monospace"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.5
  prose:
    fontFamily: "system-ui, 'Segoe UI Variable Text', 'Segoe UI', 'PingFang SC', 'Microsoft YaHei UI', 'Noto Sans CJK SC', sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.7
rounded:
  sm: "0.27rem"
  md: "0.36rem"
  lg: "0.45rem"
  xl: "0.63rem"
  pill: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.steel}"
    textColor: "{colors.shell}"
    rounded: "{rounded.lg}"
    height: "32px"
    padding: "0 10px"
  button-outline:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    height: "32px"
    padding: "0 10px"
  button-destructive:
    backgroundColor: "oklch(0.577 0.245 27.325 / 10%)"
    textColor: "{colors.danger}"
    rounded: "{rounded.lg}"
    height: "32px"
    padding: "0 10px"
  input:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    height: "32px"
    padding: "4px 10px"
  badge-state-success:
    backgroundColor: "oklch(0.508 0.118 165.612 / 10%)"
    textColor: "{colors.success}"
    rounded: "{rounded.pill}"
    height: "20px"
    padding: "2px 8px"
  badge-state-warning:
    backgroundColor: "oklch(0.555 0.163 48.998 / 10%)"
    textColor: "{colors.warning}"
    rounded: "{rounded.pill}"
    height: "20px"
    padding: "2px 8px"
  badge-state-danger:
    backgroundColor: "oklch(0.577 0.245 27.325 / 10%)"
    textColor: "{colors.danger}"
    rounded: "{rounded.pill}"
    height: "20px"
    padding: "2px 8px"
  badge-env:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    height: "20px"
    padding: "2px 8px"
  list-item-current:
    backgroundColor: "{colors.frost}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "10px 12px"
  sidebar-item-active:
    backgroundColor: "{colors.frost}"
    textColor: "{colors.steel}"
    rounded: "{rounded.md}"
    height: "32px"
---

<!-- 令牌来源：在 2026-10-27 用 shadcn CLI 4.22.2 实际执行 `init --preset b1sArLArQ --base base` 生成，再加上本文标注为「覆盖」的四项（note、signal、success、warning）。全部前景/背景组合都按 WCAG 公式验算过。2026-11-02 更新为「钢制配电盘」单列双闸刀回路行架构与官方云厂商 Logo 规范。界面实现后请运行 `/impeccable document`，以实际代码重新校准本文件。 -->

# Design System: CloudLink

## Overview

**Creative North Star: "钢与信号（Steel & Signal）· 钢制配电盘（Steel Breaker Panel）"**

CloudLink 是开发者和终端并排打开、用来决定「Agent 能看见哪些服务器与云平台、在上面能做什么」的工具。它的界面应该像一块标注清楚、秩序井然的**钢制配电面板**：没有常驻双栏对峙，没有参差不齐的多列小卡片网格，也没有 8 层折叠手风琴；默认首屏是一张全宽单列对齐的「回路列表（服务器 SSH + 云平台 CLI）」，每一行右侧整齐排列着**档位闸刀**与**Agent 通电开关**，每个回路的开合状态一眼可见。

系统建立在 shadcn/ui 的 Nova 风格上，内边距和外边距紧凑，控件统一 32px 高。底色是带极轻青蓝倾向的 Mist 冷钢灰，用来承载结构。界面上只允许出现一种「信号色」Signal Cyan，标记两件事：键盘焦点、当前选中的资源回路行。红、琥珀、绿三种颜色只表达状态，从不拿来装饰（例外：Agent 标识与云厂商官方品牌 Logo，见 Iconography）。

这个系统明确拒绝以下几种外观：

- 云控制台式的拥挤导航、常驻环境矩阵和营销横幅。
- 1Panel、宝塔那种仪表盘式的环形图和大数字。
- 多列参差不齐的小卡片网格和多层嵌套手风琴。
- AI 工具常见的紫色渐变、发光和闪烁星标。
- 「黑客终端」式的满屏等宽绿字。

**Key Characteristics:**

- **一目了然，按需展开**：首屏默认单栏全宽（最大阅读宽度居中收束），只在点击某一行或点击「+ 添加资源」时，右侧无遮罩平推展开 440px 检视面板；底层正常状态一律隐身，异常才就地亮起修复动作。
- **冷钢中性色**（Mist，色相 197–229），浅色和深色两套主题同等完成度，默认跟随系统。
- **主操作按钮一律是墨色（steel）**，信号色只有一种（cyan）。
- **颜色就是状态**：绿表示已连接、已就绪、已同步或健康，琥珀表示登录过期、环境缺失、冲突或**生产环境正处于「标准运维（可写）」状态**，红表示失效、危险或生产环境圆点。状态不能只靠颜色，必须同时有图标和文字。
- 使用系统原生 UI 字体，与中文无缝配对；技术字符串（别名、CLI 命令、路径）用 JetBrains Mono。
- 层次靠边框和色阶表达，平时没有阴影。阴影只出现在浮层上。

## Colors

整体是冷钢中性色加一个信号色。所有色值都用 OKLCH，CSS 变量写在 `src/index.css`，规则见 `docs/PRD.md` 第 7.6 节。

### Primary

- **Steel Ink 钢墨**（浅色 `steel` oklch(0.218 0.008 223.9) / 深色 `steel-dark` oklch(0.925 0.005 214.3)）：主操作按钮（连接并启用、保存、导入、探测）、侧栏激活图标、进度条指示。主按钮不用彩色，这是刻意的选择：彩色要留给状态。

### Secondary

- **Signal Cyan 信号青**（浅色 `signal` oklch(0.609 0.126 221.723) / 深色 `signal-dark` oklch(0.715 0.143 215.221)，**覆盖** shadcn 默认的 `--ring`）：只用在键盘焦点环和当前选中资源回路行的描边上。它在浅色模式下对白底的对比度是 3.60:1，只满足非文本对比度的 3:1 要求，因此禁止用作文字颜色。

### Tertiary

- **State Green 状态绿**（`success` oklch(0.508 0.118 165.612) / `success-dark` oklch(0.765 0.177 163.223)，新增）：已连接、CLI 已就绪、副本已同步、护栏已生效、探测成功。浅色模式下对白底 5.37:1，对 10% 自身色底 4.67:1。
- **State Amber 状态琥珀**（`warning` oklch(0.555 0.163 48.998) / `warning-dark` oklch(0.828 0.189 84.429)，新增）：**生产资源处于「标准运维」档位提醒**、CLI 未安装或登录过期、编译警告、副本被改动或冲突、待确认的探测项。浅色模式下对白底 5.05:1。
- **State Red 状态红**（`danger` oklch(0.577 0.245 27.325) / `danger-dark` oklch(0.704 0.191 22.216)，即 shadcn 的 `--destructive`）：连接或探测失败、编译受阻、护栏未生效、检测到密钥或疑似注入、删除操作，以及生产环境色点。浅色模式下对白底 4.76:1。
- **Agent Identity Agent 标识**（`agent-claude` oklch(0.56 0.15 40) / `agent-claude-dark` oklch(0.72 0.14 42)；`agent-openai` oklch(0.6 0.13 168) / `agent-openai-dark` oklch(0.74 0.13 168)）：只用于资源行和详情头部点亮的 Agent 按钮。Claude 的 Logo 用 `agent-claude`；OpenAI 的 Logo 用墨色，`agent-openai` 做 15% 底色和 40% 描边。

### Neutral

- **Canvas 画布**（`canvas` oklch(1 0 0) / `canvas-dark` oklch(0.148 0.004 228.8)）：主工作区背景。
- **Ink 墨**（`ink` / `ink-dark`）：正文和标题。对画布的对比度约 19.7:1。
- **Frost 霜**（`frost` oklch(0.963 0.002 197.1) / `frost-dark` oklch(0.275 0.011 216.9)）：shadcn 的 muted、secondary、accent 共用这一层，用于悬停、当前选中的回路行、代码块底色。
- **Shell 外壳**（`shell` oklch(0.987 0.002 197.1) / `shell-dark` oklch(0.218 0.008 223.9)）：侧栏底色。深色模式下卡片和浮层也用这一层。
- **Note 注记灰**（`note` oklch(0.52 0.021 213.5)，**覆盖** shadcn 生成的 0.56 / `note-dark` oklch(0.723 0.014 214.4)）：次要文字和描述。放在 frost 上是 4.91:1，放在 shell 上是 5.26:1。
- **Hairline 发丝线**（`hairline` oklch(0.925 0.005 214.3) / `hairline-dark` 白色 10%）：所有边框和分隔线，以及输入框描边。

### Named Rules

**The Ink Primary Rule.** 主操作永远是钢墨色的实心按钮。整个应用中，彩色实心按钮只允许出现一种：`destructive` 变体（10% 红底配红字）。

**The One Signal Rule.** Signal Cyan 只出现在焦点和当前选中的资源行两个场景。禁止用它做按钮底色、文字颜色、图标颜色或装饰。

**The State Owns Color Rule.** 红、琥珀、绿只能表达状态，并且必须同时带 Lucide 图标和中文状态词。没有状态含义的地方，不允许出现这三种颜色。Agent 标识色与云平台官方品牌彩色 Logo 不是状态色，只用于识别品牌身份。

## Typography

**Body Font:** 系统 UI 字体栈：system-ui、Segoe UI Variable、Segoe UI、PingFang SC、Microsoft YaHei UI、Noto Sans CJK SC。
**Label/Mono Font:** JetBrains Mono Variable（通过 `@fontsource-variable/jetbrains-mono` 自托管），回退依次为 Cascadia Mono、SF Mono、ui-monospace。

### Hierarchy

- **Title**（600，1rem/16px，1.4）：视图标题、详情里的资源标识、对话框标题。
- **Section**（600，0.875rem/14px，1.4）：列表分组标题（「服务器 (SSH)」「云平台 (CLI)」）、表单分组标题（FieldLegend）、面板标题。
- **Body**（400，0.875rem/14px，1.5）：所有界面正文、输入框、列表主名称。
- **Meta**（400，0.8rem/12.8px，1.4，颜色 note）：连接状态行、账号身份、关联摘要、时间等次要信息。
- **Label**（500，0.75rem/12px，1.3）：徽章、列表列头（「权限档位」「授权 Agent」）、快捷键提示（Kbd）。中文不做大写，也不加字距。
- **Mono**（400，0.8125rem/13px，1.5）：SSH 别名、CLI 命令名（`wrangler`、`vercel`、`oci`）、路径、命令、端口、指纹。
- **Prose**（400，0.875rem/14px，1.7）：Markdown 渲染预览，用 shadcn typeset 的 `typeset` 容器承载。中文行高更松，一行不超过 72ch。

### Named Rules

**The Mono Is Data Rule.** 等宽字体只用于机器能读的字符串：SSH 别名、CLI 名称与单行命令、路径、端口、镜像名、主机指纹。标题、按钮、说明文字禁止用等宽字体来营造「技术感」。

**The Tabular Numbers Rule.** 凡是会并排比较或会变化的数字，例如端口、耗时、字符数和行数、计数徽章，一律加 `tabular-nums`，避免数字变化时宽度抖动。

**The No Eyebrow Rule.** 标题上方禁止加小号大写的英文眉标（eyebrow 标签），也禁止加 `01 / 02` 这类装饰性步骤编号。

## Layout

- **应用外壳**：使用 shadcn Sidebar，`collapsible="icon"`，展开宽 14rem，折叠成图标模式后宽 3rem。侧栏只放三项一级导航（资源、Agent、设置），**底部不放常驻的运行环境健康列表**（收归设置页，遵循「正常即隐身」）。右侧是 SidebarInset：顶部 44px 的工具栏，下面是视图内容。窗口最小尺寸 960×600。
- **按需展开的并排检视面板（Collapsible Split Inspector）**：
  - **默认未选中态（首屏）**：右侧检视面板完全折叠隐藏，主列表单栏居中展示（`max-w-4xl`），留白充足、一目了然。
  - **选中资源或新建态**：通过 `ResizablePanelGroup` 在右侧无遮罩平推展开检视面板（默认宽 `440px`，最小 `400px`），左侧回路列表自适应收窄保留，支持直接点击左侧其他行无缝切换对照，按 `Esc` 或右上角关闭按钮随时收起回全宽。
- **详情面板内部结构（「1 + 3」平铺架构，禁止多层手风琴）**：
  - **顶部常驻控制头**：资源标识、环境徽章、状态摘要，以及日常最高频的**档位切换**与**Agent 授权开关**；低频操作（测试连接、复制别名、预览 Skill、删除）收入右上角 `⋯` 更多菜单。
  - **下方三个平铺 Tab（`<TabsList variant="line">`）**：`画像与规则`（用途、红线、探测服务/目录或云资源勾选范围）、`连接配置`（SSH 连接或 CLI 环境状态与重检）、`动态`（合并 Agent 待处理笔记与操作审计记录，有待处理笔记时显示计数 `动态 (2)`）。
- **间距节奏**：4px 网格。面板内边距 12–16px，表单字段之间 12px，表单分组之间 20px。
- **窗口宽度变化**：小于 1024px 时，侧栏默认进入图标模式。

## Elevation & Depth

整个系统是平面的。层次靠发丝线边框与色阶（canvas → frost → shell）区分。静止状态下任何元素都没有阴影；阴影只出现在 Popover、DropdownMenu、Dialog、Sheet、Toast、Tooltip 等浮层上。

## Shapes

- 圆角基准是 `--radius: 0.45rem`（small 档）。
- 按钮和输入框用 lg 档（约 7px），回路列表外框与 Agent 目标卡片用 xl 档（约 10px），徽章用胶囊形。
- 所有边框都是 1px。禁止在单侧使用超过 1px 的彩色侧边条纹。

## Components

所有组件都来自 `src/components/ui`（由 shadcn CLI 生成，源码可以改）。业务组件只能组合这些组件，不能另起一套同类组件。

### Signature 1: Breaker Row（双闸刀回路行）

资源主列表不采用多列小卡片网格，而是**外包 1px 发丝线圆角边框的单列回路组**（分为「服务器 (SSH)」与「云平台 (CLI)」两组），行与行之间以 `1px hairline` 分隔：

- **左侧身份与状态区**（点击打开右侧详情）：
  - 第一行：品牌/系统标识（云平台用官方 Logo `ProviderMark`，SSH 服务器用系统首字母或 `ServerIcon`）+ 生产/预发/开发环境色点 + 等宽标识（如 `hk-edge` 或 `cloudflare`）+ 备注名称。
  - 第二行：连接/CLI 状态（绿/琥珀/红图标 + 中文状态词）+ 核心摘要（系统与服务数，或 CLI 登录账号与已选资源数、关联的服务器别名）+ 笔记待处理徽章。若处于异常状态（如「未验证连接」「WSL 未登录」），**就地紧跟一个轻量动作按钮**（如 `[测试连接]`、`[去登录]`）；正常状态不显示多余按钮。
- **右侧双闸刀控制区**（纵向严格对齐，独立可点，点击不打开详情）：
  1. **权限档位闸刀**：点击直接在 `只读巡检`（`EyeIcon`）与 `标准运维`（`WrenchIcon`）之间切换（生产资源切往「标准运维」时弹二次确认框；切回「只读巡检」一键瞬时完成）。**当生产资源处于「标准运维」时，该按钮以琥珀色淡底与琥珀色图标文字（`bg-warning/12 text-warning border-warning/35`）高亮提醒**，防止忘记切回只读。
  2. **Agent 通电开关**（`AgentPicker`，`ToggleGroup multiple`）：每个启用的 Agent 一个 28px 方块，点亮时显示品牌色官方 Logo、15% 品牌色底加 40% 描边；未点亮时为注记灰 Logo。

### Signature 2: Budget（预览上限占用）

- 预览 Sheet（按需从更多菜单、Agent 页或 `Ctrl+\` 打开）顶部两条 `Progress` 显示硬上限：description 字符数（上限 1024）和 SKILL.md 正文行数（默认上限 100）。

### Buttons, Chips & Cards

- **Primary Button:** 钢墨底配 shell 色文字。每个面板只放一个主按钮（如新建面板底部的「连接并启用」）。
- **Cards:** 只在两处使用 `Card`：新建资源面板中的「资源类型选择项」，以及 Agent 页的「分发目标卡片」。主列表统一使用紧凑对齐的回路行容器，卡片内部绝不嵌套卡片。

### Iconography & Official Brand Logos

全部通用功能图标使用 `lucide-react`（带 `Icon` 后缀命名导入，默认 16px，徽章内 12px）。禁止使用 emoji。

**官方品牌 Logo 规范（2026-11-02 用户明确要求）：**
凡涉及具体的 AI Agent 与大厂云平台，**一律使用其官方品牌 SVG Logo**，禁止用通用云朵/三角等 Lucide 图标冒充，也禁止手写拼凑山寨图形：

1. **Agent 官方 Logo（封装于 `src/components/app/AgentMark.tsx`）**：
   - **Claude Code**：Claude 官方星芒 Logo（取自 `@lobehub/icons-static-svg/icons/claude.svg`）。
   - **通用（Codex 等）**：OpenAI 官方花瓣 Logo（取自 `@lobehub/icons-static-svg/icons/openai.svg`）。
   - **自定义目录**：无官方品牌，使用目录名称首字母缩写。
2. **云平台官方 Logo（封装于 `src/components/app/ProviderMark.tsx`）**：
   - **Cloudflare**：Cloudflare 官方双云彩色/单色 Logo（取自 `@lobehub/icons-static-svg/icons/cloudflare-color.svg` / `cloudflare.svg`）。
   - **Vercel**：Vercel 官方正三角 Logo（取自 `@lobehub/icons-static-svg/icons/vercel.svg`，墨色自适应浅深主题）。
   - **Oracle Cloud**：Oracle 官方椭圆环品牌标志（取自 `simple-icons` 官方收录的 Oracle SVG 路径或静态置于 `src/assets/brands/oracle.svg`，使用官方 Oracle 红 `#C74634` / OKLCH 等效色，仅在 `ProviderMark.tsx` 中引用）。
   - ESLint 规则限定 `@lobehub/icons-static-svg` 与 `src/assets/brands/*` 只能在 `AgentMark.tsx` 和 `ProviderMark.tsx` 两个组件内引入，确保全局视觉克制统一。

| 语义 | 图标 | 语义 | 图标 |
| :--- | :--- | :--- | :--- |
| 资源（导航） | `LayersIcon` 或 `ServerIcon` | 探测 | `RadarIcon` |
| SSH 服务器 | `ServerIcon` | 云平台 CLI | 官方 Logo（`ProviderMark`） |
| 测试连接 | `PlugIcon` | 导入 ssh config | `FileInputIcon` |
| 添加资源 | `PlusIcon` | 编译 | `HammerIcon` |
| Skill / 预览 Skill | `PackageIcon` | Agent | `BotIcon` |
| 分发同步 | `FolderSyncIcon` | 移除分发 | `FolderMinusIcon` |
| 护栏已生效 | `ShieldCheckIcon` | 护栏未安装 / 未生效 | `ShieldOffIcon` / `ShieldXIcon` |
| 红线 | `ShieldAlertIcon` | 修复 | `WrenchIcon` |
| 只读巡检档 | `EyeIcon` | 标准运维档 | `WrenchIcon` |
| 敏感 / 只读锁定 | `LockIcon` | 私钥 | `KeyRoundIcon` |
| 主机指纹 | `FingerprintIcon` | 拉起终端登录/安装 | `ExternalLinkIcon` / `SquareTerminalIcon` |
| Agent 笔记 | `NotebookPenIcon` | Agent 操作记录 | `TerminalIcon` |
| ssh 配置 / Include | `FileCogIcon` | 重新检测 / 检查 | `RefreshCwIcon` |
| Windows 环境 | `MonitorIcon` | WSL / Linux 环境 | `SquareTerminalIcon` |
| 成功 | `CircleCheckIcon` | 警告 / 冲突 / 生产可写提醒 | `TriangleAlertIcon` |
| 失败 | `CircleXIcon` | 未验证 | `CircleDashedIcon` |
| 过期 | `ClockIcon` | 拖拽排序手柄 | `GripVerticalIcon` |
| 复制 | `CopyIcon` | 打开文件夹 | `FolderOpenIcon` |
| 活动日志 | `HistoryIcon` | 设置 | `SettingsIcon` |
| 删除 | `Trash2Icon` | 命令面板 | `CommandIcon` |
| Agent 标识 | Claude、OpenAI 官方 Logo（`AgentMark`） | 云平台标识 | Cloudflare、Vercel、Oracle 官方 Logo（`ProviderMark`） |

### Motion

- 动效统一用 `motion/react`。根节点包一层 `<MotionConfig reducedMotion="user">`。
- 时长 120–220ms，缓动 `[0.25, 1, 0.5, 1]`，禁止回弹或超调（`bounce: 0`）。
- 允许动效的场景：右侧检视面板展开/收起过渡、Agent 笔记并入/忽略离场、测试连接与 CLI 环境检测状态刷新、探测步骤逐条出现、新增资源行淡入。

## Do's and Don'ts

### Do:

- **Do** 保持首屏单栏全宽配电盘的克制感：未选中任何资源时，右侧不留空白占位框、不展示工程检查表。
- **Do** 在每一条回路行右侧直接提供「档位切换」与「Agent 开关」，并在生产资源处于「标准运维」时用琥珀色醒目提醒。
- **Do** 对大厂云平台（Cloudflare、Vercel、Oracle Cloud）和 Agent（Claude、OpenAI）一律使用官方品牌 SVG Logo（集中封装在 `ProviderMark` 与 `AgentMark` 中）。
- **Do** 每一个状态都用「图标 + 中文状态词 + 颜色」三者同时表达。
- **Do** 正常状态隐身，异常状态在对应行内就地提供修复动作（如「测试连接」「打开终端登录」）。

### Don't:

- **Don't** 做「临时解锁 30 分钟」倒计时控件或解锁徽章（已全面取消，统一用行内档位切换替代）。
- **Don't** 在详情面板里堆叠多层折叠手风琴（统一为顶部常驻控制区 + 3 个平铺 Tab）。
- **Don't** 在侧栏底部常驻展示 Windows / WSL 环境可用列表。
- **Don't** 用通用图标、手绘图形或 emoji 代替大厂与 Agent 的官方 Logo。
- **Don't** 用彩色实心主按钮（主按钮只能是钢墨色），也不要把 Signal Cyan 用在焦点和选中回路行描边以外的任何地方。
