# 产品需求文档（PRD）v2：CloudLink —— 面向 CLI Agent 的云资产上下文与 Skill 分发器

> 本文是对 `docs/archive/prd-v1.md`（v1 草案，原名 CloudSkill Hub）的修订版，修订原因逐条记录在 `docs/PRD-review.md`。
> 配套文件：`PRODUCT.md`（产品上下文）和 `DESIGN.md`（视觉系统，令牌以它为准）。
> 文中的库版本、Agent 目录、规范约束和各 Agent 对链接的支持情况，都在 2026-10-27 对照官方文档、changelog 和 GitHub issue 核实过，来源列在 `docs/PRD-review.md` 第三章。

| 文档属性 | 内容 |
| :--- | :--- |
| 产品名称 | CloudLink（2026-10-27 确定；正式发布前要做商标检索，见 11.2） |
| 产品形态 | 桌面客户端（Tauri v2）。**v0.1 只支持 Windows 10/11（原生 + WSL2）**；macOS 在 v0.5 支持，Linux 在 v1.0 支持 |
| 核心定位 | 在结构化 UI 里维护服务器等云资产信息，编译成符合 Agent Skills 规范的 Skill，再按「项目 × Agent」的粒度精确挂载 |
| 兼容生态 | Claude Code（`.claude/skills`）；读取 `.agents/skills` 的 Agent，包括 Codex CLI、Cursor、Gemini CLI、GitHub Copilot、OpenCode 等；也支持用户自定义目录 |
| 文档版本 | v2.1（2026-10-27，已并入用户的六项决策，见第十一章） |
| 覆盖范围 | v0.1（MVP）到 v1.0。优先级与版本一一对应：P0 = v0.1，P1 = v0.5，P2 = v1.0 |

---

## 一、背景与目标

### 1.1 痛点

1. **云端上下文断层。** Agent 很会执行 Bash 和 SSH，但它不知道开发者手上有哪些机器、别名叫什么、服务跑在哪个目录、端口怎么映射。每开一次对话，人都得重新交代一遍。
2. **手工维护成本高。** 服务器上新开容器、改了端口或绑了新域名之后，散落在各个 Markdown 里的说明很容易漏改。Agent 拿到过期信息，就会执行错误的命令。
3. **全局上下文污染与串台。** 如果把所有服务器信息都塞进全局的 `CLAUDE.md` 或全局 Skill 目录，每次会话都要额外付出常驻 Token。更危险的是，开发 A 项目时，Agent 可能连上 B 项目的生产机。
4. **敏感信息外泄。** 凭据（密码、私钥、API Secret）绝对不能进入模型上下文。IP、端口、内部路径这类拓扑信息虽然不算凭据，也应该只披露最少必要的部分。

### 1.2 目标用户与场景（用户画像已于 2026-10-27 确认）

| 画像 | 环境 | 资产规模 | 主要诉求 |
| :--- | :--- | :--- | :--- |
| 独立开发者 | Windows + WSL2；以 Claude Code 为主，偶尔用 Codex | 2–5 台 VPS（反代、数据库、开发机） | 不想每次都重复交代背景；个人项目之间互不干扰 |
| 小团队全栈 | macOS（v0.5 起支持）；Cursor 和 Claude Code 都用 | 8–20 台（生产 + 预发） | Agent 绝对不能碰生产库；信息要随服务器变化及时更新 |

关键场景：

| 编号 | 场景 | 用户要做的事 |
| :--- | :--- | :--- |
| S1 | 首次配置 | 检测环境 → 导入 ssh config → 探测 → 挂载到第一个项目 |
| S2 | 新开一台服务器 | 导入或新建资产，然后探测 |
| S3 | 服务器有变更 | 重新探测，审阅差异，应用变更 |
| S4 | 开始一个新项目 | 添加项目目标，把相关资产挂载进去 |
| S5 | 线上排查前 | 把该项目的挂载档位切成「只读巡检」 |
| S6 | 项目被移动或改名 | 发现失效链接，一键修复 |

### 1.3 解决方案

- **结构化录入，加上以事实为源的自动探测。** `~/.ssh/config`（按运行环境分别解析）和只读探测脚本是事实来源。探测结果先以差异的形式交给用户审阅，确认后才合并。
- **渐进式编译。** 按三层加载口径（常驻元数据、触发后加载的正文、按需读取的参考文件）生成 `SKILL.md` 和 `references/`。编辑时实时显示上下文预算和 Lint 结果。
- **按「项目 × Agent」挂载。** macOS、Linux 和 WSL 上用符号链接；Windows 原生环境默认用受管复制，每次编译后由软件同步副本。提供「Agent 视角」，让用户一眼看清某个项目里的 Agent 到底能看见哪些服务器。

### 1.4 竞品与替代方案

| 方案 | 能做到 | 不足 | 本产品的差异 |
| :--- | :--- | :--- | :--- |
| 手写 `CLAUDE.md` / `AGENTS.md` | 零成本 | 全局常驻；没有结构；容易过期；容易写进敏感信息 | 结构化 + 探测；按需加载；项目级隔离 |
| `npx skills`（Vercel skills CLI，支持 79 种 Agent，用软链接或复制分发），以及它的本地图形界面 SkillDock | 分发 Git 仓库里的静态 Skill，`.agents/skills` 是它的共享目录 | 不生成内容；不维护服务器事实；没有红线和探测 | 生成并维护基础设施事实。与它们共存：遵循同样的目录约定，避免同名冲突 |
| 1Panel、宝塔等面板，云厂商控制台 | 管理服务器 | 不面向 Agent 上下文 | 不重做面板，只负责编译上下文 |
| Agent 自带的记忆功能 | 自动记住 | 不可控、不可审计、会跨项目串台 | 显式、可审计、项目级隔离 |

### 1.5 成功指标（MVP）

| 指标 | 目标 | 测量方式 |
| :--- | :--- | :--- |
| 首次挂载耗时 | 5 名目标用户中至少 4 人在 5 分钟内完成第一个挂载 | 可用性测试（产品不内置遥测） |
| 探测成功率 | 在 Ubuntu、Debian、CentOS Stream、Rocky、Alpine 上 ≥ 95% | 自动化测试矩阵（容器内 sshd） |
| 凭据泄漏 | 密钥扫描对测试样本集的漏放行数为 0 | 单元测试样本集 |
| 失效检出 | 应用启动或窗口重新聚焦后 2 秒内检出失效链接 | 集成测试 |

---

## 二、产品原则与安全边界

1. **凭据零进入。** Skill 中禁止出现明文密码、私钥内容和云厂商 API Secret。编译前必须做密钥扫描，命中就阻断发布（F-205）。认证完全交给系统 OpenSSH，Skill 里只写 `~/.ssh/config` 的 Host 别名。
2. **拓扑最小披露。** IP、解析后的 HostName、User、Port 默认不导出。每个字段都有独立的导出开关（F-105）。把生产资产挂到全局目标前必须二次确认。
3. **红线诚实。** 写在 `SKILL.md` 里的红线是给 Agent 的指令，属于建议性约束，不是技术隔离。界面和编译产物都要如实说明这一点。Claude Code 官方文档也明确写了：权限 deny 规则本身「不是安全边界」，真正的强制隔离要靠沙箱。需要硬隔离时，引导用户使用低权限 SSH 用户（P2 提供辅助）。
4. **渐进式披露。** 加载口径分三层：常驻（name + description）、触发后加载（`SKILL.md` 正文）、按需读取（`references/*`）。正文行数上限是可配置的 Lint 规则（默认 60 行），不是硬性限制。
5. **单一数据源。**
   - 数据只存一份，在本地 SQLite。
   - 渲染只有一份实现，即 Rust 编译器，预览和发布都调用它。
   - 类型只有一份来源：Rust 结构体经 ts-rs 自动生成 TypeScript 类型。
6. **只动自己创建的东西。** 所有编译产物和挂载都带所有权标记。软件绝不覆盖、也绝不删除不是自己创建的文件或目录。
7. **本地优先，零遥测。** 默认不联网，只有 SSH 探测和用户主动开启的更新检查例外。

---

## 三、核心概念与数据模型

### 3.1 概念

| 概念 | 定义 |
| :--- | :--- |
| 运行环境 Environment | Agent 运行、并且 `~/.ssh/config` 在其中生效的系统环境，取值为 `windows`、`wsl:<发行版>`、`macos` 或 `linux`。同一台电脑上可以同时存在多个运行环境 |
| 资产 Asset | 被描述的云资源。类型为 `vps`（P0），以及 `domain`、`panel`、`storage`（P1） |
| Skill | 编译单元。每个资产自动对应一个「单资产 Skill」；「业务包」由多个资产组合而成（P1） |
| 档位 Mode | `read-only`（只读巡检）或 `standard`（标准运维）。每个挂载单独选择档位；每个「Skill × 档位」组合编译成一个变体目录 |
| 目标 Target | 挂载的位置。`agent-global` 指某个运行环境中某个 Agent 的全局 skills 目录；`project` 指某个运行环境中的一个代码仓库，可以包含一个或多个约定目录 |
| 挂载 Mount | Skill × 目标 × 档位。一次挂载会生成一到两个链接（项目目标可能同时写入两个约定目录） |
| 探测 ProbeRun | 一次只读采集。它产出一份差异，由用户确认后才合并进资产 |

### 3.2 关系

```text
Environment 1 --- n Target          Asset 1 --- 1 Skill(单资产)       Bundle n --- n Asset (P1)
Skill 1 --- n Variant(按档位)        Variant 1 --- n Mount n --- 1 Target
Asset 1 --- n ProbeRun               Mount 1 --- 1..2 Link(实际创建的链接或副本)
```

### 3.3 资产（VPS）数据结构

```jsonc
{
  "id": "ast_01JB3Q8Z6W",                   // ULID
  "type": "vps",
  "name": "香港轻量反代与边缘节点",
  "slug": "vps-hk-edge",                    // ^[a-z0-9]+(-[a-z0-9]+)*$，≤64，全局唯一；已挂载后只能通过「重命名迁移」修改
  "envTag": "prod",                         // prod | staging | dev，驱动风险提示和视觉标识
  "provider": "Tencent Cloud",              // 可选
  "region": "HK",                           // 可选
  "tags": ["edge", "1panel"],               // 自由标签，不再混入环境和资产类型
  "summary": "承担 api.example.com 与 blog.example.com 的公网反代及后端 API 容器托管",
  "connection": {
    "sshAlias": "hk-edge",
    "definedIn": ["wsl:Ubuntu-24.04"],      // 这个别名在哪些运行环境的 ssh config 里存在
    "resolved": {                           // 由 `ssh -G` 得到的只读快照，默认不导出
      "hostname": "203.0.113.10", "user": "root", "port": 22, "proxyJump": null,
      "resolvedAt": "2026-10-27T10:30:00Z"
    }
  },
  "facts": {                                // 稳定事实，会进入编译产物
    "os": "Ubuntu 24.04 LTS", "kernel": "6.8.0-45-generic", "arch": "x86_64",
    "cpuCores": 2, "memoryTotalMiB": 1987, "diskTotalGiB": 40,
    "panel": { "type": "1panel", "installPath": "/opt/1panel" }
  },
  "paths": [                                // 有序；key 唯一
    { "key": "nginx-conf", "label": "OpenResty 站点配置目录", "path": "/opt/1panel/apps/openresty/openresty/conf/conf.d", "source": "manual" },
    { "key": "compose-root", "label": "Docker Compose 编排目录", "path": "/opt/1panel/docker/compose", "source": "manual" },
    { "key": "app-data", "label": "业务持久化数据目录", "path": "/data/apps", "source": "manual" }
  ],
  "services": [                             // 统一建模 docker / systemd；以 kind+name 作为合并键
    {
      "kind": "docker", "name": "openresty", "image": "openresty:1.21",
      "ports": [ { "hostIp": "0.0.0.0", "hostPort": 80, "containerPort": 80, "proto": "tcp" },
                 { "hostIp": "0.0.0.0", "hostPort": 443, "containerPort": 443, "proto": "tcp" } ],
      "role": "主网关与 SSL 终结",            // 人工标注；探测时保留
      "critical": true,                     // 人工标注；关键服务会在红线和标准档的确认清单中被点名
      "source": "probe", "lastSeenAt": "2026-10-27T10:30:00Z", "missing": false
    }
  ],
  "servedHostnames": ["api.example.com", "blog.example.com"],  // 本机反代承载的站点（与 DNS 记录是两个不同的事实）
  "listeningPorts": [ { "addr": "0.0.0.0", "port": 22, "proto": "tcp" } ],
  "guardrails": {
    "defaultMode": "read-only",             // 新建挂载时的默认档位
    "rules": [                              // 有序，原文逐字渲染，不做改写或合并
      { "id": "r1", "text": "机器内存仅 2GB，严禁在宿主机直接执行 npm run build 或 cargo build 等高内存编译任务" },
      { "id": "r2", "text": "修改 OpenResty 配置后必须先执行 docker exec openresty nginx -t，校验通过才允许 reload" },
      { "id": "r3", "text": "禁止停止或重启 openresty 容器" }
    ]
  },
  "export": { "resolvedConnection": false, "listeningPorts": false, "image": true },  // 字段级导出开关
  "notes": "",                              // 附加说明（Markdown），渲染到 references/notes.md
  "probe": { "lastRunId": "prb_01JB3R", "lastSuccessAt": "2026-10-27T10:30:00Z", "status": "ok" },
  "createdAt": "2026-10-20T08:00:00Z", "updatedAt": "2026-10-27T10:31:00Z"
}
```

