# CloudLink

CloudLink 是一个面向 AI Agent 的全栈基础设施配电盘与安全护栏桌面工具（Windows 优先，v0.2）。你在一个安静、一目了然的界面里接入 **SSH 服务器** 与 **云平台 CLI（Cloudflare `wrangler`、Vercel `vercel`、Oracle Cloud `oci`）**，它把全部已授权资源编译成一个符合 Agent Skills 规范的总 Skill，分发给 Agent 的全局 skills 目录：Claude Code 的 `~/.claude/skills`，以及 Codex、Cursor、Gemini CLI、GitHub Copilot 等十几个 Agent 共用的 `~/.agents/skills`（Trae、Kiro、Continue 等只认自己目录的 Agent 检测到后单独分发）。在 Claude Code 上，它用护栏按档位（只读巡检 / 标准运维）拦下越界的 `ssh` 与云 CLI 命令，并记录 Agent 执行过什么。

一句话：在一个安静的小窗口里管好服务器与云平台，让本机的 Agent 知道有哪些资源、彼此怎么关联、怎么连、什么事不能做，再放心地让它在护栏内帮你操作和运维。

## 文档（按阅读顺序）

| 文件 | 内容 |
| :--- | :--- |
| [PRODUCT.md](PRODUCT.md) | 产品上下文：用户、定位、原则（impeccable 格式） |
| [DESIGN.md](DESIGN.md) | 视觉系统「安静钢面」：设计令牌、资源行、Agent 图标组、官方品牌 Logo 规范、动效 |
| [docs/prototype/redesign/](docs/prototype/redesign/index.html) | v0.2／P8 的可点击原型（静态 HTML，假数据） |
| [docs/PRD.md](docs/PRD.md) | PRD v4（含 P8 修订）：数据模型、功能需求、UI/UX 规范、前端工程硬约束、Rust 方案、决策日志 |
| [docs/EXECUTION-PLAN.md](docs/EXECUTION-PLAN.md) | 分阶段执行计划（P0 到 P8：P8a／b 先交付 v0.2.x 修复，P8c–f 交付 v0.3 执行通道），末尾附新对话的开场提示词 |
| [docs/CC-SWITCH-EXPERIENCE.md](docs/CC-SWITCH-EXPERIENCE.md) | CC Switch VPS 模块开发实战经验与防坑清单（P4/P5 必读） |
| [docs/PRD-review.md](docs/PRD-review.md) | 对 v1 草案的评审：32 条问题及核实来源 |
| [docs/archive/prd-v1.md](docs/archive/prd-v1.md) | 原始 PRD（只读存档，原名 CloudSkill Hub） |

## 当前状态

