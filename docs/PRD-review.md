# PRD 评审报告：CloudSkill Hub（v1 草案）

> 产品已于 2026-10-27 更名为 **CloudLink**。本报告记录的是对 v1 草案的评审；全部修订已并入 `docs/PRD.md`（v2.1），用户的六项决策见其 11.1 节。

> 评审对象：`docs/archive/prd-v1.md`（原 `prd.md`，内容未改动）
> 评审日期：2026-10-27
> 修订产物：`docs/PRD.md`（修订版 PRD）、`DESIGN.md`（视觉系统）、`PRODUCT.md`（产品上下文）、`docs/EXECUTION-PLAN.md`（执行计划）
> 方法：逐条核对内部一致性、技术可行性和安全承诺，再把关键技术事实对照 2026-10 的官方文档、npm 和 crates.io 核实一遍。

## 结论

**方向成立，但 v1 还不能交给开发。** 「云资产上下文 → 编译成 Skill → 按项目挂载」这条主线的定位很清楚，也确实打中了 CLI Agent 用户的真实痛点。问题集中在三处：

1. **架构层面有两处自相矛盾。** 一是档位按挂载选择，但软链接两头指向同一份产物（R-01）。二是「全局汇总清单」模式，正好重新制造了痛点 3（R-06）。
2. **安全承诺落不了地。** 红线被写成「强约束」，实际只是提示词。只读档还放行了 `cat`，等于允许 Agent 把 `.env` 读进模型上下文（R-02）。软件也没有定义「哪些东西归自己管」，卸载时可能误删用户手写的 Skill（R-07）。
3. **对外部生态的假设已经过时。** Codex 的 Skill 目录、项目级约定目录都变了（R-03）；Windows 与 WSL 之间的别名解析和链接创建也没有设计（R-05）；v1 在 Windows 上首选的 Junction，在 Claude Code 中有已知的发现问题（R-24）。

全部问题共 32 条：阻断级 7 条，严重级 17 条，一般级 8 条。每条的修订都已经写进 `docs/PRD.md`，下表的「v2 位置」列给出对应章节。

---

## 一、问题清单

严重度的含义：

- **阻断**：不修就会导致核心功能不可用，或者违背产品自己的安全承诺。
- **严重**：会造成返工，或者会让开发者理解出现分歧。
- **一般**：属于完整性和表达上的问题。

### 1.1 阻断级

| 编号 | v1 位置 | 问题 | 影响 | v2 位置 |
| :--- | :--- | :--- | :--- | :--- |
| R-01 | F-202、第五章第 2 节、原则 3 | 档位（只读 / 标准）可以「按挂载」选择，但每个 Skill 只编译出一份产物，所有链接都指向它 | 同一个 Skill 不可能对 A 项目只读、对 B 项目标准。功能做不出来，或者只能每个目标各复制一份，又破坏了单一数据源 | 3.5、F-202、F-303 |
| R-02 | 原则 1、F-202 | 红线只是写在提示词里，却被描述为「强约束」。只读档的白名单里包含 `cat` | 用户产生了虚假的安全感。Agent 可以 `cat .env` 或者读私钥，把凭据直接送进模型上下文，与原则 1 正面冲突 | 原则 3、5.5、F-202 |
| R-03 | 头部表格、F-301、F-303 | Codex 的目录写成 `~/.codex/skills`；项目级只写 `.claude/skills` | Codex 从 v0.94 和 v0.95 起改用 `.agents/skills` 和 `~/.agents/skills`，`~/.codex/skills` 已标为废弃。`.agents/skills` 已经是 Codex、Cursor、Gemini CLI、Copilot、OpenCode 共用的项目级约定，而 Claude Code 至今仍不读它（#31005）。照 v1 实现，除 Claude Code 外的 Agent 都看不到挂载的 Skill | 4.5、F-302 |
| R-04 | F-302、F-303 | 往项目仓库里创建链接，但没有处理 Git | 链接指向用户主目录下的绝对路径。一旦被提交，队友那边是坏链接，同时还把本机的用户名和目录结构泄露了出去 | F-302（自动写入 `.git/info/exclude`） |
| R-05 | F-102、F-301、F-304 | 没有「运行环境」的概念。Windows 和 WSL 各有一份 ssh config | 从 Windows 导入的别名，在 WSL 里跑的 Agent 可能根本解析不了，Agent 一执行命令就失败。另外，Windows 也无法在 `\\wsl$` 路径下创建 Linux 符号链接 | 3.4、F-307、8.2 |
| R-06 | F-201 | 「把所有 VPS 汇总为一份全局清单」的模式 | 等于重新制造了痛点 3（全局污染与串台），和产品存在的理由自相矛盾 | F-201（删除该模式） |
| R-07 | F-303、F-304 | 没有定义所有权和冲突处理 | 目标目录里已经有同名的 Skill（用户手写的，或者 `npx skills` 装的）时，挂载会覆盖它；卸载时如果只按名字删除，会误删用户自己的内容 | 原则 6、3.5、F-304 |