与 v1 相比的关键变化（原因见评审报告 R-11 到 R-13）：

- `port` 和 `user` 不再手填，改为从 `ssh -G` 解析得到的只读快照。
- 磁盘余量、内存余量这类易变指标不再进入编译产物。
- `domains` 改名为 `servedHostnames`。DNS 记录由 P1 的 Domain 资产负责，两者不再重复。
- `ports` 从自由字符串改为结构化字段。
- 环境改为单独的单选字段 `envTag`，不再混在 `tags` 里。

### 3.4 运行环境、目标与挂载

```ts
type EnvId = "windows" | "macos" | "linux" | `wsl:${string}`;

interface Environment {
  id: EnvId; label: string;                 // 例如 "WSL - Ubuntu-24.04"
  home: string;                             // 例如 "C:\\Users\\me" 或 "/home/me"
  sshConfigPath: string; available: boolean;
}

type AgentId = "claude-code" | "universal" | "cursor" | "gemini-cli" | "copilot" | "opencode" | "custom";

interface Target {
  id: string;
  kind: "agent-global" | "project";
  envId: EnvId;
  label: string;                            // 例如 "Claude Code - 全局"、"OpenPet-Desktop"
  agent?: AgentId;                          // 仅 agent-global 使用
  path: string;                             // 全局目标：skills 目录；项目目标：仓库根目录
  conventions?: ("claude" | "agents")[];    // 仅 project 使用：写入 .claude/skills 和/或 .agents/skills
  gitExclude?: boolean;                     // 仅 project 使用：是否维护 .git/info/exclude
  linkMode: "auto" | "link" | "copy";       // auto 表示按 8.2 的默认值（Windows 原生为复制，其余为符号链接）
}

type Mode = "read-only" | "standard";
type MountStatus = "ok" | "pending" | "broken" | "conflict" | "stale-copy" | "alias-missing";

interface Mount {
  id: string; skillId: string; targetId: string; mode: Mode;
  links: { path: string; kind: "symlink" | "junction" | "copy" }[];
  status: MountStatus; statusDetail?: string;
  createdAt: string; checkedAt: string;
}
```

### 3.5 编译产物目录与所有权

```text
~/.cloudlink/                                   Windows 上是 %USERPROFILE%\.cloudlink\
  data.db                                       SQLite（WAL 模式），唯一数据源
  compiled/
    read-only/vps-hk-edge/                      变体目录。目录名 = slug = SKILL.md 中的 name
      SKILL.md
      references/runtime-topology.md
      references/notes.md                       仅当资产填写了附加说明时才生成
      .cloudlink.json                           所有权标记：managedBy、skillId、mode、contentHash、compiledAt
    standard/vps-hk-edge/
  logs/
```

挂载产生的链接示例：

- 全局目标：`~/.claude/skills/vps-hk-edge` 指向 `~/.cloudlink/compiled/read-only/vps-hk-edge`。
- 项目目标：`<repo>/.claude/skills/vps-hk-edge` 和 `<repo>/.agents/skills/vps-hk-edge` 指向同一个变体目录。

规则：

- 同一个目标目录里，同一个 Skill 只能出现一次，也就是说一个目标对一个 Skill 只能选一个档位。
- 只有当某个变体被至少一个挂载引用，或者正在预览时，才会编译它。
- 变体目录的目录名必须等于 slug。规范要求 `name` 与父目录同名，这样无论 Agent 是按链接路径还是按真实路径校验，都能通过。

---

## 四、功能需求

### 4.1 模块一：云资产库

| 编号 | 功能 | 优先级 | 需求与验收标准（AC） |
| :--- | :--- | :--- | :--- |
| F-101 | VPS 资产管理 | P0 | 增删改查，字段见 3.3。**AC1：** slug 实时校验格式和唯一性。**AC2：** 已挂载资产的 slug 默认锁定，修改必须走「重命名迁移」，迁移会重建全部链接。**AC3：** 删除资产前，确认框要列出会被级联卸载的挂载 |
| F-102 | ssh config 导入 | P0 | 按运行环境分别扫描（Windows 宿主机和各个 WSL 发行版分开处理）。支持 `Include`。用 `ssh -G <alias>` 获取生效配置。**AC1：** 通配和否定模式的 Host（`*`、`?`、`!`）不导入，并提示已跳过几个。**AC2：** 同一个别名在多个环境里都有定义时，合并为一行，「来源环境」列出全部环境。**AC3：** 已导入的别名标记为「已导入」，默认不勾选 |
| F-103 | 只读探测 | P0 | 规格见 8.3。**AC1：** 使用 `BatchMode=yes` 和 `ConnectTimeout=10`，整个探测 30 秒超时，用户可以取消。**AC2：** 探测结果以差异形式呈现，用户逐项勾选后才合并。**AC3：** 合并时保留人工标注（role、critical）。上次有、这次没发现的服务标为「未发现」，不自动删除。**AC4：** 错误按 8.3 的分类表给出可操作的说明。**AC5：** 原始输出只留在内存里，不写入磁盘 |
| F-104 | 多维资产卡片 | P1 | Domain（手工录入 DNS 记录，记录指向 VPS 资产的 id）、Panel（1Panel 或宝塔的目录约定和 CLI 规范）、Storage（Bucket 和备份目录映射）。Cloudflare 只读同步属于 P2，所需 Token 存在系统钥匙串里，不进入数据库 |
| F-105 | 字段导出控制 | P0 | 每个资产可以单独设置导出开关：解析后的连接信息（默认关）、监听端口（默认关）、镜像版本（默认开）。**AC：** 关闭的字段一旦出现在编译产物里，就触发 Lint 错误并阻断发布 |

### 4.2 模块二：编译器

| 编号 | 功能 | 优先级 | 需求与验收标准 |
| :--- | :--- | :--- | :--- |
| F-201 | 单资产 Skill | P0 | 每个资产自动对应一个 Skill。**取消 v1 中「把所有 VPS 汇总为一份全局清单」的模式**：它重新制造了痛点 3 |
| F-202 | 档位与红线 | P0 | 两个档位：只读巡检和标准运维。用户自定义的红线在任何档位下都追加在后面（「Custom」不再是一个独立档位）。内置红线（5.5）在任何档位下都始终注入。**AC：** 红线逐字渲染，顺序与编辑器中一致 |
| F-203 | 编译与发布 | P0 | 触发时机：保存、应用探测结果、首次使用某个档位。流程：校验、渲染、Lint、原子发布（8.4）。**AC1：** 存在错误级 Lint 时不发布，保留上一次成功的产物，并在界面上标出「编译受阻」。**AC2：** 一个典型资产（≤50 个服务）的编译 p95 不超过 100ms |
| F-204 | 实时预览与上下文预算 | P0 | 编辑器旁边实时预览，内容就是草稿的编译结果。显示三层 Token 估算，以及 description 字符数和正文行数相对上限的进度。Claude 没有官方的离线分词器（`@anthropic-ai/tokenizer` 已归档，作者注明它自 Claude 3 起已不准确），所以 Token 数统一标「≈」，并在 Tooltip 里说明「本地 o200k 估算，较新的 Claude 模型可能更多」。常驻层的 Tooltip 还要讲清预算机制：Claude Code 的技能清单只占上下文窗口的 1%，超出后最少使用的 Skill 描述会先被丢掉；Codex 是 2% 或 8000 字符。**AC：** 预览和发布调用同一个渲染函数，同一份输入得到的内容字节级一致。**P2：** 用户可以选择填入自己的 Anthropic API Key（存系统钥匙串），调用官方 `count_tokens` 接口做精确计数，默认关闭 |
| F-205 | Lint 与密钥扫描 | P0 | 规则见 5.4。密钥扫描复用 gitleaks 的规则集（MIT 许可），编译进 Rust 二进制 |
| F-206 | 业务包 Bundle | P1 | 把多个资产组合成一个按业务命名的 Skill，例如 `openpet-prod-cloud`。成员顺序可以拖拽调整 |
| F-207 | 输出语言 | P0（默认英文）/ P1（可切换） | 编译产物默认英文：模板文字、档位说明、内置红线、description 模板都是英文；用户填写的用途、红线、附加说明原样输出，不翻译。P1 起支持全局或按资产切换为 `zh-CN` |
| F-208 | 自定义模板 | P2 | 用户模板基于 minijinja，在沙箱中渲染，以文件形式导入导出。**不做「模板市场」**：那需要后端服务，并引入远程代码风险 |

### 4.3 模块三：目标与挂载

| 编号 | 功能 | 优先级 | 需求与验收标准 |
| :--- | :--- | :--- | :--- |
| F-301 | 运行环境与 Agent 检测 | P0 | 启动时和手动刷新时执行。Windows 上用 `wsl.exe -l -q` 列出发行版。各 Agent 的目录见 4.5。**AC：** 未检测到的 Agent 也可以手动启用（软件会创建目录），也可以添加自定义目录 |
| F-302 | 项目目标 | P0 | 用户选择仓库目录后，软件检查它是否是 Git 仓库、已经存在哪些约定目录、属于哪个运行环境（按路径判断：`\\wsl$` 或 `\\wsl.localhost` 开头的路径归入对应的 WSL）。用户勾选要写入的约定目录。**AC：** 默认把链接路径写入 `.git/info/exclude`（不修改共享的 `.gitignore`）。路径通过 `git rev-parse --git-path info/exclude` 解析，以兼容 worktree |
| F-303 | 挂载操作 | P0 | 三种等价入口：看板拖拽、矩阵开关、「挂载到…」菜单。**AC1：** 允许把生产资产挂到全局目标（2026-10-27 决定），但必须先弹 `AlertDialog` 二次确认，确认文案要说明「所有项目中读取这个全局目录的 Agent 都会看到它」；挂上之后，挂载视图顶部常驻一条提示（见 6.6）。**AC2：** 同一个 Skill 已经挂在某个 Agent 的全局目录里，又要挂到该 Agent 会读取的项目目录时：档位相同就提示「冗余」；档位不同就**阻止挂载**，并说明原因——不同 Agent 对同名 Skill 的取舍相反（Claude Code 用全局那份，Gemini CLI 用项目那份，Codex 两份都列出），红线会因 Agent 而异。**AC3：** 档位可以随时切换，切换时重新指向另一个变体。**AC4：** 挂载完成后，按 Agent 给出生效提示：Claude Code 2.1 起会自动加载内容变化，但如果这次挂载是在会话运行期间新建了 `.claude/skills` 目录，需要在会话中执行 `/reload-skills`；已经调用过的 Skill 不会重读，要开新会话；Codex 通过链接更新内容后，如果没有生效，需要重启 Codex |
| F-304 | 链接引擎 | P0 | 平台策略见 8.2：macOS、Linux、WSL 默认用符号链接；**Windows 原生默认用受管复制**，Junction 作为实验选项（原因见 8.2）。**AC1：** 目标位置已存在同名目录、而且不是本软件创建的，判定为「冲突」，不做任何覆盖。**AC2：** 卸载只删除本软件创建的东西：链接必须指向 `compiled/` 目录，副本必须带有匹配的所有权标记。**AC3：** 链接创建失败时降级为受管复制（状态显示「复制模式」）；重新编译后，所有副本在同一次发布中同步。**AC4：** 每个目标都可以在「链接方式」里手动切换「链接 / 复制」。在 Agent 里看不到某个 Skill 时，故障排查的第一步就是切换为复制 |
| F-305 | 健康检查与修复 | P0 | 检查时机：启动、窗口重新聚焦（节流 30 秒）、手动「检查全部」。检测四类问题：链接失效、冲突、副本过期、别名缺失。**AC：** 「修复」会重建链接；目标路径已不存在时，引导用户更新项目路径或移除该目标 |
| F-306 | Agent 视角 | P0 | 视角的单位是「项目 × Agent」，或者「全局目标本身」。选中后，这个 Agent 在这里能看见的 Skill 标为「可见」（信号青描边加 `EyeIcon`），其余标为「不可见」（注记灰文字加 `EyeOffIcon`）。为了保证对比度，不允许用降低透明度的方式表示不可见。可见集合 = 该 Agent 所读约定目录中的项目挂载 ∪ 同一运行环境下该 Agent 全局目录中的挂载。状态为 `broken` 或 `alias-missing` 的挂载单独计数。例如：Claude Code 只读 `.claude/skills` 和本环境的 `~/.claude/skills`；Codex 读 `.agents/skills` 和本环境的 `~/.agents/skills`；WSL 项目看不到 Windows 侧的全局目录。这是本产品的签名交互 |
| F-307 | 别名可达性校验 | P0 | 挂载时检查 `sshAlias` 是否定义在目标所在运行环境的 ssh config 里。**AC：** 未定义时提示「该环境中的 Agent 无法连接」，用户仍可确认继续，此时挂载状态为 `alias-missing` |

