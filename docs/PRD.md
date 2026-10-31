# 产品需求文档（PRD）v3：CloudLink —— 管好服务器信息，交给 CLI Agent 运维

> 本文是对 `docs/archive/prd-v1.md`（v1 草案，原名 CloudSkill Hub）的修订版，修订原因逐条记录在 `docs/PRD-review.md`。
> **v3（2026-10-30 起）是一次方向调整**：取消项目级挂载，只分发到 Agent 的全局目录；界面改为以服务器为中心（参考 Termius）；服务器信息可以在界面里直接录入并测试连接。2026-10-31 又收敛了一轮：全部服务器编译成一个总 Skill；Claude Code 上用护栏把档位落到实处，并记录 Agent 执行过的命令；Agent 可以把学到的东西回写成笔记；分发一律用受管复制；v0.1 只支持 Claude Code 和读取 `~/.agents/skills` 的 Agent。变更清单见附录 C，决策见 11.1。
> 配套文件：`PRODUCT.md`（产品上下文）和 `DESIGN.md`（视觉系统，令牌以它为准）。
> 文中的库版本、Agent 目录、规范约束和各 Agent 对链接的支持情况，都在 2026-10-27 对照官方文档、changelog 和 GitHub issue 核实过，来源列在 `docs/PRD-review.md` 第三章。

| 文档属性 | 内容 |
| :--- | :--- |
| 产品名称 | CloudLink（2026-10-27 确定；正式发布前要做商标检索，见 11.2） |
| 产品形态 | 桌面客户端（Tauri v2）。**v0.1 只支持 Windows 10/11（原生 + WSL2）**；macOS 在 v0.5 支持，Linux 在 v1.0 支持 |
| 核心定位 | 在一个简单的服务器管理界面里录入、测试、探测服务器信息，编译成一个符合 Agent Skills 规范的总 Skill，分发给本机 Agent 的全局 skills 目录；在 Claude Code 上用护栏拦下越界的命令，并记录 Agent 在服务器上执行过什么 |
| 兼容生态 | v0.1：Claude Code（`~/.claude/skills`），以及 Codex CLI 等读取 `~/.agents/skills` 的 Agent；其他 Agent 可以添加为自定义目录。护栏只支持 Claude Code |
| 文档版本 | v3.0（2026-10-30 方向调整，2026-10-31 收敛，见附录 C；v2.1 为 2026-10-27 版） |
| 覆盖范围 | v0.1（MVP）到 v1.0。优先级与版本一一对应：P0 = v0.1，P1 = v0.5，P2 = v1.0 |

---

## 一、背景与目标

### 1.1 痛点

1. **云端上下文断层。** Agent 很会执行 Bash 和 SSH，但它不知道开发者手上有哪些机器、别名叫什么、服务跑在哪个目录、端口怎么映射。每开一次对话，人都得重新交代一遍。
2. **手工维护成本高。** 服务器上新开容器、改了端口或绑了新域名之后，散落在各个 Markdown 里的说明很容易漏改。Agent 拿到过期信息，就会执行错误的命令。
3. **全局上下文污染。** 如果把所有服务器信息都塞进全局的 `CLAUDE.md`，每次会话都要为全文付出常驻 Token。Skill 的渐进式加载能解决这个问题：常驻的只有名称和描述，正文只在任务涉及服务器时才加载，每台服务器的详情还可以拆成按需读取的参考文件。
   - v2 曾把「开发 A 项目时 Agent 连上 B 项目的生产机」作为痛点，并为此设计了项目级挂载。v3 不再做项目级隔离，原因是它只隔离「Agent 知道什么」，不隔离「Agent 能连什么」：`~/.ssh/config` 本身是全局的。真正降低风险的手段是档位（只读巡检）、红线，以及需要硬隔离时使用低权限 SSH 用户。
4. **敏感信息外泄。** 凭据（密码、私钥、API Secret）绝对不能进入模型上下文。IP、端口、内部路径这类拓扑信息虽然不算凭据，也应该只披露最少必要的部分。
5. **Agent 上手干活时没有边界，也不留记录。** 让 Agent 到生产机上排查或操作时，「只读」「这个容器不能停」全靠提示词，对话一长就可能被忘掉；在跳过权限确认的模式下，危险命令会直接执行。事后也查不到 Agent 在哪台机器上执行过什么。Agent 自己摸清的部署方式和踩过的坑，会话一结束就丢了，下次从头再摸。

### 1.2 目标用户与场景（用户画像已于 2026-10-27 确认）

| 画像 | 环境 | 资产规模 | 主要诉求 |
| :--- | :--- | :--- | :--- |
| 独立开发者 | Windows + WSL2；以 Claude Code 为主，偶尔用 Codex | 2–5 台 VPS（反代、数据库、开发机） | 不想每次都重复交代背景；个人项目之间互不干扰 |
| 小团队全栈 | macOS（v0.5 起支持）；Cursor 和 Claude Code 都用 | 8–20 台（生产 + 预发） | Agent 绝对不能碰生产库；信息要随服务器变化及时更新 |

关键场景：

| 编号 | 场景 | 用户要做的事 |
| :--- | :--- | :--- |
| S1 | 首次配置 | 检测 Agent → 录入或导入服务器 → 测试连接 → 打开「分发给 Agent」→ 为 Claude Code 安装护栏 |
| S2 | 新开一台服务器 | 在界面里录入地址、端口、用户和认证方式，测试连接，保存后自动探测 |
| S3 | 服务器有变更 | 重新探测，变化自动更新；看一眼更新了什么，不对就撤销 |
| S4 | 不想让 Agent 知道某台机器 | 关掉这台服务器的「分发给 Agent」 |
| S5 | 线上排查前 | 把这台服务器设为「只读巡检」；确实要改东西时，临时解锁 30 分钟 |
| S6 | 副本被外部程序删除或改动（例如 Agent 自动更新） | 健康检查发现问题，一键修复 |
| S7 | 想知道服务器状况 | 对 Agent 说「巡检一下所有服务器」，Agent 按 Skill 里的巡检清单逐台检查并汇报 |
| S8 | Agent 摸清了一个部署细节 | Agent 把它记成一条笔记；用户在 CloudLink 里确认后并入服务器信息，下次会话直接可用 |
| S9 | 事后回看 | 在服务器详情里查看 Agent 在这台机器上执行过的命令，以及哪些被护栏拦下 |

### 1.3 解决方案

- **结构化录入，加上以事实为源的自动探测。** `~/.ssh/config`（按运行环境分别解析）和只读探测脚本是事实来源。探测结果自动更新进服务器信息，用户可以查看本次更新了什么并撤销；疑似注入的值要用户确认后才合并。
- **界面内录入并验证。** 服务器的地址、端口、用户、认证方式可以直接在界面里填写，并且「测试连接」通过后才能分发，保证 Agent 拿到的是一台确实能连上的机器。CloudLink 把录入的连接写进自己托管的 ssh 配置文件，Agent 照常用 `ssh <别名>` 连接（F-107）。
- **一个总 Skill。** 全部服务器编译成一个 Skill（`cloudlink-servers`）。`SKILL.md` 是总览：有哪些服务器、各自做什么、彼此什么关系、运维约定和巡检入口；每台服务器的详情是一个按需读取的参考文件。用户没说是哪台机器也能触发，常驻成本只有一条描述。
- **一键分发。** 每台服务器一个「分发给 Agent」开关，决定它是否列入总 Skill。总 Skill 以受管副本的形式写进本机已启用的 Agent 全局 skills 目录，每次编译后同步。
- **护栏与记录。** 在 Claude Code 上安装一个 `PreToolUse` hook：只读巡检的服务器只放行巡检类命令，标准运维的服务器拦下明显危险的命令；需要改东西时，在 CloudLink 里临时解锁 30 分钟。同一个 hook 记录 Agent 执行过的每条 ssh 命令。
- **越用越懂。** Agent 在干活中摸清的部署方式、配置位置和踩过的坑，按 Skill 里的约定写进笔记收件箱，用户确认后并入服务器信息。
- **CloudLink 关着时 Agent 照常工作。** Skill 是普通文件，护栏是一个独立的小程序。只有修改信息、临时解锁时才需要打开 CloudLink。

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
   - 私钥只记录文件路径，不读取、不复制私钥内容（CloudLink 为用户生成的密钥除外，见 F-108）。
2. **拓扑最小披露。** IP、解析后的 HostName、User、Port 默认不导出。每个字段都有独立的导出开关（F-105）。生产服务器默认使用「只读巡检」档，切换到「标准运维」前必须二次确认。
3. **红线诚实。** 写在 `SKILL.md` 里的红线是给 Agent 的指令，属于建议性约束，不是技术隔离。Claude Code 上的护栏（F-306）会拦下越界命令，但它只解析命令文本：能防手滑，防不了刻意绕过（例如把命令编码后再执行，或者先上传脚本再运行）。界面和编译产物都要如实说明这一点。Claude Code 官方文档也明确写了：权限 deny 规则本身「不是安全边界」，真正的强制隔离要靠沙箱。需要硬隔离时，引导用户使用低权限 SSH 用户（P2 提供辅助）。
4. **渐进式披露。** 加载口径分三层：常驻（总 Skill 的 name + description）、触发后加载（`SKILL.md` 正文：总览、关系、档位、规则）、按需读取（`references/*`：每台服务器的详情和巡检清单）。正文行数上限是可配置的 Lint 规则（默认 100 行），不是硬性限制。
5. **单一数据源。**
   - 数据只存一份，在本地 SQLite。
   - 渲染只有一份实现，即 Rust 编译器，预览和发布都调用它。
   - 类型只有一份来源：Rust 结构体经 ts-rs 自动生成 TypeScript 类型。
6. **只动自己创建的东西。** 所有编译产物和分发出去的 Skill 都带所有权标记。软件绝不覆盖、也绝不删除不是自己创建的文件或目录。
   - ssh 配置：只写 CloudLink 自己的托管文件；在用户的 `~/.ssh/config` 中只加一行 `Include`，并且要先征得同意（F-107）。
   - `known_hosts`：只在用户核对主机指纹并确认后，由 ssh 自身通过 `StrictHostKeyChecking=accept-new` 写入。
   - Claude Code 的 `~/.claude/settings.json`：只增删 CloudLink 自己的那一条 hook，要先征得同意，修改前备份（F-306）。
7. **本地优先，零遥测。** 默认不联网，只有 SSH 探测和用户主动开启的更新检查例外。

---

## 三、核心概念与数据模型

### 3.1 概念

| 概念 | 定义 |
| :--- | :--- |
| 运行环境 Environment | Agent 运行、并且 ssh 配置在其中生效的系统环境，取值为 `windows`、`wsl:<发行版>`、`macos` 或 `linux`。同一台电脑上可以同时存在多个运行环境，各有自己的 `~/.ssh/config` 和 Agent 全局目录 |
| 服务器 Server | 被描述的云资源，界面上统一叫「服务器」（数据模型里仍叫 Asset，类型为 `vps`；`domain`、`panel`、`storage` 留到 v0.5） |
| 总 Skill | 编译单元。全部列入的服务器编译成一个 Skill，名称固定为 `cloudlink-servers`：`SKILL.md` 是总览，每台服务器的详情是一个参考文件。每个运行环境各编译一份，只包含在该环境里能连上的服务器 |
| 列入 Inclusion | 一台服务器是否出现在某个运行环境的总 Skill 里。由「服务器的分发开关 × 该环境中是否有这台服务器的连接配置」决定，用户不单独设置 |
| 档位 Mode | `read-only`（只读巡检）或 `standard`（标准运维）。是服务器的属性，所有 Agent 共用；在 Claude Code 上由护栏执行 |
| Agent 目标 Target | 某个运行环境中某个 Agent 的全局 skills 目录，例如「Claude Code · Windows」。v3 只有这一种目标，不再有项目目标 |
| 分发 Delivery | 总 Skill 在某个 Agent 目标中的受管副本，每个已启用的目标一份 |
| 护栏 Guard | 安装在 Claude Code 中的 `PreToolUse` hook，按服务器的档位放行或拦下 ssh 命令，并把判定过的命令记下来（F-306、F-307） |
| 临时解锁 | 用户在 CloudLink 中对一台服务器解除护栏 30 分钟，期间照常记录 |
| Agent 笔记 | Agent 按总 Skill 中的约定写进笔记收件箱的条目，用户确认后才并入服务器信息（F-308） |
| 连接验证 | 最近一次「测试连接」或探测是否成功。没有通过验证的服务器不能打开分发开关 |
| 探测 ProbeRun | 一次只读采集。结果自动合并进服务器信息，可以撤销；疑似注入的值要用户确认才合并 |

### 3.2 关系

```text
Environment 1 --- n Target（Agent 全局目录）
Environment 1 --- 1 总 Skill 编译产物 1 --- n Delivery（每个已启用目标一份副本）
Asset n --- n Environment（Inclusion：是否列入该环境的总 Skill）
Asset 1 --- n ProbeRun    Asset 1 --- n Operation（护栏记录）    Asset 1 --- n AgentNote
```

### 3.3 服务器（Asset）数据结构

