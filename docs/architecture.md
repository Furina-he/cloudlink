# 架构概览

CloudLink 是 Windows 优先的 Tauri v2 桌面应用。它把服务器连接、云平台 CLI 账号与资源范围整理成统一的 `cloudlink-servers` Skill，并向 Windows 和 WSL 中的 Agent 目录分发受管副本。

本文说明当前源码的职责与数据流，不替代接口定义。开发命令见[贡献指南](../CONTRIBUTING.md)，实现约定见[代码规范](code-standards.md)。

## 分层与源码入口

| 层次 | 职责 | 入口 |
| --- | --- | --- |
| React 界面 | 资源、Agent、动态、设置视图；表单与交互 | [App.tsx](../src/App.tsx)、[features](../src/features/) |
| 前端状态 | Zustand 数据快照、请求状态、视图状态和派生选择器 | [stores](../src/stores/) |
| 桌面边界 | 类型化命令调用、后端事件订阅、Rust IPC 入口 | [ipc.ts](../src/lib/ipc.ts)、[events.ts](../src/lib/events.ts)、[commands.rs](../src-tauri/src/ipc/commands.rs) |
| 后端协调 | 启动、修改串行化、任务生命周期、发布与反馈导入 | [ipc](../src-tauri/src/ipc/) |
| 领域模块 | SSH、探测、CLI 检测、编译、受管分发 | [ssh](../src-tauri/src/ssh/)、[probe](../src-tauri/src/probe/)、[cli](../src-tauri/src/cli/)、[compile](../src-tauri/src/compile/)、[deliver](../src-tauri/src/deliver/) |
| 数据与系统能力 | SQLite、路径、凭据、文件操作、桌面更新 | [db](../src-tauri/src/db/)、[paths.rs](../src-tauri/src/paths.rs)、[secret](../src-tauri/src/secret/)、[fsx.rs](../src-tauri/src/fsx.rs)、[update](../src-tauri/src/update/) |
| 独立 hook | 命令规则判定与本地操作记录 | [guard-rules](../src-tauri/crates/guard-rules/)、[cloudlink-guard](../src-tauri/crates/cloudlink-guard/) |

Rust 的领域模型位于 [model](../src-tauri/src/model/)，前端使用 [bindings](../src/bindings/)。字段、枚举和请求结构以这些文件为准，不在本文维护第二份清单。

## 前端如何接入后端

[main.tsx](../src/main.tsx) 安装主题、动画、提示等 Provider。启用 Mock 模式时，先安装模拟 IPC，再挂载应用；正式桌面模式使用 Tauri 后端。

[BackendGate](../src/components/app/BackendGate.tsx) 等事件订阅全部成功后才挂载应用，避免初次读取触发的事件丢失。订阅失败可重试，卸载或部分订阅失败时会清理已注册的监听器。

- `src/lib/ipc.ts` 是前端调用 `invoke` 的唯一入口。
- `src/lib/events.ts` 统一订阅事件，并把快照或任务结果分派到对应 store。
- `useUIStore` 管理视图切换，不引入路由；业务数据由各领域 store 管理。
- 表单草稿与持久化数据分开。保存后使用后端返回的资源、编译、列入及分发快照更新界面。
- 连接测试和探测先返回任务 ID，随后通过事件交付进度或结果；事件处理必须关联对应任务与资源。

初始化与重试由 [load.ts](../src/stores/load.ts) 协调。窗口重新聚焦时检查副本与 CLI 状态；窗口可见时定期读取护栏和笔记反馈。具体节流与触发条件在 [App.tsx](../src/App.tsx)，不是服务端持续监控。

## Rust 协调层

[lib.rs](../src-tauri/src/lib.rs) 组装 Tauri 插件、后端状态、命令入口及窗口生命周期。

[Backend](../src-tauri/src/ipc/backend.rs) 持有数据库、环境、凭据接口、任务集合、更新服务和事件出口。它负责跨模块顺序，领域模块不直接驱动 React。

