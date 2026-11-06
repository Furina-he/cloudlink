# CloudLink

CloudLink 是一个面向 AI Agent 的全栈基础设施配电盘与安全护栏桌面工具（Windows 优先，v0.1）。你在一个一目了然的「钢制配电盘」界面里接入 **SSH 服务器** 与 **云平台 CLI（Cloudflare `wrangler`、Vercel `vercel`、Oracle Cloud `oci`）**，它把全部已授权资源编译成一个符合 Agent Skills 规范的总 Skill，分发给 Claude Code、Codex 等 CLI Agent 的全局 skills 目录。在 Claude Code 上，它用护栏按档位（只读巡检 / 标准运维）拦下越界的 `ssh` 与云 CLI 命令，并记录 Agent 执行过什么。

一句话：在一个极简配电盘里管好服务器与云平台，让本机的 Agent 知道有哪些资源、彼此怎么关联、怎么连、什么事不能做，再放心地让它在护栏内帮你操作和运维。

## 文档（按阅读顺序）

| 文件 | 内容 |
| :--- | :--- |
| [PRODUCT.md](PRODUCT.md) | 产品上下文：用户、定位、原则（impeccable 格式） |
| [DESIGN.md](DESIGN.md) | 视觉系统「钢与信号 · 钢制配电盘」：设计令牌、双闸刀回路行、官方品牌 Logo 规范、动效 |
| [docs/PRD.md](docs/PRD.md) | PRD v3.1：数据模型、功能需求、配电盘 UI/UX 规范、前端工程硬约束、Rust 方案、决策日志 |
| [docs/EXECUTION-PLAN.md](docs/EXECUTION-PLAN.md) | 分阶段执行计划（P0 到 P6，含 P3.6 配电盘减负与云 CLI 改版、P6 检测更新与发布），末尾附新对话的开场提示词 |
| [docs/CC-SWITCH-EXPERIENCE.md](docs/CC-SWITCH-EXPERIENCE.md) | CC Switch VPS 模块开发实战经验与防坑清单（P4/P5 必读） |
| [docs/PRD-review.md](docs/PRD-review.md) | 对 v1 草案的评审：32 条问题及核实来源 |
| [docs/archive/prd-v1.md](docs/archive/prd-v1.md) | 原始 PRD（只读存档，原名 CloudSkill Hub） |

## 当前状态

CloudLink v0.1 已完成全部开发阶段（P0 到 P6）：前端和 Rust 核心、真实 IPC 联调、无障碍与性能打磨、应用图标、检测更新（F-406）和安装包配置。首个版本 v0.1.0 通过 [GitHub Releases](https://github.com/Furina-he/cloudlink/releases) 分发，安装包经 minisign 签名，应用内会检测更新。之后的版本在 GitHub Actions 上构建和签名：推送 `v*` 标签后自动创建草稿 Release，流程见 [docs/releases](docs/releases/README.md)。P5 手工验收清单和图标在系统各处的目测仍待维护者完成。阶段任务与验收标准见 [执行计划](docs/EXECUTION-PLAN.md)。

仓库：[Furina-he/cloudlink](https://github.com/Furina-he/cloudlink)（公开，主分支 `main`）。开发环境见执行计划第 1 节；全新检出后，直接运行 Cargo 检查前先执行 `pnpm --dir cloudlink build:guard`，准备 Tauri 所需的护栏 sidecar。

验收命令、结果、截图与遗留问题在开发会话中汇报；长期文档保留产品说明、接口约定和开发规范。

## 关键决策速览

| 主题 | 决定 |
| :--- | :--- |
| 产品名称 | CloudLink |
| 技术栈 | Tauri v2 + React 19 + shadcn/ui（base-nova）+ Lucide + 官方品牌 SVG Logo + Motion + react-resizable-panels + dnd-kit + Zustand |
| 首发平台 | Windows 10/11（原生 + WSL2）；macOS 在 v0.5，Linux 在 v1.0 |
| 编译产物语言 | 默认英文；界面语言为简体中文 |
| 资源范围 | 统一管理「服务器 (SSH)」与「云平台 (CLI：Cloudflare / Vercel / Oracle Cloud)」，支持圈定公开的 Scope 并自动关联域名与服务器 |
| 窗口与外壳 | 默认窗口对标 CC Switch（`900×640`，最小 `760×520`）；取消左侧大边栏与面包屑栏，改为顶部 48px 一体栏 |
| 界面结构 | 首屏单行零噪点「双闸刀回路行」（每行 4 个元素、零省略号）；添加用居中弹窗/独立视图，详情用带 `← 返回` 的全宽视图（无左右分栏挤压） |
| Skill 形态 | 全部已授权资源编译成一个总 Skill `cloudlink-servers`，每个「运行环境 × Agent」一份，以受管副本写进 Agent 全局目录 |
| 档位与护栏 | 档位（只读巡检 / 标准运维）在主列表行内直接切换，不设 30 分钟临时解锁；生产环境处于标准运维时琥珀色高亮提醒；Claude Code 上由 `PreToolUse` hook 拦截越界的 `ssh` 与云 CLI 命令（含拦截 `vercel env pull` 等凭据导出） |
| Agent 笔记 | Agent 把学到的东西写进收件箱，你确认后并入资源信息 |
| 视觉方向 | 「钢与信号 · 钢制配电盘」：Mist 冷钢中性色、钢墨主按钮、唯一的 Signal Cyan 信号色，大厂云平台与 Agent 一律使用官方品牌 Logo |
| 应用图标 | 「交汇 · 浅色」：白底圆角方块上，钢墨方块（服务器与云平台）与圆（Agent）隔着护栏间隙相交，交集是信号青。源文件 [docs/brand/cloudlink-icon.svg](docs/brand/cloudlink-icon.svg)，只用于安装包、任务栏、开始菜单和标题栏 |
| 更新 | 应用内检测更新（F-406）：默认开启，可在设置里关闭；只有发现新版本时顶栏才出现提醒。安装包经 minisign 签名，通过 GitHub Releases 分发 |

## 待决

- CloudLink 的商标检索。Dell、Mitel、Genetec 等公司有同名产品，但不在 AI 或开发者工具领域。
- 是否支持团队共享（v1.0 之后再评估）。
- 服务器监控（已搁置，见 `docs/PRD.md` 11.2 Q4）。