```jsonc
{
  "id": "ast_01JB3Q8Z6W",                   // ULID
  "type": "vps",
  "name": "香港轻量反代与边缘节点",
  "envTag": "prod",                         // prod | staging | dev，驱动风险提示、默认档位和视觉标识
  "provider": "Tencent Cloud",              // 可选
  "region": "HK",                           // 可选
  "tags": ["edge", "1panel"],
  "summary": "承担 api.example.com 与 blog.example.com 的公网反代及后端 API 容器托管",
  "connection": {
    "source": "managed",                    // managed：在 CloudLink 中录入，写入托管 ssh 配置（F-107）；imported：来自用户自己的 ssh config，CloudLink 只读
    "sshAlias": "hk-edge",                  // Agent 使用的别名。managed 时默认由名称生成，可改，不能与该环境 ssh config 中已有的 Host 重名
    "host": "203.0.113.10",                 // 仅 managed：IP 或域名。默认不导出
    "port": 22,                             // 仅 managed
    "user": "root",                         // 仅 managed
    "auth": {                               // 仅 managed（F-108）
      "method": "key",                      // key：私钥文件 | agent：ssh-agent 中的密钥 | password：密码（存系统凭据库，Agent 不能使用）
      "identityFile": {                     // 仅 key：按运行环境分别记录路径。WSL 中的私钥必须放在 WSL 文件系统里（ssh 会拒绝权限过宽的私钥）
        "windows": "C:\\Users\\me\\.ssh\\id_ed25519",
        "wsl:Ubuntu-24.04": "/home/me/.ssh/id_ed25519"
      },
      "generatedByCloudLink": false         // 由「改用密钥登录」生成的密钥为 true，删除服务器时可以一并清理
    },
    "proxyJump": null,                      // 仅 managed，可选：另一台服务器的别名
    "definedIn": ["windows", "wsl:Ubuntu-24.04"],  // 哪些运行环境的 ssh 配置里有这个别名（managed 即托管文件写入了哪些环境）
    "resolved": {                           // 由 `ssh -G` 得到的只读快照，默认不导出
      "hostname": "203.0.113.10", "user": "root", "port": 22, "proxyJump": null,
      "resolvedAt": "2026-10-27T10:30:00Z"
    },
    "verified": {                           // 最近一次测试连接或探测的结果；连接字段被修改并保存后清空
      "ok": true, "at": "2026-10-27T10:30:00Z", "envIds": ["windows", "wsl:Ubuntu-24.04"]
    }
  },
  "agent": {
    "distribute": true,                     // 「分发给 Agent」开关（F-303），打开即列入总 Skill
    "mode": "read-only",                    // 档位，所有 Agent 共用。新建时：生产为 read-only，其他取设置中的默认档位
    "unlockedUntil": null                   // 临时解锁的到期时间（F-306 AC2）；为空表示没有解锁
  },
  "facts": {                                // 稳定事实，会进入编译产物
    "os": "Ubuntu 24.04 LTS", "kernel": "6.8.0-45-generic", "arch": "x86_64",
    "cpuCores": 2, "memoryTotalMiB": 1987, "diskTotalGiB": 40,
    "panel": { "type": "1panel", "installPath": "/opt/1panel" }
  },
  "paths": [                                // 有序；key 唯一
    { "key": "nginx-conf", "label": "OpenResty 站点配置目录", "path": "/opt/1panel/apps/openresty/openresty/conf/conf.d", "source": "manual" },
    { "key": "compose-root", "label": "Docker Compose 编排目录", "path": "/opt/1panel/docker/compose", "source": "manual" }
  ],
  "services": [                             // 统一建模 docker / systemd；以 kind+name 作为合并键
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
    "rules": [                              // 有序，原文逐字渲染（v3：默认档位移到 agent.mode）
      { "id": "r1", "text": "机器内存仅 2GB，严禁在宿主机直接执行 npm run build 或 cargo build 等高内存编译任务" },
      { "id": "r2", "text": "修改 OpenResty 配置后必须先执行 docker exec openresty nginx -t，校验通过才允许 reload" }
    ]
  },
  "export": { "resolvedConnection": false, "listeningPorts": false, "image": true },
  "notes": "",                              // 笔记：用户填写，也接收经用户确认并入的 Agent 笔记（F-308）
  "probe": { "lastRunId": "prb_01JB3R", "lastSuccessAt": "2026-10-27T10:30:00Z", "status": "ok" },
  "createdAt": "2026-10-20T08:00:00Z", "updatedAt": "2026-10-27T10:31:00Z"
}
```

v3 相对 v2 的变化：

- `connection` 增加 `source`、`host`、`port`、`user`、`auth`、`proxyJump`、`verified`。手工录入的服务器（managed）由 CloudLink 写进托管 ssh 配置；导入的服务器（imported）连接信息只读，仍由用户自己的 ssh config 维护。
- 新增 `agent`（分发开关和档位）。`guardrails.defaultMode` 移除：档位不再是「新建挂载时的默认值」，而是这台服务器唯一的档位。
- 密码不出现在数据结构里，只在系统凭据库中以服务器 id 为键保存。
- 去掉 `slug`：编译单元改为总 Skill，每台服务器的详情文件按别名命名（5.3）。`agent` 增加 `unlockedUntil`。

v2 相对 v1 的变化（原因见评审报告 R-11 到 R-13）仍然有效：易变指标不进入产物；`domains` 改名为 `servedHostnames`；`ports` 结构化；环境改为单选字段 `envTag`。

总 Skill 的全局内容（F-201）不属于任何一台服务器，存在设置里：

```jsonc
{
  "relationships": "hk-edge reverse-proxies api.example.com to the API containers on hk-edge; those containers use the PostgreSQL database on sg-db over the private network.",
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
}

type AgentId = "claude-code" | "universal" | "custom";   // v0.1 只有这三类（4.5）

interface Target {                          // 只有 Agent 全局目录这一种目标
  id: string;
  envId: EnvId;
  agent: AgentId;
  label: string;                            // 例如 "Claude Code"
  path: string;                             // 全局 skills 目录
  enabled: boolean;                         // 关闭后，CloudLink 从这个目录移除自己分发的总 Skill
  detected: boolean;                        // 是否检测到这个 Agent（未检测到也可以手动启用）
}

type Mode = "read-only" | "standard";

interface Inclusion {                       // 一台服务器是否列入某个运行环境的总 Skill
  assetId: string; envId: EnvId;
  included: boolean;
  reason?: { id: string; params?: Record<string, string | number> };  // 未列入的原因：分发开关关闭、该环境没有连接配置、WSL 中没有配置私钥等
}

type DeliveryStatus =
  | "ok" | "pending"
  | "missing"                               // 副本被外部程序删除
  | "modified"                              // 副本被改动过（实际内容与所有权标记中的哈希不一致）
  | "outdated"                              // 副本不是最新的编译结果（上次同步失败）
  | "conflict";                             // 目标位置已有同名目录，而且不是 CloudLink 创建的

interface Delivery {                        // 总 Skill 在一个目标中的受管副本
  id: string; targetId: string; envId: EnvId;
  path: string;
  status: DeliveryStatus;
  statusDetail?: { id: string; params?: Record<string, string | number> };  // 只返回 id 和参数
  checkedAt: string;
}

interface GuardStatus {                     // 每个有 Claude Code 目标的运行环境一条（F-306）
  envId: EnvId;
  state: "active" | "not-installed" | "broken" | "unavailable";
  detail?: { id: string; params?: Record<string, string | number> };  // broken：条目被删、自检失败、设置了 disableAllHooks；unavailable：WSL 互操作已关闭
  settingsPath: string;
  checkedAt: string;
}

interface Operation {                       // 护栏判定过的一条命令（F-307）
  id: string; assetId: string; envId: EnvId;
  at: string; sessionId: string; cwd: string;
  command: string;                          // 已脱敏
  decision: "allowed" | "denied" | "unlocked";
  reasonId?: string;                        // 拦下的原因，例如 read-only、volume-delete、credential-read、unparsed
}

interface AgentNote {                       // Agent 写进收件箱的一条笔记（F-308）
  id: string; assetId: string;
  text: string; writtenAt: string;          // 取行首日期，没有日期时取读入时间
  flags: ("secret" | "injection")[];        // 命中密钥的笔记必须编辑后才能并入
  status: "pending" | "merged" | "dismissed";
}
```

分发规则：

- 每个运行环境编译一份总 Skill，只列入同时满足两个条件的服务器：分发开关打开；该环境中有这台服务器的连接配置。不满足的记为「未列入」，并写明原因。
- 总 Skill 以受管副本写进该环境每个已启用的目标。一台服务器都没有列入时，从目标中移除总 Skill。
- 停用目标、删除服务器、关闭开关时，只删除或更新 CloudLink 创建的副本。
- 新启用一个目标，或者某个环境新增了连接配置时，自动重新编译并同步。

### 3.5 编译产物目录与所有权

```text
~/.cloudlink/                                   Windows 上是 %USERPROFILE%\.cloudlink\
  data.db                                       SQLite（WAL 模式），唯一数据源（不含密码）
  compiled/
    windows/cloudlink-servers/                  每个运行环境一份（WSL 为 wsl-<发行版>/），只含该环境列入的服务器
      SKILL.md                                  总览：服务器表、关系、档位与护栏、规则、巡检入口、笔记约定
      references/hk-edge.md                     每台服务器的详情，文件名取自别名
      references/health-check.md                巡检清单
      .cloudlink.json                           所有权标记：managedBy、envId、contentHash、compiledAt、templateVersion
  bin/cloudlink-guard.exe                       护栏程序，从安装目录复制过来，hook 指向这个固定路径
  guard/policy.json                             护栏策略：每台服务器的别名、地址、档位、关键服务、解锁到期时间
  guard/log/2026-10-31.jsonl                    护栏记录，CloudLink 读入数据库后清理
  inbox/hk-edge.md                              Agent 笔记收件箱：Agent 只追加，CloudLink 读入后清空
  logs/
~/.ssh/cloudlink.conf                           托管 ssh 配置。每个运行环境各一份（WSL 中为 /home/<user>/.ssh/cloudlink.conf）
```

分发产生的副本示例：`~/.claude/skills/cloudlink-servers/` 是 `~/.cloudlink/compiled/windows/cloudlink-servers/` 的受管副本；WSL 中的 `~/.claude/skills/cloudlink-servers/` 由 CloudLink 经 `\\wsl.localhost\<发行版>\...` 路径直接写入（8.2）。

规则：

- 一个目标目录里只有一个 `cloudlink-servers`。
- 保存、应用或撤销探测、切换档位、合并笔记、修改全局内容，都会重新编译，并在同一次发布中同步全部副本。
- 目录名等于 Skill 的 `name`（`cloudlink-servers`），满足规范中 `name` 与父目录同名的要求。

---

## 四、功能需求

### 4.1 模块一：服务器

