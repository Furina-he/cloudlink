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
- 准备让 Agent 去线上排查问题之前。

要完成的任务：在一个简单的界面里管好服务器信息，让本机的 Agent 准确知道「有哪些服务器、怎么连、哪些事不能做」，再放心地让它在护栏内帮你操作和运维。

两类用户画像见 `docs/PRD.md` 1.2，已于 2026-10-27 由用户确认。

## Product Purpose

在一个类似 Termius 的服务器管理界面里录入、测试、探测服务器信息，把全部服务器编译成一个符合 Agent Skills 规范的总 Skill，分发给本机 Agent 的全局 skills 目录。在 Claude Code 上用护栏按档位拦下越界的命令，记录 Agent 在服务器上执行过什么，并把 Agent 学到的东西经你确认后写回服务器信息。

成功意味着：

- Agent 第一次就用对 SSH 别名和目录路径；没点名是哪台服务器也能找对。
- 编译产物里没有任何凭据。
- 分发出去的每台服务器都通过了连接测试。
- 生产服务器默认只读巡检；在 Claude Code 上，只读服务器的写操作会被护栏拦下，Agent 执行过的命令都有记录。
- 从安装到「录入一台服务器、测试连接通过、分发给 Agent」不超过 5 分钟（目标值，靠可用性测试验证）。

## Positioning

它不是 SSH 终端，不是云管平台，也不是通用的 Skill 包管理器。服务器管理的体验借鉴 Termius，但主动作不是「连接」，而是「分发给 Agent、限定 Agent 能做什么」。`npx skills` 和它的图形界面 SkillDock 管的是静态 Skill 的分发。

它独有的机制有四点。

1. **生成「基础设施 Skill」。** 以本机 ssh config 和只读探测为事实来源，把全部服务器编译成一个带红线、服务器关系、运维约定和巡检清单的总 Skill。
2. **录入即验证，一键分发。** 服务器信息在界面里录入，测试连接通过才能分发；每台服务器一个「分发给 Agent」开关和一个档位，CloudLink 负责写好 ssh 配置、编译 Skill、放进每个 Agent 的全局目录并保持健康。
3. **护栏与记录。** 在 Claude Code 上用 `PreToolUse` hook 按档位拦截 ssh 命令，需要改东西时临时解锁 30 分钟；同一个 hook 记下 Agent 执行过的每条命令。护栏只防手滑，防不了刻意绕过。
4. **越用越懂。** Agent 摸清的部署方式和踩过的坑写进笔记收件箱，你确认后并入服务器信息，下次会话直接可用。

2026-10-30 起不再做项目级挂载：项目隔离只限制 Agent 知道什么，不限制它能连什么（`~/.ssh/config` 是全局的）。

## Operating Context

- 这个工具和终端并排使用。
- Agent 运行在 Windows 原生环境或某个 WSL2 发行版中。同一台电脑上会同时存在多个运行环境，每个环境有各自的 `~/.ssh/config`。
- Agent 的 SSH 认证完全交给系统 OpenSSH。界面录入的连接写进 CloudLink 托管的 `~/.ssh/cloudlink.conf`，经用户同意后通过 Include 生效，Agent 照常用 `ssh <别名>`。
- 认证支持私钥、ssh-agent 和密码。密码只存系统凭据库，只供 CloudLink 测试连接和探测；Agent 用不了密码，所以只用密码的服务器要先「改用密钥登录」才能分发。
- CloudLink 关着时，Agent 照常工作：Skill 是普通文件，护栏是独立的小程序。只有修改信息、临时解锁、处理笔记时才需要打开它。
- 除测试连接和 SSH 探测外不需要网络，可以离线使用。

## Capabilities and Constraints

- **编译产物遵循 Agent Skills 规范。** 总 Skill 的 `name` 固定为 `cloudlink-servers`，与所在目录同名；`description` 不超过 1024 字符。frontmatter 只输出 `name` 和 `description`。
- **编译产物默认用英文。** 模板文字是英文；用户填写的用途、红线、关系、约定、笔记原样输出，不做翻译。界面语言为简体中文。
- **分发一律用受管复制。** 不用符号链接和 Junction；每次编译后同步全部副本，健康检查发现副本缺失或被改动时一键修复。
- **v0.1 支持两类 Agent：** Claude Code，以及 Codex 等读取 `~/.agents/skills` 的 Agent；其他 Agent 添加为自定义目录。护栏只支持 Claude Code。
- **红线是写给 Agent 的指令，属于建议性约束。** Claude Code 上的护栏能拦下越界命令，但只解析命令文本，防不了刻意绕过。界面上必须如实标注两者的边界。
- **不导出敏感信息。** Skill 中不写入密码、私钥或 API Secret；IP 和解析后的主机信息默认不导出。
- **档位是服务器的属性。** 生产服务器默认只读巡检，切到标准运维要二次确认。
- **术语表：** 服务器、Skill、总 Skill、档位（只读巡检 / 标准运维）、红线、护栏、临时解锁、操作记录、Agent 笔记、测试连接、探测、编译、分发、列入、Agent 目标、副本缺失、冲突。
- **未决事项：**
  - Logo 和品牌资产。
  - CloudLink 的商标检索：Dell、Mitel、Genetec 等公司有同名的企业产品。
  - 是否支持团队共享（v1.0 之后再评估）。

## Brand Commitments

- **产品名称：** CloudLink（2026-10-27 确定）。
- **UI 体系是硬约束：** 用户指定 shadcn/ui Nova、Lucide、Motion、react-resizable-panels、dnd-kit（只用于排序）、Zustand。已有依赖能正确表达的组件和行为，一律不得自行实现。
- **视觉方向：** 已确认采用 `DESIGN.md` 的「钢与信号」，即 Mist 冷钢中性色、钢墨主按钮、唯一的 Signal Cyan 信号色。
- **界面语言：** 简体中文。

## Evidence on Hand

现有资料只有原始 PRD（`docs/archive/prd-v1.md`）、评审报告和修订版 PRD。没有真实用户数据，没有 Logo，也没有界面截图。不得编造用户量、评价、基准数据或客户案例。

## Product Principles

1. **简单明了。** 一级导航只有服务器、Agent、设置。服务器是唯一的主角；编译细节（预览、Lint）按需打开，不常驻。
2. **安全默认，诚实边界。** 不写凭据，默认不导出 IP，生产服务器默认只读。如实说明红线只是建议性约束，护栏只防手滑、防不了刻意绕过。
3. **只动自己创建的东西。** 只删除或覆盖带有本软件所有权标记的链接和目录。
4. **状态先于装饰。** 颜色和动效只用来表达状态（已连接、已分发、失效、生产、过期），不做装饰。
5. **复用而非发明。** 使用标准组件和标准交互，让熟悉感带来信任。

## Accessibility & Inclusion

- 达到 WCAG 2.2 AA。
- 全部操作可以只用键盘完成。排序拖拽必须有键盘替代。
- 尊重系统的「减少动态效果」设置。
- 状态不能只靠颜色表达，必须同时有图标和文字。
- 中英文混排可读，支持 150% 缩放。