### 4.4 模块四：系统

| 编号 | 功能 | 优先级 | 需求与验收标准 |
| :--- | :--- | :--- | :--- |
| F-401 | 命令面板与快捷键 | P0 | 见 6.12 |
| F-402 | 活动日志 | P0 | 记录探测（包括执行的命令清单、耗时、结果）、编译、挂载和卸载、修复，本地保留 30 天。**AC：** 日志中不出现原始探测输出，也不出现解析后的连接信息 |
| F-403 | 设置 | P0 | 见 6.9 |
| F-404 | 数据导入导出 | P1 | 以 JSON 导入导出资产。挂载与本机路径强相关，因此不导出。P2 支持加密备份包 |
| F-405 | 首次启动引导 | P0 | 见 6.10 |

### 4.5 Agent 目录表

数据来源是 vercel-labs/skills 的 `docs/agents.md`（2026-10 版）。上线前需要逐项对照官方文档再核实一遍。

| Agent | 全局目录 | 项目约定目录 | 检测依据 |
| :--- | :--- | :--- | :--- |
| Claude Code | `~/.claude/skills/` | `.claude/skills/` | `~/.claude/` 存在，或 PATH 中有 `claude` |
| 通用（Codex CLI、Cline、Warp、Zed 等） | `~/.agents/skills/` | `.agents/skills/` | `~/.codex/` 存在，或 PATH 中有 `codex` |
| Cursor | `~/.cursor/skills/` | `.agents/skills/` | `~/.cursor/` |
| Gemini CLI | `~/.gemini/skills/` | `.agents/skills/` | `~/.gemini/` |
| GitHub Copilot | `~/.copilot/skills/` | `.agents/skills/` | `~/.copilot/` |
| OpenCode | `~/.config/opencode/skills/` | `.agents/skills/` | `~/.config/opencode/` |
| 自定义 | 用户指定 | 用户指定 | 无 |

由此可以得出：项目级挂载只需要两个约定目录。`.claude/skills` 供 Claude Code 使用，`.agents/skills` 供其余 Agent 使用。

补充事实（2026-10 核实）：

- **Claude Code 不读 `.agents/skills`。** 相关 issue #31005 截至 2026-10 仍未关闭。
- **Codex 的目录变迁。** v0.94 起读仓库内的 `.agents/skills`；v0.95 起读 `~/.agents/skills`。旧目录 `~/.codex/skills` 已标为废弃，但为了兼容仍会读取。Codex 的官方文档已经迁到 learn.chatgpt.com/docs/build-skills。
- **同名 Skill 的优先级各家不同。**
  - Claude Code：企业 > 个人（`~/.claude/skills`）> 项目。
  - agentskills.io 的客户端指南和 Gemini CLI：项目优先。
  - Codex：不合并同名项，两份都会出现在列表里。

  这就是 F-303 要阻止「全局和项目挂载同一个 Skill 但档位不同」的原因。
- **Claude Code 的保留目录名。** `synced` 是 Claude Code 在 `~/.claude/skills` 下的保留目录名，slug 不能取这个值。

---

## 五、编译产物规范

### 5.1 Frontmatter 约束（Agent Skills 规范）

| 字段 | 约束 | 编译器的处理 |
| :--- | :--- | :--- |
| `name` | 1–64 个字符，只能是小写字母、数字和连字符，不能以连字符开头或结尾，不能有连续连字符（`--`），必须与父目录同名（VS Code / Copilot 不加载名称不匹配的 Skill） | 直接使用 slug；变体目录名也等于 slug |
| `description` | 非空，最多 1024 个字符；要同时写明「做什么」和「什么时候用」。Claude Code 对每条清单项另有 1536 字符的上限 | 由模板自动生成，用户可以覆盖；超长时 Lint 报错 |
| 其他字段 | 规范里的可选字段只有 `license`、`compatibility`、`metadata`、`allowed-tools`（实验性）。Claude Code 会忽略未知字段，但 claude.ai 和 Skills API 会直接拒绝 | **编译产物只输出 `name` 和 `description`**，以保证在各个 Agent 之间都能用 |

### 5.2 SKILL.md 示例（只读巡检档，默认英文输出）

编译产物默认用英文（F-207）。下例中，模板生成的文字都是英文；`summary`、自定义红线、附加说明这类用户填写的文本原样输出，不做翻译。为了方便对照，示例里的用户文本也写成了英文。

```markdown
---
name: vps-hk-edge
description: Connection, directory and container topology, and guardrails for hk-edge, the Hong Kong edge node (Ubuntu 24.04, production). Use when a task involves hk-edge, api.example.com or blog.example.com — deployments, log investigation, OpenResty or 1Panel configuration.
---

# hk-edge — Hong Kong edge proxy node

> Production | Mode: read-only | Snapshot: 2026-10-27 | Generated by CloudLink — do not edit

## Connect
- Run commands through the system SSH alias: `ssh hk-edge '<command>'`. Authentication is handled by the local ssh-agent; never ask for or record passwords, IPs or private keys.
- System: Ubuntu 24.04 LTS | 2 vCPU / 2 GB RAM | managed by 1Panel (/opt/1panel).
- Role: public reverse proxy for api.example.com and blog.example.com, and host for the backend API containers.

## Mode: read-only
- Only inspection commands are allowed, e.g. `docker ps`, `docker logs --tail 200 <container>`, `df -h`, `free -m`, `uptime`, `ss -tln`, `ls`, `journalctl -u <service> -n 200`.
- No writes of any kind: do not restart or stop containers or services, edit or delete files, install packages, or change the firewall. If a change is needed, describe the plan to the user and stop.

## Guardrails (must follow)
1. Memory is only 2 GB — never run npm run build, cargo build or other memory-heavy builds on this host
2. After editing OpenResty config, run docker exec openresty nginx -t and reload only if it passes
3. Never stop or restart the openresty container
4. Never read or print credential files (.env, *.pem, *.key, id_*, /etc/shadow, ~/.ssh/) and never use docker inspect to view environment variables

## References (read on demand)
- Key directories, containers and port mappings: read `references/runtime-topology.md`
- Live metrics such as free disk or memory usage are not recorded here; check them on the host when needed (e.g. `df -h`, `free -m`)
```

在「标准运维档」下，「Mode」一节替换为以下内容：

```markdown
## Mode: standard operations
- Routine deployments and service restarts are allowed.
- Ask the user for explicit approval before: deleting data or volumes (including `docker compose down -v`), changing the firewall or security groups, stopping critical services (openresty), changing SSH configuration, or rebooting the host.
```

### 5.3 references 拆分规则

| 文件 | 内容 | 生成条件 |
| :--- | :--- | :--- |
| `references/runtime-topology.md` | 关键目录表；服务表（名称、类型、镜像、端口、角色、是否关键）；本机承载的站点；导出开关打开时的监听端口；数据快照时间 | 资产填写了路径或服务时 |
| `references/notes.md` | 用户的附加说明，原文照录 | `notes` 非空时 |

参照 Anthropic 官方的 Skill 最佳实践：references 只允许一层，不能出现「参考文件里再引用参考文件」；超过 100 行的参考文件，开头要加目录。

### 5.4 Lint 规则

| 规则 | 级别 | 说明 |
| :--- | :--- | :--- |
| `name` 格式与长度 | 错误 | 正则 `^[a-z0-9]+(-[a-z0-9]+)*$`，最长 64 |
| slug 是保留名 | 错误 | `synced` 是 Claude Code 的保留目录名 |
| `description` 为空或超过 1024 字符 | 错误 | 必须同时有「做什么」和「什么时候用」 |
| 疑似密钥 | 错误，阻断发布 | 使用 gitleaks 规则集，覆盖私钥文件头、AWS/GitHub/OpenAI/Anthropic Token 格式、`password=` 这类赋值，以及高熵字符串 |
| 输出了已关闭导出的字段 | 错误，阻断发布 | 例如 IP 被关掉导出后仍出现在产物里 |
| 引用的 references 文件不存在 | 错误 | 编译器自检 |
| `SKILL.md` 正文行数超过上限 | 警告 | 默认上限 60 行，可配置。Anthropic 官方的建议是正文不超过 500 行、约 5k Token |
| `description` 中没有出现别名或站点名 | 警告 | 会降低 Agent 正确触发这个 Skill 的概率 |
| 生产资产使用标准运维档，且没有任何自定义红线 | 警告 | 提示用户补充红线 |
| 探测数据超过 30 天 | 提示 | 提示用户重新探测 |
| 探测来源的值疑似包含指令注入 | 警告 | 规则见 8.3「探测数据是不可信输入」 |

### 5.5 内置红线（任何档位都会注入，不可删除）

编译产物中的原文（英文）如下，界面上同时显示中文说明。

| 输出原文 | 中文说明 |
| :--- | :--- |
| Never read or print credential files (`.env`, `*.pem`, `*.key`, `id_*`, `/etc/shadow`, `~/.ssh/`) and never use `docker inspect` to view environment variables. | 不读取、不输出凭据类文件，不用 `docker inspect` 查看环境变量 |
| Never ask for or record passwords, private keys or IP addresses; connect only through the SSH alias. | 不询问、不记录密码、私钥或 IP；连接只通过 SSH 别名进行 |
| If the host does not match this document, report the difference to the user instead of "fixing" the server to match the document. | 现场情况与文档不一致时，先向用户报告，不要自行「修正」服务器去迎合文档 |

---

## 六、UI/UX 设计规范

### 6.1 设计基调

视觉系统见 `DESIGN.md`。它的核心是「钢与信号」：Nova 风格的紧凑密度，Mist 冷钢中性色，主按钮一律用钢墨色，信号色只有 Signal Cyan 一种，并且只用于焦点、落点和视角。颜色只表达状态。浅色和深色两套主题都要做到同等完成度，默认跟随系统。

### 6.2 信息架构

| 一级导航 | 图标 | 用途 | 侧栏计数徽章 |
| :--- | :--- | :--- | :--- |
| 资产 | `ServerIcon` | 维护资产，探测，预览编译结果 | 资产总数 |
| Skills | `PackageIcon` | 编译产物总览、Lint 健康度、业务包（P1） | 编译受阻的数量（红色） |
| 挂载 | `CableIcon` | 看板和矩阵、Agent 视角、目标管理 | 失效与冲突的数量（红色） |
| 活动 | `HistoryIcon` | 探测、编译、挂载的日志 | 无 |
| 设置 | `SettingsIcon` | 通用、运行环境、Agent 目标、编译、探测、数据 | 无 |

侧栏底部显示运行环境状态，例如「Windows 可用、WSL Ubuntu 可用」。点击后跳转到「设置 / 运行环境」。

### 6.3 应用外壳

- 使用 `SidebarProvider` 和 `Sidebar`（`collapsible="icon"`），右侧是 `SidebarInset`。窗口最小尺寸 960×600。
- 工具栏高 44px，从左到右依次是：`SidebarTrigger`、`Separator`、`Breadcrumb`（视图 / 当前对象）、弹性空白、当前视图的操作按钮（`ButtonGroup`）、命令面板按钮（带 `Kbd` 提示）。
- 标题栏使用系统原生样式（MVP 不自定义标题栏）。
- 切换一级视图时，各视图的选中项、筛选条件和滚动位置都要保留（记在 store 里），切回来时恢复原样。

### 6.4 资产视图（核心编辑视图）

