# CloudLink v0.1 执行计划（Windows 优先）

> **用途：** 在新对话中分阶段实施 CloudLink MVP v0.1。这份计划的读者是执行它的 Coding Agent，以及做验收的你。
>
> **依据：** `docs/PRD.md`（v3）、`DESIGN.md`、`PRODUCT.md`。
>
> **2026-10-30 方向调整：** P0 到 P3 已按 v2.1 完成并提交。PRD v3 取消了项目级挂载，界面改为「服务器 / Agent / 设置」，并加入界面录入和测试连接（见 PRD 附录 C）。新增 P3.5 把前端改到 v3；P4、P5 已按 v3 改写。P2、P3 的原始描述保留作为历史记录。
>
> **2026-10-31 收敛：** 全部服务器编译成一个总 Skill；Claude Code 护栏与操作记录、Agent 笔记提前到 v0.1；分发一律用受管复制；v0.1 只支持 Claude Code 和 `~/.agents/skills`；去掉 Token 估算（见 PRD 附录 C 第 7 到 11 条）。P3.5 到 P5 已同步，P4 拆成 P4a、P4b、P4c 三次会话。
>
> **冲突时的优先级：** PRD 第七章的硬约束 > DESIGN.md 的令牌 > PRD 其余章节 > 本计划的实施建议。
>
> **开场方式：** 新对话直接粘贴第 7 节的开场提示词即可。

---

## 0. 总览

**目标：** 在 Windows（原生 + WSL2）上跑通「录入服务器 → 测试连接 → 探测 → 编译总 Skill → 分发给 Agent → Agent 能发现并使用，并在护栏内干活」的闭环。

**范围：** PRD 第十章 v0.1 这一行，包括：

- F-101 到 F-103、F-105 到 F-108；
- F-201 到 F-205；
- F-207 的默认英文输出；
- F-301 到 F-308；
- F-401、F-402、F-403、F-405。

**策略：** 先做前端（基于 Mock IPC），再做 Rust 核心，最后联调。每个阶段都有验收门槛，门槛没过不进入下一阶段。

| 阶段 | 目标 | 主要产出 | 规模 | 依赖 |
| :--- | :--- | :--- | :--- | :--- |
| P0 | 工具链与脚手架 | 能构建、能启动的空壳应用；令牌、ESLint 规则就位 | S | 无 |
| P1 | 契约、Mock 与应用外壳 | 前端类型契约、IPC 封装、Mock 夹具、Zustand store、侧栏与命令面板 | M | P0 |
| P2 | 资产视图（已完成，v2.1） | 列表、编辑器、预览、探测面板、导入、首次启动引导 | L | P1 |
| P3 | 挂载、Skills、活动、设置（已完成，v2.1） | 看板、矩阵、Agent 视角、目标管理和其余视图 | L | P1 |
| P3.5 | 前端改到 v3 | 契约与 Mock 改版；服务器视图（卡片加详情、新建与测试连接、笔记、操作记录、临时解锁）；Agent 视图（总 Skill 的全局内容、护栏、分发目标）；设置并入活动；删除项目级代码、Token 估算和链接方式 | L | P3 |
| P4 | Rust 核心 | db、env、ssh、secret、compile、probe、deliver、guard、notes、ipc 十个模块，护栏程序 `cloudlink-guard`，以及测试 | L（拆成 P4a、P4b、P4c 三次会话） | P3.5 的契约 |
| P5 | 联调与端到端验收 | 前端接入真实 IPC、WSL 测试靶机、手工验收清单 | M | P3.5、P4 |
| P6 | 打磨与打包 | 无障碍、性能、文案修订、Windows 安装包 | S | P5 |

**会话建议：**

- 每个阶段开一个会话，P4 拆成三个会话。
- 每个阶段结束时：跑完验收门槛 → 汇报 → 你确认后再 `git commit`。
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