- 数据库打开后，其余启动工作在后台完成；[StartupGate](../src-tauri/src/ipc/startup.rs) 约束依赖环境检测和首次对账的操作。
- 首屏需要的只读数据库命令可以提前返回，不必等所有环境检查完成。
- IPC 的阻塞工作通过 `spawn_blocking` 离开异步事件循环。
- 修改锁用于串行化资源变更、发布和反馈导入；数据库锁与修改锁不应跨越可能阻塞的系统凭据调用。
- [jobs.rs](../src-tauri/src/ipc/jobs.rs) 维护连接与探测任务、取消和结果提交；重置代次及目标校验防止旧任务写回已变化的数据。

## 从资源输入到 Skill

### 1. 验证连接或 CLI 环境

服务器支持读取已有 SSH 别名，也支持录入受管连接。

[ssh/connect.rs](../src-tauri/src/ssh/connect.rs) 调用系统 OpenSSH。受管连接测试使用临时配置，导入的别名使用对应环境的用户配置。测试只运行固定的连通性与系统识别命令。

首次遇到主机公钥时返回指纹供用户核对；已知公钥发生变化时，不发送凭据、不执行远端命令，也不自动替换用户记录。私钥在连接前进行格式和权限预检。

“测试成功”不等于“Agent 已可使用”。[列入计算](../src-tauri/src/deliver/inclusion.rs) 还检查运行环境、Agent 选择、认证方式和配置是否实际就绪。受管连接需要相应密钥及 SSH Include；发布对账还检查 OpenSSH 读回结果。只有密码的连接不会直接列入 Skill。

[cli](../src-tauri/src/cli/mod.rs) 通过可注入的 runner 执行固定的只读查询，检测程序、版本、登录账号和可选资源。目录缓存绑定提供方与账号，保存范围时验证来源；安装或登录命令通过明确的界面操作打开终端，不在检测流程中偷偷执行。

### 2. 采集并审阅资源信息

[probe](../src-tauri/src/probe/mod.rs) 通过 SSH 执行仓库中的固定只读脚本，提取系统、服务和监听端口信息。

原始输出不作为持久化事实；解析层先做长度限制、清洗与来源标注。合并层区分可直接更新的探测数据和需要确认的变更，并支持基于快照撤销。缺失或失败的探测段不能直接证明某项服务已消失。

密码转密钥是另一条显式流程：生成受保护的密钥、安装公钥并验证；它不是只读探测的一部分。入口位于 [ipc/jobs.rs](../src-tauri/src/ipc/jobs.rs)，密钥操作位于 [secret](../src-tauri/src/secret/) 和 [ssh](../src-tauri/src/ssh/)。

### 3. 编译并检查输出

[compile::compile](../src-tauri/src/compile/mod.rs) 接收已列入资源、Skill 配置、环境信息和显式时间，生成正文与明细文件，并返回 lint、预算和阻断状态。预览与发布复用同一编译器；相同输入产生相同内容。

渲染与检查分别位于 [render.rs](../src-tauri/src/compile/render.rs) 和 [lint.rs](../src-tauri/src/compile/lint.rs)。检查包括内容预算、资源数据及敏感信息；错误级 lint 阻止新产物发布。

[publication.rs](../src-tauri/src/ipc/publication.rs) 负责串起列入计算、编译、策略更新和分发。编译受阻时可能保留上一份成功产物，但不能借此恢复已撤销的资源、账号范围或导出权限；协调层会比较发布时的授权快照，必要时撤回旧副本。

### 4. 按真实目录分发

每个目标目录接收一个名为 `cloudlink-servers` 的 Skill，而不是每台服务器各写一份 Skill。

[deliver/groups.rs](../src-tauri/src/deliver/groups.rs) 按解析后的真实目录组织分发单位：同环境多个 Agent 共用目录时，只生成、写入和备份一次，再向各目标返回状态。不一致的已有选择先收窄，显式切换会返回受影响的共用成员。

“选择了 Agent”“资源满足列入条件”“副本已送达”是不同状态，界面不能用其中一个代替另一个。目标停用、目录共用、环境不可用和写入失败均由后端快照表达。

[compile/publish.rs](../src-tauri/src/compile/publish.rs) 使用暂存目录、内容哈希和目录交换发布产物；[deliver](../src-tauri/src/deliver/mod.rs) 复制到目标目录，不创建分发软链接。

副本丢失或过期时自动恢复；受管副本被改动时先备份。外来同名 Skill 需要用户明确选择备份并接管。撤销备份后暂停相关目标，防止自动同步立即覆盖恢复的内容。

## Hook 与笔记反馈

### 命令护栏