```text
+--------+--------------------------------------------------------------------------------------------+
| 侧栏   | [=] 资产 / hk-edge               [探测] [保存 Ctrl+S] [...]    [预览 Ctrl+\] [Ctrl+K]      |
|        +------------------------+--------------------------------------+---------------------------+
| 资产 12| 搜索名称、别名、标签   | hk-edge  香港轻量反代与边缘节点      | SKILL.md  runtime  notes  |
| Skills | [全部][VPS][域名][面板]| (o 生产) 已挂载 3  已探测 2 小时前   | [渲染][源码]  档位[只读 v]|
| 挂载  1| 环境 v   标签 v   排序v| 概览  连接  路径  服务  红线  挂载   |---------------------------|
|        |------------------------|--------------------------------------| 常驻~86 触发~412 按需~1.2k|
| 活动   | 生产                   | 名称  [香港轻量反代与边缘节点     ]  | 描述 312/1024  [=====---] |
| 设置   | > hk-edge      3 挂载  | Slug  [vps-hk-edge]  已挂载，已锁定  | 正文 42/60 行  [=======-] |
|        |   香港轻量 - Ubuntu    | 环境  (生产)(预发)(开发)             |---------------------------|
|        |   sg-db        1 挂载  | 用途  [承担 api/blog 的反代与     ]  | ---                       |
|        |   新加坡库 - Debian    | 标签  [edge x][1panel x][+]          | name: vps-hk-edge         |
|        | 开发                   |                                      | description: 香港边缘...  |
|        |   dev-box   从未探测   |--------------------------------------| ---                       |
|        |                        | 探测面板（可折叠，Ctrl+J）           | # hk-edge 环境概览        |
|--------|                        | v 已解析别名 hk-edge (WSL)    0.1s   | ## 连接                   |
| 环境   |                        | v 已连接                      0.8s   | ...                       |
| Win ok |                        | v 已采集 4 个容器             1.2s   |---------------------------|
| WSL ok |                        | ! 发现 2 处变更      [审阅]          | ~/.cloudlink/ [复制] |
+--------+------------------------+--------------------------------------+---------------------------+
```

**布局**：外层是 `ResizablePanelGroup`（水平），用 `useDefaultLayout({ id: "assets" })` 持久化。

