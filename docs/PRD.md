# 产品需求文档（PRD）v4：CloudLink —— 管好服务器与云平台，交给 CLI Agent 安全运维

> 本文是对 `docs/archive/prd-v1.md`（v1 草案，原名 CloudSkill Hub）的修订版，修订原因逐条记录在 `docs/PRD-review.md`。
> **v3（2026-10-30 起）是一次方向调整**：取消项目级挂载，只分发到 Agent 的全局目录；全部资源编译成一个总 Skill；Claude Code 上用护栏把档位落到实处，并记录 Agent 执行过的命令；Agent 可以把学到的东西回写成笔记；分发一律用受管复制；v0.1 只支持 Claude Code 和读取 `~/.agents/skills` 的 Agent（2026-11-07 起另外检测 Trae、Trae CN、Kiro、Continue 这几个只认自己目录的 Agent）。2026-11-01：直接点选分发给哪些 Agent，每个 Agent 的总 Skill 只含选给它的资源。
> **v3.1（2026-11-02）前端减负与云平台 CLI 演进**：
> 1. **首屏与详情彻底减负（「钢制配电盘」架构）**：取消常驻左右分栏、多列卡片网格和 8 层折叠手风琴。首屏默认是单栏全宽的「服务器 (SSH) + 云平台 (CLI)」回路列表，每行右侧直接放置**权限档位闸刀（只读巡检 ↔ 标准运维）**与 **Agent 品牌开关**；仅当选中某行或点击「+ 添加资源」时，右侧才无遮罩平推展开 440px 检视面板，内部采用「常驻控制头 + 3 个平铺 Tab（画像与规则 / 连接配置 / 动态）」。
> 2. **取消「临时解锁 30 分钟」**：移除解锁倒计时与锁回按钮，改为在主列表行上直接一键切换档位；当生产资源处于「标准运维」时以琥珀色高亮提醒。
> 3. **SSH 录入一步到位**：密码方式下点击「连接并启用」自动完成连接验证、生成 ed25519 免密密钥并安装公钥、发起首次探测与授权。
> 4. **接入云平台 CLI（Cloudflare `wrangler`、Vercel `vercel`、Oracle Cloud `oci`）**：按已启用 Agent 的运行环境精准检测 CLI 安装与 `whoami` 登录态（切回窗口自动刷新），支持圈定公开的域名/项目/实例范围（Scope），自动与 SSH 服务器建立关联，并将护栏扩展至拦截云 CLI 的写操作与凭据导出命令（如 `vercel env pull`）。所有云厂商与 Agent 一律使用官方品牌 Logo。
> **v4（2026-11-08）体验与界面重设计**：对标 CC Switch 与 magpie，从「钢制配电盘」改为「安静钢面」：资源行两行、正常即隐身，档位是状态行里可点的文字，Agent 图标组按目录计；一级导航改为资源 / Agent / 动态 / 设置，顶栏和侧栏可切换；详情去掉 Tab；分发全自动并在覆盖前备份；环境标记简化为「生产环境」开关；新增托盘、GitHub（`gh`）接入，导入时排除代码托管主机。下一版（v0.3）按档位分流引入 CloudLink 执行通道与命令审批。详见第六章、F-109、F-110、F-309、F-310、F-407、F-408 和 11.1。
> **P8 修订（2026-11-13）**：D1–D16 已确认并获开工授权。P8a／P8b 先交付 v0.2.x（链接／共用目录分发、真实送达、无地址命名、原生标题栏与详情弹窗）；P8c–P8f 随后交付 v0.3（GitHub 按归属自动跟随、生产两档执行通道、原审批与诊断）。v0.3 检查仅在 CloudLink 运行中含托盘生效，保留手动 SSH 别名；彻底退出后独立入口与 Skill 仍可用、检查与审批停止。第 8.7 章取代旧的「仅生产标准经通道／撤下别名／必须打开 GUI」规划，功能完成情况不由规格更新推断。
> 配套文件：`PRODUCT.md`（产品上下文）和 `DESIGN.md`（视觉系统，令牌以它为准）。可点击原型：`docs/prototype/redesign/`。
> 文中的库版本、Agent 目录、规范约束和各 Agent 对链接的支持情况，都在 2026-10-27 对照官方文档、changelog 和 GitHub issue 核实过，来源列在 `docs/PRD-review.md` 第三章。

| 文档属性 | 内容 |
| :--- | :--- |
| 产品名称 | CloudLink（2026-10-27 确定；正式发布前要做商标检索，见 11.2） |
| 产品形态 | 桌面客户端（Tauri v2）。**v0.1 只支持 Windows 10/11（原生 + WSL2）**；macOS 在 v0.5 支持，Linux 在 v1.0 支持 |
| 核心定位 | 在一个安静、一目了然的界面里管理 SSH 服务器与云平台 CLI（Cloudflare、Vercel、Oracle Cloud），编译成一个符合 Agent Skills 规范的总 Skill 分发给本机 Agent；在 Claude Code 上用护栏按档位拦下越界的 `ssh` 与云 CLI 命令，并记录 Agent 执行过什么 |
| 兼容生态 | v0.1：Claude Code（`~/.claude/skills`）；通用目录 `~/.agents/skills`，Codex、Cursor、Windsurf、Gemini CLI、GitHub Copilot、OpenCode、Cline、Roo Code 等 17 个 Agent 都读它；只认自己目录的 Trae、Trae CN、Kiro、Continue 检测到后单独分发（4.5）；其他目录可以添加为自定义目录。护栏只支持 Claude Code |
| 文档版本 | v4（2026-11-08 体验与界面重设计，见 11.1）；v3.1 为 2026-11-02 版，v3.0 为 2026-10-31 版 |
| 覆盖范围 | v0.1（MVP）到 v1.0。优先级与版本一一对应：P0 = v0.1，P1 = v0.5，P2 = v1.0 |

---

## 一、背景与目标

### 1.1 痛点

1. **全栈基建与云端上下文断层。** 独立开发者和小团队通常混合使用「前端 Vercel + 域名/Workers Cloudflare + 后端容器廉价 VPS / 甲骨文云」。Agent 虽然会跑 `ssh`、`wrangler`、`vercel`、`oci`，但它不知道这些资源是怎么串在一起的、别名叫什么、应该操作哪个项目或账号作用域（Scope）。每开一次对话，人都得重新画一遍架构图。
2. **手工维护成本高。** 服务器上新开容器、改了端口或绑了新域名之后，散落在各个 Markdown 里的说明很容易漏改。Agent 拿到过期信息，就会执行错误的命令。
3. **全局上下文污染。** 如果把所有服务器和云平台信息都塞进全局的 `CLAUDE.md`，每次会话都要为全文付出常驻 Token。Skill 的渐进式加载能解决这个问题：常驻的只有名称和描述，正文只在任务涉及基础设施时才加载，每项资源的详情还可以拆成按需读取的参考文件。
   - v2 曾把「开发 A 项目时 Agent 连上 B 项目的生产机」作为痛点，并为此设计了项目级挂载。v3 不再做项目级隔离，原因是它只隔离「Agent 知道什么」，不隔离「Agent 能连什么」：`~/.ssh/config` 和本机云 CLI 登录态本身都是全局的。真正降低风险的手段是档位（只读巡检）、范围圈定（Scope）、红线，以及需要硬隔离时使用低权限账号。
4. **敏感信息外泄与 CLI 裸奔风险。** 凭据（密码、私钥、API Secret）绝对不能进入模型上下文；更危险的是本机一旦 `vercel login` / `wrangler login`，Agent 不仅拥有删库删站的最高权限，甚至能跑 `vercel env pull` 一行命令把生产环境所有密钥明文拉到本地读取。IP、端口、内部路径这类拓扑信息也应该只披露最少必要的部分。
5. **Agent 上手干活时没有边界，也不留记录。** 让 Agent 到线上排查或操作时，「只读」「这个容器不能停」全靠提示词，对话一长就可能被忘掉；在跳过权限确认的模式下，危险命令会直接执行。事后也查不到 Agent 执行过什么。Agent 自己摸清的部署方式和踩过的坑，会话一结束就丢了，下次从头再摸。

### 1.2 目标用户与场景（用户画像已于 2026-10-27 确认，2026-11-02 扩展云 CLI）

| 画像 | 环境 | 资产规模 | 主要诉求 |
| :--- | :--- | :--- | :--- |
| 独立开发者 | Windows + WSL2；以 Claude Code 为主，偶尔用 Codex | 2–5 台 VPS + Cloudflare + Vercel / Oracle Cloud | 一眼看清全栈资源；不想每次重复交代域名到服务器的链路；防止 Agent 误改线上 |
| 小团队全栈 | macOS（v0.5 起支持）；Cursor 和 Claude Code 都用 | 8–20 台 VPS + 多团队云账号 | 生产环境严禁误写与拉取密钥；看清当前 CLI 登录在哪个团队账号下 |

关键场景：

| 编号 | 场景 | 用户要做的事 |
| :--- | :--- | :--- |
| S1 | 首次配置 | 打开「资源」主界面 → 添加第一台 SSH 服务器或云平台 CLI → 点亮 Agent 按钮 → 为 Claude Code 安装护栏 |
| S2 | 新开一台服务器 | 点击「+ 添加资源 → SSH 服务器」，填写地址与密码，勾选授权 Agent，点击「连接并启用」（自动转免密密钥并探测） |
| S2b | 接入云平台 CLI | 点击「+ 添加资源 → Cloudflare / Vercel / Oracle Cloud」，自动检测已启用 Agent 所在环境的 CLI 安装与登录态，勾选允许公开的域名/项目范围后启用 |
| S3 | 服务器或云资源有变更 | 重新探测或刷新范围，变化自动更新；看一眼更新了什么，不对就撤销 |
| S4 | 不想让某个 Agent 知道某项资源 | 在主列表该行右侧直接取消点亮这个 Agent 图标开关 |
| S5 | 线上排查与发版切换 | 平时行内保持「只读巡检」；需要发版或改配置时在行内点一下切到「标准运维」（生产环境会琥珀色高亮提醒），干完活随手点一下切回「只读巡检」 |
| S6 | 副本被外部程序删除或改动（例如 Agent 自动更新） | 健康检查发现问题，一键修复 |
| S7 | 想知道基础设施状况 | 对 Agent 说「巡检一下所有服务器和域名」，Agent 按 Skill 里的巡检清单逐项检查并汇报 |
| S8 | Agent 摸清了一个部署细节 | Agent 把它记成一条笔记；用户在 CloudLink 详情「动态」Tab 里确认后并入，下次会话直接可用 |
| S9 | 事后回看 | 在资源详情「动态」Tab 里查看 Agent 执行过的 `ssh` / `wrangler` / `vercel` / `oci` 命令及被护栏拦下的记录 |

### 1.3 解决方案

- **「钢制配电盘」极简主界面。** 首屏默认单栏全宽展示「服务器 (SSH)」与「云平台 (CLI)」两组对齐回路行，每行右侧直接提供「权限档位闸刀」与「Agent 品牌开关」，正常状态底层细节全部隐身；选中或新建时才在右侧无遮罩平推展开 440px 检视面板（内部为常驻控制头 + `画像与规则 / 连接配置 / 动态` 三个平铺 Tab）。
- **SSH 一步到位与云 CLI 精准引导。** SSH 服务器录入密码后点「连接并启用」，后台自动测连接、生成免密密钥并安装公钥、发起首次探测。云平台 CLI 只检测已启用 Agent 所在的运行环境（通过 Login Shell 识别 `nvm`/`fnm`/`pnpm` 路径并回显 `whoami` 身份），缺什么给单行命令拉起终端，切回窗口自动刷新，并圈定公开的域名/项目范围（自动与 VPS IP 建立关联）。
- **一个全栈基础设施总 Skill。** 全部已授权资源编译成一个 Skill（`cloudlink-servers`）。`SKILL.md` 是全栈总览：有哪些服务器与云平台、各自管什么、域名如何指向服务器、运维约定和巡检入口；每项资源的详情是按需读取的参考文件。
- **跨 SSH 与云 CLI 的统一护栏与记录（无倒计时负担）。** 在 Claude Code 上安装 `PreToolUse` hook：按每项资源的档位拦截 `ssh`、`wrangler`、`vercel`、`oci` 命令（只读档只放行查询/日志命令，拦截部署与修改；任何档位一律拦截 `.env` 读取与 `vercel env pull` 等凭据导出）。取消繁琐的「30 分钟临时解锁」，改为在主列表行上直接拉闸/合闸切换档位，生产环境处于标准运维时常驻琥珀色高亮提醒。
- **越用越懂，关着也照常工作。** Agent 把经验写进笔记收件箱经确认并入；Skill 是普通文件，护栏是独立小程序，平时关着 CloudLink 丝毫不影响 Agent 干活。

### 1.4 竞品与替代方案

| 方案 | 能做到 | 不足 | 本产品的差异 |
| :--- | :--- | :--- | :--- |
| 手写 `CLAUDE.md` / `AGENTS.md` | 零成本 | 全局常驻；没有结构；容易过期；容易写进敏感信息 | 结构化 + 探测；按需加载；不写凭据 |
| `npx skills`（Vercel skills CLI，支持 79 种 Agent，用软链接或复制分发），以及它的本地图形界面 SkillDock | 分发 Git 仓库里的静态 Skill，`.agents/skills` 是它的共享目录 | 不生成内容；不维护服务器事实；没有红线和探测 | 生成并维护基础设施事实。与它们共存：遵循同样的目录约定，避免同名冲突 |
| 1Panel、宝塔等面板，云厂商控制台 | 管理服务器 | 不面向 Agent 上下文 | 不重做面板，只负责编译上下文 |
| Termius 等 SSH 客户端 | 主机管理体验好：主机卡片、分组、标签、右侧详情、测试连接 | 面向人连接服务器，不面向 Agent 上下文 | 借鉴它的主机管理体验；主动作从「连接」换成「分发给 Agent、限定 Agent 能做什么」；不做终端，不保存可供 Agent 使用的密码 |
| Agent 自带的记忆功能 | 自动记住 | 不可控、不可审计 | 显式、可审计、可随时停止分发 |
| 让 Agent 自己 ssh 上去摸清服务器，写一份说明 | 零成本，内容贴近现场 | 换会话、换 Agent 时内容不一致；连接信息和凭据容易被写进去；没有护栏和操作记录 | 统一、可审计的服务器信息；凭据不进上下文；拦得住的护栏、操作记录，以及经用户确认的回写 |

### 1.5 成功指标（MVP）

| 指标 | 目标 | 测量方式 |
| :--- | :--- | :--- |
| 首次分发耗时 | 5 名目标用户中至少 4 人在 5 分钟内完成「录入一台服务器、测试连接通过、分发给 Agent」 | 可用性测试（产品不内置遥测） |
| 探测成功率 | 在 Ubuntu、Debian、CentOS Stream、Rocky、Alpine 上 ≥ 95% | 自动化测试矩阵（容器内 sshd） |
| 凭据泄漏 | 密钥扫描对测试样本集的漏放行数为 0 | 单元测试样本集 |
| 失效检出 | 应用启动或窗口重新聚焦后 2 秒内检出缺失或被改动的副本 | 集成测试 |
| 护栏准确性 | 对护栏样本集：只读服务器上写操作和凭据读取的漏放行数为 0；巡检清单中命令的误拦数为 0 | 单元测试样本集 |

---

## 二、产品原则与安全边界