| 编号 | 功能 | 优先级 | 需求与验收标准（AC） |
| :--- | :--- | :--- | :--- |
| F-101 | 服务器管理 | P0 | 增删改查，字段见 3.3。**AC1：** 别名在全部服务器中唯一（不区分大小写）；managed 服务器的别名还要满足 F-107 AC3。**AC2：** 删除服务器前，确认框说明它会从总 Skill 中移除；managed 服务器同时删除托管 ssh 配置中的条目、凭据库中的密码，以及 CloudLink 生成的密钥（需单独勾选） |
| F-102 | ssh config 导入 | P0 | 按运行环境分别扫描（Windows 宿主机和各个 WSL 发行版分开处理）。支持 `Include`。用 `ssh -G <alias>` 获取生效配置。导入的服务器 `source` 为 `imported`，连接字段只读。**AC1：** 通配和否定模式的 Host（`*`、`?`、`!`）不导入，并提示已跳过几个。**AC2：** 同一个别名在多个环境里都有定义时，合并为一行，「来源环境」列出全部环境。**AC3：** 已导入的别名标记为「已导入」，默认不勾选。**AC4：** CloudLink 托管文件中的 Host 不出现在导入列表里 |
| F-103 | 只读探测 | P0 | 规格见 8.3。**AC1：** 使用 `BatchMode=yes` 和 `ConnectTimeout=10`，整个探测 30 秒超时，用户可以取消。**AC2：** 探测结果自动合并并重新编译，不逐项审批：新增和变化直接写入；上次有、这次没发现的服务标为「未发现」，不删除。完成后告诉用户更新了几处，可以查看本次变化。**AC3：** 合并时保留人工标注（role、critical）。**AC4：** 「撤销」把这次探测改动过的字段恢复原样并重新编译，只能撤销最近一次探测。**AC5：** 清洗后仍疑似指令注入的值（8.3）不自动合并，列为「待确认」，用户确认后才合并。**AC6：** 错误按 8.3 的分类表给出可操作的说明。**AC7：** 原始输出只留在内存里，不写入磁盘。**AC8：** 探测成功同时刷新连接验证 |
| F-104 | 多维资产卡片 | P1 | Domain（手工录入 DNS 记录，记录指向服务器的 id）、Panel（1Panel 或宝塔的目录约定和 CLI 规范）、Storage（Bucket 和备份目录映射）。Cloudflare 只读同步属于 P2，所需 Token 存在系统钥匙串里，不进入数据库 |
| F-105 | 字段导出控制 | P0 | 每台服务器可以单独设置导出开关：解析后的连接信息（默认关）、监听端口（默认关）、镜像版本（默认开）。**AC：** 关闭的字段一旦出现在编译产物里，就触发 Lint 错误并阻断发布 |
| F-106 | 录入服务器与测试连接 | P0 | 「新建服务器」打开右侧面板，只要求填写：名称、地址、端口（默认 22）、用户、认证方式（F-108）、环境标签。别名由名称自动生成，可在「高级」里修改；跳板机也在「高级」里。底部两个按钮：「测试连接」和主按钮「保存」。**AC1：** 测试连接在后台执行 `ssh -F <临时配置> -o BatchMode=yes -o ConnectTimeout=10 <别名> true`（密码方式见 F-108），10 秒超时，可取消，结果在按钮旁原地显示：成功时显示耗时和远端系统；失败时按 8.3 的错误分类给出原因和下一步。**AC2：** 首次连接时显示主机指纹（SHA256），用户核对确认后才写入 `known_hosts`；指纹与已知记录不符时阻断，并明确提示可能的中间人风险。**AC3：** 未测试或测试失败也可以保存（服务器可能暂时关机），但服务器标「未验证」，分发开关不可打开，并说明原因。**AC4：** 保存后，如果测试已通过，自动发起首次探测，结果按 F-103 自动合并。**AC5：** 修改连接字段并保存后，验证状态清空，已有分发保持，但卡片上提示「连接信息已修改，请重新测试」 |
| F-107 | 托管 ssh 配置 | P0 | managed 服务器写入 CloudLink 托管的 `~/.ssh/cloudlink.conf`（每个运行环境一份，WSL 中写在发行版自己的家目录）。**AC1：** 首次写入前用对话框说明要做什么，征得同意后在用户的 `~/.ssh/config` **开头**加一行 `Include ~/.ssh/cloudlink.conf`（写在开头是因为 ssh 对同一参数取第一次出现的值，放末尾会被前面的 `Host *` 覆盖）。修改前先备份为 `config.cloudlink-bak`。用户拒绝时，设置中给出手动添加的说明，此时服务器在该环境中记为「未列入」。**AC2：** 托管文件整文件重写，带「由 CloudLink 生成，请勿手改」的文件头；CloudLink 不修改用户 config 中除这一行 Include 以外的任何内容。**AC3：** 别名与该环境 ssh config 中已有的 Host 重名时阻止保存。**AC4：** 每次写入后用 `ssh -G <别名>` 回读校验，生效值与录入值不一致时（例如被用户 config 中更靠前的规则覆盖）提示具体字段。**AC5：** 用户可在每台服务器上选择写入哪些运行环境，默认全部可用环境 |
| F-108 | 认证方式 | P0 | 三种：私钥文件、ssh-agent、密码。**私钥文件：** 只记录路径，提供文件选择器，并检测常见问题（文件不存在、WSL 中位于 `/mnt/c` 下导致权限过宽、带口令但 ssh-agent 中没有）。**ssh-agent：** 不指定私钥，依赖系统 ssh-agent（Windows 的 OpenSSH Authentication Agent 服务）。**密码：** 存进 Windows 凭据管理器，以服务器 id 为键，不进 SQLite、不进日志、不进 Skill；CloudLink 用它测试连接和探测（经 `SSH_ASKPASS` 交给系统 ssh，不在命令行和环境变量中出现明文）。**AC1：** 选择密码方式时，界面明确提示「Agent 在非交互模式下无法输入密码，只用密码的服务器不能分发」，并提供「改用密钥登录」：CloudLink 生成 ed25519 密钥（保存在 `~/.ssh/cloudlink_<slug>`，WSL 中另存一份并设置 600 权限），用已保存的密码把公钥追加到服务器的 `~/.ssh/authorized_keys`，然后把认证方式切换为私钥文件并重新测试连接。**AC2：** 安装公钥只追加一行并带 `cloudlink` 注释，不改动已有内容；失败时不切换认证方式。**AC3：** 切换成功后用户可以选择删除保存的密码 |

### 4.2 模块二：编译器

| 编号 | 功能 | 优先级 | 需求与验收标准 |
| :--- | :--- | :--- | :--- |
| F-201 | 总 Skill | P0 | 全部列入的服务器编译成一个 Skill，名称固定为 `cloudlink-servers`，每个运行环境一份（3.4、3.5）。`SKILL.md` 包含：连接规则、服务器总览表（别名、用途、环境、档位、详情文件）、服务器之间的关系、档位与护栏说明、内置红线和运维约定、巡检入口、笔记约定；每台服务器的详情放在 `references/<别名>.md`，巡检清单放在 `references/health-check.md`（规格见第五章）。v1 取消「全局汇总清单」的两个理由，即全局常驻和让 Agent 连错项目的服务器，在 v3 已不成立：v3 只做全局分发，总 Skill 常驻的只有一条描述。**AC1：** 「服务器之间的关系」和「运维约定」是全局内容，在 Agent 页编辑，原文逐字输出。**AC2：** description 由模板生成，列出各服务器的别名和用途、承载的站点，以及部署、日志、容器、巡检等触发词；超过 1024 字符时，依次去掉站点名、缩短用途、只列前若干个别名并注明其余数量，同时给出 Lint 警告。**AC3：** 总览表始终列出全部列入的服务器，不受 description 截断影响 |
| F-202 | 档位与红线 | P0 | 两个档位：只读巡检和标准运维，是服务器的属性（`agent.mode`）。用户自定义的红线在任何档位下都追加在后面。内置红线（5.5）在任何档位下都始终注入。在 Claude Code 上，档位由护栏执行（F-306）。**AC1：** 红线逐字渲染，顺序与编辑器中一致。**AC2：** 生产服务器新建时默认只读巡检；切换到标准运维前弹 `AlertDialog` 二次确认，说明「所有已启用的 Agent 都会获得变更权限的指令，护栏只会拦下明显危险的命令」 |
| F-203 | 编译与发布 | P0 | 触发时机：保存、应用或撤销探测、切换档位、合并笔记、修改全局内容、列入情况变化。流程：校验、按运行环境渲染、Lint、原子发布（8.4），然后同步全部副本。**AC1：** 存在错误级 Lint 时不发布，保留上一次成功的产物，并在界面上标出「编译受阻」和出错的服务器。**AC2：** 20 台服务器的总 Skill 编译 p95 不超过 200ms |
| F-204 | 预览 | P0 | 在服务器详情中点「预览 Skill」打开右侧 Sheet，默认定位到这台服务器的详情文件；在 Agent 页可以预览整个总 Skill。内容就是当前草稿的编译结果。显示 description 字符数和正文行数相对上限的进度，以及 Lint 结果。v3 不再显示 Token 估算：总 Skill 常驻的只有一条描述，估算值对用户没有决策意义。**AC：** 预览和发布调用同一个渲染函数，同一份输入得到的内容字节级一致 |
| F-205 | Lint 与密钥扫描 | P0 | 规则见 5.4。密钥扫描复用 gitleaks 的规则集（MIT 许可），编译进 Rust 二进制。同一套规则也用于 Agent 笔记（F-308）和操作记录（F-307）的检查与脱敏 |
| F-207 | 输出语言 | P0（默认英文）/ P1（可切换） | 编译产物默认英文：模板文字、档位说明、内置红线、description 模板都是英文；用户填写的用途、红线、关系、约定、笔记原样输出，不翻译。P1 起支持全局切换为 `zh-CN` |

2026-10-31 删除了 F-206 业务包（由总 Skill 中「服务器之间的关系」取代）和 F-208 自定义模板，编号不再复用。

### 4.3 模块三：Agent 与分发

| 编号 | 功能 | 优先级 | 需求与验收标准 |
| :--- | :--- | :--- | :--- |
| F-301 | 运行环境与 Agent 检测 | P0 | 启动时和手动刷新时执行。Windows 上用 `wsl.exe -l -q` 列出发行版。v0.1 只检测两类 Agent，目录见 4.5。检测到的 Agent 默认启用。**AC：** 未检测到的 Agent 也可以手动启用（软件会创建目录）；其他 Agent 可以添加为自定义目录 |
| F-302 | Agent 启用开关 | P0 | Agent 页每个目标一个开关。**AC1：** 启用后自动写入总 Skill 的副本。**AC2：** 停用前确认，说明会从该目录移除 CloudLink 分发的 `cloudlink-servers`；只移除 CloudLink 创建的东西 |
| F-303 | 分发给 Agent | P0 | 每台服务器一个「分发给 Agent」开关，在服务器卡片和详情面板顶部都能操作。打开后，这台服务器列入各运行环境的总 Skill（3.4）。**AC1：** 未通过连接验证、或者只用密码认证的服务器不能打开开关，Tooltip 说明原因并提供处理入口。**AC2：** 详情面板的「Agent」分段逐个列出运行环境的列入情况；未列入要写明原因（例如「WSL - Ubuntu 中没有配置私钥」），并给出处理入口。**AC3：** 分发完成后给出生效提示：Claude Code 2.1 起会自动加载内容变化，但如果这次分发在会话运行期间新建了 `~/.claude/skills` 目录，需要在会话中执行 `/reload-skills`；已经调用过的 Skill 不会重读，要开新会话；Codex 如果没有生效，需要重启 Codex。**AC4：** 关闭开关立即把这台服务器从总 Skill 中移除，不需要确认（可以随时重新打开） |
| F-304 | 副本引擎 | P0 | 分发一律用受管复制，不用符号链接或 Junction（理由见 8.2）。**AC1：** 目标位置已存在 `cloudlink-servers` 目录、而且不是本软件创建的，判定为「冲突」，不做任何覆盖。**AC2：** 移除只删除带有匹配所有权标记的副本。**AC3：** 每次发布在同一批次内同步全部副本；某个目标写入失败时，该目标记为「待同步」，其余目标照常更新 |
| F-305 | 健康检查与修复 | P0 | 检查时机：启动、窗口重新聚焦（节流 30 秒）、手动「检查全部」。检测四类问题：副本缺失、副本被改动、副本待同步、冲突；同时重新计算列入情况，并对护栏做自检（F-306 AC5）。**AC：** 「修复」重新写入副本，副本被改动过时先提示修复会覆盖改动；目标目录已不存在时重新创建。问题汇总显示在导航栏 Agent 项的计数徽标上 |
| F-306 | 护栏（Claude Code） | P0 | 在 Claude Code 的用户级 `settings.json` 中安装一条 `PreToolUse` hook（`matcher` 为 `Bash`），指向 CloudLink 自带的小程序 `cloudlink-guard`。它对提到 CloudLink 中服务器的每条 ssh、scp、sftp、rsync 命令做判定（规则见 8.6）：只读巡检的服务器只放行巡检类命令；标准运维的服务器只拦下明显危险的命令，包括删除数据卷、重启主机、改防火墙、改 SSH 配置、停掉标为「关键」的服务；任何档位都拦下读取凭据文件。拦下时把原因返回给 Agent，并提示它不要设法绕过。hook 在权限判断之前执行，所以跳过权限确认的模式下同样有效。**AC1：** 安装前用对话框展示将要加入 `settings.json` 的内容，征得同意后才写入；修改前备份为 `settings.json.cloudlink-bak`；只增删 CloudLink 自己的这一条，不改动其他内容。每个有 Claude Code 目标的运行环境分别安装。**AC2：** 临时解锁：用户对一台服务器选择「临时解锁 30 分钟」后，护栏对它放行全部命令，到期自动恢复，期间照常记录；生产服务器解锁前要确认。解锁不改变档位，也不重新编译 Skill。**AC3：** CloudLink 关着时护栏照常工作：它只读取 `~/.cloudlink/guard/policy.json`，不依赖 CloudLink 进程。**AC4：** 解析不了的命令：在只读服务器上拦下（原因为「无法确认是只读命令」），在标准运维服务器上放行，并在记录中标注。**AC5：** 健康检查时自检：确认 `settings.json` 中的条目还在、没有设置 `disableAllHooks`，并用测试输入实际运行一次护栏程序；任何一项失败，Agent 页显示「护栏未生效」及原因。**AC6：** 界面如实说明边界：护栏只解析命令文本，能防手滑，防不了刻意绕过；Codex 等其他 Agent 没有护栏 |
| F-307 | 操作记录 | P0 | 护栏判定过的每条命令都记一行：时间、运行环境、会话 id、工作目录、服务器、命令（脱敏后）、结果（放行、拦下、解锁期间放行）和拦下的原因。CloudLink 在启动、窗口重新聚焦时读入，界面可见时每 60 秒读入一次，保留 30 天。**AC1：** 服务器详情的「操作记录」分段显示最近 50 条，折叠时摘要为「今天 12 条，拦下 2 条」；完整列表在设置的「活动」中按服务器筛选。**AC2：** 记录写入前先脱敏（8.6），CloudLink 读入时再用 F-205 的完整规则扫描一遍，命中的片段替换为 `[已隐藏]`。**AC3：** 界面注明只记录经过护栏的命令，也就是 Claude Code 执行的命令 |
| F-308 | Agent 笔记 | P0 | 总 Skill 中约定：Agent 在干活中摸清值得下次知道的事（部署方式、配置位置、踩过的坑），就往笔记收件箱中这台服务器的文件追加一行 `- YYYY-MM-DD: <内容>`，不写凭据、IP 和临时状态（5.2）。收件箱路径按运行环境渲染成绝对路径；WSL 中指向 Windows 侧的同一个目录，所以只有一个收件箱。**AC1：** CloudLink 在启动、窗口重新聚焦时读取收件箱，界面可见时每 60 秒读取一次；先原子重命名再读，避免和 Agent 的追加冲突；只读取与某台服务器详情文件同名的文件，其他文件不动。**AC2：** 每条笔记读入时做密钥扫描和疑似注入检查；命中密钥的笔记必须编辑后才能并入。单条最长 500 字符，每台服务器最多保留 100 条待处理。**AC3：** 卡片上显示待处理的数量（例如「笔记 3」）；详情的「笔记」分段逐条列出，可以「并入」「编辑后并入」「忽略」，也可以全部并入。**AC4：** 并入就是把这一行（带日期）追加到服务器的笔记字段，立即保存并重新编译，Agent 下次就能读到 |