### 1.2 严重级

| 编号 | v1 位置 | 问题 | v2 位置 |
| :--- | :--- | :--- | :--- |
| R-08 | 头部、第三章、6.2 | 版本和优先级互相矛盾：F-202 标为 P0，路线图却放在 v0.5；F-201 是 P0，里面却含有 P1 的内容；WSL 既在 P0，又说要到 v1.0 才「完美打通」；头部又写「当前规划版本 v1.0」 | 头部（P0=v0.1，P1=v0.5，P2=v1.0）、第十章 |
| R-09 | F-202、第五章第 2 节、4.1 数据模型 | 档位定义不一致：功能表里有 3 档，UI 下拉框只有 2 档；数据模型 `accessMode + rules` 说明「Custom」其实是附加规则，不是独立的档位 | F-202 |
| R-10 | 4.1 对比 4.2 | 示例 SKILL.md 把 3 条红线改写合并成了 2 条。Handlebars 和 EJS 这类确定性模板做不到这种改写；如果靠 LLM 来改写，就要联网，结果也无法审计。另外，OpenResty 跑在容器里，`nginx -t` 应该写成 `docker exec openresty nginx -t` | 5.2（逐字渲染） |
| R-11 | 4.1 | 数据有重复来源：`port`、`user` 和 ssh config 重复；`domains` 和 F-104 的 DNS 卡片重复；`tags` 混合了环境、地域和软件三类信息，而 UI 的筛选项「VPS / 域名」实际是资产类型；`ports` 是格式不统一的自由字符串；`panel` 是自由文本 | 3.3 |
| R-12 | 4.1、F-203 | 磁盘余量这类易变指标被写进 Skill，内容一写进去就开始过期，而且每次探测都会改写产物 | 3.3、5.2（只编译稳定事实，让 Agent 现场查询） |
| R-13 | F-103 | 探测没有规格：脚本通常以 root 身份运行，却没说执行什么；没有 BatchMode、超时、主机密钥策略；「公网端口」在机器内部根本判断不了（取决于防火墙和安全组）；探测结果和人工标注怎么合并没有定义，人工写的「角色」可能被覆盖，消失的容器也不知道怎么处理 | F-103、6.5、8.3 |
| R-14 | F-102 | ssh config 的复杂情况没有考虑：`Include`、`Match`、通配 Host、`ProxyJump`。应该用 `ssh -G` 获取生效配置，而不是自己解析 | F-102 |
| R-15 | F-204、原则 2 | Token 只分了两层，实际加载分三层：常驻的 name+description（每个 Skill 约 100 Token）、触发后加载的正文（官方建议不超过 5k Token、500 行）、按需读取的 references。Claude 没有官方的离线分词器，只能做估算。另外，Claude Code 的技能清单只占上下文窗口的 1%，超出后最少使用的 Skill 描述会被丢掉。这一点正好佐证了痛点 3：全局堆的 Skill 越多，Agent 越可能根本看不到某些 Skill | F-204、5.4 |
| R-16 | 4.2 | Agent Skills 规范的硬约束没有写进需求：`name` 只能是小写字母、数字、连字符，最长 64 位，并且要和目录同名；`description` 最长 1024 字符。slug 一旦改名，已有挂载全部失效 | 5.1、F-101 AC2 |
| R-17 | 1.2「全局热更新」 | 文件在磁盘上即时更新了，不等于正在运行的 Agent 会话会立即生效。Claude Code 2.1 起会自动加载内容变化，但会话运行期间新建的 skills 目录需要执行 `/reload-skills`，已经调用过的 Skill 也不会重读。Codex 0.97 起能检测更新，但维护者明确说过「通过链接的更新不会实时生效」，需要重启 | F-303 AC4 |
| R-18 | 第五章第 3 节 | 「微调」编译产物和单一数据源冲突，手改的内容下次编译就被覆盖 | 6.4（预览只读，定制通过附加说明，P2 支持模板） |
| R-19 | 6.1 | 技术栈三处没定：Electron 还是 Tauri、SQLite 还是 JSON、Handlebars 还是 EJS。前端写的是 Vue 3 + shadcn-vue，与本次指定的 React 生态库冲突。EJS 能执行任意 JS，再加上「模板市场」，就等于远程代码执行 | 7.1、8.1（Tauri v2 + React、minijinja、不做市场） |
| R-20 | 6.2 v0.5、v1.0 | 软件自身需要的凭据（例如 Cloudflare Token）存哪里没有定义；「模板市场」需要后端，和「无需后端」矛盾 | F-104、F-208、8.5 |
| R-21 | 第四章 | 只有 VPS 一个数据模型，缺少运行环境、目标、挂载、Skill 和业务包、探测记录这些模型 | 第三章 |
| R-22 | F-303 | 生产资产挂到全局时没有任何防护；同一个 Skill 在全局和项目重复挂载时也没有提示。后者比看上去更危险：同名 Skill 的取舍各家相反，Claude Code 用全局（个人）那份，Gemini CLI 和 agentskills.io 指南用项目那份，Codex 两份都列出。如果两边档位不同，不同 Agent 会拿到不同的红线 | F-303 AC1、AC2（档位不同时阻止挂载） |
| R-23 | F-103、F-203 | 探测采集的容器名、镜像名、服务名来自服务器，属于不可信输入。v1 打算把它们原样编译进 SKILL.md，这就给提示词注入开了口子：服务器被入侵或多人共用时，有人可以通过容器名往 Agent 的上下文里塞指令 | 8.3（字符白名单、代码格式输出、长度上限）、5.4（「疑似指令注入」Lint） |
| R-24 | F-304 | v1 把 Windows Directory Junction 定为 Windows 原生环境下的首选链接方式 | 实测资料显示这个默认值有风险：Claude Code 存在 Junction 相关的发现问题（#41177：Skill 能列出来，调用时却报「未知 Skill」；#68318：Node/Bun 把 Junction 识别为链接而不是目录）；Codex 对 Junction 的支持也没有任何确认 | 8.2（Windows 原生默认用受管复制，Junction 改为实验选项）、F-304 AC4（每个目标可手动切换） |