1. **凭据零进入模型上下文。** Skill 中禁止出现明文密码、私钥内容和云厂商 API Secret。编译前必须做密钥扫描，命中就阻断发布（F-205）。Agent 的认证完全交给系统 OpenSSH，Skill 里只写 Host 别名。
   - 用户在界面里录入的密码只存进系统凭据库（Windows 凭据管理器），不进 SQLite、不进日志、不进 Skill，只供 CloudLink 自己测试连接、探测和安装公钥时使用（F-108）。
   - 私钥只记录文件路径，不读取、不复制私钥内容。例外有两个：CloudLink 为用户生成的密钥（F-108）；用户在新建或编辑连接时确认「复制到 WSL」后，CloudLink 把这把私钥复制到该 WSL 发行版的 `~/.ssh/` 并设置 600 权限，重名时加后缀、不覆盖（6.5，2026-10-31 用户确认）；Windows 上同理，用户在私钥预检提示「其他用户也能读取」时确认「复制到 ~/.ssh」后，CloudLink 复制一份只有当前用户能读的副本到 `%USERPROFILE%\.ssh\`，重名加后缀、不覆盖（F-108，2026-11-07）。
2. **拓扑最小披露。** IP、解析后的 HostName、User、Port 默认不导出。每个字段都有独立的导出开关（F-105）。生产服务器默认使用「只读巡检」档，切换到「标准运维」前必须二次确认。
3. **红线诚实。** 写在 `SKILL.md` 里的红线是给 Agent 的指令，属于建议性约束，不是技术隔离。Claude Code 上的护栏（F-306）会拦下越界命令，但它只解析命令文本：能防手滑，防不了刻意绕过（例如把命令编码后再执行，或者先上传脚本再运行）。界面和编译产物都要如实说明这一点。Claude Code 官方文档也明确写了：权限 deny 规则本身「不是安全边界」，真正的强制隔离要靠沙箱。需要硬隔离时，引导用户使用低权限 SSH 用户（P2 提供辅助）。
4. **渐进式披露。** 加载口径分三层：常驻（总 Skill 的 name + description）、触发后加载（`SKILL.md` 正文：总览、关系、档位、规则）、按需读取（`references/*`：每台服务器的详情和巡检清单）。正文行数上限是可配置的 Lint 规则（默认 100 行），不是硬性限制。
5. **单一数据源。**
   - 数据只存一份，在本地 SQLite。
   - 渲染只有一份实现，即 Rust 编译器，预览和发布都调用它。
   - 类型只有一份来源：Rust 结构体经 ts-rs 自动生成 TypeScript 类型。
6. **只动自己创建的东西。** 所有编译产物和分发出去的 Skill 都带所有权标记。软件绝不覆盖、也绝不删除不是自己创建的文件或目录。
   - ssh 配置：只写 CloudLink 自己的托管文件；在用户的 `~/.ssh/config` 中只加一行 `Include`，并且要先征得同意（F-107）。
   - `known_hosts`：只在用户核对主机指纹并确认后，由 ssh 自身通过 `StrictHostKeyChecking=accept-new` 写入；确认后立即写入，之后认证失败也不必再核对一次。用户的 `known_hosts` 里已经有这个地址的同一把公钥（普通记录，不含 `@revoked`、`@cert-authority`）时直接沿用，为别名补一条记录，不再询问（2026-11-07）。
   - Claude Code 的 `~/.claude/settings.json`：只增删 CloudLink 自己的那一条 hook，要先征得同意，修改前备份（F-306）。
7. **本地优先，零遥测。** 只在三种情况下联网：测试连接与 SSH 探测；云平台 CLI 检测（由本机 CLI 发起）；检查更新（F-406）。检查更新默认开启，可以在设置中关闭；它只向 GitHub Releases 请求版本清单 `latest.json`，有新版本时在后台下载签名过的安装包，不上传任何数据（2026-11-05 用户确认，2026-11-09 改为后台下载）。

---

## 三、核心概念与数据模型

### 3.1 概念

| 概念 | 定义 |
| :--- | :--- |
| 运行环境 Environment | Agent 运行、并且 ssh 与云平台 CLI 在其中生效的系统环境，取值为 `windows`、`wsl:<发行版>`、`macos` 或 `linux`。同一台电脑上可以同时存在多个运行环境，各有自己的 `~/.ssh/config`、CLI 登录态和 Agent 全局目录 |
| 资源 Resource（数据模型叫 Asset） | 被描述并交给 Agent 操作的基础设施单元，分为两类：**服务器（SSH）**（`type: "vps"`，走系统 `ssh`）和 **云平台（CLI）**（`type: "cli"`，`provider` 为 `cloudflare` / `vercel` / `oracle`，分别走 `wrangler` / `vercel` / `oci`） |
| 范围 Scope（仅云平台 CLI） | 用户在云平台账号下勾选允许公开给 Agent 的资源子集（例如指定的域名 Zone、Worker、Vercel 项目、OCI 实例）。未勾选的资源不进入编译产物；域名解析若指向某台已录入 SSH 服务器的 IP，自动标记关联关系 |
| 总 Skill | 编译单元。列入的全部资源（SSH 服务器 + 云平台 CLI）编译成一个 Skill，名称固定为 `cloudlink-servers`：`SKILL.md` 是全栈总览，每项资源的详情是一个参考文件。每个「运行环境 × Agent」各编译一份，只包含分发给这个 Agent、并且在该环境里已就绪的资源 |
| 列入 Inclusion | 一项资源是否出现在某个运行环境里某个 Agent 的总 Skill 里。由「这项资源是否点选了这个 Agent × 该环境中是否有可用连接或已登录的 CLI」决定 |
| 档位 Mode | `read-only`（只读巡检）或 `standard`（标准运维）。是资源的属性，所有 Agent 共用，在主列表回路行右侧可直接一键切换（不设 30 分钟临时解锁倒计时）；生产资源处于 `standard` 时琥珀色高亮提醒。在 Claude Code 上由护栏执行 |
| Agent 目标 Target | 某个运行环境中某个 Agent 的全局 skills 目录，例如「Claude Code · Windows」。v3 只有这一种目标，不再有项目目标 |
| 分发 Delivery | 总 Skill 在某个 Agent 目标中的受管副本，每个已启用的目标一份 |
| 护栏 Guard | 安装在 Claude Code 中的 `PreToolUse` hook，按资源的档位放行或拦下 `ssh`、`wrangler`、`vercel`、`oci` 命令，并把判定过的命令记下来（F-306、F-307） |
| Agent 笔记 | Agent 按总 Skill 中的约定写进笔记收件箱的条目，用户确认后才并入资源信息（F-308） |
| 连接与环境验证 | SSH 服务器最近一次「测试连接」或探测是否成功；云平台 CLI 在对应运行环境是否已安装且已登录（`whoami` 通过）。未验证通过的资源不能分发给 Agent |
| 探测 ProbeRun | 对 SSH 服务器的一次只读采集，或对云平台 CLI 可选资源列表的拉取。结果自动合并，可以撤销；疑似注入的值要用户确认才合并 |

### 3.2 关系

```text
Environment 1 --- n Target（Agent 全局目录）
Environment × Agent 1 --- 1 总 Skill 编译产物 1 --- n Delivery（每个已启用目标一份副本）
Asset (vps | cli) n --- n Environment × Agent（Inclusion：是否列入这一份总 Skill）
Asset 1 --- n ProbeRun    Asset 1 --- n Operation（护栏记录）    Asset 1 --- n AgentNote
```

### 3.3 资源（Asset：SSH 服务器与云平台 CLI）数据结构

```jsonc
// 1. SSH 服务器（type: "vps"）
{
  "id": "ast_01JB3Q8Z6W",                   // ULID
  "type": "vps",
  "name": "香港边缘节点",
  "production": true,                       // 2026-11-08 起取代 envTag（prod → true，staging/dev → false）；驱动默认档位、二次确认、琥珀提醒、Lint 与执行通道分流
  "provider": "Tencent Cloud",              // 可选
  "region": "HK",                           // 可选
  "tags": ["edge", "1panel"],
  "summary": "承担 api.example.com 与 blog.example.com 的公网反代及后端 API 容器托管",
  "connection": {
    "source": "managed",                    // managed：在 CloudLink 中录入，写入托管 ssh 配置（F-107）；imported：来自用户自己的 ssh config，CloudLink 只读
    "sshAlias": "hk-edge",                  // Agent 使用的别名。新建时自动生成稳定且不含地址的别名，在高级中可改，不能与该环境 ssh config 中已有的 Host 重名
    "host": "203.0.113.10",                 // 仅 managed：IP 或域名。默认不导出
    "port": 22,                             // 仅 managed
    "user": "root",                         // 仅 managed
    "auth": {                               // 仅 managed（F-108）
      "method": "key",                      // key：私钥文件 | agent：ssh-agent 中的密钥 | password：密码（新建点「连接并启用」时自动生成密钥并切换为 key）
      "identityFile": {                     // 仅 key：按运行环境分别记录路径
        "windows": "C:\\Users\\me\\.ssh\\id_ed25519",
        "wsl:Ubuntu-24.04": "/home/me/.ssh/id_ed25519"
      },
      "generatedByCloudLink": false         // 由密码自动转换或「改用密钥登录」生成的密钥为 true，删除服务器时可以一并清理
    },
    "proxyJump": null,                      // 仅 managed，可选：另一台服务器的别名
    "definedIn": ["windows", "wsl:Ubuntu-24.04"],
    "resolved": {                           // 由 `ssh -G` 得到的只读快照，默认不导出
      "hostname": "203.0.113.10", "user": "root", "port": 22, "proxyJump": null,
      "resolvedAt": "2026-10-27T10:30:00Z"
    },
    "verified": {                           // 最近一次测试连接或探测的结果；连接字段被修改并保存后清空
      "ok": true, "at": "2026-10-27T10:30:00Z", "envIds": ["windows", "wsl:Ubuntu-24.04"]
    }
  },
  "agent": {
    "agents": ["claude-code", "universal"], // 分发给哪些 Agent（F-303，AgentKey）；为空表示不分发
    "mode": "read-only"                     // 档位（read-only | standard），所有 Agent 共用；v3.1 起不再有 unlockedUntil
  },
  "facts": {
    "os": "Ubuntu 24.04 LTS", "kernel": "6.8.0-45-generic", "arch": "x86_64",
    "cpuCores": 2, "memoryTotalMiB": 1987, "diskTotalGiB": 40,
    "panel": { "type": "1panel", "installPath": "/opt/1panel" }
  },
  "paths": [
    { "key": "nginx-conf", "label": "OpenResty 站点配置目录", "path": "/opt/1panel/apps/openresty/openresty/conf/conf.d", "source": "manual" },
    { "key": "compose-root", "label": "Docker Compose 编排目录", "path": "/opt/1panel/docker/compose", "source": "manual" }
  ],
  "services": [
    {
      "kind": "docker", "name": "openresty", "image": "openresty:1.21",
      "ports": [ { "hostIp": "0.0.0.0", "hostPort": 443, "containerPort": 443, "proto": "tcp" } ],
      "role": "主网关与 SSL 终结", "critical": true,
      "source": "probe", "lastSeenAt": "2026-10-27T10:30:00Z", "missing": false
    }
  ],
  "servedHostnames": ["api.example.com", "blog.example.com"],
  "listeningPorts": [ { "addr": "0.0.0.0", "port": 22, "proto": "tcp" } ],
  "guardrails": {
    "rules": [
      { "id": "r1", "text": "机器内存仅 2GB，严禁在宿主机直接执行 npm run build 或 cargo build 等高内存编译任务" }
    ]
  },
  "export": { "resolvedConnection": false, "listeningPorts": false, "image": true },
  "notes": "",
  "probe": { "lastRunId": "prb_01JB3R", "lastSuccessAt": "2026-10-27T10:30:00Z", "status": "ok" },
  "createdAt": "2026-10-20T08:00:00Z", "updatedAt": "2026-10-27T10:31:00Z"
}

// 2. 云平台 CLI 资源（type: "cli"，2026-11-02 新增）
{
  "id": "ast_01JB9CLI01",
  "type": "cli",
  "cliProvider": "cloudflare",              // "cloudflare" (wrangler) | "vercel" (vercel) | "oracle" (oci)
  "name": "Cloudflare",
  "production": true,
  "summary": "主域名 DNS 解析与边缘 API Gateway Worker",
  "cli": {
    "binary": "wrangler",                   // wrangler | vercel | oci
    "envStates": {                          // 按已启用 Agent 所在的运行环境记录 CLI 状态（经 Login Shell 检测）
      "windows": {
        "installed": true,
        "version": "3.99.0",
        "path": "C:\\Users\\me\\AppData\\Roaming\\npm\\wrangler.cmd",
        "authenticated": true,
        "account": "me@example.com",        // whoami 回显的账号/团队名，防止登错团队
        "checkedAt": "2026-11-02T09:00:00Z"
      }
    },
    "scope": [                              // 用户勾选允许公开给 Agent 的资源项（未勾选的不写入 Skill）
      { "id": "zone_1", "kind": "zone", "name": "example.com", "selected": true, "linkedAssetId": "ast_01JB3Q8Z6W" },
      { "id": "zone_2", "kind": "zone", "name": "personal.me", "selected": false },
      { "id": "worker_1", "kind": "worker", "name": "api-gateway", "selected": true }
    ]
  },
  "agent": {
    "agents": ["claude-code", "universal"],
    "mode": "read-only"
  },
  "guardrails": { "rules": [] },
  "notes": "",
  "createdAt": "2026-11-02T09:00:00Z", "updatedAt": "2026-11-02T09:00:00Z"
}
```

v3 / v3.1 相对 v2 的变化：

- `Asset` 支持两类资源：`type: "vps"`（SSH 服务器）和 `type: "cli"`（Cloudflare / Vercel / Oracle Cloud 云平台 CLI，2026-11-02 新增）。
- `connection` 增加 `source`、`host`、`port`、`user`、`auth`、`proxyJump`、`verified`。手工录入的服务器（managed）由 CloudLink 写进托管 ssh 配置；导入的服务器（imported）连接信息只读，仍由用户自己的 ssh config 维护。
- 新增 `agent`（分发给哪些 Agent 和档位）。`guardrails.defaultMode` 移除：档位不再是「新建挂载时的默认值」，而是该资源唯一的档位。2026-11-02 去掉 `unlockedUntil`（取消 30 分钟临时解锁，改为在主列表回路行直接切换档位）。
- 密码不出现在数据结构里，只在系统凭据库中以服务器 id 为键保存；新建时选密码点「连接并启用」会自动转换为免密密钥。
- 去掉 `slug`：编译单元改为总 Skill，每项资源的详情文件按别名或 CLI 标识命名（5.3）。

v2 相对 v1 的变化（原因见评审报告 R-11 到 R-13）仍然有效：易变指标不进入产物；`domains` 改名为 `servedHostnames`；`ports` 结构化；环境改为单选字段 `envTag`；2026-11-08 再简化为布尔字段 `production`（F-109），预发和开发不再区分，因为它们不触发任何行为。

总 Skill 的全局内容（F-201）不属于任何一台服务器，存在设置里：

```jsonc
{
  // 资源关系（2026-11-07）：CloudLink 从资源数据自动整理（跳板机、同一台主机、域名解析、承载的站点、云主机实例），
  // 不存进这里；这里只存用户的修改。旧版的 relationships 长文本迁移成 id 为 rel_legacy 的一条补充
  "relationNotes": [                        // 用户补充或改写的关系，原文逐字渲染在自动整理的之后
    { "id": "r1", "text": "The API containers on hk-edge use the PostgreSQL database on sg-db over the private network." },
    { "id": "r2", "text": "sg-db is reached through hk-edge; open a tunnel for psql.", "replaces": "jump:ast_sg_db" }  // 改写某条自动关系
  ],
  "hiddenRelations": ["jump:ast_sg_db"],    // 隐藏的自动关系 id；改写时同时隐藏原句
  "conventions": [                          // 运维约定，有序，原文逐字渲染
    { "id": "c1", "text": "Deploy with docker compose in /opt/apps/<name>; never edit containers by hand" },
    { "id": "c2", "text": "Tell the user before restarting anything on a production server" }
  ]
}
```

### 3.4 运行环境、Agent 目标与分发

```ts
type EnvId = "windows" | "macos" | "linux" | `wsl:${string}`;

interface Environment {
  id: EnvId; label: string;                 // 例如 "WSL - Ubuntu-24.04"
  home: string;
  sshConfigPath: string; available: boolean;
  managedSshConfig: { path: string; included: boolean };  // 托管文件位置；用户的 ~/.ssh/config 是否已加入 Include（F-107）
  sshAgentKeys: number | null;              // 该环境 ssh-agent 中已加载的密钥数（`ssh-add -l`）；agent 不可用时为 null（6.5，2026-10-31 补充）
}

type AgentId = "claude-code" | "universal" | "trae" | "trae-cn" | "kiro" | "continue" | "custom"; // 检测后才加入专用目标（4.5），不固定行数

interface Target {                          // 只有 Agent 全局目录这一种目标
  id: string;
  envId: EnvId;
  agent: AgentId;
  agentKey: string;                         // 服务器卡片上点选的单位：内置 Agent 取 AgentId，自定义目录取 `custom:<名称>`；同一个 Agent 在各运行环境的目录共用（2026-11-01）
  label: string;                            // 例如 "Claude Code"
  path: string;                             // 全局 skills 目录
  enabled: boolean;                         // 关闭后，CloudLink 从这个目录移除自己分发的总 Skill
  detected: boolean;                        // 是否检测到这个 Agent（未检测到也可以手动启用）
}

type Mode = "read-only" | "standard";

interface Inclusion {                       // 一台服务器是否列入某个运行环境里某个 Agent 的总 Skill；每个已启用的「运行环境 × Agent」一行
  assetId: string; envId: EnvId; agentKey: string;
  included: boolean;
  reason?: { id: string; params?: Record<string, string | number> };  // 未列入的原因：没有点选这个 Agent（agent-off）、该环境没有连接配置、WSL 中没有配置私钥等
}

type DeliveryStatus =
  | "ok" | "pending"
  | "missing"                               // 副本被外部程序删除
  | "modified"                              // 副本被改动过（实际内容与所有权标记中的哈希不一致）
  | "outdated"                              // 副本不是最新的编译结果（上次同步失败）
  | "conflict"                              // 目标位置已有同名目录，而且不是 CloudLink 创建的
  | "broken"                                // 父目录解析、访问或实际写入失败；不是同名冲突
  | "shared";                               // 未单独写入：停用成员仍共用副本，或 WSL 共用 Windows

interface Delivery {                        // 总 Skill 在一个目标中的受管副本
  id: string; targetId: string; envId: EnvId;
  path: string;
  status: DeliveryStatus;
  statusDetail?: { id: string; params?: Record<string, string | number> };  // 只返回 id 和参数
  checkedAt: string;
  unitId?: string;                          // 同环境的真实目录分发单位，实际送达计数据此去重
  sharedAgentKeys?: string[];               // 共用目录的已登记成员；用于既有图标与副行说明
}

interface GuardStatus {                     // 每个有 Claude Code 目标的运行环境一条（F-306）
  envId: EnvId;
  state: "active" | "not-installed" | "broken" | "unavailable";
  detail?: { id: string; params?: Record<string, string | number> };  // broken：条目被删、自检失败、设置了 disableAllHooks；unavailable：WSL 互操作已关闭
  settingsPath: string;
  planned: { entry: string; backupPath: string };  // 安装时将加入 settings.json 的 JSON 原文和备份位置，安装对话框照此展示（F-306 AC1，2026-10-31 补充）
  deniedToday: number;                      // 今天在这个运行环境里拦下的命令数（6.6，2026-10-31 补充）
  checkedAt: string;
}

interface Operation {                       // 护栏判定过的一条命令（F-307）
  id: string; assetId: string; envId: EnvId;
  at: string; sessionId: string; cwd: string;
  command: string;                          // 已脱敏
  decision: "allowed" | "denied";
  reasonId?: string;                        // 拦下的原因，例如 read-only、volume-delete、credential-read、cli-env-export、unparsed
}

interface AgentNote {                       // Agent 写进收件箱的一条笔记（F-308）
  id: string; assetId: string;
  text: string; writtenAt: string;          // 取行首日期，没有日期时取读入时间
  flags: ("secret" | "injection")[];        // 命中密钥的笔记必须编辑后才能并入
  status: "pending" | "merged" | "dismissed";
}
```

分发规则：

- 默认每个「运行环境 × Agent」编译一份总 Skill，只列入该 Agent 已选择、目标已启用且该环境连接／CLI 绑定已就绪的资源；不满足记为「未列入」及原因。新建「连接并启用／保存并启用」默认选择全部已启用目标、只读巡检；离线保存不冒充已启用。
- 点选按 Agent 计，不分运行环境：一个 Agent 的 Windows／WSL 目标一起参与，但每个环境独立核对就绪与实际写入。选择开启、列入或编译成功都不代表已同步；只有实际受管副本写入成功才报送达，部分成功与失败返回具体状态。
- **同环境共用真实父目录（P8a，D13）**：一组 Agent 是一个分发单位，资源开关对组内已启用成员一起生效、图标一起点亮／熄灭，返回受影响成员并在现有提示里说明。首次发现选择不一致先取交集，不静默扩大，现有副行提示不一致，用户开关一次后对齐；一份编译产物、一份副本，标记可选 `agent_keys` 兼容组内旧 `agent_key`。不新增共享目录行或范围确认弹窗。
- **跨环境共用（P8a，D15）**：WSL skills 链到对应已登记 Windows 目录时只由 Windows 写入；WSL 状态为「与 Windows 共用目录，未单独提供」，不参与同环境分组、不误报冲突或同步成功。其他不支持挂载返回明确原因。
- 停用目标、删除资源、取消点选只更新或移除 CloudLink 自己的副本；共用目录仍有成员使用时不移除，全部不需要或无列入资源才移除。移除自定义目录且该 Agent 已无别的目录时清除它的资源选择。
- 新启用目标或新增可用连接时自动编译与同步；父目录解析、隔离边界、叶子安全、共用组和真实反馈的工程规则见 8.2。

### 3.5 编译产物目录与所有权

```text
~/.cloudlink/                                   Windows 上是 %USERPROFILE%\.cloudlink\
  data.db                                       SQLite（WAL 模式），唯一数据源（不含密码）
  compiled/
    windows/claude-code/cloudlink-servers/      每个「运行环境 × Agent」一份（WSL 为 wsl-<发行版>/，自定义目录为 custom-<名称>/），只含分发给这个 Agent 并在该环境列入的服务器
      SKILL.md                                  总览：服务器表、关系、档位与护栏、规则、巡检入口、笔记约定
      references/hk-edge.md                     每台服务器的详情，文件名取自别名
      references/health-check.md                巡检清单
      .cloudlink.json                           所有权标记：managedBy、envId、agentKey、contentHash、compiledAt、templateVersion
  bin/cloudlink-guard.exe                       护栏程序，从安装目录复制过来，hook 指向这个固定路径
  guard/policy.json                             护栏策略：每台服务器的别名、地址、档位、关键服务，每个云平台的 CLI 与档位
  guard/log/2026-10-31.jsonl                    护栏记录，CloudLink 读入数据库后清理
  inbox/hk-edge.md                              Agent 笔记收件箱：Agent 只追加，CloudLink 读入后清空
  logs/
~/.ssh/cloudlink.conf                           托管 ssh 配置。每个运行环境各一份（WSL 中为 /home/<user>/.ssh/cloudlink.conf）
```

分发产生的副本示例：`~/.claude/skills/cloudlink-servers/` 是 `~/.cloudlink/compiled/windows/claude-code/cloudlink-servers/` 的受管副本；WSL 中的 `~/.claude/skills/cloudlink-servers/` 由 CloudLink 经 `\\wsl.localhost\<发行版>\...` 路径直接写入（8.2）。

规则：

- 一个目标目录里只有一个 `cloudlink-servers`。
- 保存、应用或撤销探测、切换档位、合并笔记、修改全局内容，都会重新编译，并在同一次发布中同步全部副本。
- 目录名等于 Skill 的 `name`（`cloudlink-servers`），满足规范中 `name` 与父目录同名的要求。

---

## 四、功能需求

### 4.1 模块一：资源（服务器 SSH 与云平台 CLI）

| 编号 | 功能 | 优先级 | 需求与验收标准（AC） |
| :--- | :--- | :--- | :--- |
| F-101 | 资源管理 | P0 | 统一管理 SSH 服务器（`vps`）与云平台 CLI（`cli`），字段见 3.3。**AC1：** SSH 服务器的别名与云平台 CLI 的标识在全部资源中唯一（不区分大小写）；managed 服务器的别名还要满足 F-107 AC3。**AC2：** 删除资源前，确认框说明它会从总 Skill 中移除；managed 服务器同时删除托管 ssh 配置中的条目、凭据库中的密码，以及 CloudLink 生成的密钥（需单独勾选）；云平台 CLI 删除时不卸载本机 CLI、不退出用户的本地 CLI 登录态 |
| F-102 | ssh config 导入 | P0 | 按运行环境分别扫描（Windows 宿主机和各个 WSL 发行版分开处理）。支持 `Include`。用 `ssh -G <alias>` 获取生效配置。导入的服务器 `source` 为 `imported`，连接字段只读。**AC1：** 通配和否定模式的 Host（`*`、`?`、`!`）不导入，并提示已跳过几个。**AC2：** 同一个别名在多个环境里都有定义时，合并为一行，「来源环境」列出全部环境。**AC3：** 已导入的别名标记为「已导入」，默认不勾选。**AC4：** CloudLink 托管文件中的 Host 不出现在导入列表里 **AC（2026-11-08）：** 代码托管主机不作为服务器候选：`HostName` 是 github.com、gitlab.com、bitbucket.org、gitee.com、ssh.dev.azure.com（含 `ssh.github.com` 等子域），或 `User git` 的 `Host` 段，从列表中排除，并在底部注明「已跳过 github.com（代码托管，不是服务器）」；排除后没有候选时，空状态和添加对话框不显示「从 ~/.ssh/config 导入」 |
| F-103 | 只读探测 | P0 | 规格见 8.3。**AC1：** 使用 `BatchMode=yes` 和 `ConnectTimeout=10`，整个探测 30 秒超时，用户可以取消。**AC2：** 探测结果自动合并并重新编译，不逐项审批：新增和变化直接写入；上次有、这次没发现的服务标为「未发现」，不删除。完成后告诉用户更新了几处，可以查看本次变化。**AC3：** 合并时保留人工标注（role、critical）。**AC4：** 「撤销」把这次探测改动过的字段恢复原样并重新编译，只能撤销最近一次探测。**AC5：** 清洗后仍疑似指令注入的值（8.3）不自动合并，列为「待确认」，用户确认后才合并。**AC6：** 错误按 8.3 的分类表给出可操作的说明。**AC7：** 原始输出只留在内存里，不写入磁盘。**AC8：** 探测成功同时刷新连接验证 |
| F-104 | 云平台 CLI 接入与范围圈定 | P0 | 支持接入三类官方 CLI：**Cloudflare（`wrangler`）**、**Vercel（`vercel`）**、**Oracle Cloud（`oci`）**（2026-11-02 从原多维静态卡片升级为实时 CLI 资源）。**AC1（精准环境检测）：** 只检测当前已启用 Agent 所在的运行环境；通过用户的 Login Shell（如 WSL 下 `bash -ilc`）探测 CLI 绝对路径、版本号与当前登录身份（`whoami` 账号/团队名，防止登错团队）。**AC2（引导与自动刷新）：** 未安装或未登录时，给出对应环境的单行安装/登录命令（对 `wrangler`/`vercel` 引导 `login`，对 `oci` 优先引导长效 `~/.oci/config` 而非 1 小时临时 session）并提供「打开终端」按钮；用户切回 CloudLink 窗口时自动重新检测并刷新状态。**AC3（范围圈定 Scope）：** 登录就绪后拉取账号下的可选资源（Cloudflare 的域名 Zones 与 Workers/Pages、Vercel 的项目、OCI 的计算实例），用户勾选允许公开给 Agent 的子集，未勾选的不进入编译产物。**AC4（全栈自动关联）：** Cloudflare 域名解析若指向已录入 SSH 服务器的 IP，自动标记关联关系；OCI 计算实例旁提供「+ 同时加为 SSH 服务器」快捷入口。**AC5（多账号，2026-11-03）：** 同一家可以接入多个账号，每个账号一项资源；检测回显这次登录能操作的全部账号（`CliEnvState.accounts`：Cloudflare 的 Account、Vercel 的 Team、OCI 的 Profile），向导里单选一个，已接入的标「已添加」。`CliAsset.account` 记下绑定的账号，`CliAsset.handle` 由后端分配（第一个 `cloudflare`，之后 `cloudflare-2`…，不可改）；同一家同一账号重复保存返回 `alias-taken`。详情文件写明每条命令怎么指定账号（`CLOUDFLARE_ACCOUNT_ID`、`--scope`、`--profile`），不写凭据、不引入 Token。**AC2 补充：** 未安装时给出安装指引，可切换安装方式（wrangler / vercel：npm、pnpm、bun；oci：Windows 用 winget 或 pip，WSL 用官方 install.sh 或 pip），注明需要的运行时，命令前的提示符区分 `PS>` 与 `$` |
| F-105 | 字段导出控制 | P0 | 每台 SSH 服务器可在「连接配置 → 高级」中单独设置导出开关（平时默认收起不打扰主视野）：解析后的连接信息（默认关）、监听端口（默认关）、镜像版本（默认开）。**AC：** 关闭的字段一旦出现在编译产物里，就触发 Lint 错误并阻断发布 |
| F-106 | 一步到位录入服务器 | P0 | 点击「+ 添加资源 → SSH 服务器」打开精简表单（6.5）：主机地址、端口（默认 22）、登录用户、名称、认证方式（F-108，先选中密码）、生产环境，主按钮为「连接并启用」。表单里不选 Agent、不选档位（2026-11-10）：新资源从只读巡检开始，同步给所有已启用的目标，之后在资源行上改。P8a／b 新增时日常只填名称，留空使用不含地址的中性默认名；新 SSH 别名自动生成、稳定、唯一且不含地址，与名称／地址解耦，查看、复制、手改收进高级。草稿往返不重新生成，已有别名保留；改显示名称不改别名、不清空验证，手改别名须说明旧命令／脚本需调整。不得通过开启连接信息导出或放宽隐私 Lint 解决缺省名称受阻。**AC1（一步到位流水线）：** 点击「连接并启用」时依次自动执行：测试 SSH 连接 → 若为密码认证则自动生成 ed25519 免密密钥并安装公钥切换为私钥认证 → 保存并写入托管 ssh 配置 → 同步给所有已启用的目标并后台发起首次探测，按钮原地展示阶段进度，可取消。**AC2：** 首次连接时在连接过程的「核对主机指纹」一步里就地显示主机指纹（SHA256），用户核对确认后立即写入 `known_hosts`，之后认证失败也不必再核对；用户 `known_hosts` 里已有这个地址的同一把公钥时直接沿用，不再询问（2026-11-07）；指纹与已知记录不符时阻断。**AC3：** 连接失败时按 8.3 错误分类原地提示，同时允许用户选择「仅保存（暂不启用）」离线保存，此时标为「未验证」，行内提供 `[测试连接]` 快捷入口。**AC4：** 修改已有服务器的连接字段并保存后，验证状态清空，行内提示重新验证 |
| F-107 | 托管 ssh 配置 | P0 | managed 服务器写入 CloudLink 托管的 `~/.ssh/cloudlink.conf`（每个运行环境一份，WSL 中写在发行版自己的家目录）。**AC1：** 首次写入前征得同意：连接过程里的一步「让 Agent 能用别名连接」（6.5，2026-11-10 起不再另弹对话框），同意后在用户的 `~/.ssh/config` **开头**加一行 `Include ~/.ssh/cloudlink.conf`。修改前先备份为 `config.cloudlink-bak`。每个运行环境只问一次（`sshIncludeAsked`）。用户选「暂不加入」时，服务器照样保存，在该环境中记为「未列入」；资源行和设置的「SSH 配置」行都给出「加入」入口，设置里另有手动添加的说明。**AC2：** 托管文件整文件重写，带「由 CloudLink 生成，请勿手改」的文件头；CloudLink 不修改用户 config 中除这一行 Include 以外的任何内容。**AC3：** 别名与该环境 ssh config 中已有的 Host 重名时阻止保存。**AC4：** 每次写入后用 `ssh -G <别名>` 回读校验，生效值与录入值不一致时提示具体字段。**AC5：** 用户可在高级选项中选择写入哪些运行环境，默认全部可用环境 |
| F-108 | SSH 认证与自动转密钥 | P0 | 三种：密码、私钥文件、ssh-agent。**密码：** 存进 Windows 凭据管理器，不进 SQLite、不进日志、不进 Skill。**私钥文件：** 只记录路径，提供文件选择器，并检测常见问题（文件不存在、WSL 中位于 `/mnt/c` 下导致权限过宽、带口令但 ssh-agent 中没有）。**ssh-agent：** 依赖系统 ssh-agent。**AC1（自动免密转换）：** 新建时选择密码并点击「连接并启用」，连接验证通过后自动生成 ed25519 密钥（保存在 `~/.ssh/cloudlink_<别名>`，WSL 中另存一份并设置 600 权限），把公钥追加到服务器的 `~/.ssh/authorized_keys`，切换为私钥文件认证；仅当服务器拒绝公钥认证等极端情况时降级保留密码并说明原因。**AC2：** 安装公钥只追加一行并带 `cloudlink` 注释，不改动已有内容。**AC3：** 切换成功后自动清理或提示删除保存的明文密码。**AC4：** 私钥文件方式下，WSL 的那一行提供「复制到 WSL」：确认后把私钥复制到该发行版的 `~/.ssh/` 并设置 600 权限，重名追加后缀不覆盖 |
| F-109 | 生产环境开关 | v0.2 | 2026-11-08 取代三档环境（生产 / 预发 / 开发）。每项资源一个布尔值「生产环境」，新建 SSH 服务器时默认开启。**AC1：** 生产资源新建时默认只读巡检；切到标准运维要确认（6.3）；处于标准运维时档位文字琥珀色，托盘里在这一项前面放琥珀圆点图标（原生菜单不能给文字上色，2026-11-10）；Lint 规则「生产 + 标准运维 + 没有红线」保留。**AC2：** 界面只给生产资源标「生产」（红色文字），非生产不显示任何环境标记。**AC3：** 数据迁移：`envTag = prod` → `production = true`，其余 → `false`；Skill 里只对生产资源写 `production`。**AC4：** v0.3 CloudLink 运行中（含托盘），生产资源的两档操作都经执行通道（F-310）；手动 SSH 别名保留，彻底退出后的检查边界见 8.7 |
| F-110 | GitHub（`gh`）接入 | v0.2（接入）/ v0.3（归属、动态范围、关系与护栏） | `cliProvider = "github"`，检测 `gh --version` 与有效身份，不以单个 auth status 成功推导所有组织权限。**AC1（D1／D8）：** host／稳定 owner 与实际登录身份分开；选定个人账号、每个组织各一项资源，可共用登录身份，各自有生产标记／档位／Agent 选择，默认名称仍为 GitHub。新接入默认自动跟随该 owner 当前及未来有权访问的仓库（含私有），支持稳定 repo ID 排除与 manual 选择；不自动纳入新加入组织。旧手选迁为 manual、多 owner 须可核实的拆分，不静默扩围。详情按需刷新节流 30 秒、手动立即刷新；分页不完整、权限不足、离线保留快照并标注，完整核对前不能扩围；实际操作另行核实身份、owner、稳定目标与范围。**AC2（仓库关系）：** 受限的 Vercel 绑定、Cloudflare Pages 来源及服务器工作目录 git remote 自动整理部署关系，显示证据，可隐藏／改写／补充；不改变授权、档位或生产标记，不泄漏未提供资源或 remote 凭据。**AC3（运行中规则，8.6／8.7）：** 只读档拒绝 gh 写操作；标准档普通写入通过，高危操作请求允许一次；凭据读取／导出、gh auth token、删除仓库、默认分支或未指定分支的强推属于不可审批红线。查询按具体子命令／端点判断，不把所有 HTTP GET 当安全；普通 git push／commit 不扩大纳管。彻底退出后不做 CloudLink 检查。**AC4：** 仓库表为名称／默认分支／可见性／部署目标；归属、登录身份与范围放状态行和设置式列表，多 GitHub 资源才在首页副行小字区分归属。管理范围用当前页居中 Dialog（6.5.1），勾选始终表示提供给 Agent |

### 4.2 模块二：编译器

| 编号 | 功能 | 优先级 | 需求与验收标准 |
| :--- | :--- | :--- | :--- |
| F-201 | 总 Skill | P0 | 列入的服务器编译成一个 Skill，名称固定为 `cloudlink-servers`，每个「运行环境 × Agent」一份，只含分发给这个 Agent 的服务器（3.4、3.5）。`SKILL.md` 包含：连接规则、服务器总览表（别名、用途、环境、档位、详情文件）、服务器之间的关系、档位与护栏说明、内置红线和运维约定、巡检入口、笔记约定；每台服务器的详情放在 `references/<别名>.md`，巡检清单放在 `references/health-check.md`（规格见第五章）。v1 取消「全局汇总清单」的两个理由，即全局常驻和让 Agent 连错项目的服务器，在 v3 已不成立：v3 只做全局分发，总 Skill 常驻的只有一条描述。**AC1：** 「资源关系」和「运维约定」是全局内容，在 Agent 页维护。资源关系由 CloudLink 根据资源数据自动整理（跳板机、同一台主机、域名解析指向、承载的站点、云主机实例），资源变化时跟着更新；用户可以隐藏某一条、改写某一条（改写后原句隐藏、改写的原文代替它），或补充自动推不出来的关系。补充、改写和运维约定原文逐字输出（2026-11-07）。**AC2：** description 由模板生成，列出各服务器的别名和用途、承载的站点，以及部署、日志、容器、巡检等触发词；超过 1024 字符时，依次去掉站点名、缩短用途、只列前若干个别名并注明其余数量，同时给出 Lint 警告。**AC3：** 总览表始终列出全部列入的服务器，不受 description 截断影响 |
| F-202 | 档位与红线 | P0 | 两个档位：只读巡检和标准运维，是服务器的属性（`agent.mode`）。用户自定义的红线在任何档位下都追加在后面。内置红线（5.5）在任何档位下都始终注入。在 Claude Code 上，档位由护栏执行（F-306）。**AC1：** 红线逐字渲染，顺序与编辑器中一致。**AC2：** 生产服务器新建时默认只读巡检；切换到标准运维前弹 `AlertDialog` 二次确认，说明「所有已启用的 Agent 都会获得变更权限的指令，护栏只会拦下明显危险的命令」 |
| F-203 | 编译与发布 | P0 | 触发时机：保存、应用或撤销探测、切换档位、合并笔记、修改全局内容、列入情况变化。流程：校验、按运行环境渲染、Lint、原子发布（8.4），然后同步全部副本。**AC1：** 存在错误级 Lint 时不发布，保留上一次成功的产物，并在界面上标出「编译受阻」和出错的服务器。**AC2：** 20 台服务器的总 Skill 编译 p95 不超过 200ms |
| F-204 | 预览 | P0 | 在服务器详情中点「预览 Skill」打开右侧 Sheet，默认定位到这台服务器的详情文件；在 Agent 页可以预览整个总 Skill。Sheet 顶部的「Agent 与运行环境」选择预览哪一份（例如「Claude Code（Windows）」），旁边的文件下拉选择看哪个文件（SKILL.md、各资源的详情文件、health-check.md；2026-11-10 由一排标签改为下拉，资源多时标签放不下）。这台服务器没有列入所选的那一份时（没有点选这个 Agent，或该环境没有它的连接配置），预览按「已列入」计算，Lint 照常检查，顶部注明「目前未列入」及原因（2026-10-31 用户确认）。内容就是当前草稿的编译结果。显示 description 字符数和正文行数相对上限的进度，以及 Lint 结果。v3 不再显示 Token 估算：总 Skill 常驻的只有一条描述，估算值对用户没有决策意义。**AC：** 预览和发布调用同一个渲染函数，同一份输入得到的内容字节级一致 |
| F-205 | Lint 与密钥扫描 | P0 | 规则见 5.4。密钥扫描复用 gitleaks 的规则集（MIT 许可），编译进 Rust 二进制。同一套规则也用于 Agent 笔记（F-308）和操作记录（F-307）的检查与脱敏 |
| F-207 | 输出语言 | P0（默认英文）/ P1（可切换） | 编译产物默认英文：模板文字、档位说明、内置红线、description 模板都是英文；用户填写的用途、红线、关系、约定、笔记原样输出，不翻译。P1 起支持全局切换为 `zh-CN` |

2026-10-31 删除了 F-206 业务包（由总 Skill 中「服务器之间的关系」取代）和 F-208 自定义模板，编号不再复用。

### 4.3 模块三：Agent 与分发

| 编号 | 功能 | 优先级 | 需求与验收标准 |
| :--- | :--- | :--- | :--- |
| F-301 | 运行环境与 Agent 检测 | P0 | 启动时和手动刷新时执行。Windows 上用 `wsl.exe -l -q` 列出发行版。v0.1 只检测两类 Agent，目录见 4.5。检测到的 Agent 默认启用。**AC：** 未检测到的 Agent 也可以手动启用（软件会创建目录）；其他 Agent 可以添加为自定义目录 |
| F-302 | Agent 启用开关 | P0 | Agent 页每个目标一个开关。**AC1：** 启用后自动写入这个 Agent 在该环境的总 Skill 副本；启用的 Agent 出现在服务器卡片的 Agent 按钮里（F-303）。**AC2：** 停用前确认，说明会从该目录移除 CloudLink 分发的 `cloudlink-servers`；只移除 CloudLink 创建的东西 |
| F-303 | 分发给 Agent | P0 | 主列表回路行右侧和详情面板常驻控制头上，每个启用的 Agent 一个按钮（`ToggleGroup` 多选，参考 CC Switch，2026-11-01 用户确认）：点亮就分发给它，全部不点亮就是不分发。点选按 Agent 计：同一个 Agent 在 Windows 和 WSL 的目录一起分发，该资源列入它在各运行环境的总 Skill（3.4）。按钮是 Agent 官方品牌 Logo（`AgentMark`）：Claude Code 用 Claude 的 Logo，通用目录用表示「多个 Agent 共用」的图形，Trae、Kiro、Continue 等用各自的官方 Logo，自定义目录按名称自动匹配 Cursor、Windsurf、Gemini CLI、GitHub Copilot 等官方 Logo（未知名称用 `BotIcon` 兜底）；点亮时品牌色 Logo 加浅色品牌色底，未点亮时是灰色 Logo。**AC1：** 未通过连接或 CLI 环境验证的资源不能点亮新的 Agent：行内直接显示修复按钮（如 `[测试连接]`、`[去登录]`）。已点亮的仍然可以取消。**AC2（正常即隐身）：** 详情面板不再常驻展示各运行环境的列入矩阵；只有当某个已启用环境未列入时（例如「WSL Ubuntu-24.04 中没有配置私钥」或「WSL 未安装 wrangler」），才在详情控制头下方浮现一条琥珀色提示与一键处理入口。**AC3：** 返回并展示最新实际写入结果，只有真实送达才提示已同步，不能因授权或编译成功而冒报；冲突／路径失败／未列入／部分成功如实说明。P8a 同环境共用目录是一个分发单位、资源开关同一事务联动组内成员，图标一起更新、现有提示说明，不新增确认弹窗（8.2）。**AC4：** 取消资源选择不需要确认；共用组一起取消，仍有成员使用的目录不能误删，移除遵守所有权（可以随时重新点亮） |
| F-304 | 副本引擎 | P0 | 分发一律用受管复制，不用符号链接或 Junction（理由见 8.2）。**AC1：** 目标位置已存在 `cloudlink-servers` 目录、而且不是本软件创建的，判定为「冲突」，不做任何覆盖。**AC2：** 移除只删除带有匹配所有权标记的副本。**AC3：** 每次发布在同一批次内同步全部副本；某个目标写入失败时，该目标记为「待同步」，其余目标照常更新 |
| F-305 | 健康检查与修复 | P0（v0.2 起由 F-309 自动处理，冲突以外不再需要用户点「修复」） | 检查时机：启动、窗口重新聚焦（节流 30 秒，若正处于 CLI 环境向导则立即刷新 CLI 状态）、手动「检查全部」。检测四类问题：副本缺失、副本被改动、副本待同步、冲突；同时重新计算列入情况，并对护栏做自检（F-306 AC5）。**AC：** 「修复」重新写入副本，副本被改动过时先提示修复会覆盖改动；目标目录已不存在时重新创建。问题汇总显示在导航栏 Agent 项的计数徽标上 |
| F-306 | 护栏（Claude Code，SSH + 云 CLI） | P0 | 在 Claude Code 的用户级 `settings.json` 中安装一条 `PreToolUse` hook（`matcher` 为 `Bash`），指向 CloudLink 自带的小程序 `cloudlink-guard`。它对涉及已录入 SSH 服务器的 `ssh/scp/sftp/rsync` 命令，以及涉及已接入云平台的 `wrangler/vercel/oci` 命令做判定（规则见 8.6）：只读巡检档只放行查询与日志命令；标准运维档只拦下明显危险的命令（删除数据卷/实例/域名、重启主机、改防火墙、改 SSH 配置、停掉关键服务）；**任何档位一律拦下读取凭据文件（`.env`、私钥等）以及 CLI 凭据导出命令（如 `vercel env pull`、`oci iam` 密钥导出）**。**v3.1 起取消「临时解锁 30 分钟」**，需要执行写操作时直接在主列表回路行右侧把档位切为「标准运维」（生产资源带琥珀色高亮提醒），操作完毕一键切回「只读巡检」。**AC1：** 安装前用对话框展示将要加入 `settings.json` 的内容，征得同意后才写入；修改前备份为 `settings.json.cloudlink-bak`。每个有 Claude Code 目标的运行环境分别安装。**AC2：** v0.1／v0.2 独立 hook 只读 policy、不依赖 GUI；v0.3 改为与 runner 共用运行状态核对（8.7）：含托盘时检查、确认彻底退出时停止检查，不能把 IPC 故障当退出。**AC3：** 非生产保留只读不明拒绝／标准不明放行并标注；生产运行时 hook 拦可识别直连并引导 runner，通道只读不明拒绝、标准不明请求允许一次，不重复判定受管 runner。**AC4：** 健康检查时自检：确认 `settings.json` 中的条目还在、没有设置 `disableAllHooks`，并用测试输入实际运行一次护栏程序。**AC5：** 界面如实说明覆盖：hook 只在 Claude Code，v0.3 运行中的生产 runner 覆盖所有调用它的 Agent；非生产其他 Agent 与其他工具不假称受保护。防手滑、不防刻意绕过；彻底退出检查停止 |
| F-307 | 操作记录 | P0 | 护栏判定过的每条命令都记一行：时间、运行环境、会话 id、工作目录、资源 id、命令（脱敏后）、结果（已放行、已拦下）和拦下的原因。CloudLink 在启动、窗口重新聚焦时读入，界面可见时每 60 秒读入一次，保留 30 天。**AC1：** 资源详情的「最近动态」显示最近 3 条；完整列表在「动态」页按资源筛选（6.7），不出现在设置的活动日志里（2026-11-10）。**AC2：** 记录写入前先脱敏（8.6），CloudLink 读入时再用 F-205 的完整规则扫描一遍，命中的片段替换为 `[已隐藏]`。**AC3：** 界面注明只记录经过护栏的命令，也就是 Claude Code 执行的命令 |
| F-308 | Agent 笔记 | P0 | 总 Skill 中约定：Agent 在干活中摸清值得下次知道的事（部署方式、配置位置、踩过的坑），就往笔记收件箱中这项资源的文件追加一行 `- YYYY-MM-DD: <内容>`，不写凭据、IP 和临时状态（5.2）。收件箱路径按运行环境渲染成绝对路径；WSL 中指向 Windows 侧的同一个目录，所以只有一个收件箱。**AC1：** CloudLink 在启动、窗口重新聚焦时读取收件箱，界面可见时每 60 秒读取一次；先原子重命名再读，避免和 Agent 的追加冲突。**AC2：** 每条笔记读入时做密钥扫描和疑似注入检查；命中密钥的笔记必须编辑后才能并入。单条最长 500 字符，每项资源最多保留 100 条待处理。**AC3：** 主列表回路行上显示待处理的数量（例如「笔记 2」），详情的「动态」Tab 标题显示 `动态 (2)`，顶部逐条列出待处理笔记，可以「并入」「编辑后并入」「忽略」，也可以全部并入。**AC4：** 并入就是把这一行（带日期）追加到资源的笔记字段，立即保存并重新编译，Agent 下次就能读到 |
| F-309 | 自动同步与备份撤销 | v0.2 | 2026-11-08 取代 F-305 中需要用户点「修复」的部分。**AC1：** 资源或 Skill 内容变化后自动重新编译并写入所有已启用目标；启动、窗口重新聚焦（节流 30 秒）时检查副本。**AC2：** 副本缺失直接重新写入；副本被改动时先把被改动的版本备份到 `~/.cloudlink/backups/<时间>/<目标>/cloudlink-servers/`，再覆盖，提示条「Kiro 里的 Skill 被改动过，已恢复；改动的版本已备份 · 撤销」；撤销把备份写回并暂停这个目标的自动同步，直到用户再次启用。**AC3：** 目录里已有不是 CloudLink 创建的同名 Skill（无 `.cloudlink.json` 所有权标记）时不动它，Agent 页这一行显示「目录里已有同名 Skill」+「备份并接管」；接管 = 移到备份目录再写入，可撤销。**AC4：** 所有覆盖、删除仍须先校验所有权标记与 `symlink_metadata` / 重分析点（原则 3）。**AC5：** 备份保留最近 20 份或 30 天，设置 → 数据可以打开备份目录 |
| F-310 | 执行通道与命令审批 | v0.3 | 2026-11-13 D2／D3／D10／D12／D14 定稿，规格见 8.7。**AC1：** CloudLink 运行中（含托盘），生产 SSH 与四家生产 CLI 两档都经独立 runner；非生产保留原路径。Skill 写该环境经引用的 sidecar 绝对路径和稳定 assetId，不撤下手动 SSH 别名。**AC2：** 明确查询通过、只读写入拒绝；标准高危及目标明确但解析不了的命令用原「动态 → 等你确认 → 允许一次／拒绝」审批，凭据等红线不可审批。审批创建起 5 分钟到期，exec 内联等约 90 秒后返回 requestId，wait 接上并最多启动一次，执行前复查策略／身份／输入。**AC3：** 记录来源、是否实际检查、审批与执行状态、退出码／耗时；hook 仅放行不能冒充执行成功，原始输出不默认落盘。**AC4（D10）：** 彻底退出后新调用不做 CloudLink 检查／审批，Skill 与入口仍可用，不要求打开 GUI；旧未启动请求取消，不因退出获批或重启续跑，状态不明不当退出。**AC5：** 不提供 TTY／不透明 stdin 脚本；单文件 put／get 只写不存在路径，长任务、输出有界与未知结果不重跑按 8.7 |

### 4.4 模块四：系统

| 编号 | 功能 | 优先级 | 需求与验收标准 |
| :--- | :--- | :--- | :--- |
| F-401 | 命令面板与快捷键 | P0 | 见 6.11 |
| F-402 | 活动日志 | P0 | 位于设置 → 数据 →「活动日志」（侧边面板，6.8）。记录测试连接、CLI 环境检测、探测（包括执行的命令清单、耗时、结果）、编译、分发和移除、修复、托管 ssh 配置的写入、护栏的安装与移除、档位切换、笔记的并入与忽略、应用更新的安装（F-406），本地保留 30 天。只记 CloudLink 自己做的事：Agent 的操作记录（F-307）不在这里，在「动态」页看（2026-11-10，原先两者混排，Agent 的命令占了大半）。**AC：** 日志中不出现原始探测输出、密码，也不出现解析后的连接信息 |
| F-403 | 设置 | P0 | 见 6.8 |
| F-404 | 数据导入导出 | P1 | 以 JSON 导入导出资源。分发与本机路径强相关、密码在凭据库中，二者都不导出。P2 支持加密备份包 |
| F-405 | 首次启动空状态 | P0 | 见 6.9 |
| F-406 | 检测更新 | P0 | 2026-11-05 新增，P6 实施。默认开启，可在「设置 → 通用」关闭。启动 10 秒后检查一次，之后每 24 小时检查一次；检查失败不打扰用户，只写日志，1 小时后重试。数据源是 GitHub Releases 上的 `latest.json`，由 Tauri updater 在 Rust 侧读取；发现新版本后在后台下载并校验安装包（2026-11-09 起，对标 magpie），不上传任何数据。**AC1（正常即隐身）：** 没有新版本、以及后台下载期间，界面上不出现任何与更新有关的元素（下载进度只在设置的版本行里显示）。安装包下好后，顶栏最右侧出现只写「更新」的提醒按钮，命令面板「系统」组出现「重启以更新到 x.y.z」（6.15）。后台下载失败时同一个提醒也会出现。**AC2：** 点提醒按钮打开更新对话框，显示新版本号、发布日期和纯文本的更新说明。「稍后」只关闭对话框，提醒按钮保留。主按钮「重启以更新」；后台下载失败时写清原因，主按钮改为「重试」，重新下载并在对话框里显示进度。**AC3：** 安装包必须通过内置公钥的签名校验；校验失败直接丢弃，不安装，并提示原因。**AC4：** 有进行中的测试连接、探测、CLI 检测或发布时不开始安装，告诉用户在等哪项任务。**AC5：** Windows 上开始安装时 CloudLink 自动退出，NSIS 安装程序以 passive 模式装完后自动重新打开；退出前写一条活动记录。数据目录、凭据库、托管 ssh 配置、护栏 hook 和已分发的副本都不受影响。护栏程序副本在 `~/.cloudlink/bin/`，所以更新期间护栏照常工作；重新打开后按哈希同步为新版本（`prepare_guard_binary`）。**AC6：** 关闭开关后立即停止检查和后台下载、丢弃下好的安装包并隐藏提醒；重新打开开关时立即检查一次 |
| F-407 | 系统托盘 | v0.2 | 托盘图标常驻，关闭窗口时留在托盘（设置里可改为退出）。菜单见 6.10：每项资源的档位子菜单、「生产资源全部切回只读」、打开、退出。**AC1：** 托盘里把生产资源切到标准运维时，打开主窗口并弹出确认，托盘本身不做确认。**AC2：** 「生产资源全部切回只读」只动生产资源（名字里写明，2026-11-10），完成后系统通知。**AC3：** v0.3 起命令审批请求以系统通知弹出 |
| F-408 | 导航位置切换 | v0.2 | 顶栏（默认）与左侧栏两种外壳（6.2），设置 → 外观或 `Ctrl+Shift+S` 切换，保存在本机设置中，重启后保持。两种外壳的页面内容完全相同 |

### 4.5 Agent 目录表

2026-11-07 起按「目录」而不是按「品牌」维护目标：绝大多数 Agent 已经读取通用目录 `~/.agents/skills`，CloudLink 往那里放一份，它们就都能用上；只有少数只认自己目录的 Agent 才需要单独的目标。数据来源是各 Agent 的官方文档或源码，以及 vercel-labs/skills 的 `src/agents.ts`（2026-11 核实），上线前需要再对照一遍。目录表在 `src-tauri/src/deliver/agents.rs`。

| 目标 | 全局目录 | 何时列出 | 护栏 |
| :--- | :--- | :--- | :--- |
| Claude Code | `~/.claude/skills/` | 始终 | 有（F-306） |
| 通用目录 | `~/.agents/skills/` | 始终 | 没有 |
| Trae / Trae CN / Kiro / Continue | `~/.trae/skills/`、`~/.trae-cn/skills/`、`~/.kiro/skills/`、`~/.continue/skills/` | 检测到这个 Agent 后才加入（默认启用）；用户已把同一目录加成自定义目录时不重复加 | 没有 |
| 自定义 | 用户指定 | 用户添加 | 没有 |

**检测（只读）。** 每个运行环境按目录表查看家目录下的标志路径（例如 `~/.codex`、`~/.cursor`、`~/.gemini/settings.json`、`%APPDATA%\Windsurf`、`%APPDATA%\Block\goose`）和 VS Code 系编辑器的扩展目录（含 `~/.vscode-server` 等远程目录），PATH 中找到命令时也算检测到。不创建、不修改任何东西。

**读取通用目录的 Agent（按目录表顺序）：** Codex、Cursor、Windsurf、Gemini CLI、GitHub Copilot、OpenCode、Cline、Roo Code、Kilo Code、Goose、Amp、Qwen Code、Factory Droid、Augment、Crush、Junie、Warp。Agent 页在通用目录那一行列出本环境检测到的这些品牌及官方 Logo（`@lobehub/icons-static-svg` 没有的用 `BotIcon`），资源行的 Agent 按钮提示里也列出它们。

补充事实（2026-11 核实）：

- **Claude Code 不读 `~/.agents/skills`。** 相关 issue #31005 截至 2026-11 仍未关闭，所以 Claude Code 和通用目录是两个独立目标。
- **不写 `~/.codex/skills`。** 它已标为废弃，而且 Codex 不合并同名 Skill，两处都放会看到两份。
- **两份副本。** Cursor、OpenCode、Goose、Amp、Augment、Crush、Warp 同时读 `~/.claude/skills` 和 `~/.agents/skills`，两个目标都启用时会看到两份同名 Skill。这是这些 Agent 自身的行为；指向它们自己目录的自定义目录会让情况更糟，Agent 页在这样的目录上提示「已经能从某目录读到总 Skill」，「添加自定义目录」也不再提供品牌预设。
- **同名 Skill。** 用户自己在全局目录里已有名为 `cloudlink-servers` 的目录时，按 F-304 AC1 判定为冲突，不覆盖。

---

## 五、编译产物规范

### 5.1 Frontmatter 约束（Agent Skills 规范）

| 字段 | 约束 | 编译器的处理 |
| :--- | :--- | :--- |
| `name` | 1–64 个字符，只能是小写字母、数字和连字符，不能以连字符开头或结尾，不能有连续连字符（`--`），必须与父目录同名（VS Code / Copilot 不加载名称不匹配的 Skill） | 固定为 `cloudlink-servers`，编译目录名也是它 |
| `description` | 非空，最多 1024 个字符；要同时写明「做什么」和「什么时候用」。Claude Code 对每条清单项另有 1536 字符的上限 | 由模板生成（F-201 AC2），超长时按规则截断并给出 Lint 警告 |
| 其他字段 | 规范里的可选字段只有 `license`、`compatibility`、`metadata`、`allowed-tools`（实验性）。Claude Code 会忽略未知字段，但 claude.ai 和 Skills API 会直接拒绝 | **编译产物只输出 `name` 和 `description`**，以保证在各个 Agent 之间都能用 |

### 5.2 SKILL.md 示例（默认英文输出）

编译产物默认用英文（F-207）。下例中，模板生成的文字都是英文；用途、关系、红线、约定、笔记这类用户填写的文本原样输出，不做翻译。为了方便对照，示例里的用户文本也写成了英文。笔记收件箱的路径是 Windows 环境渲染出的绝对路径。

```markdown
---
name: cloudlink-servers
description: The user's servers and how to operate them — hk-edge (Hong Kong edge proxy for api.example.com and blog.example.com; production, read-only), sg-db (Singapore PostgreSQL and Redis; production, read-only), dev-box (development machine). Use for any task on these servers or sites: deployments, logs, Docker containers, configuration, troubleshooting, or a health check of the servers.
---

# Servers

> Generated by CloudLink — do not edit | Snapshot: 2026-10-31

Connect only through the SSH aliases below: `ssh <alias> '<command>'`. Authentication is handled by the local SSH configuration; never ask for or record passwords, IPs or private keys. Before running commands on a server, read its details file.

| Alias | Role | Env | Mode | Details |
| --- | --- | --- | --- | --- |
| `hk-edge` | Public reverse proxy for api.example.com and blog.example.com; hosts the API containers | production | read-only | `references/hk-edge.md` |
| `sg-db` | PostgreSQL and Redis for the API | production | read-only | `references/sg-db.md` |
| `dev-box` | Development machine | development | standard | `references/dev-box.md` |

## How they fit together
- DNS for `example.com` (cloudflare, managed with `wrangler`) points at `hk-edge`, which serves `api.example.com`, `blog.example.com`.
- `sg-db` is reached through the jump host `hk-edge`; if `hk-edge` is unreachable, so is `sg-db`.
- The API containers on hk-edge use the PostgreSQL database on sg-db over the private network.

## Modes
- **read-only**: inspection commands only, e.g. `docker ps`, `docker logs --tail 200 <container>`, `df -h`, `free -m`, `uptime`, `ss -tln`, `journalctl -u <service> -n 200`. If a change is needed, describe the plan to the user and stop; the user can switch the server to standard mode in CloudLink.
- **standard**: routine deployments and service restarts are allowed. Ask the user before deleting data or volumes, changing the firewall or SSH configuration, stopping critical services, or rebooting.
- In Claude Code, CloudLink's guard enforces these modes. A blocked command comes back with the reason.

## Rules for every server
1. Never read or print credential files (`.env`, `*.pem`, `*.key`, `id_*`, `/etc/shadow`, `~/.ssh/`) and never use `docker inspect` to view environment variables.
2. Never ask for or record passwords, private keys or IP addresses; connect only through the SSH alias.
3. If a host does not match its details file, report the difference to the user instead of "fixing" the server to match the document.
4. If CloudLink's guard blocks a command, report it to the user; never try to work around the block with scripts, encoding or other tools.
5. Deploy with docker compose in /opt/apps/<name>; never edit containers by hand.
6. Tell the user before restarting anything on a production server.

## Health check
When the user asks for a health check of all or some servers, follow `references/health-check.md`.

## Notes for next time
When you learn something durable about a server that its details file does not cover — how something is deployed, where a config lives, a pitfall — append one line to `C:/Users/me/.cloudlink/inbox/<name>.md`, where `<name>` matches the server's details file (`hk-edge` for `references/hk-edge.md`); create the file if needed:
`- 2026-10-31: <what you learned>`
Never write secrets, IP addresses, credentials or transient state such as current load. The user reviews these notes in CloudLink before they become part of this skill.
```

第 1 到 4 条规则是内置红线（5.5），第 5、6 条是用户的运维约定。每台服务器的详情文件，以 `references/hk-edge.md` 为例：

```markdown
# hk-edge — Hong Kong edge proxy node

> Production | Mode: read-only | Snapshot: 2026-10-27

## Connect
- `ssh hk-edge '<command>'`
- System: Ubuntu 24.04 LTS | 2 vCPU / 2 GB RAM | managed by 1Panel (/opt/1panel)
- Role: public reverse proxy for api.example.com and blog.example.com, and host for the backend API containers

## Guardrails (must follow)
1. Memory is only 2 GB — never run npm run build, cargo build or other memory-heavy builds on this host
2. After editing OpenResty config, run docker exec openresty nginx -t and reload only if it passes
3. Never stop or restart the openresty container (critical)

## Key directories
| Key | Path | Purpose |
| --- | --- | --- |
| nginx-conf | `/opt/1panel/apps/openresty/openresty/conf/conf.d` | OpenResty site configs |
| compose-root | `/opt/1panel/docker/compose` | Docker Compose projects |

## Services
| Name | Kind | Image | Ports | Role | Critical |
| --- | --- | --- | --- | --- | --- |
| `openresty` | docker | `openresty:1.21` | `0.0.0.0:443->443/tcp` | Main gateway and SSL termination | yes |

## Sites served
`api.example.com`, `blog.example.com`

## Notes
- 2026-10-31: The API is deployed from /opt/1panel/docker/compose/api with `docker compose up -d --build`.

Live metrics such as free disk or memory are not recorded here; check them on the host when needed (e.g. `df -h`, `free -m`).
```

### 5.3 references 拆分规则

| 文件 | 内容 | 生成条件 |
| :--- | :--- | :--- |
| `references/<别名>.md` | 这台服务器的详情：连接、系统、用途、档位、服务器级红线（含由「关键」服务生成的条目）、关键目录、服务、承载的站点、导出开关打开时的监听端口、笔记、数据快照时间 | 每台列入的服务器一个 |
| `references/health-check.md` | 巡检清单（5.6） | 总是生成 |

- 文件名取自别名：转小写，`[a-z0-9-]` 以外的字符换成连字符；两台服务器得到同一个文件名时，按创建时间排在后面的追加 `-2`。笔记收件箱中的文件名与它相同。
- 参照 Anthropic 官方的 Skill 最佳实践：references 只允许一层，不能出现「参考文件里再引用参考文件」；超过 100 行的参考文件，开头要加目录。

### 5.4 Lint 规则

每条 Lint 结果都带服务器 id（全局内容的问题除外），界面据此定位到出问题的服务器。

| 规则 | 级别 | 说明 |
| :--- | :--- | :--- |
| `description` 超过 1024 字符 | 警告 | 已按 F-201 AC2 截断，提示用户缩短用途 |
| 疑似密钥 | 错误，阻断发布 | 使用 gitleaks 规则集，覆盖私钥文件头、AWS/GitHub/OpenAI/Anthropic Token 格式、`password=` 这类赋值，以及高熵字符串 |
| 输出了已关闭导出的字段 | 错误，阻断发布 | 例如 IP 被关掉导出后仍出现在产物里 |
| 引用的 references 文件不存在 | 错误 | 编译器自检 |
| `SKILL.md` 正文行数超过上限 | 警告 | 默认上限 100 行，可配置。Anthropic 官方的建议是正文不超过 500 行、约 5k Token |
| 生产服务器使用标准运维档，且没有任何自定义红线 | 警告 | 提示用户补充红线 |
| 探测数据超过 30 天 | 提示 | 提示用户重新探测 |
| 探测来源或笔记中的值疑似包含指令注入 | 警告 | 规则见 8.3「探测数据是不可信输入」 |

### 5.5 内置红线（任何档位都会注入，不可删除）

编译产物中的原文（英文）如下，界面上同时显示中文说明。

| 输出原文 | 中文说明 |
| :--- | :--- |
| Never read or print credential files (`.env`, `*.pem`, `*.key`, `id_*`, `/etc/shadow`, `~/.ssh/`) and never use `docker inspect` to view environment variables. | 不读取、不输出凭据类文件，不用 `docker inspect` 查看环境变量 |
| Never ask for or record passwords, private keys or IP addresses; connect only through the SSH alias. | 不询问、不记录密码、私钥或 IP；连接只通过 SSH 别名进行 |
| If a host does not match its details file, report the difference to the user instead of "fixing" the server to match the document. | 现场情况与文档不一致时，先向用户报告，不要自行「修正」服务器去迎合文档 |
| If CloudLink's guard blocks a command, report it to the user; never try to work around the block with scripts, encoding or other tools. | 命令被护栏拦下时告诉用户，不要设法绕过 |

### 5.6 巡检清单（`references/health-check.md`）

用户让 Agent 巡检时（例如「巡检一下所有服务器」「看看 hk-edge 怎么样」），Agent 按这份清单逐台执行只读命令，最后用一张表汇报。清单里的每条命令都必须能通过护栏的只读白名单（8.6），由单元测试保证，所以只读服务器上的巡检不会被拦。

```markdown
# Health check

Check the servers the user asked about; if none were named, check every server in the overview table. Run the checks for one server in a single ssh call, then report one table: server, status (OK / attention / unreachable), findings. Do not fix anything; list suggested actions separately and wait for the user.

    ssh <alias> 'uptime; nproc; free -m; df -hP -x tmpfs -x devtmpfs -x overlay -x squashfs; docker ps -a --format "{{.Names}}\t{{.Status}}"; systemctl --failed --no-legend --plain; journalctl -p err --since "24 hours ago" --no-pager | tail -n 30'

Mark a server as attention when:
- any filesystem is at 85% or more
- available memory is under 10% of the total
- the 1-minute load is above the number of CPU cores
- a container is exited, restarting or unhealthy (compare with the services in the details file)
- a systemd unit has failed
- the same error repeats in the last 24 hours

Certificates: for each site in the server's details file, run on that server

    ssh <alias> 'echo | openssl s_client -connect 127.0.0.1:443 -servername <site> 2>/dev/null | openssl x509 -noout -enddate'

and mark certificates that expire within 14 days.

If a command is missing on a server (no docker, no systemd), skip it and say so. If a server is unreachable, report it and continue with the next one.
```

---

## 六、UI/UX 设计规范

> **v4（2026-11-08）重设计**：对标 CC Switch 与 magpie，取代 v3.1 的「钢制配电盘」。决策经过逐轮问答确认，可点击原型在 `docs/prototype/redesign/`（静态 HTML，假数据），视觉令牌与组件规格以 `DESIGN.md` 为准。本章只写信息架构、交互和状态。

### 6.1 设计基调：「安静钢面（Quiet Steel）」

灰色画布上放白色列表卡，行与行之间是发丝线；状态用圆点；控件是灰色的弹出按钮；阴影只在浮层上。品牌 Logo 统一装进同尺寸的圆角方块。唯一强调色 Signal Cyan 只用于焦点环、点亮的 Agent 图标、「动态」的待处理圆点和链接；主按钮是钢墨色；红、琥珀、绿只表达状态。

三条贯穿全局的原则：

1. **正常即隐身**：连接正常只有一个绿点，不写「已连接」；出问题时才出现文字和一个修复按钮。分发、副本、运行环境这些内部机制，正常时不出现在界面上。
2. **一行一件事**：每行最多一个修复按钮、一组 Agent 图标；能点的东西看起来能点（带 `⌄` 的文字、按钮、图标按钮），只读信息不加边框。
3. **说结果，不说实现**：说明文字讲用户得到什么（「站点出问题时，Agent 能找到这台服务器」），不讲 description、编译、目录这些实现。

### 6.2 信息架构与窗口

- **默认窗口 `1000×680`**，最小 `760×520`。P8b 恢复 Windows 原生系统标题栏：应用图标、CloudLink 与最小化／最大化／关闭由系统提供，高度由系统和 DPI 决定；下层不自绘窗口按钮，不设标题栏模式选项。正式包与桌面测试配置统一开启原生装饰。
- **原生配色**：启动首帧、手动浅／深色、跟随系统、激活／失焦同步现有画布背景与文字令牌；Windows 11 使用受支持的原生主题／标题栏着色能力，Windows 10 不支持精确配色时回退系统浅／深主题。高对比度优先，不为了同色牺牲原生拖动、双击最大化、边缘缩放、快捷键或窗口布局；不额外添加两栏交界阴影／分隔线。
- **导航位置可切换（F-408）**：默认顶栏；用户可以在设置里或按 `Ctrl+Shift+S` 切到左侧栏，记住选择。
  - **顶栏模式**：系统栏下方 48px。左边分段切换 `资源 N / Agent / 动态 / 设置`，右边搜索、切换导航位置、`+`（钢墨方块）及按需的更新提醒（6.15）；不重复显示 CloudLink，不放自绘窗口按钮或其前面的竖线，导航控件不作为拖动区。
  - **侧栏模式**：200px 侧栏，不重复应用名；四个导航项与底部护栏状态不变，内容区顶部 48px 是页面标题和同样的操作按钮。
- **内容居中，最宽 760px**。所有页面一列，从上往下读；没有左右分栏。
- **关闭窗口时留在托盘（F-407）**，可在设置里改为退出。v0.3 留在托盘继续检查／审批，彻底退出按 8.7 停止 CloudLink 检查，Skill 与独立入口仍可用。

| 一级导航 | 内容 | 标记 |
| :--- | :--- | :--- |
| 资源 | 服务器与云平台列表；点一行进入详情 | 资源数（muted） |
| Agent | 分发目标（Agent 与目录）、Skill 内容（资源关系、运维约定、护栏规则）、运行环境 | 无；有问题时这一页里对应行显示琥珀点 |
| 动态 | 等你确认（Agent 笔记；v0.3 起加命令审批）、操作记录 | 有待确认事项时一个信号青圆点 |
| 设置 | 外观、启动与托盘、连接、编译、数据、危险操作 | 无 |

### 6.3 资源视图（首页）

```text
[系统图标] CloudLink                                              – □ ×
[ 资源 6 | Agent | 动态• | 设置 ]                              🔍  ▤  [+]
─────────────────────────────────────────────────────────────────────────────────
        服务器 3
        ┌──────────────────────────────────────────────────────────────┐
        │ [▤] 香港边缘节点  hk-edge  生产              [✳] [▦]  ·    › │
        │     ● 只读巡检 ⌄                                             │
        │ [▤] 新加坡数据库  sg-db  生产                 [✳]  ·   ·    › │
        │     ● 标准运维 ⌄            ← 琥珀色                         │
        │ [▤] 开发机  dev-box               [测试连接]  ·   ·   ·    › │
        │     ○ 未验证 · 标准运维 ⌄                                    │
        └──────────────────────────────────────────────────────────────┘
        云平台 3
        ┌──────────────────────────────────────────────────────────────┐
        │ [CF] Cloudflare                               [✳] [▦] [T]  › │
        │      ● 只读巡检 ⌄                                            │
        │ [GH] GitHub                                   [✳] [▦]  ·   › │
        │      ● 只读巡检 ⌄                                            │
        │ [▲]  Vercel                         [去登录]  [✳]  ·   ·   › │
        │      ● WSL 未登录 · 只读巡检 ⌄                               │
        └──────────────────────────────────────────────────────────────┘
```

- **两组**：「服务器」「云平台」（GitHub 归入云平台组），组标题右边是数量。组内顺序：生产在前，再按名称；用户拖动排序后按用户顺序。
- **资源行**（至少 56px，两行文字）：
  - 左：品牌方块（SSH 是 `ServerIcon`，云平台是官方 Logo）。
  - 第一行：名称 + 别名（等宽、muted）+「生产」（只有生产资源有，红色文字，不加底色）。云平台不写账号和范围摘要，这些在详情里。
  - 第二行：状态 + 档位。正常时只有绿点（悬停显示「已连接」或「已登录 me@example.com」）；有问题时「状态点 + 问题 · 」，例如「○ 未验证 · 」「● WSL 未登录 · 」「● 连接失败 · 」。档位是可点的文字「只读巡检 ⌄」；生产资源处于标准运维时琥珀色、加粗。
  - 右：按需一个修复按钮（`测试连接`、`去登录`、`改用密钥登录`、`加入 SSH 配置`）→ Agent 图标组 → `›`。
  - 有待处理的 Agent 笔记时，不在行里加徽章；「动态」导航上的圆点和详情页的「最近动态」负责提示。
- **点行进入详情**；档位文字、Agent 图标、修复按钮各自响应，不进入详情。右键菜单：编辑、测试连接、重新探测、复制别名、删除。
- **档位弹出菜单**：点档位文字，在文字下方弹出两个选项（只读巡检 / 标准运维，各带一句后果说明）。生产资源切到标准运维时，菜单底部展开确认「sg-db 是生产环境。切到标准运维后，Agent 可以部署和重启。」+「取消」「切换」；切回只读不需要确认。切换后底部提示条带「撤销」。
- **Agent 图标组（F-303）**：每个已启用的分发目标一个按钮，按目录计（Claude Code、通用目录、Trae、Kiro……），同一 Agent 的 Windows 和 WSL 合并。点亮立即同步，提示条「hk-edge 已同步给 Claude Code · 撤销」。未通过连接验证的资源不能点亮新目标（提示「先通过连接测试才能分发」），已点亮的可以取消。通用目录的悬停提示列出读取它的、本机检测到的 Agent。
- **搜索**：顶栏搜索按钮或 `Ctrl+F` / `/` 展开搜索框，按名称、别名、站点、账号过滤；无结果时「没有匹配的资源」+「清除搜索」。

### 6.4 资源详情

全宽一页，没有 Tab，从上往下：

1. **返回**：左上 `‹ 资源`（Esc 也返回）。
2. **标题行**：品牌方块（40px）+ 名称（18px）+ 次要的既有别名 +「生产」；右边「测试连接」（云平台为「重新检测」）和 `⋯`。更多菜单按任务分组：SSH 的「编辑连接」排第一，「编辑资料」随后；复制别名、预览、探测与删除保留职责。CLI 不显示 SSH 连接编辑。名称单击可快捷重命名（6.4.1），但不能替代完整资料维护。
3. **状态行**：状态点 + 状态词 · 系统或账号 · 「2 小时前探测」+ 刷新按钮。云平台的状态行只写整体：有一个运行环境就绪就是「已就绪 · 账号」，某个环境的问题只在「Agent 权限」卡的问题行里说；所有环境都用不了时才写出第一个问题（2026-11-10）。「重新检测」只在标题行，「运行环境」组上不再重复。
4. **Agent 权限**（设置式列表）：
   - 「生产环境」开关（F-109），说明「默认只读巡检；切到标准运维要确认」。
   - 「档位」分段切换（只读巡检 | 标准运维），说明随选中项变化。
   - 「给哪些 Agent」：说明「2 个目录已同步」，右边同一组 Agent 图标。
   - 某个运行环境用不了这项资源时，这张卡里多一行琥珀浅底的问题行，例如「WSL Ubuntu-24.04 还用不了这台服务器 / WSL 里没有这把私钥 / [复制到 WSL]」。没有问题时不出现。
5. **连接**（SSH）：地址、登录方式、跳板机以只读值显示，等宽、可复制；「更多 → 编辑连接」复用连接表单与验证，别名和导出控制收进高级。导入连接只读，允许编辑显示资料与导出控制，不改用户 SSH 配置。
   **账号**（云平台）：当前账号、开放范围（F-104）；GitHub 在 v0.3 改为「仓库范围」设置式列表，显示归属、使用的登录身份、自动／手动及排除／选中数，组标题「管理范围」。归属不挤进主标题（F-110、6.5.1）。
6. **Agent 需要知道的**：用途、承载的站点等以查看为主，不重复放名称输入；标签／云厂商／地域／笔记收进默认折叠的「更多信息」，副行保留摘要。完整编辑从更多菜单的资料弹窗进行，说明只讲对 Agent 的效果。
7. **服务与目录**（SSH）：默认收成「探测结果」摘要行，点开看 5 列只读表格（名称／类型、镜像、端口、角色、关键）与目录／端口列表；760 宽无横向滚动，不保留空的操作列。重新探测更新采集事实，保留人工角色／关键标注；资料弹窗集中修改人工描述、手工服务（含镜像与端口）及目录记录，删除记录不表示停止或删除远端服务。
8. **红线**：只读编号列表，资料弹窗统一增删／修改；卡片底部诚实说明实际检查覆盖，v0.3 明确应用退出后检查停止，不能承诺安全沙箱。
9. **最近动态**：这项资源最近 3 条操作记录或笔记，组标题右边「查看全部 ›」跳到动态页并按资源过滤。结果、相对时间、命令和展开上下文沿用原结构，放行不冒充执行成功。

#### 6.4.1 当前页编辑与快捷改名（P8b，D6／D7）

- **资料弹窗**：当前详情保留在遮罩后，`Dialog` 居中；固定标题与当前资源说明，中部 `ScrollArea`，固定「取消／保存修改」底栏。600px 宽、高度随内容最高 600px，矮窗口缩到可用高度并保留外边距；全窗单一 card 底，不做灰正文套白卡片。普通字段直接排，只有折叠／列表内容保留细边框；少用组默认折叠。展开、添加、错误定位只滚正文。
- **编辑范围**：名称、用途、站点、标签、云厂商／地域、笔记、红线，服务与目录人工标注／记录；CLI 不显示 SSH 专属项。连接使用单独的「编辑连接／保存连接」，权限档位与 Agent 选择仍即时独立控制，不混进资料保存；系统、硬件、探测时间与连接状态只通过采集刷新。
- **草稿防丢**：输入先留 RHF 草稿，不即时改背景。成功关闭并更新同一详情、保留滚动；失败保持全部输入与就地错误。无改动取消／关闭／Esc／遮罩直接关闭；有改动在同一底栏切换「继续编辑／放弃修改」，不叠 `AlertDialog`，正文不可编辑，Esc 回编辑、确认期间 Ctrl+S 不提交。关闭恢复原入口焦点。
- **标题改名**：平时普通标题无输入框／常驻铅笔，hover／键盘 focus 淡虚线和提示；单击／Enter 开始、选中名称，Enter 或 blur 提交有效变化一次。IME 组词的 Enter 不提交；Esc 恢复旧名且取消后 blur 不保存、不返回列表；拖选复制不误编辑。空白／失败就地留输入，成功短提示可撤销。
- 名称改动不改 SSH 别名、账号／CLI 标识、信任记录，不清空验证或触发重连。「更多 → 编辑资料」包含同一个名称字段，不另加重命名菜单；不再使用正文 600ms 即时保存普通资料的旧流程。

### 6.5 添加资源

顶栏 `+` 或 `Ctrl+N` 打开居中对话框（580px），先选类型。每个分组一张列表卡、每项一行（2026-11-09 由两列选项块改为分组列表，项数多少都不会落单）：品牌方块 + 名称 + 一句话，右边是状态和 `›`，整行可点。这一步对话框按内容定高，之后的表单固定高度。

| 分组 | 选项 | 行右侧的状态（信号青） |
| :--- | :--- | :--- |
| 服务器 | SSH 服务器；从 ~/.ssh/config 导入 | 导入项写「发现 N 台」（已排除代码托管主机，F-102） |
| 云平台 | Cloudflare；Vercel；Oracle Cloud | 「已登录 · wrangler」「未安装 oci」等 |
| 代码托管 | GitHub | 「已登录 · gh」「未登录」 |

- **SSH 服务器**（2026-11-10 按第四轮审查重排，一屏放得下，最小窗口下「名称」也在首屏）：
  - 字段顺序：地址 + 端口；用户 + 名称（可空，提示将使用的不含地址中性名称）；登录方式（分段切换：密码 / 私钥文件 / ssh-agent，**先选中密码**，三种都保留）；所选方式的字段；一张小列表卡放「生产环境」开关（默认开）和折叠的「高级」（SSH 别名、跳板机、运行环境）。
  - 日常只填名称，不要求命名两次。新别名自动生成、唯一、稳定且不含地址，与名称／地址解耦；修改名称／地址、切认证或返回表单不重生。高级里可查看、复制、手改别名，手改说明已有命令与脚本也要调整；冲突错误定位并展开该字段。名称留空不以 IP 或其变形充当默认名称／别名，不放宽隐私 Lint。已有自定义／导入别名保留，不批量静默改写。
  - 密码方式只有一个密码框，说明「只用这一次。连接后换成免密密钥，密码不会保存。」；私钥方式默认只显示一行路径 +「选择…」，WSL 的那一份在添加后的详情问题行里「复制到 WSL」（6.4）。
  - 表单里**不选 Agent、不选档位**（原来固定在底部的「连接成功后授权给」「默认档位」两行去掉了，它们在最小窗口下占掉 125px）。底部只有一句「添加后先是只读巡检，并同步给全部 Agent」+「取消」+ 主按钮「连接并启用」。要改就在资源行的 Agent 图标组和档位菜单上改。
  - 校验：名称可空就不报「请填写名称」；别名自动生成后不再保留「请填写别名」的旧错误。
- **连接流程**（沿用 Termius 式过程页，在同一对话框内，标题「连接 <显示名称>」，留空时用中性默认名）：检查私钥 → 连接服务器 → 核对主机指纹 → 让 Agent 能用别名连接（只在还没加入 Include 的运行环境第一次出现）→ 登录 / 安装免密密钥 → 同步给 Agent。需要人决定的步骤就地展开一张卡，过程停在这一步，卡里只有一个主按钮：
  - 核对主机指纹：指纹 +「指纹一致，继续」（主）+「返回修改」；`known_hosts` 已有同一把公钥时直接沿用。
  - 让 Agent 能用别名连接（F-107 AC1，2026-11-10 取代叠在连接对话框上的第二个对话框）：一句「要让 Agent 用 `ssh <别名>` 连上，需要在你的 SSH 配置开头加一行。只问这一次。」+「加入」（主）+「暂不加入」；哪些运行环境、加的是哪一行、会先备份，收在「了解详情」里。选「暂不加入」时流程继续，服务器照样保存，但在这些运行环境里记为未列入：所有环境都没加入时资源行副行写「● Agent 还连不上 · 」，修复按钮「加入 SSH 配置」，Agent 图标不点亮，提示条「东京节点已添加。加入 SSH 配置后才会同步给 Agent」；只有部分环境没加入时，按 6.4 写在详情「Agent 权限」卡的问题行里。
  - 失败的那一步写明原因（8.3）和修复（例如私钥权限过宽时「复制到 ~/.ssh」），底部「返回修改」「仅保存（暂不启用）」「重新连接」。
  - 成功后自动关闭，新行出现在列表中并短暂高亮（中性底色，约 2.4 秒，不用信号青），提示条「东京节点已添加，并同步给 2 个目录」。新资源默认同步给所有已启用目标。
- **云平台 / GitHub**：只检查已启用目标所在的运行环境（Login Shell 下的路径、版本、`whoami` / `gh auth status`）；未安装或未登录时给单行命令和「打开终端」，切回窗口自动刷新；圈定开放范围后「保存并启用」。和 SSH 表单一样不选 Agent、不选档位，底部同一句说明（2026-11-10）。账号都已接入时只写「这次登录下的账号都已接入…」，不再同时显示「至少一个运行环境就绪后…」。
- **导入**：表格勾选（沿用现有导入对话框），代码托管主机不出现在列表里，底部一行「已跳过 github.com（代码托管，不是服务器）」。

#### 6.5.1 GitHub 归属与仓库范围（v0.3，D1／D8）

- 新增在同一添加弹窗选一个 owner，已接入的不能重复；随后配置范围，默认 auto，说明所选归属当前／未来有权访问的仓库及私有仓库也在内。共用已有有效登录身份，不要求每个组织重登。默认只读与现有新资源选择规则不变。
- 默认标题仍是 GitHub。首页仅多个 GitHub 时副行 12px muted 区分归属；详情状态行、仓库范围组说明归属与登录身份，不提升成大号主标题。显示名称修改不换 owner 或凭据。
- 「管理范围」当前页居中 `Dialog`，与资料编辑同样式／草稿保护。复选框在 auto／manual 都表示「提供给 Agent」：auto 取消即排除，manual 仅选中项。可搜索，已排除与本次将新增在原行标注；手动转自动说明未来／私有范围与当前新增数。
- auto 首次转 manual 保留当前已纳入的已知仓库；同一草稿来回切保留手选。失败保留输入／历史快照，partial／offline／denied 明确；可收窄但完整核对前不能扩围。仓库稳定 ID 跟踪改名／排除，转移到未选 owner 不能继续静默纳入。
- 查看仓库表为名称、默认分支、可见性、部署目标四列，支持搜索／刷新；无匹配与未选仓库不同。关系显示来源、不联动授权；不宣称信息选择降低 gh 的真实权限。

### 6.6 Agent 视图

1. **一句说明**：「CloudLink 把服务器和云平台写成一个 Skill，自动同步给下面这些 Agent。」右边「预览 Skill」。
2. **已检测到 N**（列表卡，一行一个分发目标）：
   - 品牌方块 + 名称；副行「● 已同步 · 4 项资源 · Windows、WSL」。
   - 通用目录的名称后面跟读取它的 Agent 小 Logo（悬停显示名字），副行「3 个 Agent 读取这里」。
   - 右边：护栏状态（Claude Code 是可点的「护栏已开启」，悬停「今天拦截 2 条」，点击跳到动态页；其他目标是 muted 文字「无护栏」，悬停「这个 Agent 还没有护栏，靠红线约束」）+ 启用开关。
   - 问题使用既有副行与一个必要动作：真实同名冲突「● 目录里已有同名 Skill」+「备份并接管」；父目录异常／写入失败如实给具体原因，不误报同名 Skill。共用目录选择不一致写「与 X 共用同一目录，资源选择不一致」；停用但仍被其他成员使用时如实说明。WSL 链到 Windows 写「与 Windows 共用目录，未单独提供」，说明现有文件按 Windows 环境编写，不另增行。护栏未生效沿用重新安装；同步修复自动进行，不新增管理弹窗。
   - 最后一行折叠「其余 N 个未检测到 ⌄」，展开后名字排成三列网格（不写成一段顿号分隔的文字），这一行的文字不变、箭头朝上（2026-11-10）。自定义目录在组标题右边的 `⋯` 菜单「添加自定义目录」。
3. **Skill 内容**（列表卡，三行可点，进入二级页，带 `‹ Agent` 返回）：资源关系（「自动整理 5 条」）、运维约定（「3 条」）、护栏规则（「拦截 9 类危险操作」：数的是拦截的类别，不把只读巡检放行的命令算进去，原来的「内置 66 条」是两者相加，2026-11-10）。二级页沿用 2026-11-07 的规格：关系可以改写、隐藏、补充；约定可拖动排序；护栏规则只读。
   - **护栏规则页**（2026-11-10）：开头一句「护栏装在 Claude Code 上，在命令执行前检查。其他 Agent 没有护栏，只靠红线约束。」→「标准运维时拦下 7 类」→「任何档位都拦下 2 类」→「只读巡检时」。前两组每类一行：类别名 + 命令示例。「只读巡检时」是一行默认收起的「只放行查看类命令，其余都拦下 / 57 条，例如 df、docker ps、journalctl」，展开后按系统、服务与日志、Docker、云平台分组列出；卡片底部一句诚实说明（防手滑不防绕过；看不懂的命令只读时拦下、标准运维时放行并在动态里标出）。命令示例用小圆角方块（DESIGN.md「Command Chip」），整条换行，不从词中间断开，不用胶囊。
4. **运行环境**：Windows、各 WSL 发行版各一行开关，「重新检测」在组标题右边。

### 6.7 动态视图

- **等你确认 N**（有才显示）：一项一块（DESIGN.md「Ask Card」）。默认只展开最新的 2 条，其余折叠成卡片底部一行「还有 N 条 ⌄」，免得把操作记录挤出首屏（2026-11-09）。
  - Agent 笔记：「Claude Code 记下了一条关于 hk-edge 的笔记」+ 原文 +「并入资源」「忽略」，可撤销。命中密钥扫描的笔记显示「需编辑」并给编辑框；疑似注入的显示红色说明，只能忽略。
  - 命令审批（v0.3，F-310）：沿用「发起方想在资源上运行」+ 完整命令 +「允许一次／拒绝」原卡片（D12），不加审批页、倒计时、新原因区或第二轮确认。待审批优先于笔记，不被只展开两条藏起；无法核实品牌时显示未识别来源。通知只定位、不直接批准、不泄漏命令。
  - 允许一次不是执行成功：原状态文字位置显示「已允许，等 Agent 继续」，过期未取为「已过期，未执行」；执行中／成功／失败／未知不同，不给命令假回滚撤销。创建起 5 分钟到期，exec 内联 90 秒后可用 wait 接上，退出不批准旧请求（8.7）。
- **操作记录**：沿用筛选与按资源／天分组，不与应用活动混排。v0.3 区分旧 hook 已放行和 runner 实际执行；有退出码才报完成，超时／断线不明报未知，范围说明明确运行中检查与彻底退出边界，不宣称所有 Agent 的所有命令被记录。
- 应用自身的活动日志（测试连接、探测、同步、备份、更新）在设置 → 数据 →「活动日志」（6.8）；两边互不混排：Agent 的命令只在这一页，活动日志里没有（F-402，2026-11-10）。

### 6.8 设置视图

一页往下滚，分组的设置式列表（不再用左侧分区导航）。2026-11-10 第四轮审查后收短：常用的四组留在外面，很少改的收进页面底部默认折叠的「高级」，1000×680 下约一屏半（原来六组约三屏）。说明文字只讲结果（6.13）。

| 分组 | 行 |
| :--- | :--- |
| 外观 | 主题（浅色 / 深色 / 跟随系统）；导航位置（顶栏 / 侧栏） |
| 启动与托盘 | 关闭窗口时（留在托盘 / 退出）；开机时启动；自动下载更新（F-406，说明「有新版本时在后台下载好，重启后生效」，开关左边写「当前 v0.2.0」，下载状态见 6.15） |
| 数据 | SSH 配置；备份（说明「覆盖或接管之前的版本都留了一份」，「打开」）；活动日志（说明「测试连接、探测、同步、备份和更新的记录」，「查看」） |
| 危险操作 | 停止全部同步（原「移除全部分发」；说明「从所有 Agent 那里撤回 CloudLink 写的 Skill。资源和设置都保留，随时可以重新打开」）；重置 CloudLink（说明「删除全部资源、保存的密码、护栏、笔记和记录，回到刚安装的样子。服务器本身和你自己的文件不受影响」，按钮红色文字，确认时输入「重置」） |
| 高级（一张默认折叠的列表卡，副行「探测、Skill 篇幅、数据目录」） | 探测最长等多久（说明「超过这个时间还没结果，就算探测失败」）；探测脚本（说明「探测只读取信息，不会改动服务器」，「查看」）；Skill 太长时提醒（说明「写给 Agent 的内容超过这个长度，会提醒你精简」）；告诉 Agent 信息的采集时间（说明「Agent 能判断服务器信息是不是过时了」）；数据目录（路径，「打开」） |

- **SSH 配置行**：正常时只有一行「SSH 配置 / Windows、WSL Ubuntu-24.04 都已生效 / [打开]」。某个运行环境还没加入 Include 时，这一行变成问题行（琥珀浅底）：「SSH 配置在 WSL Ubuntu-24.04 里还没生效 / Agent 在 WSL 里还不能用别名连接服务器。想自己加？/ [加入]」；点「想自己加？」才展开手动说明「在 WSL 的 ~/.ssh/config 开头加一行 `Include ~/.ssh/cloudlink.conf`」。不再常驻显示每个环境的托管文件路径和 OpenSSH 的覆盖规则。
- **活动日志**：右侧面板（560px）。标题行右边两个弹出按钮「全部类型」「全部资源」（取代 13 个筛选标签）；按天分组，每行是图标 + 一句话 + 右对齐成一列的时间，失败的用红色；底部一句「这里只记 CloudLink 自己做的事。Agent 执行了什么命令，在动态里看。」（「动态」是链接）。
- 不放还没做的功能：「导出或导入 JSON · v0.5 提供」那一行去掉，做了再加。「编译」不再作为组名出现。
- 重置的说明要如实写出会删什么（原文「移除全部托管副本和设置」说轻了，也用了 6.13 不让用的词）。

### 6.9 空状态（首次使用引导，F-405）

没有任何资源时，资源页居中显示：品牌方块 →「添加第一台服务器」→「添加之后，就可以直接对 Agent 说：」→ 示例话术「看看服务器的磁盘还剩多少」（不含虚构名称／别名，无复制按钮，只说明添加后能做什么）→「+ 添加服务器」（主）+「从 ~/.ssh/config 导入 · N 台」（次；没有可导入的主机时不显示）→ 底部一行「检测到 [Logo] Claude Code、Codex、Cursor，添加后会自动同步给它们」：列的是 Agent，不是目录，通用目录换成读取它的、检测到的 Agent（没检测到任何 Agent 时改为「没有检测到 Agent，可以在 Agent 页添加自定义目录」）。内容在可视高度里上下居中；没有资源时导航上的「资源」不显示 0。空状态时顶栏不显示 `+`。不做分步向导、不做清单卡片。

### 6.10 托盘菜单（F-407）

```text
CloudLink                    ● 护栏运行中
档位
   hk-edge                    只读巡检 ›
●  sg-db                      标准运维 ›   ← 琥珀圆点图标
   dev-box                    只读巡检 ›
   cloudflare                 只读巡检 ›
──────────────────────────────────────────
生产资源全部切回只读        1 项在标准运维
──────────────────────────────────────────
打开 CloudLink
退出
```

- 每项资源一项，显示标识，子菜单切换档位；生产切到标准运维时打开主窗口并弹出确认（托盘菜单里不做确认）。
- 顺序：服务器在前，云平台和代码托管在后；组内生产在前，再按标识排序（2026-11-10）。
- 原生菜单不能排版也不能给文字上色：档位和数量放在 `\t` 后面，由 Windows 菜单右对齐成一列；生产 + 标准运维的资源前面放一个 16px 的琥珀圆点图标，颜色取 oklch(0.62 0.15 60)，在浅色和深色菜单底上都清楚。
- 「生产资源全部切回只读」一键完成，系统通知「1 项生产资源已切回只读」。只动生产资源，名字里写明。
- v0.3 起，命令审批请求以系统通知弹出，点击打开动态页对应卡片。

### 6.11 键盘

| 快捷键 | 作用 |
| :--- | :--- |
| `Ctrl+K` | 命令面板 |
| `Ctrl+N` | 添加 |
| `Ctrl+F` 或 `/` | 搜索资源 |
| `Ctrl+1` 到 `Ctrl+4` | 资源 / Agent / 动态 / 设置 |
| `Ctrl+Shift+S` | 切换顶栏 / 侧栏 |
| `Ctrl+,` | 设置 |
| `Ctrl+\` | 预览 Skill |
| `↑` `↓` / `Enter` | 在列表行间移动 / 打开详情 |
| `Esc` | 依次关闭：弹出菜单 → 对话框 → 详情 |

命令面板分组：跳转（四个视图、按名称搜索资源）；资源（添加 SSH 服务器、添加 Cloudflare / Vercel / Oracle Cloud / GitHub、导入、探测全部；打开了某项资源时多出针对它的几条，写出它的标识，例如「测试 hk-edge 的连接」「探测 hk-edge」「把 hk-edge 分发给 Codex」「把 hk-edge 切换为「标准运维」」，输入标识也能搜到；没打开资源时这几条不出现）；系统（预览 Skill、生产资源全部切回只读、切换主题、切换导航位置；有新版本时「重启以更新到 0.2.0」）。

### 6.12 状态全集

| 场景 | 状态 | 呈现 |
| :--- | :--- | :--- |
| 首次加载 | 加载中 | 与真实列表同形的骨架行（超过 150ms 才显示） |
| 没有资源 | 空 | 6.9 |
| 搜索无结果 | 空 | 「没有匹配的资源」+「清除搜索」 |
| IPC 失败 | 错误 | 就地 `Alert` +「重试」；严重时加「打开日志目录」 |
| 未提交改动 | 防误关 | 对话框关闭前确认「放弃修改 / 继续编辑」 |
| SSH 连接 | 未验证、连接中、已连接（只有绿点）、连接失败 | 资源行副行、详情状态行、6.5 |
| 云平台 CLI | 已登录（只有绿点）、检测中、未安装、未登录、登录已过期 | 同上 |
| 档位 | 只读巡检、标准运维、生产 + 标准运维（琥珀） | 资源行档位文字、详情分段切换、托盘 |
| 列入 | 正常隐身；某环境未列入 | 详情「Agent 权限」卡里的问题行 |
| 分发与副本 | 同步中、实际已同步、真实同名冲突、路径／写入失败、共用选择不一致、WSL 与 Windows 共用但未单独提供 | 现有 Agent 页副行／资源提示，不新增共享目录行或确认弹窗；实际结果才报成功 |
| 护栏 | 已开启、未安装、未生效、不可用 | Agent 页 Claude Code 行、侧栏底部、托盘 |
| Agent 笔记 | 待确认、需编辑、疑似注入 | 动态页「等你确认」、导航圆点 |
| 命令审批（v0.3） | 待审批、已拒绝、已超时、已取消、已批准待执行、执行中、成功、失败、结果未知 | 原动态卡片的状态／操作记录位置；通知只定位、不批准 |
| 探测 | 从未探测、探测中、正常、已过期、失败 | 详情状态行 |
| 编译 | 正常（隐身）、有警告、受阻 | 预览 Skill；受阻时 Agent 页顶部一行琥珀说明 |
| 应用更新 | 见 6.15 | 顶栏提醒 |
| 窗口缩窄 | 最小 760×520 | 顶栏不换行；资源行名称完整显示，Agent 图标组不收起 |

### 6.13 文案规范与状态词表

- 界面状态词只用中文。专有名词保留英文：Skill、SSH、CLI、Agent、Cloudflare、Vercel、Oracle Cloud、GitHub。
- 按钮写明确动作（「连接并启用」「备份并接管」「生产资源全部切回只读」），不写「确定」。
- 错误写清两件事：出了什么问题，接下来怎么办。
- 说明文字讲结果，不讲实现：不出现「description」「编译产物」「受管副本」这类词；必须提到时用「写进 Skill」。同样不对用户说「重新编译」「SKILL.md」「PreToolUse hook」「Include」「托管配置」：探测结果写「已更新 3 处」，约定写「写给每个 Agent 的约定」，托管 ssh 配置对用户叫「SSH 配置」，`Include` 那一行只出现在「了解详情」和手动添加的说明里（2026-11-10）。
- 数量要数用户关心的东西：护栏规则数「拦截几类」，不把放行的命令加进去。
- 会删除数据的操作，说明里如实列出删什么、不动什么。
- 术语：资源、服务器、云平台、分发 / 同步、档位、红线、护栏、动态、笔记。

| 对象 | 状态词 |
| :--- | :--- |
| SSH 连接 | 未验证、连接中、已连接、连接失败 |
| 云平台 CLI | 已登录、检测中、未安装、未登录、登录已过期 |
| 分发 | 同步中、已同步、目录里已有同名 Skill |
| 探测 | 从未探测、探测中、正常、已过期、失败 |
| 护栏 | 护栏已开启、未安装、未生效、不可用、无护栏 |
| Agent 操作 | 已执行、已拦截、待审批、已允许一次、已拒绝 |
| Agent 笔记 | 待确认、需编辑、已并入、已忽略 |
| 环境 | 生产（非生产不显示） |
| 档位 | 只读巡检、标准运维 |
| Agent 目标 | 已启用、已停用、未检测到 |

### 6.14 可访问性

- 达到 WCAG 2.2 AA。DESIGN.md 中的文字色对其所在表面都 ≥ 4.5:1；焦点环用 Signal Cyan。
- 纯图标按钮都有 `aria-label` 和悬停提示；Agent 图标按钮用 `aria-pressed`；开关用 `role="switch"`。
- 状态不只靠颜色：绿点有悬停文字和 `sr-only` 状态词；琥珀档位同时加粗；问题总有文字。
- 全部操作可用键盘完成；排序拖拽有键盘替代（dnd-kit `KeyboardSensor`）。
- 原地更新不移动焦点、不滚动页面；切换一级视图后焦点移到页面 `h1`（顶栏模式下是视觉隐藏的 `h1`）。
- 提示条和连接流程结果用 `aria-live="polite"` 播报。
- 尊重「减少动态效果」；支持 150% 缩放和 `Ctrl ±` 缩放。
- 桌面原生箭头光标，不用手形。

### 6.15 应用更新（F-406，2026-11-05 新增，2026-11-09 改为后台下载）

更新提醒同样「正常即隐身」：没有新版本时，界面上看不到任何与更新有关的元素。2026-11-09 起对标 magpie：发现新版本后先在后台下载并校验，下好才提醒，所以顶栏按钮永远只写「更新」，宽度不随状态变化。

- **后台下载**：检查到新版本就由 Rust 侧在后台下载并校验签名，期间顶栏什么都不显示。进度只在「设置 → 启动与托盘」的版本行里显示：「正在下载 0.2.0… 37%」；下好后显示「0.2.0 已下载好，重启即可更新」。
- **顶栏提醒**：安装包下好后，顶栏右侧（搜索左边）出现一个 `Button variant="outline" size="sm"`，内容是 `CircleArrowUpIcon` 加「更新」，不写版本号；`aria-label` 为「有新版本 0.2.0，查看并更新」，悬停提示「有新版本 0.2.0」。按钮用中性色：有新版本不是状态告警，不用红、琥珀、绿，也不用 Signal Cyan。后台下载失败时同一个按钮出现，`aria-label` 和悬停提示改为「0.2.0 下载失败，查看详情」；正在安装时图标换成 `Spinner`，文字仍是「更新」。窗口宽度不够时只留图标，保证顶栏不换行。顶栏是三列网格，右侧变宽时居中导航往左让，提醒不会盖住导航。
- **更新对话框**（`Dialog`，`sm:max-w-md`）：
  - 标题「新版本 0.2.0」，描述「当前版本 0.1.0 · 发布于 2026-11-20」。
  - 更新说明放在 `ScrollArea` 里（最高约 240px），按纯文本展示并保留换行。说明来自远程的 `latest.json`，不在签名范围内，所以按不可信输入处理：不渲染 Markdown，也不提供可点击的链接。
  - 提示一行：「安装时 CloudLink 会自动关闭并重新打开；护栏和已分发的 Skill 照常工作。」
  - 按钮：「稍后」（`outline`，只关闭对话框）和「重启以更新」（主按钮）。点了之后进入「正在安装」，CloudLink 随即退出：这时只留一句「正在安装。CloudLink 即将关闭并重新打开。」，「稍后」不可用，关闭按钮和 Esc 也关不掉对话框。
  - 后台下载失败：对话框内显示 `Alert variant="destructive"`，写清原因和下一步，例如「安装包签名校验失败，已丢弃。请稍后重试，或到 GitHub Releases 手动下载。」主按钮变为「重试」：重新下载，对话框里显示 `Progress` 和「已下载 3.2 MB / 8.5 MB」，下好后主按钮恢复为「重启以更新」。没有「取消下载」。
  - 安装失败：留着安装包回到「已下好」，显示原因，可以再点「重启以更新」。
  - 等待任务：有进行中的测试连接、探测、CLI 检测或发布时，「重启以更新」不可用，旁边说明在等什么，例如「正在探测 hk-edge，结束后再安装」。
- **命令面板**：和顶栏提醒同时出现，「系统」组出现「重启以更新到 0.2.0」，打开同一个对话框。
- **设置 → 启动与托盘**：`Switch`「自动下载更新」，说明文字为「有新版本时在后台下载好，重启后生效」（2026-11-10 缩短；检查频率和「不上传任何数据」写在第九章，不放进这一行）。开关左边写「当前 v0.1.0」，后台下载时这里换成下载状态。设置里不放「立即检查」按钮；关闭后重新打开开关时会立即检查一次。
- **无障碍**：提醒按钮出现时不抢焦点，也不弹 Toast，只通过 `sr-only` 的 `aria-live="polite"` 区域播报一次「有新版本 0.2.0」。对话框打开后焦点落在主按钮上（不可用时落在「稍后」上）；下载失败、等待任务和正在安装的提示用 `aria-live="polite"` 播报。

---

## 七、前端工程规范：依赖白名单与「禁止自造」

> **v4 说明（2026-11-08）**：前端依赖不变。托盘用 Tauri 内置的 `tray-icon` 特性，不算新依赖；系统通知（托盘通知、v0.3 审批）需要新增官方插件 `tauri-plugin-notification`，由 P7 在动手前登记到 7.1 并征得用户同意。7.3 中与「回路行」「检视面板」「3 个 Tab」相关的映射在 P7 按第六章改写；7.6 的令牌数值按本节原有规则以 DESIGN.md 为准。

> 总原则：**优先复用成熟库；组件源码可控（shadcn 的组件由 CLI 生成到 `src/components/ui`，可以改源码）；统一设计语言；严格限制重复依赖。凡是 7.3 表里已有实现的需求，必须使用表中指定的实现，禁止自行设计组件或交互行为。**

### 7.1 技术栈与版本（2026-10-27 核实）

| 层 | 选型 | 版本 |
| :--- | :--- | :--- |
| 桌面容器 | Tauri | 2.12 |
| 构建 | Vite / `@vitejs/plugin-react` | 8.x / 6.x |
| 框架 | React | 19.3 |
| 语言 | TypeScript | ~6.0（Vite 模板默认值） |
| 样式 | Tailwind CSS（`@tailwindcss/vite`） | 4.3 |
| 组件 | shadcn CLI 4.22+；style `base-nova`；基础库 Base UI（`@base-ui/react`） | 1.9 |
| 类名合并 | `cn`（shadcn 2026-09 起替代 clsx 和 tailwind-merge），加上 `class-variance-authority` | 0.5 / 0.7 |
| 组件内置动效 | `tw-animate-css` | 1.4 |
| 图标 | `lucide-react` | 1.62 |
| 官方品牌标识（Agent 与云平台） | `@lobehub/icons-static-svg`（MIT，取 Claude、OpenAI、Cloudflare、Vercel 官方 Logo，Oracle 官方 SVG 静态放入 `src/assets/brands/oracle.svg`；仅在 `AgentMark.tsx` 与 `ProviderMark.tsx` 中使用；2026-11-02 用户选定） | 1.101.0（锁定） |
| 动画 | `motion`（从 `motion/react` 引入） | 14.x |
| 布局 | `react-resizable-panels`（通过 shadcn `resizable` 安装） | 4.15 |
| 拖拽 | `@dnd-kit/core`、`@dnd-kit/sortable`、`@dnd-kit/utilities`、`@dnd-kit/modifiers` | 6.3 / 10.0 / 3.2 / 9.0 |
| 状态 | `zustand` | 5.0 |
| 表单 | `react-hook-form`、`zod`、`@hookform/resolvers` | 7.9x / 4.x / 6.x |
| 列表与命令面板 | `cmdk`（通过 shadcn `command` 安装） | 1.1 |
| 代码高亮 | `shiki`（通过 shadcn `code-block` 安装，使用 JS 正则引擎） | 4.5 |
| Markdown 渲染 | `streamdown`，样式用 shadcn typeset（一个 CSS 文件，不是 npm 包） | 2.7 |
| 快捷键 | `react-hotkeys-hook` | 5.3 |
| Tauri 前端 API | `@tauri-apps/api`、`@tauri-apps/plugin-dialog`、`@tauri-apps/plugin-opener`（检测更新由 Rust 侧的 `tauri-plugin-updater` 完成，前端不引入 `@tauri-apps/plugin-updater`，见 7.3、8.1） | 2.x |
| 测试 | `vitest`、`@playwright/test` | 5.x / 1.6x |

为什么拖拽选经典版 dnd-kit（`@dnd-kit/core` 系列）：shadcn 的 base-nova 区块（例如 dashboard-01）用的就是这一套，API 稳定，资料多，一次性生成成功率高。新版 `@dnd-kit/react` 截至 2026-10 仍是 0.5.x，API 还在变动。代价是经典版自 2024-12 以来没有再发版，这一点我们接受；等新版到 1.0 时再评估迁移。**两代 API 禁止混用。**

### 7.2 初始化步骤（在仓库根目录执行，Windows PowerShell 或 Git Bash 均可）

```bash
# 1. 用确定的 preset 生成 Vite + shadcn 工程，生成到 ./cloudlink 目录
#    preset b1sArLArQ 的内容：nova / mist / 主题色 mist / 图表色 cyan / lucide / inter / 圆角 small / 菜单 subtle / 菜单色 default
pnpm dlx shadcn@4 init --preset b1sArLArQ --base base --template vite --name cloudlink --no-monorepo --no-rtl --no-pointer
cd cloudlink

# 2. 一次性添加本项目用到的全部 shadcn 组件。只能通过 CLI 添加，不得手写同类组件
pnpm dlx shadcn@4 add sidebar resizable command tabs field input input-group textarea select combobox \
  toggle-group switch checkbox radio-group badge item empty skeleton spinner kbd tooltip dropdown-menu \
  context-menu dialog alert-dialog alert table scroll-area progress collapsible separator breadcrumb \
  toast code-block trace button-group label card sheet

# 3. 安装业务依赖：锁定主版本，白名单之外的依赖一律不装
pnpm add motion@^14 zustand@^5 @dnd-kit/core@^6 @dnd-kit/sortable@^10 @dnd-kit/utilities@^3 @dnd-kit/modifiers@^9 \
  react-hook-form@^7 zod@^4 @hookform/resolvers@^6 streamdown@^2 react-hotkeys-hook@^5 \
  @tauri-apps/api@^2 @tauri-apps/plugin-dialog@^2 @tauri-apps/plugin-opener@^2
pnpm add @lobehub/icons-static-svg@1.101.0   # 2026-11-01：服务器卡片上的 Agent 标识（Claude、OpenAI 的 Logo）
pnpm remove @fontsource-variable/inter      # 改用系统 UI 字体栈，见 7.6
pnpm add -D vitest@^5 @playwright/test@^1 @tauri-apps/cli@^2

# 4. 在现有 Vite 工程中加入 Tauri（生成 src-tauri/）
pnpm tauri init --ci -A CloudLink -W CloudLink -D ../dist -P http://localhost:5173 \
  --before-dev-command "pnpm dev" --before-build-command "pnpm build"
#    然后修改 src-tauri/tauri.conf.json：identifier 先填占位值 "com.cloudlink.desktop"（发布前换成自己的域名）；
#    主窗口设置 minWidth 960、minHeight 600、zoomHotkeysEnabled true

# 5. Mock 模式：新建 .env.mock，内容为 VITE_MOCK=1；在 package.json 中加脚本 "dev:mock": "vite --mode mock"
#    （用 Vite 的 mode 机制，不要写成 VITE_MOCK=1 vite，那种写法在 Windows 上不生效）

# 6. 从 https://ui.shadcn.com/typeset 的生成器导出 typeset.css，放到 src/typeset.css

# 7. 为 Coding Agent 安装 shadcn 的 Skill 和 MCP（提高一次生成的成功率）
npx skills add shadcn/ui
pnpm dlx shadcn@4 mcp init --client claude
```

以上 preset 和组件清单已经在 2026-10-27 用 shadcn CLI 4.22.2 实测通过：39 个组件全部安装成功，额外引入的依赖只有 `cmdk`、`react-resizable-panels` 和 `shiki`。另外写了一个覆盖 7.3 全部关键 API 的冒烟页面，`tsc -b` 和 `vite build` 都能通过。`tauri init` 的参数用 Tauri CLI 2.12 核对过。

已知的坑（实测发现）：

1. shadcn 4.22 生成的 `src/components/ui/scroll-area.tsx` 第 1 行有一个没用到的 `import * as React from "react"`，在 Vite 模板的 `noUnusedLocals` 设置下会让 `tsc -b` 失败。删掉这一行即可。
2. `useFieldArray` 默认会往每一行注入名为 `id` 的键，覆盖领域数据（红线、路径）自身的 `id`。必须设置 `keyName: "key"`。拖拽排序时，`SortableContext` 的 `items` 用领域 `id`，拖拽结束后调用 `move(from, to)`。
3. shadcn 的 `Progress` 把 `ProgressIndicator` 封装在组件内部，外部无法给它传类名。需要按 7.6 在 `progress.tsx` 里增加 `tone` 属性。
4. shadcn 的 Vite 模板自带 `src/components/theme-provider.tsx`，里面有一段「按 d 键切换主题」的监听，要删掉（见 7.3）。

以下几条是 2026-10-28 执行 P0 时发现的，当时 `shadcn@4` 解析为 4.23.0，上面的 preset 和组件清单同样全部通过：

5. `shadcn init` 会在生成的 `cloudlink/` 里自动 `git init`，并提交一次 `feat: initial commit`，形成嵌套仓库。确认里面只有模板内容、没有远端后，删掉 `cloudlink/.git`。
6. 模板的 `typecheck` 脚本是 `tsc --noEmit`，但根 `tsconfig.json` 是 `files: []` 加 references 的写法，这个命令实际检查 0 个文件，故意写入的类型错误也返回 0。改为 `tsc -b`。
7. `src/hooks/use-mobile.ts`（`sidebar` 依赖它）在 effect 里同步调用 setState，过不了模板自带的 eslint-plugin-react-hooks 7 的 `react-hooks/set-state-in-effect` 规则，`pnpm lint` 会失败。用 `useSyncExternalStore` 改写，对外接口不变。
8. `shadcn mcp init` 会顺带把 `shadcn` 从 dependencies 挪到 devDependencies。不影响构建，因为 `shadcn/tailwind.css` 只在构建时被引用。
9. shadcn MCP（4.23.0）的 `view_items_in_registries` 不认 `components.json` 里的 `base-nova`，返回的是 Radix 版组件（依赖 `radix-ui`）。另外，`.mcp.json` 写在 `cloudlink/` 下，从仓库根目录启动的 Claude Code 不会加载它。查组件写法以 `src/components/ui/` 的源码，以及在 `cloudlink/` 下执行的 `pnpm dlx shadcn@4 view <组件>` 为准，不要采用 MCP 返回的代码。
10. typeset 生成器导出的 `typeset.css` 是通用样式表，生成器里选的值只会变成 `--typeset-*` 变量，所以文件保持上游原样。它第 142 行有一个上游写死的颜色 `oklch(0.86 0.17 95)`（`<mark>` 高亮用），因此 7.10 第 6 条的颜色检查同时排除 `index.css` 和 `typeset.css`。

### 7.3 需求 → 唯一实现映射表

| 需求或交互行为 | 必须使用的实现 | 禁止 |
| :--- | :--- | :--- |
| 原生窗口与应用导航 | P8b Tauri 原生装饰（正式／桌面测试配置一致）、原生主题与受支持的 Windows 标题栏着色；WebView 下层 `AppHeader` 48px，四项导航用 `ToggleGroup`／`aria-current`，按设置切顶栏或 200px 侧栏，操作经既有 portal；不重复应用名，系统负责窗口控制 | 自绘最小化／最大化／关闭、应用导航拖动区、重复标题栏、额外标题栏模式设置 |
| 资源列表与详情、添加 | 全宽列表（`max-w-3xl mx-auto`）或带返回的全宽详情，一次只显示一个；添加用居中 `Dialog`。P8b 详情以查看为主，资料／连接在当前页居中 `Dialog`（6.4.1；600px 宽、内容定高 max600、`ScrollArea` 正文与固定底栏） | 左右分栏把列表挤窄；跳到新编辑页；灰正文套白卡片；自写模态框 |
| 可用键盘导航的选择列表（命令面板、导入列表以外的 Combobox 选项） | `Command`（`shouldFilter={false}`）、`CommandInput`、`CommandList`、`CommandGroup`、`CommandItem`、`CommandEmpty` | 自写 roving tabindex 或方向键处理 |
| 资源回路行（单行双闸刀） | 每组一个 1px 圆角容器（`divide-y`），每行一个 `Item`；行间方向键导航用 `src/lib/grid-nav.ts` 中的一个小函数（按 DOM 顺序和位置计算，单列时只有上下），这是 7.3 里唯一允许的自写键盘逻辑 | 引入网格或虚拟列表库；多列卡片网格 |
| 命令面板 | `CommandDialog` | 自写弹层 |
| 快捷键 | `react-hotkeys-hook` 的 `useHotkeys("mod+k", fn, { preventDefault: true, enableOnFormTags: true })`。`mod` 同时匹配 Ctrl 和 Cmd。提示文字用 `Kbd` 或 `KbdGroup` | 自己监听 `window` 的 keydown |
| 表单状态、校验、脏标记、动态行 | react-hook-form、`zodResolver`、`useFieldArray`；外观用 `Field`、`FieldLabel`、`FieldDescription`、`FieldError`、`FieldSet`、`FieldLegend` | 自写表单状态和校验；用占位符代替标签 |
| 可排序列表（路径、红线、运维约定） | `DndContext`、`SortableContext`（`verticalListSortingStrategy`）、`useSortable`，配合 `KeyboardSensor` 与 `sortableKeyboardCoordinates`、`restrictToVerticalAxis`；拖拽结束后调用 RHF 的 `move()`。`useFieldArray` 必须设置 `keyName: "key"` | HTML5 原生拖放；自写排序 |
| 状态徽章和环境徽章 | `Badge`。在 `badge.tsx` 的 cva 中新增 `success` 和 `warning` 变体（直接改源码） | 另外写一个 Pill 或 Tag 组件 |
| 列表行、设置项、笔记条目、清单项 | `Item` 系列（`ItemMedia`、`ItemContent`、`ItemTitle`、`ItemDescription`、`ItemActions`） | 自写行组件 |
| 服务器卡片、Agent 目标卡片 | `Card size="sm"`、`CardHeader`、`CardAction`、`CardContent` | 卡片里再嵌套卡片 |
| 空状态 | `Empty`、`EmptyMedia`、`EmptyTitle`、`EmptyDescription`、`EmptyContent` | 只写一行「暂无数据」 |
| 加载中 | `Skeleton`（首屏加载）、`Spinner`（按钮内或行内） | 自写 loading 动画 |
| 步骤进度和日志行（探测、活动、操作记录） | `Trace`、`TraceLine status`、`TraceCollapsible` | 自写 Stepper |
| 源码、diff、日志、命令展示 | `CodeBlock`、`CodeBlockLine variant`、`CodeBlockCopyButton`、`useHighlightedCode` | prism、highlight.js、CodeMirror、Monaco |
| Markdown 渲染 | `streamdown`，外层包 `div.typeset` | react-markdown、`@tailwindcss/typography` |
| 通知 | shadcn `Toast`（Base UI 实现）：`toast.add`、`toast.close`、`toast.promise`、`actionProps`。默认 5 秒后自动消失；带「撤销」按钮的 Toast 停留 8 秒。Toast 不抢焦点 | sonner、react-hot-toast、`alert()` |
| 危险操作确认 | `AlertDialog` | `window.confirm` |
| 编辑资料／连接／GitHub 范围及导入 | `Dialog` + RHF／zod + `Field`／`FieldGroup`／`FieldSet` + `ScrollArea`，少用组 `Collapsible`；脏草稿在同一底栏切换继续／放弃，关闭恢复焦点（6.4.1），不叠确认弹窗 | 自写模态框；正文普通资料即时保存；叠第二个草稿确认 Dialog |
| 标题快捷改名 | 既有 `Button`／`Tooltip` 组合可聚焦标题，编辑态 `Input` 与 RHF／zod；局部 Enter／blur 单次保存、IME 保护、Esc 取消后抑制 blur，不改连接状态 | 自写全局 keydown；常驻铅笔／操作按钮；600ms 自动提交半截名称 |
| Skills 父级链接与共用目录 | Rust `deliver` 解析真实父目录、按同环境真实目录分发一份；保持现有 Agent 行／图标结构，受影响图标一起更新、真实状态进入既有副行／提示（8.2） | 新增共享目录行、范围合并／启用确认弹窗、图标关闭而后台取并集 |
| 侧边浮层（预览 Skill、探测、护栏规则） | `Sheet`（`side="right"`） | 自写抽屉 |
| 开关（Agent 启用、关键服务、导出） | `Switch` | 用 Checkbox 或按钮模拟 |
| 多选（分发给哪些 Agent） | `ToggleGroup multiple`，每个 Agent 一个 `ToggleGroupItem` | 一排 `Switch` 或 `Checkbox` |
| 菜单 | `DropdownMenu`（Checkbox 和 Radio 项）、`ContextMenu` | 自写弹出菜单 |
| 提示 | `Tooltip`（全局包一层 `TooltipProvider`） | 只写 `title` 属性 |
| 选择器 | `Select`（固定选项）、`Combobox`（可搜索、多选标签、SSH 别名） | 自写下拉框 |
| 分段选择 | `ToggleGroup` | 用按钮组模拟 |
| 标签页 | `Tabs`，二级切换用 `<TabsList variant="line">` | 自写标签页 |
| 折叠区域（详情分段、高级设置） | `Collapsible` | 自写折叠动画 |
| 滚动容器 | `ScrollArea` | 自定义滚动条 CSS |
| 进度条（上限占用） | `Progress`。在 `progress.tsx` 中新增 `tone` 属性（default、warning、destructive），用来给指示条变色，见 7.6 | 自写进度条 |
| 选择私钥文件或目录、在文件管理器中显示 | `@tauri-apps/plugin-dialog` 的 `open()`；`@tauri-apps/plugin-opener` 的 `revealItemInDir` | 无 |
| 复制到剪贴板 | `CodeBlockCopyButton`，其他场景用 `navigator.clipboard.writeText` | 引入剪贴板库 |
| 相对时间和数字格式化 | `Intl.RelativeTimeFormat`、`Intl.NumberFormat`，统一封装在 `src/lib/format.ts` | dayjs、date-fns、moment |
| 主题切换 | shadcn Vite 模板自带的 `src/components/theme-provider.tsx`：用 `ThemeProvider` 包住根节点，在需要的地方调用 `useTheme().setTheme("system" \| "light" \| "dark")`。删除模板里默认的「按 d 键切换主题」那段监听，主题切换只放在设置页和命令面板里 | next-themes；在 store 里重新实现一套主题逻辑 |
| 动画 | `motion/react`（`AnimatePresence`、`layout`、`MotionConfig`），浮层动画沿用组件自带的 | framer-motion 这个包名；手写 keyframes |
| 图标 | `lucide-react`，用 `XxxIcon` 的命名导入；Agent 标识用 `AgentMark`（唯一引入 `@lobehub/icons-static-svg` 的地方） | 其他图标库、emoji、内联 SVG |
| 类名合并 | 从 `@/lib/utils` 引入 `cn` | 直接用 clsx 或 tailwind-merge |
| 全局状态 | zustand v5，使用 `useShallow`；只有 UI 偏好用 `persist` 持久化 | Redux、Jotai、用 React Context 管全局状态 |
| 后端调用 | 只能通过 `src/lib/ipc.ts` 调用 `invoke`；后端事件只能由 `src/lib/events.ts` 订阅 | 在组件里直接调用 `invoke` 或 `listen` |
| 应用更新（F-406，6.13） | 后端命令 `getUpdateStatus`、`installUpdate` 和事件 `update://changed`（照常只经 `ipc.ts`、`events.ts`）；顶栏提醒用 `Button variant="outline" size="sm"` 加 `CircleArrowUpIcon`，对话框用 `Dialog`，进度用 `Progress`，更新说明是 `ScrollArea` 里的纯文本，错误用 `Alert`，开关用 `Switch` | 前端引入 `@tauri-apps/plugin-updater`；用 streamdown 渲染远程的更新说明；自写弹窗、进度条或轮询定时器（检查周期由 Rust 负责） |

### 7.4 依赖黑名单与 ESLint 强制

`package.json` 中的 dependencies 只能来自 7.1 的白名单，外加 shadcn CLI 自动引入的包。以下规则写入 `eslint.config.js`，并纳入 CI：

```js
// eslint.config.js（追加到 shadcn 模板的配置之后）
const banned = {
  paths: [
    { name: "framer-motion", message: "动画统一使用 motion/react" },
    { name: "sonner", message: "通知统一使用 @/components/ui/toast" },
    { name: "next-themes", message: "主题由模板自带的 ThemeProvider 管理" },
    { name: "clsx", message: "使用 @/lib/utils 的 cn" },
    { name: "tailwind-merge", message: "使用 @/lib/utils 的 cn" },
    { name: "react-markdown", message: "Markdown 渲染统一使用 streamdown" },
    { name: "@dnd-kit/react", message: "统一使用 @dnd-kit/core 与 @dnd-kit/sortable，不混用两代 API" },
    { name: "radix-ui", message: "本项目基础库为 Base UI，请使用 @/components/ui/*" },
    { name: "react-router", message: "MVP 不引入路由，视图由 useUIStore.view 管理" },
    { name: "@tanstack/react-query", message: "本地 IPC 数据统一放在 Zustand store" },
    { name: "@tauri-apps/api/core", importNames: ["invoke"], message: "只能在 src/lib/ipc.ts 中调用 invoke" },
    { name: "@tauri-apps/api/event", importNames: ["listen"], message: "只能在 src/lib/events.ts 中订阅事件" },
    { name: "@tauri-apps/plugin-updater", message: "更新由 Rust 侧完成，前端只调用 src/lib/ipc.ts 中的后端命令（F-406）" },
  ],
  patterns: [
    { group: ["@radix-ui/*", "@base-ui/react", "@base-ui/react/*"], message: "业务代码只能从 @/components/ui 引入组件" },
    { group: ["react-icons", "react-icons/*", "@heroicons/*", "@tabler/icons-react", "@phosphor-icons/*", "@iconify/*", "@hugeicons/*", "@remixicon/*"], message: "图标统一使用 lucide-react" },
    { group: ["@mui/*", "antd", "@chakra-ui/*", "@mantine/*", "@headlessui/*", "react-aria-components"], message: "UI 统一使用 shadcn/ui" },
    { group: ["react-beautiful-dnd", "@hello-pangea/dnd", "react-dnd", "sortablejs", "react-sortablejs"], message: "拖拽统一使用 dnd-kit" },
    { group: ["allotment", "react-split", "react-split-pane", "react-mosaic-component"], message: "布局统一使用 @/components/ui/resizable" },
    { group: ["redux", "@reduxjs/*", "jotai", "recoil", "mobx", "valtio"], message: "状态统一使用 zustand" },
    { group: ["moment", "dayjs", "date-fns", "luxon"], message: "时间格式化使用 src/lib/format.ts（基于 Intl）" },
    { group: ["prismjs", "highlight.js", "react-syntax-highlighter", "@uiw/*", "@monaco-editor/*", "codemirror", "@codemirror/*"], message: "代码展示统一使用 @/components/ui/code-block" },
    { group: ["react-hot-toast", "react-toastify", "notistack"], message: "通知统一使用 @/components/ui/toast" },
  ],
};

export default [
  // ...shadcn 模板原有配置
  { files: ["src/**/*.{ts,tsx}"], ignores: ["src/components/ui/**", "src/lib/ipc.ts", "src/lib/events.ts", "src/mocks/**"],
    rules: { "no-restricted-imports": ["error", banned] } },
];
```

### 7.5 状态管理（Zustand）

规则：

- 按领域拆分 store。组件只通过 selector 订阅；需要同时取多个字段时用 `useShallow`。
- 派生数据不存进 store，用 selector 现算。
- 表单草稿只存在 react-hook-form 里，不往 store 里复制一份。
- 已持久化资源的 `save`／`update`、删除、档位、Agent 选择和 CLI 范围变更按资源 ID 串行；不同资源不设全局锁。局部资料、连接、改名与生产标记用 `update(id, latest => input)`，构造函数到队首才运行，前一完整发布结果先写回缓存，再构造下一请求；生产标记只覆盖本次值，其他字段以最新资源为基线。失败释放队列，删除后排队更新返回 `not-found`，构造函数不再次调用保存入队；无 ID 新建保留原流程。这不替代后续跨后台任务的 revision／epoch 核对。
- 后端事件由 `src/lib/events.ts` 在应用启动时统一订阅，再分发给各个 store。

| Store | 状态 | 动作 | 持久化 |
| :--- | :--- | :--- | :--- |
| `useUIStore` | `view`（servers、agents、settings）、`selectedAssetId`、`creating`（添加弹窗：`pick`、`ssh` 或云平台）、`createPrefill`、`detailTab`（画像与规则、连接配置、动态）、`returnFocusId`、`query`、`previewOpen`、`previewKey`、`commandOpen`。主题不放在这里，由 ThemeProvider 管理 | `setView`、`goToView`、`selectAsset`、`startCreate`、`closeInspector`、`setDetailTab`、`setQuery`、`openPreview` | 否（2026-11-02 去掉 `sectionsOpen`） |
| `useAssetStore` | `byId`、`ids`、`status`、`error` | `load`、`save`（两类资源，返回完整发布结果）、`update`（到队首按最新资源构造输入）、`remove`、`importHosts`、`setDistribute`、`setMode`、`setCliScope` | 否 |
| `useCliStore` | `byProvider`（检测中、各环境状态、可选范围，新建向导里还没有资源时用）、`awaiting`（打开终端后等切回窗口） | `detect`、`setDraftScope`、`awaitFocus`、`onFocus` | 否 |
| `useConnectionStore` | `testsByKey`（按服务器 id 或新建表单的临时键索引：状态、耗时、远端系统、错误 id、待确认的主机指纹） | `test`、`cancel`、`trustHostKey`、`convertToKey` | 否 |
| `useProbeStore` | `runs`（按 runId 索引，含已合并和待确认的变化）、`activeRunByAsset` | `start`、`cancel`、`confirmItems`、`undo`；`_onProgress`、`_onFinished` 由事件桥调用 | 否 |
| `useSkillStore` | `config`（补充与隐藏的资源关系、运维约定）、`relations`（自动整理的资源关系）、`statusByKey`（每一份总 Skill 的编译状态，键是「运行环境 × Agent」） | `load`、`saveConfig`、`_onCompiled` | 否 |
| `useTargetStore` | `environments`、`targets` | `detect`、`setEnabled`、`addCustom`、`removeCustom` | 否 |
| `useDeliveryStore` | `byId`、`inclusions` | `checkAll`、`repair`；`_onChanged`。分发和列入都由后端计算，前端不单独创建 | 否 |
| `useGuardStore` | `statusByEnv`、`rules` | `load`、`install`、`remove`；`_onChanged` | 否 |
| `useNotesStore` | `byAsset`（待处理的笔记） | `load`、`merge`、`dismiss`；`_onNew` | 否 |
| `useOperationStore` | `recentByAsset`（每台最近 50 条） | `load`、`_onNew` | 否 |
| `useActivityStore` | `items` | `load`、`_onNew` | 否 |

需要提供的 selector：

- `selectResourceGroups(state, query)`：「服务器」「云平台」两组，组内生产在前、再按名称排序（用户拖动排序后按用户顺序）（搜索匹配名称、别名、标签、站点名，以及 CLI 名、账号和已选范围）。纯函数，必须有单元测试。
- `selectCliProblem(asset)`：第一个未就绪的运行环境（Windows 在前），回路行就地给出「去登录」「去安装」。纯函数，必须有单元测试。
- `selectInclusionsByAsset(assetId)`：详情 Agent 分段使用。`selectDeliveriesByEnv()`：Agent 页使用。
- `selectCanDistribute(asset)`：返回 `{ ok: true }` 或 `{ ok: false, reason }`（未验证、只有密码认证等）。纯函数，必须有单元测试。
- `selectHealth()`：返回副本问题、护栏问题和编译受阻的数量。

### 7.6 设计令牌落地（`src/index.css`）

在 shadcn 生成的 `index.css` 基础上做以下修改。数值以 DESIGN.md 的 frontmatter 为准，两处不一致时以 DESIGN.md 为准。

```css
@import "tailwindcss";
@import "tw-animate-css";
@import "shadcn/tailwind.css";
/* 2026-11-08：不再打包 Web 字体（移除 @fontsource-variable/jetbrains-mono），等宽用系统 Cascadia Mono */
@import "./typeset.css";