CloudLink v0.1 已完成全部开发阶段（P0 到 P6）：前端和 Rust 核心、真实 IPC 联调、无障碍与性能打磨、应用图标、检测更新（F-406）和安装包配置。首个版本 v0.1.0 通过 [GitHub Releases](https://github.com/Furina-he/cloudlink/releases) 分发，安装包经 minisign 签名，应用内会检测更新。之后的版本在 GitHub Actions 上构建和签名：推送 `v*` 标签后自动创建草稿 Release，流程见 [docs/releases](docs/releases/README.md)。P5 手工验收清单和图标在系统各处的目测仍待维护者完成。

**v0.2（P7）：** 体验与界面重设计（PRD v4、DESIGN.md「安静钢面」）以及四轮界面审查改动均已完成并提交，包含资源 / Agent / 动态 / 设置四个视图、简化的接入流程、自动同步与备份撤销、系统托盘和 GitHub 接入。更新内容见 [v0.2.0 发布说明](docs/releases/v0.2.0.md)。当前护栏仍只支持 Claude Code 的 SSH 与 Cloudflare / Vercel / Oracle Cloud 命令，GitHub 命令与其他 Agent 尚无强制护栏。

**P8（2026-11-13 开工）：** 已确认的 D1–D16 与工程规格已并入正式文档。**P8a／P8b 已实现，作为 v0.2.x 的独立修复批次待发布**：修复父级 skills 软链接／Junction、共用目录分发与真实送达反馈，采用不含地址的默认名称和稳定 SSH 别名，恢复原生标题栏并加入详情编辑弹窗。

**P8c–P8f 尚未开始（v0.3）：** 后续实施 GitHub 按归属自动跟随、生产资源执行通道、原有审批交互及诊断。v0.3 的检查仅在 CloudLink 运行中（含托盘）生效；彻底退出后 Skill 与独立调用入口保留，但 CloudLink 停止检查与审批。这些是后续目标行为，不是 v0.2.0 已有能力。阶段任务与验收标准见 [执行计划](docs/EXECUTION-PLAN.md)。

仓库：[Furina-he/cloudlink](https://github.com/Furina-he/cloudlink)（公开，主分支 `main`）。开发环境见执行计划第 1 节；全新检出后，直接运行 Cargo 检查前先执行 `pnpm --dir cloudlink build:guard`，准备 Tauri 所需的护栏 sidecar。

验收命令、结果、截图与遗留问题在开发会话中汇报；长期文档保留产品说明、接口约定和开发规范。

## 关键决策速览

| 主题 | 决定 |
| :--- | :--- |
| 产品名称 | CloudLink |
| 技术栈 | Tauri v2 + React 19 + shadcn/ui（base-nova）+ Lucide + 官方品牌 SVG Logo + Motion + react-resizable-panels + dnd-kit + Zustand |
| 首发平台 | Windows 10/11（原生 + WSL2）；macOS 在 v0.5，Linux 在 v1.0 |
| 编译产物语言 | 默认英文；界面语言为简体中文 |
| 资源范围 | 统一管理服务器 (SSH)、Cloudflare / Vercel / Oracle Cloud / GitHub。v0.3 GitHub 按选定个人账号／组织各一项资源，默认跟随该归属当前及未来有权访问的仓库，保留排除与手动模式，旧手选不静默扩围 |
| 窗口与外壳 | 默认 `1000×680`（最小 `760×520`）；四项导航默认在顶栏，可切侧栏；关闭后留在托盘。P8b 恢复原生系统标题栏，下层导航不重复应用名、不自绘窗口按钮，主题协调一致 |
| 界面结构 | 两行资源、正常即隐身；详情全宽无 Tab，P8b 以查看为主，更多菜单在当前页开资料／连接编辑弹窗，标题可快捷改名；添加只有一个 `+`；覆盖前备份可撤销 |
| Skill 形态 | 一个总 Skill `cloudlink-servers`，按运行环境与分发单位编译、受管复制。P8a 允许父级 skills 链接，同环境共用真实目录的 Agent 一起开关、一份副本；WSL 链到 Windows 时不重复写入。只有实际写入才算已同步 |
| 档位与护栏 | 保持只读巡检／标准运维，生产标准档琥珀提醒。当前 hook 只支持 Claude Code 的 SSH 与三家云 CLI。v0.3 运行中（含托盘）生产 SSH 与四家 CLI 两档都经独立入口检查，标准档高危或解析不明需允许一次，凭据红线不允许审批；保留 SSH 别名。彻底退出后 Skill 与入口可用、CloudLink 检查停止；旧请求不因退出获批 |
| Agent 笔记 | Agent 把学到的东西写进收件箱，你确认后并入资源信息 |
| 视觉方向 | 「安静钢面」（v0.2，对标 CC Switch 与 magpie）：灰底白卡、发丝线、状态圆点、钢墨主按钮、唯一的 Signal Cyan，大厂云平台与 Agent 一律使用官方品牌 Logo |
| 应用图标 | 「交汇 · 浅色」：白底圆角方块上，钢墨方块（服务器与云平台）与圆（Agent）隔着护栏间隙相交，交集是信号青。源文件 [docs/brand/cloudlink-icon.svg](docs/brand/cloudlink-icon.svg)，只用于安装包、任务栏、开始菜单和标题栏 |
| 更新 | 应用内检测更新（F-406）：默认开启，可在设置里关闭；只有发现新版本时顶栏才出现提醒。安装包经 minisign 签名，通过 GitHub Releases 分发 |

## 待决

- CloudLink 的商标检索。Dell、Mitel、Genetec 等公司有同名产品，但不在 AI 或开发者工具领域。
- 是否支持团队共享（v1.0 之后再评估）。
- 服务器监控（已搁置，见 `docs/PRD.md` 11.2 Q4）。
