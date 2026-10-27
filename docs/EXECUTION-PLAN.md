# CloudLink v0.1 执行计划（Windows 优先）

> **用途：** 在新对话中分阶段实施 CloudLink MVP v0.1。这份计划的读者是执行它的 Coding Agent，以及做验收的你。
>
> **依据：** `docs/PRD.md`（v2.1）、`DESIGN.md`、`PRODUCT.md`。
>
> **冲突时的优先级：** PRD 第七章的硬约束 > DESIGN.md 的令牌 > PRD 其余章节 > 本计划的实施建议。
>
> **开场方式：** 新对话直接粘贴第 7 节的开场提示词即可。

---

## 0. 总览

**目标：** 在 Windows（原生 + WSL2）上跑通「导入 ssh config → 探测 → 编译 → 挂载到项目 → Agent 能发现并使用」的闭环。

**范围：** PRD 第十章 v0.1 这一行，包括：

- F-101、F-102、F-103、F-105；
- F-201 到 F-205；
- F-207 的默认英文输出；
- F-301 到 F-307；
- F-401、F-402、F-403、F-405。

**策略：** 先做前端（基于 Mock IPC），再做 Rust 核心，最后联调。每个阶段都有验收门槛，门槛没过不进入下一阶段。

| 阶段 | 目标 | 主要产出 | 规模 | 依赖 |
| :--- | :--- | :--- | :--- | :--- |
| P0 | 工具链与脚手架 | 能构建、能启动的空壳应用；令牌、ESLint 规则就位 | S | 无 |
| P1 | 契约、Mock 与应用外壳 | 前端类型契约、IPC 封装、Mock 夹具、Zustand store、侧栏与命令面板 | M | P0 |
| P2 | 资产视图 | 列表、编辑器、预览、探测面板、导入、首次启动引导 | L | P1 |
| P3 | 挂载、Skills、活动、设置 | 看板、矩阵、Agent 视角、目标管理和其余视图 | L | P1 |
| P4 | Rust 核心 | db、env、ssh、compile、probe、link、ipc 七个模块及测试 | L（建议拆成 P4a、P4b 两次会话） | P1 的契约 |
| P5 | 联调与端到端验收 | 前端接入真实 IPC、WSL 测试靶机、手工验收清单 | M | P2、P3、P4 |
| P6 | 打磨与打包 | 无障碍、性能、文案修订、Windows 安装包 | S | P5 |

**会话建议：**

- 每个阶段开一个会话，P4 拆成两个会话。
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
- 本机已有用户自己的 Skill：Windows 的 `~/.claude/skills` 下有 17 项，WSL 的 `~/.agents/skills` 下有 1 项（repo-to-resume-tailor）。**任何阶段都不能碰它们。** 测试一律在临时目录进行，P5 只往测试项目里挂载。

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

### P4a Rust 核心：数据、环境、SSH、编译（L）

1. **骨架：**
   - 按 PRD 8.1 写好 Cargo 依赖（锁定主版本），搭好模块骨架，用 thiserror 定义错误类型。
   - 用 ts-rs 把类型导出到 `../src/bindings/`，和 P1 手写的契约比对。
2. **db：**
   - rusqlite（bundled、WAL 模式），带迁移和 `schema_version`。
   - 表：资产、目标、挂载、活动、设置。
   - 编写单元测试。
3. **env：**
   - 检测 Windows 和各个 WSL 发行版。注意 `wsl.exe -l -q` 输出的是 UTF-16LE，必须正确解码并去掉 NUL 字符。
   - 获取各环境的 home 目录和 ssh config 路径；用 `wslpath` 做路径换算。
4. **ssh：**
   - 用 ssh2-config 枚举 Host：Windows 的配置直接读取；WSL 的配置通过 `\\wsl.localhost\<distro>\home\<user>\.ssh\config` 读取，并设置 `home_dir`。排除通配 Host。
   - 获取生效值：Windows 用 `ssh.exe -G`，WSL 用 `wsl.exe -d <distro> -- ssh -G`。
5. **compile：**
   - 用 minijinja 渲染英文模板（SKILL.md 和 references）及 description 模板，输出到变体目录 `compiled/<mode>/<slug>/`。
   - 三层 Token 估算（tiktoken-rs，o200k）。
   - 实现 PRD 5.4 的全部 Lint 规则，包括保留名、疑似注入和已关闭导出的字段。
   - 内置 gitleaks 规则集（MIT 许可），并在 `THIRD_PARTY_NOTICES` 中注明。
   - 原子发布：先写暂存目录，再交换目录；失败时重试 3 次。

**验收门槛：**

- `cargo test`、`cargo clippy --all-targets -- -D warnings`、`cargo fmt --check` 全部通过。
- 黄金样例：编译 PRD 3.3 中的示例资产，结果与 `tests/golden/` 中的文件逐字节一致，内容与 PRD 5.2 的英文示例对应。
- 密钥扫描：样本集漏放行数为 0。

### P4b Rust 核心：探测、链接、IPC（L）

1. **probe：**
   - 内置探测脚本（PRD 8.3）。
   - 执行命令：`ssh -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=yes <alias> 'sh -s'`；WSL 目标通过 `wsl.exe` 执行。
   - 30 秒超时，支持取消。
   - 输出按段解析；错误按 8.3 分类，只返回 id。
   - 探测数据按不可信输入清洗（8.3）；生成差异。
   - 用预先录制的样例输出测试解析，至少覆盖 Ubuntu、Alpine/BusyBox 和「无 docker 权限」三种情况。
