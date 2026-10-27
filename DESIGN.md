---
name: CloudLink
description: 把云资产编译为 Agent Skill 并按项目精确挂载的桌面工具。视觉体系是 shadcn/ui Nova（base-nova）加上 Mist 冷钢中性色和 Signal Cyan 信号色。
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
    padding: "8px 8px"
  sidebar-item-active:
    backgroundColor: "{colors.frost}"
    textColor: "{colors.steel}"
    rounded: "{rounded.md}"
    height: "32px"
  mount-chip:
    backgroundColor: "{colors.frost}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    height: "28px"
    padding: "0 6px"
  drop-target-active:
    backgroundColor: "oklch(0.609 0.126 221.723 / 8%)"
    textColor: "{colors.ink}"
    rounded: "{rounded.xl}"
---

<!-- 令牌来源：在 2026-10-27 用 shadcn CLI 4.22.2 实际执行 `init --preset b1sArLArQ --base base` 生成，再加上本文标注为「覆盖」的四项（note、signal、success、warning）。全部前景/背景组合都按 WCAG 公式验算过。界面实现后请运行 `/impeccable document`，以实际代码重新校准本文件。 -->

# Design System: CloudLink

## Overview

**Creative North Star: "钢与信号（Steel & Signal）"**

CloudLink 是开发者和终端并排打开、用来决定「哪个 Agent 能看见哪台服务器」的工具。它的界面应该像一块标注清楚的钢制配电面板：每个开关的状态一眼可见，没有多余的装饰。系统建立在 shadcn/ui 的 Nova 风格上，内边距和外边距紧凑，控件统一 32px 高。底色是带极轻青蓝倾向的 Mist 冷钢灰，用来承载结构。界面上只允许出现一种「信号色」Signal Cyan，标记三件事：键盘焦点、拖放落点、Agent 视角。红、琥珀、绿三种颜色只表达状态，从不拿来装饰。

这个系统明确拒绝以下几种外观：

- 云控制台式的拥挤导航和营销横幅。
- 1Panel、宝塔那种仪表盘式的环形图和大数字。
- AI 工具常见的紫色渐变、发光和闪烁星标。
- 「黑客终端」式的满屏等宽绿字。

**Key Characteristics:**

- 紧凑但不拥挤：控件高 32px，面板内边距 12px，列表行高 36–44px。
- 冷钢中性色（Mist，色相 197–229），浅色和深色两套主题同等完成度，默认跟随系统。
- 主操作按钮一律是墨色（steel），信号色只有一种（cyan）。
- 颜色就是状态：绿表示已挂载或健康，琥珀表示过期、冲突或建议性提示，红表示失效、危险或生产环境。状态不能只靠颜色，必须同时有图标和文字。
- 使用系统原生 UI 字体，与中文无缝配对；技术字符串（别名、路径、命令、Token 数）用 JetBrains Mono。
- 层次靠边框和色阶表达，平时没有阴影。阴影只出现在浮层和拖拽中的元素上。

## Colors

整体是冷钢中性色加一个信号色。所有色值都用 OKLCH，CSS 变量写在 `src/index.css`，规则见 `docs/PRD.md` 第 7.6 节。

### Primary

- **Steel Ink 钢墨**（浅色 `steel` oklch(0.218 0.008 223.9) / 深色 `steel-dark` oklch(0.925 0.005 214.3)）：主操作按钮（保存、挂载、导入、开始探测）、侧栏激活图标、进度条指示。主按钮不用彩色，这是刻意的选择：彩色要留给状态。

### Secondary

- **Signal Cyan 信号青**（浅色 `signal` oklch(0.609 0.126 221.723) / 深色 `signal-dark` oklch(0.715 0.143 215.221)，**覆盖** shadcn 默认的 `--ring`）：只用在键盘焦点环、拖拽悬停时的落点高亮（8% 底色加实线描边），以及 Agent 视角模式下可见 Skill 的描边。它在浅色模式下对白底的对比度是 3.60:1，只满足非文本对比度的 3:1 要求，因此禁止用作文字颜色。

### Tertiary

- **State Green 状态绿**（`success` oklch(0.508 0.118 165.612) / `success-dark` oklch(0.765 0.177 163.223)，新增）：已挂载、链接健康、探测成功。浅色模式下对白底 5.37:1，对 10% 自身色底 4.67:1。
- **State Amber 状态琥珀**（`warning` oklch(0.555 0.163 48.998) / `warning-dark` oklch(0.828 0.189 84.429)，新增）：探测过期、Lint 警告、同名冲突、复制模式待同步、「红线是建议性约束」类提示。浅色模式下对白底 5.05:1。
- **State Red 状态红**（`danger` oklch(0.577 0.245 27.325) / `danger-dark` oklch(0.704 0.191 22.216)，即 shadcn 的 `--destructive`）：链接失效、探测失败、检测到密钥、删除操作，以及生产环境色点。浅色模式下对白底 4.76:1。

