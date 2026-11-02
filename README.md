# CloudLink

CloudLink 是一个面向 AI Agent 的全栈基础设施配电盘与安全护栏桌面工具（Windows 优先，v0.1）。你在一个一目了然的「钢制配电盘」界面里接入 **SSH 服务器** 与 **云平台 CLI（Cloudflare `wrangler`、Vercel `vercel`、Oracle Cloud `oci`）**，它把全部已授权资源编译成一个符合 Agent Skills 规范的总 Skill，分发给 Claude Code、Codex 等 CLI Agent 的全局 skills 目录。在 Claude Code 上，它用护栏按档位（只读巡检 / 标准运维）拦下越界的 `ssh` 与云 CLI 命令，并记录 Agent 执行过什么。

一句话：在一个极简配电盘里管好服务器与云平台，让本机的 Agent 知道有哪些资源、彼此怎么关联、怎么连、什么事不能做，再放心地让它在护栏内帮你操作和运维。

## 文档（按阅读顺序）

| 文件 | 内容 |
| :--- | :--- |
| [PRODUCT.md](PRODUCT.md) | 产品上下文：用户、定位、原则（impeccable 格式） |
| [DESIGN.md](DESIGN.md) | 视觉系统「钢与信号 · 钢制配电盘」：设计令牌、双闸刀回路行、官方品牌 Logo 规范、动效 |
| [docs/PRD.md](docs/PRD.md) | PRD v3.1：数据模型、功能需求、配电盘 UI/UX 规范、前端工程硬约束、Rust 方案、决策日志 |
| [docs/EXECUTION-PLAN.md](docs/EXECUTION-PLAN.md) | 分阶段执行计划（P0 到 P6，含 P3.6 配电盘减负与云 CLI 改版），末尾附新对话的开场提示词 |
| [docs/CC-SWITCH-EXPERIENCE.md](docs/CC-SWITCH-EXPERIENCE.md) | CC Switch VPS 模块开发实战经验与防坑清单（P4/P5 必读） |
| [docs/PRD-review.md](docs/PRD-review.md) | 对 v1 草案的评审：32 条问题及核实来源 |
| [docs/archive/prd-v1.md](docs/archive/prd-v1.md) | 原始 PRD（只读存档，原名 CloudSkill Hub） |

## 当前状态

- **仓库：** https://github.com/Furina-he/cloudlink （公开，分支 `main`）。
- **开发环境：** 2026-10-28 已在本机逐项核查，结果和还需补装的项目见 `docs/EXECUTION-PLAN.md` 第 1 节。
- **2026-10-27：** 完成 PRD 评审、修订版 PRD、视觉规范和执行计划。
- **2026-10-29：** P0 到 P3 完成（前端跑在 Mock 上，Rust 后端尚未开始）。
- **2026-10-30 ~ 11-01：** 方向调整为 PRD v3 并完成 P3.5 前端初版。
- **2026-11-02：** 升级为 **PRD v3.1（「钢制配电盘」减负 + 云平台 CLI 扩展）**：
  - 首屏取消常驻左右分栏与多列卡片网格，改为单列全宽的「服务器 (SSH) + 云平台 (CLI)」双闸刀回路行，未选中时隐藏右侧面板；
  - 详情面板砍掉 8 层折叠手风琴，改为「常驻控制头 + 3 个平铺 Tab（画像与规则 / 连接配置 / 动态）」，底层列入状态正常时隐身；
  - 取消「临时解锁 30 分钟」，改为在主列表回路行直接切换档位（生产环境开启标准运维时琥珀色高亮提醒）；
  - 新建 SSH 服务器支持密码自动转免密密钥并启用一步到位；
  - 新增 Cloudflare（`wrangler`）、Vercel（`vercel`）、Oracle Cloud（`oci`）云平台 CLI 接入，所有云厂商与 Agent 一律使用官方品牌 SVG Logo。
- **2026-11-02：** P3.6 前端 v3.1 改版在 Mock 下完成（紧凑窗口与顶部一体栏、单行回路、全宽详情、添加弹窗、SSH 一步到位、云平台 CLI 向导，取消临时解锁），等待验收。
- **2026-11-03：** P3.7 完成：云平台同一家可接入多个账号（`handle` 为 `cloudflare`、`cloudflare-2`…），未安装 CLI 时给出可切换安装方式的安装指引。
- **下一步：** P4 Rust 后端开发（按 P3.7 契约实现 `CliAsset.handle/account`、`CliEnvState.accounts`）。

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

## 待决

- CloudLink 的商标检索。Dell、Mitel、Genetec 等公司有同名产品，但不在 AI 或开发者工具领域。
- 应用自身 Logo（Agent 与云平台已使用各自官方品牌 Logo）。
- 是否支持团队共享（v1.0 之后再评估）。
- 服务器监控（已搁置，见 `docs/PRD.md` 11.2 Q4）。
