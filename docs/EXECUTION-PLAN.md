# CloudLink v0.1 执行计划（Windows 优先）

> **用途：** 在新对话中分阶段实施 CloudLink MVP v0.1。这份计划的读者是执行它的 Coding Agent，以及做验收的你。
>
> **依据：** `docs/PRD.md`（v3）、`DESIGN.md`、`PRODUCT.md`。
>
> **2026-10-30 方向调整：** P0 到 P3 已按 v2.1 完成并提交。PRD v3 取消了项目级挂载，界面改为「服务器 / Agent / 设置」，并加入界面录入和测试连接（见 PRD 附录 C）。新增 P3.5 把前端改到 v3；P4、P5 已按 v3 改写。P2、P3 的原始描述保留作为历史记录。
>
> **2026-10-31 收敛：** 全部服务器编译成一个总 Skill；Claude Code 护栏与操作记录、Agent 笔记提前到 v0.1；分发一律用受管复制；v0.1 只支持 Claude Code 和 `~/.agents/skills`；去掉 Token 估算（见 PRD 附录 C）。
>
> **2026-11-02 配电盘减负与云平台 CLI 改版（PRD v3.1）：**
> 1. 首屏改为单栏全宽「服务器 (SSH) + 云平台 (CLI)」双闸刀回路行（行内直接切换档位与授权 Agent），未选中时隐藏右侧面板；
> 2. 详情面板砍掉 8 层折叠手风琴，改为常驻控制头 + 3 个平铺 Tab（`画像与规则`、`连接配置`、`动态`），移除侧栏底部环境列表；
> 3. **取消「临时解锁 30 分钟」**（生产环境处于「标准运维」时在回路行琥珀色高亮提醒）；
> 4. 新建 SSH 服务器支持密码自动转免密密钥并启用一步到位；
> 5. 接入 Cloudflare（`wrangler`）、Vercel（`vercel`）、Oracle Cloud（`oci`）三类云平台 CLI 资源（按已启用 Agent 的环境精准检测、范围圈定 Scope、服务器关联、护栏扩展），所有云平台与 Agent 一律使用官方品牌 Logo（`ProviderMark`、`AgentMark`）。
> 新增 **P3.6** 完成前端 v3.1 改版，P4–P5 同步跟进。
>
> **2026-11-05 并入 P6：** 应用图标定为「交汇 · 浅色」（`docs/brand/cloudlink-icon.svg`）。新增 F-406 检测更新：默认开启，可在设置中关闭；只有发现新版本时才在顶栏提醒。它连同安装包签名和 GitHub Releases 发布流程一起在 P6 实施（PRD 11.1）。
>
> **2026-11-08 v0.2 重设计（PRD v4）：** 对标 CC Switch 与 magpie 重做体验与界面（「安静钢面」），可点击原型在 `docs/prototype/redesign/`。新增 **P7**（v0.2：界面重构、生产环境开关、自动同步与备份、托盘、导航位置切换、GitHub 接入、导入排除代码托管主机）和 **P8**（v0.3：执行通道与命令审批）。
>
> **2026-11-10 界面审查（四轮）：** 开发完成后按「先改原型 → 确认 → 同步文档 → 再改应用」做了四轮界面审查。四轮应用改动均已完成并提交；第 4 轮的决定已进原型、PRD（6.3 至 6.8、6.13、6.15、F-106、F-107、F-307、F-402）和 DESIGN.md，应用改动列在 **P7d**，于 2026-11-11 实施。
>
> **冲突时的优先级：** PRD 第七章的硬约束 > DESIGN.md 的令牌 > PRD 其余章节 > 本计划的实施建议。
>
> **开场方式：** 新对话直接粘贴第 7 节的开场提示词即可。

---

## 0. 总览

**目标：** 在 Windows（原生 + WSL2）上跑通「录入服务器 → 测试连接 → 探测 → 编译总 Skill → 分发给 Agent → Agent 能发现并使用，并在护栏内干活」的闭环。

**范围：** PRD 第十章 v0.1 这一行，包括：

- F-101 到 F-108（含 F-104 云平台 CLI 接入与 Scope）；
- F-201 到 F-205；
- F-207 的默认英文输出；
- F-301 到 F-308；
- F-401、F-402、F-403、F-405、F-406（检测更新，2026-11-05 新增）。

**策略：** 先做前端（基于 Mock IPC），再做 Rust 核心，最后联调。各阶段按本计划的验收标准检查；阶段推进与提交遵循当前会话中的用户授权，未完成的验收项如实汇报。

| 阶段 | 目标 | 主要产出 | 规模 | 依赖 |
| :--- | :--- | :--- | :--- | :--- |
| P0 | 工具链与脚手架 | 能构建、能启动的空壳应用；令牌、ESLint 规则就位 | S | 无 |
| P1 | 契约、Mock 与应用外壳 | 前端类型契约、IPC 封装、Mock 夹具、Zustand store、侧栏与命令面板 | M | P0 |
| P2 | 资产视图（已完成，v2.1） | 列表、编辑器、预览、探测面板、导入、首次启动引导 | L | P1 |
| P3 | 挂载、Skills、活动、设置（已完成，v2.1） | 看板、矩阵、Agent 视角、目标管理和其余视图 | L | P1 |
| P3.5 | 前端改到 v3.0（已完成） | 契约与 Mock 改版；服务器卡片加详情手风琴；Agent 视图；设置并入活动；删除项目级代码与 Token 估算 | L | P3 |
| P3.6 | 前端改到 v3.1（配电盘减负 + 云 CLI） | 单列全宽双闸刀回路行（SSH + 云 CLI）；按需平推右侧面板（控制头 + 3 个平铺 Tab）；彻底移除 30 分钟临时解锁；SSH 一步到位自动转密钥；Cloudflare / Vercel / Oracle Cloud 环境向导与 Scope 圈定；`ProviderMark` 官方品牌 Logo | L | P3.5 |
| P4 | Rust 核心 | db、env、ssh、cli、secret、compile、probe、deliver、guard、operations、notes、ipc 模块，护栏程序 `cloudlink-guard`（覆盖 `ssh` + `wrangler/vercel/oci`），以及测试 | L（拆成 P4a、P4b、P4c 三次会话） | P3.6 的契约 |
| P5 | 联调与端到端验收 | 前端接入真实 IPC、WSL 测试靶机与云 CLI 检测验收、手工验收清单 | M | P3.6、P4 |
| P6 | 打磨、更新与打包 | 无障碍、性能、文案修订；应用图标落地；检测更新（F-406）；签名的 Windows 安装包与 GitHub Releases 发布流程 | M | P5 |
| P7 | v0.2 体验与界面重设计（PRD v4） | 按 PRD 第六章与 DESIGN.md 重做外壳、资源、详情、Agent、动态、设置、空状态；F-109、F-110（接入部分）、F-102 排除代码托管主机、F-309、F-407、F-408 | L（拆成 P7a、P7b、P7c） | P6 |
| P7d | 界面审查第四轮落地（2026-11-10） | 添加表单与连接过程、设置页、活动日志、护栏规则页、详情折叠、文案；只改前端（契约不变） | M | P7c |
| P8 | v0.2.x 修复与 v0.3 执行通道 | P8a／b：分发、命名、原生标题栏与详情编辑；P8c–f：F-310、F-110 自动跟随／关系／护栏、审批与诊断 | L（P8a–P8f） | P7 |

**会话建议：**

- 每个阶段开一个会话，P4 拆成三个会话。
- 每个阶段结束时，运行验收门槛并在会话中汇报，按已获授权提交；尚未获得提交授权时再确认。
- P4 只依赖 P1 定下的类型契约，所以可以和 P2、P3 并行。做法是另开一个对话，并约定那个对话只改 `cloudlink/src-tauri/`。

---

## 1. 开发环境（2026-10-28 已在本机核查）

| 项目 | 要求 | 本机现状 |
| :--- | :--- | :--- |
| 系统 | Windows 11，或 Windows 10 21H2 以上 | ✅ Windows 11 23H2（10.0.22631） |
| WebView2 运行时 | Tauri 运行必需 | ✅ 148.0 |
| Node.js 和 pnpm | Node ≥ 22.20，pnpm 10 | ✅ Node 22.20.0、pnpm 10.12.3 |
| Rust | 通过 rustup 安装的 stable 版，MSVC 工具链 | ✅ 1.95.0，默认工具链 `x86_64-pc-windows-msvc` |
| C++ 构建工具 | Visual Studio 2022 Build Tools（含 VC 工具集）和 Windows SDK | ✅ Build Tools 17.14，Windows SDK 10.0.26100 |
| WSL2 | Ubuntu 24.04 | ✅ Ubuntu-24.04（WSL 2，用户 `furina`） |
| OpenSSH | Windows 和 WSL 都要有 ssh 客户端 | ✅ Windows OpenSSH 9.5p1；WSL OpenSSH 9.6p1。另有 Git for Windows 自带的 ssh 9.9p2，注意事项见 PRD 8.3 |
| Docker（WSL 内） | P5 测试靶机要用 | ✅ 29.4.2，守护进程在运行 |
| Git 和 GitHub | Git 2.4x 以上；`gh` 已登录 | ✅ Git 2.49；`gh` 已登录 Furina-he；身份为 NeverGiveUp |
| Agent | Claude Code 必装，Codex 可选 | ✅ Windows 上有 Claude Code 2.1.310 和 Codex 0.160.0；WSL 里也装了 Claude Code |
| Playwright 浏览器 | P1 开始要用 | ✅ 已安装 Chromium |

**还需要补的（到 P5 再处理，需要你输入 sudo 密码）：**

- WSL 中没有 `sshd`。P5 搭测试靶机时，要执行 `sudo apt install openssh-server`。
- WSL 中还没有 `~/.ssh/config`。P5 会新建，并写入测试主机 `test-vps`。

**需要知道的现状：**

- Windows 的 `ssh-agent` 服务是停止状态。目前 Windows 的 ssh config 里配了 1 个 Host，它能否在 BatchMode 下连上，取决于 `IdentityFile` 指向的密钥有没有口令。P5 会单独验证。
- 本机已有用户自己的 Skill：Windows 的 `~/.claude/skills` 下有 17 项，WSL 的 `~/.agents/skills` 下有 1 项（repo-to-resume-tailor）。**任何阶段都不能碰它们。** 测试一律在临时目录进行，P5 只用 `CLOUDLINK_HOME` 等覆盖指向临时的 Agent 目录；要在真实 Agent 里验证时，只分发 `test-vps` 这一个 Skill，验收后移除。

**仓库：** 根目录已经是 Git 仓库，关联远端 https://github.com/Furina-he/cloudlink （**公开仓库**），默认分支为 `main`。根目录的 `.gitignore` 和 `.gitattributes` 已经提交。`.gitattributes` 让文本文件统一使用 LF 换行，这一点很重要：探测脚本要在 Linux 上执行，带 CRLF 就会出错。提交和推送分别遵循当前会话中的用户授权。

**推送说明（2026-10-28 实测）：** 本机环境变量 `GH_TOKEN` 里是一个细粒度 token，它没有 cloudlink 仓库的写权限，直接 `git push` 会返回 403。有两种处理方式，任选其一：

