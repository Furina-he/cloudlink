# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Tauri v2（Rust 后端）+ React 19 + Vite + TypeScript + Tailwind CSS v4。

- UI 统一使用 shadcn/ui（style `base-nova`，Base UI 原语）。
- 图标用 Lucide（Agent 与云平台 CLI 标识用官方品牌 Logo），动画用 Motion，布局用 react-resizable-panels，拖拽用 dnd-kit，状态管理用 Zustand。

2026-10-27 由用户确认，取代原 PRD 中的 Vue 3 / shadcn-vue 和 Electron 备选。完整依赖白名单见 `docs/PRD.md` 第七章。

## Users

主要用户是同时维护多台 VPS 并搭配 Cloudflare、Vercel、Oracle Cloud 等云平台的独立开发者和小团队全栈工程师。

- **服务器（SSH）：** 通常运行 Docker、1Panel 或宝塔。
- **云平台（CLI）：** 日常通过 `wrangler`（Cloudflare）、`vercel`（Vercel）、`oci`（Oracle Cloud）管理域名 DNS、前端与 Serverless 部署、云主机实例与防火墙。
- **Agent：** 日常开发中使用 Claude Code、Codex CLI、Cursor 等 CLI/IDE Agent。
- **工作机：** 首发平台是 Windows（原生 + WSL2），macOS 和 Linux 随后支持。

典型使用时刻：

- 新开一台服务器或接入一个云平台 CLI 后。
- 改了端口、域名解析、前端项目或容器之后。
- 准备让 Agent 去线上排查问题或部署变更之前。

要完成的任务：在一个一目了然的「配电盘」界面里管好服务器（SSH）与云平台（CLI）资源，让本机的 Agent 准确知道「有哪些服务器和云资源、彼此怎么关联、怎么连、哪些事不能做」，再放心地让它在护栏内帮你操作和运维。

两类用户画像见 `docs/PRD.md` 1.2，已于 2026-10-27 由用户确认。

## Product Purpose

在一个克制、一目了然的「钢制配电盘」界面里录入、验证、探测 SSH 服务器与云平台 CLI（Cloudflare、Vercel、Oracle Cloud），把全部已授权资源编译成一个符合 Agent Skills 规范的总 Skill，分发给本机 Agent 的全局 skills 目录。在 Claude Code 上用护栏按档位（只读巡检 / 标准运维）拦下越界的 `ssh`、`wrangler`、`vercel`、`oci` 命令，记录 Agent 执行过什么，并把 Agent 学到的东西经你确认后写回资源信息。

成功意味着：

- 打开软件第一眼就能看清所有服务器与云平台的连接状态、权限档位和授权 Agent，不需要面对多栏堆砌与复杂折叠手风琴。
- Agent 第一次就用对 SSH 别名、CLI 作用域和目录路径；没点名是哪台服务器或哪个云项目也能找对全栈链路。
- 编译产物里没有任何凭据（密码、私钥、API Secret、CLI 敏感导出）。
- 分发出去的每项资源都通过了连接或 CLI 环境验证。
- 生产环境默认只读巡检，主列表行内一键切换档位；处于标准运维的生产资源有醒目的琥珀色提醒，干完活随手切回只读。
- 从安装到「添加一台服务器或云平台 CLI、验证并启用给 Agent」不超过 3 分钟（靠「连接并启用」一步到位流程实现）。

## Positioning

它不是 SSH 终端，不是大厂云控制台的复刻，也不是替大厂做「CLI 登录引导器」。它的核心定位是 **「面向 AI Agent 的个人全栈基础设施配电盘与安全护栏」**。

它独有的机制有四点。

1. **生成「全栈基础设施总 Skill」。** 以本机 ssh config、只读探测和云平台 CLI 元数据为事实来源，把「SSH 服务器 + Cloudflare + Vercel + Oracle Cloud」编译成一个带全栈拓扑关联、红线、运维约定和巡检清单的总 Skill。
2. **一步到位接入，配电盘式开关。** 首屏是单栏全宽的「服务器 (SSH) + 云平台 (CLI)」回路列表，每行右侧直接放置「档位切换器（只读巡检 ↔ 标准运维）」与「Agent 品牌开关」。新建 SSH 服务器时填密码自动转免密密钥并启用；新建云平台 CLI 时按已启用 Agent 的运行环境精准检测安装与登录状态，圈定允许公开的域名/项目范围后一键启用。
3. **跨 SSH 与云 CLI 的统一护栏与审计。** 在 Claude Code 上用 `PreToolUse` hook 按档位拦截 `ssh`、`wrangler`、`vercel`、`oci` 命令（只读档拦截部署/修改/删除，任何档位一律拦截 `.env` 读取与 `vercel env pull` 等凭据导出），不再设复杂的「临时解锁 30 分钟」倒计时，而是直接在配电盘行上拉闸/合闸切换档位，并对生产环境的标准运维档高亮提醒。同一个 hook 记下 Agent 执行过的每条命令。
4. **越用越懂。** Agent 摸清的部署方式和踩过的坑写进笔记收件箱，你确认后并入资源信息，下次会话直接可用。

2026-10-30 起不再做项目级挂载：项目隔离只限制 Agent 知道什么，不限制它能连什么（`~/.ssh/config` 和本机 CLI 登录态都是全局的）。

## Operating Context