| 面板 | 默认 / 最小 / 最大 | 折叠 |
| :--- | :--- | :--- |
| 列表 | `"24%"` / `"220px"` / `"40%"` | 不可折叠 |
| 编辑器 | 弹性 / `"420px"` | 不可折叠；内部再纵向切分出探测面板（默认 `"30%"`，可折叠，`Ctrl+J`） |
| 预览 | `"34%"` / `"280px"` | 可折叠到 0。`Ctrl+\` 或工具栏按钮切换；窗口宽度小于 1200px 时默认折叠 |

> 注意：react-resizable-panels v4 中，数字尺寸按**像素**计算，字符串尺寸才按百分比，所以必须写成 `"24%"` 这样的形式。

**列表面板**

- 顶部是 `ToggleGroup`（资产类型；P0 只启用 VPS，其余类型禁用，并用 Tooltip 说明「v0.5 提供」），以及两个 `DropdownMenu`：「环境」（Checkbox 项）和「标签」。
- 列表本体使用 `Command`，设置 `shouldFilter={false}`，筛选由 Zustand 的 selector 完成，cmdk 只负责键盘导航和 listbox 语义。用 `CommandInput` 做搜索，`CommandGroup` 按「生产 / 预发 / 开发」分组。
- 每个 `CommandItem` 包含：
  - 左侧状态图标：表示探测状态，取值为从未探测、正常、已过期、失败。
  - 主标题：资产名称。
  - 副标题：别名（等宽字体）和操作系统。
  - 右侧：挂载数量。
- 当前打开的资产设置 `aria-current="true"`，使用 frost 底色和 `font-medium`。cmdk 的键盘高亮沿用默认的 `data-selected` 样式。两种状态要能区分开。
- 列表上方放一个主按钮「新建资产」，附带的 `DropdownMenu` 里有「从 ssh config 导入」。

**编辑器面板**

- 头部依次是：资产名（Title 字号）、环境徽章（描边加色点）、别名徽章（等宽字体）、探测状态和相对时间（`Intl.RelativeTimeFormat`）。右侧是「探测」「保存」两个按钮和一个「更多」菜单。更多菜单里有：复制 slug、在文件夹中显示编译目录、重命名迁移、删除资产（destructive，删除前弹出 `AlertDialog`，列出将被卸载的挂载）。
- 正文是 `Tabs`（`<TabsList variant="line">`），每个标签页的内容如下。

| 标签页 | 内容与组件 |
| :--- | :--- |
| 概览 | 名称（`Input`）；Slug（`InputGroup`，等宽字体，失焦时校验；已挂载则锁定，右侧有「重命名」按钮，打开 `Dialog`）；环境（`ToggleGroup` 单选）；云厂商和地域（`Combobox`，可选值来自已有资产）；标签（`Combobox` 多选，配 `ComboboxChips`）；用途（`Textarea`，带字数统计，内容会进入 description）；附加说明（`Textarea`） |
| 连接 | SSH 别名（`Combobox`，选项来自已解析的 ssh config，每项标注来源环境）；解析结果（只读的 `Item` 列表，展示 HostName、User、Port、ProxyJump，每行前有 `LockIcon`，旁边是「导出」`Switch`）；可达性（每个运行环境一行：「已定义」或「未定义，该环境的 Agent 无法连接」） |
| 路径 | 可排序的键值行：拖拽手柄、用途（`Input`）、路径（`Input`，等宽字体）、删除按钮。「添加路径」按钮，以及「从面板模板添加」菜单（1Panel 和宝塔的常用目录） |
| 服务 | `Table`，列为名称（等宽）、类型徽章、镜像、端口（`127.0.0.1:8080->8080` 格式）、角色（行内 `Input`）、关键（`Switch`）、来源徽章（探测 / 手动）、状态（「未发现」用琥珀色）。另有「手动添加」按钮 |
| 红线 | 默认档位：用 `RadioGroup` 做两张选择卡（只读巡检 / 标准运维），卡片里说明这个档位会生成什么。自定义红线：可排序的 `Textarea` 列表，可增删。内置红线：放在 `Collapsible` 里只读展示。顶部有一条 `Alert`：「红线是写给 Agent 的指令，不是技术隔离。需要硬隔离时，请为只读场景配置低权限 SSH 用户。」 |
| 挂载 | 本资产的挂载列表（目标、档位、状态），使用 `Item`；一个「挂载到…」`Combobox`；一个「在挂载中心查看」的链接 |

- 表单使用 react-hook-form 加 zodResolver，在失焦时校验。必填字段在标签后加「*」，并设置 `aria-required`。可排序的行由 `useFieldArray` 管理，拖拽结束后调用它的 `move()`。
- 字段分散在多个标签页里，提交时出错的字段可能不在当前标签页。因此保存校验失败时，要做三件事：
  1. 在每个出错的 `TabsTrigger` 上显示错误数量的 `Badge`。
  2. 自动切换到第一个出错的标签页。
  3. 等该标签页渲染完成后，再调用 RHF 的 `setFocus(name)`，把焦点移到出错字段。不能只依赖 `shouldFocusError`，因为未激活标签页里的字段可能还没挂载。
- 保存期间，「保存」按钮显示 `Spinner` 并禁用，防止重复提交。
- 有未保存修改时，标题旁显示「未保存」。按 `Ctrl+S` 保存；在有未保存修改的情况下离开当前资产，弹出 `AlertDialog`，选项为「放弃修改 / 继续编辑」。
- 保存成功后，头部状态行显示「已保存，已编译」（带 `CircleCheckIcon`），不弹 Toast。编译受阻时，状态行显示红色「编译受阻：N 个错误」，点击后预览面板定位到对应的 Lint 项。

**预览面板**

- 头部有三部分：文件切换（`Tabs`：SKILL.md 和各个 references 文件）、档位选择（`Select`）、渲染与源码切换（`ToggleGroup`）。
- 预算区：三项 Token 估算，用 `Item size="xs"` 加 `Tooltip`；两条 `Progress` 分别表示 description 字符数和正文行数（阈值规则见 DESIGN.md）。
- Lint 区：用 `Item` 列表展示错误和警告，带图标。点击后定位到源码视图的对应行。
- 内容区：渲染视图用 `streamdown`，外面包 `div.typeset`；源码视图用 `CodeBlock` 加 `useHighlightedCode(content, "markdown")` 和行号。
- 底部：发布路径（等宽字体，截断显示），以及「复制路径」「在文件夹中显示」两个操作。
- 有未保存修改时，标题显示「草稿预览」，并注明「保存后发布」。草稿预览的编译请求做 200ms 防抖，并且只取最后一次请求的结果，较早返回的结果直接丢弃。

### 6.5 探测流程

1. 点击「探测」后，编辑器底部的探测面板自动展开，用 `Trace` 实时显示每个步骤：解析别名、建立连接、采集系统信息、采集服务、采集监听端口、生成差异。运行中的步骤设置 `status="running"`，失败的设置 `status="error"`。每一步右侧的 `TraceDescription` 显示耗时。
2. 探测过程中，「探测」按钮变为「取消探测」。用户可以离开当前资产，探测在后台继续。完成后用 Toast 通知，附「查看」按钮。
3. 有差异时，面板切换到「审阅变更」：

```text
+----------------------------------------------------------------------------+
| 探测结果  hk-edge  2026-10-27 14:02  用时 3.1s                  [收起]     |
+----------------------------------------------------------------------------+
| [v]  + 新增服务   api-gateway  my-api:v1.2  127.0.0.1:8080->8080           |
| [v]  ~ 系统       Ubuntu 22.04 -> Ubuntu 24.04                             |
| [ ]  - 未发现     old-worker（保留标注，标记为「未发现」）                 |
| [v]  ~ 监听端口   新增 9090/tcp                                            |
+----------------------------------------------------------------------------+
| [查看探测脚本]  [全部忽略]                       [应用所选 3 项并编译]     |
+----------------------------------------------------------------------------+
```

- 每条变更是一个 `Item`，左侧是 `Checkbox`，展开后用 `CodeBlockLine`（`added` 或 `removed`）展示前后对比。
- 没有差异时，面板只显示一行：「未发现变更，已更新探测时间」。
- 失败时，`Trace` 的最后一步显示错误，下方用 `Alert variant="destructive"` 给出分类文案和建议（见 8.3）。如果建议需要用户在终端里执行命令，例如 `ssh hk-edge`，就用 `CodeBlock` 配复制按钮展示这条命令。

### 6.6 挂载视图（Dispatcher）

工具栏从左到右依次是：视图切换 `ToggleGroup`（看板 / 矩阵）、环境筛选 `Select`、「添加项目」按钮、「检查全部链接」（`RefreshCwIcon`）按钮，最右边是健康摘要，例如「12 个挂载，1 个失效，0 个冲突」，用状态徽章展示。

只要有生产资产挂在全局目标上，工具栏下方就常驻一条 `Alert`（带 `ShieldAlertIcon`），文案为：「2 个生产资产挂在全局目标上，所有项目中对应的 Agent 都能看到它们。」右侧的 `AlertAction` 是「查看」，点击后切到矩阵视图，只显示这些挂载。这条提示不能关闭，全部取消后才会消失。

**看板模式**

```text
+----------------------------------------------------------------------------------------------------+
| [i] Agent 视角：Codex @ OpenPet-Desktop (WSL)  可见 2 个（项目 1、全局 1），1 个已失效  [退出视角] |
+----------------------------+-----------------------------------------------------------------------+
| 搜索 Skill                 | 全局 Agent                                                            |
|                            +-----------------------------------+-----------------------------------+
| 生产                       | Claude Code - Windows  [视角][...]| 通用 .agents - WSL Ubuntu [...]   |
| :: vps-hk-edge 只读 可见   | ~\.claude\skills                  | ~/.agents/skills                  |
| :: vps-sg-db 标准 已失效   | [眼] vps-hk-edge 已挂载(复制) [x] | [扳手] vps-dev-box  已挂载  [x]   |
|                            | 拖入 Skill 以挂载                 | 拖入 Skill 以挂载                 |
|                            +-----------------------------------------------------------------------+
| 开发                       | 项目                                                                  |
|                            +-----------------------------------+-----------------------------------+
| :: vps-dev-box 标准 可见   | OpenPet-Desktop  WSL  [视角][...] | Blog-Astro  Windows  [视角][...]  |
|                            | .claude + .agents  已排除 git     | .claude  已排除 git               |
|                            | [扳手] vps-hk-edge  已挂载  [x]   | [!] blog-cdn  冲突  [查看]        |
|                            | [眼] vps-sg-db  已失效  [修复]    | 拖入 Skill 以挂载                 |
+----------------------------+-----------------------------------+-----------------------------------+
```

- 左侧是 Skill 源列表，每项都可以拖拽：`useDraggable` 绑定在 `GripVerticalIcon` 手柄上。每项还有一个「挂载到…」`DropdownMenu`，菜单里用 Checkbox 项列出全部目标，这是不用拖拽的替代入口。
- 右侧是目标卡片，使用 `Card size="sm"`，每张卡都是一个 `useDroppable` 区域。
  - 卡片头：名称、运行环境、路径（等宽、截断）、`CardAction`。CardAction 里的菜单包含：以此视角查看（项目卡片上是子菜单，列出该环境中读取已启用约定目录的 Agent）、链接方式（自动 / 链接 / 复制，Radio 项）、在文件夹中显示、检查链接、移除目标。
  - 卡片内容：一组挂载芯片（规格见 DESIGN.md）。没有挂载时显示「拖入 Skill 以挂载」。
- 拖拽过程：
  1. 拖起时，`DragOverlay` 渲染芯片样式的副本，略微放大并加 Lifted 阴影。
  2. 悬停在某个目标上时，那张卡片用信号色高亮（`ring-2 ring-ring` 加 `bg-ring/8`）。
  3. 放下后，依次进行三项校验：如果是生产资产挂到全局，弹 `AlertDialog` 确认；如果已经挂载过，用 Toast 提示「已在此目标挂载」；如果别名在该环境里不可达，弹 `AlertDialog` 说明风险，仍然可以继续。
  4. 校验通过后执行挂载（乐观更新：芯片先以 `pending` 状态出现，带 `Spinner`）。成功后弹出 Toast，描述里写明该 Agent 怎样才会生效（规则见 F-303 AC4），例如「Claude Code 会话已在运行时，请执行 /reload-skills」。
- 键盘：dnd-kit 的 `KeyboardSensor` 方案是空格拿起、方向键在目标之间移动、空格放下、Esc 取消。屏幕阅读器播报文案见 6.13。
- 卸载：点击芯片上的关闭按钮后立即卸载，并弹出 Toast「已卸载 vps-hk-edge」，带「撤销」按钮（重新挂载）。
- **Agent 视角**：在目标卡片的菜单里选「以此视角查看 > 某个 Agent」，或者在矩阵中点击列头（项目列会弹出 Agent 选择），就进入视角模式。可见集合的计算规则见 F-306，行为规范见 DESIGN.md 的 Agent Lens 一节。视角状态存放在 `useUIStore.lens = { targetId, agent }`。

**矩阵模式**

```text
+--------------------------+--------------+--------------+--------------+--------------+--------------+
| Skill / 目标             | Claude Code  | 通用 .agents | OpenPet-Desk | Blog-Astro   | infra-tools  |
|                          | 全局 Win     | 全局 WSL     | 项目 WSL     | 项目 Win     | 项目 WSL     |
+--------------------------+--------------+--------------+--------------+--------------+--------------+
| vps-hk-edge   (o 生产)   | [开] 只读    | [关]         | [开] 标准    | [关]         | [关]         |
| vps-sg-db     (o 生产)   | [关]         | [关]         | [开] 只读 !  | [关]         | [关]         |
| vps-dev-box   (o 开发)   | [关]         | [开] 标准    | [关]         | [关]         | [开] 只读    |
+--------------------------+--------------+--------------+--------------+--------------+--------------+
```

- 使用 `Table` 放在 `ScrollArea` 里。第一列 sticky（`sticky left-0 bg-background`），列头按「全局 Agent」和「项目」分组。
- 每个单元格包含：一个 `Switch`（`aria-label="将 vps-hk-edge 挂载到 OpenPet-Desktop"`），开启后出现档位图标按钮（`Button size="icon-xs" variant="ghost"`，点击打开带 Radio 项的 `DropdownMenu`），以及状态图标（失效或冲突，悬停时用 `Tooltip` 解释）。
- 右键单元格打开 `ContextMenu`，菜单项有：切换档位、修复、在文件夹中显示。
- 打开开关和在看板里拖拽走的是同一个挂载管线，二次确认规则也完全一样。

### 6.7 Skills 视图

```text
+--------+---------------------------------------------------------+-------------------------------------+
| 侧栏   | 搜索   状态 [全部 v]                     [新建业务包 P1]| vps-hk-edge                  [...]  |
|        +---------------------------------------------------------+-------------------------------------+
|        | Skill          来源       变体        状态   常驻  挂载 | 来源 hk-edge  变体 只读、标准       |
|        | vps-hk-edge    hk-edge    只读 标准   正常   ~86    3   | （与资产视图预览面板相同的组件）    |
|        | vps-sg-db      sg-db      只读        警告   ~140   1   | 文件 / 预算 / Lint / 内容           |
|        | vps-dev-box    dev-box    标准        受阻   -      0   |                                     |
+--------+---------------------------------------------------------+-------------------------------------+
```

- 左边是 `Table`，可以按状态筛选。MVP 阶段表格不提供点击列头排序，需要排序的地方用「排序」下拉菜单代替，避免自己实现排序交互和 `aria-sort`。右边的详情直接复用资产视图的预览面板组件（`SkillPreview`），只额外增加「变体」和「挂载」两个摘要。
- P1 的「新建业务包」在 `Dialog` 中完成：填写名称和 slug；用 `Combobox` 多选资产；成员顺序用 dnd-kit 的 sortable 调整；description 可以覆盖。

### 6.8 活动视图

- 按天分组，分页加载（每次 100 条，底部有「加载更多」按钮），不引入虚拟列表库。每条记录是一行 `TraceLine`。图标按类型区分：探测 `RadarIcon`、编译 `HammerIcon`、挂载 `LinkIcon`、卸载 `UnlinkIcon`、修复 `WrenchIcon`。标题写成完整的句子，例如「探测了 hk-edge，发现 2 处变更」；`TraceDescription` 显示耗时。
- 有详情的记录用 `TraceCollapsible` 展开，里面用 `CodeBlock size="sm"` 展示执行过的命令清单或差异摘要。
- 筛选：类型用 `ToggleGroup`，资产用 `Combobox`。

### 6.9 设置视图

左侧是用 `Item` 做的分区导航，右侧是对应表单（`FieldSet`）。

| 分区 | 内容 |
| :--- | :--- |
| 通用 | 主题（跟随系统 / 浅色 / 深色）；编译产物语言（v0.1 固定英文，P1 起可切换）。v0.1 的界面只有简体中文，不提供界面语言切换 |
| 运行环境 | 已检测到的环境列表，每项有启用开关；重新检测按钮 |
| Agent 目标 | 全局目标列表；启用或创建目录；添加自定义目录；每个目标的链接方式（自动 / 链接 / 复制），Windows 上的「Junction（实验）」开关 |
| 编译 | 正文行数上限（默认 60）；是否在 SKILL.md 中写入数据快照时间；默认档位 |
| 探测 | 超时时间；查看探测脚本（`CodeBlock`，语言为 bash，只读）；主机密钥策略固定为严格校验，只展示，不提供选项 |
| 数据 | 数据目录；打开日志目录；导出或导入 JSON（P1） |
| 危险操作 | 卸载全部挂载、清空数据。都使用 destructive 按钮并配 `AlertDialog`，确认时要求输入「卸载全部」 |

### 6.10 导入、添加项目、首次启动

**从 ssh config 导入**（`Dialog`，宽度 lg）

```text
+--------------------------------------------------------------------------------------------------+
| 从 ssh config 导入主机                                                                    [x]    |
| 已扫描：Windows  C:\Users\me\.ssh\config      WSL Ubuntu-24.04  ~/.ssh/config                    |
+------+------------------+--------------------+----------+------+------------------+--------------+
| [v]  | 别名             | HostName           | User     | Port | 来源环境         | 状态         |
+------+------------------+--------------------+----------+------+------------------+--------------+
| [v]  | hk-edge          | 203.0.113.10       | root     | 22   | WSL              | 新           |
| [ ]  | sg-db            | 198.51.100.7       | deploy   | 2222 | Windows、WSL     | 已导入       |
| [v]  | dev-box          | 192.0.2.44         | ubuntu   | 22   | Windows          | 新           |
+--------------------------------------------------------------------------------------------------+
| 已跳过 2 个通配 Host（Host *、Host *.internal）                     [ ] 导入后立即探测           |
|                                                                         [取消]  [导入 2 台]      |
+--------------------------------------------------------------------------------------------------+
```

- 表格用 `Table` 配 `Checkbox`，表头的复选框可以全选。HostName 等信息只在本地展示。
- 导入后，新资产在列表中以 Motion 的进入动画出现，并自动选中第一项。

**添加项目**（先用 `@tauri-apps/plugin-dialog` 的 `open({ directory: true })` 选目录，再打开 `Dialog`）

- 表单字段：名称（默认取文件夹名）；路径（只读）；运行环境（按路径自动判断，只读）；约定目录（`Checkbox`：`.claude/skills`，说明「Claude Code」；`.agents/skills`，说明「Codex、Cursor、Gemini CLI、Copilot、OpenCode 等」）。软件根据仓库里已存在的目录预先勾选。
- 一个 `Switch`：「把链接路径写入 .git/info/exclude（推荐）」。如果仓库不是 Git 仓库，这个开关禁用，并说明原因。

**首次启动**：资产视图显示空状态，使用 `Empty` 组件：

```text
+--------+-------------------------------------------------------------------------------------------+
| 侧栏   |                                    [ServerIcon]                                           |
|        |                               还没有任何云资产                                            |
|        |  CloudLink 把服务器信息编译成 Agent 能读的 Skill，并且只挂给需要它的项目。           |
|        |                                                                                           |
|        |   (v) 1 检测运行环境与 Agent     已发现 Windows、WSL Ubuntu；Claude Code、Codex           |
|        |   ( ) 2 从 ~/.ssh/config 导入主机                                   [开始导入]            |
|        |   ( ) 3 探测并挂载到第一个项目                                                            |
|        |                                                                                           |
|        |                              或者 [手动新建资产]                                          |
+--------+-------------------------------------------------------------------------------------------+
```

清单的每一步是一个 `Item`，`ItemMedia` 显示 `CircleCheckIcon` 或 `CircleDashedIcon`。全部完成后，这个清单不再出现。

### 6.11 状态全集（每个视图都必须实现）

| 场景 | 状态 | 呈现 |
| :--- | :--- | :--- |
| 首次加载数据 | 加载中 | 列表和编辑器用 `Skeleton`（超过 150ms 才显示）；按钮内用 `Spinner` |
| 列表为空 | 空 | `Empty` 组件，写明下一步要做什么（例如导入、新建、添加项目） |
| 筛选无结果 | 空 | `CommandEmpty`：「没有匹配的资产」，附「清除筛选」按钮 |
| IPC 调用失败 | 错误 | `Alert variant="destructive"`，附「重试」；严重错误时追加「打开日志目录」 |
| 对话框里有未提交的改动 | 防误关 | 关闭（Esc、点击遮罩、关闭按钮）前弹出 `AlertDialog`：「放弃更改 / 继续编辑」 |
| 探测 | 运行中、成功、无变更、有变更、失败、已取消 | 见 6.5 |
| 编译 | 正常、警告、受阻 | 编辑器头部状态行加预览面板的 Lint 区 |
| 挂载 | `pending`、`ok`、`broken`、`conflict`、`stale-copy`、`alias-missing` | 挂载芯片和矩阵单元格的图标加状态词；状态词表见 6.13 |
| 未保存修改 | 草稿 | 标题旁显示「未保存」，预览标为「草稿预览」 |
| 长内容 | 溢出 | 名称和路径用 `truncate` 加 `Tooltip`；表格横向滚动；芯片自动换行 |
| 窗口缩窄 | 小于 1200 / 1024px | 预览默认折叠 / 侧栏进入图标模式 |

### 6.12 键盘与命令面板

| 快捷键（macOS 用 Cmd） | 作用 |
| :--- | :--- |
| `Ctrl+K` | 打开命令面板（`CommandDialog`） |
| `Ctrl+S` | 保存当前资产 |
| `Ctrl+B` | 折叠或展开侧栏（shadcn Sidebar 内置） |
| `Ctrl+\` | 折叠或展开预览面板 |
| `Ctrl+J` | 折叠或展开探测面板 |
| `/` | 聚焦列表搜索框 |
| `Ctrl+1` 到 `Ctrl+5` | 切换一级视图 |
| `Esc` | 关闭浮层，退出 Agent 视角，取消拖拽 |

命令面板分四组：

- **跳转**：五个视图。
- **资产**：按名称或别名搜索后打开。
- **操作**：新建资产、从 ssh config 导入、探测当前资产、探测全部、检查全部链接、切换主题。
- **挂载**：「挂载当前 Skill 到…」，进入二级页列出全部目标。

### 6.13 文案规范与状态词表

- 界面状态词只用中文，禁止「Mounted (已挂载)」这种中英混写。专有名词保留英文：Skill、SSH、Agent、slug、Token。
- 按钮写动作，例如「导入 2 台」「应用所选 3 项并编译」，不要写「确定」。
- 错误文案写清楚两件事：出了什么问题，接下来怎么办。例如「hk-edge 拒绝了密钥认证。在终端运行 ssh-add -l 确认密钥已加载。」

| 对象 | 状态词 |
| :--- | :--- |
| 挂载 | 挂载中、已挂载、已挂载（复制）、已失效、冲突、复制模式待同步、别名不可达 |
| 探测 | 从未探测、探测中、正常、已过期（超过 30 天）、失败 |
| 编译 | 正常、有警告、编译受阻 |
| 环境 | 生产、预发、开发 |
| 档位 | 只读巡检、标准运维 |

dnd-kit 的屏幕阅读器播报文案：

| 时机 | 文案 |
| :--- | :--- |
| 拿起 | 「已拿起 vps-hk-edge。用方向键选择目标，空格放下，Esc 取消。」 |
| 悬停 | 「当前位于 OpenPet-Desktop。」 |
| 放下 | 「已挂载到 OpenPet-Desktop。」 |
| 取消 | 「已取消挂载。」 |

### 6.14 可访问性

- 达到 WCAG 2.2 AA。焦点环使用 Signal Cyan，在浅色主题下对比度为 3.6:1，在深色主题下为 8.3:1。
- 所有纯图标按钮都要有 `aria-label` 和 `Tooltip`。
- 状态必须同时用图标、文字和颜色表达，不能只靠颜色。
- 拖拽有两种替代方式：键盘拖拽，以及矩阵视图和「挂载到…」菜单。
- 异步操作的结果通过 Toast 播报（Toast 带 aria-live）。
- 根节点设置 `MotionConfig reducedMotion="user"`，尊重系统的「减少动态效果」设置。
- 最小点击目标为 24×24px（Nova 的 xs 尺寸）。
- 在侧栏之前放一个「跳到主内容」链接，只有获得焦点时才显示。切换一级视图后，焦点移到新视图的标题上（标题设置 `tabIndex={-1}`）。视图标题用 `h1`，分区用 `h2`，层级不跳级。
- 在 `tauri.conf.json` 的窗口配置里开启 `zoomHotkeysEnabled: true`，支持 Ctrl 加减号缩放。在 150% 缩放和 1280px 窗口宽度下，布局不能被破坏。
- 按钮沿用桌面原生的箭头光标，不改成手形（初始化时加 `--no-pointer`）。

---

## 七、前端工程规范：依赖白名单与「禁止自造」

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
| 动画 | `motion`（从 `motion/react` 引入） | 14.x |
| 布局 | `react-resizable-panels`（通过 shadcn `resizable` 安装） | 4.15 |
| 拖拽 | `@dnd-kit/core`、`@dnd-kit/sortable`、`@dnd-kit/utilities`、`@dnd-kit/modifiers` | 6.3 / 10.0 / 3.2 / 9.0 |
| 状态 | `zustand` | 5.0 |
| 表单 | `react-hook-form`、`zod`、`@hookform/resolvers` | 7.9x / 4.x / 6.x |
| 列表与命令面板 | `cmdk`（通过 shadcn `command` 安装） | 1.1 |
| 代码高亮 | `shiki`（通过 shadcn `code-block` 安装，使用 JS 正则引擎） | 4.5 |
| Markdown 渲染 | `streamdown`，样式用 shadcn typeset（一个 CSS 文件，不是 npm 包） | 2.7 |
| 快捷键 | `react-hotkeys-hook` | 5.3 |
| 等宽字体 | `@fontsource-variable/jetbrains-mono` | 5.x |
| Tauri 前端 API | `@tauri-apps/api`、`@tauri-apps/plugin-dialog`、`@tauri-apps/plugin-opener` | 2.x |
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
  @fontsource-variable/jetbrains-mono@^5 @tauri-apps/api@^2 @tauri-apps/plugin-dialog@^2 @tauri-apps/plugin-opener@^2
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

### 7.3 需求 → 唯一实现映射表

| 需求或交互行为 | 必须使用的实现 | 禁止 |
| :--- | :--- | :--- |
| 应用导航、侧栏折叠、计数徽章 | `Sidebar`（`collapsible="icon"`）、`SidebarMenuButton isActive`、`SidebarMenuBadge`、`SidebarTrigger` | 自写侧栏或折叠逻辑 |
| 多栏布局、拖拽分隔条、面板折叠、布局持久化 | `ResizablePanelGroup`、`ResizablePanel`（`collapsible`、`minSize`、`panelRef`）、`ResizableHandle`。用 `const { defaultLayout, onLayoutChanged } = useDefaultLayout({ id })` 拿到两个值，传给 `ResizablePanelGroup`；每个面板都要有稳定的 `id`；折叠和展开调用 `panelRef.current.collapse()` 和 `expand()` | 自写分隔条；使用 CSS resize |
| 可筛选、可用键盘导航的选择列表（资产列表、Skill 源列表） | `Command`（`shouldFilter={false}`）、`CommandInput`、`CommandList`、`CommandGroup`、`CommandItem`、`CommandEmpty` | 自写 roving tabindex 或方向键处理 |
| 命令面板 | `CommandDialog` | 自写弹层 |
| 快捷键 | `react-hotkeys-hook` 的 `useHotkeys("mod+k", fn, { preventDefault: true, enableOnFormTags: true })`。`mod` 同时匹配 Ctrl 和 Cmd。提示文字用 `Kbd` 或 `KbdGroup` | 自己监听 `window` 的 keydown |
| 表单状态、校验、脏标记、动态行 | react-hook-form、`zodResolver`、`useFieldArray`；外观用 `Field`、`FieldLabel`、`FieldDescription`、`FieldError`、`FieldSet`、`FieldLegend` | 自写表单状态和校验；用占位符代替标签 |
| 可排序列表（路径、红线、业务包成员） | `DndContext`、`SortableContext`（`verticalListSortingStrategy`）、`useSortable`，配合 `KeyboardSensor` 与 `sortableKeyboardCoordinates`、`restrictToVerticalAxis`；拖拽结束后调用 RHF 的 `move()`。`useFieldArray` 必须设置 `keyName: "key"` | HTML5 原生拖放；自写排序 |
| 跨区域拖拽挂载 | `DndContext`、`useDraggable`、`useDroppable`、`DragOverlay`，`accessibility.announcements` 使用 6.13 的文案。`PointerSensor` 设置 `activationConstraint: { distance: 4 }`，指针移动超过 4px 才开始拖拽，避免误拖 | HTML5 原生拖放 |
| 开关矩阵 | `Table`、`Switch`、`ScrollArea`，sticky 列用 Tailwind 的 `sticky left-0` | 自写网格或虚拟表格 |
| 状态徽章和环境徽章 | `Badge`。在 `badge.tsx` 的 cva 中新增 `success` 和 `warning` 变体（直接改源码） | 另外写一个 Pill 或 Tag 组件 |
| 列表行、设置项、挂载芯片、清单项 | `Item` 系列（`ItemMedia`、`ItemContent`、`ItemTitle`、`ItemDescription`、`ItemActions`） | 自写行组件 |
| 目标卡片（拖放区域） | `Card size="sm"`、`CardHeader`、`CardAction`、`CardContent` | 卡片里再嵌套卡片 |
| 空状态 | `Empty`、`EmptyMedia`、`EmptyTitle`、`EmptyDescription`、`EmptyContent` | 只写一行「暂无数据」 |
| 加载中 | `Skeleton`（首屏加载）、`Spinner`（按钮内或行内） | 自写 loading 动画 |
| 步骤进度和日志行（探测、活动） | `Trace`、`TraceLine status`、`TraceCollapsible` | 自写 Stepper |
| 源码、diff、日志、命令展示 | `CodeBlock`、`CodeBlockLine variant`、`CodeBlockCopyButton`、`useHighlightedCode` | prism、highlight.js、CodeMirror、Monaco |
| Markdown 渲染 | `streamdown`，外层包 `div.typeset` | react-markdown、`@tailwindcss/typography` |
| 通知 | shadcn `Toast`（Base UI 实现）：`toast.add`、`toast.close`、`toast.promise`、`actionProps`。默认 5 秒后自动消失；带「撤销」按钮的 Toast 停留 8 秒。Toast 不抢焦点 | sonner、react-hot-toast、`alert()` |
| 危险操作确认 | `AlertDialog` | `window.confirm` |
| 较复杂的编辑流程（导入、添加项目、重命名、新建业务包） | `Dialog` | 自写模态框 |
| 菜单 | `DropdownMenu`（Checkbox 和 Radio 项）、`ContextMenu` | 自写弹出菜单 |
| 提示 | `Tooltip`（全局包一层 `TooltipProvider`） | 只写 `title` 属性 |
| 选择器 | `Select`（固定选项）、`Combobox`（可搜索、多选标签、SSH 别名） | 自写下拉框 |
| 分段选择 | `ToggleGroup` | 用按钮组模拟 |
| 标签页 | `Tabs`，二级切换用 `<TabsList variant="line">` | 自写标签页 |
| 折叠区域 | `Collapsible` | 自写折叠动画 |
| 滚动容器 | `ScrollArea` | 自定义滚动条 CSS |
| 进度条（上限占用） | `Progress`。在 `progress.tsx` 中新增 `tone` 属性（default、warning、destructive），用来给指示条变色，见 7.6 | 自写进度条 |
| 选择目录、在文件管理器中显示 | `@tauri-apps/plugin-dialog` 的 `open({ directory: true })`；`@tauri-apps/plugin-opener` 的 `revealItemInDir` | 无 |
| 复制到剪贴板 | `CodeBlockCopyButton`，其他场景用 `navigator.clipboard.writeText` | 引入剪贴板库 |
| 相对时间和数字格式化 | `Intl.RelativeTimeFormat`、`Intl.NumberFormat`，统一封装在 `src/lib/format.ts` | dayjs、date-fns、moment |
| 主题切换 | shadcn Vite 模板自带的 `src/components/theme-provider.tsx`：用 `ThemeProvider` 包住根节点，在需要的地方调用 `useTheme().setTheme("system" \| "light" \| "dark")`。删除模板里默认的「按 d 键切换主题」那段监听，主题切换只放在设置页和命令面板里 | next-themes；在 store 里重新实现一套主题逻辑 |
| 动画 | `motion/react`（`AnimatePresence`、`layout`、`MotionConfig`），浮层动画沿用组件自带的 | framer-motion 这个包名；手写 keyframes |
| 图标 | `lucide-react`，用 `XxxIcon` 的命名导入 | 其他图标库、emoji、内联 SVG |
| 类名合并 | 从 `@/lib/utils` 引入 `cn` | 直接用 clsx 或 tailwind-merge |
| 全局状态 | zustand v5，使用 `useShallow`；只有 UI 偏好用 `persist` 持久化 | Redux、Jotai、用 React Context 管全局状态 |
| 后端调用 | 只能通过 `src/lib/ipc.ts` 调用 `invoke`；后端事件只能由 `src/lib/events.ts` 订阅 | 在组件里直接调用 `invoke` 或 `listen` |

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
- 后端事件由 `src/lib/events.ts` 在应用启动时统一订阅，再分发给各个 store。

| Store | 状态 | 动作 | 持久化 |
| :--- | :--- | :--- | :--- |
| `useUIStore` | `view`、`selectedAssetId`、`selectedSkillId`、`assetFilter`（query、types、envTags、tags）、`mountsMode`（board 或 matrix）、`lens`（`{ targetId, agent }` 或 null）、`commandOpen`。主题不放在这里，由 ThemeProvider 管理 | `setView`、`selectAsset`、`setFilter`、`setLens` | 只持久化 `mountsMode`、`assetFilter.types` 和 `assetFilter.envTags` |
| `useAssetStore` | `byId`、`ids`、`status`、`error` | `load`、`save`（返回编译结果）、`remove`、`importHosts` | 否 |
| `useProbeStore` | `runs`（按 runId 索引）、`activeRunByAsset` | `start`、`cancel`、`apply`；`_onProgress`、`_onFinished` 由事件桥调用 | 否 |
| `useSkillStore` | `statusById`（每个变体的 Lint、Token、编译时间） | `refresh`、`_onCompiled` | 否 |
| `useTargetStore` | `environments`、`targets` | `detect`、`addProject`、`removeTarget` | 否 |
| `useMountStore` | `byId` | `mount`（乐观更新，失败时回滚并弹 Toast）、`unmount`（立即生效，Toast 提供撤销，撤销即重新挂载）、`setMode`、`checkAll`、`repair`；`_onChanged` | 否 |
| `useActivityStore` | `items` | `load`、`_onNew` | 否 |

需要提供的 selector：

- `selectFilteredAssets(state, filter)`：资产列表的筛选结果。
- `selectMountsByTarget(targetId)`：某个目标下的挂载。
- `selectVisibleSkills(lens)`：Agent 视角的可见集合，计算规则见 F-306。返回 `{ project: Skill[], global: Skill[], unhealthy: Mount[] }`。这是纯函数，必须有单元测试，至少覆盖「WSL 项目 + Windows 全局」和「Codex 与 Claude Code 读取不同约定目录」两种情况。
- `selectHealth()`：返回失效、冲突、受阻的数量。

### 7.6 设计令牌落地（`src/index.css`）

在 shadcn 生成的 `index.css` 基础上做以下修改。数值以 DESIGN.md 的 frontmatter 为准，两处不一致时以 DESIGN.md 为准。

```css
@import "tailwindcss";
@import "tw-animate-css";
@import "shadcn/tailwind.css";
@import "@fontsource-variable/jetbrains-mono";   /* 替换生成时的 @fontsource-variable/inter */
@import "./typeset.css";