1. 在 GitHub 的 token 设置里，把 cloudlink 加入这个 token 的仓库范围，并授予 Contents 读写权限。
2. 推送时临时不用这个 token，改用 gh 钥匙串里那份带 `repo` 权限的登录凭据：

   ```bash
   env -u GH_TOKEN git -c credential.helper= -c 'credential.helper=!gh auth git-credential' push
   ```

---

## 2. 目标仓库结构

```text
CloudSkill Hub/                 仓库根目录（文件夹名可以以后再改）
  README.md  PRODUCT.md  DESIGN.md  .gitignore  .gitattributes
  docs/
    PRD.md  EXECUTION-PLAN.md  PRD-review.md
    archive/prd-v1.md           原始 PRD（只读）
  cloudlink/                    应用本体：Vite + React + Tauri
    package.json  components.json  eslint.config.js  vite.config.ts  .env.mock
    src/                        前端，目录结构见 PRD 7.9
    src-tauri/                  Rust 后端，模块划分见 PRD 8.1
      tests/golden/             编译产物的黄金样例
      crates/guard-rules/       护栏的判定规则，主程序和护栏程序共用（Cargo workspace 成员）
      crates/cloudlink-guard/   护栏程序，作为 sidecar 打包
      tests/guard-corpus/       护栏的命令样本集
    e2e/                        Playwright 用例（跑在 Mock 模式下）
```

---

## 3. 全局规则（每个阶段都适用）

1. **PRD 第七章是硬约束。**
   - 依赖只能来自 7.1 的白名单，并按 7.2 锁定主版本。
   - 7.3 映射表里已经有实现的需求，必须用表里指定的实现。
   - 表里没有的需求，先在对话里列出候选方案（优先选成熟库），等确认后再动手。禁止擅自引入依赖或自写组件。
2. **令牌只按 PRD 7.6 修改，不得新增颜色值。** 用 PRD 7.10 第 6 条的 grep 命令检查。
3. **API 写法：**
   - Base UI 的组件组合用 `render` 属性，不用 `asChild`。
   - react-resizable-panels v4 的尺寸写成字符串，例如 `"24%"` 或 `"220px"`。
   - `useFieldArray` 要设置 `keyName: "key"`。
4. **类型契约：**
   - P1 先按 PRD 3.4 和 7.8 手写 `src/bindings/*.ts`。
   - P4 的 Rust 结构体用 ts-rs 导出到同一个目录。导出结果必须和手写契约一致；如果有差异，要么改 Rust，要么在对话里说明理由后再改契约。
5. **文案：** 界面文案全部放在 `src/lib/copy.ts`。后端只返回 id 和参数，不返回中文句子。
6. **安全：**
   - 任何删除文件、覆盖目录的代码路径，都要先通过所有权检查（PRD 原则 6）。
   - 测试一律在临时目录里进行。所有路径都要能用 `CLOUDLINK_HOME` 等环境变量覆盖。
   - 测试绝不碰真实的 `~/.claude` 和 `~/.agents`。
7. **阶段汇报：** 每个阶段结束时，在会话中汇报以下内容；README、PRD 和执行计划等长期文档只保留产品说明、接口约定、开发规范及验收标准，不追加验收记录或单独的阶段验收文档：
   - 已完成的任务；
   - 每条验收门槛对应的命令和结论；
   - 截图路径；
   - 遗留问题。
8. **推荐使用的技能：**
   - `shadcn/ui` skill 和 MCP（P0 安装），用来查组件写法。
   - `webapp-testing` 或 Playwright，用来截图自检。
   - `systematic-debugging`，用来排查疑难问题。
   - `impeccable` 的 `audit` 和 `polish`（P6 使用）。

---

## 4. 阶段详情

### P0 工具链与脚手架（S）

**目标：** 得到一个能构建、能启动、令牌和规则都已就位的空壳应用。

**任务：**

1. 确认工作区干净（`git status`）。Git 仓库和远端已经配好，见第 1 节。
2. 按 PRD 7.2 的第 1 到第 7 步依次执行：
   - shadcn 的 init 和 add；
   - 安装锁定主版本的依赖；
   - `tauri init`，并修改 `tauri.conf.json`（identifier、`minWidth`、`minHeight`、`zoomHotkeysEnabled`）；
   - 新建 `.env.mock` 并加 `dev:mock` 脚本；
   - 放入 `typeset.css`；
   - 安装 shadcn 的 skill 和 MCP。
3. 处理 PRD 7.2 列出的「已知的坑」：
   - 删除 `scroll-area.tsx` 中没用到的 React 导入；
   - 删除 `theme-provider.tsx` 中按 d 键切换主题的监听。
4. 按 PRD 7.6 修改三个文件：`src/index.css`、`badge.tsx`（新增 success 和 warning 变体）、`progress.tsx`（新增 `tone` 属性）。
5. 按 PRD 7.4 把禁用依赖清单写入 `eslint.config.js`。在 `package.json` 中补齐脚本：`typecheck`、`lint`、`test`（vitest）、`e2e`（Playwright）、`dev:mock`、`tauri`。
6. 搭好入口文件：
   - `main.tsx` 依次包裹 `ThemeProvider`、`MotionConfig`（参数见 7.7）、`TooltipProvider`、`Toaster`。
   - `App.tsx` 只放一个占位页面，用 Button、Badge（success）、Progress（tone="warning"）三个组件验证令牌是否生效。

**验收门槛：**

- `pnpm typecheck`、`pnpm lint`、`pnpm build` 全部通过。
- `pnpm tauri dev` 能打开窗口；窗口不能缩小到 960×600 以下；浅色和深色跟随系统切换。
- `package.json` 的 dependencies 逐项对照 PRD 7.1，没有白名单以外的包。

### P1 契约、Mock 与应用外壳（M）

**目标：** 在普通浏览器里，用 `pnpm dev:mock` 跑起一个带假数据的完整外壳。

**任务：**

1. **类型契约 `src/bindings/`：** 按 PRD 3.3、3.4 和 7.8 手写以下类型：Asset、Environment、Target（含 `linkMode`）、Mount、SkillStatus、CompilePreview、各探测事件的载荷、Settings、ActivityItem、LintId、ProbeErrorId。
2. **`src/lib/` 下的五个文件：**
   - `ipc.ts`：7.8 列出的全部命令。
   - `events.ts`：订阅 5 个后端事件，分发到对应的 store。
   - `copy.ts`：全部界面文案，以及 Lint 和探测错误 id 到中文文案的映射。
   - `format.ts`：基于 `Intl` 的时间和数字格式化。
   - `schemas.ts`：zod 校验，包括 slug 规则和保留名。
3. **`src/mocks/`：**
   - `fixtures.ts`：PRD 7.8 列出的全部夹具。
   - `install.ts`：调用 `mockIPC(handler, { shouldMockEvents: true })`，并模拟以下行为：
     - 3 秒的探测进度事件；
     - hk-edge 探测出 4 处差异；
     - sg-db 探测失败，原因是主机密钥未信任；
     - 挂载、卸载、修复；
     - 「全局和项目档位不同」时阻止挂载。
   - `main.tsx` 中，`import.meta.env.VITE_MOCK === "1"` 时先执行 install，再渲染应用。
4. **`src/stores/`：**
   - 实现 PRD 7.5 中的全部 store 和 selector。
   - `selectVisibleSkills` 用 vitest 写单元测试，至少覆盖三种情况：WSL 项目加 Windows 全局目录；Codex 和 Claude Code 读取不同的约定目录；失效的挂载单独计数。
5. **应用外壳：**
   - AppSidebar：5 个导航项、计数徽章、底部的运行环境状态。
   - 工具栏：SidebarTrigger、Breadcrumb、当前视图的操作区、命令面板按钮。
   - 视图切换：由 `useUIStore.view` 控制，切换时保留各视图的选中项、筛选和滚动位置。
   - CommandMenu：6.12 节的四组命令。
   - 快捷键：用 react-hotkeys-hook 实现 6.12 节的全部快捷键。
   - 侧栏之前放「跳到主内容」链接；切换视图后，焦点移到新视图的标题。
6. 五个视图先放占位内容：标题加一个 Empty 组件。

**验收门槛：**

- `pnpm test` 通过，包括 `selectVisibleSkills` 的三个用例。
- `pnpm dev:mock` 能在浏览器里显示完整外壳；`Ctrl+K`、`Ctrl+B`、`Ctrl+1` 到 `Ctrl+5` 都生效；控制台没有报错。
- `pnpm typecheck`、`pnpm lint`、`pnpm build` 通过。

### P2 资产视图（L）

**目标：** 在 Mock 数据下实现 PRD 6.4、6.5、6.10（导入和首次启动）的全部内容。

**任务：**

