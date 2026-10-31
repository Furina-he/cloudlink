# CloudLink

CloudLink 是一个 Windows 桌面工具（v0.1）。你在一个类似 Termius 的界面里录入服务器、测试连接，它把全部服务器编译成一个 Agent Skill，分发给 Claude Code、Codex 等 CLI Agent 的全局 skills 目录。在 Claude Code 上，它用护栏按档位拦下越界的命令，并记录 Agent 在服务器上执行过什么。

一句话：管好服务器信息，让本机的 Agent 知道有哪些服务器、怎么连、什么事不能做，然后在护栏内帮你运维。

## 文档（按阅读顺序）

| 文件 | 内容 |
| :--- | :--- |
| [PRODUCT.md](PRODUCT.md) | 产品上下文：用户、定位、原则（impeccable 格式） |
| [DESIGN.md](DESIGN.md) | 视觉系统「钢与信号」：设计令牌、组件规范、图标、动效 |
| [docs/PRD.md](docs/PRD.md) | PRD v3：数据模型、功能需求、UI/UX 规范、前端工程硬约束、Rust 方案、决策日志 |
| [docs/EXECUTION-PLAN.md](docs/EXECUTION-PLAN.md) | 分阶段执行计划（P0 到 P6），末尾附新对话的开场提示词 |
| [docs/PRD-review.md](docs/PRD-review.md) | 对 v1 草案的评审：32 条问题及核实来源 |
| [docs/archive/prd-v1.md](docs/archive/prd-v1.md) | 原始 PRD（只读存档，原名 CloudSkill Hub） |

## 当前状态

- **仓库：** https://github.com/Furina-he/cloudlink （公开，分支 `main`）。
- **开发环境：** 2026-10-28 已在本机逐项核查，结果和还需补装的项目见 `docs/EXECUTION-PLAN.md` 第 1 节。
- **2026-10-27：** 完成 PRD 评审、修订版 PRD、视觉规范和执行计划。用户的六项决策已经写进 `docs/PRD.md` 11.1 节。
- **2026-10-29：** P0 到 P3 完成（前端跑在 Mock 上，Rust 后端尚未开始）。
- **2026-10-30：** 方向调整为 PRD v3：取消项目级挂载，只分发到 Agent 全局目录；界面改为「服务器 / Agent / 设置」；服务器在界面里录入并测试连接。见 `docs/PRD.md` 附录 C。
- **2026-10-31：** 收敛 v0.1：全部服务器编译成一个总 Skill；Claude Code 护栏、操作记录和 Agent 笔记提前到 v0.1；分发一律用受管复制；只支持 Claude Code 和 `~/.agents/skills`；去掉 Token 估算。服务器监控讨论后搁置。
- **下一步：** 按 `docs/EXECUTION-PLAN.md` 的 P3.5 把前端改到 v3，再进入 Rust 后端。

## 关键决策速览

| 主题 | 决定 |
| :--- | :--- |
| 产品名称 | CloudLink |
| 技术栈 | Tauri v2 + React 19 + shadcn/ui（base-nova）+ Lucide + Motion + react-resizable-panels + dnd-kit + Zustand |
| 首发平台 | Windows 10/11（原生 + WSL2）；macOS 在 v0.5，Linux 在 v1.0 |
| 编译产物语言 | 默认英文；界面语言为简体中文 |
| Skill 形态 | 全部服务器编译成一个总 Skill `cloudlink-servers`：总览、服务器关系、运维约定、巡检清单，每台服务器的详情按需读取 |
| 分发 | 一律受管复制到 Agent 全局目录，不做项目级；每台服务器一个开关决定是否列入；v0.1 支持 Claude Code 和 `~/.agents/skills` |
| 档位与护栏 | 档位是服务器的属性，生产默认只读巡检；Claude Code 上由 `PreToolUse` hook 执行，可临时解锁 30 分钟，并记录 Agent 执行过的命令。护栏只防手滑，防不了刻意绕过 |
| Agent 笔记 | Agent 把学到的东西写进收件箱，你确认后并入服务器信息 |
| 连接信息 | 界面录入，写进托管的 `~/.ssh/cloudlink.conf`；认证支持私钥、ssh-agent、密码（密码只存系统凭据库） |
| 视觉方向 | 「钢与信号」：Mist 冷钢中性色、钢墨主按钮、唯一的 Signal Cyan 信号色 |

## 待决

- CloudLink 的商标检索。Dell、Mitel、Genetec 等公司有同名产品，但不在 AI 或开发者工具领域。
- Logo 和品牌资产。
- 是否支持团队共享（v1.0 之后再评估）。
- 服务器监控（已搁置，见 `docs/PRD.md` 11.2 Q4）。
