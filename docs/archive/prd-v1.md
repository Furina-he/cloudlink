# 产品需求文档 (PRD)：CloudSkill Hub —— 面向 CLI Agent 的云资产上下文与 Skill 分发器

| 文档属性 | 内容说明 |
| :--- | :--- |
| **产品名称（暂定）** | **CloudSkill Hub**（或 **InfraSkill Studio**） |
| **产品形态** | 跨平台桌面客户端（支持 Windows / WSL2、macOS、Linux） |
| **核心定位** | 以可视化 UI 维护 VPS 及云端基础设施信息，自动编译为标准 Agent Skill 并按需挂载给不同 CLI Agent 与代码工作区 |
| **目标兼容生态** | Claude Code (`~/.claude/skills`)、Codex CLI (`~/.codex/skills`)、Cursor 等支持本地规则/Skill 目录的 Agent 工具 |
| **当前规划版本** | v1.0（含 MVP v0.1 核心闭环规范） |

---

## 一、 产品背景与核心痛点

### 1.1 痛点分析
开发者在使用 Claude Code、Codex CLI 等终端 Agent 进行日常开发、远程部署与服务器排查时，普遍面临以下四个痛点：

1. **云端上下文断层**：Agent 具备极强的 Bash/SSH 执行能力，但不知道开发者手头有哪些 VPS、机器别名叫什么、核心服务跑在哪个目录、哪些端口被占用、面板与反向代理如何配置，每次对话都需要人工重复交代背景。
2. **手工维护文档成本高**：服务器新开容器、修改端口或绑定新域名后，手动去各个 Markdown 文件里修改配置极易遗漏，导致 Agent 拿到过期信息而执行错误命令。
3. **全局上下文污染与串台风险**：若将所有 VPS 信息全部塞入全局 `CLAUDE.md`，不仅每次对话白白消耗大量 Token，而且在开发 A 项目时，Agent 存在误连接 B 项目生产服务器的风险。
4. **敏感凭据泄露隐患**：直接在提示词或普通文档中记录服务器 IP、端口、密码或 API Token，会导致敏感凭据直接上传至大模型云端上下文。

### 1.2 产品解决方案
**CloudSkill Hub** 不重复造轮子去做底层 SSH 终端或重型云管平台，而是聚焦于**「云端上下文管理 + Skill 编译与分发」**：

* **结构化录入与自动探测**：在直观的 UI 中以卡片形式管理 VPS 及云资产元数据，支持复用本地 `~/.ssh/config` 并一键 SSH 探测自动抓取服务器环境信息。
* **渐进式 Skill 动态编译**：将结构化云资产数据自动渲染为符合 Agent 规范的 `SKILL.md`（轻量摘要入口）与 `references/`（详细环境表），兼顾低 Token 消耗与信息完备度。
* **可视化按需分配（挂载）**：在 UI 上通过拨动开关，利用操作系统软链接（Symlink / Junction）将指定云资产 Skill 秒级挂载到特定 Agent 的**全局目录**或**指定本地代码仓库**，实现项目级上下文隔离与一处修改全局热更新。

---

## 二、 核心产品原则与安全边界

1. **凭据与上下文物理隔离原则**：
   软件生成的任何 Skill 文件中**严禁出现明文密码、SSH 私钥内容或云厂商 API Secret**。Skill 仅记录 `~/.ssh/config` 中的 `Host Alias`（主机别名）与非敏感业务拓扑信息，底层认证完全交由系统原生 OpenSSH Agent 完成。
2. **渐进式披露原则（Progressive Disclosure）**：
   编译出的 `SKILL.md` 主文件行数严格控制在 **60 行以内**（仅含机器别名、一句话用途、核心红线与子文档索引），详细容器列表、端口映射、目录结构统一拆分至 `references/` 子目录，确保 Agent 仅在需要时按需读取。
3. **单一数据源（Single Source of Truth）**：
   所有云资产信息仅在软件本地数据库（SQLite / JSON）中维护一份，外部 Agent 目录与项目目录均通过符号链接引用编译产物，杜绝多处复制导致的版本不一致。

---

## 三、 功能需求矩阵 (Functional Requirements)

### 3.1 模块一：云资产信息库 (Cloud Asset Inventory)