1. **布局：** 三栏 Resizable。
   - 各栏尺寸按 6.4 的表格设置，布局持久化 id 为 `assets`。
   - 预览栏可以用 `Ctrl+\` 折叠；窗口宽度小于 1200px 时默认折叠。
2. **列表：**
   - 用 `Command`（`shouldFilter={false}`），按生产、预发、开发分组。
   - 筛选用 ToggleGroup 和带 Checkbox 项的 DropdownMenu；另有排序菜单。
   - 当前打开的资产和键盘高亮项的样式要能区分。
   - 顶部有「新建资产」按钮，附带「从 ssh config 导入」菜单。
3. **编辑器：**
   - 头部状态行，以及六个标签页（`TabsList variant="line"`）。
   - 表单用 RHF、zod 和 `useFieldArray`；路径和红线两个列表用 dnd-kit sortable 排序。
   - 必填字段加「*」；保存失败时按 6.4 的三步把焦点定位到出错字段，即使它在其他标签页。
   - 保存：`Ctrl+S` 触发，保存中显示 Spinner，有脏标记，离开前确认。
   - 重命名迁移用 Dialog；删除用 AlertDialog，并列出会被级联卸载的挂载。
4. **预览：**
   - 实现 `SkillPreview` 组件：文件切换 Tabs、档位 Select、渲染与源码切换、ContextBudget、Lint 列表、CodeBlock 加 `useHighlightedCode`、streamdown 加 typeset、发布路径及「复制」「在文件夹中显示」。
   - 草稿预览做 200ms 防抖，只采用最后一次请求的结果。
   - 用 `React.lazy` 拆分预览组件。
5. **探测面板：**
   - 在编辑器内纵向切分出来，`Ctrl+J` 折叠。
   - 用 Trace 实时显示每个步骤，新步骤用 Motion 逐条淡入。
   - 差异审阅由 Item、Checkbox、CodeBlockLine 组成。
   - 探测失败时显示分类后的 Alert，需要用户在终端执行的命令用 CodeBlock 展示。
   - 支持取消探测；用户离开页面后探测完成，弹 Toast 通知。
6. **导入和首次启动：**
   - 导入 Dialog：Table 加 Checkbox；提示跳过了几个通配 Host；提供「导入后立即探测」开关。
   - 首次启动：Empty 组件里放三步清单。

**验收门槛：**

- PRD 6.11 中与资产相关的每个状态都能用夹具复现，逐条列出并截图。
- 键盘操作全部可用：在列表中用方向键移动、Enter 打开、Tab 遍历表单、用键盘完成拖拽排序。
- Playwright 截图：资产视图在浅色和深色、1280 和 1024 宽度下各一张，共 4 张，存到 `cloudlink/e2e/__screenshots__/`。截图中没有文字溢出，焦点环清晰可见。
- `pnpm typecheck`、`pnpm lint`、`pnpm build`、`pnpm test` 全部通过。

### P3 挂载、Skills、活动、设置（L）

**任务：**

1. **看板：**
   - 源列表：`useDraggable` 绑定在拖拽手柄上；每项另有「挂载到…」菜单。
   - 目标卡片：Card 加 `useDroppable`。
   - 拖拽：DragOverlay；PointerSensor 设置 `distance: 4`；启用 KeyboardSensor；屏幕阅读器播报文案按 6.13。
   - 挂载芯片：Item 加 Motion 进出场动画。
   - 挂载前后的四种提示：生产资产挂全局时二次确认；全局和项目档位不同时阻止；别名不可达时提示；卸载后弹出带「撤销」的 Toast。
   - 挂载成功后弹生效提示的 Toast（F-303 AC4）。只要有生产资产挂在全局目标上，就常驻一条 Alert。
2. **矩阵：** Table 加 sticky 首列，单元格里放 Switch、档位菜单和 ContextMenu。矩阵和看板共用同一条挂载管线。
3. **Agent 视角：**
   - 从目标卡片菜单的子菜单里选择具体 Agent 进入视角。
   - 顶部显示横幅 Alert。
   - Skill 用「可见 / 不可见」两种标记区分，不降低透明度。
4. **目标管理：**
   - 添加项目 Dialog。Mock 下 plugin-dialog 返回一个固定路径。
   - 每个目标可以切换链接方式（自动、链接、复制），也可以移除。
5. **其余三个视图：**
   - Skills 视图：Table 加复用的 SkillPreview。
   - 活动视图：用 Trace 按天分组，分页加载，可筛选。
   - 设置视图：7 个分区；危险操作要求输入确认文字。

**验收门槛：**

- 只用键盘完成三件事：拖拽挂载、切换矩阵开关、进入和退出 Agent 视角。
- 夹具中的六种挂载状态（ok、broken、conflict、stale-copy、alias-missing、复制模式）都能看到，文案正确；「档位不同」的挂载尝试被阻止。
- Playwright 截图：挂载视图的看板、矩阵、视角三种状态，以及 Skills、活动、设置视图，每个都要浅色和深色两张，宽度 1280。
- `pnpm typecheck`、`pnpm lint`、`pnpm build`、`pnpm test` 全部通过。

### P3.5 前端改到 v3（L）

**目标：** 在 Mock 数据下实现 PRD v3 第六章：服务器视图、新建服务器与测试连接、Agent 视图、设置（含活动）。删除项目级挂载、Token 估算和链接方式相关的全部代码。

**任务：**

1. **契约与 Mock：**
   - `src/bindings/`：Asset 增加 `connection.source/host/port/user/auth/proxyJump/verified` 和 `agent`（`agents`、`mode`、`unlockedUntil`；2026-11-01 由 `distribute` 改为按 Agent 点选），去掉 `slug` 和 `guardrails.defaultMode`；Target 去掉 project 类型和 `linkMode`，增加 `enabled`、`detected`，AgentId 只保留 `claude-code`、`universal`、`custom`；Mount 改为 Delivery（每个目标一份副本，状态为 `ok`、`pending`、`missing`、`modified`、`outdated`、`conflict`）；新增 Inclusion、SkillConfig、CompileStatus、GuardStatus、GuardRules、Operation、AgentNote、ConnectionTestRequest、`connection://tested` 载荷、SshConfigStatus；CompilePreview 去掉 Token 字段。
   - `ipc.ts` 和 `events.ts` 按 PRD 7.8 更新（9 个事件）；`copy.ts` 按 6.11 的状态词表和术语更新，加入护栏原因 id 的文案。
   - Mock 夹具按 PRD 7.8 的新表格重写，包括测试连接的几种结果、首次连接的主机指纹确认、Agent 笔记、操作记录和临时解锁。
2. **store：** 按 PRD 7.5 改写。新增 `useConnectionStore`、`useDeliveryStore`、`useGuardStore`、`useNotesStore`、`useOperationStore`；删除 `selectVisibleSkills`、lens 状态和 Token 相关状态。`selectCanDistribute` 写单元测试（未验证、只用密码、已验证三种情况），`selectUnlockRemaining` 写单元测试（未解锁、解锁中、已到期）。
3. **外壳：** 侧栏三项（服务器、Agent、设置），快捷键 `Ctrl+1` 到 `Ctrl+3`、`Ctrl+N`，命令面板按 6.9 分三组（含临时解锁和预览 Skill）。
4. **服务器视图（6.4）：**
   - 卡片网格按环境分组、搜索、卡片上的 Agent 按钮（2026-11-01 取代分发开关）、笔记和解锁徽章、方向键导航。
   - 详情面板的分段：Agent 分段排第一，含护栏行、临时解锁和各运行环境的列入情况；笔记分段处理 Agent 笔记；操作记录分段。底部保存操作条。
   - 预览 Sheet：复用 P2 的 SkillPreview，改为总 Skill 的文件切换和运行环境选择，去掉 Token 估算。
   - 探测 Sheet：复用 P2 的探测组件，差异审阅改为「已更新、待确认、撤销」。
5. **新建与编辑连接（6.5）：** 表单字段、三种认证方式、测试连接的原地结果、主机指纹确认、「改用密钥登录」、未验证时保存的提示、首次写入 ssh 配置的同意对话框。不再有 slug 字段。
6. **Agent 视图（6.6）：** 「交给 Agent 的内容」（服务器之间的关系、运维约定、巡检清单入口、保存操作条）；护栏分区（各运行环境的状态、安装与移除的确认对话框、规则 Sheet）；按环境分组的目标卡片（启用开关、副本状态、修复、停用确认、检查全部）。
7. **设置（6.7）：** 新增「ssh 配置」「活动」分区，活动中加入「Agent 操作」筛选；编译分区的正文行数上限默认改为 100；危险操作改为「移除全部分发」和「清空数据」。
8. **删除：** `features/mounts/`（含 `MountChip`、`useMountPipeline`）、`features/skills/`、`features/activity/` 独立视图（活动组件移入设置）、看板和矩阵的 dnd 代码、AddProjectDialog、lens 相关样式和测试、`ContextBudget`（Token 估算）、`RenameDialog`（修改 Skill 名）、`schemas.ts` 中的 slug 规则与保留名、链接方式菜单，以及对应的 e2e 用例与截图。保留 dnd-kit 的 sortable（路径、红线、运维约定的排序）。
9. **DESIGN.md：** 删除 Agent Lens 和 Mount Chip 两节（v3 不再有芯片）；预算区删除三项 Token 估算，只保留两条进度；「Card 只用于挂载目标」改为「服务器卡片和 Agent 目标卡片用 Card」；The One Signal Rule 的场景从「焦点、落点、视角」改为「焦点、选中的服务器卡片描边」；等宽字体规则中去掉 slug 和 Token 数，加上命令；图标表和动效清单按 PRD 6.7 和 7.7 更新（护栏、解锁、笔记、Agent 操作的图标）。

**验收门槛：**

- PRD 6.10 的每个状态都能用夹具复现，逐条列出并截图；测试连接的五种结果（成功、超时、被拒、认证失败、首次指纹确认）和探测的三种结果（已更新、有待确认项、撤销）都能复现。
- 只用键盘完成：`Ctrl+N` 新建服务器、填写、测试连接、保存；在卡片之间移动并打开详情；在卡片的 Agent 按钮之间用方向键移动、用空格切换（2026-11-01 取代分发开关），用空格切换 Agent 启用开关；用命令面板临时解锁和锁回。
- 代码中不再出现 `lens`、`project`（Agent 目标语义下）、`Mount` 类型、`AddProjectDialog`、`linkMode`、`slug` 和 Token 估算（`grep` 结果附在汇报里）。
- Playwright 截图：服务器（列表加详情）、新建服务器、Agent、设置，浅色和深色、1280 和 1024 宽度，存到 `cloudlink/e2e/__screenshots__/`。
- `pnpm typecheck`、`pnpm lint`、`pnpm build`、`pnpm test` 全部通过。

### P3.6 前端改到 v3.1：紧凑配电盘（对标 CC Switch）与云平台 CLI（L）

**目标：** 在 Mock 数据下实现 PRD v3.1 与 DESIGN.md 的「紧凑配电盘（Compact Breaker Panel）」界面、一步到位新建流程、云平台 CLI（Cloudflare / Vercel / Oracle Cloud）接入，拆掉重型三栏后台外壳，并彻底移除「30 分钟临时解锁」。

**任务：**

1. **窗口默认尺寸对标 CC Switch（紧凑桌面小工具形态）：**
   - 修改 `cloudlink/src-tauri/tauri.conf.json`：默认窗口尺寸由 `1280×800`（`minWidth: 960, minHeight: 600`）调小为 **`900×640`**（`minWidth: 760, minHeight: 520`）。
   - 修改 `playwright.config.ts` 与 `e2e/gate.spec.ts`：默认视口改为 `900×640`，门槛截图测试 `900` 与 `760` 宽度。
2. **拆掉「三栏后台套娃外壳」（取消左侧大边栏、顶部面包屑栏与左右分栏并排挤压）：**
   - 移除 `AppSidebar`、`SidebarProvider` 和 `Breadcrumb` 面包屑栏，改为单条 **48px 顶部极简一体栏**：
     - 左侧：`CloudLink` 应用名 + 分段视图切换器 `( 资源 ) ( Agent ) ( 设置 )`（带计数/红色异常徽章）。
     - 右侧：在资源主页直接放置紧凑搜索框、`[+ 添加服务器]` 主按钮、`[+ 云平台 ▾]` 下拉按钮（含 Cloudflare / Vercel / Oracle Cloud / 从 ssh config 导入）及命令面板图标按钮 `[⌘]`。
   - **彻底取消 `ResizablePanelGroup` 左右分栏挤压**：资源列表永远独占全宽居中容器（`max-w-3xl mx-auto`），绝不因打开添加表单或详情而把列表挤成 `De... · 3 ...` 省略号。
3. **单行零噪点回路行（`BreakerRow.tsx` 彻底瘦身）：**
   - 分组标题只保留简洁的「服务器」与「云平台」，去掉每个分组上方重复的 `权限档位 / 授权 Agent` 列头。
   - **砍掉所有第二行统计小字与重复命名**，每行严格保持**单行高度（44–48px）**：
     - **SSH 服务器行**：`连接状态圆点（● 绿=已连接 / ○ 灰=未验证 / ● 琥珀=已修改 / ● 红=失败）` + `服务器名称（香港边缘节点）` + `等宽别名胶囊（hk-edge）` + `（仅异常或有笔记时显示：[改用密钥登录] / [测试连接] / 笔记 N）`，去掉 `[U]`/`[D]` 方块与 `Ubuntu 22.04 · 2 个服务` 及重复的 `生产环境已开启写权限` 文字。
     - **云平台 CLI 行**：`官方品牌 Logo（ProviderMark）` + `平台名称（Cloudflare / Vercel，严禁再写 cloudflare Cloudflare · wrangler 或 vercel Vercel · vercel 重复文字）` + `账号与范围简述（me@example.com · 2 个域名）` + `（仅异常时显示：⚠ WSL 未登录 + [去登录]）`。
     - **右侧双闸刀**：`权限档位闸刀`（点击切换 `只读巡检` ↔ `标准运维`，生产资源处于 `标准运维` 时琥珀色高亮提醒）+ `Agent 品牌开关（AgentPicker）`。