@custom-variant dark (&:is(.dark *));

@theme inline {
  --font-sans: system-ui, "Segoe UI Variable Text", "Segoe UI", "PingFang SC", "Microsoft YaHei UI", "Noto Sans CJK SC", sans-serif;
  --font-heading: var(--font-sans);
  --font-mono: "JetBrains Mono Variable", "Cascadia Mono", "SF Mono", ui-monospace, Menlo, Consolas, monospace;
  --color-success: var(--success);
  --color-warning: var(--warning);
  /* 其余 --color-* 和 --radius-* 保留 shadcn 生成的内容，不要改 */
}

:root {
  /* 其余变量保留 preset 生成的值（mist），只覆盖或新增下面几项 */
  --muted-foreground: oklch(0.52 0.021 213.5);   /* 覆盖：0.56 改为 0.52，使它在 muted 底色上达到 4.91:1 */
  --ring: oklch(0.609 0.126 221.723);            /* 覆盖：Signal Cyan */
  --sidebar-ring: oklch(0.609 0.126 221.723);
  --success: oklch(0.508 0.118 165.612);
  --warning: oklch(0.555 0.163 48.998);
}

.dark {
  --ring: oklch(0.715 0.143 215.221);
  --sidebar-ring: oklch(0.715 0.143 215.221);
  --sidebar-primary: oklch(0.925 0.005 214.3);   /* 覆盖：去掉 preset 默认的蓝色，与 primary 保持一致 */
  --success: oklch(0.765 0.177 163.223);
  --warning: oklch(0.828 0.189 84.429);
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
- 只允许以下 5 个场景，范围之外不加动效：

| 场景 | 实现 | 时长 |
| :--- | :--- | :--- |
| 挂载芯片的进入和离开 | `AnimatePresence`，配合 `layout`、`initial={{opacity:0,y:4}}` | 进入 180ms，离开 120ms |
| Agent 视角标记的出现和消失 | 可见与不可见的图标、描边包在 `AnimatePresence` 里，用 `initial={{opacity:0}}` 做透明度过渡；**禁止降低列表项本身的透明度**（会让对比度降到 2.34:1） | 150ms |
| 拖起和放下 | `DragOverlay` 里的元素 `animate={{ scale: 1.02 }}` 加 Lifted 阴影；`dropAnimation` 使用 dnd-kit 默认值 | 150ms |
| 探测步骤逐条出现 | 新的 `TraceLine` 包在 `motion.div` 里，`initial={{opacity:0,y:4}}` | 150ms |
| 导入后新增的列表项 | `AnimatePresence` | 180ms |

- 浮层（Dialog、Popover、DropdownMenu、Tooltip、Sheet、Collapsible、Toast）使用组件自带的动画，禁止再用 Motion 包一层。
- 禁止：页面加载时的错峰入场、悬停时放大回弹、`bounce` 大于 0 的 spring、装饰性的循环动画。

### 7.8 IPC 契约与 Mock 模式

- 类型由 Rust 结构体经 ts-rs 生成，放在 `src/bindings/`，禁止手改。
- 所有命令都封装在 `src/lib/ipc.ts`：

```ts
import { invoke } from "@tauri-apps/api/core";
export const ipc = {
  detectEnvironments: () => invoke<Environment[]>("detect_environments"),
  listSshHosts: (envId?: EnvId) => invoke<SshHost[]>("list_ssh_hosts", { envId }),
  listAssets: () => invoke<Asset[]>("list_assets"),
  saveAsset: (input: AssetInput) => invoke<SaveResult>("save_asset", { input }),
  deleteAsset: (id: string) => invoke<DeleteResult>("delete_asset", { id }),
  importHosts: (hosts: ImportHost[], probeAfter: boolean) => invoke<Asset[]>("import_hosts", { hosts, probeAfter }),
  startProbe: (assetId: string) => invoke<{ runId: string }>("start_probe", { assetId }),
  cancelProbe: (runId: string) => invoke<void>("cancel_probe", { runId }),
  applyProbe: (runId: string, changeIds: string[]) => invoke<SaveResult>("apply_probe", { runId, changeIds }),
  previewCompile: (input: AssetInput, mode: Mode) => invoke<CompilePreview>("preview_compile", { input, mode }),
  listSkills: () => invoke<SkillStatus[]>("list_skills"),
  listTargets: () => invoke<Target[]>("list_targets"),
  inspectProject: (path: string) => invoke<ProjectInspection>("inspect_project", { path }),
  addProjectTarget: (req: AddProjectRequest) => invoke<Target>("add_project_target", { req }),
  removeTarget: (id: string) => invoke<void>("remove_target", { id }),
  listMounts: () => invoke<Mount[]>("list_mounts"),
  mount: (req: MountRequest) => invoke<Mount>("mount", { req }),
  unmount: (mountId: string) => invoke<void>("unmount", { mountId }),
  setMountMode: (mountId: string, mode: Mode) => invoke<Mount>("set_mount_mode", { mountId, mode }),
  checkMounts: () => invoke<Mount[]>("check_mounts"),
  repairMount: (mountId: string) => invoke<Mount>("repair_mount", { mountId }),
  listActivity: (q: ActivityQuery) => invoke<ActivityItem[]>("list_activity", { q }),
  getSettings: () => invoke<Settings>("get_settings"),
  updateSettings: (patch: Partial<Settings>) => invoke<Settings>("update_settings", { patch }),
  getProbeScript: () => invoke<string>("get_probe_script"),
};

export interface CompilePreview {
  slug: string; mode: Mode;
  files: { path: string; content: string; tokens: number }[];   // SKILL.md 排在第一个
  budget: { resident: number; triggered: number; onDemand: number;
            descriptionChars: number; bodyLines: number; bodyLineLimit: number };
  lint: { id: LintId; level: "error" | "warning" | "info"; params?: Record<string, string | number>; file?: string; line?: number }[];
  // 后端只返回 id 和参数，不返回中文句子；界面文案由 src/lib/copy.ts 按 id 映射（探测错误分类同理）
  blocked: boolean;                                              // 有 error 级 Lint 时为 true，此时不会发布
}
```

后端事件（只在 `src/lib/events.ts` 中订阅）：

| 事件 | 载荷 |
| :--- | :--- |
| `probe://progress` | `{ runId, step, status, ms? }` |
| `probe://finished` | `{ runId, status, error?, diff? }` |
| `mounts://changed` | `{ mounts }` |
| `compile://finished` | `{ skillId, mode, lint, tokens }` |
| `activity://new` | `{ item }` |

**Mock 模式**：运行 `pnpm dev:mock`（即 `vite --mode mock`，读取 `.env.mock` 中的 `VITE_MOCK=1`）后，前端在渲染之前调用 `@tauri-apps/api/mocks` 的 `mockIPC(handler, { shouldMockEvents: true })`，于是可以直接在普通浏览器里开发界面，也可以跑 Playwright。

Mock 夹具（`src/mocks/fixtures.ts`）必须覆盖下面这些状态：

| 类别 | 夹具内容 |
| :--- | :--- |
| 运行环境 | Windows 和 WSL Ubuntu-24.04 |
| 资产 | `hk-edge`：生产，已探测；`sg-db`：生产，探测会失败，错误为主机密钥未信任；`dev-box`：开发，从未探测 |
| 目标 | Claude Code 全局（Windows）；通用 .agents 全局（WSL）；`OpenPet-Desktop` 项目（WSL，两个约定目录）；`Blog-Astro` 项目（Windows，只有 `.claude`） |
| 挂载 | 至少包含一个 `ok`、一个 `broken`（sg-db 挂在 OpenPet 上）、一个 `conflict`（Blog-Astro 中已有手写的同名目录）、一个 `alias-missing`。Windows 目标上的挂载使用复制模式（`links[].kind = "copy"`），另有一个 `stale-copy`。还要准备一组「全局与项目档位不同」的挂载尝试，用来验证 F-303 AC2 的阻止逻辑 |
| 探测 | 模拟 3 秒的进度事件；对 `hk-edge` 生成 4 处差异 |

### 7.9 目录结构

```text
src/
  main.tsx                 根节点：ThemeProvider（模板自带）、MotionConfig、TooltipProvider、Toaster、事件桥
  App.tsx                  SidebarProvider + AppSidebar + SidebarInset + 视图切换
  index.css  typeset.css
  components/ui/           shadcn 生成的组件（可以改源码，但禁止新增同类组件）
  components/theme-provider.tsx   shadcn Vite 模板自带（删掉其中按 d 键切换主题的监听）
  components/app/          应用级组合组件：AppSidebar、CommandMenu、EnvBadge、StateBadge、MountChip、
                           ContextBudget、SkillPreview、EmptyState
  features/assets/         AssetsView、AssetList、AssetEditor（含各标签页）、ProbePanel、ImportDialog、RenameDialog
  features/skills/         SkillsView、BundleDialog（P1）
  features/mounts/         MountsView、BoardView、MatrixView、TargetCard、AddProjectDialog、useMountDnd
  features/activity/       ActivityView
  features/settings/       SettingsView 及各分区
  stores/                  ui.ts、assets.ts、probe.ts、skills.ts、targets.ts、mounts.ts、activity.ts
  lib/                     ipc.ts、events.ts、utils.ts（cn）、format.ts（Intl）、schemas.ts（zod）、hotkeys.ts、
                           copy.ts（全部界面文案，以及 Lint 和探测错误 id 到中文的映射）
  bindings/                ts-rs 生成的类型
  mocks/                   fixtures.ts、install.ts（mockIPC）
```

### 7.10 完成定义（DoD）

1. `pnpm typecheck`、`pnpm lint`、`pnpm build` 全部通过，ESLint 不出现 `no-restricted-imports` 告警。
2. `pnpm dev:mock` 下，五个视图都能用夹具完整渲染，控制台没有报错。
3. 6.11 中列出的每个状态，都能通过夹具或交互复现出来。
4. 只用键盘就能完成以下操作：在资产列表中上下移动并打开资产，`Ctrl+K`，`Ctrl+S`，拖拽挂载（空格加方向键），用空格切换矩阵开关，退出 Agent 视角。
5. Playwright 截图覆盖 4 个主要视图，浅色和深色各一套，宽度 1280 和 1024 各一套。截图中不出现文字溢出或遮挡，焦点环清晰可见。
6. 只修改了 7.6 列出的令牌，没有新增任何颜色值（用 `grep -E "oklch\(|#[0-9a-f]{3,6}"` 检查 `src/` 下除 `index.css` 以外的文件）。

### 7.11 给 Coding Agent 的执行入口

完整的分阶段执行计划见 `docs/EXECUTION-PLAN.md`，新对话的开场提示词也在那份文件末尾。本章（第七章）是执行时的硬约束，任何阶段都必须遵守。

---

## 八、后端（Rust）方案

### 8.1 模块划分

| 模块 | 职责 | 主要依赖 |
| :--- | :--- | :--- |
| `db` | SQLite（WAL 模式）、`schema_version` 与迁移 | `rusqlite`（bundled） |
| `env` | 运行环境检测；WSL 发行版枚举（`wsl.exe -l -q`）；路径换算（`wslpath`） | 标准库 |
| `ssh` | 枚举 Host 列表：用 `ssh2-config`，它支持 `Include`，并且可以通过 `home_dir` 解析 WSL 内的配置（但不支持 `Match` 和 Token）。获取某个别名的生效值：在对应运行环境里执行 `ssh -G <alias>`，这样 `Match` 和 Token 也能正确处理。探测时执行 ssh | `ssh2-config`、`tokio::process` |
| `probe` | 内置并版本化的探测脚本；解析输出；生成差异 | 标准库 |
| `compile` | 渲染模板（内置英文模板）；三层 Token 估算；Lint；密钥扫描；原子发布 | `minijinja`、`tiktoken-rs`（o200k，估算值）、gitleaks 规则集、`regex`、`sha2` |
| `link` | 创建、检查、删除链接；所有权校验；受管复制（Windows 原生默认）；在 WSL 内创建符号链接（`wsl.exe -d <distro> -- ln -sfn`） | `junction`（仅实验选项）、`sha2`（副本内容哈希） |
| `ipc` | Tauri 命令与事件；类型导出 | `ts-rs` |

Rust 依赖锁定的主版本（2026-10-27 核实）：`tauri` 2.12、`tauri-build` 2.7、`rusqlite` 0.41（features = bundled）、`minijinja` 3、`tiktoken-rs` 0.12、`junction` 2、`ssh2-config` 0.9、`ts-rs` 12、`serde` 1、`serde_json` 1、`thiserror` 2、`tokio` 1、`ulid` 3、`regex` 1、`sha2` 0.11、`dirs` 7；开发依赖 `tempfile` 3。

Tauri 插件：`tauri-plugin-dialog`、`tauri-plugin-opener`、`tauri-plugin-window-state`、`tauri-plugin-single-instance`、`tauri-plugin-log`。**不向前端暴露 shell 插件和 fs 插件**：所有系统操作都由具名的 Rust 命令完成，capability 按最小权限配置。

### 8.2 平台链接策略

| 软件运行在 | 目标所在的运行环境 | 默认方式 | 创建方式 |
| :--- | :--- | :--- | :--- |
| macOS 或 Linux（v0.5 / v1.0 起） | 同一系统 | 符号链接 | `symlink(target, link)`，链接整个目录，不链接单个文件 |
| Windows | Windows 路径 | **受管复制** | 复制，并写入所有权标记；每次发布时同步 |
| Windows | Windows 路径（用户手动启用「Junction（实验）」） | Junction | `junction::create(target, link)`，不需要管理员权限 |
| Windows | WSL 路径（`\\wsl.localhost\<distro>\...`） | WSL 内部的符号链接 | `wsl.exe -d <distro> -- ln -sfn <wslpath(compiled)> <link>`；编译产物仍然只存一份，放在 Windows 侧，在 WSL 中通过 `/mnt/c/...` 访问 |
| 任意 | 链接创建失败，或用户对该目标选择了「复制」 | 受管复制 | 同 Windows 路径 |

Agent 对链接的支持情况（2026-10 核实），也就是上表这样取默认值的依据：

| Agent | 目录符号链接 | Windows Junction |
| :--- | :--- | :--- |
| Claude Code | 官方文档写明支持，多个位置指向同一目标时只加载一次。但 #14836 仍有回归报告（某些版本按 `isDirectory()` 过滤，会漏掉链接）。#50052 报告过自动更新删掉了 `~/.claude/skills` 下的链接 | **有已知问题。** #41177：Junction 挂进来的 Skill 能列出，调用时却报「未知 Skill」。#68318：Node/Bun 把 Junction 识别为链接而不是目录 |
| Codex | v0.80 起支持，会跟随链接目标；只认目录链接，不认链接的 `SKILL.md` 文件。监视器会递归跟随链接，链接到超大目录树可能卡住（#30795） | 未确认 |
| Cursor、Copilot CLI | Cursor 2.5 修复了 `~/.cursor/skills` 的链接发现；Copilot CLI 也已修复（#1090） | 未确认 |
| Gemini CLI | 支持 | 它自己的 `skills link` 在 Windows 上就是用 Junction 实现的 |

补充说明：

- 不在 `\\wsl$` 路径上从 Windows 侧直接创建链接，因为 Windows 无法在那里创建 Linux 符号链接。
- WSL 关闭了 automount，或者自定义了挂载根目录时：通过 `wslpath -a` 换算路径。换算失败就降级为复制。
- 健康检查（F-305）要能识别两种情况：链接被外部程序删掉（例如 Claude Code 的自动更新），以及副本被手动修改（内容哈希与所有权标记中记录的不一致）。两种情况都提供一键修复。

### 8.3 探测脚本规范

**Windows 上有两套 ssh 客户端（2026-10-28 在开发机上实测）：**

| 客户端 | 路径 | 谁会用到 | ssh-agent |
| :--- | :--- | :--- | :--- |
| Windows 自带 OpenSSH（9.5p1） | `C:\Windows\System32\OpenSSH\ssh.exe` | 正常启动的 Tauri 应用；从 PowerShell 或 Windows Terminal 启动的 Codex（系统和用户 PATH 里只有这一个 ssh） | Windows 的 `ssh-agent` 服务 |
| Git for Windows 自带的 MSYS ssh（9.9p2） | `<Git 安装目录>\usr\bin\ssh.exe` | Claude Code：它在 Windows 上通过 Git Bash 执行命令，Git Bash 的 PATH 会把这个 ssh 排在前面 | MSYS 自己的 agent 套接字，看不到 Windows 服务里的密钥 |

两者读取同一个 `~/.ssh/config`，但 ssh-agent 不是同一个。由此定出三条规则：

1. Windows 原生环境的探测、`ssh -G` 和可达性校验，一律用系统 OpenSSH 的**绝对路径**，不依赖 PATH 顺序。设置里允许改为 Git for Windows 的 ssh。
2. 把资产挂到 Windows 上的 Claude Code 目标时，如果该别名依赖 ssh-agent 里的密钥（`IdentityFile` 指向的密钥有口令，或者根本没写 `IdentityFile`），就在挂载提示里说明：「Claude Code 在 Windows 上使用 Git Bash 的 ssh，读不到 Windows ssh-agent 服务里的密钥。请在 ssh config 中用 `IdentityFile` 指向它能直接读取的密钥，或者在 Git Bash 中加载 agent。」
3. P5 验收时，两条路径要分别验证一次。

执行方式：

```bash
ssh -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=yes <alias> 'sh -s' < probe.sh
```

整个探测 30 秒超时，超时后终止进程。

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

1. 名称类字段只有在全部字符属于 `[A-Za-z0-9._:/@-]` 时才原样保留；含其他字符的，在资产里标记为「已清洗」，并替换掉非法字符。
2. 所有来自探测的值，在 Markdown 中一律用行内代码（反引号）或表格单元格输出，长度上限 128 个字符。
3. Lint 增加一条规则「疑似指令注入」（警告级）：探测来源的值里出现类似指令的英文或中文短语时触发，例如 ignore previous、system prompt、忽略以上。

错误分类：

| stderr 匹配 | 分类 | 界面文案 | 建议 |
| :--- | :--- | :--- | :--- |
| `Permission denied (publickey` | 认证失败 | 「hk-edge 拒绝了密钥认证」 | 在终端运行 `ssh-add -l` 确认密钥已加载，再执行 `ssh hk-edge` 测试 |
| `Host key verification failed` | 主机密钥未信任 | 「本机还不认识 hk-edge 的主机密钥」 | 在终端运行一次 `ssh hk-edge`，核对指纹后再探测。软件不会自动信任 |
| `REMOTE HOST IDENTIFICATION HAS CHANGED` | 主机密钥变化 | 「hk-edge 的主机密钥变了，可能是重装了系统，也可能是中间人攻击」 | 核实之后手动更新 `known_hosts` |
| `Could not resolve hostname` | 解析失败 | 「无法解析 hk-edge 的地址」 | 检查 ssh config 中的 HostName |
| `Connection timed out`，或连接阶段超时 | 连接超时 | 「连接 hk-edge 超时（10 秒）」 | 检查网络、防火墙和安全组 |
| `Connection refused` | 连接被拒 | 「hk-edge 的 SSH 端口拒绝连接」 | 检查 sshd 是否运行、端口是否正确 |
| 密钥需要口令，但 BatchMode 下无法交互输入 | 需要交互 | 「密钥需要输入口令，但当前无法交互」 | 用 ssh-agent 加载密钥 |
| 某一段返回 `permission denied`（例如 docker） | 部分成功 | 「部分信息采集失败：docker 需要权限」 | 把用户加入 docker 组，或者忽略这一段 |

### 8.4 编译与原子发布

1. **校验**：serde 加业务规则。
2. **渲染**：使用 minijinja 模板，内置模板随应用版本一起发布。
3. **Lint**：规则见 5.4。
4. **写入暂存目录**：写到 `compiled/.staging/<mode>/<slug>-<随机后缀>/`，然后 fsync。
5. **交换目录**：把旧目录重命名为 `.trash/...`，再把新目录重命名为正式路径，最后删除 `.trash`。Windows 上如果因为文件被占用导致重命名失败，就退避重试 3 次；仍然失败时保留旧产物，界面提示「编译受阻：目录被占用」。
6. **发布结果**：写入所有权标记，发出 `compile://finished` 事件；如果有复制模式的挂载，同步这些副本。

### 8.5 安全

- 前端只能调用具名的 Tauri 命令。capability 中不授予 `shell:allow-execute`，也不开放任意文件系统读写。
- CSP 禁止加载远程脚本。
- 本软件自身需要的凭据（P2 的 Cloudflare Token）存放在系统钥匙串，不进入 SQLite。

---

## 九、非功能需求

| 类别 | 要求 |
| :--- | :--- |
| 性能 | 冷启动不超过 1.5 秒（中端笔记本）；编译预览 p95 不超过 100ms；单次挂载 p95 不超过 500ms；检查 100 个挂载不超过 1 秒；首屏 JS 压缩后不超过 600KB（实测全量冒烟页面约 487KB gzip），预览面板用 `React.lazy` 拆分，streamdown 和 Shiki 的语言包按需加载 |
| 可靠性 | SQLite 使用 WAL 模式；所有文件写入都是原子的；进程崩溃不留下半个产物 |
| 隐私 | 零遥测；除 SSH 探测和用户主动开启的更新检查外不联网；日志中不记录原始探测输出和解析后的连接信息 |
| 兼容性 | v0.1：Windows 10 21H2+ 和 Windows 11（WebView2），以及 WSL2。v0.5：macOS 13+。v1.0：Ubuntu 22.04+（WebKitGTK 4.1） |
| 国际化 | v0.1 界面只有简体中文，全部界面文案集中放在 `src/lib/copy.ts`，便于以后国际化。编译产物默认英文（F-207） |
| 可访问性 | WCAG 2.2 AA，见 6.14 |
| 可维护性 | 数据库带 `schema_version` 并支持迁移；模板版本号写入所有权标记，便于判断产物由哪个模板生成 |
| 更新 | Tauri updater，安装包签名；更新检查需要用户主动开启 |

---

## 十、版本路线图

| 版本 | 里程碑 | 交付内容 | 平台 |
| :--- | :--- | :--- | :--- |
| v0.1（MVP） | 跑通「导入、探测、编译、挂载到项目」的闭环 | F-101、102、103、105；F-201 到 205；F-207（默认英文输出）；F-301 到 307；F-401、402、403、405 | Windows 10/11（原生 + WSL2） |
| v0.5 | 多类资产和业务包 | F-104（Domain、Panel、Storage）；F-206 业务包；F-207 输出语言切换；F-404 JSON 导入导出 | 增加 macOS |
| v1.0 | 生态扩展与硬约束 | F-208 文件化自定义模板；加密备份；硬约束辅助：生成低权限用户脚本、生成 Claude Code 权限规则，以及 Claude Code 专属的 `PreToolUse` hook 拦截（需要单独的变体，限制见评审报告 R-02）；Cloudflare DNS 只读同步；可选的官方精确 Token 计数 | 增加 Linux |

---

## 十一、已决事项与待决问题

### 11.1 已决事项（决策日志）

| 日期 | 决策 | 影响范围 |
| :--- | :--- | :--- |
| 2026-10-27 | 交付形式：先完成评审、修订 PRD 和设计规范，再按执行计划实施 | 全部文档 |
| 2026-10-27 | 桌面容器用 Tauri v2；前端从 Vue 3 改为 React 19 | 第七、八章 |
| 2026-10-27 | 资产页采用多栏工作区（列表、编辑器、预览） | 6.4 |
| 2026-10-27 | 产品名称定为 **CloudLink** | 全部文档；数据目录 `~/.cloudlink/`；所有权标记文件 `.cloudlink.json` |
| 2026-10-27 | 编译产物默认使用**英文** | F-207、5.2、5.5 |
| 2026-10-27 | **先做 Windows**（原生 + WSL2）；macOS 放到 v0.5，Linux 放到 v1.0 | 头部表格、第九、十章 |
| 2026-10-27 | **允许**把生产资产挂到全局目标，但必须二次确认，并且常驻提示 | F-303 AC1、6.6 |
| 2026-10-27 | 接受视觉方向「钢与信号」（Mist 冷钢、钢墨主按钮、Signal Cyan） | DESIGN.md |
| 2026-10-27 | 用户画像确认无误 | 1.2、PRODUCT.md |

### 11.2 待决问题

| 编号 | 问题 | 建议 |
| :--- | :--- | :--- |
| Q1 | CloudLink 的商标风险 | Dell（数据加密）、Mitel（通信）、Genetec（视频设备）、Texada（SaaS）都有叫 CloudLink 的产品，但都不在 AI 或开发者工具领域。正式发布前要做一次商标检索；npm 包名、域名、Tauri identifier 也要一并确认 |
| Q2 | Logo 和品牌资产 | 需要你提供；在此之前，侧栏只显示文字名称 |
| Q3 | 是否需要团队共享 | 当前定位是个人工具，v1.0 之后再评估 |

---

## 附录 A：术语表

| 术语 | 含义 |
| :--- | :--- |
| 资产 | 一台服务器，或一个域名、面板、存储 |
| Skill | 符合 Agent Skills 规范的目录，包含 `SKILL.md` 和可选的 `references/` |
| 变体 | 同一个 Skill 在某个档位下的编译产物 |
| 目标 | 挂载的位置，分为全局 Agent 目录和项目 |
| 挂载 | 在目标位置创建一个指向变体的链接（或受管副本） |
| 档位 | 只读巡检或标准运维 |
| 红线 | 写给 Agent 的禁止或约束条目，属于建议性约束 |
| Agent 视角 | 从某个目标出发，查看它可以看见的全部 Skill |

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