@custom-variant dark (&:is(.dark *));

@theme inline {
  --font-sans: system-ui, "Segoe UI Variable Text", "Segoe UI", "PingFang SC", "Microsoft YaHei UI", "Noto Sans CJK SC", sans-serif;
  --font-heading: var(--font-sans);
  --font-mono: "JetBrains Mono Variable", "Cascadia Mono", "SF Mono", ui-monospace, Menlo, Consolas, monospace;
  --color-success: var(--success);
  --color-warning: var(--warning);
  --color-agent-claude: var(--agent-claude);    /* 2026-11-01：Agent 标识色，只用于 Agent 按钮 */
  --color-agent-openai: var(--agent-openai);
  /* 其余 --color-* 和 --radius-* 保留 shadcn 生成的内容，不要改 */
}

:root {
  /* 其余变量保留 preset 生成的值（mist），只覆盖或新增下面几项 */
  --muted-foreground: oklch(0.52 0.021 213.5);   /* 覆盖：0.56 改为 0.52，使它在 muted 底色上达到 4.91:1 */
  --ring: oklch(0.609 0.126 221.723);            /* 覆盖：Signal Cyan */
  --sidebar-ring: oklch(0.609 0.126 221.723);
  --success: oklch(0.508 0.118 165.612);
  --warning: oklch(0.555 0.163 48.998);
  --agent-claude: oklch(0.56 0.15 40);
  --agent-openai: oklch(0.6 0.13 168);
}