### Neutral

- **Canvas 画布**（`canvas` oklch(1 0 0) / `canvas-dark` oklch(0.148 0.004 228.8)）：主工作区背景。
- **Ink 墨**（`ink` / `ink-dark`）：正文和标题。对画布的对比度约 19.7:1。
- **Frost 霜**（`frost` oklch(0.963 0.002 197.1) / `frost-dark` oklch(0.275 0.011 216.9)）：shadcn 的 muted、secondary、accent 共用这一层，用于悬停、当前选中行、挂载芯片底色和代码块底色。
- **Shell 外壳**（`shell` oklch(0.987 0.002 197.1) / `shell-dark` oklch(0.218 0.008 223.9)）：侧栏底色。深色模式下卡片和浮层也用这一层。
- **Note 注记灰**（`note` oklch(0.52 0.021 213.5)，**覆盖** shadcn 生成的 0.56 / `note-dark` oklch(0.723 0.014 214.4)）：次要文字和描述。原值放在 frost 上只有 4.15:1，不达标；覆盖后放在 frost 上是 4.91:1，放在 shell 上是 5.26:1。
- **Hairline 发丝线**（`hairline` oklch(0.925 0.005 214.3) / `hairline-dark` 白色 10%）：所有边框和分隔线，以及输入框描边。

### Named Rules

**The Ink Primary Rule.** 主操作永远是钢墨色的实心按钮。整个应用中，彩色实心按钮只允许出现一种：`destructive` 变体（10% 红底配红字）。

**The One Signal Rule.** Signal Cyan 只出现在焦点、落点、视角三个场景。禁止用它做按钮底色、文字颜色、图标颜色或装饰。在任意一屏里，如果信号青出现在这三个场景之外，就是违规。

**The State Owns Color Rule.** 红、琥珀、绿只能表达状态，并且必须同时带 Lucide 图标和中文状态词。没有状态含义的地方，不允许出现这三种颜色。

## Typography

**Body Font:** 系统 UI 字体栈：system-ui、Segoe UI Variable、Segoe UI、PingFang SC、Microsoft YaHei UI、Noto Sans CJK SC。
**Label/Mono Font:** JetBrains Mono Variable（通过 `@fontsource-variable/jetbrains-mono` 自托管），回退依次为 Cascadia Mono、SF Mono、ui-monospace。

**Character:** 中文界面使用操作系统自带的 UI 字体组合：Windows 上是 Segoe UI 配微软雅黑（雅黑的西文字形本身就基于 Segoe），macOS 上是 SF 配苹方。这样混排最协调，也不需要打包任何字体。等宽字体只用来承载数据：0/O、1/l/I 能清楚区分，对别名、路径和端口这类字符串很重要。

### Hierarchy

- **Title**（600，1rem/16px，1.4）：视图标题、编辑器里的资产名、对话框标题。
- **Section**（600，0.875rem/14px，1.4）：表单分组标题（FieldLegend）、面板标题、卡片标题。
- **Body**（400，0.875rem/14px，1.5）：所有界面正文、输入框、列表主标题。
- **Meta**（400，0.8rem/12.8px，1.4，颜色 note）：描述、时间、来源等次要信息。
- **Label**（500，0.75rem/12px，1.3）：徽章、表头、快捷键提示（Kbd）。中文不做大写，也不加字距。
- **Mono**（400，0.8125rem/13px，1.5）：SSH 别名、slug、路径、命令、端口、Token 数。
- **Prose**（400，0.875rem/14px，1.7）：Markdown 渲染预览，用 shadcn typeset 的 `typeset` 容器承载。中文行高更松，一行不超过 72ch。

字号阶梯比例约 1.14，是固定的 rem 值，不做流式缩放。

### Named Rules

**The Mono Is Data Rule.** 等宽字体只用于机器能读的字符串：别名、路径、命令、slug、端口、镜像名、Token 数。标题、按钮、说明文字禁止用等宽字体来营造「技术感」。

**The Tabular Numbers Rule.** 凡是会并排比较或会变化的数字，例如 Token 数、端口、耗时、计数徽章、表格中的数字列，一律加 `tabular-nums`，避免数字变化时宽度抖动。