### 4.4 模块四：系统

| 编号 | 功能 | 优先级 | 需求与验收标准 |
| :--- | :--- | :--- | :--- |
| F-401 | 命令面板与快捷键 | P0 | 见 6.9 |
| F-402 | 活动日志 | P0 | 位于设置的「活动」分区。记录测试连接、探测（包括执行的命令清单、耗时、结果）、编译、分发和移除、修复、托管 ssh 配置的写入、护栏的安装与移除、临时解锁与锁回、笔记的并入与忽略，本地保留 30 天。Agent 的操作记录（F-307）也在这里按服务器查看。**AC：** 日志中不出现原始探测输出、密码，也不出现解析后的连接信息 |
| F-403 | 设置 | P0 | 见 6.7 |
| F-404 | 数据导入导出 | P1 | 以 JSON 导入导出服务器。分发与本机路径强相关、密码在凭据库中，二者都不导出。P2 支持加密备份包 |
| F-405 | 首次启动引导 | P0 | 见 6.8 |

### 4.5 Agent 目录表

v0.1 只支持下面两类 Agent，外加自定义目录。数据来源是 vercel-labs/skills 的 `docs/agents.md`（2026-10 版），上线前需要对照官方文档再核实一遍。

| Agent | 全局目录 | 检测依据 | 护栏 |
| :--- | :--- | :--- | :--- |
| Claude Code | `~/.claude/skills/` | `~/.claude/` 存在，或 PATH 中有 `claude` | 有（F-306） |
| 通用（Codex CLI、Cline、Warp、Zed 等） | `~/.agents/skills/` | `~/.codex/` 存在，或 PATH 中有 `codex` | 没有。Codex 默认的沙箱不允许联网，ssh 要用户批准，或在配置中放开网络 |
| 自定义 | 用户指定 | 无 | 没有 |

Cursor（`~/.cursor/skills/`）、Gemini CLI（`~/.gemini/skills/`）、GitHub Copilot（`~/.copilot/skills/`）、OpenCode（`~/.config/opencode/skills/`）留到 v0.5 再作为独立目标。在此之前，可以把它们的目录添加为自定义目录。

补充事实（2026-10 核实）：

- **Claude Code 不读 `~/.agents/skills`。** 相关 issue #31005 截至 2026-10 仍未关闭，所以 Claude Code 和「通用」是两个独立目标。
- **Codex 的目录变迁。** v0.95 起读 `~/.agents/skills`。旧目录 `~/.codex/skills` 已标为废弃，但为了兼容仍会读取。Codex 的官方文档已经迁到 learn.chatgpt.com/docs/build-skills。
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
hk-edge reverse-proxies api.example.com to the API containers on hk-edge; those containers use the PostgreSQL database on sg-db over the private network.

## Modes
- **read-only**: inspection commands only, e.g. `docker ps`, `docker logs --tail 200 <container>`, `df -h`, `free -m`, `uptime`, `ss -tln`, `journalctl -u <service> -n 200`. If a change is needed, describe the plan to the user and stop; the user can unlock the server in CloudLink for 30 minutes.
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

### 6.1 设计基调

视觉系统见 `DESIGN.md`。它的核心是「钢与信号」：Nova 风格的紧凑密度，Mist 冷钢中性色，主按钮一律用钢墨色，信号色只有 Signal Cyan 一种，并且只用于键盘焦点和选中的服务器卡片描边（DESIGN.md 在 P3.5 同步修改）。颜色只表达状态。浅色和深色两套主题都要做到同等完成度，默认跟随系统。

### 6.2 信息架构

v3 把一级导航从五项减到三项。服务器信息在「服务器」里管理；交给 Agent 的全局内容、护栏和分发目标在「Agent」里；v2 的 Skills 视图取消（预览移到 Sheet 里），活动日志并入设置。

| 一级导航 | 图标 | 用途 | 侧栏计数徽章 |
| :--- | :--- | :--- | :--- |
| 服务器 | `ServerIcon` | 录入、测试连接、探测、编辑服务器信息；分发开关、档位和临时解锁；处理 Agent 笔记；查看操作记录；预览 Skill | 服务器总数；有编译受阻时改为红色受阻数 |
| Agent | `BotIcon` | 总 Skill 的全局内容（服务器之间的关系、运维约定）和预览；护栏的安装与状态；Agent 目标、启用开关、副本健康与修复 | 需要处理的问题数（副本缺失、被改动、冲突，护栏未生效），红色 |
| 设置 | `SettingsIcon` | 通用、运行环境、ssh 配置、编译、探测、活动（含 Agent 操作记录）、数据、危险操作 | 无 |

侧栏底部显示运行环境状态，例如「Windows 可用、WSL Ubuntu 可用」。点击后跳转到「设置 / 运行环境」。

### 6.3 应用外壳

- 使用 `SidebarProvider` 和 `Sidebar`（`collapsible="icon"`），右侧是 `SidebarInset`。窗口最小尺寸 960×600。
- 工具栏高 44px，从左到右依次是：`SidebarTrigger`、`Separator`、`Breadcrumb`（视图 / 当前对象）、弹性空白、当前视图的操作按钮（`ButtonGroup`）、命令面板按钮（带 `Kbd` 提示）。
- 标题栏使用系统原生样式（MVP 不自定义标题栏）。
- 切换一级视图时，各视图的选中项、搜索词和滚动位置都要保留（记在 store 里），切回来时恢复原样。

### 6.4 服务器视图（核心视图）

参考 Termius 的主机管理：服务器是唯一的主角，左边是卡片列表，点击后右边打开详情面板。详情用纵向的可折叠分段代替标签页，一屏内能看到这台服务器的全部要点。

```text
+----------+-----------------------------------------+------------------------------------------+
| CloudLink| 搜索服务器、别名、标签      [+ 新建 v]  | hk-edge  香港边缘节点         (o 生产)   |
|          |                                         | Ubuntu 24.04 · 2C/2G · 2 小时前探测      |
| 服务器  3| 生产                                    | [测试连接] [探测] [预览 Skill] [...]     |
| Agent   1| +----------------+ +----------------+   |------------------------------------------|
| 设置     | | [U] hk-edge    | | [D] sg-db      |   | v Agent                                  |
|          | | 香港边缘节点   | | 新加坡数据库   |   |   分发给 Agent          [====o] 开       |
|          | | ● 已连接 只读  | | ● 已连接 只读  |   |   档位  (只读巡检) ( 标准运维 )          |
|          | | 笔记 3         | | 已解锁 · 23 分 |   |   护栏  已生效    [临时解锁 30 分钟]     |
|          | | 分发 [====o]   | | 分发 [====o]   |   |   Windows        已列入                  |
|          | +----------------+ +----------------+   |   WSL · Ubuntu   未列入：WSL 中没有私钥  |
|          | 开发                                    | v 笔记       3 条 Agent 笔记待处理       |
|          | +----------------+                      | > 操作记录   今天 12 条，拦下 2 条       |
|          | | [U] dev-box    |                      | v 连接                                   |
|          | | 开发机         |                      |   root@203.0.113.10:22  私钥  [编辑]     |
|----------| | ○ 未验证       |                      | > 基本信息   名称、用途、标签、厂商      |
| Win  ok  | | 分发 [o====]   |                      | > 路径       2 条                        |
| WSL  ok  | +----------------+                      | > 服务       4 个，1 个未发现            |
|          |                                         | > 红线       2 条自定义 + 4 条内置       |
+----------+-----------------------------------------+------------------------------------------+
```

**布局**：外层是 `ResizablePanelGroup`（水平），用 `useDefaultLayout({ id: "servers" })` 持久化。列表 `"42%"`（最小 `"300px"`），详情弹性（最小 `"420px"`）。没有选中服务器时，详情面板显示 `Empty`：「选择一台服务器查看详情」。

> 注意：react-resizable-panels v4 中，数字尺寸按**像素**计算，字符串尺寸才按百分比，所以必须写成 `"42%"` 这样的形式。

**列表**

- 顶部只有一个搜索框（`InputGroup`，匹配名称、别名、标签、站点名）和主按钮「新建服务器」，旁边的 `DropdownMenu` 里有「从 ssh config 导入」。不再提供类型、环境、标签、排序筛选：v0.1 只有 VPS，按环境分组已经足够；服务器超过 20 台时再评估筛选。
- 卡片按「生产 / 预发 / 开发」分组，组内按名称排序。卡片使用 `Card size="sm"`，网格 `grid-cols-[repeat(auto-fill,minmax(220px,1fr))]`。
- 卡片内容：系统图标（由探测得到的发行版，没有探测时用 `ServerIcon`）、别名（等宽）、名称、连接状态（已连接 / 未验证 / 连接失败）、档位、「分发」`Switch`（`aria-label="将 hk-edge 分发给 Agent"`）。有待处理的 Agent 笔记时显示 `Badge variant="outline"`「笔记 3」；临时解锁期间显示 `Badge variant="warning"`「已解锁 · 23 分」。分发开关在卡片上直接可操作，点击开关不打开详情。
- 卡片是可聚焦的按钮语义（`role="button"`、Enter 打开），选中项设置 `aria-current="true"`，使用 frost 底色和信号色描边。方向键在卡片之间移动焦点。
- 右键卡片打开 `ContextMenu`：测试连接、探测、临时解锁 30 分钟（解锁期间为「立即锁回」）、复制别名、删除。

**详情面板**

- 头部：别名（Title 字号，等宽）、名称、环境徽章；第二行是系统摘要和探测时间（`Intl.RelativeTimeFormat`）；第三行是操作：「测试连接」「探测」「预览 Skill」和「更多」菜单（在文件夹中显示编译目录、删除服务器）。编译受阻或有 Lint 警告时，头部下方显示一行摘要，点击打开预览 Sheet 并定位到 Lint 项。
- 正文是一组 `Collapsible` 分段。**Agent 分段固定在第一位并默认展开**；有待处理的 Agent 笔记时，笔记分段默认展开；连接分段默认展开；其余默认折叠，折叠状态按分段持久化。折叠时标题行右侧显示一句摘要（例如「4 个，1 个未发现」）。

| 分段 | 内容 |
| :--- | :--- |
| Agent | 「分发给 Agent」`Switch`（未验证或只用密码时禁用，旁边写明原因和处理入口）；档位 `ToggleGroup`（只读巡检 / 标准运维；生产服务器切到标准运维时弹 `AlertDialog`）；护栏一行：这台服务器所在运行环境的护栏状态（已生效 / 未安装 / 未生效，多个环境时取最差的一个，链接到 Agent 页），右侧是「临时解锁 30 分钟」按钮，解锁期间换成剩余时间和「立即锁回」，生产服务器解锁前弹 `AlertDialog`；列入情况：每个运行环境一行 `Item`，显示「已列入」或「未列入」，未列入时写明原因并提供处理入口。没有启用任何 Agent 时，显示「还没有启用的 Agent」并链接到 Agent 页 |
| 笔记 | 顶部是待处理的 Agent 笔记（F-308）：每条一个 `Item`，显示日期和原文（纯文本，不渲染 Markdown），命中密钥或疑似注入时带 `Badge variant="warning"` 说明原因；操作是「并入」「编辑后并入」「忽略」，列表上方有「全部并入」。下面是笔记字段本身（`Textarea`），内容进入详情文件的 Notes 一节。详情有未保存的修改时，「并入」不可用，提示先保存或放弃 |
| 操作记录 | 最近 50 条护栏记录（F-307），每条一行 `TraceLine`：时间、结果图标（放行 `CircleCheckIcon`、拦下 `ShieldXIcon`、解锁期间放行 `LockOpenIcon`）、命令（等宽、截断，可以展开）、工作目录（只显示文件夹名）。底部是「在活动中查看全部」，并注明「只记录经过护栏的命令（Claude Code）」 |
| 连接 | managed：一行摘要 `user@host:port`、认证方式、写入的运行环境，「编辑」进入编辑态（字段同 6.5）；高级里有别名、跳板机，以及「导出到 Skill」的开关（解析后的连接信息、监听端口，F-105）。imported：显示 `ssh -G` 解析结果（只读，每行前有 `LockIcon`）和来源环境，并说明「连接信息由你的 ssh config 维护」 |
| 基本信息 | 名称、环境标签、用途（进入总览表和 description，带字数统计）、标签、云厂商、地域 |
| 路径 | 可排序的键值行：拖拽手柄、用途、路径（等宽）、删除。「添加路径」和「从面板模板添加」（1Panel、宝塔的常用目录） |
| 服务 | `Table`：名称（等宽）、类型、镜像、端口（`127.0.0.1:8080->8080`）、角色（行内 `Input`）、关键（`Switch`，打开后护栏会拦下停止或删除它的命令）、来源（探测 / 手动）、状态（「未发现」用琥珀色）。「手动添加」按钮 |
| 红线 | 自定义红线：可排序的 `Textarea` 列表，可增删。内置红线：只读展示。顶部 `Alert`：「红线是写给 Agent 的指令。Claude Code 上的护栏会拦下只读服务器上的写操作和明显危险的命令，能防手滑，防不了刻意绕过。需要硬隔离时，请为只读场景配置低权限 SSH 用户。」 |