4. **添加资源（居中弹窗 `Dialog` 或独立聚焦视图）与全宽详情页（`← 返回`）：**
   - 点击 `[+ 添加服务器]` 或 `[+ 云平台 ▾]` 弹出居中 `Dialog`（`max-w-lg`）或切入独立聚焦卡片视图（绝不并排挤压主列表）；「连接并启用」/「保存并启用」完成后自动关闭并回到主列表。
   - 点击某一行进入带 **`← 返回`** 按钮的全宽详情视图（`max-w-3xl mx-auto`，按 `Esc` 或点顶栏「资源」同样返回主列表），内部为「常驻控制头 + 3 个平铺 Tab（`画像与规则` / `连接配置` / `动态`）」，移除 8 层 `Collapsible` 手风琴。
5. **移除 30 分钟临时解锁 + 契约与官方品牌 Logo：**
   - 彻底删除 `unlockedUntil`、`unlockServer`、`lockServer`、`selectUnlockRemaining`。
   - `Asset` 支持 `type: "vps" | "cli"`，封装 `ProviderMark.tsx`（Cloudflare、Vercel、Oracle Cloud 官方品牌 SVG Logo）。

**验收门槛：**

- 窗口默认尺寸为 `900×640`（最小 `760×520`）；无左侧大边栏、无顶部面包屑栏、无 `ResizablePanelGroup` 左右分栏挤压。
- 主列表每行均为单行高度（44–48px），无第二行冗余小字、无 `vercel Vercel · vercel` 重复命名、全屏零 `...` 截断省略号。
- 代码中不再出现 `unlockedUntil`、`unlockServer`、`lockServer`、`selectUnlockRemaining`、`DetailSection`。
- Cloudflare、Vercel、Oracle Cloud、Claude Code、OpenAI 均使用官方品牌 Logo。
- Playwright 截图更新并通过，`pnpm typecheck`、`pnpm lint`、`pnpm build`、`pnpm test` 全部通过。

### P4a Rust 核心：数据、环境、SSH、编译（L）

> **P4 开工前必读：** 先通读 `docs/CC-SWITCH-EXPERIENCE.md`（第二、三、四章），重点对照其中列出的 6 个 `SSH_ASKPASS` / Windows OpenSSH / 凭据目标校验 / 路径重叠与测试隔离必改项。

1. **骨架：**
   - 按 PRD 8.1 写好 Cargo 依赖（锁定主版本），搭好模块骨架，用 thiserror 定义错误类型。
   - 用 ts-rs 把类型导出到 `../src/bindings/`，和 P1 手写的契约比对。
   - 加入 `tauri-plugin-window-state` 后，复核默认窗口尺寸 1280×800（P0 遗留，2026-10-28 决定留到这里）：在 1080p、125% 缩放且任务栏常驻的屏幕上，它连同标题栏比工作区高约 22 像素。
2. **db：**
   - rusqlite（bundled、WAL 模式），带迁移和 `schema_version`。
   - 表：服务器、目标、分发、列入、活动、设置（含总 Skill 的全局内容）、探测快照（用于撤销）、操作记录、笔记。密码不进数据库。
   - 编写单元测试。
3. **env：**
   - 检测 Windows 和各个 WSL 发行版。注意 `wsl.exe -l -q` 输出的是 UTF-16LE，必须正确解码并去掉 NUL 字符。
   - 获取各环境的 home 目录和 ssh config 路径；用 `wslpath` 做路径换算。
4. **ssh：**
   - 用 ssh2-config 枚举 Host：Windows 的配置直接读取；WSL 的配置通过 `\\wsl.localhost\<distro>\home\<user>\.ssh\config` 读取，并设置 `home_dir`。排除通配 Host。
   - 获取生效值：Windows 用 `ssh.exe -G`，WSL 用 `wsl.exe -d <distro> -- ssh -G`。
   - 托管配置（F-107）：整文件重写 `cloudlink.conf`（原子写入）；在用户 `~/.ssh/config` 开头加 Include 前先备份；用 `ssh -G` 回读校验。全部在临时 HOME 中测试。
   - 测试连接（F-106）：临时配置、主机指纹的取回与确认、超时和取消；错误按 8.3 分类。
5. **secret（F-108）：**
   - 密码存取（Windows 凭据管理器，`keyring`；单元测试下强制禁用原生凭据库并注入内存实现，在释放状态锁后再访问 OS 凭据库，未传新密码时先校验 `host/port/user/auth` 未变）；`SSH_ASKPASS` 辅助模式（在 `main.rs` 第一行按环境变量标记分流，不经过 `tauri-plugin-single-instance`；Windows 下用 `current_dir` + `./cloudlink.exe` 规避 OpenSSH 9.5 非 ASCII 路径破损，loopback `accept()` 后显式 `set_nonblocking(false)`，详见 `docs/CC-SWITCH-EXPERIENCE.md` 第二章）。
   - 生成 ed25519 密钥、经密码连接追加公钥（只追加一行并带 `cloudlink` 注释）、切换认证方式。
6. **compile：**
   - 用 minijinja 渲染英文模板（总 Skill 的 SKILL.md、每台服务器的详情文件、health-check.md）和 description 模板，按运行环境输出到 `compiled/<环境>/cloudlink-servers/`；description 超长时按 PRD F-201 AC2 截断。
   - 实现 PRD 5.4 的全部 Lint 规则，包括疑似注入和已关闭导出的字段；每条结果带服务器 id。
   - 内置 gitleaks 规则集（MIT 许可），并在 `THIRD_PARTY_NOTICES` 中注明。
   - 原子发布：先写暂存目录，再交换目录；失败时重试 3 次。

**验收门槛：**

- `cargo test`、`cargo clippy --all-targets -- -D warnings`、`cargo fmt --check` 全部通过。
- 黄金样例：用 PRD 3.3 的示例服务器、7.8 夹具中的另外两台和 3.3 的示例全局内容编译 Windows 环境的总 Skill，结果与 `tests/golden/` 中的文件逐字节一致，内容与 PRD 5.2 的英文示例对应。
- 密钥扫描：样本集漏放行数为 0。

### P4b Rust 核心：探测、分发、云 CLI、IPC（L）

1. **probe：**
   - 内置探测脚本（PRD 8.3）。
   - 执行命令：`ssh -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=yes -- <alias> 'sh -s'`；WSL 目标通过 `wsl.exe` 执行，密码认证复用受控 `SSH_ASKPASS`。
   - 默认 30 秒超时，支持取消；原始 stdout/stderr 只保留在有上限的内存缓冲中，不写入磁盘、数据库、日志或 IPC。
   - 输出按段解析；错误按 8.3 分类，只返回 id。
   - 探测数据按不可信输入清洗（8.3）；自动合并，合并前保存快照，支持确认待处理项和撤销最近一次。保留人工标注与探测后的手工修改，失败段不用于推断服务已消失。
   - 用预先录制的样例输出测试解析，至少覆盖 Ubuntu、Alpine/BusyBox 和「无 docker 权限」三种情况。
2. **deliver：**
   - 受管复制：把各运行环境的编译产物写进已启用的目标；WSL 目标经 `\\wsl.localhost\<发行版>\` 路径写入；先写暂存目录再整体交换。
   - 校验所有权标记 `.cloudlink.json`、整树内容哈希、祖先路径重叠及 symlink/reparse point，拒绝覆盖或删除外部内容。
   - 列入计算：资源是否点选了这个 Agent × 资源是否通过连接验证 × 该环境是否有可用的 SSH 连接配置；CLI 资源则要求该环境的绑定账号就绪。一次资源验证允许其他已有可用配置的环境列入。每个「运行环境 × Agent」一行，不满足就记为未列入并给出原因 id；托管 SSH 还须校验完整配置与 Include 的实际生效位置。
   - 健康检查四类问题：副本缺失、副本被改动、待同步、冲突，并重新计算列入情况；检查只报告状态，修复由具名命令执行。
   - 编译受阻时保留上次成功的编译源，但禁止用旧源创建或修复副本；授权、导出字段或 Scope 缩减时，移除仍暴露旧授权的受管副本。
3. **cli（F-104）：**
   - 只检测已启用 Agent 的运行环境，通过 Login Shell 发现绝对路径、版本和账号；支持 Cloudflare Account ID、Vercel 稳定 Team/User ID 和 OCI Profile。
   - Scope 按 provider/account 绑定与校验，覆盖 Zones/DNS 关联、Workers/Pages、Vercel 项目分页，以及 OCI compartments 与实例公网地址；过期、撤权或刷新失败时旧 Scope 选项不能继续用于新增授权。
   - CLI 原始响应与临时认证数据只在子进程内存中投影，Rust 返回公开元数据和固定错误 ID；关闭 Wrangler 磁盘诊断日志，不改用户登录态。
   - 「打开终端」只预填固定允许的安装/登录命令，等待用户回车执行。隔离运行默认注入 EmptyRunner 或 fixture runner，不探测真实 CLI。
4. **ipc 与持久化协调：**
   - 注册 PRD 7.8 的资源、连接、探测、分发、CLI、设置与活动命令和事件；护栏、操作记录、笔记及 `reset_data` 留到 P4c。
   - capability 按最小权限配置，不开放 shell 和 fs 插件。
   - 增加密码 revision 引用、失败/旧凭据的持久清理队列与生成/复制密钥回执；OS 凭据访问在状态锁与数据库锁外完成。
   - 异步任务可取消，窗口关闭时取消活动任务；新任务和确认/撤销必须校验当前资源及最近运行身份。日志与事件只发送 ID、参数和清洗后的字段。

**验收门槛：**

- `cargo fmt --check --manifest-path cloudlink/src-tauri/Cargo.toml` 通过。
- `cargo clippy --locked --jobs 1 --manifest-path cloudlink/src-tauri/Cargo.toml --all-targets -- -D warnings` 通过。
- `cargo test --locked --jobs 1 --manifest-path cloudlink/src-tauri/Cargo.toml -- --test-threads=1` 通过；覆盖临时目录中的分发、数据库回执与注入 runner 的 IPC 集成，不访问真实 Skills、SSH 配置、CLI 登录态或 OS 凭据库。
- ts-rs 导出与前端契约同步，既有命令与事件载荷保持兼容。
- 前端 `pnpm --dir cloudlink typecheck`、`pnpm --dir cloudlink lint`、`pnpm --dir cloudlink test` 和隔离桥回归 `node --test cloudlink/src-tauri/src/cli/metadata.test.cjs` 通过。
- `pnpm --dir cloudlink e2e --workers=1 --trace=retain-on-failure` 通过；门槛截图按每个视图使用独立 page/context，覆盖 PRD 7.10 要求的全部视图、主题与尺寸，保留页面断言和控制台检查。
- `pnpm --dir cloudlink build` 通过。

隔离测试与 Mock E2E 不替代 P5 的真实 Windows/WSL、SSH、云 CLI 和 Agent 使用验收。

### P4c 护栏、操作记录与笔记（L）

1. **guard-rules（规则 crate）：**
   - 按 PRD 8.6 实现保守的 shell 词法分析和判定规则。
   - 命令样本集放在 `src-tauri/tests/guard-corpus/`，不少于 200 条。覆盖：巡检清单（PRD 5.6）的全部命令必须放行；常见写操作及其变体（引号、管道、`&&`、`sudo`、`docker exec`、`sh -c`、heredoc、重定向）在只读资源上必须拦下；标准运维下的危险类别必须拦下；SSH 凭据读取与云 CLI 凭据导出在任何档位都拦下；账号与 Scope 必须匹配绑定资源；`policy.json` 缺失时放行。档位按 v3.1 直接切换，不实现临时解锁或倒计时。
2. **cloudlink-guard 程序：**
   - 从标准输入读 hook 的 JSON，按 `policy.json` 判定，拦下时输出 deny JSON，并追加记录（精简脱敏）。
   - 只依赖标准库和 serde_json；作为 sidecar 打包（`bundle.externalBin`）。
3. **guard 模块：**
   - 原子写入 `policy.json`：服务器的别名、地址、档位、关键服务，以及云 CLI 的 provider、绑定账号与已选 Scope。
   - 在临时 HOME 中测试 `settings.json` 的安装与移除：已有其他设置和 hook 时原样保留，键顺序不变；文件不是合法 JSON 时拒绝修改；生成备份文件；只删除自己的条目。
   - 启动时把护栏程序复制到 `~/.cloudlink/bin/`（版本不同才复制）；自检；资源档位、授权与 Scope 变化时更新策略。
4. **真实 Agent 验证：** 实测 Claude Code 在 Windows 上执行 hook 命令用的 shell、路径的引号写法、WSL 中经 `/mnt/c` 调用的耗时，以及跳过权限确认模式下拦截是否生效，结果在会话中汇报。只有真实验证证明 JSON 形式的拒绝不生效时，才调整为退出码 2 加 stderr 说明原因，并同步 PRD 8.6 的协议约定。
5. **操作记录（F-307）：** 读入 JSONL、用完整规则集脱敏、30 天清理；`operations://new` 事件。
6. **笔记（F-308）：** 收件箱读取（先重命名再读）、扫描、并入与忽略；`notes://new` 事件。
7. **ipc 与完整数据清理：** 护栏、操作记录和笔记的命令，以及 `guard://changed` 事件；实现 `reset_data`，统一清理受管分发、托管 ssh 配置、凭据库中的密码及清理回执、护栏 hook、笔记收件箱和操作记录，严格校验所有权并保留用户的其他文件与设置。该命令与完整 guard/notes 清理一起验收。