.dark {
  --ring: oklch(0.715 0.143 215.221);
  --sidebar-ring: oklch(0.715 0.143 215.221);
  --sidebar-primary: oklch(0.925 0.005 214.3);   /* 覆盖：去掉 preset 默认的蓝色，与 primary 保持一致 */
  --success: oklch(0.765 0.177 163.223);
  --warning: oklch(0.828 0.189 84.429);
  --agent-claude: oklch(0.72 0.14 42);
  --agent-openai: oklch(0.74 0.13 168);
}
```

`badge.tsx` 中需要新增的两个变体：

```ts
success: "bg-success/10 text-success [a]:hover:bg-success/20",
warning: "bg-warning/10 text-warning [a]:hover:bg-warning/20",
```

`progress.tsx` 中需要新增的 `tone` 属性（已实测可以编译）：

```tsx
const toneClass = { default: "", warning: "bg-warning", destructive: "bg-destructive" } as const

function Progress({ className, children, value, tone = "default", ...props }:
  ProgressPrimitive.Root.Props & { tone?: keyof typeof toneClass }) {
  // ...其余部分保持生成时的代码不变，只改这一处：
  // <ProgressIndicator className={toneClass[tone]} />
}
```

### 7.7 动效规范

- 动效只用 `motion/react`。`main.tsx` 的根节点包一层 `<MotionConfig reducedMotion="user" transition={{ duration: 0.18, ease: [0.25, 1, 0.5, 1] }}>`。
- 只允许以下 4 个场景，范围之外不加动效：

| 场景 | 实现 | 时长 |
| :--- | :--- | :--- |
| Agent 笔记条目的离开（并入或忽略后） | `AnimatePresence`，配合 `layout`、`exit={{opacity:0,y:-4}}` | 离开 120ms |
| 测试连接结果出现 | 结果行包在 `motion.div` 里，`initial={{opacity:0}}` | 150ms |
| 探测步骤逐条出现 | 新的 `TraceLine` 包在 `motion.div` 里，`initial={{opacity:0,y:4}}` | 150ms |
| 新建或导入后新增的资源回路行 | `AnimatePresence` | 180ms |

- 浮层（Dialog、Popover、DropdownMenu、Tooltip、Sheet、Collapsible、Toast）使用组件自带的动画，禁止再用 Motion 包一层。
- 禁止：页面加载时的错峰入场、悬停时放大回弹、`bounce` 大于 0 的 spring、装饰性的循环动画。

### 7.8 IPC 契约与 Mock 模式

- 类型由 Rust 结构体经 ts-rs 生成，放在 `src/bindings/`，禁止手改。
- 所有命令都封装在 `src/lib/ipc.ts`：

```ts
import { invoke } from "@tauri-apps/api/core";
export const ipc = {
  detectEnvironments: () => invoke<Environment[]>("detect_environments"),
  listSshHosts: (envId?: EnvId) => invoke<SshHostList>("list_ssh_hosts", { envId }),
  listAssets: () => invoke<Asset[]>("list_assets"),
  saveAsset: (input: AssetInput) => invoke<SaveResult>("save_asset", { input }),
  deleteAsset: (id: string, opts: { removeGeneratedKey: boolean }) => invoke<DeleteResult>("delete_asset", { id, opts }),  // F-101 AC2：CloudLink 生成或复制的密钥单独勾选（2026-10-31 补充）
  importHosts: (hosts: ImportHost[], probeAfter: boolean) => invoke<Asset[]>("import_hosts", { hosts, probeAfter }),
  testConnection: (req: ConnectionTestRequest) => invoke<{ testId: string }>("test_connection", { req }),  // 结果经 connection://tested 返回
  cancelConnectionTest: (testId: string) => invoke<void>("cancel_connection_test", { testId }),
  trustHostKey: (testId: string, fingerprint: string) => invoke<void>("trust_host_key", { testId, fingerprint }),
  setPassword: (assetId: string, password: string | null) => invoke<void>("set_password", { assetId, password }),  // 写入系统凭据库；null 为删除
  convertToKeyAuth: (assetId: string) => invoke<Asset>("convert_to_key_auth", { assetId }),
  copyKeyToWsl: (req: { source: string; envId: EnvId }) => invoke<{ path: string }>("copy_key_to_wsl", { req }),  // F-108 AC4：复制到该发行版的 ~/.ssh/，600 权限，重名加后缀；返回副本路径（2026-10-31 补充）
  copyKeyToSshDir: (req: { source: string; envId: EnvId }) => invoke<{ path: string }>("copy_key_to_ssh_dir", { req }),  // F-108：Windows 复制一份只有当前用户能读的副本到 ~/.ssh/；WSL 同 copyKeyToWsl（2026-11-07）
  checkKey: (req: KeyCheckRequest) => invoke<KeyCheck>("check_key", { req }),  // F-108 私钥预检，只读：ok / missing / permissions / passphrase / putty / public-key / invalid（2026-11-07）
  getSshConfigStatus: () => invoke<SshConfigStatus[]>("get_ssh_config_status"),
  addSshInclude: (envId: EnvId) => invoke<SshConfigStatus>("add_ssh_include", { envId }),
  setDistribute: (assetId: string, agentKey: string, on: boolean) => invoke<DistributeResult>("set_distribute", { assetId, agentKey, on }),  // 同一事务联动共用成员，返回资源、完整发布快照与受影响 AgentKey
  setMode: (assetId: string, mode: Mode) => invoke<SaveResult>("set_mode", { assetId, mode }),
  detectCliEnvironment: (req: { provider: CliProvider; assetId?: string; account?: string }) => invoke<Partial<Record<EnvId, CliEnvState>>>("detect_cli_environment", { req }),  // F-104 AC1：只检测已启用 Agent 所在的运行环境；新建时可指定账号，带 assetId 时使用持久化绑定并更新这项资源
  refreshCliScope: (req: { provider: CliProvider; assetId?: string; account?: string }) => invoke<CliScopeItem[]>("refresh_cli_scope", { req }),  // F-104 AC3：新建时拉取所选账号的范围；带 assetId 时使用持久化绑定并保留已勾选的项
  setCliScope: (assetId: string, selectedIds: string[]) => invoke<SaveResult>("set_cli_scope", { assetId, selectedIds }),  // 范围勾选立即生效并重新编译（2026-11-02 补充）
  openEnvTerminal: (req: { envId: EnvId; command: string }) => invoke<void>("open_env_terminal", { req }),  // F-104 AC2：在该运行环境打开终端并预填安装或登录命令
  startProbe: (assetId: string) => invoke<{ runId: string }>("start_probe", { assetId }),
  cancelProbe: (runId: string) => invoke<void>("cancel_probe", { runId }),
  confirmProbeItems: (runId: string, changeIds: string[]) => invoke<SaveResult>("confirm_probe_items", { runId, changeIds }),  // 只用于待确认项
  undoProbe: (runId: string) => invoke<SaveResult>("undo_probe", { runId }),
  getSkillConfig: () => invoke<SkillConfig>("get_skill_config"),
  saveSkillConfig: (input: SkillConfig) => invoke<CompileStatus[]>("save_skill_config", { input }),
  listRelations: () => invoke<Relation[]>("list_relations"),  // 自动整理的资源关系（含已隐藏的，hidden 标注），2026-11-07
  previewSkill: (req: { envId: EnvId; agentKey: string; asset?: AssetInput; config?: SkillConfig }) => invoke<CompilePreview>("preview_skill", { req }),  // 预览某一份总 Skill；带草稿时预览草稿
  getCompileStatus: () => invoke<CompileStatus[]>("get_compile_status"),
  listTargets: () => invoke<Target[]>("list_targets"),
  setTargetEnabled: (id: string, enabled: boolean) => invoke<Target>("set_target_enabled", { id, enabled }),
  addCustomTarget: (req: { envId: EnvId; label: string; path: string }) => invoke<Target>("add_custom_target", { req }),
  removeCustomTarget: (id: string) => invoke<void>("remove_custom_target", { id }),
  listInclusions: () => invoke<Inclusion[]>("list_inclusions"),
  listDeliveries: () => invoke<Delivery[]>("list_deliveries"),
  checkDeliveries: () => invoke<Delivery[]>("check_deliveries"),
  repairDelivery: (id: string) => invoke<Delivery>("repair_delivery", { id }),
  removeAllDeliveries: () => invoke<void>("remove_all_deliveries"),
  getGuardStatus: () => invoke<GuardStatus[]>("get_guard_status"),
  installGuard: (envId: EnvId) => invoke<GuardStatus>("install_guard", { envId }),
  removeGuard: (envId: EnvId) => invoke<GuardStatus>("remove_guard", { envId }),
  getGuardRules: () => invoke<GuardRules>("get_guard_rules"),
  listOperations: (q: OperationQuery) => invoke<Operation[]>("list_operations", { q }),
  listNotes: (assetId?: string) => invoke<AgentNote[]>("list_notes", { assetId }),
  mergeNotes: (items: { id: string; text?: string }[]) => invoke<SaveResult>("merge_notes", { items }),  // text 为编辑后的内容
  dismissNotes: (ids: string[]) => invoke<void>("dismiss_notes", { ids }),
  listActivity: (q: ActivityQuery) => invoke<ActivityItem[]>("list_activity", { q }),
  getSettings: () => invoke<Settings>("get_settings"),
  updateSettings: (patch: Partial<Settings>) => invoke<Settings>("update_settings", { patch }),
  setWindowTheme: (theme: Theme) => invoke<void>("set_window_theme", { theme }),  // P8b：沿用已有 Theme，同步 main 原生窗口；不新增主题缓存或外观设置
  getProbeScript: () => invoke<string>("get_probe_script"),
  resetData: () => invoke<void>("reset_data"),  // 所有权校验、完整受管数据清理和可重试的凭据清理；范围见 6.7
  getUpdateStatus: () => invoke<UpdateStatus>("get_update_status"),  // F-406：当前版本和最近一次检查的结果
  installUpdate: () => invoke<void>("install_update"),  // F-406：ready 时安装后台下好的安装包，有进行中的任务时返回 update-busy，Windows 上开始安装后应用退出；后台下载失败（available 带 error）时重新下载，进度经 update://changed
};