- 编辑使用 react-hook-form 加 zodResolver，在失焦时校验。可排序的行由 `useFieldArray` 管理，拖拽结束后调用它的 `move()`。
- **保存是显式的**：有未保存修改时，详情面板底部出现固定的操作条：「未保存的修改」、「放弃」和主按钮「保存」（`Ctrl+S`）。分发开关、档位、临时解锁，以及笔记的并入和忽略是例外，它们立即生效，不经过保存。
- 保存校验失败时，展开出错字段所在的分段，并把焦点移到第一个出错字段。
- 有未保存修改时切换服务器或离开视图，弹出 `AlertDialog`：「放弃修改 / 继续编辑」。
- 保存成功后，操作条消失，头部状态显示「已保存，已编译」（带 `CircleCheckIcon`），不弹 Toast。

**预览 Skill**（右侧 `Sheet`，宽度 `min(720px, 60vw)`，`Ctrl+\` 切换）

- 头部：文件切换（`Tabs`：SKILL.md、这台服务器的详情文件、health-check.md；从 Agent 页打开时列出全部文件）、运行环境 `Select`（有多个运行环境时出现，默认 Windows）、渲染与源码切换（`ToggleGroup`）。档位不在这里切换，以详情面板为准。
- 预算区：两条 `Progress`，分别表示 description 字符数和正文行数相对上限的占用（阈值规则见 DESIGN.md）。
- Lint 区：用 `Item` 列表展示错误和警告。点击后切到源码视图并定位到对应行。
- 内容区：渲染视图用 `streamdown`，外面包 `div.typeset`；源码视图用 `CodeBlock` 加 `useHighlightedCode(content, "markdown")` 和行号。
- 底部：编译目录（等宽，截断），「复制路径」「在文件夹中显示」。
- 有未保存修改时，标题显示「草稿预览」，并注明「保存后发布」。草稿编译请求做 200ms 防抖，只取最后一次请求的结果。

**探测流程**

1. 点击「探测」后打开探测 `Sheet`，用 `Trace` 实时显示每个步骤：解析别名、建立连接、采集系统信息、采集服务、采集监听端口、合并与编译。运行中的步骤设置 `status="running"`，失败的设置 `status="error"`，`TraceDescription` 显示耗时。
2. 探测过程中，「探测」按钮变为「取消探测」。用户可以关闭 Sheet 或切换服务器，探测在后台继续，卡片上显示 `Spinner`。完成后用 Toast 通知「探测了 hk-edge，更新了 3 处」，附「查看」和「撤销」按钮。
3. 完成后，Sheet 显示本次更新：

```text
+----------------------------------------------------------------------------+
| 探测完成  hk-edge  2026-10-31 14:02  用时 3.1s                      [x]    |
+----------------------------------------------------------------------------+
| 已更新 3 处，已重新编译                                                    |
|   + 新增服务   api-gateway  my-api:v1.2  127.0.0.1:8080->8080             |
|   ~ 系统       Ubuntu 22.04 -> Ubuntu 24.04                               |
|   - 未发现     old-worker（保留标注，标记为「未发现」）                   |
| 待确认 1 处：疑似指令注入，没有自动合并                                    |
|   [ ] + 新增服务   ignore-previous-instructions  alpine:3.20               |
+----------------------------------------------------------------------------+
| [查看探测脚本]                           [撤销本次更新]  [合并所选]        |
+----------------------------------------------------------------------------+
```

- 已更新的每条是一个 `Item`，展开后用 `CodeBlockLine`（`added` 或 `removed`）展示前后对比。只有待确认的项带 `Checkbox`，「合并所选」只作用于它们。
- 「撤销本次更新」恢复这次探测改动过的字段并重新编译，结果用 Toast 播报。只能撤销最近一次探测。
- 没有变化时只显示一行：「未发现变化，已更新探测时间」。
- 失败时，`Trace` 的最后一步显示错误，下方用 `Alert variant="destructive"` 给出分类文案和建议（见 8.3）。需要用户在终端里执行的命令用 `CodeBlock` 配复制按钮展示。

### 6.5 新建服务器与测试连接

点击「新建服务器」后，详情面板切换为新建表单。不用对话框：新建和编辑使用同一块区域，用户可以对照左边的列表。

```text
+------------------------------------------------------------+
| 新建服务器                                           [x]   |
|------------------------------------------------------------|
| 名称 *      [香港边缘节点                              ]   |
| 地址 *      [203.0.113.10                ]  端口 [22   ]   |
| 用户 *      [root                                      ]   |
| 认证方式    ( 私钥文件 )( ssh-agent )( 密码 )              |
| 私钥        Windows    [C:\Users\me\.ssh\id_ed25519] [选择]|
|             WSL Ubuntu [/home/me/.ssh/id_ed25519   ] [选择]|
| 环境        ( 生产 )( 预发 )( 开发 )                       |
| > 高级      别名 hk-edge · 跳板机 · 写入的运行环境         |
|------------------------------------------------------------|
| [测试连接]  ✓ 已连接 · 0.8s · Ubuntu 24.04                 |
|                                     [取消]  [保存并探测]   |
+------------------------------------------------------------+
```

- 字段顺序与常见 SSH 客户端的新建主机一致：名称、地址、端口、用户、认证。别名默认由名称生成（转小写、空格换成连字符），实时显示在「高级」的折叠标题上。
- 认证方式用 `ToggleGroup`：
  - **私钥文件**：每个可用运行环境一行路径输入，带文件选择按钮（`@tauri-apps/plugin-dialog`）。WSL 的那一行可以「从 Windows 复制一份到 WSL」（复制到 `~/.ssh/` 并设置 600 权限），用于解决 `/mnt/c` 下权限过宽的问题。
  - **ssh-agent**：说明「使用系统 ssh-agent 中已加载的密钥」，并显示 `ssh-add -l` 检测到的密钥数量。
  - **密码**：密码输入框（`type="password"`，带显示切换）。下方常驻 `Alert`：「Agent 无法输入密码。测试连接通过后，可以一键改用密钥登录，否则这台服务器不能分发。」
- 「测试连接」按钮在表单底部左侧，结果原地显示在按钮旁，不弹 Toast：
  - 进行中：按钮内 `Spinner`，旁边「正在连接…」，按钮变为「取消」。
  - 首次连接：弹出 `AlertDialog` 显示主机指纹（`SHA256:…`，等宽），选项「信任并继续 / 取消」。
  - 成功：`CircleCheckIcon` 加「已连接 · 耗时 · 远端系统」。如果认证方式是密码，紧接着显示「改用密钥登录」按钮（F-108）。
  - 失败：`CircleXIcon` 加分类文案和下一步（8.3），例如「认证失败：服务器拒绝了这把私钥。确认公钥已加入服务器的 ~/.ssh/authorized_keys。」
- 主按钮：测试通过时为「保存并探测」；未测试或失败时为「保存」，点击后提示「连接未验证，保存后不能分发」，用户可以继续保存。
- 首次写入托管 ssh 配置前，弹出 F-107 的 `AlertDialog`，展示将要加入 `~/.ssh/config` 开头的那一行，选项「加入 Include / 暂不加入」。
- 编辑已有服务器的连接信息使用同一组字段。

### 6.6 Agent 视图

取代 v2 的挂载视图和 Agent 视角。页面是一列，三个分区各有一个 `h2`：交给 Agent 的内容、护栏、分发目标。

```text
+----------+--------------------------------------------------------------------------------+
| 侧栏     | Agent                                                [预览 Skill]  [检查全部]  |
|          | 3 台服务器已列入 · 4 个目标已启用 · 1 个副本需要修复                           |
|          |--------------------------------------------------------------------------------|
|          | 交给 Agent 的内容                                                              |
|          |   服务器之间的关系  [hk-edge reverse-proxies api.example.com to the API ... ]  |
|          |   运维约定          1. Deploy with docker compose in /opt/apps/<name> ...      |
|          |                     2. Tell the user before restarting anything on ...   [+]   |
|          |   巡检清单          内置，Agent 巡检时只执行只读命令                  [查看]   |
|          |--------------------------------------------------------------------------------|
|          | 护栏（Claude Code）                                              [查看规则]    |
|          |   Windows          已生效 · 今天拦下 2 条                            [移除]    |
|          |   WSL · Ubuntu     未安装                                            [安装]    |
|          |   护栏只解析命令文本，能防手滑，防不了刻意绕过。Codex 没有护栏。               |
|          |--------------------------------------------------------------------------------|
|          | 分发目标                                                    [+ 自定义目录]     |
|          | Windows                                                                        |
|          | +----------------------------------------------------------------------------+ |
|          | | [Claude] Claude Code   ~\.claude\skills        已同步 3 台   [====o] 启用   | |
|          | +----------------------------------------------------------------------------+ |
|          | | [Agents] 通用（Codex 等）  ~\.agents\skills    未检测到      [o====] 停用   | |
|          | +----------------------------------------------------------------------------+ |
|          | WSL · Ubuntu-24.04                                                             |
|          | +----------------------------------------------------------------------------+ |
|          | | [Claude] Claude Code   ~/.claude/skills        副本缺失 [修复] [====o] 启用 | |
|          | +----------------------------------------------------------------------------+ |
|          | | [Agents] 通用（Codex 等）  ~/.agents/skills    已同步 2 台   [====o] 启用   | |
|          | +----------------------------------------------------------------------------+ |
+----------+--------------------------------------------------------------------------------+
```

- **交给 Agent 的内容**：「服务器之间的关系」（`Textarea`，带字数统计）；「运维约定」（可排序的 `Textarea` 列表，与红线编辑器相同）；「巡检清单」只读，「查看」打开预览 Sheet 并定位到 health-check.md。修改后底部出现与服务器详情相同的保存操作条，保存后重新编译。
- **护栏**：每个有 Claude Code 目标的运行环境一行 `Item`：状态（已生效 / 未安装 / 未生效及原因 / 不可用及原因）、今天拦下的数量，操作是「安装」或「移除」。安装前弹 F-306 AC1 的 `AlertDialog`，用 `CodeBlock` 展示将要写入的 JSON 和备份位置。「查看规则」打开 `Sheet`，列出只读白名单和标准运维下拦下的命令类别（8.6）。分区底部常驻一行说明：「护栏只解析命令文本，能防手滑，防不了刻意绕过。Codex 没有护栏，它默认每条 ssh 都要你批准。」
- **分发目标**：按运行环境分组，每个目标一张 `Card size="sm"`：Agent 图标与名称、目录（等宽、截断）、检测状态、副本状态（已同步 N 台 / 副本缺失 / 副本被改动 / 待同步 / 冲突），有问题时显示「修复」，以及启用 `Switch`。「更多」菜单：在文件夹中显示、检查；自定义目录额外有「移除」。
- 停用目标前弹 `AlertDialog`（F-302 AC2）。
- 顶部摘要中的问题数可点击，滚动到第一个有问题的位置。

### 6.7 设置视图

左侧是用 `Item` 做的分区导航，右侧是对应表单（`FieldSet`）。

| 分区 | 内容 |
| :--- | :--- |
| 通用 | 主题（跟随系统 / 浅色 / 深色）；编译产物语言（v0.1 固定英文，P1 起可切换）；新建非生产服务器的默认档位。v0.1 的界面只有简体中文 |
| 运行环境 | 已检测到的环境列表，每项有启用开关；重新检测按钮 |
| ssh 配置 | 每个运行环境一行：托管文件路径、是否已加入 Include（未加入时提供「加入 Include」按钮和手动添加的说明）、`known_hosts` 路径 |
| 编译 | 正文行数上限（默认 100）；是否在 SKILL.md 中写入数据快照时间 |
| 探测 | 超时时间；查看探测脚本（`CodeBlock`，语言为 bash，只读）；主机密钥策略固定为严格校验，只展示 |
| 活动 | 活动日志和 Agent 操作记录（见下） |
| 数据 | 数据目录；打开日志目录；导出或导入 JSON（P1） |
| 危险操作 | 移除全部分发；清空数据（同时删除托管 ssh 配置、凭据库中的密码、护栏的 hook、笔记收件箱和操作记录）。都使用 destructive 按钮并配 `AlertDialog`，确认时要求输入「移除全部」或「清空数据」 |

**活动日志**：按天分组，分页加载（每次 100 条，底部「加载更多」），不引入虚拟列表库。每条记录是一行 `TraceLine`，图标按类型区分：测试连接 `PlugIcon`、探测 `RadarIcon`、编译 `HammerIcon`、分发 `FolderSyncIcon`、移除 `FolderMinusIcon`、修复 `WrenchIcon`、ssh 配置 `FileCogIcon`、护栏 `ShieldIcon`、解锁 `LockOpenIcon`、笔记 `NotebookPenIcon`、Agent 操作 `TerminalIcon`。标题写成完整的句子，例如「探测了 hk-edge，更新了 2 处」「Agent 在 hk-edge 上执行的 `docker restart api` 被护栏拦下」。有详情的记录用 `TraceCollapsible` 展开。筛选：类型用 `ToggleGroup`（其中「Agent 操作」单独一项），服务器用 `Combobox`。

### 6.8 导入与首次启动

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
| 已跳过 2 个通配 Host（Host *、Host *.internal）                [v] 导入后测试连接并探测          |
|                                                                         [取消]  [导入 2 台]      |
+--------------------------------------------------------------------------------------------------+
```