**The No Eyebrow Rule.** 标题上方禁止加小号大写的英文眉标（eyebrow 标签）。分组标题本身就足以说明层级。

## Layout

- **应用外壳**：使用 shadcn Sidebar，`collapsible="icon"`，展开宽 16rem，折叠成图标模式后宽 3rem。右侧是 SidebarInset：顶部 44px 的工具栏，下面是视图内容。窗口最小尺寸 960×600。
- **多栏工作区**：视图内部一律用 shadcn Resizable（底层是 react-resizable-panels v4）切分，最多三栏。每个面板要设像素级的最小宽度，布局用 `useDefaultLayout` 持久化。可折叠的面板必须同时配一个工具栏按钮和一个快捷键。
- **间距节奏**：4px 网格。面板内边距 12px，表单字段之间 12px，表单分组之间 24px，工具栏里的按钮间距 4px（ButtonGroup）。标题上方留的空白多于下方。
- **密度**：列表行 36px（单行）或 44px（双行）；表格行 36px；挂载芯片 28px。
- **窗口宽度变化**：小于 1200px 时，资产页的预览栏默认折叠；小于 1024px 时，侧栏默认进入图标模式。换行或截断由 Flex/Grid 和 `truncate` 处理，字号不随窗口缩放。

## Elevation & Depth

整个系统是平面的。层次靠三种手段区分：发丝线边框、色阶（canvas → frost → shell），以及 shadcn Card 自带的 `ring-1 ring-foreground/10`。静止状态下任何元素都没有阴影。

### Shadow Vocabulary

- **Overlay**（沿用 shadcn 各组件自带的阴影）：Popover、DropdownMenu、Dialog、Toast、Tooltip。
- **Lifted**（`box-shadow: 0 8px 24px oklch(0.148 0.004 228.8 / 0.18)`，同时 `scale: 1.02`）：只用于 dnd-kit 的 DragOverlay，即被拖起的 Skill，表示「正在拿着它」。

### Named Rules

**The Flat-By-Default Rule.** 阴影只回应状态，也就是「浮起」和「被拿起」。卡片、面板、列表项禁止加装饰性阴影。

## Shapes

- 圆角基准是 `--radius: 0.45rem`（即 preset 中的 small 档）。sm、md、lg、xl 由 shadcn 按 0.6、0.8、1、1.4 的倍数自动派生。
- 按钮和输入框用 lg 档（约 7px），卡片和拖放区域用 xl 档（约 10px），列表项和挂载芯片用 md 档（约 6px），徽章用胶囊形。
- 所有边框都是 1px。禁止在单侧使用超过 1px 的彩色边框（侧边条纹）。

## Components

所有组件都来自 `src/components/ui`（由 shadcn CLI 生成，源码可以改）。业务组件只能组合这些组件，不能另起一套同类组件。每个组件到具体库的映射见 `docs/PRD.md` 第 7.3 节。

### Buttons

- **Shape:** 7px 圆角（lg），默认高 32px，sm 28px，xs 24px。图标按钮用 `icon` / `icon-sm` / `icon-xs` 尺寸。
- **Primary:** 钢墨底配 shell 色文字。每个视图里只放一个主按钮。
- **Outline / Ghost:** 次要操作用 outline，工具栏里的图标操作用 ghost。纯图标按钮必须同时有 `aria-label` 和 Tooltip。
- **Destructive:** 10% 红底配红字，只用于删除、卸载全部这类操作，并且要和 AlertDialog 配合使用。
- **Hover / Focus:** 沿用 shadcn 自带效果：悬停时底色变化，聚焦时出现 3px 信号青光环加信号青边框。

### Chips (Badges)

- **State Badge（状态徽章，实心淡底）:** 自身色的 10% 作为底色，配同色文字，前面放 Lucide 图标。在 `badge.tsx` 的 cva 里新增 `success`、`warning` 两个变体，`destructive` 沿用已有的。
- **Env Badge（环境徽章，描边加色点）:** 用 `outline` 变体，内部放一个 `CircleIcon`（size-2、fill-current）作为色点：生产是红点，预发是琥珀点，开发是注记灰点。文字依次是「生产」「预发」「开发」。描边形状和状态徽章的实心淡底在外形上就能区分开。
- **Count Badge:** 侧栏里的计数用 `SidebarMenuBadge`。失效数量大于 0 时改用状态红。

### Cards / Containers