export interface CompilePreview {
  envId: EnvId; agentKey: string;              // 哪一份：运行环境 × Agent
  files: { path: string; content: string }[];                   // SKILL.md 排在第一个
  budget: { descriptionChars: number; descriptionLimit: number; bodyLines: number; bodyLineLimit: number };
  lint: { id: LintId; level: "error" | "warning" | "info"; assetId?: string; params?: Record<string, string | number>; file?: string; line?: number }[];
  // 后端只返回 id 和参数，不返回中文句子；界面文案由 src/lib/copy.ts 按 id 映射（探测错误分类、护栏原因同理）
  blocked: boolean;                                              // 有 error 级 Lint 时为 true，此时不会发布
}

export interface CompileStatus {
  envId: EnvId; agentKey: string; blocked: boolean; errors: number; warnings: number; compiledAt: string | null;
  lint: CompilePreview["lint"];             // 这一份最近一次编译的 Lint，每条带服务器 id；详情头部的受阻摘要和侧栏的受阻数据此计算（2026-10-31 补充）
}

export interface SaveResult {               // 保存、档位与范围变更的完整实际发布快照
  asset: Asset;
  statuses: CompileStatus[];
  inclusions: Inclusion[];
  deliveries: Delivery[];
}

export interface DistributeResult extends SaveResult {
  affectedAgentKeys: string[];              // 本次明确资源开关联动的全部成员
}

