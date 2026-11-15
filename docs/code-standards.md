# 代码规范

本文整理仓库已有的实现约定与检查边界，不额外建立一套与工具配置冲突的规则。

开发、构建、测试和参与流程统一见[贡献指南](../CONTRIBUTING.md)；颜色、字体、布局和交互视觉规则见[设计系统](design-system.md)；模块职责见[架构概览](architecture.md)。

## 以仓库配置为准

| 范围 | 当前约定 | 来源 |
| --- | --- | --- |
| 应用 TypeScript | 严格模式；检查未使用变量与参数、switch 穿透；使用可擦除类型语法 | [tsconfig.app.json](../tsconfig.app.json) |
| 构建配置 TypeScript | NodeNext 模块解析，单独限定检查范围 | [tsconfig.node.json](../tsconfig.node.json) |
| ESLint | JavaScript、TypeScript、React Hooks 推荐规则，加项目导入限制 | [eslint.config.js](../eslint.config.js) |
| Prettier | LF、双引号、无分号、2 空格缩进、ES5 尾逗号、80 列打印宽度 | [.prettierrc](../.prettierrc) |
| Tailwind 格式化 | 插件读取 `src/index.css`，识别 `cn` 与 `cva` | [.prettierrc](../.prettierrc) |
| Rust | Edition 2024，最低 Rust 版本由清单声明；工作区包含桌面应用与两个 guard crate | [Cargo.toml](../src-tauri/Cargo.toml) |
| Rust 格式化 | `max_width = 120`，其余以 rustfmt 配置和默认行为为准 | [rustfmt.toml](../src-tauri/rustfmt.toml) |

依赖以 [package.json](../package.json)、[Cargo.toml](../src-tauri/Cargo.toml) 及各自锁文件为准。已有能力先复用，不为同一职责再引入另一套库；需要新增依赖时，在变更中说明用途与现有实现不能满足的原因。

## 组件与公共能力复用

业务组件从 `@/components/ui/*` 组合基础控件，从 `@/components/app/*` 复用应用级展示与交互。不要绕过封装直接引入 Base UI 或 Radix primitive；具体例外由 ESLint 文件范围定义。

[components.json](../components.json) 使用 `base-nova`。自定义触发器使用 Base UI 的 `render`，不是 Radix 的 `asChild`。保留控件已有的语义、键盘行为、标签与状态，不用外观相似的普通元素代替。

常见能力沿用已有入口，而不是复制一份实现：

| 能力 | 使用方式 |
| --- | --- |
| 类名组合 | [lib/utils.ts](../src/lib/utils.ts) 的 `cn` |
| 通知与错误提示 | [ui/toast.tsx](../src/components/ui/toast.tsx) 及应用已有反馈模式 |
| 动画 | `motion/react` |
| 主题 | [ThemeProvider](../src/components/theme-provider.tsx) |
| 普通图标 | `lucide-react` |
| Agent / 平台品牌标识 | [AgentMark](../src/components/app/AgentMark.tsx)、[ProviderMark](../src/components/app/ProviderMark.tsx) |
| 时间格式化 | [lib/format.ts](../src/lib/format.ts)，基于 `Intl` |
| Markdown / 代码展示 | `streamdown` / [ui/code-block.tsx](../src/components/ui/code-block.tsx) |
| 拖拽排序 | 现有 `@dnd-kit/core`、`@dnd-kit/sortable` 与业务排序组件 |
| 可调整面板 | [ui/resizable.tsx](../src/components/ui/resizable.tsx)；v4 尺寸显式写为 `"42%"` 或 `"300px"` 等字符串 |

完整的禁用导入与例外见 [eslint.config.js](../eslint.config.js)，这里不复制第二份黑名单。

## 表单与文案

表单沿用 React Hook Form、Zod 和 [schemas.ts](../src/lib/schemas.ts)。使用已有 `Field`、`FieldLabel`、`FieldGroup` 等组件；错误状态同时关联字段说明和控件的 `aria-invalid`。