**验收门槛：**

- `cargo test --locked --jobs 1 --manifest-path cloudlink/src-tauri/Cargo.toml -- --test-threads=1` 通过；规则样本集漏放行与误拦均为 0，巡检清单中的全部命令能通过只读白名单。
- 临时 HOME 中安装再移除护栏，`settings.json` 与安装前逐字节相同；其他设置和 hook 原文保留；无所有权、损坏备份或外部移动 hook 时拒绝含糊清理。
- 实际打包 Guard 的判定 p95 在 Windows 原生环境不超过 50ms，经 WSL 互操作不超过 300ms；中文、空格、单引号与字面 `$()` 路径引用保持原义。
- 全工作区 `cargo fmt --check --manifest-path cloudlink/src-tauri/Cargo.toml` 与 `cargo clippy --locked --jobs 1 --manifest-path cloudlink/src-tauri/Cargo.toml --all-targets -- -D warnings` 通过。
- ts-rs 导出与前端契约一致；前端 typecheck、lint、Vitest、CLI 桥回归、完整 Mock E2E 和生产前端 build 通过。
- 完整重置及后台任务的并发回归通过；失败可重试，重启或迟到的任务不能恢复旧授权或旧前端状态。
- 第 4 项真实 Claude Code 实测通过：确认实际 Windows hook shell，以及跳过权限确认模式下的拒绝行为。独立 sidecar、Git Bash 和 WSL 进程测试不能替代真实 Agent 验证；缺少证据时，在会话汇报中保留未验证状态。

全新检出后，直接运行 Cargo 门禁前执行 `pnpm --dir cloudlink build:guard`，准备 Tauri 所需的目标三元组后缀 sidecar；`tauri dev/build` 的前置命令会自动执行。Rust 与 Vitest/Playwright 全套串行运行，本机测试隔离与内存规约见 `CC-SWITCH-EXPERIENCE.md` 第四章。

### P5 联调与端到端验收（M）

1. 前端切换到真实 IPC（非 Mock 模式），逐项修复与契约不一致的地方；在接入前满足 PRD 8.5 的 CSP 要求，并检查正式窗口的安全配置。
2. **搭测试靶机：**
   - 在 WSL Ubuntu 中安装 `openssh-server` 和 `docker.io`，启动 2 个容器，例如 nginx 和 redis。
   - 在 Windows 和 WSL 的 ssh config 中各加一条 `Host test-vps`，指向 WSL 中的 sshd（例如 `localhost:2222`），使用专门的测试密钥。
3. **手工验收清单**（执行结果和截图在会话中逐项汇报）：
   - [ ] 首次启动引导能检测到 Windows、WSL，以及已安装的 Claude Code 和 Codex。
   - [ ] 在界面里新建 `test-vps`（私钥认证），测试连接时显示主机指纹，确认后连接成功；托管配置写入、Include 加在用户 config 开头且有备份。
   - [ ] 用密码新建一台（靶机临时开启密码登录），测试连接成功；「改用密钥登录」后公钥已追加、认证方式已切换，凭据库中的密码可删除。
   - [ ] 错误分类：停掉 sshd（被拒）、填错端口（超时）、错误密码、错误私钥各测一次，文案正确。
   - [ ] 从两个运行环境导入一台 ssh config 中已有的主机，「来源环境」显示正确，连接信息只读。
   - [ ] 探测成功。
   - [ ] 停掉 sshd 后再探测，失败原因分类正确。
   - [ ] 首次连接时，「主机密钥未信任」的提示和建议命令正确。
   - [ ] 编辑服务器时，预览、预算和 Lint 实时更新。
   - [ ] 在服务器信息中写入 `password=xxx`，发布被阻断。
   - [ ] 打开分发后，Windows 和 WSL 的目标里都写入了 `cloudlink-servers` 副本；WSL 中没有私钥时，这台服务器在 WSL 中显示「未列入」及原因，WSL 的总 Skill 里也没有它。
   - [ ] 未验证的服务器不能分发给 Agent。
   - [ ] 给 `test-vps` 填一个承载的站点（例如 `test.example`），然后在 Claude Code 中不点名服务器，只说「test.example 打不开，帮我看看」，Agent 会加载 `cloudlink-servers` 并找到 `test-vps`：Windows 和 WSL 各验证一次。会话运行中途新建目录时，`/reload-skills` 的提示正确。如果安装了 Codex，也验证一次。
   - [ ] 生产服务器默认只读巡检；切到标准运维时出现二次确认，产物随之重新编译。
   - [ ] 手动删除一个副本、改动另一个副本，健康检查分别标为「副本缺失」「副本被改动」，「修复」能恢复（被改动的先提示会覆盖）。
   - [ ] 在目标位置预先放一个手写的 `cloudlink-servers` 目录，被判定为冲突，并且没有被覆盖。
   - [ ] 删除服务器后，它从总 Skill 中消失；托管配置中的条目和凭据库中的密码被删除，只删除本软件创建的内容。
   - [ ] 两套 ssh 都验证一次（PRD 8.3）：应用探测走 Windows OpenSSH；Claude Code（Git Bash）实际执行 `ssh test-vps` 也能连上。
   - [ ] Agent 的沙箱和权限（第 6 节风险表）：在 Claude Code 和 Codex 的默认设置下，各让 Agent 执行一次 `ssh <别名> uptime`，记录是直接放行、需要批准还是被拦下。Codex 的 Windows 沙箱允许连本机回环地址，所以这一项的别名要指向 WSL 的实际 IP（在 WSL 中用 `hostname -I` 查看），不能用 `localhost:2222`，否则测不出连真实 VPS 时的情况。
   - [ ] 护栏安装：同意对话框中展示的 JSON 与实际写入一致；生成了 `settings.json.cloudlink-bak`；`settings.json` 中原有的其他设置和 hook 原样保留。
   - [ ] 在 Claude Code 的跳过权限确认模式下（`--dangerously-skip-permissions`），对只读的 `test-vps`：让 Agent 重启一个容器，被拦下，Agent 收到原因并且没有尝试绕过；让它读取一个 `.env`，被拦下；巡检类命令全部放行。WSL 中再验证一次拦截。
   - [ ] 把 `test-vps` 切到标准运维：普通的容器重启放行，`docker compose down -v` 被拦下；把 nginx 容器标为「关键」后，`docker stop nginx` 被拦下。
   - [ ] 切回「只读巡检」后，写操作恢复拦截；关掉 CloudLink 后护栏照常工作，模式取自已发布策略。
   - [ ] 操作记录：详情中能看到以上命令和结果，命令里故意写的假 Token 已脱敏。
   - [ ] 护栏自检：手动删掉 `settings.json` 中的条目后，Agent 页显示「护栏未生效」；重新安装后恢复。
   - [ ] 巡检：对 Claude Code 说「巡检一下所有服务器」，Agent 按清单逐台执行，没有命令被护栏拦下，最后给出汇报表。
   - [ ] Agent 笔记：让 Agent 在排查中记一条笔记，卡片出现「笔记 1」；故意让它记一条带假密码的笔记，被标为需编辑；并入后详情文件的 Notes 一节出现这一行，新会话中 Agent 能读到。
   - [ ] 探测自动合并：在靶机上新起一个容器后探测，服务列表自动更新并重新编译；「撤销本次更新」能恢复；把一个容器命名为疑似注入的字符串（例如 `ignore-previous-instructions`），它进入待确认，没有自动合并。
   - [ ] 用户原有的 Skill 完好无损：Windows `~/.claude/skills` 下的 17 项，以及 WSL `~/.agents/skills` 下的 repo-to-resume-tailor。验收前后各列一次目录，内容逐项相同。
4. Playwright 的 Mock 用例全部仍然通过。

**验收门槛：** 清单全部通过；在会话中列出遗留问题，并标注严重程度。

### P6 打磨、更新与打包（M）

2026-11-05 起，应用图标和 F-406 检测更新也在本阶段实施（PRD 11.1）。