type Theme = "system" | "light" | "dark"; // 沿用 Settings.theme 的既有偏好

export interface UpdateStatus {             // F-406（2026-11-05 补充）
  state: "idle" | "available" | "downloading" | "installing";  // idle：没有新版本、尚未检查或已关闭检查，界面不显示任何更新元素
  currentVersion: string;
  version?: string; date?: string; notes?: string;              // 来自 latest.json；notes 按不可信纯文本展示
  downloaded?: number; total?: number;                          // downloading 时的字节数；total 可能未知
  error?: IpcError;                                             // 上次安装没有完成的原因（{ id, params }），此时 state 回到 available
}
```

**发布状态与原生窗口约定（P8a／b）：**

- `saveAsset`、`setMode`、`setCliScope` 等采用 `SaveResult`；`setDistribute` 采用 `DistributeResult`。`statuses`、`inclusions`、`deliveries` 都是完整快照，前端替换对应缓存，不以点选状态或 Promise resolve 冒报成功。
- `setTargetEnabled` 仍返回 `Target`，不改命令名或引入包装 DTO。目标启用／停用、新增／移除与备份撤销完成后，前端明确重新读取资源、目标、列入、实际副本与编译状态，再生成反馈；不依赖事件先于命令返回。
- 送达只计已启用目标、该资源列入、对应编译未受阻且副本为 `ok` 的记录，按 `unitId` 去重。`shared-directory` 是良性共用说明；`shared-selection-mismatch` 即使空交集且为 `missing` 仍需提示，健康刷新不清除；`shared-windows` 不算 WSL 独立送达。
- `set_window_theme` 只接受主窗口调用，使用已有主题偏好。启动先协调 WebView 与原生栏再显示正常可见窗口；显式隐藏的测试窗口不自动显示，旧窗口状态不恢复无装饰或提前可见。配色沿用 `src/index.css` 令牌，高对比度与系统原生能力优先。

**CLI 账号与错误约定：**

- `detectCliEnvironment` 与 `refreshCliScope` 支持可选 `account`，供尚未保存的向导选择账号；账号标识取 Cloudflare Account ID、Vercel CLI 实际列出的稳定 Team/User ID 或 OCI Profile。带 `assetId` 时以已保存资源的 provider/account 绑定为准，请求中的账号不能覆盖该绑定。新建向导省略账号时，检测返回可操作的账号集合，范围刷新选择首个就绪账号，仅返回该账号下的资源。
- `IpcErrorId` 中的 `compile-blocked`、`cli-account-unavailable`、`cli-scope-permission`、`cli-scope-failed`、`cli-command-unsupported` 和 `terminal-command-invalid`，分别表达旧产物不可用于创建/修复、账号不可用、Scope 权限不足、Scope 拉取或校验失败、CLI 不支持固定查询、终端命令不在允许列表中。
- `InclusionReasonId` 中的 `unverified` 与 `env-unavailable`，表达尚未通过连接验证和运行环境暂时不可用。
- `LintId` 中错误级的 `publish-failed` 表达编译源的原子写入失败，令该份编译状态受阻并保留上次成功的编译源。ID 联合类型扩展时，Rust ts-rs 导出、前端契约与 `copy.ts` 映射保持同步，保留既有 ID、命令名和事件字段。

**护栏、笔记与重置约定：**

- `guard://changed` 的 `statuses` 表示完整状态快照，前端据此替换缓存。窗口可见时每 60 秒读取笔记与护栏状态，重新聚焦或恢复可见时立即读取；后台导入操作记录并触发对应事件。
- `GuardReasonId` 中的 `cli-account` 和 `cli-scope`，分别表达命令账号无法匹配已绑定资源，以及目标未在已选 Scope 内或无法确定目标。Rust ts-rs 导出、手写契约和 `copy.ts` 映射保持同步，保留既有 ID 和载荷。
- `IpcErrorId` 中的 `reset-incomplete` 表达重置尚未完成。重置在修改受管文件前写入持久意图；凭据删除失败或已有凭据写入尚未结束时保留回执、阻止旧数据重新发布，用户重试 `reset_data` 可继续清理，重启应用也不会恢复旧副本。
- `merge_notes` 的一批条目必须来自同一资源，与单个 `SaveResult` 返回值一致；整批校验后事务并入。疑似含密钥的笔记必须提交实际修改过的文本并通过重新扫描，不能仅传回未改内容。每项资源最多 100 条待处理，超出的输入保留待后续读取。
- `reset_data` 完成 6.7 的受管分发、编译产物、托管 SSH 配置、护栏 hook/程序/策略、笔记与操作记录、密码及清理回执的清理。未知文件、其他 Skills、用户 SSH 配置及其 Include、用户私钥保留；清理后若收件箱因未知文件保留，其旧资源归属映射清空。OS 凭据调用不持有全局状态锁或数据库锁。

**更新约定（F-406，2026-11-05 补充）：**

- `Settings.autoCheckUpdates`（默认 `true`）控制定时检查，检查周期由 Rust 负责，前端不自建定时器。`update_settings` 把它从 `false` 改为 `true` 时立即检查一次；改为 `false` 时停止检查，状态回到 `idle`。
- `update://changed` 的 `status` 是完整快照，前端据此替换缓存；启动时先用 `getUpdateStatus` 取一次。检查失败只写日志，不改变状态、不发错误事件。
- `IpcErrorId` 新增 `update-busy`（`params.task` 说明在等哪项任务）、`update-download-failed`、`update-signature-invalid` 和 `update-install-failed`；Rust ts-rs 导出、前端契约和 `copy.ts` 映射保持同步。

后端事件（只在 `src/lib/events.ts` 中订阅）：

| 事件 | 载荷 |
| :--- | :--- |
| `probe://progress` | `{ runId, assetId, step, status, ms? }` |
| `probe://finished` | `{ runId, assetId, status, error?, applied?, held? }`（`applied` 是已自动合并的变化，`held` 是待确认的变化） |
| `connection://tested` | `{ testId, status, ms?, remoteOs?, error?, hostKey?: { fingerprint, known: "new" \| "changed" } }` |
| `deliveries://changed` | `{ deliveries, inclusions }` |
| `compile://finished` | `{ statuses }`（`CompileStatus[]`） |
| `guard://changed` | `{ statuses }`（`GuardStatus[]`） |
| `operations://new` | `{ assetId, count, denied }` |
| `notes://new` | `{ assetId, count }` |
| `activity://new` | `{ item }` |
| `update://changed` | `{ status }`（`UpdateStatus` 完整快照，F-406） |

**Mock 模式**：运行 `pnpm dev:mock`（即 `vite --mode mock`，读取 `.env.mock` 中的 `VITE_MOCK=1`）后，前端在渲染之前调用 `@tauri-apps/api/mocks` 的 `mockIPC(handler, { shouldMockEvents: true })`，于是可以直接在普通浏览器里开发界面，也可以跑 Playwright。

Mock 夹具（`src/mocks/fixtures.ts`）必须覆盖下面这些状态：

| 类别 | 夹具内容 |
| :--- | :--- |
| 运行环境 | Windows 和 WSL Ubuntu-24.04 |
| 服务器 | `hk-edge`：生产，managed，私钥认证，已验证，已探测，分发开，只读，有 3 条待处理的 Agent 笔记（其中 1 条命中密钥）；`sg-db`：生产，imported，已验证，**标准运维**（回路行琥珀色提醒），分发开，探测会失败（主机密钥未信任）；`dev-box`：开发，managed，密码认证，未验证，分发关 |
| 测试连接 | 新建表单中：地址含 `timeout` 时超时失败，含 `refused` 时连接被拒，含 `mitm` 时主机密钥变化，用户为 `bad` 时认证失败，其余成功；首次测试一个新地址时先返回待确认的主机指纹，`known.example.com` 视为用户 `known_hosts` 里已有记录，直接沿用 |
| 私钥预检 | 路径含 `downloads` 或 `open`（或 WSL 中位于 `/mnt/`）时权限过宽，`.ppk` 为 PuTTY 格式，`.pub` 为公钥，含 `missing` 时不存在，含 `passphrase` 时设有密码短语，其余可用 |
| Agent 目标 | Claude Code（Windows，已检测，启用）；通用目录（Windows，停用，读取它的有 Codex、Cursor、Windsurf、Augment）；Claude Code（WSL，已检测，启用）；通用目录（WSL，启用，读取它的有 Codex、Gemini CLI）；一个指向 `~/.cursor/skills` 的自定义目录（Windows，启用，冲突，提示 Cursor 已能从 Claude Code 目录读到） |
| 列入与分发 | `hk-edge` 在 WSL 中未列入（WSL 中没有配置私钥）；副本状态覆盖 `ok`、`missing`、`modified`、`conflict`（目录中已有用户手写的 `cloudlink-servers`） |
| 总 Skill | 由示例资源自动整理出的资源关系（域名解析、跳板机）、1 条补充的关系和 2 条运维约定；Windows 环境的编译有 1 条警告 |
| 护栏 | Windows 已生效；WSL 未安装 |
| 操作记录 | `hk-edge` 最近 20 条，其中 2 条被拦下（一条写操作、一条读取 `.env`）；`sg-db` 标准运维下放行的重启；`cloudflare` 拦下一条 `wrangler deploy`，`vercel` 拦下一条 `vercel env pull` |
| 云平台 CLI | `cloudflare`：两个环境都已就绪（`me@example.com`），已选 2 个域名和 1 个 Worker，`example.com` 关联 `hk-edge`；`vercel`：Windows 已就绪（`my-team`），WSL 未登录；Oracle 未接入，本机 Windows 未安装 `oci`、WSL 已就绪，用于走添加向导。「打开终端」后 Mock 把该环境改为已就绪，切回窗口时自动刷新 |
| ssh 配置 | Windows 已加入 Include；WSL 未加入（用于验证 F-107 的同意步骤和设置里的问题行） |
| 探测 | 模拟 3 秒的进度事件；对 `hk-edge` 自动更新 3 处，另有 1 处疑似注入的待确认项 |
| 应用更新 | 默认没有新版本，不影响现有截图；E2E 通过 Mock 开关模拟已下好的 `0.2.0`（带多行更新说明）、后台下载、签名校验失败后重试和 `update-busy` |

### 7.9 目录结构

```text
src/
  main.tsx                 根节点：ThemeProvider（模板自带）、MotionConfig、TooltipProvider、Toaster、事件桥
  App.tsx                  AppHeader（顶部 48px 一体栏）+ 视图切换
  index.css  typeset.css
  components/ui/           shadcn 生成的组件（可以改源码，但禁止新增同类组件）
  components/theme-provider.tsx   shadcn Vite 模板自带（删掉其中按 d 键切换主题的监听）
  components/app/          应用级组合组件：AppHeader、CommandMenu、EnvBadge、StateBadge、SkillPreview、AgentMark、ProviderMark
  features/servers/        ServersView（列表、全宽详情、添加弹窗）、ResourceList、BreakerRow、ModeSwitch、ServerDetail、CliDetail（3 个平铺 Tab，
                           含 NotesSection、OperationsSection）、NewServerForm（连接并启用）、NewCliForm（云平台向导）、CliParts、
                           ConnectionTest、HostKeyDialog、ProbeSheet、ImportDialog
  features/agents/         AgentsView、SkillContentSection、GuardSection、GuardRulesSheet、TargetCard
  features/settings/       SettingsView 及各分区（含 ActivitySection、SshConfigSection）
  stores/                  ui.ts、assets.ts、connection.ts、probe.ts、skills.ts、targets.ts、deliveries.ts、guard.ts、notes.ts、
                           operations.ts、activity.ts
  lib/                     ipc.ts、events.ts、utils.ts（cn）、format.ts（Intl）、schemas.ts（zod）、hotkeys.ts、
                           copy.ts（全部界面文案，以及 Lint、探测错误和护栏原因 id 到中文的映射）
  bindings/                ts-rs 生成的类型
  mocks/                   fixtures.ts、install.ts（mockIPC）
```

### 7.10 完成定义（DoD）

1. `pnpm typecheck`、`pnpm lint`、`pnpm build` 全部通过，ESLint 不出现 `no-restricted-imports` 告警。
2. `pnpm dev:mock` 下，三个视图都能用夹具完整渲染，控制台没有报错。
3. 6.10 中列出的每个状态，都能通过夹具或交互复现出来。
4. 只用键盘就能完成以下操作：在服务器卡片之间移动并打开详情，`Ctrl+N` 新建并填写表单、测试连接、保存，在卡片的 Agent 按钮之间用方向键移动、用空格切换，用空格切换 Agent 启用开关，`Ctrl+K`，`Ctrl+S`。
5. Playwright 截图覆盖资源列表、服务器详情、云平台详情、添加 SSH 服务器、添加云平台、Agent、设置，以及更新提醒／对话框。P8a／b 增加资料／连接弹窗、快捷改名／防丢、默认名／高级别名、共用目录联动及 WSL 状态、空状态；浅／深色与两种导航，1000×680／760×520 均覆盖。真实桌面另验证原生系统栏、启动／激活／失焦、窗口操作与关闭到托盘，浏览器截图不能替代；截图无溢出／遮挡、焦点清晰，存仓库根 test-results/p8/ 并逐张使用 analyze_image。
6. 只修改了 7.6 列出的令牌（含 2026-11-01 用户同意新增的 `agent-claude`、`agent-openai`），没有新增任何颜色值（用 `grep -E "oklch\(|#[0-9a-f]{3,6}"` 检查 `src/` 下除 `index.css`、上游原样的 `typeset.css` 和官方品牌 Logo `src/assets/brands/*.svg` 以外的文件，见 7.2 已知的坑第 10 条）。

### 7.11 给 Coding Agent 的执行入口

完整的分阶段执行计划见 `docs/EXECUTION-PLAN.md`，新对话的开场提示词也在那份文件末尾。本章（第七章）是执行时的硬约束，任何阶段都必须遵守。

---

## 八、后端（Rust）方案

### 8.1 模块划分

| 模块 | 职责 | 主要依赖 |
| :--- | :--- | :--- |
| `db` | SQLite（WAL 模式）、`schema_version` 与迁移 | `rusqlite`（bundled） |
| `env` | 运行环境检测；WSL 发行版枚举（`wsl.exe -l -q`）；路径换算（`wslpath`）；检查 WSL 互操作是否可用（WSL 中的护栏依赖它） | 标准库 |
| `ssh` | 枚举 Host 列表：用 `ssh2-config`，它支持 `Include`，并且可以通过 `home_dir` 解析 WSL 内的配置（但不支持 `Match` 和 Token）。获取某个别名的生效值：在对应运行环境里执行 `ssh -G <alias>`，这样 `Match` 和 Token 也能正确处理。写入托管配置 `cloudlink.conf`，管理 `~/.ssh/config` 开头的 Include 行（F-107）。测试连接与探测都调用系统 ssh | `ssh2-config`、`tokio::process` |
| `secret` | 密码存取（Windows 凭据管理器，键含数据目录隔离前缀与 `<assetId>`；未传新密码时先校验连接目标未变）；`SSH_ASKPASS` 辅助程序（应用自身在 `main.rs` 第一行按环境变量标记分流，在 `tauri-plugin-single-instance` 之前退出，经本地一次性 loopback/管道向主进程取密码，不经命令行和环境变量传递明文；Windows 下用 `current_dir` + `./cloudlink.exe` 规避 OpenSSH 9.5 非 ASCII 路径问题，详见 `docs/CC-SWITCH-EXPERIENCE.md`）；生成 ed25519 密钥并安装公钥（F-108） | `keyring`、`ssh-key` |
| `probe` | 内置并版本化的探测脚本；解析输出；自动合并（合并前保存快照，用于撤销）；疑似注入的值列为待确认 | 标准库 |
| `compile` | 按运行环境渲染总 Skill（内置英文模板）；Lint；密钥扫描；原子发布 | `minijinja`、gitleaks 规则集、`regex`、`sha2` |
| `deliver` | 受管复制：把各运行环境的编译产物写进已启用的目标（WSL 目标经 `\\wsl.localhost\<发行版>\` 路径写入）；所有权校验；冲突判定；列入计算；健康检查与修复 | `sha2`（副本内容哈希） |
| `guard` | 写入护栏策略 `policy.json`；在各运行环境的 `~/.claude/settings.json` 中安装和移除 hook（WSL 经 `\\wsl.localhost\` 路径；同意、备份、原子写入、保留其余内容和键顺序）；把护栏程序复制到 `~/.cloudlink/bin/`；自检；同步资源档位与 Scope；读入护栏记录（F-307） | `serde_json`（`preserve_order`） |
| `notes` | 读取笔记收件箱、扫描、并入与忽略（F-308） | 标准库 |
| `update` | 检测更新（F-406）：按设置开关定时检查（启动 10 秒后一次，之后每 24 小时一次，失败后 1 小时重试）；下载、签名校验与安装；判断有没有进行中的测试连接、探测、CLI 检测或发布；安装前写活动记录；推送 `update://changed` 快照。更新源可注入，单元测试用假的更新源，`cfg!(test)` 下真实更新源直接报错、不访问网络 | `tauri-plugin-updater` |
| `ipc` | Tauri 命令与事件；类型导出 | `ts-rs` |
| `cloudlink-guard`（独立的小程序） | 护栏本体：从标准输入读 hook 的 JSON，按 8.6 判定，输出拦截结果并追加记录。和 `guard` 模块共用规则 crate `guard-rules`；不联网、不读数据库，Windows 上从启动到退出不超过 50ms | `serde_json` |

Rust 依赖锁定的主版本（2026-10-27 核实）：`tauri` 2.12、`tauri-build` 2.7、`rusqlite` 0.41（features = bundled）、`minijinja` 3、`ssh2-config` 0.9、`keyring` 3、`ssh-key` 0.6（features = ed25519）、`ts-rs` 12、`serde` 1、`serde_json` 1（features = preserve_order）、`thiserror` 2、`tokio` 1、`ulid` 3、`regex` 1、`sha2` 0.11、`dirs` 7；开发依赖 `tempfile` 3。v3 去掉了 `tiktoken-rs`（不再估算 Token）和 `junction`（不再使用链接）。

Tauri 插件：`tauri-plugin-dialog`、`tauri-plugin-opener`、`tauri-plugin-window-state`、`tauri-plugin-single-instance`、`tauri-plugin-log`，以及 F-406 的 `tauri-plugin-updater` 2（2026-11-05 加入，只在 Rust 侧调用，capability 不给前端授予 `updater:*` 权限）；F-407 的 `tauri-plugin-notification` 2 与设置「开机时启动」的 `tauri-plugin-autostart` 2（2026-11-09 经用户同意加入，都只在 Rust 侧调用，不给前端授予权限；隔离模式下不注册开机启动）。**不向前端暴露 shell 插件和 fs 插件**：所有系统操作都由具名的 Rust 命令完成，capability 按最小权限配置。护栏程序作为 sidecar 打包（`bundle.externalBin`，文件名带目标三元组后缀）。`pnpm --dir cloudlink build:guard` 构建并准备该文件；Tauri 的 `beforeDevCommand` / `beforeBuildCommand` 自动执行此步骤，全新检出后直接运行 Cargo 门禁前也须先准备 sidecar。主应用、`guard-rules` 和 `cloudlink-guard` 都是 workspace 的默认成员，全套 Cargo 门禁覆盖三者。

### 8.2 分发方式：一律受管复制

v3 起 CloudLink 不创建指向编译源的 Skill 叶子符号链接／Junction，所有副本都用受管复制。P8a 允许用户已有的父级 skills 目录／祖先链接并解析真实父目录；这不放宽叶子安全，也不恢复链接分发。理由：

- CloudLink 是总 Skill 唯一的写入方，每次发布都会同步全部副本，链接「改一处、处处生效」的好处用不上。
- 链接在各 Agent 中的支持参差不齐：Claude Code 有 Junction 挂进来的 Skill 无法调用（#41177）、Node/Bun 把 Junction 识别为链接（#68318）、某些版本按 `isDirectory()` 过滤漏掉链接（#14836）等问题，自动更新还删过 `~/.claude/skills` 下的链接（#50052）。改用复制可以一并避开，还省掉了链接方式切换、WSL 路径换算和链接失效检测。

| 目标所在的运行环境 | 写入方式 |
| :--- | :--- |
| Windows | 直接写入目标目录 |
| WSL | 经 `\\wsl.localhost\<发行版>\<家目录>\...` 路径写入；发行版没有运行时，访问该路径会启动它 |
| macOS、Linux（v0.5 / v1.0 起） | 直接写入目标目录 |