动态数组必须设置 `useFieldArray({ ..., keyName: "key" })`。React 渲染使用生成的 `field.key`，业务 ID 继续用于保存和排序，避免 RHF 默认 `id` 覆盖领域字段。示例见 [ProfileFields.tsx](../src/features/servers/ProfileFields.tsx)。

- 所有界面文案集中在 [copy.ts](../src/lib/copy.ts)，包括按钮、错误、状态、无障碍标签和托盘文案。
- Rust 面向界面返回错误、lint 或原因 ID 及参数，不返回需要前端再解析的本地化句子。
- 校验与错误展示复用已有映射，不在不同组件里分别翻译同一个错误。
- 展示文案与用户输入、探测结果、生成的 Skill 内容不是同一种数据，不要混为一个文案来源。

## IPC、事件与类型契约

[ipc.ts](../src/lib/ipc.ts) 是 `invoke` 的唯一入口，[events.ts](../src/lib/events.ts) 是 `listen` 的唯一入口。组件和 store 调用类型化封装，不自行注册重复的底层监听。

事件在应用加载前集中订阅，销毁时解除。新增事件应同时更新 Rust 发送端、前端分发和接收 store，包含足够的资源或任务身份，避免旧结果更新当前页面。

更新检测由 Rust 承担；前端即使处于 IPC 封装或 Mock 层，也不能导入 `@tauri-apps/plugin-updater`。

跨语言类型保持三处一致：

1. [Rust model](../src-tauri/src/model/) 定义序列化形状，并通过 `ts-rs` 导出类型。
2. [bindings](../src/bindings/) 提供前端手写契约；[generated](../src/bindings/generated/) 是生成结果，不手工修补。
3. [contract.check.ts](../src/bindings/contract.check.ts) 对手写与生成类型做双向可赋值检查。

修改模型时，同步契约、完整生成结果、相关 Mock 和调用方，再按贡献指南执行类型验证。导出位置由根目录及 [src-tauri 的 Cargo 配置](../src-tauri/.cargo/config.toml) 约束。

注意序列化差异：字段缺失、显式 `null` 和空集合不必然等价；Rust 的 serde/ts-rs 标注应与前端的可选字段和联合类型对应。不要用类型断言掩盖契约不一致。

## 状态与错误处理

业务数据使用 Zustand，导航使用 `useUIStore`。不要再引入另一套路由或远程查询缓存来管理本地 IPC 数据。

[assets.ts](../src/stores/assets.ts) 展示了主要模式：规范化保存资源、按资源串行发送修改、从最新快照构造更新，并在成功后同步编译与分发状态。筛选、排序等派生数据通过选择器计算。

- 表单草稿不等同于已保存资源；成功提示以实际 IPC 结果为依据。
- Agent 选择、资源列入与副本送达分别表达；不要仅切换前端布尔值就宣称同步成功。
- 必须乐观更新时，失败路径恢复之前状态，再按后端返回结果校准。
- 加载状态保留 `idle / loading / ready / error` 等明确区分；面向用户的操作失败通过既有反馈入口呈现。
- `unknown` 拒绝值先经 [toIpcError](../src/lib/ipc.ts) 归一化，再由文案层展示。
- 静默刷新和辅助清理可以采用已有的尽力而为处理，但不能让主操作失败变成成功结果。

Rust 使用 [AppError / Result](../src-tauri/src/error.rs) 传递可恢复错误。面向 IPC 的内部错误隐藏细节；日志也不应包含密码、认证令牌或原始探测输出。

## Rust 并发与系统边界

IPC 入口只负责参数映射和调度，业务顺序放在 [ipc](../src-tauri/src/ipc/) 协调层，具体能力留在领域模块。阻塞文件、数据库与系统调用沿用 `spawn_blocking` 或现有任务 runner，不阻塞异步事件循环。

修改锁、数据库锁和凭据写入锁各有职责。不要在持有全局修改锁或数据库锁时调用可能阻塞的系统凭据库；异步结果提交前保留目标与重置代次检查。

外部进程复用 [proc.rs](../src-tauri/src/proc.rs) 及 SSH、CLI 专用 runner 的超时、取消、输出上限与平台处理。不要为了少写参数拼接代码而把结构化输入变成任意 shell 字符串。

### SSH 与凭据