### 1.3 一般级

| 编号 | 问题 | v2 位置 |
| :--- | :--- | :--- |
| R-25 | 「毫秒级」「秒级」「完美打通」这类营销表述没法验收 | F-203 AC2、第九章（p95 指标） |
| R-26 | 缺少目标用户画像、成功指标和竞品分析。尤其是 `npx skills`，它已经提供了跨 79 种 Agent 的软链接分发，PRD 应该说明本产品和它的差异，以及如何共存 | 1.2、1.4、1.5 |
| R-27 | 缺少非功能需求：性能、遥测与隐私、日志、无障碍、国际化、数据迁移、更新 | 第九章 |
| R-28 | UI：预览出现在两个地方（资产抽屉右侧，以及独立的「预览与模板室」），职责重叠 | 6.4、6.7（复用同一个 `SkillPreview` 组件） |
| R-29 | UI：挂载中心一会儿叫「二维矩阵」，一会儿画成「双栏看板」，交互模型说不清；拖拽也没有键盘替代方式 | 6.6（看板 + 矩阵 + 菜单，三个入口走同一条挂载管线） |
| R-30 | UI：「卡片网格 + 右侧抽屉」放不下长表单和实时预览（已经和你确认改为多栏工作区） | 6.4 |
| R-31 | UI：缺少首次引导、空状态、加载状态、错误状态、删除时的级联影响、失效链接的修复流程和活动日志 | 6.5、6.10、6.11、F-402 |
| R-32 | UI：「OS 图标」和「统一使用 Lucide」冲突（Lucide 没有发行版和品牌 Logo）；用「⚡」emoji 当图标；「Mounted (已挂载)」中英混排 | DESIGN.md 的 Iconography 一节、6.13 |

---

## 二、阻断级问题详解

### R-01 档位与软链接的结构性冲突

v1 想要的效果是：同一个 `vps-hk-edge`，挂到 `OpenPet-Desktop` 时是只读，挂到 `infra-tools` 时是标准运维。但软链接只能指向一个目录，而 v1 每个 Skill 只编译出 `compiled/{slug}/` 这一份。

v2 的做法是按档位编译出不同的变体：`compiled/<mode>/<slug>/`。每个挂载记录自己选的档位，链接指向对应档位的变体。这里有一个细节必须守住：Agent Skills 规范要求 `name` 和父目录同名，所以变体目录的目录名也必须等于 slug，不能用 `compiled/<slug>/<mode>/` 这种结构。

### R-02 红线只是「建议」，不是「强约束」

写在 `SKILL.md` 里的红线，只是给模型看的指令。Agent 完全可以执行 `ssh hk-edge "rm -rf ..."`。v1 用「强约束」「严禁」这样的措辞，会让用户产生虚假的安全感。