- 表格用 `Table` 配 `Checkbox`，表头的复选框可以全选。HostName 等信息只在本地展示。
- 导入后，新卡片以 Motion 的进入动画出现，并自动选中第一台。

**首次启动**：服务器视图显示空状态，使用 `Empty` 组件：

```text
+--------+-------------------------------------------------------------------------------------------+
| 侧栏   |                                    [ServerIcon]                                           |
|        |                               还没有服务器                                                |
|        |   录入服务器并测试连接，CloudLink 会把它们编译成一个 Skill 交给本机的 Agent，             |
|        |   并在 Claude Code 上用护栏守住档位。                                                     |
|        |                                                                                           |
|        |   (v) 1 检测运行环境与 Agent     已发现 Windows、WSL Ubuntu；Claude Code、Codex           |
|        |   ( ) 2 新建第一台服务器并测试连接                               [新建服务器]             |
|        |   ( ) 3 打开「分发给 Agent」                                                              |
|        |   ( ) 4 为 Claude Code 安装护栏                                  [安装护栏]               |
|        |                                                                                           |
|        |                              或者 [从 ssh config 导入]                                    |
+--------+-------------------------------------------------------------------------------------------+
```

清单的每一步是一个 `Item`，`ItemMedia` 显示 `CircleCheckIcon` 或 `CircleDashedIcon`。全部完成后，这个清单不再出现。

### 6.9 键盘与命令面板

| 快捷键（macOS 用 Cmd） | 作用 |
| :--- | :--- |
| `Ctrl+K` | 打开命令面板（`CommandDialog`） |
| `Ctrl+N` | 新建服务器 |
| `Ctrl+S` | 保存当前服务器 |
| `Ctrl+B` | 折叠或展开侧栏（shadcn Sidebar 内置） |
| `Ctrl+\` | 打开或关闭预览 Skill |
| `/` | 聚焦服务器搜索框 |
| `Ctrl+1` 到 `Ctrl+3` | 切换一级视图 |
| `Esc` | 关闭浮层 |

命令面板分三组：

- **跳转**：三个视图，以及按名称或别名搜索的服务器。
- **服务器**：新建服务器、从 ssh config 导入、测试连接、探测当前服务器、探测全部、切换当前服务器的分发开关、临时解锁当前服务器 30 分钟（解锁期间为「立即锁回」）。
- **系统**：预览 Skill、检查全部分发、切换主题。

### 6.10 状态全集（每个视图都必须实现）

| 场景 | 状态 | 呈现 |
| :--- | :--- | :--- |
| 首次加载数据 | 加载中 | 卡片和详情用 `Skeleton`（超过 150ms 才显示）；按钮内用 `Spinner` |
| 列表为空 | 空 | `Empty` 组件，写明下一步要做什么（新建或导入） |
| 搜索无结果 | 空 | 「没有匹配的服务器」，附「清除搜索」按钮 |
| IPC 调用失败 | 错误 | `Alert variant="destructive"`，附「重试」；严重错误时追加「打开日志目录」 |
| 对话框或表单里有未提交的改动 | 防误关 | 关闭前弹出 `AlertDialog`：「放弃修改 / 继续编辑」 |
| 测试连接 | 未验证、连接中、已连接、连接失败、已取消 | 见 6.5 |
| 探测 | 运行中、已更新、无变化、有待确认项、失败、已取消、已撤销 | 见 6.4 探测流程 |
| 编译 | 正常、警告、受阻 | 详情头部的摘要行、Agent 页顶部摘要，加预览 Sheet 的 Lint 区 |
| 列入 | 已列入、未列入（带原因） | 详情 Agent 分段 |
| 分发 | `pending`、`ok`、`missing`、`modified`、`outdated`、`conflict` | Agent 页目标卡片的图标加状态词；状态词表见 6.11 |
| 护栏 | 已生效、未安装、未生效（带原因）、不可用（带原因） | Agent 页护栏分区；详情 Agent 分段的护栏行 |
| 临时解锁 | 已解锁（剩余分钟数）、到期自动锁回 | 卡片徽章、详情 Agent 分段；到期时用 Toast 播报 |
| Agent 笔记 | 无、待处理、需编辑（命中密钥）、疑似注入 | 卡片徽章、详情笔记分段 |
| 操作记录 | 空（「还没有记录。只记录经过护栏的命令」）、有记录、有拦下 | 详情操作记录分段 |
| 未保存修改 | 草稿 | 底部操作条，预览标为「草稿预览」 |
| 长内容 | 溢出 | 名称、路径和命令用 `truncate` 加 `Tooltip`；表格横向滚动 |
| 窗口缩窄 | 小于 1024px | 侧栏进入图标模式；卡片网格变为单列 |

### 6.11 文案规范与状态词表

- 界面状态词只用中文，禁止中英混写。专有名词保留英文：Skill、SSH、Agent、Token。
- 按钮写动作，例如「保存并探测」「导入 2 台」「撤销本次更新」，不要写「确定」。
- 错误文案写清楚两件事：出了什么问题，接下来怎么办。
- 术语：界面上一律说「服务器」「分发」，不说「资产」「挂载」。护栏只叫「护栏」，不叫「防火墙」或「沙箱」，避免让人以为它是安全边界。

| 对象 | 状态词 |
| :--- | :--- |
| 连接 | 未验证、连接中、已连接、连接失败 |
| 列入 | 已列入、未列入 |
| 分发 | 同步中、已同步、副本缺失、副本被改动、待同步、冲突 |
| 探测 | 从未探测、探测中、正常、已过期（超过 30 天）、失败 |
| 编译 | 正常、有警告、编译受阻 |
| 护栏 | 已生效、未安装、未生效、不可用 |
| 解锁 | 已解锁、已锁回 |
| Agent 操作 | 已放行、已拦下、解锁期间放行 |
| Agent 笔记 | 待处理、需编辑、已并入、已忽略 |
| 环境 | 生产、预发、开发 |
| 档位 | 只读巡检、标准运维 |
| Agent 目标 | 已启用、已停用、未检测到 |

### 6.12 可访问性

- 达到 WCAG 2.2 AA。焦点环使用 Signal Cyan，在浅色主题下对比度为 3.6:1，在深色主题下为 8.3:1。
- 所有纯图标按钮都要有 `aria-label` 和 `Tooltip`。
- 状态必须同时用图标、文字和颜色表达，不能只靠颜色。
- v3 不再有拖拽分发，所有操作都能用键盘完成；路径、红线和运维约定的排序仍可拖拽，同时提供键盘排序（dnd-kit `KeyboardSensor`）。
- 异步操作的结果通过 Toast 或原地状态播报。测试连接的结果区域设置 `aria-live="polite"`。临时解锁的剩余时间每分钟更新一次，不设置 `aria-live`；到期时用 Toast 播报「hk-edge 已自动锁回」。
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
| 应用导航、侧栏折叠、计数徽章 | `Sidebar`（`collapsible="icon"`）、`SidebarMenuButton isActive`、`SidebarMenuBadge`、`SidebarTrigger` | 自写侧栏或折叠逻辑 |
| 多栏布局、拖拽分隔条、面板折叠、布局持久化 | `ResizablePanelGroup`、`ResizablePanel`（`collapsible`、`minSize`、`panelRef`）、`ResizableHandle`。用 `const { defaultLayout, onLayoutChanged } = useDefaultLayout({ id })` 拿到两个值，传给 `ResizablePanelGroup`；每个面板都要有稳定的 `id`；折叠和展开调用 `panelRef.current.collapse()` 和 `expand()` | 自写分隔条；使用 CSS resize |
| 可用键盘导航的选择列表（命令面板、导入列表以外的 Combobox 选项） | `Command`（`shouldFilter={false}`）、`CommandInput`、`CommandList`、`CommandGroup`、`CommandItem`、`CommandEmpty` | 自写 roving tabindex 或方向键处理 |
| 服务器卡片列表 | `Card size="sm"` 放在 CSS Grid 中；卡片间方向键导航用 `src/lib/grid-nav.ts` 中的一个小函数（按 DOM 顺序和列数计算），这是 7.3 里唯一允许的自写键盘逻辑 | 引入网格或虚拟列表库 |
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
| 较复杂的编辑流程（导入） | `Dialog` | 自写模态框 |
| 侧边浮层（预览 Skill、探测、护栏规则） | `Sheet`（`side="right"`） | 自写抽屉 |
| 开关（分发、Agent 启用） | `Switch` | 用 Checkbox 或按钮模拟 |
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
| `useUIStore` | `view`（servers、agents、settings）、`selectedAssetId`、`creating`（是否处于新建表单）、`query`、`sectionsOpen`（详情各分段的展开状态）、`previewOpen`、`previewEnvId`、`commandOpen`。主题不放在这里，由 ThemeProvider 管理 | `setView`、`selectAsset`、`startCreate`、`setQuery`、`toggleSection`、`openPreview` | 只持久化 `sectionsOpen` |
| `useAssetStore` | `byId`、`ids`、`status`、`error` | `load`、`create`、`save`（返回编译结果）、`remove`、`importHosts`、`setDistribute`、`setMode`、`unlock`、`lock` | 否 |
| `useConnectionStore` | `testsByKey`（按服务器 id 或新建表单的临时键索引：状态、耗时、远端系统、错误 id、待确认的主机指纹） | `test`、`cancel`、`trustHostKey`、`convertToKey` | 否 |
| `useProbeStore` | `runs`（按 runId 索引，含已合并和待确认的变化）、`activeRunByAsset` | `start`、`cancel`、`confirmItems`、`undo`；`_onProgress`、`_onFinished` 由事件桥调用 | 否 |
| `useSkillStore` | `config`（服务器之间的关系、运维约定）、`statusByEnv`（每个运行环境的编译状态） | `load`、`saveConfig`、`_onCompiled` | 否 |
| `useTargetStore` | `environments`、`targets` | `detect`、`setEnabled`、`addCustom`、`removeCustom` | 否 |
| `useDeliveryStore` | `byId`、`inclusions` | `checkAll`、`repair`；`_onChanged`。分发和列入都由后端计算，前端不单独创建 | 否 |
| `useGuardStore` | `statusByEnv`、`rules` | `load`、`install`、`remove`；`_onChanged` | 否 |
| `useNotesStore` | `byAsset`（待处理的笔记） | `load`、`merge`、`dismiss`；`_onNew` | 否 |
| `useOperationStore` | `recentByAsset`（每台最近 50 条） | `load`、`_onNew` | 否 |
| `useActivityStore` | `items` | `load`、`_onNew` | 否 |

需要提供的 selector：

- `selectServerGroups(state, query)`：按环境分组、按名称排序后的服务器列表（搜索匹配名称、别名、标签、站点名）。
- `selectInclusionsByAsset(assetId)`：详情 Agent 分段使用。`selectDeliveriesByEnv()`：Agent 页使用。
- `selectCanDistribute(asset)`：返回 `{ ok: true }` 或 `{ ok: false, reason }`（未验证、只有密码认证等）。纯函数，必须有单元测试。
- `selectUnlockRemaining(asset, now)`：返回剩余分钟数，未解锁或已到期时返回 `null`。纯函数，必须有单元测试。
- `selectHealth()`：返回副本问题、护栏问题和编译受阻的数量。

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
- 只允许以下 4 个场景，范围之外不加动效：

| 场景 | 实现 | 时长 |
| :--- | :--- | :--- |
| Agent 笔记条目的离开（并入或忽略后） | `AnimatePresence`，配合 `layout`、`exit={{opacity:0,y:-4}}` | 离开 120ms |
| 测试连接结果出现 | 结果行包在 `motion.div` 里，`initial={{opacity:0}}` | 150ms |
| 探测步骤逐条出现 | 新的 `TraceLine` 包在 `motion.div` 里，`initial={{opacity:0,y:4}}` | 150ms |
| 新建或导入后新增的服务器卡片 | `AnimatePresence` | 180ms |

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
  testConnection: (req: ConnectionTestRequest) => invoke<{ testId: string }>("test_connection", { req }),  // 结果经 connection://tested 返回
  cancelConnectionTest: (testId: string) => invoke<void>("cancel_connection_test", { testId }),
  trustHostKey: (testId: string, fingerprint: string) => invoke<void>("trust_host_key", { testId, fingerprint }),
  setPassword: (assetId: string, password: string | null) => invoke<void>("set_password", { assetId, password }),  // 写入系统凭据库；null 为删除
  convertToKeyAuth: (assetId: string) => invoke<Asset>("convert_to_key_auth", { assetId }),
  getSshConfigStatus: () => invoke<SshConfigStatus[]>("get_ssh_config_status"),
  addSshInclude: (envId: EnvId) => invoke<SshConfigStatus>("add_ssh_include", { envId }),
  setDistribute: (assetId: string, on: boolean) => invoke<Inclusion[]>("set_distribute", { assetId, on }),
  setMode: (assetId: string, mode: Mode) => invoke<SaveResult>("set_mode", { assetId, mode }),
  unlockServer: (assetId: string) => invoke<{ unlockedUntil: string }>("unlock_server", { assetId }),  // 固定 30 分钟
  lockServer: (assetId: string) => invoke<void>("lock_server", { assetId }),
  startProbe: (assetId: string) => invoke<{ runId: string }>("start_probe", { assetId }),
  cancelProbe: (runId: string) => invoke<void>("cancel_probe", { runId }),
  confirmProbeItems: (runId: string, changeIds: string[]) => invoke<SaveResult>("confirm_probe_items", { runId, changeIds }),  // 只用于待确认项
  undoProbe: (runId: string) => invoke<SaveResult>("undo_probe", { runId }),
  getSkillConfig: () => invoke<SkillConfig>("get_skill_config"),
  saveSkillConfig: (input: SkillConfig) => invoke<CompileStatus[]>("save_skill_config", { input }),
  previewSkill: (req: { envId: EnvId; asset?: AssetInput; config?: SkillConfig }) => invoke<CompilePreview>("preview_skill", { req }),  // 带草稿时预览草稿
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
  getProbeScript: () => invoke<string>("get_probe_script"),
};

export interface CompilePreview {
  envId: EnvId;
  files: { path: string; content: string }[];                   // SKILL.md 排在第一个
  budget: { descriptionChars: number; descriptionLimit: number; bodyLines: number; bodyLineLimit: number };
  lint: { id: LintId; level: "error" | "warning" | "info"; assetId?: string; params?: Record<string, string | number>; file?: string; line?: number }[];
  // 后端只返回 id 和参数，不返回中文句子；界面文案由 src/lib/copy.ts 按 id 映射（探测错误分类、护栏原因同理）
  blocked: boolean;                                              // 有 error 级 Lint 时为 true，此时不会发布
}

export interface CompileStatus { envId: EnvId; blocked: boolean; errors: number; warnings: number; compiledAt: string | null }
```

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