| 功能编号 | 功能名称 | 优先级 | 详细需求描述 |
| :--- | :--- | :--- | :--- |
| **F-101** | **VPS 资产卡片管理** | **P0 (MVP)** | 支持增删改查 VPS 信息卡片，包含基础标识（名称、环境标签如 `Prod`/`Dev`、云厂商标签）、连接锚点（SSH Host 别名、端口、默认用户）、系统硬件规格、关键路径映射（如 Nginx 配置目录、面板目录、项目部署目录）、已运行服务/容器列表及自然语言操作红线。 |
| **F-102** | **`~/.ssh/config` 自动导入** | **P0 (MVP)** | 自动扫描本机 `~/.ssh/config`（以及 Windows 与 WSL2 子系统内的 `.ssh/config`），提取所有已配置的 `Host` 别名、IP 与端口，支持用户在 UI 上一键勾选导入生成初始 VPS 卡片。 |
| **F-103** | **SSH 一键环境探测 (Auto-Probe)** | **P0 (MVP)** | 在 VPS 卡片详情页提供「一键探测环境」按钮。点击后后台通过系统 `ssh {alias}` 执行预设的无害只读脚本，自动抓取并回填：OS 发行版与内核版本、CPU/内存/磁盘余量、运行中的 Docker 容器名称与端口映射、当前监听的公网端口及常见组件（Nginx / 1Panel / Docker / PM2）安装状态。 |
| **F-104** | **多维云资产扩展卡片** | **P1** | 支持创建非主机类云资产卡片：<br>1. **域名与 DNS 卡片**（记录主域名、托管商如 Cloudflare、子域名解析指向哪台 VPS、是否开启 CDN 代理）；<br>2. **运维面板卡片**（如 1Panel / 宝塔的挂载路径、核心应用目录结构、面板 CLI 命令规范）；<br>3. **对象存储与数据库拓扑卡片**（Bucket 名称、挂载用途、备份目录映射）。 |

### 3.2 模块二：业务组合与 Skill 编译器 (Skill Composer & Compiler)

| 功能编号 | 功能名称 | 优先级 | 详细需求描述 |
| :--- | :--- | :--- | :--- |
| **F-201** | **单机/组合包定义 (Skill Bundle)** | **P0 (MVP)** | 支持两种编译粒度：<br>1. **单资产模式**：直接将 1 台 VPS（或将所有 VPS 汇总为一份全局清单）编译为一个独立 Skill；<br>2. **业务环境包模式（P1）**：支持将「1 台 VPS + 关联域名 DNS + 关联容器列表」组合打包为一个以业务命名的 Skill（例如 `openpet-prod-cloud`）。 |
| **F-202** | **暴露权限档位裁剪 (Guardrail Presets)** | **P0 (MVP)** | 在编译或分配 Skill 时支持选择提示词约束档位：<br>• **Read-Only（只读巡检档）**：在生成的 `SKILL.md` 中强约束 Agent 仅允许执行 `logs`、`ps`、`df`、`cat` 等查询命令，严禁重启或修改文件；<br>• **Standard（标准运维档）**：允许常规部署与服务重启，但对高危操作（删库、改防火墙、停核心容器）要求先向用户确认；<br>• **Custom（自定义红线）**：注入用户在卡片中填写的专属禁忌条目。 |
| **F-203** | **渐进式 Markdown 渲染引擎** | **P0 (MVP)** | 每当资产卡片发生保存或探测更新时，后台毫秒级将其重新渲染至软件统一缓存目录 `~/.cloud-skill-hub/compiled/{skill-slug}/`，包含标准 YAML Frontmatter 的 `SKILL.md` 与拆分后的 `references/*.md`。 |
| **F-204** | **实时预览与 Token 估算器** | **P1** | 在 UI 右侧提供实时 Markdown 渲染预览窗，并计算展示：**「常驻上下文开销（Frontmatter Token 数）」**与**「按需加载开销（全文 Token 数）」**，直观帮助用户把控提示词体积。 |

### 3.3 模块三：Agent 与工作区挂载中心 (Assignment & Mounting Matrix)

| 功能编号 | 功能名称 | 优先级 | 详细需求描述 |
| :--- | :--- | :--- | :--- |
| **F-301** | **本机 CLI Agent 自动探测** | **P0 (MVP)** | 启动时自动检测本机（含宿主机与 WSL2 环境）已安装的 Agent 配置目录，包括但不限于：<br>• Claude Code: `~/.claude/skills/`<br>• Codex CLI: `~/.codex/skills/`<br>• Cursor / 自定义全局目录 |
| **F-302** | **本地代码项目工作区纳管** | **P0 (MVP)** | 支持用户在 UI 中添加本地正在开发的代码仓库路径（如 `/home/user/projects/my-app`），作为可被分配云资产的「项目级槽位」。 |
| **F-303** | **二维可视化挂载矩阵 (Toggle Matrix)** | **P0 (MVP)** | 提供「云资产 Skill ➔ 目标槽位（全局 Agent 或具体代码项目）」的开关矩阵视图。点击开关即可将该云资产 Skill 挂载或卸载到目标目录（如 `{project_repo}/.claude/skills/{skill-slug}`）。 |
| **F-304** | **跨平台软链接与同步引擎** | **P0 (MVP)** | • 在 Linux / macOS / WSL 内部使用原生目录符号链接（`symlink`）；<br>• 在 Windows 原生环境下优先使用 Directory Junction（无需管理员权限）；<br>• 支持检测失效软链接（如项目文件夹被移动）并在 UI 上给出状态告警与一键修复。 |