更直接的漏洞是：只读档的白名单里有 `cat`，Agent 照样可以 `cat /data/apps/.env`，把凭据带进模型上下文。

v2 做了三件事：

1. 界面和产物都如实标注「红线是建议性约束」。
2. 在所有档位下注入内置的凭据防护红线（5.5）。
3. 引导用户在只读场景使用低权限 SSH 用户，P2 提供辅助脚本。

关于「能不能做成真正的拦截」，已经核实过两件事：

- **Claude Code 的 Skill frontmatter 可以声明 `hooks`。** 其中 `PreToolUse` 配合 `matcher: "Bash"`，能用退出码 2 拦截命令。但有四个限制：hook 只在 Skill 被调用之后才注册；管理员可以通过 `strictPluginOnlyCustomization` 禁用非插件 Skill 的 hook；官方文档建议硬性的允许和拒绝要交给权限系统；claude.ai 和 Skills API 会拒绝规范外的 frontmatter 字段，所以这只能作为 Claude Code 专属的变体（v2 放在 P2）。
- **Claude Code 的权限 deny 规则，官方文档写明「不是安全边界」。** 例如 `Bash(curl *)` 拦不住 `/usr/bin/curl`，也拦不住 `sh -c` 包一层再调用。真正的隔离要靠沙箱，或者服务器端的低权限账户。这正是 v2 坚持「红线诚实」的依据。

### R-03 Agent 目录已经过时

截至 2026-10 的情况（来源：vercel-labs/skills 的 `docs/agents.md`）：

- Codex 的全局目录是 `~/.agents/skills`，项目目录是 `.agents/skills`。
- Cursor 的全局目录是 `~/.cursor/skills`，项目目录是 `.agents/skills`。
- Gemini CLI、GitHub Copilot、OpenCode 的项目目录也都是 `.agents/skills`。

所以项目级挂载只需要写两个约定目录：`.claude/skills`（Claude Code）和 `.agents/skills`（其余 Agent）。v2 用「约定目录」替代了 v1 写死的 `.claude/skills`，见 4.5 和 F-302。

### R-05 Windows 与 WSL 的双重环境

这是目标用户（Windows + WSL2）最常见的环境，v1 却把它推到了 v1.0。v2 把「运行环境」做成一等概念，并补上三条规则：

1. 每个别名都记录它在哪些运行环境中有定义；挂载时检查目标环境能否解析这个别名（F-307）。
2. WSL 目标的链接由 `wsl.exe -d <发行版> -- ln -sfn ...` 在 WSL 内部创建。编译产物仍然只存一份，放在 Windows 侧，WSL 通过 `/mnt/c/...` 访问（8.2）。
3. 「Agent 视角」的计算考虑运行环境：WSL 项目看不到 Windows 侧的全局目录（F-306）。

### R-07 所有权：只动自己创建的东西

v2 的规则：

- 每个变体目录里都写入 `.cloudlink.json` 作为所有权标记。
- 卸载时，只删除两类东西：指向 `compiled/` 的链接，以及带有匹配标记的副本。
- 目标位置已经存在、但不是本软件创建的同名目录，一律判定为「冲突」，界面上给出说明，但不做任何修改。

`npx skills` 这类工具也往 `.agents/skills` 里装东西。有了这条规则，两者就能安全共存。

---

## 三、技术事实核实（截至 2026-10-27）

