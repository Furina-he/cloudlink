# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Tauri v2（Rust 后端）+ React 19 + Vite + TypeScript + Tailwind CSS v4。

- UI 统一使用 shadcn/ui（style `base-nova`，Base UI 原语）。
- 图标用 Lucide，动画用 Motion，布局用 react-resizable-panels，拖拽用 dnd-kit，状态管理用 Zustand。

2026-10-27 由用户确认，取代原 PRD 中的 Vue 3 / shadcn-vue 和 Electron 备选。完整依赖白名单见 `docs/PRD.md` 第七章。

## Users

主要用户是同时维护多台 VPS 的独立开发者和小团队全栈工程师。

- **服务器：** 通常运行 Docker、1Panel 或宝塔。
- **Agent：** 日常开发中使用 Claude Code、Codex CLI、Cursor 等 CLI/IDE Agent。
- **工作机：** 首发平台是 Windows（原生 + WSL2），macOS 和 Linux 随后支持。

典型使用时刻：

- 新开一台服务器后。
- 改了端口、域名或容器之后。
- 开始一个要部署到某台机器的新项目时。
- 准备让 Agent 去线上排查问题之前。

要完成的任务：让 Agent 准确知道「这个项目相关的服务器是哪几台、怎么连、哪些事不能做」，并且只知道这些。

两类用户画像见 `docs/PRD.md` 1.2，已于 2026-10-27 由用户确认。

## Product Purpose

把云资产的结构化信息编译成符合 Agent Skills 规范的 Skill，再按「项目 × Agent」的粒度精确挂载。

成功意味着：

- Agent 第一次就用对 SSH 别名和目录路径。
- 编译产物里没有任何凭据。
- 一个项目的 Agent 看不到其他项目的生产服务器。
- 从安装到完成第一个挂载不超过 5 分钟（目标值，靠可用性测试验证）。

## Positioning

它不是 SSH 终端，不是云管平台，也不是通用的 Skill 包管理器。`npx skills` 和它的图形界面 SkillDock 管的是静态 Skill 的分发。

它独有的机制有两点。

1. **生成「基础设施 Skill」。** 以本机 ssh config 和只读探测为事实来源，生成带红线和 Token 预算的 Skill。
2. **按「项目 × Agent」控制可见性。** 哪个项目里的哪个 Agent 能看见哪台服务器，由用户精确决定，并且可以用「Agent 视角」直接核对。

## Operating Context

- 这个工具和终端并排使用。
- Agent 运行在 Windows 原生环境或某个 WSL2 发行版中。同一台电脑上会同时存在多个运行环境，每个环境有各自的 `~/.ssh/config`。
- SSH 认证完全交给系统 OpenSSH（ssh-agent 和 `~/.ssh/config`）。
- 除 SSH 探测外不需要网络，可以离线使用。

## Capabilities and Constraints

- **编译产物遵循 Agent Skills 规范。** `name` 不超过 64 字符，只含小写字母、数字和连字符，并且与所在目录同名；`description` 不超过 1024 字符。frontmatter 只输出 `name` 和 `description`。
- **编译产物默认用英文。** 模板文字是英文；用户填写的用途、红线、附加说明原样输出，不做翻译。界面语言为简体中文。
- **挂载方式按环境区分。**
  - WSL（以及之后的 macOS、Linux）用符号链接。
  - Windows 原生环境默认用受管复制，因为 Claude Code 对 Junction 有已知的发现问题。Junction 作为实验选项保留。
  - 链接创建失败时，同样降级为受管复制。
- **红线是写给 Agent 的指令，属于建议性约束，不是技术隔离。** 界面上必须如实标注。
- **不导出敏感信息。** Skill 中不写入密码、私钥或 API Secret；IP 和解析后的主机信息默认不导出。
- **允许把生产资产挂到全局目标。** 但必须二次确认，挂载视图里也要常驻提示。
- **术语表：** 资产、Skill、档位（只读巡检 / 标准运维）、红线、探测、编译、挂载 / 卸载、目标（全局 Agent / 项目）、失效、冲突、Agent 视角。
- **未决事项：**
  - Logo 和品牌资产。
  - CloudLink 的商标检索：Dell、Mitel、Genetec 等公司有同名的企业产品。
  - 是否支持团队共享（v1.0 之后再评估）。

## Brand Commitments

- **产品名称：** CloudLink（2026-10-27 确定）。
- **UI 体系是硬约束：** 用户指定 shadcn/ui Nova、Lucide、Motion、react-resizable-panels、dnd-kit、Zustand。已有依赖能正确表达的组件和行为，一律不得自行实现。
- **视觉方向：** 已确认采用 `DESIGN.md` 的「钢与信号」，即 Mist 冷钢中性色、钢墨主按钮、唯一的 Signal Cyan 信号色。
- **界面语言：** 简体中文。

## Evidence on Hand

现有资料只有原始 PRD（`docs/archive/prd-v1.md`）、评审报告和修订版 PRD。没有真实用户数据，没有 Logo，也没有界面截图。不得编造用户量、评价、基准数据或客户案例。

## Product Principles

1. **所见即 Agent 所见。** 每次编辑都即时显示编译结果和上下文开销。不做用户看不到的变换。
2. **安全默认，诚实边界。** 不写凭据，默认不导出 IP，生产资产挂到全局前必须确认。如实说明红线只是建议性约束。
3. **只动自己创建的东西。** 只删除或覆盖带有本软件所有权标记的链接和目录。
4. **状态先于装饰。** 颜色和动效只用来表达状态（挂载、失效、生产、过期），不做装饰。
5. **复用而非发明。** 使用标准组件和标准交互，让熟悉感带来信任。

## Accessibility & Inclusion

- 达到 WCAG 2.2 AA。
- 全部操作可以只用键盘完成。拖拽挂载必须有键盘拖拽和开关矩阵两种替代方式。
- 尊重系统的「减少动态效果」设置。
- 状态不能只靠颜色表达，必须同时有图标和文字。
- 中英文混排可读，支持 150% 缩放。