- [main.rs](../src-tauri/src/main.rs) 的第一条执行语句必须是 askpass 分流，早于单实例、日志和数据库初始化。
- askpass 通过环境标记触发辅助模式；密码本身只能经过本地一次性通道，不进入命令行、环境变量或日志。
- Windows helper 使用相对可执行文件名并设置其所在目录；接受的 broker socket 恢复阻塞模式。复用 [askpass.rs](../src-tauri/src/secret/askpass.rs)，不要移除这些兼容处理。
- SSH 参数在别名前放置 `--`；OpenSSH 路径使用 [fsx::ssh_path](../src-tauri/src/fsx.rs) 的转换，不能直接传 Windows verbatim canonical path。
- 复用已保存密码之前，保留 [saved_password_allowed](../src-tauri/src/ssh/connect.rs) 的目标匹配检查。目标变化不能继续读取旧目标密码。
- 密码使用 [SecretString](../src-tauri/src/secret/mod.rs)；凭据读写通过 [CredentialStore](../src-tauri/src/secret/store.rs)，不要在其他模块直接调用原生凭据 API。

### 文件与所有权

覆盖或删除受管内容前，校验 `.cloudlink.json` 或该子系统的所有权记录，并使用 `symlink_metadata` 检查文件类型。Windows 还要检查 `FILE_ATTRIBUTE_REPARSE_POINT`，不能只判断符号链接。

[fsx.rs](../src-tauri/src/fsx.rs) 提供底层文件操作，不替调用方证明所有权。调用原子写入或删除函数之前，仍需完成对应子系统的路径、标记与内容校验。

Skills 父目录的既有链接由 [deliver/paths.rs](../src-tauri/src/deliver/paths.rs) 专门解析和复核；这个例外不能扩展到 Skill 叶子、内部文件、密钥或应用数据目录。共用目录的写入、撤回和备份应按分发单位处理，不逐个 Agent 重复操作。

用户的 SSH 配置、Agent 设置及非受管文件不属于可整体替换的目录。沿用专用 Include、hook 安装记录和备份恢复流程，保留其他内容；失败时也不能扩大清理范围。

## 测试隔离与最小验证

测试不得读写真实用户的 Skills、SSH 配置、私钥或系统凭据。隔离不是改一个目录名后继续依赖真实用户环境。

- 路径使用 [Paths::isolated_in](../src-tauri/src/paths.rs) 或明确的 `CLOUDLINK_HOME` 夹具根；用户目录和 WSL 根也必须属于测试夹具。存在覆盖时，不得回退真实 `HOME`、`USERPROFILE` 或 `APPDATA`。
- 原生 `OsCredentialStore` 在 `cfg!(test)` 下直接失败。注入内存凭据、模拟系统、CLI runner、事件出口或更新源，不通过改测试开关绕过保护。
- 子进程、安装器及重启后的进程都必须延续隔离配置；清理只针对已确认归测试所有的内容。
- [Vitest](../vitest.config.ts) 只发现 `src/` 下的单元测试，运行于 Node 环境；[Playwright](../playwright.config.ts) 的 `e2e/` 使用 Mock IPC。
- Mock 界面通过不等于真实 SSH、WSL 或安装更新通过。桌面及系统集成验证使用贡献指南对应的隔离流程，并明确记录实际运行了哪一层。
- Rust 检查与完整 Vitest / Playwright 套件串行运行，避免同时争用资源。

每次修改限定一个可说明的目标，复用邻近实现，不顺带格式化或重构无关文件。先选择能验证该行为的最小检查，再按变更范围补充契约、跨模块或平台验证；未执行的检查应如实说明。

涉及安全边界时，除了成功路径，还要覆盖拒绝、取消、过期结果、所有权不符或隔离失败等相关分支。不要把解除保护当作修复测试的方法。

## 提交约定

Git commit 使用 Conventional Commits，**标题和正文都使用英文**，例如 `fix(delivery): preserve shared target ownership`。沟通及工程文档继续使用中文。

提交前的检查、分支和 PR 流程以[贡献指南](../CONTRIBUTING.md)为准，不在这里维护另一份命令清单。