1. **无障碍：** 完整走一遍键盘操作流程；检查焦点顺序和「减少动态效果」设置；确认 150% 缩放下布局正常。
2. **性能：** 首屏 JS 压缩后不超过 600KB；预览按需加载；冷启动不超过 1.5 秒。
3. **文案：** 按 PRD 6.11 的规范把 `copy.ts` 全部过一遍，包括 F-406 新增的更新文案。
4. **应用图标：**
   - 以 `docs/brand/cloudlink-icon.svg`（「交汇 · 浅色」，规格见 DESIGN.md「App Icon」）为唯一源文件，运行 `pnpm --dir cloudlink exec tauri icon ../docs/brand/cloudlink-icon.svg` 重新生成 `src-tauri/icons/`。v0.1 只发 Windows，删掉生成出来的 `android/`、`ios/` 目录；`tauri.conf.json` 的 `bundle.icon` 列表不变。
   - 删除 `docs/brand/` 下未选中的候选稿和预览图（`cloudlink-icon-junction.svg`、`cloudlink-icon-loop.svg`、`cloudlink-icon-nodes.svg`、`cloudlink-icon-preview.png` 和 `styles/` 目录），只保留源文件。
   - 检查任务栏、开始菜单、窗口标题栏、安装程序和「应用和功能」列表里的图标：深色和浅色任务栏各看一次，16 到 48px 都清晰。
   - 界面内的顶栏仍只显示文字 `CloudLink`，不放应用图标：图标含信号青，放进界面会违反 One Signal Rule。
5. **检测更新（F-406）：** 按 PRD F-406、6.13、7.3、7.8、8.1、8.5 实现。
   - Rust：新增 `update` 模块；`tauri-plugin-updater` 只在 Rust 侧初始化和调用，capability 不增加 `updater:*`；`Settings.autoCheckUpdates` 默认为 `true`，数据库迁移补上默认值；新增命令 `get_update_status`、`install_update`、`cancel_update` 和事件 `update://changed`，新增的 `IpcErrorId` 经 ts-rs 导出。
   - 前端：接入 `ipc.ts`、`events.ts`；新增一个更新 store；实现顶栏提醒按钮、更新对话框、命令面板「安装更新」，以及「设置 → 通用」的开关和当前版本号；文案全部放进 `copy.ts`；`eslint.config.js` 按 PRD 7.4 禁止引入 `@tauri-apps/plugin-updater`。
   - Mock 与测试：Mock 默认没有新版本，现有截图不变。Rust 单元测试用假的更新源，覆盖定时、开关、失败重试、忙碌判定和签名失败，不访问网络。Vitest 覆盖更新 store。Playwright 覆盖「默认隐藏 → 发现新版本 → 打开对话框 → 下载进度 → 取消 / 失败 / 等待任务」，并按 PRD 7.10 第 5 条补顶栏提醒和对话框的截图。