---

## 四、 核心数据模型与编译产物规范

### 4.1 VPS 资产卡片数据结构 (JSON Schema 示例)

```json
{
  "id": "vps_hk_01",
  "name": "香港轻量反代与边缘节点",
  "slug": "vps-hk-edge",
  "tags": ["Production", "HongKong", "1Panel"],
  "connection": {
    "sshHostAlias": "hk-edge",
    "port": 22,
    "user": "root",
    "authMethod": "ssh-config-reference"
  },
  "specs": {
    "os": "Ubuntu 24.04 LTS",
    "cpu": "2 vCPU",
    "memory": "2 GB",
    "diskUsage": "18G / 40G (45%)",
    "lastProbedAt": "2026-10-27T10:30:00Z"
  },
  "environment": {
    "panel": "1Panel (安装目录: /opt/1panel)",
    "keyPaths": {
      "nginxConf": "/opt/1panel/apps/openresty/openresty/conf/conf.d",
      "composeRoot": "/opt/1panel/docker/compose",
      "appData": "/data/apps"
    },
    "containers": [
      { "name": "openresty", "image": "openresty:1.21", "ports": "80:80, 443:443", "role": "主网关与 SSL 终结" },
      { "name": "api-gateway", "image": "my-api:v1.2", "ports": "127.0.0.1:8080->8080", "role": "后端核心接口" }
    ],
    "domains": ["api.example.com", "blog.example.com"]
  },
  "guardrails": {
    "accessMode": "standard",
    "rules": [
      "机器内存仅 2GB，严禁在宿主机直接执行 npm run build 或 cargo build 等高内存编译任务",
      "修改 OpenResty 配置后必须先执行 nginx -t 校验通过才允许 reload",
      "禁止停止或重启 openresty 容器"
    ]
  }
}
```

### 4.2 自动编译生成的 Skill 目录与文件内容示例

**文件 1：`{skill-dir}/SKILL.md`（精简入口，保障极低 Token 消耗）**

```markdown
---
name: vps-hk-edge
description: 香港轻量反代与边缘节点 (SSH Alias: hk-edge, Ubuntu 24.04) 的环境拓扑、容器映射与运维规范。当用户要求查看香港节点状态、排查 api.example.com / blog.example.com 线上日志、管理 1Panel 容器或部署后端服务时按需加载。
---

# VPS 资产概览：香港轻量反代与边缘节点 (`hk-edge`)

## 1. 快速连接与基础定位
- **SSH 连接方式**：直接使用系统别名 `ssh hk-edge "{command}"`（已配置免密，无需询问密码或 IP）。
- **核心业务职责**：承担 `api.example.com` 与 `blog.example.com` 的公网反代及后端 API 容器托管。
- **硬件与系统**：Ubuntu 24.04 LTS | 2 vCPU / 2 GB RAM | 1Panel 面板托管。

## 2. 强制操作红线 (Guardrails)
1. **禁止高负载构建**：机器内存仅 2GB，**严禁**在该机器上直接运行代码编译或构建镜像。
2. **反代安全校验**：修改 Nginx/OpenResty 配置后，必须先执行测试校验，严禁直接重启 `openresty` 容器。

## 3. 详细环境信息按需索引 (Progressive References)
- 如需查看具体的 **关键目录路径、运行中 Docker 容器列表及端口映射**，请先读取本目录下的 `references/runtime-topology.md`。
```

**文件 2：`{skill-dir}/references/runtime-topology.md`（按需读取的详细环境表）**

```markdown
# `hk-edge` 详细运行环境与目录拓扑

## 关键目录路径
| 用途说明 | 宿主机绝对路径 |
| :--- | :--- |
| 1Panel 面板根目录 | `/opt/1panel` |
| OpenResty 站点配置目录 | `/opt/1panel/apps/openresty/openresty/conf/conf.d` |
| Docker Compose 编排目录 | `/opt/1panel/docker/compose` |
| 业务持久化数据目录 | `/data/apps` |

## 核心运行容器与端口映射
| 容器名称 | 镜像版本 | 端口映射 | 业务角色 |
| :--- | :--- | :--- | :--- |
| `openresty` | `openresty:1.21` | `80:80, 443:443` | 主网关与 SSL 终结 |
| `api-gateway` | `my-api:v1.2` | `127.0.0.1:8080->8080` | 后端核心接口 |
```