**Mock 模式**：运行 `pnpm dev:mock`（即 `vite --mode mock`，读取 `.env.mock` 中的 `VITE_MOCK=1`）后，前端在渲染之前调用 `@tauri-apps/api/mocks` 的 `mockIPC(handler, { shouldMockEvents: true })`，于是可以直接在普通浏览器里开发界面，也可以跑 Playwright。

Mock 夹具（`src/mocks/fixtures.ts`）必须覆盖下面这些状态：

| 类别 | 夹具内容 |
| :--- | :--- |
| 运行环境 | Windows 和 WSL Ubuntu-24.04 |
| 服务器 | `hk-edge`：生产，managed，私钥认证，已验证，已探测，分发开，只读，有 3 条待处理的 Agent 笔记（其中 1 条命中密钥）；`sg-db`：生产，imported，已验证，只读，分发开，探测会失败（主机密钥未信任），处于临时解锁中（剩 23 分钟）；`dev-box`：开发，managed，密码认证，未验证，分发关 |
| 测试连接 | 新建表单中：地址含 `timeout` 时超时失败，含 `refused` 时连接被拒，用户为 `bad` 时认证失败，其余成功；首次测试一个新地址时先返回待确认的主机指纹 |
| Agent 目标 | Claude Code（Windows，已检测，启用）；通用 .agents（Windows，未检测到，停用）；Claude Code（WSL，已检测，启用）；通用 .agents（WSL，已检测，启用）；一个自定义目录（Windows，启用） |
| 列入与分发 | `hk-edge` 在 WSL 中未列入（WSL 中没有配置私钥）；副本状态覆盖 `ok`、`missing`、`modified`、`conflict`（目录中已有用户手写的 `cloudlink-servers`） |
| 总 Skill | 示例的「服务器之间的关系」和 2 条运维约定；Windows 环境的编译有 1 条警告 |
| 护栏 | Windows 已生效；WSL 未安装 |
| 操作记录 | `hk-edge` 最近 20 条，其中 2 条被拦下（一条写操作、一条读取 `.env`）；`sg-db` 有解锁期间放行的记录 |
| ssh 配置 | Windows 已加入 Include；WSL 未加入（用于验证 F-107 的同意对话框） |
| 探测 | 模拟 3 秒的进度事件；对 `hk-edge` 自动更新 3 处，另有 1 处疑似注入的待确认项 |

### 7.9 目录结构

```text
src/
  main.tsx                 根节点：ThemeProvider（模板自带）、MotionConfig、TooltipProvider、Toaster、事件桥
  App.tsx                  SidebarProvider + AppSidebar + SidebarInset + 视图切换
  index.css  typeset.css
  components/ui/           shadcn 生成的组件（可以改源码，但禁止新增同类组件）
  components/theme-provider.tsx   shadcn Vite 模板自带（删掉其中按 d 键切换主题的监听）
  components/app/          应用级组合组件：AppSidebar、CommandMenu、EnvBadge、StateBadge、SkillPreview、EmptyState
  features/servers/        ServersView、ServerGrid、ServerCard、ServerDetail（含各分段，其中有 NotesSection、OperationsSection）、
                           ServerForm（新建与编辑连接）、ConnectionTest、HostKeyDialog、UnlockControl、ProbeSheet、PreviewSheet、ImportDialog
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
4. 只用键盘就能完成以下操作：在服务器卡片之间移动并打开详情，`Ctrl+N` 新建并填写表单、测试连接、保存，用空格切换分发开关和 Agent 启用开关，`Ctrl+K`，`Ctrl+S`。
5. Playwright 截图覆盖服务器（列表加详情）、新建服务器、Agent、设置 4 个画面，浅色和深色各一套，宽度 1280 和 1024 各一套。截图中不出现文字溢出或遮挡，焦点环清晰可见。
6. 只修改了 7.6 列出的令牌，没有新增任何颜色值（用 `grep -E "oklch\(|#[0-9a-f]{3,6}"` 检查 `src/` 下除 `index.css` 和上游原样的 `typeset.css` 以外的文件，见 7.2 已知的坑第 10 条）。

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
| `secret` | 密码存取（Windows 凭据管理器，键为 `cloudlink:<assetId>`）；`SSH_ASKPASS` 辅助程序（应用自身以 `--askpass` 参数启动，经本地命名管道向主进程取一次性密码，不经命令行和环境变量传递明文）；生成 ed25519 密钥并安装公钥（F-108） | `keyring`、`ssh-key` |
| `probe` | 内置并版本化的探测脚本；解析输出；自动合并（合并前保存快照，用于撤销）；疑似注入的值列为待确认 | 标准库 |
| `compile` | 按运行环境渲染总 Skill（内置英文模板）；Lint；密钥扫描；原子发布 | `minijinja`、gitleaks 规则集、`regex`、`sha2` |
| `deliver` | 受管复制：把各运行环境的编译产物写进已启用的目标（WSL 目标经 `\\wsl.localhost\<发行版>\` 路径写入）；所有权校验；冲突判定；列入计算；健康检查与修复 | `sha2`（副本内容哈希） |
| `guard` | 写入护栏策略 `policy.json`；在各运行环境的 `~/.claude/settings.json` 中安装和移除 hook（WSL 经 `\\wsl.localhost\` 路径；同意、备份、原子写入、保留其余内容和键顺序）；把护栏程序复制到 `~/.cloudlink/bin/`；自检；临时解锁；读入护栏记录（F-307） | `serde_json`（`preserve_order`） |
| `notes` | 读取笔记收件箱、扫描、并入与忽略（F-308） | 标准库 |
| `ipc` | Tauri 命令与事件；类型导出 | `ts-rs` |
| `cloudlink-guard`（独立的小程序） | 护栏本体：从标准输入读 hook 的 JSON，按 8.6 判定，输出拦截结果并追加记录。和 `guard` 模块共用规则 crate `guard-rules`；不联网、不读数据库，Windows 上从启动到退出不超过 50ms | `serde_json` |

Rust 依赖锁定的主版本（2026-10-27 核实）：`tauri` 2.12、`tauri-build` 2.7、`rusqlite` 0.41（features = bundled）、`minijinja` 3、`ssh2-config` 0.9、`keyring` 3、`ssh-key` 0.6（features = ed25519）、`ts-rs` 12、`serde` 1、`serde_json` 1（features = preserve_order）、`thiserror` 2、`tokio` 1、`ulid` 3、`regex` 1、`sha2` 0.11、`dirs` 7；开发依赖 `tempfile` 3。v3 去掉了 `tiktoken-rs`（不再估算 Token）和 `junction`（不再使用链接）。

Tauri 插件：`tauri-plugin-dialog`、`tauri-plugin-opener`、`tauri-plugin-window-state`、`tauri-plugin-single-instance`、`tauri-plugin-log`。**不向前端暴露 shell 插件和 fs 插件**：所有系统操作都由具名的 Rust 命令完成，capability 按最小权限配置。护栏程序作为 sidecar 打包（`bundle.externalBin`，文件名带目标三元组后缀）。

### 8.2 分发方式：一律受管复制

v3 起不再使用符号链接和 Junction，所有目标都用受管复制。理由：

- CloudLink 是总 Skill 唯一的写入方，每次发布都会同步全部副本，链接「改一处、处处生效」的好处用不上。
- 链接在各 Agent 中的支持参差不齐：Claude Code 有 Junction 挂进来的 Skill 无法调用（#41177）、Node/Bun 把 Junction 识别为链接（#68318）、某些版本按 `isDirectory()` 过滤漏掉链接（#14836）等问题，自动更新还删过 `~/.claude/skills` 下的链接（#50052）。改用复制可以一并避开，还省掉了链接方式切换、WSL 路径换算和链接失效检测。

| 目标所在的运行环境 | 写入方式 |
| :--- | :--- |
| Windows | 直接写入目标目录 |
| WSL | 经 `\\wsl.localhost\<发行版>\<家目录>\...` 路径写入；发行版没有运行时，访问该路径会启动它 |
| macOS、Linux（v0.5 / v1.0 起） | 直接写入目标目录 |

- 每次发布先把新内容写到目标旁边的暂存目录，再整体交换（做法同 8.4），保证 Agent 不会读到写了一半的 Skill。
- 副本里的 `.cloudlink.json` 记录写入时的内容哈希。健康检查（F-305）据此区分「副本缺失」、「副本被改动」（实际内容与标记中的哈希不一致）和「待同步」（标记中的哈希不是最新的编译结果）。

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
ssh -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=yes <alias> 'sh -s' < probe.sh
```

整个探测 30 秒超时，超时后终止进程。

测试连接（F-106）使用同一套 ssh 调用，只执行 `true` 和 `cat /etc/os-release` 两条命令；managed 服务器在保存前测试时，用一份只含这台服务器的临时配置（`ssh -F <临时文件>`），保存后改用托管配置。首次连接使用 `StrictHostKeyChecking=yes` 先取回指纹（`ssh-keyscan` 加 `ssh-keygen -lf`），用户确认后再以 `accept-new` 写入 `known_hosts`。密码认证时去掉 `BatchMode=yes`，加 `PreferredAuthentications=password,keyboard-interactive` 和 `NumberOfPasswordPrompts=1`，并设置 `SSH_ASKPASS_REQUIRE=force`。

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

### 8.4 编译与原子发布

1. **校验**：serde 加业务规则。
2. **渲染**：使用 minijinja 模板，内置模板随应用版本一起发布。每个运行环境渲染一份总 Skill，只包含该环境列入的服务器（3.4）；笔记收件箱的路径按该环境渲染成绝对路径。
3. **Lint**：规则见 5.4。
4. **写入暂存目录**：写到 `compiled/.staging/<环境>-<随机后缀>/`，然后 fsync。
5. **交换目录**：把旧目录重命名为 `.trash/...`，再把新目录重命名为正式路径，最后删除 `.trash`。Windows 上如果因为文件被占用导致重命名失败，就退避重试 3 次；仍然失败时保留旧产物，界面提示「编译受阻：目录被占用」。
6. **发布结果**：写入所有权标记，发出 `compile://finished` 事件，然后按 8.2 同步该环境全部已启用目标的副本。

### 8.5 安全

- 前端只能调用具名的 Tauri 命令。capability 中不授予 `shell:allow-execute`，也不开放任意文件系统读写。
- CSP 禁止加载远程脚本。
- 本软件自身需要的凭据（服务器密码、P2 的 Cloudflare Token）存放在系统凭据库，不进入 SQLite，不写日志。
- 托管 ssh 配置和 `~/.ssh/config` 的写入都是原子的（写临时文件再重命名），修改用户 config 前先备份。
- 修改 Claude Code 的 `settings.json` 时：先征得同意并备份；文件不是合法 JSON 时不做任何修改，只提示用户；只增删命令指向 `cloudlink-guard` 的那一条；原子写入。
- 护栏策略 `policy.json` 含服务器地址，和 `data.db` 一样放在用户目录下的 `~/.cloudlink/`，不进入 Skill。
- 笔记收件箱和护栏记录由 Agent 一侧写入，按不可信输入处理：长度上限、密钥扫描、疑似注入检查，界面上只以纯文本展示。

### 8.6 护栏（F-306）

**安装形态。** 在每个有 Claude Code 目标的运行环境中，往 `~/.claude/settings.json` 加入下面这一条（Windows 示例）：

```json
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "Bash",
        "hooks": [ { "type": "command", "command": "C:/Users/me/.cloudlink/bin/cloudlink-guard.exe --env windows", "timeout": 10 } ] }
    ]
  }
}
```

