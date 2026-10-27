# CloudLink

CloudLink 是一个 Windows 桌面工具（v0.1）。它把服务器等云资产的信息编译成 Agent Skill，再按「项目 × Agent」的粒度挂载给 Claude Code、Codex 等 CLI Agent。

一句话：让每个项目里的 Agent 只看得到它该看的服务器，并且知道怎么连、什么事不能做。

## 文档（按阅读顺序）

| 文件 | 内容 |
| :--- | :--- |
| [PRODUCT.md](PRODUCT.md) | 产品上下文：用户、定位、原则（impeccable 格式） |
| [DESIGN.md](DESIGN.md) | 视觉系统「钢与信号」：设计令牌、组件规范、图标、动效 |
| [docs/PRD.md](docs/PRD.md) | 修订版 PRD v2.1：数据模型、功能需求、UI/UX 规范、前端工程硬约束、Rust 方案、决策日志 |
| [docs/EXECUTION-PLAN.md](docs/EXECUTION-PLAN.md) | 分阶段执行计划（P0 到 P6），末尾附新对话的开场提示词 |
| [docs/PRD-review.md](docs/PRD-review.md) | 对 v1 草案的评审：32 条问题及核实来源 |
| [docs/archive/prd-v1.md](docs/archive/prd-v1.md) | 原始 PRD（只读存档，原名 CloudSkill Hub） |

## 当前状态

- **仓库：** https://github.com/Furina-he/cloudlink （公开，分支 `main`）。
- **开发环境：** 2026-10-28 已在本机逐项核查，结果和还需补装的项目见 `docs/EXECUTION-PLAN.md` 第 1 节。
- **2026-10-27：** 完成 PRD 评审、修订版 PRD、视觉规范和执行计划。用户的六项决策已经写进 `docs/PRD.md` 11.1 节。
- **下一步：** 新开一个对话，粘贴 `docs/EXECUTION-PLAN.md` 第 7 节的开场提示词，从 P0 开始执行。

## 关键决策速览

| 主题 | 决定 |
| :--- | :--- |
| 产品名称 | CloudLink |
| 技术栈 | Tauri v2 + React 19 + shadcn/ui（base-nova）+ Lucide + Motion + react-resizable-panels + dnd-kit + Zustand |
| 首发平台 | Windows 10/11（原生 + WSL2）；macOS 在 v0.5，Linux 在 v1.0 |
| 编译产物语言 | 默认英文；界面语言为简体中文 |
| Windows 上的挂载方式 | 默认用受管复制（Junction 为实验选项）；WSL 内用符号链接 |
| 生产资产挂到全局 | 允许，但必须二次确认，并且常驻提示 |
| 视觉方向 | 「钢与信号」：Mist 冷钢中性色、钢墨主按钮、唯一的 Signal Cyan 信号色 |

## 待决

- CloudLink 的商标检索。Dell、Mitel、Genetec 等公司有同名产品，但不在 AI 或开发者工具领域。
- Logo 和品牌资产。
- 是否支持团队共享（v1.0 之后再评估）。