- 只有「挂载目标」（全局 Agent 或项目）用 Card（`size="sm"`，12px 间距），因为它本身就是一个拖放区域，需要清楚的边界。资产、Skill、设置项一律用列表或表格，不用卡片网格。卡片里面不能再嵌套卡片。
- 拖拽悬停在某个目标上时：`ring-2 ring-ring` 加 `bg-ring/8`（对应组件令牌 drop-target-active）。

### Inputs / Fields

- **Style:** 32px 高，7px 圆角，发丝线描边。路径、别名这类输入框加 `font-mono`。
- **Focus:** 信号青边框加 3px 光环（shadcn 默认机制，颜色取自覆盖后的 `--ring`）。
- **Error / Disabled:** 用 shadcn `aria-invalid` 样式加 `FieldError`。校验在失焦时触发，错误文案写在字段下方。
- **Composition:** 一律用 `Field`、`FieldLabel`、`FieldDescription`、`FieldError` 组合，分组用 `FieldSet` 加 `FieldLegend`。占位符不能替代标签。

### Navigation

- 侧栏菜单项（SidebarMenuButton）高 32px。激活态由 menuAccent=subtle 决定：frost 底色配钢墨色文字。图标统一 16px。
- 视图内部的二级切换用 Tabs 的 `line` 变体，激活项下方有 2px 墨色下划线。
- 面包屑（Breadcrumb）放在工具栏左侧，只显示「视图 / 当前对象」两级。

### Signature: Mount Chip（挂载芯片）

- 基于 `Item`（`size="xs"`、`variant="muted"`）组合。从左到右依次是：档位图标（只读用 `EyeIcon`，标准用 `WrenchIcon`）、slug（等宽字体）、状态图标（正常时不显示；失效用 `Link2OffIcon` 红色；冲突用 `TriangleAlertIcon` 琥珀色；处理中用 `Spinner`），最后是 DropdownMenu 触发按钮（切换档位、在文件夹中显示、修复、卸载）。
- 芯片的进入和离开用 Motion 的 `AnimatePresence` 加 `layout`：进入时透明度从 0 到 1、y 方向位移 4px 归零，时长 180ms；离开时淡出，120ms。这个动画表达「挂上了」和「卸掉了」。

### Signature: Agent Lens（Agent 视角）

- 在任一挂载目标上选择「以此视角查看」后，左侧 Skill 列表按可见性重新标记，**不降低透明度**。实测把文字透明度降到 0.35 后，对比度只剩 2.34:1，而这些项仍然可以拖拽，属于可操作元素，必须保持 4.5:1 以上。
  - **可见项**：加 1px 信号青描边，右侧显示 `EyeIcon`。
  - **不可见项**：主文字改为注记灰（对白底仍有 5.46:1），右侧显示 `EyeOffIcon`，并附带屏幕阅读器文字「此视角不可见」。
  - 标记的出现和消失用 Motion 的 `AnimatePresence` 做透明度过渡，时长 150ms。
- 视图顶部出现一条 `Alert` 横幅，说明当前视角，例如「Agent 视角：Codex @ OpenPet-Desktop（WSL）。可见 2 个 Skill（项目 1、全局 1），另有 1 个挂载已失效」，右侧的 `AlertAction` 用来退出视角。视角的单位是「项目 × Agent」，可见集合的计算规则见 `docs/PRD.md` F-306。
- 这是本产品的签名交互：它直接回答「这个项目里的 Agent 到底能看见哪些服务器」。

### Signature: Context Budget（上下文预算）

- 三项 Token 估算各用一个 `Item size="xs"`：常驻（名称+描述）、触发（SKILL.md 全文）、按需（references 合计）。数值用等宽字体，前面加「≈」，每项配 Tooltip 解释加载时机。
- 两条 `Progress` 显示硬上限：description 字符数（上限 1024）和 SKILL.md 行数（默认上限 60，可配置）。指示条在用量低于 90% 时是钢墨色，达到 90% 后变琥珀，超过 100% 变红并配文字说明。

### Code & Markdown Preview

- 源码视图用 `CodeBlock`，配 `useHighlightedCode(code, "markdown")`、行号和复制按钮。diff 用 `CodeBlockLine variant="added|removed"`。日志用 `size="sm"`，失败时加 `variant="destructive"`。
- 渲染视图用 `streamdown` 渲染 Markdown，外面包一层 `div.typeset`。

### Iconography

全部使用 `lucide-react`，并且统一用带 `Icon` 后缀的命名导入（例如 `ServerIcon`），与 shadcn 生成的代码保持一致。默认 16px，徽章内 12px，描边宽度不改。禁止使用 emoji、品牌 Logo 或自绘 SVG。