---

## 五、 UI 界面布局与核心交互流程

桌面端采用经典的 **左侧一级导航栏 + 中间主工作区 + 右侧详情/预览抽屉** 布局，包含以下三大核心视图：

### 1. 「云资产库 (Assets)」视图
* **顶部工具栏**：搜索框、标签筛选器（`全部` / `生产` / `测试` / `VPS` / `域名`）、`「+ 从 ~/.ssh/config 导入」` 按钮、`「+ 新建资产卡片」` 按钮。
* **主列表区**：以卡片网格展示每台 VPS。每张卡片直观显示：机器名称、SSH 别名徽章、OS 图标与硬件规格、已挂载给几个 Agent 的角标状态，以及右上角的 **「⚡ 一键刷新探测」** 快捷按钮。
* **右侧抽屉**：点击任意卡片滑出编辑抽屉，采用结构化表单（基础连接、核心路径键值表、容器表格、红线规则列表）维护信息，免去手写 Markdown 的麻烦。

### 2. 「挂载与分配中心 (Dispatcher)」视图（核心交互页）
* **双栏矩阵/看板设计**：
  * **左栏（待分配的云端 Skill 源）**：展示单机 Skill 及打包好的业务环境包，每项旁边带有权限模式下拉框（`只读巡检` / `标准运维`）。
  * **右栏（Agent 与项目挂载槽位）**：
    * **第一组：全局 Agent 槽位**（如 `Claude Code (Global)`、`Codex CLI (Global)`）。
    * **第二组：本地项目工作区槽位**（用户添加的本地代码仓库，如 `OpenPet-Desktop`、`Blog-Astro`）。
* **一键开关挂载**：每个项目槽位下可直接勾选或拨动开关绑定指定的 VPS Skill。开关亮起即刻在对应项目的 `.claude/skills/` 下生成软链接，并在 UI 上显示绿色的 `Mounted (已挂载)` 状态标签。

### 3. 「Skill 预览与模板室 (Preview & Templates)」视图
* 提供左右分栏的只读/微调视图：左侧展示编译后的文件树（`SKILL.md` 与 `references/`），右侧展示高亮后的 Markdown 源码与预估 Token 徽章，支持一键复制路径或打开所在文件夹。

---

## 六、 推荐技术栈与版本演进路线图

### 6.1 推荐技术架构
* **桌面容器**：**Electron** 或 **Tauri v2**（需要执行本机 `ssh` 子进程命令、读写 `~/.ssh/config` 以及创建跨目录软链接 `fs.symlink`，桌面端原生 Node/Rust 进程权限最合适）。
* **前端框架**：**Vue 3 + TypeScript + Tailwind CSS + shadcn-vue (或 Naive UI)**。
* **本地持久化**：**SQLite (`better-sqlite3`)** 或本地结构化 JSON 存储（配合文件锁），无需额外部署后端服务。
* **模板渲染引擎**：使用 **Handlebars** 或 **EJS** 将资产 JSON 渲染为标准 Markdown 文件集。

### 6.2 迭代路线图 (Roadmap)

| 阶段版本 | 里程碑目标 | 核心交付特性 |
| :--- | :--- | :--- |
| **v0.1 (MVP)** | **跑通「VPS 录入 ➔ 编译 ➔ Claude Code 挂载」核心闭环** | 1. 解析本机 `~/.ssh/config` 导入 VPS 列表；<br>2. VPS 卡片增删改查 + 一键 SSH 自动探测系统/Docker 容器信息；<br>3. 自动编译生成 `SKILL.md` + `references/`；<br>4. 支持通过软链接一键挂载至 Claude Code 全局目录或指定本地代码仓库。 |
| **v0.5 (进阶版)** | **引入「多云资产卡片」与「业务组合包 (Bundle)」** | 1. 新增域名/DNS（如 Cloudflare 解析记录同步）、1Panel 面板结构卡片；<br>2. 支持将「VPS + 域名 + 面板」组装为统一业务环境 Skill；<br>3. 增加只读/标准等 Guardrail 权限档位一键切换与 Token 估算器。 |
| **v1.0 (完整版)** | **跨环境同步与生态扩展** | 1. 完美打通 Windows 宿主机与 WSL2 子系统之间的跨系统路径挂载；<br>2. 支持将资产卡片导出为加密备份包（便于多台开发机同步）；<br>3. 开放自定义 Markdown 编译模板市场。 |