WSL 中的 `command` 是同一个 Windows 程序的 `/mnt/c/...` 路径，参数为 `--env wsl:<发行版>`，经 WSL 互操作运行，所以策略和记录只在 Windows 侧有一份。护栏程序按自身所在的位置找到 `policy.json` 和记录目录。互操作被关闭时，该环境的护栏状态为「不可用」。Claude Code 在 Windows 上用哪个 shell 执行 hook 命令、路径里有空格时怎样加引号，P4c 实测后写进本节。

**判定流程。**

1. 不是 Bash 调用，或者命令里没有出现 CloudLink 中任何服务器的别名或地址：立即退出，不判定、不记录。
2. 解析命令。自写保守的 shell 词法分析，处理引号、转义、`;` `&&` `||` `|` `&`、换行、`$()`、反引号和重定向，从中找出 `ssh`、`scp`、`sftp`、`rsync` 的调用及目标服务器（别名、`user@别名`、地址）；`ssh -G` 这类不建立连接的调用不算。远端命令按同样的规则再拆成简单命令。没有找到发往这些服务器的调用（例如只是在本地文件里提到了别名）：退出，不记录。不用通用的 shell 解析库：护栏只需要识别命令边界和 ssh 调用，遇到不认识的结构一律按第 7 步处理，自写更小，也更容易用样本集覆盖。
3. 目标服务器在临时解锁期内：放行，记为「解锁期间放行」。
4. 任何档位：参数指向凭据文件（5.5 第 1 条列出的路径）的命令，以及 `docker inspect`、`env`、`printenv`，一律拦下。
5. 只读巡检：远端命令里的每个简单命令都必须在只读白名单内；不能有输出重定向（重定向到 `/dev/null`，以及 `2>&1` 这类文件描述符复制除外）、`tee`、命令替换、`sudo` 或原地修改参数（如 `sed -i`）。`docker exec <容器> <命令>` 中的命令同样要在白名单内。没有远端命令（交互式登录）、经标准输入传入脚本（`sh -s`、`bash -s`、heredoc）、用 `sh -c` 或 `bash -c` 包装、文件传输（scp、sftp、rsync），都拦下。
6. 标准运维：只拦下危险类别。删除数据：`docker compose down -v`、`docker volume rm` 和 `prune`、`docker system prune --volumes`、对根目录下前两级目录的 `rm -r`、`mkfs`、`dd of=/dev/…`、`wipefs`、`dropdb`、`redis-cli FLUSHALL` 等。重启或关闭主机。修改防火墙：`iptables`、`nft`、`ufw`、`firewall-cmd` 的非查询操作。修改 SSH 配置或 `authorized_keys`，停止或重启 sshd。停止、删除或 kill 标为「关键」的服务。
7. 解析不了的结构：只读服务器上拦下；标准运维服务器上放行，记录中标注「未能解析」。

**只读白名单**（v0.1 内置，v0.5 起可以自定义）：`uptime`、`nproc`、`free`、`df`、`du`、`ls`、`stat`、`cat`、`head`、`tail`、`less`、`grep`、`wc`（这几个只限非凭据路径）、`ps`、`top -b -n 1`、`ss`、`netstat`、`ip addr` 和 `ip route`（只限查看）、`uname`、`hostname`、`date`、`id`、`whoami`、`lsblk`、`findmnt`、`echo`、`command -v`、`which`、`systemctl` 的 `status`、`is-active`、`list-units`、`--failed`、`journalctl`（不含 `--vacuum`、`--rotate`、`--flush`）、`docker` 的 `ps`、`logs`、`stats --no-stream`、`images`、`version`、`info`、`docker compose` 的 `ps`、`logs`、`config --services`、`nginx -t`、`openssl s_client`、`openssl x509 -noout`、`curl -sI`。巡检清单（5.6）中的每条命令都必须能通过这份白名单，由单元测试保证。

**输出。** 拦下时以退出码 0 输出：

```json
{ "hookSpecificOutput": { "hookEventName": "PreToolUse", "permissionDecision": "deny",
  "permissionDecisionReason": "CloudLink guard: hk-edge is read-only, and `docker restart api` is not an inspection command. Describe the change to the user; they can unlock hk-edge in CloudLink for 30 minutes. Do not try to work around this block." } }
```

放行时不输出任何内容，交给 Claude Code 正常的权限流程：护栏只负责拦截，不替用户批准。拦截原因用英文写给 Agent，Claude Code 也会把它显示给用户。

**记录。** 除第 1 步直接退出的情况外，每次判定都向 `~/.cloudlink/guard/log/<日期>.jsonl` 追加一行：时间、运行环境、`session_id`、`cwd`、服务器 id、脱敏后的命令、结果、原因 id。护栏程序内置一份精简的脱敏规则（常见 Token 格式、`password=` 赋值、私钥文件头），CloudLink 读入时再用完整规则集扫描一遍。

**边界与失败处理。**

- 护栏只看命令文本。把命令编码后再执行、先上传脚本再运行、借助其他工具连接服务器，都可能绕过它。界面和 Skill 都如实说明这一点，硬隔离仍要靠低权限 SSH 用户。
- 护栏程序崩溃或超时时，Claude Code 按非阻断错误处理，命令会照常执行（出错即放行）。所以护栏程序只依赖标准库和 serde_json，用不少于 200 条的命令样本集测试，并由健康检查定期自检（F-306 AC5）。
- `policy.json` 缺失或无法解析时，护栏认不出任何服务器，只能放行；自检会报告「护栏未生效」。CloudLink 用原子写入更新策略文件，避免出现写了一半的文件。

---

## 九、非功能需求

| 类别 | 要求 |
| :--- | :--- |
| 性能 | 冷启动不超过 1.5 秒（中端笔记本）；20 台服务器的总 Skill 编译 p95 不超过 200ms；同步全部副本 p95 不超过 1 秒；检查全部分发不超过 1 秒；测试连接（网络正常时）在 3 秒内返回；护栏判定 p95 在 Windows 原生环境不超过 50ms，经 WSL 互操作不超过 300ms；首屏 JS 压缩后不超过 600KB（实测全量冒烟页面约 487KB gzip），预览面板用 `React.lazy` 拆分，streamdown 和 Shiki 的语言包按需加载 |
| 可靠性 | SQLite 使用 WAL 模式；所有文件写入都是原子的；进程崩溃不留下半个产物 |
| 隐私 | 零遥测；除测试连接、SSH 探测和用户主动开启的更新检查外不联网；日志中不记录原始探测输出、密码和解析后的连接信息；操作记录和 Agent 笔记只存在本机，操作记录写入前脱敏，保留 30 天 |
| 兼容性 | v0.1：Windows 10 21H2+ 和 Windows 11（WebView2），以及 WSL2。v0.5：macOS 13+。v1.0：Ubuntu 22.04+（WebKitGTK 4.1） |
| 国际化 | v0.1 界面只有简体中文，全部界面文案集中放在 `src/lib/copy.ts`，便于以后国际化。编译产物默认英文（F-207） |
| 可访问性 | WCAG 2.2 AA，见 6.12 |
| 可维护性 | 数据库带 `schema_version` 并支持迁移；模板版本号写入所有权标记，便于判断产物由哪个模板生成 |
| 更新 | Tauri updater，安装包签名；更新检查需要用户主动开启 |

---

## 十、版本路线图

| 版本 | 里程碑 | 交付内容 | 平台 |
| :--- | :--- | :--- | :--- |
| v0.1（MVP） | 跑通「录入、测试连接、探测、编译、分发给 Agent」的闭环，并让 Agent 在护栏内干活 | F-101 到 103、F-105 到 108；F-201 到 205；F-207（默认英文输出）；F-301 到 308；F-401、402、403、405 | Windows 10/11（原生 + WSL2） |
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

### 11.2 待决问题

| 编号 | 问题 | 建议 |
| :--- | :--- | :--- |
| Q1 | CloudLink 的商标风险 | Dell（数据加密）、Mitel（通信）、Genetec（视频设备）、Texada（SaaS）都有叫 CloudLink 的产品，但都不在 AI 或开发者工具领域。正式发布前要做一次商标检索；npm 包名、域名、Tauri identifier 也要一并确认 |
| Q2 | Logo 和品牌资产 | 需要你提供；在此之前，侧栏只显示文字名称 |
| Q3 | 是否需要团队共享 | 当前定位是个人工具，v1.0 之后再评估 |
| Q4 | 服务器监控（类似探针，查看各服务器的使用情况） | 2026-10-30 讨论后搁置，不进 v0.1。当时的方案是在服务器页加「信息 / 监控」切换：每台服务器一条 SSH 长连会话读取 `/proc`，服务器上不装代理，历史只在内存里保留 1 小时。对照哪吒监控和 Beszel，这个方案有几处缺口：应用关着时没有数据；看不到 Docker 容器的资源占用；只看根分区；认证失败后反复重连，可能触发 fail2ban。以后重新考虑时，先评估能否直接读取用户已经在用的探针（哪吒、Beszel）的数据。v3 的巡检清单（5.6）让 Agent 按需检查服务器状况，覆盖了一部分需求 |

---

## 附录 A：术语表

| 术语 | 含义 |
| :--- | :--- |
| 服务器 | 被描述的云主机（数据模型中叫 Asset；v0.5 起还包括域名、面板、存储） |
| Skill | 符合 Agent Skills 规范的目录，包含 `SKILL.md` 和可选的 `references/` |
| 总 Skill | CloudLink 编译出的唯一一个 Skill `cloudlink-servers`，每个运行环境一份 |
| 列入 | 一台服务器出现在某个运行环境的总 Skill 中 |
| Agent 目标 | 某个运行环境中某个 Agent 的全局 skills 目录 |
| 分发 | 把总 Skill 以受管副本写进 Agent 目标 |
| 托管 ssh 配置 | CloudLink 生成并维护的 `~/.ssh/cloudlink.conf`，经 Include 生效 |
| 连接验证 | 最近一次测试连接或探测成功；未验证的服务器不能打开分发开关 |
| 档位 | 只读巡检或标准运维，服务器的属性；在 Claude Code 上由护栏执行 |
| 红线 | 写给 Agent 的禁止或约束条目，属于建议性约束 |
| 护栏 | 安装在 Claude Code 中、按档位拦截 ssh 命令的 hook |
| 临时解锁 | 对一台服务器解除护栏 30 分钟，期间照常记录 |
| 操作记录 | 护栏判定过的命令清单 |
| Agent 笔记 | Agent 写进收件箱、等用户确认后并入服务器信息的条目 |

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

> 附录 B 记录的是 v2 相对 v1 的变化，其中第 1、3、4、5、6、9 条中关于挂载、变体、项目约定目录、链接方式、汇总清单和 Agent 视角的部分已被 v3 取代，见附录 C。

## 附录 C：v3 相对 v2 的主要变更（2026-10-30 至 31）

1. 取消项目级挂载：只分发到 Agent 的全局 skills 目录。删除项目目标、`.git/info/exclude`、全局与项目档位冲突规则、Agent 视角。理由：项目隔离只限制 Agent 知道什么，不限制它能连什么（`~/.ssh/config` 是全局的）；Skill 本身按需加载，常驻成本每台约 50–70 Token。
2. 档位从「每个挂载一个」改为「每台服务器一个」，编译产物从 `compiled/<mode>/<slug>` 简化为 `compiled/<slug>`。安全提示从「生产资产挂到全局」改为「生产服务器默认只读，切到标准运维需确认」。
3. 每台服务器一个「分发给 Agent」开关，分发到全部已启用的 Agent 目标；某个运行环境没有这台服务器的连接配置时记为「已跳过」并说明原因，取代 v2 的「别名不可达」状态。
4. 服务器信息可以在界面里录入（地址、端口、用户、认证），测试连接通过后才能分发（F-106）。录入的连接写进托管 ssh 配置（F-107）。认证支持私钥、ssh-agent 和密码，密码存系统凭据库，并提供「改用密钥登录」（F-108）。
5. 导航从五项减到三项：服务器 / Agent / 设置。服务器页参考 Termius，卡片列表加右侧详情分段，Agent 分段排第一；预览、Token 和 Lint 移到按需打开的 Sheet；删除看板、矩阵、拖拽分发；活动并入设置。
6. 术语：界面上「资产」改为「服务器」，「挂载」改为「分发」。数据模型中 Asset 名称保留，Mount 改为 Delivery。
7. 全部服务器编译成一个总 Skill（2026-10-31）：`SKILL.md` 是总览，每台服务器的详情放进参考文件，另有服务器之间的关系、运维约定和巡检清单。去掉 `slug` 和「修改 Skill 名」。v2 取消「全局汇总清单」的理由在 v3 已不成立（见 F-201）。
8. 护栏与操作记录（2026-10-31）：Claude Code 的 `PreToolUse` hook 按档位拦截 ssh 命令并记录下来，可以临时解锁 30 分钟。原计划放在 v1.0 的 hook 拦截提前到 v0.1。
9. Agent 笔记（2026-10-31）：Agent 把学到的东西写进收件箱，用户确认后并入服务器信息。
10. 分发一律用受管复制；v0.1 只支持 Claude Code 和读取 `~/.agents/skills` 的 Agent（2026-10-31）。
11. 去掉三层 Token 估算、业务包（F-206）和自定义模板（F-208）；探测结果改为自动合并、可以撤销（2026-10-31）。

> 第 2、3 条中的 `compiled/<slug>` 目录和「已跳过」状态已被第 7、10 条取代：产物目录改为 `compiled/<运行环境>/cloudlink-servers`，服务器在某个运行环境中「未列入」。