**仓库：** 根目录已经是 Git 仓库，关联远端 https://github.com/Furina-he/cloudlink （**公开仓库**），默认分支为 `main`。根目录的 `.gitignore` 和 `.gitattributes` 已经提交。`.gitattributes` 让文本文件统一使用 LF 换行，这一点很重要：探测脚本要在 Linux 上执行，带 CRLF 就会出错。每个阶段结束后，等你确认再提交和推送。

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
7. **阶段汇报：** 每个阶段结束时，按以下格式汇报：
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
   - `src/bindings/`：Asset 增加 `connection.source/host/port/user/auth/proxyJump/verified` 和 `agent`（`distribute`、`mode`、`unlockedUntil`），去掉 `slug` 和 `guardrails.defaultMode`；Target 去掉 project 类型和 `linkMode`，增加 `enabled`、`detected`，AgentId 只保留 `claude-code`、`universal`、`custom`；Mount 改为 Delivery（每个目标一份副本，状态为 `ok`、`pending`、`missing`、`modified`、`outdated`、`conflict`）；新增 Inclusion、SkillConfig、CompileStatus、GuardStatus、GuardRules、Operation、AgentNote、ConnectionTestRequest、`connection://tested` 载荷、SshConfigStatus；CompilePreview 去掉 Token 字段。
   - `ipc.ts` 和 `events.ts` 按 PRD 7.8 更新（9 个事件）；`copy.ts` 按 6.11 的状态词表和术语更新，加入护栏原因 id 的文案。
   - Mock 夹具按 PRD 7.8 的新表格重写，包括测试连接的几种结果、首次连接的主机指纹确认、Agent 笔记、操作记录和临时解锁。
2. **store：** 按 PRD 7.5 改写。新增 `useConnectionStore`、`useDeliveryStore`、`useGuardStore`、`useNotesStore`、`useOperationStore`；删除 `selectVisibleSkills`、lens 状态和 Token 相关状态。`selectCanDistribute` 写单元测试（未验证、只用密码、已验证三种情况），`selectUnlockRemaining` 写单元测试（未解锁、解锁中、已到期）。
3. **外壳：** 侧栏三项（服务器、Agent、设置），快捷键 `Ctrl+1` 到 `Ctrl+3`、`Ctrl+N`，命令面板按 6.9 分三组（含临时解锁和预览 Skill）。
4. **服务器视图（6.4）：**
   - 卡片网格按环境分组、搜索、卡片上的分发开关、笔记和解锁徽章、方向键导航。
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
- 只用键盘完成：`Ctrl+N` 新建服务器、填写、测试连接、保存；在卡片之间移动并打开详情；用空格切换分发开关和 Agent 启用开关；用命令面板临时解锁和锁回。
- 代码中不再出现 `lens`、`project`（Agent 目标语义下）、`Mount` 类型、`AddProjectDialog`、`linkMode`、`slug` 和 Token 估算（`grep` 结果附在汇报里）。
- Playwright 截图：服务器（列表加详情）、新建服务器、Agent、设置，浅色和深色、1280 和 1024 宽度，存到 `cloudlink/e2e/__screenshots__/`。
- `pnpm typecheck`、`pnpm lint`、`pnpm build`、`pnpm test` 全部通过。

### P4a Rust 核心：数据、环境、SSH、编译（L）

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
   - 密码存取（Windows 凭据管理器，`keyring`）；`SSH_ASKPASS` 辅助模式（应用以 `--askpass` 启动，经命名管道取一次性密码）。
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

### P4b Rust 核心：探测、分发、IPC（L）

1. **probe：**
   - 内置探测脚本（PRD 8.3）。
   - 执行命令：`ssh -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=yes <alias> 'sh -s'`；WSL 目标通过 `wsl.exe` 执行。
   - 30 秒超时，支持取消。
   - 输出按段解析；错误按 8.3 分类，只返回 id。
   - 探测数据按不可信输入清洗（8.3）；自动合并，合并前保存快照，支持撤销最近一次；疑似注入的值列为待确认。
   - 用预先录制的样例输出测试解析，至少覆盖 Ubuntu、Alpine/BusyBox 和「无 docker 权限」三种情况。