- 每次发布先把新内容写到目标旁边的暂存目录，再整体交换（做法同 8.4），保证 Agent 不会读到写了一半的 Skill。
- 副本里的 `.cloudlink.json` 记录写入时的内容哈希。健康检查（F-305）据此区分「副本缺失」、「副本被改动」（实际内容与标记中的哈希不一致）和「待同步」（标记中的哈希不是最新的编译结果）。

#### 8.2.1 父级链接解析与叶子安全（P8a，D4）

- `target.path` 的父级 skills 目录及祖先可以是 Symlink／Windows Junction，逐级解析真实父目录（最大 40 次、防环）；悬空、循环、非目录、I/O 权限失败是路径异常，不映射成同名 Skill 冲突。
- 解析后只在 `real_parent` 上检查／暂存／交换，沿用无链接真实祖先检查；交换前重新解析并比对，改指即中止。真实目录不能与数据根、编译源或 `.ssh` 相等／互相包含；其他目标真实目录相同进入共用组、互相包含拒绝。隔离模式真实路径仍必须在覆盖根内，不能借链接回退真实 HOME／USERPROFILE／APPDATA 或 Skills。
- 叶子 `<real_parent>/cloudlink-servers` 与内部内容保留 `symlink_metadata`、Windows `FILE_ATTRIBUTE_REPARSE_POINT`（0x400）、整树哈希及 `.cloudlink.json` 所有权校验。外部同名目录或叶子链接是冲突；不跟随链接覆盖／删除外部内容。接管沿用显式备份与撤销，叶子链接不因接管而允许递归跟随。
- 在真实父目录内排他暂存、校验、重检所有权后交换，失败回滚旧副本；按真实目录串行发布。收窄选择优先避免保留暴露旧授权的副本，失败如实返回状态。

#### 8.2.2 共用真实目录作为一个分发单位（P8a，D13）

- 同一运行环境的已启用目标按真实父目录分组。资源开关在同一事务对组内成员一起生效，返回受影响 Agent 成员；图标一起点亮／熄灭，现有提示说明共用，不做后台取并集或另增 UI 行／弹窗。
- 升级／新链接首次发现选择不一致时用交集，不静默扩大；现有副行提示「与 X 共用同一目录，资源选择不一致」，任一成员上一次资源开关可对齐。正常组一份渲染、编译源、实际副本；当前模板若出现 Agent 特定差异，须明确解决再发布。
- 所有权标记新增可选组成员 `agent_keys`（序列化沿用现有字段命名）；旧标记的单 `agent_key` 属于当前组内时兼容、下次写入升级，组外或非法标记仍冲突／损坏。停用一个成员不删除仍由其他成员使用的副本，全部不需要或无列入资源才移除。
- `saveAsset`、`setDistribute` 返回完整实际发布快照，后者包含受影响成员；`setTargetEnabled` 保持返回 `Target`，前端完成后明确重新读取发布快照再反馈（7.8）。资源已授权、列入、编译成功或 Promise resolve 不能替代实际已同步。真实冲突、路径失败、未列入与部分送达分开反馈；实际送达计数按真实目录去重。新增类型／ID 同步 Rust、ts-rs、`ipc.ts`、Mock、store 与 `copy.ts`，不在组件直接 invoke／listen。

#### 8.2.3 WSL 链接与跨环境共用（P8a，D15）

- WSL Linux 绝对符号链接须在该发行版内解析（等价 realpath），不能靠 Windows UNC canonicalize 误解其目标；复用受控 WSL 入口，所有测试仍在覆盖 WSL 根内。
- 解析落在 `/mnt/<盘符>/…` 且对应已登记 Windows 目标真实目录时只由 Windows 侧写入，WSL 状态「与 Windows 共用目录，未单独提供」，说明文件按 Windows 环境编写；不参与同环境组、不重复写入、不报同名冲突或同步成功。
- 其他 `/mnt/`、跨发行版或不支持挂载返回明确原因，不尝试写入。临时父级 Symlink／Junction 可写、隔离越界拒绝、叶子链接不跟随、组内旧标记升级、选择交集／联动／停用及 WSL 真实符号链接均须回归覆盖。

### 8.3 探测脚本规范

**Windows 上有两套 ssh 客户端（2026-10-28 在开发机上实测）：**

| 客户端 | 路径 | 谁会用到 | ssh-agent |
| :--- | :--- | :--- | :--- |
| Windows 自带 OpenSSH（9.5p1） | `C:\Windows\System32\OpenSSH\ssh.exe` | 正常启动的 Tauri 应用；从 PowerShell 或 Windows Terminal 启动的 Codex（系统和用户 PATH 里只有这一个 ssh） | Windows 的 `ssh-agent` 服务 |
| Git for Windows 自带的 MSYS ssh（9.9p2） | `<Git 安装目录>\usr\bin\ssh.exe` | Claude Code：它在 Windows 上通过 Git Bash 执行命令，Git Bash 的 PATH 会把这个 ssh 排在前面 | MSYS 自己的 agent 套接字，看不到 Windows 服务里的密钥 |

两者读取同一个 `~/.ssh/config`，但 ssh-agent 不是同一个。由此定出三条规则：

1. Windows 原生环境的测试连接、探测和 `ssh -G`，一律用系统 OpenSSH 的**绝对路径**，不依赖 PATH 顺序。设置里允许改为 Git for Windows 的 ssh。
2. 如果这台服务器依赖 ssh-agent 里的密钥（认证方式为 ssh-agent，或私钥有口令），并且 Windows 上启用了 Claude Code 目标，就在详情 Agent 分段的 Windows 一行里说明：「Claude Code 在 Windows 上使用 Git Bash 的 ssh，读不到 Windows ssh-agent 服务里的密钥。请在 ssh config 中用 `IdentityFile` 指向它能直接读取的密钥，或者在 Git Bash 中加载 agent。」
3. P5 验收时，两条路径要分别验证一次。

执行方式：

```bash
ssh -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=yes -- <alias> 'sh -s' < probe.sh
```

整个探测 30 秒超时，超时后终止进程。

测试连接（F-106）使用同一套 ssh 调用，只执行 `true` 和 `cat /etc/os-release` 两条命令；managed 服务器在保存前测试时，用一份只含这台服务器的临时配置（`ssh -F <临时文件>`），保存后改用托管配置。连接前先用 `ssh-keygen -y -P "" -f <私钥>` 预检私钥（只读，不读取私钥内容到 CloudLink）。首次连接用钉住别名的临时 `known_hosts`（`HostKeyAlias=<别名>`）以 `accept-new` 取回指纹，用户确认后立即写入真正的 `known_hosts`，再继续认证，认证失败也不必再核对；用户 `known_hosts` 里已经有这个地址的同一把公钥时（`ssh-keygen -E sha256 -l -F <地址>`，跳过 `@revoked` 与 `@cert-authority` 记录）直接沿用并为别名补一条记录（2026-11-07）。密码认证时去掉 `BatchMode=yes`，加 `PreferredAuthentications=password,keyboard-interactive` 和 `NumberOfPasswordPrompts=1`，并设置 `SSH_ASKPASS_REQUIRE=force`。

采集清单（只用 POSIX sh，每一段命令失败都不影响其他段）：

| 段 | 命令 | 采集的字段 |
| :--- | :--- | :--- |
| `@@os` | `cat /etc/os-release` | NAME、VERSION_ID、PRETTY_NAME |
| `@@kernel` | `uname -srm` | 内核版本、架构 |
| `@@cpu` | `nproc`，或回退到 `getconf _NPROCESSORS_ONLN` | 核数 |
| `@@mem` | 读取 `/proc/meminfo` 中的 `MemTotal` | 总内存（只取总量） |
| `@@disk` | `df -P -k /` | 根分区总量（不取余量） |
| `@@docker` | `docker ps --format '{{.Names}}\t{{.Image}}\t{{.Ports}}\t{{.Status}}'` | 名称、镜像、端口、状态 |
| `@@listen` | `ss -H -tln`，或回退到 `netstat -tln`（不加 `-p`） | 监听地址和端口 |
| `@@systemd` | `systemctl list-units --type=service --state=running --no-legend --plain` | 服务名 |
| `@@tools` | `command -v nginx openresty docker pm2 1pctl bt caddy` | 已安装的组件 |
| `@@panel` | `test -d /opt/1panel`、`test -d /www/server/panel` | 面板类型和路径 |

**明确不采集**：环境变量、`docker inspect`、进程命令行、任何文件内容、shell 历史、`~/.ssh` 目录、密钥。不使用 `sudo`。

**探测数据是不可信输入。** 容器名、镜像名、服务名都可能被服务器上的其他人控制。如果原样写进 SKILL.md，就等于让人往 Agent 的上下文里注入指令。因此编译时必须遵守三条规则：

1. 名称类字段只有在全部字符属于 `[A-Za-z0-9._:/@-]` 时才原样保留；含其他字符的，在服务器信息里标记为「已清洗」，并替换掉非法字符。
2. 所有来自探测的值，在 Markdown 中一律用行内代码（反引号）或表格单元格输出，长度上限 128 个字符。
3. Lint 增加一条规则「疑似指令注入」（警告级）：探测来源的值里出现类似指令的英文或中文短语时触发，例如 ignore previous、system prompt、忽略以上。触发的值不自动合并，要用户确认（F-103 AC5）。Agent 笔记（F-308）按同样的规则检查。

错误分类：

| stderr 匹配 | 分类 | 界面文案 | 建议 |
| :--- | :--- | :--- | :--- |
| `Permission denied (publickey` | 认证失败 | 「hk-edge 拒绝了密钥认证」 | 确认公钥已加入服务器的 `~/.ssh/authorized_keys`；认证方式为 ssh-agent 时，在终端运行 `ssh-add -l` 确认密钥已加载 |
| `Permission denied (password` 或 `keyboard-interactive` | 密码错误 | 「hk-edge 拒绝了密码」 | 重新输入密码；确认服务器允许密码登录（`PasswordAuthentication yes`） |
| `Host key verification failed` | 主机密钥未信任 | 「本机还不认识 hk-edge 的主机密钥」 | 点「测试连接」，核对指纹后信任。软件不会自动信任 |
| `REMOTE HOST IDENTIFICATION HAS CHANGED` | 主机密钥变化 | 「hk-edge 的主机密钥变了，可能是重装了系统，也可能是中间人攻击」 | 核实之后手动更新 `known_hosts` |
| `Could not resolve hostname` | 解析失败 | 「无法解析 hk-edge 的地址」 | 检查地址是否填写正确（imported 服务器检查 ssh config 中的 HostName） |
| `Connection timed out`，或连接阶段超时 | 连接超时 | 「连接 hk-edge 超时（10 秒）」 | 检查网络、防火墙和安全组 |
| `Connection refused` | 连接被拒 | 「hk-edge 的 SSH 端口拒绝连接」 | 检查 sshd 是否运行、端口是否正确 |
| 密钥需要口令，但 BatchMode 下无法交互输入 | 需要交互 | 「密钥需要输入口令，但当前无法交互」 | 用 ssh-agent 加载密钥，并把认证方式改为 ssh-agent |
| `Bad permissions` 或 `UNPROTECTED PRIVATE KEY FILE` | 私钥权限过宽 | 「私钥文件权限过宽，ssh 拒绝使用」 | WSL 中把私钥放到 `~/.ssh/` 并设置 600 权限（连接分段提供「复制到 WSL」） |
| 某一段返回 `permission denied`（例如 docker） | 部分成功 | 「部分信息采集失败：docker 需要权限」 | 把用户加入 docker 组，或者忽略这一段 |

#### 8.3.1 SSH 接入诊断与私钥说明（P8e，D11）

- 失败步骤就地展示阶段、现有错误 ID、客户端种类／版本、退出码与白名单安全摘要；未知错误不只指向没有详情的日志。可折叠并复制已展示的安全摘要，Rust 仍只返回 reason／error ID 与参数，不返回本地化句子或任意原始 stderr。
- `ConnectionTestedEvent` 与必要的 `KeyCheck` 可增加可选 `ConnectionDiagnostic`，参数使用白名单；不得含地址／用户名拼接串、解析后的连接信息、密码、私钥、原始探测输出或执行输入。用户名拼写错误属于输入问题，提示核对，不描述成软件缺陷。
- 主机指纹是服务器身份，不是用户登录密钥；首次通过云控制台、VNC／串口或已可信渠道核对。已确认且一致沿用，变化阻止并警告，不加普通继续按钮绕过真实性校验。
- D 盘等自选目录权限正确可直接使用，修复触发的是权限不是盘符。权限过宽只提供复制受保护副本：同一把密钥、不生成新密钥、不改原文件内容／位置／ACL，也不消除原文件权限风险；原文件处置建议可折叠说明，不新增原地修改 ACL 的 IPC。已有 `copyKeyToSshDir`／`copyKeyToWsl` 确认流程及 PasswordTargetChanged／单测禁用 OS 凭据库门禁不变。

### 8.4 编译与原子发布

1. **校验**：serde 加业务规则。
2. **渲染**：使用 minijinja 模板，内置模板随应用版本一起发布。每个「运行环境 × Agent」渲染一份总 Skill，只包含分发给这个 Agent、并在该环境列入的服务器（3.4）；笔记收件箱的路径按该环境渲染成绝对路径。
3. **Lint**：规则见 5.4。
4. **写入暂存目录**：写到 `compiled/.staging/<环境>-<Agent>-<随机后缀>/`，然后 fsync。
5. **交换目录**：把旧目录重命名为 `.trash/...`，再把新目录重命名为正式路径，最后删除 `.trash`。Windows 上如果因为文件被占用导致重命名失败，就退避重试 3 次；仍然失败时保留旧产物，界面提示「编译受阻：目录被占用」。
6. **发布结果**：写入所有权标记，发出 `compile://finished` 事件，然后按 8.2 同步这个 Agent 在该环境的已启用目标的副本。

### 8.5 安全

- 前端只能调用具名的 Tauri 命令。capability 中不授予 `shell:allow-execute`，也不开放任意文件系统读写。
- CSP 禁止加载远程脚本。
- 本软件自身需要的凭据（服务器密码、P2 的 Cloudflare Token）存放在系统凭据库，不进入 SQLite，不写日志。
- 托管 ssh 配置和 `~/.ssh/config` 的写入都是原子的（写临时文件再重命名），修改用户 config 前先备份。
- 修改 Claude Code 的 `settings.json` 时：先征得同意并备份；文件不是合法 JSON 时不做任何修改，只提示用户；只增删命令指向 `cloudlink-guard` 的那一条；原子写入。
- 护栏策略 `policy.json` 含服务器地址，和 `data.db` 一样放在用户目录下的 `~/.cloudlink/`，不进入 Skill。
- 笔记收件箱和护栏记录由 Agent 一侧写入，按不可信输入处理：长度上限、密钥扫描、疑似注入检查，界面上只以纯文本展示。
- 应用更新（F-406）的配置：
  - 端点固定为 HTTPS 的 `https://github.com/Furina-he/cloudlink/releases/latest/download/latest.json`；以后加镜像时，在 `endpoints` 中按顺序追加。
  - 只安装通过内置公钥签名校验（minisign）的安装包。签名私钥和口令不入库，只保存在发布者本机或 CI Secret 中，并另行备份：丢失后，已安装的版本再也无法自动更新。
  - `latest.json` 中的更新说明不在签名范围内，界面只以纯文本展示。
  - 只有测试构建可以把端点改到本地 HTTP 服务，正式构建不开 `dangerousInsecureTransportProtocol`。

### 8.6 护栏（F-306）

本节保留 v0.1／v0.2 hook 安装与规则基线。v0.3 运行边界先按 8.7 核实：确认彻底退出不检查／不记录为受检；starting 或异常不误当退出；受管 runner 不重复判定，可识别生产直连拦截并引导。生产请求的标准高危与目标明确的解析不明走原审批，凭据等不可审批红线保留；非生产原规则不扩围。

**安装形态。** 在每个有 Claude Code 目标的运行环境中，往 `~/.claude/settings.json` 加入下面这一条（Windows 示例）：

```json
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "Bash",
        "hooks": [ { "type": "command", "command": "'C:/Users/me/.cloudlink/bin/cloudlink-guard.exe' --env 'windows'", "timeout": 10 } ] }
    ]
  }
}
```

WSL 中的 `command` 是同一个 Windows 程序的 `/mnt/c/...` 路径，参数为 `--env wsl:<发行版>`，经 WSL 互操作运行，所以策略和记录只在 Windows 侧有一份。护栏程序按自身所在的位置找到 `policy.json` 和记录目录。互操作被关闭时，该环境的护栏状态为「不可用」。

路径和环境参数使用 POSIX 单引号，内部单引号拼接为 `'\''`；Windows 路径用 `/`，不传 `\\?\` 前缀。路径中的中文、空格、单引号和字面 `$()` 必须保持原义，不得触发命令替换。

策略更新独立于 Skill 编译：即使其他资源的 Lint 阻断发布，当前档位和 Scope 仍须更新；若策略写入失败，健康检查不能把旧策略报告为生效。非列表类 CLI 操作必须提供可核对的已选目标，账号、项目或资源参数不得越过绑定的账号和 Scope。

**判定流程。**

1. 不是 Bash 调用，或者命令里既没有出现 CloudLink 中任何 SSH 服务器的别名/地址，也没有调用已接入云平台的 CLI（`wrangler`、`vercel`、`oci`，v0.3 起加上 `gh` 和 `git push`）：立即退出，不判定、不记录。
2. 解析命令。自写保守的 shell 词法分析，处理引号、转义、`;` `&&` `||` `|` `&`、换行、`$()`、反引号和重定向，从中找出 `ssh`、`scp`、`sftp`、`rsync` 的调用及目标服务器（别名、`user@别名`、地址），以及 `wrangler`、`vercel`、`oci` 的调用。`ssh -G`、`wrangler --version` 这类不涉及远端或状态的调用不算。远端命令按同样的规则再拆成简单命令。
3. 任何档位（全局死线）：
   - SSH：参数指向凭据文件（5.5 第 1 条列出的路径）的命令，以及 `docker inspect`、`env`、`printenv`，一律拦下。
   - 云平台 CLI：导出或打印敏感凭据的命令（如 `vercel env pull`、`vercel env ls` 带明文导出、`wrangler secret` 读取、修改 `~/.oci/config` 或 `oci iam` 密钥导出），一律拦下。
   - GitHub（v0.3，F-110）：`gh repo delete`、`gh secret` 与 `gh variable` 的读取导出、`gh auth token`、强推默认分支（`git push --force` / `-f` / `--force-with-lease` 指向默认分支或未指定分支）一律拦下。
4. 只读巡检档（`read-only`）：
   - SSH：远端命令里的每个简单命令都必须在只读白名单内；不能有输出重定向（重定向到 `/dev/null`，以及 `2>&1` 这类文件描述符复制除外）、`tee`、命令替换、`sudo` 或原地修改参数（如 `sed -i`）。`docker exec <容器> <命令>` 中的命令同样要在白名单内。没有远端命令（交互式登录）、经标准输入传入脚本（`sh -s`、`bash -s`、heredoc）、用 `sh -c` 或 `bash -c` 包装、文件传输（scp、sftp、rsync），都拦下。
   - 云平台 CLI：只放行查询与日志命令（如 `wrangler whoami`、`wrangler tail`、`wrangler deployments list`、`wrangler d1 execute --command "SELECT ..."`、`vercel ls`、`vercel inspect`、`vercel logs`、`vercel whoami`、`oci ... list/get`）；拦截一切发布、修改与删除命令（如 `wrangler deploy/publish/delete`、`vercel deploy/--prod/rm/env add/env rm`、`oci ... create/update/delete/terminate/stop`）。GitHub（v0.3）：只放行 `gh` 的查询命令（`gh repo view/list`、`gh pr list/view/diff/checks`、`gh run list/view`、`gh issue list/view`、`gh api` 的 GET），拦截其他 `gh` 写操作；普通 `git push`、`git commit` 不管。
5. 标准运维档（`standard`）：只拦下高危破坏类别。
   - SSH：删除数据（`docker compose down -v`、`docker volume rm` 和 `prune`、`docker system prune --volumes`、对根目录下前两级目录的 `rm -r`、`mkfs`、`dd of=/dev/…`、`wipefs`、`dropdb`、`redis-cli FLUSHALL` 等）、重启或关闭主机、修改防火墙（`iptables`、`nft`、`ufw`、`firewall-cmd` 的非查询操作）、修改 SSH 配置或 `authorized_keys`、停止或重启 sshd、停止/删除/kill 标为「关键」的服务。
   - 云平台 CLI：拦下删库删站与销毁实例命令（如 `wrangler d1 delete`、`wrangler r2 bucket delete`、`wrangler delete`、`vercel project rm`、`vercel domains rm`、`oci compute instance terminate`、`oci bv volume delete`）。
6. 解析不了的结构：只读资源上拦下；标准运维资源上放行，记录中标注「未能解析」。

**只读白名单**（v0.1 内置，v0.5 起可以自定义）：`uptime`、`nproc`、`free`、`df`、`du`、`ls`、`stat`、`cat`、`head`、`tail`、`less`、`grep`、`wc`（这几个只限非凭据路径）、`ps`、`top -b -n 1`、`ss`、`netstat`、`ip addr` 和 `ip route`（只限查看）、`uname`、`hostname`、`date`、`id`、`whoami`、`lsblk`、`findmnt`、`echo`、`command -v`、`which`、`systemctl` 的 `status`、`is-active`、`list-units`、`--failed`、`journalctl`（不含 `--vacuum`、`--rotate`、`--flush`）、`docker` 的 `ps`、`logs`、`stats --no-stream`、`images`、`version`、`info`、`docker compose` 的 `ps`、`logs`、`config --services`、`nginx -t`、`openssl s_client`、`openssl x509 -noout`、`curl -sI`；以及云 CLI 的只读子命令（`wrangler whoami/tail/deployments list/kv key list/d1 info`、`vercel whoami/ls/list/inspect/logs`、`oci ... get/list`）。巡检清单（5.6）中的每条命令都必须能通过这份白名单，由单元测试保证。

**输出。** 拦下时以退出码 0 输出：

```json
{ "hookSpecificOutput": { "hookEventName": "PreToolUse", "permissionDecision": "deny",
  "permissionDecisionReason": "CloudLink guard: hk-edge is in read-only mode, and `docker restart api` is not an inspection command. Ask the user to switch hk-edge to Standard mode in CloudLink if this change is intended. Do not try to work around this block." } }
```

放行时不输出任何内容，交给 Claude Code 正常的权限流程：护栏只负责拦截，不替用户批准。拦截原因用英文写给 Agent，Claude Code 也会把它显示给用户。

**记录。** 除第 1 步直接退出的情况外，每次判定都向 `~/.cloudlink/guard/log/<日期>.jsonl` 追加一行：时间、运行环境、`session_id`、`cwd`、服务器 id、脱敏后的命令、结果、原因 id。护栏程序内置一份精简的脱敏规则（常见 Token 格式、`password=` 赋值、私钥文件头），CloudLink 读入时再用完整规则集扫描一遍。

**边界与失败处理。**

- 护栏只看命令文本。把命令编码后再执行、先上传脚本再运行、借助其他工具连接服务器，都可能绕过它。界面和 Skill 都如实说明这一点，硬隔离仍要靠低权限 SSH 用户。
- 护栏程序崩溃或超时时，Claude Code 按非阻断错误处理，命令会照常执行（出错即放行）。所以护栏程序只依赖标准库和 serde_json，用不少于 200 条的命令样本集测试，并由健康检查定期自检（F-306 AC5）。
- `policy.json` 缺失或无法解析时，护栏认不出任何服务器，只能放行；自检会报告「护栏未生效」。CloudLink 用原子写入更新策略文件，避免出现写了一半的文件。

### 8.7 执行通道与审批（F-310，v0.3；2026-11-13 定稿）

本节按 D2／D3／D10／D12／D14 取代 2026-11-08 的初步方案。P8c–P8f 实施后才生效，不能因规格已更新而宣称当前 v0.2.0 有此能力。非生产资源保留原路径；**CloudLink 运行中（包括留在托盘），生产 SSH 与 Cloudflare／Vercel／Oracle Cloud／GitHub 的只读、标准两档都经通道**。不撤下托管或用户手动 SSH 别名；Skill 引导，Claude Code hook 拦可识别生产直连并引导，其他凭据／工具的访问不承诺纳管或安全隔离。

#### 8.7.1 独立入口与调用协议

复用已有 console sidecar `cloudlink-guard.exe`，无子命令继续兼容 hook；GUI 可执行文件不承担终端标准流，不要求改 PATH。`cloudlink exec` 是产品简称，Skill 实际写该环境可调用、正确引用的 sidecar 绝对路径：

```text
<runner> exec --env <envId> --asset <assetId> [--tool git] [--timeout <seconds>] -- <command>
<runner> wait --env <envId> <requestId>
<runner> discover --env <envId> --asset <githubAssetId>
<runner> put --env <envId> --asset <serverId> -- <localFile> <remoteFile>
<runner> get --env <envId> --asset <serverId> -- <remoteFile> <localFile>
<runner> status
```

- 用稳定 assetId 路由，名称／别名不是主键；删除后旧入口不因别名复用指向新资源。SSH `--` 后恰好一条远端命令字符串；CLI 保留 argv、不拼 shell，程序由四家 provider 决定。`--tool git` 仅用于 GitHub 已定义高危 git 范围，不是任意本机程序执行器。
- runner 不读 SQLite／原生密码库；桌面维护带版本、所有权、原子写和访问权限的私有路由目录，存资源／环境到 SSH 快照、CLI 程序与默认账号的映射，不存密码或私钥内容。runner 由自身受管 bin 定位数据根，隔离配置缺文件绝不回退真实 HOME。
- Windows 用系统 OpenSSH 绝对路径，SSH 加 `-T`、`BatchMode=yes`、已信任主机校验、别名前 `--`；导入配置仍由用户维护，执行用私有配置／快照，不传 `\\?\` 前缀。WSL 经已核实互操作转指定发行版，关闭互操作或缺路由／CLI／密钥返回具体不可用原因，不用「打开 GUI」代替诊断。
- CLI 查找复用 Login Shell 检测，实际任意请求不拼入 Login Shell；用已解析程序与 argv。Windows npm `.cmd` shim 独立适配并验证引号／元字符，不简单开启 shell 模式。
- 无 TTY，不接受不透明 stdin 脚本。stdout／stderr 有界并流式回传、不默认落盘，子进程退出码透传；CloudLink 自身拒绝／失败另带来源和错误 ID，不仅凭退出码推断护栏拒绝。参数、帧、路径和资源有效性是入口正确性校验，退出后也保留，未知 ID 不能当主机地址。

#### 8.7.2 运行状态与退出边界（D10）

受管 runtime.json 记录协议版本、安装身份、会话 epoch、PID／进程创建标识、临时 loopback 端点与状态：starting → active → stopping → stopped。启动早期先 starting，策略／协调器就绪后才 active；关闭到托盘仍 active。退出先 stopping、取消未启动审批再 stopped，不重写 Skill 或反复安装／卸载用户 hook。

| 可核实状态 | 新调用行为 |
| :--- | :--- |
| active（含托盘） | 按当前策略检查，需要时请求原审批 |
| starting／更新交接 | 短等就绪，超时入口暂未就绪，不当退出跳过检查 |
| stopped 且对应进程确已结束，或旧会话进程确认不存在 | 新请求不做 CloudLink 命令检查／审批，独立转发继续可用，不要求 GUI |
| 进程存活但协调器不可达、身份／状态不能可靠核实 | 运行状态异常，不能一次 IPC 失败即放开，不能自动重发有副作用请求 |

- PID 连同创建标识与安装身份核对，避免 PID 复用；跨安装／隔离实例不互接。没有有效会话记录时，按数据根的实例存活标识确认不存在才视为未运行；记录损坏、标识存在或无权限不是「进程不存在」。hook 与 runner 共用同一平台封装，每次只读一次状态、核对一次进程，不启动 PowerShell 查存活。
- 崩溃后确认进程不存在，新调用按退出处理；原请求不恢复执行。明确退出取消 waiting／approved 但未启动的请求，绝不等于允许全部，不在重启后自动执行。正常退出不杀已启动独立命令；桌面测试／探测仍按旧 cancel_all_jobs 规则，不能承诺远端副作用回滚。
- 退出后新调用不伪称经过 CloudLink 检查、不伪造审批／审计成功；运行中开始的独立请求可以补完自身结果。Skill 与 UI 明确退出后检查停止、仍受 Agent／远端凭据权限与建议性红线约束；不追溯拦截退出期间已完成操作。

#### 8.7.3 判定矩阵与 hook 分工

以下只在应用运行中生效：

| 请求 | 只读巡检 | 标准运维 |
| :--- | :--- | :--- |
| 已支持、目标明确的查询 | 通过 | 通过 |
| 普通写操作 | 拒绝，需切档 | 通过 |
| 可判定高危操作 | 拒绝，不可用审批绕过只读 | 原允许一次／拒绝审批 |
| 不可放行红线（凭据导出等） | 拒绝，无允许一次 | 拒绝，无允许一次 |
| 资源／身份／目标不能可靠确定 | 拒绝并给操作说明 | 拒绝，不默认为安全 |
| 目标明确但命令结构解析不了（D14） | 拒绝，提示拆简单查询 | 原允许一次／拒绝，显示完整命令 |

- 查询样本必须覆盖真实常用管道、docker exec、journalctl、kubectl get 等，不能靠全拒绝凑漏放行 0；复杂包装、nohup 也按真实内容检查。非生产旧 hook 的标准不明放行行为保留，不扩成所有命令被保护。
- 受管 runner 按 bin 规范化绝对路径及 WSL 对应路径识别，其 exec／wait／put／get 由 hook 直接放行、不重复判定／记录；同文件名不算。hook 按已记录别名／地址识别生产 ssh／scp／sftp 等直连并引导，识别不到的用户自有别名／地址／工具不保证拦截。
- 运行中结束 CloudLink 进程或改写／删除 runtime.json、policy.json、路由目录列为不可审批红线，防意外自关检查，不包装成同 OS 用户安全边界。GitHub 按具体子命令、参数、有效身份、稳定仓库／owner／范围判定，HTTP GET 不天然只读安全，secret 元数据与值分开；删除仓库、凭据导出、默认分支或未指定分支强推保留不可审批红线，普通 push／commit 不扩纳管。

#### 8.7.4 审批协调、两段等待与最多一次启动

协调器仅绑定 `127.0.0.1:0`，每次启动独立会话身份，与密码 broker 能力／token 命名空间隔离。帧带版本、长度上限、短连接超时、断开／取消检测；CLI 只能提交、查自己的请求、取消，允许／拒绝只经 Tauri GUI 命令。`--approved`、自报用户同意、可修改本地 JSON 都不算批准。

```text
submitted → denied
          → waiting → rejected / expired / cancelled
                    → approved → dispatching → running → succeeded / failed / unknown