[guard](../src-tauri/src/guard/mod.rs) 管理 Claude Code 的 `PreToolUse` hook。安装过程检查受管可执行文件与策略、备份设置并保存安装记录；移除只处理自身登记的 hook，保留其他设置。

[cloudlink-guard](../src-tauri/crates/cloudlink-guard/src/main.rs) 是独立进程：读取本地策略和 stdin 中的 Bash 调用，经 [guard-rules](../src-tauri/crates/guard-rules/src/lib.rs) 判定，必要时输出拒绝结果，并记录识别到的操作。它不连接数据库、不读取系统凭据、不发起网络请求，也不代替 Agent 执行命令。

因此，hook 是覆盖范围有限的命令检查，不是操作系统沙箱。操作记录中的允许或拒绝表示调用前的判定，不代表远端命令已成功执行。

[operations](../src-tauri/src/operations/mod.rs) 导入有界的 JSONL 记录，验证资源、环境和时间，并在进入 SQLite 前再次脱敏。[ipc/feedback.rs](../src-tauri/src/ipc/feedback.rs) 发出增量通知，供动态页及资源详情刷新。

### Agent 笔记

编译产物告诉 Agent 将经验写入共享收件箱，而不是直接改写受管 Skill。

[notes](../src-tauri/src/notes/mod.rs) 将收件箱文件绑定到资源，限制读取量，标记敏感信息或可疑指令，并维护可恢复的导入进度。原始笔记不会自动进入 Skill。

用户审阅、编辑并合并后，笔记才写入资源记录并触发重新编译；忽略操作只改变笔记处理状态。

## 桌面更新

更新完全由 [Rust update 模块](../src-tauri/src/update/mod.rs) 调度：根据设置检查版本，后台下载并验证签名，通过 `update://changed` 推送快照。前端不引入 updater 插件，也不维护另一套检查定时器。

用户选择安装后，[ipc/update.rs](../src-tauri/src/ipc/update.rs) 检查连接、探测、CLI、凭据写入、重置及发布是否忙碌，记录更新活动，再交给安装程序。端点、公钥和安装模式来自 [tauri.conf.json](../src-tauri/tauri.conf.json)。

## 存储、凭据与隔离边界

- **资源与产物分离**：SQLite 保存资源、配置、状态和反馈；编译目录保存可重建产物；目标目录保存受管副本。具体路径统一由 [Paths](../src-tauri/src/paths.rs) 提供。
- **密码不进入 Skill**：密码保存在系统凭据库，凭据命名空间与数据目录绑定。内存中的 [SecretString](../src-tauri/src/secret/mod.rs) 释放时清零，调试输出固定脱敏。
- **凭据先核对目标**：复用已保存密码前，校验请求的主机、端口、用户和认证方式仍匹配持久化记录。密码经 [askpass](../src-tauri/src/secret/askpass.rs) 的本地一次性通道交给 SSH，不放入参数、环境变量或日志。
- **受管不等于任意覆盖**：Skill、备份、hook 和生成密钥各有所有权记录。写入或删除前需要检查所有权、文件类型和路径，不能只看到目录名就接管。
- **链接按层处理**：[分发路径解析](../src-tauri/src/deliver/paths.rs) 可解析 Skills 父目录的既有链接，并在写入前复核；Skill 叶子、内部文件及应用数据路径仍检查符号链接和 Windows 重解析点。
- **真实配置保留边界**：用户 SSH 配置、known_hosts 和 Agent 设置不是 CloudLink 的整目录资产。添加 Include、确认主机公钥、安装 hook 等只通过各自的专用流程修改；重置不应把未知文件一起删除。
- **隔离模式没有真实家目录回退**：设置 `CLOUDLINK_HOME` 后，用户目录和 WSL 根使用显式覆盖或隔离默认值；单独设置其余路径覆盖会被拒绝。隔离后端使用模拟系统与 CLI、内存凭据，不注册真实自启动项。
- **测试能力可注入**：环境、CLI runner、凭据、事件和更新源均可替换。原生凭据库在单元测试中直接拒绝访问；隔离桌面的更新源只接受回环测试端点。

这些边界由具体模块及其测试共同维护。修改数据流时，应沿着“验证、持久化、列入、编译、送达、反馈”检查实际结果，而不只确认前端显示成功。