2. **deliver：**
   - 受管复制：把各运行环境的编译产物写进已启用的目标；WSL 目标经 `\\wsl.localhost\<发行版>\` 路径写入；先写暂存目录再整体交换。
   - 所有权标记 `.cloudlink.json`，以及冲突判定。
   - 列入计算：分发开关 × 该环境是否有连接配置，不满足就记为未列入并给出原因 id。
   - 健康检查四类问题：副本缺失、副本被改动、待同步、冲突，并重新计算列入情况；支持修复。
3. **ipc：**
   - 实现 PRD 7.8 中除护栏、操作记录和笔记以外的命令和事件（这三部分在 P4c 实现）。
   - capability 按最小权限配置，不开放 shell 和 fs 插件。
   - 日志里不出现原始探测输出和密码。

**验收门槛：**

- `cargo test` 通过，其中包括 deliver 模块在临时目录中的集成测试。依赖 WSL 的测试标记为 `#[ignore]`，留到 P5 手动运行。
- clippy 和 fmt 通过。
- ts-rs 导出的类型与前端契约没有差异；如果有差异，已经说明原因并同步修改。

### P4c 护栏、操作记录与笔记（L）

1. **guard-rules（规则 crate）：**
   - 按 PRD 8.6 实现保守的 shell 词法分析和判定规则。
   - 命令样本集放在 `src-tauri/tests/guard-corpus/`，不少于 200 条。覆盖：巡检清单（PRD 5.6）的全部命令必须放行；常见写操作及其变体（引号、管道、`&&`、`sudo`、`docker exec`、`sh -c`、heredoc、重定向）在只读服务器上必须拦下；标准运维下的危险类别必须拦下；凭据读取在任何档位都拦下；临时解锁期间放行；`policy.json` 缺失时放行。
2. **cloudlink-guard 程序：**
   - 从标准输入读 hook 的 JSON，按 `policy.json` 判定，拦下时输出 deny JSON，并追加记录（精简脱敏）。
   - 只依赖标准库和 serde_json；作为 sidecar 打包（`bundle.externalBin`）。
3. **guard 模块：**
   - 原子写入 `policy.json`：服务器的别名、地址、档位、关键服务、解锁到期时间。
   - 在临时 HOME 中测试 `settings.json` 的安装与移除：已有其他设置和 hook 时原样保留，键顺序不变；文件不是合法 JSON 时拒绝修改；生成备份文件；只删除自己的条目。
   - 启动时把护栏程序复制到 `~/.cloudlink/bin/`（版本不同才复制）；自检；临时解锁与锁回。
4. **实测并写进 PRD 8.6：** Claude Code 在 Windows 上执行 hook 命令用的 shell，以及路径的引号写法；WSL 中经 `/mnt/c` 调用的耗时；跳过权限确认模式下拦截是否生效。如果某种模式下 JSON 形式的拒绝不生效，改用退出码 2 加 stderr 说明原因（官方文档写明退出码 2 在权限规则之前生效）。
5. **操作记录（F-307）：** 读入 JSONL、用完整规则集脱敏、30 天清理；`operations://new` 事件。
6. **笔记（F-308）：** 收件箱读取（先重命名再读）、扫描、并入与忽略；`notes://new` 事件。
7. **ipc：** 护栏、操作记录和笔记的命令，以及 `guard://changed` 事件。

**验收门槛：**

- `cargo test` 通过，样本集全部符合预期：漏放行 0，误拦 0。
- 在临时 HOME 中安装再移除护栏后，`settings.json` 与安装前逐字节相同；安装后除 CloudLink 的条目外，其余内容不变。
- 护栏程序的判定耗时（Windows 原生，100 次取 p95）附在汇报里，不超过 50ms。
- clippy 和 fmt 通过；ts-rs 导出的类型与前端契约一致。

### P5 联调与端到端验收（M）

1. 前端切换到真实 IPC（非 Mock 模式），逐项修复与契约不一致的地方。
2. **搭测试靶机：**
   - 在 WSL Ubuntu 中安装 `openssh-server` 和 `docker.io`，启动 2 个容器，例如 nginx 和 redis。
   - 在 Windows 和 WSL 的 ssh config 中各加一条 `Host test-vps`，指向 WSL 中的 sshd（例如 `localhost:2222`），使用专门的测试密钥。