| 语义 | 图标 | 语义 | 图标 |
| :--- | :--- | :--- | :--- |
| 资产 / VPS | `ServerIcon` | 探测 | `RadarIcon` |
| 域名 | `GlobeIcon` | 导入 ssh config | `FileInputIcon` |
| 面板 | `PanelsTopLeftIcon` | 新建 | `PlusIcon` |
| 存储 / 数据库 | `DatabaseIcon` | 编译 | `HammerIcon` |
| Skill | `PackageIcon` | 挂载（导航） | `CableIcon` |
| 挂载动作 | `LinkIcon` | 卸载 | `UnlinkIcon` |
| 链接失效 | `Link2OffIcon` | 修复 | `WrenchIcon`（菜单项） |
| 只读巡检档 | `EyeIcon` | 标准运维档 | `WrenchIcon` |
| 红线 | `ShieldAlertIcon` | 敏感/不导出 | `LockIcon` |
| 全局 Agent | `BotIcon` | 项目 | `FolderGit2Icon` |
| Windows 环境 | `MonitorIcon` | WSL / Linux 环境 | `SquareTerminalIcon` |
| 成功 | `CircleCheckIcon` | 警告 / 冲突 | `TriangleAlertIcon` |
| 失败 | `CircleXIcon` | 从未探测 | `CircleDashedIcon` |
| 过期 | `ClockIcon` | 拖拽手柄 | `GripVerticalIcon` |
| 复制 | `CopyIcon` | 打开文件夹 | `FolderOpenIcon` |
| 活动日志 | `HistoryIcon` | 设置 | `SettingsIcon` |
| Agent 视角 | `ScanEyeIcon` | 命令面板 | `CommandIcon` |

### Motion

- 动效统一用 `motion/react`。根节点包一层 `<MotionConfig reducedMotion="user">`。
- 时长 120–250ms。缓动用 ease-out-quart，即 `[0.25, 1, 0.5, 1]`。禁止回弹或超调；如果用 spring，`bounce` 必须为 0。
- 只有五个场景允许动效：挂载芯片的进入和离开、Agent 视角标记的出现和消失、拖起和放下（DragOverlay 的放大与阴影）、探测步骤逐条出现、导入后新增列表项的进入。
- shadcn 浮层（Dialog、Popover、DropdownMenu、Tooltip、Sheet、Collapsible、Toast）沿用组件自带的 tw-animate-css 和 Base UI 动画，不得再用 Motion 重复包装。
- 禁止页面加载时的错峰入场、悬停时放大回弹、装饰性的循环动画。Spinner 和 Trace 运行中的光泽动画是组件自带的，可以保留。

## Do's and Don'ts

### Do:

- **Do** 先完成 shadcn preset `b1sArLArQ` 的初始化，再按本文 frontmatter 覆盖 `--muted-foreground`、`--ring`、`--sidebar-ring`，并新增 `--success`、`--warning`。深色模式的值都要一并写上。
- **Do** 每一个状态都用「图标 + 中文状态词 + 颜色」三者同时表达，例如「已挂载」「已失效」「冲突」「已过期」「从未探测」。
- **Do** 环境徽章用描边加色点，状态徽章用淡色实底，两者从外形上就能区分。
- **Do** 别名、路径、命令、slug、Token 数一律用等宽字体（`font-mono`）。
- **Do** 用 Empty 组件做空状态，并在里面写清楚下一步该做什么（例如「从 ~/.ssh/config 导入」）。只写「暂无数据」不合格。

### Don't:

- **Don't** 用彩色实心主按钮。主按钮只能是钢墨色。
- **Don't** 把 Signal Cyan 用在焦点、落点、视角以外的任何地方，也不要拿它做文字颜色。
- **Don't** 照搬云控制台和 1Panel、宝塔仪表盘那套：大数字指标卡、环形图、营销横幅、满屏卡片网格。
- **Don't** 用紫色渐变、渐变文字、发光、玻璃拟态、闪烁星标这类「AI 工具」装饰。
- **Don't** 用满屏等宽绿字、黑底来扮演「终端」。
- **Don't** 用 emoji（包括原 PRD 里的「⚡」）、发行版或品牌 Logo、自绘 SVG 当图标。
- **Don't** 中英混写状态词，例如「Mounted (已挂载)」。界面状态词只用中文。
- **Don't** 给卡片、列表项加超过 1px 的单侧彩色边框，也不要给静止元素加装饰性阴影。
- **Don't** 在标题上方加小号大写英文眉标，也不要加 01 / 02 / 03 这类章节编号。