- 这个工具和终端并排使用。首屏默认单栏全宽展示资源列表，只有在点击某行或点击「+ 添加资源」时，右侧才无遮罩平推展开 440px 检视面板。
- Agent 运行在 Windows 原生环境或某个 WSL2 发行版中。同一台电脑上会同时存在多个运行环境，每个环境有各自的 `~/.ssh/config` 和 CLI 安装/登录态。
- Agent 的 SSH 认证完全交给系统 OpenSSH。界面录入的连接写进 CloudLink 托管的 `~/.ssh/cloudlink.conf`，经用户同意后通过 Include 生效，Agent 照常用 `ssh <别名>`。
- SSH 认证支持私钥、ssh-agent 和密码。用户在新建时填密码点击「连接并启用」，CloudLink 自动验证连接、生成 ed25519 免密密钥并安装公钥，无缝切换为密钥认证后分发给 Agent。
- 云平台 CLI（`wrangler`、`vercel`、`oci`）只针对当前已启用 Agent 的运行环境做 Login Shell 路径与 `whoami` 登录态检测；缺环境或未登录时提供单行命令与拉起终端入口，切回窗口自动刷新。
- CloudLink 关着时，Agent 照常工作：Skill 是普通文件，护栏是独立的小程序。只有切换档位、修改信息、处理笔记时才需要打开它。

## Capabilities and Constraints

- **编译产物遵循 Agent Skills 规范。** 总 Skill 的 `name` 固定为 `cloudlink-servers`，与所在目录同名；`description` 不超过 1024 字符。frontmatter 只输出 `name` 和 `description`。
- **编译产物默认用英文。** 模板文字是英文；用户填写的用途、红线、关系、约定、笔记原样输出，不做翻译。界面语言为简体中文。
- **分发一律用受管复制。** 不用符号链接和 Junction；每次编译后同步全部副本，健康检查发现副本缺失或被改动时一键修复。
- **v0.1 支持两类 Agent：** Claude Code，以及 Codex 等读取 `~/.agents/skills` 的 Agent；其他 Agent 添加为自定义目录。护栏只支持 Claude Code。
- **官方品牌图标：** Agent 标识（Claude、OpenAI）与云平台 CLI 标识（Cloudflare、Vercel、Oracle）一律使用官方品牌 SVG Logo，不自绘、不用通用替代图标。
- **红线是写给 Agent 的指令，属于建议性约束。** Claude Code 上的护栏能拦下越界命令，但只解析命令文本，防不了刻意绕过。界面上必须如实标注两者的边界。
- **不导出敏感信息。** Skill 中不写入密码、私钥或 API Secret；IP 和解析后的主机信息默认不导出；护栏强制拦截 `vercel env pull` 等 CLI 凭据导出命令。
- **档位是资源的属性，不设临时解锁倒计时。** 生产资源默认只读巡检，切到标准运维要二次确认并在行内琥珀色高亮提醒；切回只读巡检一键完成。
- **术语表：** 资源、服务器（SSH）、云平台（CLI）、作品范围（Scope）、Skill、总 Skill、档位（只读巡检 / 标准运维）、红线、护栏、操作记录、Agent 笔记、测试连接、探测、编译、分发、列入、Agent 目标、副本缺失、冲突。
- **未决事项：**
  - CloudLink 自身的应用 Logo 和品牌资产。
  - CloudLink 的商标检索：Dell、Mitel、Genetec 等公司有同名的企业产品。
  - 是否支持团队共享（v1.0 之后再评估）。

## Brand Commitments

- **产品名称：** CloudLink（2026-10-27 确定）。
- **UI 体系是硬约束：** 用户指定 shadcn/ui Nova、Lucide、Motion、react-resizable-panels、dnd-kit（只用于排序）、Zustand。已有依赖能正确表达的组件和行为，一律不得自行实现。
- **视觉方向：** 已确认采用 `DESIGN.md` 的「钢与信号」，即 Mist 冷钢中性色、钢墨主按钮、唯一的 Signal Cyan 信号色，以及「钢制配电盘（Steel Breaker Panel）」的单列双闸刀回路行布局。
- **界面语言：** 简体中文。

## Evidence on Hand

现有资料只有原始 PRD（`docs/archive/prd-v1.md`）、评审报告和修订版 PRD。没有真实用户数据，没有应用自身 Logo，也没有界面截图。不得编造用户量、评价、基准数据或客户案例。

## Product Principles

1. **一目了然，正常即隐身。** 一级导航只有资源、Agent、设置（侧栏底部不放常驻环境列表）。首屏默认是全宽单列的「服务器 (SSH) + 云平台 (CLI)」回路列表；详情面板按需在右侧平推展开，内部采用「常驻控制头 + 3 个平铺 Tab（画像与规则 / 连接配置 / 动态）」，告别多层折叠手风琴。底层环境与编译细节正常时完全隐身，只有异常时才就地浮现修复入口。
2. **安全默认，诚实边界。** 不写凭据，默认不导出 IP，生产资源默认只读，生产环境开启标准运维时常驻琥珀色提醒。如实说明红线只是建议性约束，护栏只防手滑、防不了刻意绕过。
3. **只动自己创建的东西。** 只删除或覆盖带有本软件所有权标记的链接和目录。
4. **状态先于装饰。** 颜色和动效只用来表达状态（已连接、已就绪、已分发、失效、生产、标准运维提醒），不做装饰。
5. **复用而非发明。** 使用标准组件和标准交互，让熟悉感带来信任。

## Accessibility & Inclusion

- 达到 WCAG 2.2 AA。
- 全部操作可以只用键盘完成。排序拖拽必须有键盘替代。
- 尊重系统的「减少动态效果」设置。
- 状态不能只靠颜色表达，必须同时有图标和文字。
- 中英文混排可读，支持 150% 缩放。