2. **link：**
   - 受管复制（Windows 原生的默认方式）。
   - WSL 内的符号链接（`wsl.exe ... ln -sfn`）；Junction 作为实验选项。
   - 所有权标记 `.cloudlink.json`，以及冲突判定。
   - 健康检查四类问题：失效、冲突、副本过期、别名缺失；支持修复。
   - 维护 `.git/info/exclude`，路径通过 `git rev-parse --git-path info/exclude` 解析。
3. **ipc：**
   - 实现 PRD 7.8 的全部命令和 5 个事件。
   - capability 按最小权限配置，不开放 shell 和 fs 插件。
   - 日志里不出现原始探测输出。

**验收门槛：**

- `cargo test` 通过，其中包括 link 模块在临时目录中的集成测试。依赖 WSL 的测试标记为 `#[ignore]`，留到 P5 手动运行。
- clippy 和 fmt 通过。
- ts-rs 导出的类型与前端契约没有差异；如果有差异，已经说明原因并同步修改。

### P5 联调与端到端验收（M）

1. 前端切换到真实 IPC（非 Mock 模式），逐项修复与契约不一致的地方。
2. **搭测试靶机：**
   - 在 WSL Ubuntu 中安装 `openssh-server` 和 `docker.io`，启动 2 个容器，例如 nginx 和 redis。
   - 在 Windows 和 WSL 的 ssh config 中各加一条 `Host test-vps`，指向 WSL 中的 sshd（例如 `localhost:2222`），使用专门的测试密钥。
3. **手工验收清单**（逐条打勾并附截图）：
   - [ ] 首次启动引导能检测到 Windows、WSL，以及已安装的 Claude Code 和 Codex。
   - [ ] 从两个运行环境导入 `test-vps`，「来源环境」显示正确。
   - [ ] 探测成功。
   - [ ] 停掉 sshd 后再探测，失败原因分类正确。
   - [ ] 首次连接时，「主机密钥未信任」的提示和建议命令正确。
   - [ ] 编辑资产时，预览、预算和 Lint 实时更新。
   - [ ] 在资产中写入 `password=xxx`，发布被阻断。
   - [ ] 挂载到 Windows 项目（复制模式）和 WSL 项目（符号链接）都成功，`.git/info/exclude` 写入正确。
   - [ ] 在 Claude Code 中能发现并调用这个 Skill：Windows 和 WSL 各验证一次。会话运行中途新建目录时，`/reload-skills` 的提示正确。如果安装了 Codex，也验证一次。
   - [ ] 生产资产挂到全局时出现二次确认；挂上后出现常驻提示。
   - [ ] 全局和项目档位不同的挂载被阻止。
   - [ ] 手动删除一个链接后，健康检查标记为失效，「修复」能恢复。
   - [ ] 在目标位置预先放一个手写的同名目录，被判定为冲突，并且没有被覆盖。
   - [ ] 删除资产时级联卸载，只删除本软件创建的内容。
   - [ ] 两套 ssh 都验证一次（PRD 8.3）：应用探测走 Windows OpenSSH；Claude Code（Git Bash）实际执行 `ssh test-vps` 也能连上。
   - [ ] 用户原有的 Skill 完好无损：Windows `~/.claude/skills` 下的 17 项，以及 WSL `~/.agents/skills` 下的 repo-to-resume-tailor。验收前后各列一次目录，内容逐项相同。
4. Playwright 的 Mock 用例全部仍然通过。

**验收门槛：** 清单全部打勾；遗留问题列成清单，并标注严重程度。

### P6 打磨与打包（S）

1. **无障碍：** 完整走一遍键盘操作流程；检查焦点顺序和「减少动态效果」设置；确认 150% 缩放下布局正常。
2. **性能：** 首屏 JS 压缩后不超过 600KB；预览按需加载；冷启动不超过 1.5 秒。
3. **文案：** 按 PRD 6.13 的规范把 `copy.ts` 全部过一遍。
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
| Claude Code 对链接和 Junction 的发现不稳定 | 挂载了，但 Agent 里看不到 | Windows 原生默认用复制；每个目标可以手动切换；健康检查兜底 |
| Codex 通过链接更新内容后不生效 | 内容是旧的 | 生效提示里写明「需要重启 Codex」 |
| ssh 卡在交互输入 | 探测一直不返回 | BatchMode、超时、可取消，三者缺一不可 |
| 不同发行版的探测输出格式不同（Alpine/BusyBox） | 解析失败 | 按段容错；用录制的样例集测试 |
| 依赖主版本漂移 | 执行时的最新版本与文档不一致 | 严格按文档锁定的主版本安装 |
| Windows 上文件被占用 | 发布时交换目录失败 | 重试 3 次；仍然失败就保留旧产物并提示用户 |

---

## 7. 新对话开场提示词

```text
你在 D:\desk\Desktop\CloudSkill Hub 中实施 CloudLink v0.1（Windows 优先）。这是 Git 仓库，远端为 https://github.com/Furina-he/cloudlink 。
先按顺序通读：README.md → PRODUCT.md → DESIGN.md → docs/PRD.md（重点是第三到第八章）→ docs/EXECUTION-PLAN.md。
然后从 EXECUTION-PLAN 的 P0 开始执行。规则：
1. 每个阶段只做这个阶段的任务。阶段结束时逐条运行验收门槛，把命令、结果和截图路径汇报给我；
   等我确认后再进入下一阶段，git commit 也要等我确认。
2. docs/PRD.md 第七章是硬约束：依赖只能来自白名单；7.3 映射表里已有实现的必须用；
   表里没有的，先给我候选方案，不要擅自引入依赖或自写组件。
3. 遇到 PRD 没有覆盖、并且会影响产品行为的决定，先问我。
4. 不要修改 docs/archive/ 下的文件。
现在从 P0 开始。
```