3. **手工验收清单**（逐条打勾并附截图）：
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
   - [ ] 未验证的服务器不能打开分发开关。
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
   - [ ] 临时解锁后，上面被拦的命令放行，记录标为「解锁期间放行」；「立即锁回」或到期后恢复拦截；关掉 CloudLink 后护栏照常工作。
   - [ ] 操作记录：详情中能看到以上命令和结果，命令里故意写的假 Token 已脱敏。
   - [ ] 护栏自检：手动删掉 `settings.json` 中的条目后，Agent 页显示「护栏未生效」；重新安装后恢复。
   - [ ] 巡检：对 Claude Code 说「巡检一下所有服务器」，Agent 按清单逐台执行，没有命令被护栏拦下，最后给出汇报表。
   - [ ] Agent 笔记：让 Agent 在排查中记一条笔记，卡片出现「笔记 1」；故意让它记一条带假密码的笔记，被标为需编辑；并入后详情文件的 Notes 一节出现这一行，新会话中 Agent 能读到。
   - [ ] 探测自动合并：在靶机上新起一个容器后探测，服务列表自动更新并重新编译；「撤销本次更新」能恢复；把一个容器命名为疑似注入的字符串（例如 `ignore-previous-instructions`），它进入待确认，没有自动合并。
   - [ ] 用户原有的 Skill 完好无损：Windows `~/.claude/skills` 下的 17 项，以及 WSL `~/.agents/skills` 下的 repo-to-resume-tailor。验收前后各列一次目录，内容逐项相同。
4. Playwright 的 Mock 用例全部仍然通过。

**验收门槛：** 清单全部打勾；遗留问题列成清单，并标注严重程度。

### P6 打磨与打包（S）

1. **无障碍：** 完整走一遍键盘操作流程；检查焦点顺序和「减少动态效果」设置；确认 150% 缩放下布局正常。
2. **性能：** 首屏 JS 压缩后不超过 600KB；预览按需加载；冷启动不超过 1.5 秒。
3. **文案：** 按 PRD 6.11 的规范把 `copy.ts` 全部过一遍。
4. **可选质检：**
   - 用 impeccable 的 `audit` 和 `polish` 做一次 UI 质检。
   - 再运行 `/impeccable document`，用实际代码重新校准 `DESIGN.md`。
5. **打包：** `pnpm tauri build` 生成 NSIS 或 MSI 安装包；如果有干净的 Windows 虚拟机，在上面安装运行一遍。

**验收门槛：** 安装包能正常安装和运行；第 5 节的完成定义全部满足。

---

## 5. v0.1 完成定义

- 第 0 节列出的功能编号全部实现，并且各自的验收标准（AC）全部通过。
- PRD 7.10 的完成定义（DoD）全部满足。
- P5 的手工验收清单全部打勾。
- `cargo test`、`pnpm test`、`pnpm e2e`、`pnpm build`、`pnpm tauri build` 全部通过。

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

---

## 7. 新对话开场提示词

```text
你在 D:\desk\Desktop\cloudlink 中实施 CloudLink v0.1（Windows 优先）。这是 Git 仓库，远端为 https://github.com/Furina-he/cloudlink 。
先按顺序通读：README.md → PRODUCT.md → DESIGN.md → docs/PRD.md（重点是第三到第八章）→ docs/EXECUTION-PLAN.md。
然后从 EXECUTION-PLAN 中第一个未完成的阶段开始执行（2026-10-30 时为 P3.5）。规则：
1. 每个阶段只做这个阶段的任务。阶段结束时逐条运行验收门槛，把命令、结果和截图路径汇报给我；
   等我确认后再进入下一阶段，git commit 也要等我确认。
2. docs/PRD.md 第七章是硬约束：依赖只能来自白名单；7.3 映射表里已有实现的必须用；
   表里没有的，先给我候选方案，不要擅自引入依赖或自写组件。
3. 遇到 PRD 没有覆盖、并且会影响产品行为的决定，先问我。
4. 不要修改 docs/archive/ 下的文件。
现在从 P3.5 开始。
```