6. **签名与发布：**
   - 签名密钥只生成一次：`pnpm --dir cloudlink tauri signer generate -w ~/.tauri/cloudlink.key`。私钥和口令存进密码管理器并另行备份，绝不入库；公钥写入 `tauri.conf.json` 的 `plugins.updater.pubkey`。
   - `tauri.conf.json`：`bundle.targets` 改为 `["nsis"]`（按当前用户安装，不需要管理员权限）；加上 `bundle.createUpdaterArtifacts: true`；`plugins.updater.endpoints` 填 PRD 8.5 的 GitHub 地址；`plugins.updater.windows.installMode` 为 `"passive"`。
   - 版本号三处一致：`tauri.conf.json`、`src-tauri/Cargo.toml`、`package.json`。目前前两处是 0.1.0，`package.json` 还是 0.0.1。
   - 构建：设置环境变量 `TAURI_SIGNING_PRIVATE_KEY`（私钥路径或内容）和 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`，运行 `pnpm --dir cloudlink tauri build`，得到 `CloudLink_<版本>_x64-setup.exe` 和对应的 `.sig`。
   - 新增 `cloudlink/scripts/release-manifest.mjs`（只用 Node 标准库），从构建产物生成 `latest.json`：`version`、`notes`、`pub_date`，以及 `platforms["windows-x86_64"]` 的 `signature` 和 `url`。
   - 发布：`gh release create v<版本> <安装包> <latest.json> --repo Furina-he/cloudlink`。预发布版本不会出现在 `releases/latest` 下，可以用来试发；正式发布前先征得用户授权。
   - v0.1.0 之后改在 GitHub Actions 上构建和签名：推送 `v<版本>` 标签后，`.github/workflows/release.yml` 校验签名、生成 `latest.json` 并创建草稿 Release，维护者检查后发布。私钥和口令另存一份在仓库的 Actions Secrets。流程见 `docs/releases/README.md`。
7. **可选质检：**
   - 用 impeccable 的 `audit` 和 `polish` 做一次 UI 质检。
   - 再运行 `/impeccable document`，用实际代码重新校准 `DESIGN.md`。
8. **安装与更新实测：**
   - 在干净的 Windows 上安装、运行、卸载一遍；有虚拟机时用虚拟机。
   - 端到端更新：用测试配置构建 0.1.0 和 0.1.1，把端点指向本地 HTTP 服务（只有测试配置允许 http）。装好 0.1.0 后，从顶栏提醒走完下载、安装和自动重新打开。确认数据、凭据、托管 ssh 配置、护栏 hook 和已分发的副本都还在，`~/.cloudlink/bin/` 中护栏程序的哈希和新版一致。
   - 篡改安装包或签名后，更新被拒绝，界面提示签名校验失败。关闭「自动检查更新」后不再发出请求，用本地 HTTP 服务的访问日志核对。

**验收门槛：** 安装包能正常安装和运行；应用图标在各处显示正确；F-406 的 AC 全部通过，端到端更新和签名篡改实测通过；第 5 节的完成定义全部满足。

### P7 v0.2 体验与界面重设计（L，拆成 P7a、P7b、P7c）

**目标：** 实现 PRD v4 第六章与 DESIGN.md「安静钢面」。决策来源是 2026-11-07 至 11-08 的问答（PRD 11.1），视觉参照是 `docs/prototype/redesign/` 的可点击原型：两者不一致时以 PRD 和 DESIGN.md 为准，原型只演示交互，不是实现参考（它是手写 HTML，实现必须用 PRD 7.3 的组件）。

**P7a 外壳、令牌与资源视图：**

1. **令牌：** 按 DESIGN.md frontmatter 更新 `src/index.css`（PRD 7.6）：画布、卡片、pill、seg-track、发丝线两档、文字四档、钢墨、Signal Cyan 与 soft、状态三色与 soft；字体改为 Segoe UI Variable Text / Microsoft YaHei UI 与 Cascadia Mono（移除 JetBrains Mono 自托管前先确认 7.1 白名单的改动并征得同意）；圆角按 DESIGN.md Shapes。
2. **外壳：** 窗口 `1000×680`（最小 `760×520`），去掉系统标题栏（`decorations: false`，顶栏 `data-tauri-drag-region`，自绘窗口按钮）；顶栏与侧栏两种外壳（F-408），`Ctrl+Shift+S` 与设置切换并持久化；导航四项（资源 / Agent / 动态 / 设置），`Ctrl+1` 到 `Ctrl+4`；顶栏右侧搜索、导航切换、`+`。
3. **资源视图（PRD 6.3）：** 两行资源行、正常即隐身、档位弹出菜单（含生产确认与撤销）、按目录计的 Agent 图标组（右边缘对齐）、修复按钮、右键菜单、搜索；删除旧的回路行、行尾编辑与「⋯」按钮、笔记徽章。
4. **生产环境开关（F-109）：** 契约 `envTag` → `production`（ts-rs 重新生成），数据库迁移，Skill 模板与 golden 文件更新，Lint 规则跟随。

**P7b 详情、添加、空状态：**

1. **详情（6.4）：** 去掉 3 个 Tab，改为全宽分组设置式列表；编辑即保存（文本字段防抖 600ms），连接字段走连接流程；最近动态。
2. **添加（6.5）：** 一个 `+` 加类型选择对话框；SSH 表单加入生产环境开关；沿用现有连接流程组件；新增 GitHub 选项（检测与登录，F-110 AC1、AC4 的接入部分）。
3. **导入（F-102 AC 2026-11-08）：** Rust `ssh::list_hosts` 排除代码托管主机并返回被跳过的列表；导入对话框底部注明。单元测试覆盖 github.com、`ssh.github.com`、`User git`、自定义别名指向 github.com 的情况。
4. **空状态（6.9）：** 示例话术、导入入口、检测到的 Agent。

**P7c Agent、动态、设置、自动同步、托盘（2026-11-09 完成）：**

1. **Agent 视图（6.6）、动态视图（6.7）、设置视图（6.8）。**
2. **自动同步与备份（F-309）：** Rust `deliver` 增加自动修复与备份目录、保留策略、撤销命令；同名冲突的「备份并接管」；所有覆盖前校验所有权与重分析点；测试只用隔离目录。
3. **托盘（F-407）：** Tauri `tray-icon` 特性；菜单按 6.10；关闭窗口留在托盘的设置。系统通知需要 `tauri-plugin-notification`，先登记 PRD 7.1 并征得同意，否则 v0.2 先不发通知（2026-11-09 已同意并登记，同时加入 `tauri-plugin-autostart` 实现开机启动）。
4. **清理：** 删除 v3.1 专属组件和 `copy.ts` 里不再使用的文案；更新 e2e 用例与门槛截图（四种外壳组合中至少：顶栏浅色、顶栏深色、侧栏浅色，760 与 1000 宽）。

**验收门槛（每个子阶段结束时）：**

- PRD 6.12 的状态在 Mock 夹具下都能复现并截图（证据截图放仓库根目录 `test-results/p7/`）。
- 只用键盘完成：添加 SSH 服务器、在资源行间移动、打开档位菜单切换、点亮 Agent 图标、切换导航位置。
- 对比度：DESIGN.md 列出的文字组合在浅色、深色下用脚本验算 ≥ 4.5:1。
- `pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm e2e`、`pnpm build` 通过；涉及 Rust 时串行运行 `cargo fmt --check`、`cargo clippy`、`cargo test`。
- `grep` 确认代码里不再有 `envTag`、`BreakerRow`、回路行和三 Tab 详情的残留。

### P7d 界面审查第四轮落地（M，2026-11-11 已实施并提交）

**目标：** 把 2026-11-10 第四轮审查确认的决定落到应用。依据是 PRD 6.3 至 6.8、6.13、6.15 与 F-106、F-107、F-307、F-402（均已更新），组件规格见 DESIGN.md（Add Dialog、折叠行、Command Chip、Activity Log Sheet）。`docs/prototype/redesign/` 已是确认过的样子，只作交互参照，实现必须用 PRD 7.3 的组件。

**实施约束（保留作参考）：**

- 保留第 1–3 轮审查的改动（应用、PRD、DESIGN.md、`e2e/__screenshots__`），不要覆盖或还原；`e2e/__screenshots__` 里只有噪点差异的图，提交前还原。
- 下面每一条先对照当前代码核实再动手：清单来自 2026-11-10 的 Mock 截图和 DOM 实测。
- 预期只改前端（`src/features`、`src/lib/copy.ts`、Mock、测试），IPC 契约和 Rust 不动；发现必须改契约时先问。

**1. 添加 SSH 服务器（6.5、F-106）**

1. 去掉表单底部固定的 `GrantFields`（`CreateParts.tsx`，SSH 表单和云平台向导共用）：新资源同步给全部已启用目标；档位从只读巡检开始。底栏改为一句说明 + 取消 + 主按钮。
2. 登录方式先选中「密码」；改成分段切换。私钥方式默认只显示一行路径，WSL 的那一份不在表单首屏展开。
3. 字段重排：地址 + 端口、用户 + 名称、别名行、登录方式、生产环境 + 「高级」。别名改为名称下方的行内输入框，自动跟随名称 / 地址，手改后不再跟随；「高级」只剩跳板机和运行环境。
4. 校验：名称留空且地址也空时不报「请填写名称」；别名自动生成后清掉「请填写别名」的旧错误。
5. 验收：760×520 下不滚动就能看到「名称」和别名行；浅色、深色各一张截图。

**2. 连接过程（6.5、F-107 AC1）**

1. Include 同意从 `AlertDialog` 改为过程里的一步「让 Agent 能用别名连接」：就地展开的卡，「加入」（主）、「暂不加入」、「了解详情」。`sshIncludeAsked` 里已问过的环境不再出现这一步。
2. 「暂不加入」：服务器照样保存；所有环境都没加入时资源行「Agent 还连不上」+「加入 SSH 配置」，提示条按 6.5；部分环境没加入时走详情的问题行。
3. 指纹按钮文字「指纹一致，继续」；次按钮「返回修改」。
4. 成功后出提示条「<名称>已添加，并同步给 N 个目录」，新行短暂高亮（中性色）。现在两样都没有。
5. 过程页忙碌时主按钮不再带长阶段说明（阶段已经在步骤列表里）。

**3. 云平台向导与编辑连接**

1. 云平台 / GitHub 向导同样去掉底部两行，换成同一句说明。
2. GitHub 向导账号都已接入时，不再显示「至少一个运行环境就绪后，才能拉取账号下的资源」。
3. 向导文案：「运行环境检查（仅检测已启用 Agent 的环境）」「允许 Agent 操作的资源范围（未勾选的不公开）」改成讲结果的说法；OCI 行尾的「同时加为 SSH 服务器」做成看得出能点的样子。
4. 导入的服务器点「编辑」：对话框里只有两个导出开关，标题、按钮和说明要与内容相符（不叫「编辑连接 / 保存连接」，不讲「重新写入 ssh 配置」）。自建服务器的编辑说明也改成讲结果。
5. 深色主题下未选中的复选框、单选框边框加深到看得清（`border-input` 在对话框底色上几乎不可见）。

**4. 设置页（6.8）**

1. 分组改为外观 / 启动与托盘 / 数据 / 危险操作 + 底部折叠的「高级」；删掉「连接」「编译」两个组名和「导出或导入 JSON」占位行。
2. SSH 配置：正常一行；有环境没加入时变问题行 +「加入」，手动说明默认收起。
3. 文案按 6.8 表格逐行替换（自动下载更新、备份、活动日志、停止全部同步、重置、高级里的五行）。重置确认对话框的正文保留完整清单。
4. 「移除全部分发」→「停止全部同步」（按钮、确认框、完成提示、命令面板一并改）。

**5. 活动日志（F-402、6.8）**

1. 不再显示 Agent 操作（`agent-op`），去掉对应筛选；底部加一句指向「动态」的说明。
2. 13 个筛选标签改为「全部类型」「全部资源」两个弹出按钮。
3. 行：图标 + 一句话 + 右对齐成列的时间；失败的行红色。

**6. Agent 页与护栏规则（6.6）**

1. 「内置 66 条」→「拦截 N 类危险操作」（`standardDeny.length + alwaysDeny.length`）。
2. 护栏规则页按 6.6 重排：两组拦截类别在上，放行清单默认收起并分组；`Badge` 胶囊和 `break-all` 换成 Command Chip。
3. 「其余 N 个未检测到」展开为三列网格。
4. 通用目录行的 `⋯` 只有「在文件夹中显示」一项：改成直接的图标按钮或并入别处，不留单项菜单。
5. 文案：运维约定页的「写进 SKILL.md 的「Rules for every server」…」、护栏安装对话框的 `settings.json` / `PreToolUse hook`、停止同步对话框的 `cloudlink-servers`，改成讲结果（技术细节可以收进「了解详情」）。

**7. 详情与探测面板（6.4）**

1. 「更多信息」（标签、云厂商、地域、笔记）和「服务与目录」的「探测结果」做成默认收起的折叠行，副行写摘要。
2. 探测面板：「已更新 3 处，已重新编译」→「已更新 3 处」；失败时不要留半个面板的空白（面板按内容定高或把说明放到垂直居中的位置，实施时给方案）。

**验收门槛：**

- 上面每个画面在 Mock 下截图（顶栏浅色、顶栏深色；760 与 1000 宽），放仓库根目录 `test-results/p7d/`，用 `analyze_image` 检查。
- 只用键盘走完：添加 SSH 服务器（含「加入」和「暂不加入」两条路）、展开设置的「高级」、打开并关闭活动日志。
- `grep` 确认 `copy.ts` 里不再有「授权给」「默认档位」「移除全部分发」「v0.5 提供」「托管副本」这些界面文案；`GrantFields` 无引用后删除。
- `pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm e2e`、`pnpm build` 通过；e2e 用例和门槛截图随界面更新。
- 发版前另需验证（不属于 P7d）：使用当前源码依次运行 `pnpm build:update-test`、`pnpm e2e:update`，并在真实应用中检查托盘的琥珀圆点、档位确认与全部切回只读。更新验收使用独立测试安装身份，流程见 `docs/releases/README.md`。

### P8 v0.2.x 修复与 v0.3 执行通道（L）

**目标：** 按已确认 D1–D16 修复接入与分发体验，实现 F-310，以及 F-110 的按归属自动跟随、仓库关系与 GitHub 护栏规则。

**正式规格（2026-11-13）：** 用户已授权开始 P8。实施依据是 PRD 的 F-106／F-110／F-310、第 6、7、8.2、8.3、8.7 章，PRODUCT.md 与 DESIGN.md；[P8-DESIGN.md](P8-DESIGN.md) 保留设计决策来源。静态原型沿用 `p8-clean-v9`，已补 D13 图标联动提示（`?shared=1`）与 D15 状态文字（`?crossEnv=1`）；不新增「共享目录」行、范围合并弹窗、原位启用弹窗或多余原型场景按钮。

**分两批交付（D16）：** P8a／P8b 先作为 v0.2.x 的独立修复批次，不等执行通道；P8c–P8f 随后作为 v0.3。阶段验收、提交、推送与发布按当前会话授权进行，不能把开工授权等同于发布授权。

**P8a 契约与底层分发修复（v0.2.x）**

1. **名称与别名（D7）：** 名称留空使用不含连接地址的中性名称；新 SSH 别名自动生成、唯一、稳定且不含地址，草稿中改名称／地址／认证方式或返回表单不重新生成。后端校验唯一性；不通过开启连接信息导出或放宽隐私 Lint 绕过编译受阻。已有自定义／导入别名保留，历史疑似地址默认名仅提出修正建议，由用户确认，不批量静默迁移。
2. **父目录与叶子分离（D4）：** `deliver/paths.rs` 允许父级 `skills` 或祖先的 Symlink／Windows Junction，逐级解析（上限 40、防环）为真实父目录；所有后续检查、暂存、交换用真实路径，交换前重解析并比对。真实路径不能与数据根／编译源／`.ssh` 重叠，隔离模式不能越出覆盖根。只有叶子 `cloudlink-servers` 与内部内容继续严格校验 `symlink_metadata`、`FILE_ATTRIBUTE_REPARSE_POINT` 和 `.cloudlink.json` 所有权。父目录悬空、循环或 I/O 错误返回具体路径／写入失败状态，不冒充同名 Skill 冲突。
3. **共用目录（D13）：** 同一环境内按真实父目录分组，一个组一份编译产物、一份副本。资源开关对组内已启用成员同一事务一起生效，返回受影响成员并在既有提示里说明；不做图标与实际不一致的后台并集。首次发现成员选择不一致时先用交集，不静默扩围，在现有副行提示；用户开关一次后对齐。标记增加可选 `agent_keys`，旧单 `agent_key` 属于组内成员时兼容升级。停用其中一个成员不删除仍被其他成员使用的副本；全部不需要时才移除。
4. **WSL（D15）：** 在发行版内解析 Linux 符号链接。链到对应已登记 Windows 目标时仅 Windows 写入，WSL 显示「与 Windows 共用目录，未单独提供」，不误报冲突、不互相覆盖；其他 `/mnt/`、跨发行版或不支持挂载返回明确不可用原因。只在隔离 WSL 根中验证。
5. **真实反馈（D9）：** 区分资源授权、环境列入、编译与实际写入。`saveAsset`、`setDistribute` 返回完整实际发布快照，后者带受影响成员；`setTargetEnabled` 保持返回 `Target`，前端完成后重新读取发布快照再反馈（PRD 7.8）。前端即时写回缓存，只有真实写入成功才提示已同步，部分成功、冲突、未列入与失败如实显示可操作原因。共用目录只算一个实际送达单位，不新增开关确认流程。

**P8b 原生顶栏与详情编辑（v0.2.x）**

1. **原生窗口（D5）：** 正式包与桌面测试配置统一保留系统标题栏；去掉下层自绘窗口按钮、竖线与重复应用名，48px 导航靠左、操作靠右，侧栏不重复显示应用名。启动、主题、跟随系统与激活／失焦同步原生配色；Windows 10 和高对比度回退系统能力，不牺牲原生拖动、缩放、布局与关闭到托盘行为。
2. **当前页编辑（D6）：** 详情以查看为主；更多菜单先「编辑连接」（SSH）、再「编辑资料」。资料含名称、用途、站点、标签、云厂商／地域、笔记、红线、服务与目录的人工标注；连接、权限与采集事实不混入资料保存。`Dialog` 使用 v9 单一 card 底、600px 宽、高度随内容最高 600px，固定标题与统一保存／取消，中部 `ScrollArea`；只有列表型内容保留细边框。脏草稿在同一弹窗底部切换「继续编辑／放弃修改」，不叠弹窗；Esc 回编辑，确认期间不提交，失败保留输入，关闭恢复入口焦点。
3. **快捷改名：** 普通标题无框无常驻铅笔，hover／focus 淡虚线与提示；单击／Enter 进入并选中，Enter 或 blur 提交一次，Esc 取消，IME 组词不提交，拖选不误编辑。只改名不清空验证、不修改别名或信任记录；失败就地保留输入。
4. **命名与空状态：** 新增日常只填名称，默认名提示可见；别名收进高级，可查看、复制、手改。连接过程标题用显示名称。空状态示例为「看看服务器的磁盘还剩多少」，无虚构别名、无复制按钮，不在添加提示追加新示例。

**P8c GitHub（v0.3）**

- owner 与实际登录身份分离，一个个人账号／选定组织一项资源，默认标题仍为 GitHub；多个 GitHub 才用副行小字区分归属。
- 默认自动跟随所选 owner 当前／未来有权访问的仓库（含私有），支持稳定 ID 排除与手动模式；旧手选迁为 manual，不静默扩大。模式切换保留草稿选择，扩围说明当前新增数与未来范围。
- 分页、权限、限流和离线状态明确；失败保留快照、不推断删除，完整核对前不能扩围。详情按需刷新节流 30 秒，手动刷新立即执行；实际操作独立核对身份、稳定 repo ID、owner 与范围。
- 仓库部署关系保留证据、可隐藏／改写／补充，不改变生产标记、档位或 Agent 选择，不泄漏未提供资源与 remote URL 凭据。GitHub 查询、写入、凭据导出、删除与默认分支强推样本覆盖 PRD 8.6／8.7。

**P8d 执行入口与生命周期（v0.3）**

- 复用 console sidecar `cloudlink-guard.exe`，Skill 写经引用的该环境绝对入口，稳定 `assetId` 路由；不让 GUI 接管终端标准流、不要求改 PATH、不读 SQLite／密码库。SSH 单命令字符串；四家 CLI 以固定提供方程序和 argv 执行，`.cmd` shim 单独验证，不拼进 Login Shell、不简单开启 shell 模式。
- CloudLink 运行中（含托盘），生产 SSH 与四家生产 CLI 两档都走通道；查询通过、只读写入拒绝、标准高危／目标明确但解析不了的命令审批，凭据及运行策略修改等红线始终拒绝。保留用户 SSH 别名；hook 只拦可识别生产直连并引导，不重复判定受管 runner。
- `exec` 最多内联等 90 秒审批，之后返回请求 ID，`wait` 继续；到期仍为创建起 5 分钟。退出新调用跳过 CloudLink 检查，但独立入口仍可用；starting／更新交接短等，进程活着但协调器不可达或身份不明拒绝，不能把一次 IPC 失败当退出。
- `runtime.json` 加会话 epoch、PID／创建标识、安装身份、版本、loopback 端点和状态；hook／runner 共用存活判断，不每次启动 PowerShell。正常退出取消未启动审批，不杀已启动独立执行，不重启后续跑。
- 单文件 put／get 仅写不存在的新路径、不覆盖不递归，SFTP batch 引用与本地排他新建验证；审批绑定输入摘要。前台默认 90 秒、显式最长 3600 秒，超时／断线结果不明不自动重试。更新 sidecar 改名旧版再原子写新版，协议兼容上一版、占用失败保留旧版。

**P8e 原审批与诊断（v0.3）**

- 沿用「动态 → 等你确认 → 允许一次／拒绝」卡片（D12），待审批优先于折叠笔记；不新增原因面板、倒计时、第二轮确认或审批页。无法核实 Agent 身份时显示未识别来源。通知只定位、不批准、不泄漏命令。
- 协调器只监听 `127.0.0.1:0`；CLI 只能提交／查自己的请求／取消，允许／拒绝只经 Tauri GUI。许可单次消费、执行前复查策略 revision／资源／环境／身份／输入；过期、退出、切回只读、撤回或换账号使未启动许可作废。已允许未取、执行中、成功、失败、未知分开，不用撤销伪装回滚。
- SSH 诊断只给失败阶段、错误 ID、客户端种类／版本、退出码和白名单安全摘要，未知错误不指向空日志；不输出原始 stderr、连接信息、密码、私钥或探测输出。主机指纹说明是服务器身份并给可信核对渠道。D11 只复制受保护的同一把私钥，不修改原文件权限。

**P8f 真实验收与收敛（v0.3）**

- P8a／P8b 门槛先独立通过并按授权交付：临时父级 Symlink／Junction 正常写入、越出隔离根拒绝、叶子链接与无所有权内容不被覆盖，共用目录标记升级／交集／开关／停用行为正确，WSL 不误报送达；留空名称能编译分发且地址导出检查仍有效。
- 浏览器与真实 Windows 分别覆盖默认／最小尺寸、浅／深色、两种导航、原生首帧与激活／失焦、关闭到托盘、IME／键盘改名、弹窗滚动／失败／防丢／焦点恢复；改资料不影响连接。
- v0.3 规则样本漏放行 0、误拦 0；真实只读查询含管道、docker exec、journalctl、kubectl get 等，不靠全拒绝凑安全。Claude Code 与 Codex 各在隔离环境验证生产操作 → 原审批 → 执行 → 记录；审批超过单次 Agent 时限仍能 `wait` 接上且最多启动一次，退出后新调用检查停止、旧请求不获批、不重启续跑，运行故障不误判退出。
- 所有截图存仓库根 `test-results/p8/`，逐张用 `analyze_image` 检查；验收结果在会话汇报，不另建验收文档。前端 typecheck／lint／Vitest／Mock E2E／build；Rust fmt／clippy／test 按单 job／单测试线程与前端全套串行。真实 Windows／WSL、Agent 与更新交接只用隔离安装身份、临时 HOME 和测试资源，不访问真实 Skills、SSH 配置、CLI 登录态或 OS 凭据库。

---

## 5. v0.1 完成定义

- 第 0 节列出的功能编号全部实现，并且各自的验收标准（AC）全部通过。
- PRD 7.10 的完成定义（DoD）全部满足。
- P5 的手工验收清单全部通过。
- `cargo test`、`pnpm test`、`pnpm e2e`、`pnpm build`、`pnpm tauri build` 全部通过。
- 签名的安装包和 `latest.json` 能发布到 GitHub Releases，已安装的旧版本能在应用内更新到新版本（F-406）。

---

## 6. 风险与应对

| 风险 | 表现 | 应对 |
| :--- | :--- | :--- |
| Base UI 和 Radix 的写法混用 | 生成的代码用了 `asChild`，类型检查报错 | 遵守第 3 节第 3 条；用 shadcn 的 skill 和 MCP，或 `shadcn docs <组件名>` 查写法 |
| react-resizable-panels v4 的尺寸单位 | 面板宽度异常，例如只有 24px | 尺寸一律写成字符串百分比或带 px 的字符串 |
| `wsl.exe` 的输出编码 | 发行版名称乱码 | 按 UTF-16LE 解码，并去掉 NUL 字符 |
| 副本被 Agent 的自动更新或其他程序删除、改动 | 分发了，但 Agent 里看不到或内容不对 | 一律用受管复制；健康检查区分缺失和被改动，一键修复 |
| Codex 更新内容后不生效 | 内容是旧的 | 生效提示里写明「需要重启 Codex」 |
| Agent 自己的沙箱或权限拦下 ssh | 分发成功，但 Agent 执行 `ssh <别名>` 失败，或者每次都要用户批准。Codex 默认的 `workspace-write` 沙箱不允许联网，Windows 原生沙箱也按权限配置限制网络；Claude Code 每条 `ssh` 命令默认都要批准 | P5 实测两家的默认行为（见 P5 清单）。确认会被拦时，在 Agent 页写明各家的放行方法（以实测为准），例如 Codex 的 `[sandbox_workspace_write] network_access = true` |
| 护栏误拦或漏拦 | 巡检命令被拦，或写操作没被拦 | 不少于 200 条的样本集（漏放行 0、误拦 0）；巡检清单与白名单由单元测试绑定；v0.5 起允许自定义白名单 |
| 护栏程序出错时 Claude Code 放行 | 护栏形同虚设，用户却不知道 | 程序只依赖标准库和 serde_json；健康检查定期自检，失败时在 Agent 页标红 |
| 修改 Claude Code 的 `settings.json` | 用户设置被破坏，或与 Claude Code 自己的写入冲突 | 征得同意、先备份、原子写入、保留键顺序；只动自己的条目；文件不是合法 JSON 时不修改 |
| WSL 互操作被关闭 | WSL 中的护栏无法运行 | 安装前检测，状态显示「不可用」并说明原因 |
| 服务器很多时 description 超长 | 后面的服务器没写进描述，不容易触发 | 按 PRD F-201 AC2 截断并给出警告；总览表里仍列出全部服务器 |
| Agent 写笔记要过沙箱或权限确认 | Codex 的沙箱不允许写工作区以外的文件；Claude Code 在默认模式下写工作目录以外的文件也要确认 | 笔记是辅助功能，被拦不影响主流程；用户批准一次即可，在生效提示中说明 |
| ssh 卡在交互输入 | 探测或测试连接一直不返回 | BatchMode（密码方式用 askpass）、超时、可取消，三者缺一不可 |
| 修改用户的 `~/.ssh/config` | 用户的配置被破坏 | 只加一行 Include，先征得同意并备份；原子写入；全部测试在临时 HOME 中进行 |
| 密码泄漏 | 密码出现在命令行、环境变量或日志中 | 只经 askpass 和命名管道传递；日志测试断言不含密码 |
| 不同发行版的探测输出格式不同（Alpine/BusyBox） | 解析失败 | 按段容错；用录制的样例集测试 |
| 依赖主版本漂移 | 执行时的最新版本与文档不一致 | 严格按文档锁定的主版本安装 |
| Windows 上文件被占用 | 发布时交换目录失败 | 重试 3 次；仍然失败就保留旧产物并提示用户 |
| 更新签名私钥丢失或泄漏 | 丢失：已安装的版本再也无法自动更新；泄漏：别人能签出会被接受的安装包 | 私钥和口令只放在本机、密码管理器（另行备份）和仓库的 Actions Secrets（只有签名构建的那一步引用），绝不入库；泄漏或需要换钥时，先用旧私钥签一个内置新公钥的过渡版本 |
| GitHub 在部分网络下访问不稳定 | 检查更新或下载安装包失败 | 检查失败不打扰用户，1 小时后重试；下载失败可以重试；以后可以在 `endpoints` 中按顺序追加镜像地址 |
| 安装更新时有任务在跑 | Windows 上安装开始后应用直接退出，进行中的探测或发布被中断 | 有进行中的测试连接、探测、CLI 检测或发布时返回 `update-busy`，不开始安装；所有文件写入本就是原子的，SQLite 用 WAL |
| 更新时护栏程序正在运行或被替换 | 正在执行的 hook 失败，或护栏停留在旧版本 | hook 调用的是 `~/.cloudlink/bin/` 中的副本，安装目录被替换不影响它；新版启动时按内容比对重新同步（`prepare_guard_binary`），失败只写日志，下次启动或重新安装护栏时再同步 |

---

## 7. 新对话开场提示词

```text
你在 D:\desk\Desktop\cloudlink 中实施 CloudLink v0.1（Windows 优先）。这是 Git 仓库，远端为 https://github.com/Furina-he/cloudlink 。
先按顺序通读：README.md → PRODUCT.md → DESIGN.md → docs/PRD.md（重点是第三到第八章）→ docs/EXECUTION-PLAN.md → docs/CC-SWITCH-EXPERIENCE.md。
然后结合 README 的阶段概述、当前工作区和会话中的最新授权，继续已授权的阶段任务。规则：
1. 阶段结束时逐条运行验收门槛，把命令、结果、截图路径和遗留问题在会话中汇报给我；
   验收记录不写入 README、PRD、执行计划等长期文档，也不新建阶段验收文档。
   阶段推进、git commit 和推送按当前会话中的用户授权执行，已明确授权的动作不重复确认。
2. docs/PRD.md 第七章是硬约束：依赖只能来自白名单；7.3 映射表里已有实现的必须用；
   表里没有的，先给我候选方案，不要擅自引入依赖或自写组件。
3. 遇到 PRD 没有覆盖、并且会影响产品行为的决定，先问我。
4. 不要修改 docs/archive/ 下的文件。
先检查已有实现和工作区改动，避免重复实现或覆盖尚未提交的工作。
真实 Windows/WSL、SSH、云 CLI 与 Agent 联调按 P5 清单执行，缺少真实证据时在会话汇报中保留未验证状态。
所有测试使用隔离目录，不触碰真实用户 Skills、SSH 配置、CLI 登录态或 OS 凭据库。
```