```

- 快照绑定 requestId、epoch、assetId、环境、调用种类、已解析目标身份、命令／argv、cwd、输入文件摘要、策略 revision、创建／到期时间。品牌与会话标签注明可信来源，自报品牌不作授权依据。原命令只留所需内存，持久化仅脱敏审计，不落盘待重放命令。
- 创建起 5 分钟到期。exec 最多内联等约 90 秒；未答复以专用 waiting 状态返回 requestId，不当失败／拒绝，Agent 用 wait 继续。wait 仍未答复再返回等待；批准由内联等待／带同 requestId 的 wait 消费并执行、回传输出，不由 GUI 代跑。单次调用结束／超时不取消队列，到期或明确取消才使未启动请求作废；Skill 写明不要换途径重发。
- 许可只消费一次，重复点击／传输／迟到答复不能第二次启动。消费前复核资源、环境、身份、输入摘要与策略 revision；切只读、撤回、停用、换账号、改命令或文件使未启动许可失效，不能默默扩大原批准。
- 子进程创建成功才算启动；启动失败与远端非零分开。断线／超时不能确认远端结果为 unknown，不自动重跑，不承诺跨崩溃 exactly-once。事件比较 epoch／revision，晚到 waiting 不覆盖取消或完成。
- UI 保持 D12 原卡片：审批优先于笔记；批准未取显示「已允许，等 Agent 继续」，到期未取「已过期，未执行」。允许不是成功，副作用不可撤销。通知只定位、不批准、不泄漏命令。

#### 8.7.5 传输、长任务与更新交接

- put／get 只支持单文件、只写不存在新路径、不递归通配、不恢复断点、不附带覆盖／删除，使用系统 OpenSSH SFTP batch；路径空格／glob 分别引用转义，禁控制字符／批处理注入，失败停止。
- 下载本地排他新建，不跟随 symlink／reparse point；上传先核对远端目标不存在，检查与写入有极短竞态窗口，如实说明防手滑而非排他安全发布。只清理本次创建未完成文件，不清用户目录。上传是写操作，下载仍查凭据路径／范围；替换已有内容须单独明确命令接受判定。
- 上传审批绑定输入摘要，执行前变更则失效；数据流不写 Skill／记录。foreground 默认 90 秒，可显式至 3600 秒，连接仍短超时；长任务 Agent 自行后台启动加轮询或同时提高自身调用超时，不新增桌面任务管理器，包装不能跳过检查。
- 超时／断线终止本地进程，不承诺远端工作已停，不能确定则 unknown，不自动重试。stdout／stderr 与持久审计分离，原始输出不默认落盘。
- 更新受管 sidecar 先把占用旧 exe 改名再原子写新版，失败保留旧版并报告，不留半文件；旧文件下次无占用清理。协调器兼容上一协议版本，已运行旧请求按原协议收束；更新交接不能误判为停止检查或重放旧请求。

#### 8.7.6 契约、迁移与并发收敛

- GitHub 专属配置存 host、稳定 owner ID／login／类型、auto／manual、手选／排除 stable repo IDs、分环境有效身份与 complete／partial／offline／denied 快照，其他三家 CLI 账号模型不强改。同 host／owner 唯一；旧手选迁 manual，多 owner 可核实拆分并保留原档位／选择，无法核实留待确认，不猜不丢。repo 重命名排除不失效，转出所选 owner 不继续纳入。
- GitHub getGithubScope／saveGithubScope 携 expectedRevision；执行 listExecutionRequests／respondExecution（allow-once／deny、expectedRevision）／cancelExecution／getRuntimeStatus 及 execution://changed／runtime://changed 统一由 Rust、ts-rs、ipc.ts／events.ts、Mock、store、copy.ts 登记。敏感原命令不作为可重放持久 IPC 数据。
- Operation 保留 allowed／denied 兼容，增来源、是否检查、执行状态、requestId、退出码／耗时等可选字段；旧 hook 没退出码只显示已放行，不能推断成功。连接诊断可选字段按 8.3 白名单，不改 PasswordTargetChanged 或单测禁用 OS 凭据库。
- 档位／范围 revision 单调，策略／路由更新独立于 Skill Lint；收窄先收紧策略、撤回暴露旧授权的受管副本，不能以旧 Skill 成功快照掩盖运行策略失效。每真实目录串行发布，迟到探测／刷新／同步／审批比较资源 revision 与 epoch，删除／重置后不能恢复旧资源、授权或待执行请求。
- 历史显示名称疑似由地址生成，只提出修正建议并由用户确认，不批量改名／别名或用户 SSH 配置。旧别名含地址不冒充匿名导出，必要时内部引用由稳定 ID 派生并用私有路由保留映射；禁止导出地址仍出现在显示名称时要求修正，不关闭隐私检查。数据库迁移取当时最新 schema_version 下一版。

---

## 九、非功能需求

| 类别 | 要求 |
| :--- | :--- |
| 性能 | 冷启动不超过 1.5 秒（中端笔记本）；20 台服务器的总 Skill 编译 p95 不超过 200ms；同步全部副本 p95 不超过 1 秒；检查全部分发不超过 1 秒；测试连接（网络正常时）在 3 秒内返回；护栏判定 p95 在 Windows 原生环境不超过 50ms，经 WSL 互操作不超过 300ms；首屏 JS 压缩后不超过 600KB（实测全量冒烟页面约 487KB gzip），预览面板用 `React.lazy` 拆分，streamdown 和 Shiki 的语言包按需加载 |
| 可靠性 | SQLite 使用 WAL 模式；所有文件写入都是原子的；进程崩溃不留下半个产物 |
| 隐私 | 零遥测；除测试连接与 SSH 探测、云平台 CLI 检测（由本机 CLI 发起）和检查更新（默认开启、可关闭，只请求 GitHub Releases 上的版本清单）外不联网；日志中不记录原始探测输出、密码和解析后的连接信息；操作记录和 Agent 笔记只存在本机，操作记录写入前脱敏，保留 30 天 |
| 兼容性 | v0.1：Windows 10 21H2+ 和 Windows 11（WebView2），以及 WSL2。v0.5：macOS 13+。v1.0：Ubuntu 22.04+（WebKitGTK 4.1） |
| 国际化 | v0.1 界面只有简体中文，全部界面文案集中放在 `src/lib/copy.ts`，便于以后国际化。编译产物默认英文（F-207） |
| 可访问性 | WCAG 2.2 AA，见 6.12 |
| 可维护性 | 数据库带 `schema_version` 并支持迁移；模板版本号写入所有权标记，便于判断产物由哪个模板生成 |
| 更新 | Tauri updater，只在 Rust 侧调用（F-406）；安装包用发布者私钥签名，内置公钥校验不通过就拒绝安装；检查默认开启，可在设置中关闭。Windows 只发 NSIS 安装包，按当前用户安装、不需要管理员权限；更新以 passive 模式完成并自动重新打开应用 |

---

## 十、版本路线图

| 版本 | 里程碑 | 交付内容 | 平台 |
| :--- | :--- | :--- | :--- |
| v0.1（MVP） | 跑通「录入、测试连接、探测、编译、分发给 Agent」的闭环，并让 Agent 在护栏内干活 | F-101 到 108（含 F-104 云平台 CLI）；F-201 到 205；F-207（默认英文输出）；F-301 到 308；F-401、402、403、405、406（检测更新） | Windows 10/11（原生 + WSL2） |
| v0.2 | 体验与界面重设计（v4） | 第六章全部；F-109 生产环境开关；F-110 GitHub 接入（数据模型、检测与范围）；F-102 排除代码托管主机；F-309 自动同步与备份撤销；F-407 系统托盘；F-408 导航位置切换 | Windows 10/11 |
| v0.2.x（P8a／b） | 独立修复批次 | 父级 links／共用目录／WSL 分发、真实送达反馈、中性默认名称与稳定别名、原生标题栏、当前页资料／连接弹窗、空状态 | Windows 10/11 |
| v0.3（P8c–f） | 执行通道与命令审批 | F-310（生产两档、两段等待、D10 退出边界）；F-110 owner／auto／manual／关系／规则；原审批与 SSH 诊断 | Windows 10/11 |
| v0.5 | 多类资产与更多 Agent | F-104（Domain、Panel、Storage）；F-207 输出语言切换；F-404 JSON 导入导出；Cursor、Gemini CLI、GitHub Copilot、OpenCode 作为独立目标；护栏的只读白名单和危险命令可以自定义 | 增加 macOS |
| v1.0 | 硬隔离辅助与生态扩展 | 加密备份；生成低权限 SSH 用户的辅助脚本；其他 Agent 提供同类 hook 时接入护栏；Cloudflare DNS 只读同步 | 增加 Linux |

---

## 十一、已决事项与待决问题

### 11.1 已决事项（决策日志）

| 日期 | 决策 | 影响范围 |
| :--- | :--- | :--- |
| 2026-10-27 | 交付形式：先完成评审、修订 PRD 和设计规范，再按执行计划实施 | 全部文档 |
| 2026-10-27 | 桌面容器用 Tauri v2；前端从 Vue 3 改为 React 19 | 第七、八章 |
| 2026-10-27 | 资产页采用多栏工作区（列表、编辑器、预览）。**v3 已替换**为卡片列表加详情面板 | 6.4 |
| 2026-10-27 | 产品名称定为 **CloudLink** | 全部文档；数据目录 `~/.cloudlink/`；所有权标记文件 `.cloudlink.json` |
| 2026-10-27 | 编译产物默认使用**英文** | F-207、5.2、5.5 |
| 2026-10-27 | **先做 Windows**（原生 + WSL2）；macOS 放到 v0.5，Linux 放到 v1.0 | 头部表格、第九、十章 |
| 2026-10-27 | 允许把生产资产挂到全局目标，但必须二次确认，并且常驻提示。**v3 已替换**：只有全局目标，安全提示改为生产服务器默认只读、切到标准运维需确认 | F-202 AC2 |
| 2026-10-27 | 接受视觉方向「钢与信号」（Mist 冷钢、钢墨主按钮、Signal Cyan） | DESIGN.md |
| 2026-10-27 | 用户画像确认无误 | 1.2、PRODUCT.md |
| 2026-10-30 | **取消项目级挂载**，只分发到 Agent 全局目录；删除看板、矩阵、Agent 视角、添加项目、`.git/info/exclude`、全局与项目档位冲突规则 | 第三、四、六章 |
| 2026-10-30 | 档位改为服务器属性，所有 Agent 共用；每台服务器一个「分发给 Agent」开关 | 3.3、F-202、F-303 |
| 2026-10-30 | 导航改为「服务器 / Agent / 设置」，界面参考 Termius：卡片列表加右侧详情分段；取消 Skills 视图，活动并入设置；术语「资产→服务器」「挂载→分发」 | 第六章 |
| 2026-10-30 | 服务器信息在界面里录入，测试连接通过后才能分发；保存是显式的 | F-106、6.5 |
| 2026-10-30 | 录入的连接写进 CloudLink 托管的 `~/.ssh/cloudlink.conf`，经同意后在用户 `~/.ssh/config` 开头加 Include；Agent 照常用 `ssh <别名>` | F-107 |
| 2026-10-30 | 认证支持私钥、ssh-agent 和密码。密码存系统凭据库，只供 CloudLink 使用；只用密码的服务器不能分发，提供「改用密钥登录」 | F-108 |
| 2026-10-31 | 全部服务器编译成一个总 Skill（`cloudlink-servers`），每台服务器的详情放进参考文件；新增全局内容「服务器之间的关系」「运维约定」和内置巡检清单。取代「每台服务器一个 Skill」和 v0.5 的业务包 | F-201、第五章、6.6 |
| 2026-10-31 | 护栏从 v1.0 提前到 v0.1：Claude Code 的 `PreToolUse` hook 按档位拦截 ssh 命令，并记录 Agent 执行过的命令；需要改东西时临时解锁 30 分钟 | F-306、F-307、8.6 |
| 2026-10-31 | Agent 可以把学到的东西写进笔记收件箱，用户确认后并入服务器信息 | F-308 |
| 2026-10-31 | 分发一律用受管复制，不再使用符号链接和 Junction | F-304、8.2 |
| 2026-10-31 | v0.1 只支持 Claude Code 和读取 `~/.agents/skills` 的 Agent，其他 Agent 用自定义目录 | 4.5 |
| 2026-10-31 | 去掉三层 Token 估算、业务包和自定义模板；探测结果自动合并、可以撤销，疑似注入的值仍要确认 | F-103、F-204、第十章 |
| 2026-10-31 | P3.5 开工前补齐契约：`Environment.sshAgentKeys`、`deleteAsset` 的 `removeGeneratedKey`、`GuardStatus.planned` 与 `deniedToday`、`CompileStatus.lint`、新命令 `copyKeyToWsl`。「复制到 WSL」由 CloudLink 在用户确认后执行，原则 1 增加这一例外。未列入的服务器预览时按「已列入」计算并注明原因。别名由名称中的英文字母和数字生成，取不到时用地址 | 第二章原则 1、3.4、F-108、F-204、6.5、7.8 |
| 2026-11-01 | 服务器卡片上直接点选分发给哪些 Agent（参考 CC Switch），按 Agent 计、不分运行环境；每个「运行环境 × Agent」编译一份总 Skill，只含选给这个 Agent 的服务器。契约：`AssetAgent.distribute` 改为 `agents`，Target、Inclusion、CompileStatus、CompilePreview、PreviewRequest 增加 `agentKey`，`setDistribute` 增加 `agentKey`。按钮用 Agent 的品牌 Logo（同 CC Switch），为此新增依赖 `@lobehub/icons-static-svg` 和 `agent-claude`、`agent-openai` 两个颜色令牌，作为 DESIGN.md「不用品牌 Logo、不新增颜色」的唯一例外 | 3.1、3.3、3.4、3.5、F-201、F-204、F-302、F-303、6.4、6.6、7.8 |
| 2026-11-02 | **前端配电盘式彻底减负与云平台 CLI 扩展（v3.1）**：① 首屏改为单栏全宽「服务器 (SSH) + 云平台 (CLI)」回路列表，每行右侧直接放档位切换器与 Agent 开关，未选中时隐藏右侧面板；② 详情面板砍掉 8 层折叠手风琴，改为常驻控制头 + 3 个平铺 Tab（`画像与规则`、`连接配置`、`动态`），遵循「正常即隐身」；③ **取消「临时解锁 30 分钟」**（删除 `unlockedUntil`、`unlockServer`、`lockServer` 及倒计时徽章），生产环境处于「标准运维」时在回路行琥珀色高亮提醒；④ 新建 SSH 服务器支持密码自动转免密密钥并启用一步到位；⑤ 新增云平台 CLI 资源（Cloudflare `wrangler`、Vercel `vercel`、Oracle Cloud `oci`），按已启用 Agent 所在环境精准检测 CLI 路径与 `whoami` 登录态（切回窗口自动刷新）、圈定 Scope 范围、关联 SSH 服务器，护栏同步拦截云 CLI 写操作与凭据导出命令（如 `vercel env pull`）；⑥ 所有云平台与 Agent 一律使用官方品牌 SVG Logo（`ProviderMark`、`AgentMark`） | 全部文档 |
| 2026-11-05 | **应用图标定为「交汇 · 浅色」**：白色圆角底板（发丝线描边）上，钢墨色的圆角方块（服务器与云平台）和圆（Agent）相叠，交集是信号青，交集四周留一圈缝代表护栏。源文件为 `docs/brand/cloudlink-icon.svg`，规格见 DESIGN.md「App Icon」；P6 生成整套应用图标 | DESIGN.md、PRODUCT.md、11.2 Q2、P6 |
| 2026-11-07 | **试用反馈修订**：① 添加服务器的连接过程向 Termius 看齐，逐步显示、指纹就地核对；确认指纹后立即写入 `known_hosts`，`known_hosts` 已有同一把公钥时直接沿用；连接前预检私钥，Windows 上权限过宽的私钥可一键复制成只有当前用户能读的副本（原则 1 增加这一例外）；② Agent 目标改为按目录维护：通用目录列出读取它的 17 个 Agent，另外检测只认自己目录的 Trae、Trae CN、Kiro、Continue；不写 `~/.codex/skills`；自定义目录不再提供品牌预设；③ 资源关系由 CloudLink 自动整理（跳板机、同一台主机、域名解析、承载的站点、云主机实例），用户可以隐藏、改写或补充，取代一大块文本框；契约 `SkillConfig.relationships` 改为 `relationNotes` + `hiddenRelations`，新增 `listRelations`、`checkKey`、`copyKeyToSshDir`、`Environment.agents`；④ Agent 页合并为「Agent 与目录」「写进 Skill 的内容」两段，护栏并入 Claude Code 那一行；⑤ 回路行加常驻的「编辑」与「⋯」按钮；⑥ 首次启动空状态改为和配电盘同一套分组行 | 第二章原则 1、3.3、4.5、F-106、F-108、F-201、6.4 至 6.6、6.8、7.8 |
| 2026-11-05 | **新增 F-406 检测更新**：检查默认开启、可在设置中关闭，原则 7 和第九章隐私条款随之修改（取代「更新检查需要用户主动开启」）；只有发现新版本时才在顶栏出现提醒；Tauri updater 只在 Rust 侧调用，数据源是 GitHub Releases 的 `latest.json`，安装包签名；Windows 只发 NSIS 当前用户安装包。P6 实施 | 第二章原则 7、F-402、F-406、6.2、6.7、6.9 至 6.11、6.13、7.1、7.3、7.4、7.8、7.10、8.1、8.5、第九、十章 |
| 2026-11-08 | **体验与界面重设计（v4，对标 CC Switch 与 magpie）**，经逐轮问答确认、可点击原型定稿：① CloudLink 继续只管服务器与云平台这一份 Skill，不做通用 Skills 管理；② 视觉改为 magpie 式「安静钢面」，保留 Signal Cyan 为唯一强调色，并扩展到点亮的 Agent 图标、待处理圆点和链接（DESIGN.md The Signal Four Rule）；③ 首页一行一项资源、两行文字、正常即隐身，档位是状态行里可点的文字，右侧 Agent 图标组按目录计、Windows 与 WSL 合并、只显示已启用目标；④ 一级导航改为资源 / Agent / 动态 / 设置，默认顶栏、可手动切换侧栏，窗口 1000×680；⑤ 详情去掉 Tab，改为全宽分组设置式列表；⑥ 添加入口合并为一个「+」加类型选择；⑦ 分发全自动，被改动的副本先备份再覆盖并可撤销，同名冲突一键「备份并接管」；⑧ Agent 页改为一行一个目标；⑨ 首次使用只做空状态；⑩ 环境标记简化为「生产环境」开关；⑪ 新增系统托盘（快速切档位、全部切回只读）；⑫ GitHub 作为云平台（`gh`）接入，仓库关系自动推断，护栏管 `gh` 写操作与高危 git；⑬ ssh config 导入排除代码托管主机（修复把 `Host github.com` 当成服务器的问题）；⑭ Agent 连服务器按档位分流：生产 + 标准运维走执行通道并支持审批，v0.3 实施。第七章的组件映射与令牌落地在 P7 按 DESIGN.md 重新校准 | 全部文档；第六章；3.3；F-102、F-105、F-109、F-110、F-305、F-309、F-310、F-407、F-408；8.6、8.7；第十章 |
| 2026-11-09 | **界面审查修订**：① 顶栏改为三列网格，修复更新按钮在 880–950px 宽时盖住「设置」的问题；② 应用更新改为 magpie 式：发现新版本后在后台下载并校验，下好才在顶栏出现只写「更新」的按钮，对话框主按钮「重启以更新」，下载进度只在设置里显示，去掉「取消下载」和 `cancelUpdate`，设置开关改名「自动下载更新」（F-406、6.15）；③ 动态页「等你确认」默认展开 2 条；④ 详情页「未列入」问题行改为标题（「WSL Ubuntu-24.04 里的 Claude Code 还用不了这台服务器」）+ 原因两行；⑤ Agent 页同名冲突的副行写明「还没同步」；⑥ 深色主题开关打开时用信号青（按 DESIGN.md） |
| 2026-11-10 | **界面审查第三轮**（空状态、详情下半部分、云平台详情、导入、预览、命令面板、托盘）：① 空状态上下居中，「检测到」列 Agent 品牌不列目录，导航不显示「资源 0」（6.9）；② 服务器详情拆出「服务与目录」组，「重新探测」移到这组；服务表由 9 列压成 6 列，760 宽不再横向滚动（原来「关键」开关藏在滚动后面）；说明文字只讲对 Agent 的效果；「监听端口」标题不再重复；最近动态去掉行尾的工作目录名、改用相对时间（6.4）；③ 云平台状态行只写整体，「运行环境」组不再重复「重新检测」（6.4）；④ 预览的文件改为下拉（F-204）；检查结果文案去掉重复的行号；⑤ 命令面板只在打开资源时显示针对它的命令并写出标识，「添加云平台 CLI：GitHub」改为「添加 GitHub」；⑥ 托盘按服务器、云平台分组排序，档位右对齐，生产 + 标准运维加琥珀圆点图标；「全部切回只读」改名「生产资源全部切回只读」（F-109、F-407、6.10） |
| 2026-11-10 | **界面审查第四轮**（设置、Agent 页细节、添加 SSH 服务器、连接过程、编辑连接、云平台向导、探测面板），先改可点击原型、确认后同步文档，应用改动见执行计划 P7d：① 添加表单去掉底部固定的「连接成功后授权给」「默认档位」，新资源从只读巡检开始并同步给全部已启用目标；先选中「密码」；别名露在名称下方、可直接改（F-106、6.5）；② 加入 Include 的同意从叠加的对话框改为连接过程里的一步，只问一次，可以「暂不加入」（F-107、6.5）；③ 添加成功后新行高亮并出提示条（原来两样都没有）；④ 设置页收成四组 + 折叠的「高级」，SSH 配置正常时一行、出问题才展开，去掉「v0.5 提供」占位行，重置的说明如实写会删什么，「移除全部分发」改名「停止全部同步」（6.8）；⑤ 活动日志只记 CloudLink 自己的事，Agent 的命令只在动态页；筛选改成两个下拉（F-307、F-402、6.7、6.8）；⑥ 护栏规则数「拦截 9 类」，规则页放行清单默认收起，命令示例用小圆角方块、整条换行（6.6）；⑦ 详情页「更多信息」和「服务与目录」一律默认收起（6.4）；⑧ 文案不讲实现的词表补充（6.13） | F-106、F-107、F-307、F-402、6.3 至 6.8、6.13、6.15、DESIGN.md、执行计划 P7d |
| 2026-11-13 | **P8 D1–D16 定稿并获开工授权**：① P8a／b 先交付 v0.2.x 的父级链接／共用目录／真实送达与无地址中性命名、原生标题栏、同页编辑弹窗、空状态示例；② 同环境真实目录一份分发、开关一起生效，首次不一致用交集，WSL 链到 Windows 只由 Windows 写；③ 详情资料统一草稿保存，标题快捷改名不影响别名／验证，别名稳定并收高级；④ P8c–f v0.3 GitHub owner 与 identity 分离、auto／排除／manual、旧范围不扩；⑤ 运行中含托盘，生产 SSH／四家 CLI 两档走独立通道，保留直连别名；⑥ 彻底退出 Skill／入口可用但检查停止，状态异常不当退出、旧审批不获批或重启续跑；⑦ 原审批卡片，标准解析不明允许一次／拒绝，exec90秒＋wait接续，创建起5分钟过期、许可最多一次启动；⑧ 私钥只复制受保护副本，原文件风险仍需处理 | F-106、F-110、F-303、F-310、第六、七、8.2、8.3、8.7 章；PRODUCT.md、DESIGN.md、执行计划 P8 |

### 11.2 待决问题

| 编号 | 问题 | 建议 |
| :--- | :--- | :--- |
| Q1 | CloudLink 的商标风险 | Dell（数据加密）、Mitel（通信）、Genetec（视频设备）、Texada（SaaS）都有叫 CloudLink 的产品，但都不在 AI 或开发者工具领域。正式发布前要做一次商标检索；npm 包名、域名、Tauri identifier 也要一并确认 |
| Q2 | 应用自身 Logo | **已决（2026-11-05）**：选定「交汇 · 浅色」，见 11.1 和 DESIGN.md「App Icon」。应用图标只用于安装包、任务栏、开始菜单和窗口标题栏，界面内的顶栏仍只显示文字 `CloudLink` |
| Q3 | 是否需要团队共享 | 当前定位是个人工具，v1.0 之后再评估 |
| Q4 | 服务器监控（类似探针，查看各服务器的使用情况） | 2026-10-30 讨论后搁置，不进 v0.1。v3 的巡检清单（5.6）让 Agent 按需检查服务器状况，覆盖了一部分需求 |

---

## 附录 A：术语表

| 术语 | 含义 |
| :--- | :--- |
| 资源 | 被描述并交给 Agent 操作的基础设施单元（数据模型中叫 Asset），分为「服务器（SSH）」与「云平台（CLI）」两类 |
| 服务器（SSH） | 通过系统 OpenSSH 连接的 Linux 主机（`type: "vps"`） |
| 云平台（CLI） | 通过官方 CLI（`wrangler`、`vercel`、`oci`）操作的云厂商账号资源（`type: "cli"`） |
| 范围（Scope） | 云平台账号下勾选允许公开给 Agent 的域名、Worker、前端项目或计算实例子集 |
| Skill | 符合 Agent Skills 规范的目录，包含 `SKILL.md` 和可选的 `references/` |
| 总 Skill | CloudLink 编译出的唯一一个 Skill `cloudlink-servers`，每个「运行环境 × Agent」一份，只含分发给这个 Agent 的资源 |
| 列入 | 一项资源出现在某个运行环境的总 Skill 中 |
| Agent 目标 | 某个运行环境中某个 Agent 的全局 skills 目录 |
| 分发 | 把总 Skill 以受管副本写进 Agent 目标 |
| 托管 ssh 配置 | CloudLink 生成并维护的 `~/.ssh/cloudlink.conf`，经 Include 生效 |
| 连接与环境验证 | SSH 服务器最近一次测试连接或探测成功，或云平台 CLI 已安装且已登录；未验证的资源不能分发给 Agent |
| 档位 | 只读巡检或标准运维，资源的属性，可在主列表回路行直接切换（不再设 30 分钟临时解锁）；在 Claude Code 上由护栏执行 |
| 红线 | 写给 Agent 的禁止或约束条目，属于建议性约束 |
| 护栏 | 安装在 Claude Code 中、按档位拦截 `ssh` 与云 CLI 命令的 hook |
| 操作记录 | 护栏判定过的命令清单 |
| Agent 笔记 | Agent 写进收件箱、等用户确认后并入资源信息的条目 |

## 附录 B：相对 v1 的主要变更

详见 `docs/PRD-review.md`。摘要：

1. 档位改为按挂载选择，并编译成独立的变体目录。
2. 红线如实标注为建议性约束，补充了内置的凭据防护红线。
3. Agent 目录按 2026-10 的生态更新，项目级挂载改为 `.claude` 和 `.agents` 两个约定目录。
4. Windows 原生环境默认改为受管复制（Junction 降为实验选项）；全局和项目挂载同一个 Skill 且档位不同时，直接阻止。
5. 删除「全局汇总清单」模式。
6. 新增运行环境、目标、挂载三个数据模型，以及所有权规则。
7. 探测数据按不可信输入处理（防提示词注入）。
8. 前端从 Vue 3 改为 React 19，并给出依赖白名单。
9. UI 从「卡片网格 + 抽屉」改为多栏工作区；挂载中心同时提供看板和矩阵，并加入 Agent 视角。

> 附录 B 记录的是 v2 相对 v1 的变化，其中第 1、3、4、5、6、9 条中关于挂载、变体、项目约定目录、链接方式、汇总清单和 Agent 视角的部分已被 v3 / v3.1 取代，见附录 C。

## 附录 C：v3 / v3.1 相对 v2 的主要变更（2026-10-30 至 11-02）

1. 取消项目级挂载：只分发到 Agent 的全局 skills 目录。删除项目目标、`.git/info/exclude`、全局与项目档位冲突规则、Agent 视角。
2. 档位从「每个挂载一个」改为「每项资源一个」。安全提示改为「生产资源默认只读，切到标准运维需确认并在行内琥珀色高亮提醒」。
3. 每项资源直接点选分发给哪些 Agent（2026-11-01，参考 CC Switch）：总 Skill 按「运行环境 × Agent」各编译一份，产物目录为 `compiled/<运行环境>/<Agent>/cloudlink-servers`。
4. 服务器信息可以在界面里录入（地址、端口、用户、认证），写入托管 ssh 配置（F-107）。2026-11-02 升级为「连接并启用」一步到位：填密码后自动验证连接、生成 ed25519 免密密钥并安装公钥。
5. 全部资源编译成一个总 Skill（2026-10-31）：`SKILL.md` 是总览，每项资源的详情放进参考文件，另有基础设施关系、运维约定和巡检清单。
6. 护栏与操作记录：Claude Code 的 `PreToolUse` hook 按档位拦截 `ssh` 及云平台 CLI 命令并记录下来。**2026-11-02 取消「临时解锁 30 分钟」**，改为在主列表回路行直接一键切换档位。
7. Agent 笔记（2026-10-31）：Agent 把学到的东西写进收件箱，用户确认后并入资源信息。
8. 分发一律用受管复制；v0.1 只支持 Claude Code 和读取 `~/.agents/skills` 的 Agent。
9. **前端「钢制配电盘」减负改版与云平台 CLI 接入（2026-11-02，v3.1）**：
   - 首屏取消常驻左右分栏与多列卡片网格，改为单列对齐的「服务器 (SSH) + 云平台 (CLI)」双闸刀回路行；右侧检视面板按需无遮罩平推展开。
   - 详情面板取消 8 层折叠手风琴，改为「常驻控制头 + 3 个平铺 Tab（画像与规则 / 连接配置 / 动态）」，底层列入与环境矩阵正常时完全隐身。
   - 新增 Cloudflare（`wrangler`）、Vercel（`vercel`）、Oracle Cloud（`oci`）三类云平台 CLI 资源，支持精准运行环境检测、范围圈定（Scope）与服务器自动关联。
   - 侧栏底部移除常驻环境状态列表；Agent 与云平台一律采用官方品牌 SVG Logo。