| v1 的表述或假设 | 核实结果 | 来源 |
| :--- | :--- | :--- |
| Codex CLI 的目录是 `~/.codex/skills` | 全局 `~/.agents/skills`（v0.95 起），项目 `.agents/skills`（v0.94 起）；`~/.codex/skills` 已废弃，但为了兼容仍会读取 | github.com/openai/codex releases rust-v0.95.0；vercel-labs/skills `docs/agents.md` |
| Cursor 用「本地规则 / Skill 目录」 | Cursor 支持 Agent Skills：全局 `~/.cursor/skills`，项目 `.agents/skills` | 同上 |
| SKILL.md 必须控制在 60 行以内 | 官方建议正文不超过 500 行、约 5k Token；常驻的元数据每个 Skill 约 100 Token；references 只能一层，超过 100 行要加目录。60 行可以作为本产品的 Lint 偏好 | platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices |
| 前端用 Vue 3 + shadcn-vue | 你指定的 react-resizable-panels、dnd-kit、Zustand 都属于 React 生态，前端改为 React 19 | — |
| shadcn/ui 基于 Radix | 2026-07 起 shadcn 的默认基础库改为 Base UI，Nova 风格对应 `base-nova`；组件组合改用 `render` 属性，不再用 `asChild` | ui.shadcn.com changelog |
| react-resizable-panels 的旧 API | v4 改为 `Group`、`Panel`、`Separator` 加 `orientation`；**数字尺寸表示像素，字符串才表示百分比** | bvaughn/react-resizable-panels 文档 |
| dnd-kit | 经典版 `@dnd-kit/core` 6.3 稳定，shadcn 的 base-nova 区块在用；新版 `@dnd-kit/react` 仍是 0.5.x | npm、shadcn registry |
| 通知组件 | shadcn 2026-07 推出基于 Base UI 的 `Toast`，不需要 sonner 和 next-themes | ui.shadcn.com |
| 代码高亮和步骤展示 | shadcn 2026-10 新增 `CodeBlock`（Shiki、diff、日志）和 `Trace`（步骤状态行），可以直接满足预览、探测和日志的需求 | ui.shadcn.com |
| 「秒级挂载、全局热更新」 | Claude Code 2.1.0 起会自动加载内容变化；会话中途新建的目录要执行 `/reload-skills`（2.1.152 起）。Codex 0.97 起能检测更新，但通过链接的更新要重启后才生效 | code.claude.com/docs/en/skills；github.com/openai/codex/pull/10478 |
| 软链接 / Junction 可用 | Claude Code 文档写明支持目录符号链接，但仍有回归报告（#14836）；**Windows Junction 有已知的发现问题**（#41177、#68318）。Codex 从 v0.80 起支持目录符号链接，对 Junction 的支持未确认 | code.claude.com/docs/en/skills；github.com/anthropics/claude-code/issues/41177；github.com/openai/codex/releases/tag/rust-v0.80.0 |
| 同名 Skill 的优先级 | Claude Code：企业 > 个人 > 项目；agentskills.io 指南和 Gemini CLI：项目优先；Codex：两份都列出 | code.claude.com/docs/en/skills |
| 常驻开销没有上限 | Claude Code 的技能清单占上下文窗口的 1%，超出后丢掉最少使用的 Skill 的描述；Codex 是 2%（或 8000 字符） | code.claude.com/docs/en/skills；learn.chatgpt.com/docs/build-skills |
| Token 估算 | 当前的 Claude 模型没有官方离线分词器（`@anthropic-ai/tokenizer` 已归档，自 Claude 3 起不准确）。唯一的官方途径是 `count_tokens` 接口，结果也只是估算。较新的模型对同样的文本产生的 Token 更多 | github.com/anthropics/anthropic-tokenizer-typescript；platform.claude.com/docs/en/build-with-claude/token-counting |

---

## 四、UI 重设计要点

完整规范见 `docs/PRD.md` 第六、七章和 `DESIGN.md`。设计上的取舍如下：

1. **信息架构**：资产、Skills、挂载、活动、设置五个一级视图，侧栏可以折叠成图标模式。
2. **资产视图**：改成三栏工作区（列表、结构化编辑器、实时预览），用 react-resizable-panels 实现，预览栏可折叠。探测面板像 VS Code 的终端面板一样停靠在编辑器底部。原因是长表单需要编辑空间，而「所见即 Agent 所见」需要预览常驻。
3. **探测的差异审阅**：采用类似源代码管理的变更清单，逐项勾选后才应用，人工标注不会被覆盖。
4. **挂载中心**：同一条挂载管线有三个入口。看板拖拽（dnd-kit，支持键盘）适合直观操作；开关矩阵适合批量查看和无障碍操作；「挂载到…」菜单适合精确操作。
5. **签名交互「Agent 视角」**：以「项目 × Agent」为单位，把每个 Skill 标为「可见」（信号青描边加眼睛图标）或「不可见」（文字改为注记灰加划掉的眼睛图标），直接回答「这个项目里的 Agent 能看见哪些服务器」。最初的方案是用降低透明度表示不可见，实测对比度只有 2.34:1，已经放弃。
6. **视觉体系「钢与信号」**：shadcn Nova（preset `b1sArLArQ`，已经实测生成），Mist 冷钢中性色，主按钮一律钢墨色，全应用只有 Signal Cyan 一个信号色，颜色只表达状态。有两处 preset 默认值在浅色模式下没达到 WCAG 标准，已经覆盖修正：muted-foreground 和焦点环。
7. **工程约束机械化**：「需求 → 唯一实现」映射表加上 ESLint `no-restricted-imports` 黑名单，把「禁止自造、禁止重复依赖」写成能自动检查的规则。另有 Mock IPC 夹具，覆盖失效、冲突、探测失败等全部状态，让一次性生成的结果可以直接验收。
