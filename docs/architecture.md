# 架构概览

CloudLink 是 Windows 优先的 Tauri v2 桌面应用。它把服务器连接、云平台 CLI 账号与资源范围整理成统一的 `cloudlink-servers` Skill，并向 Windows 和 WSL 中的 Agent 目录分发受管副本。

本文说明当前开发源码的职责与数据流，不替代接口定义。其中执行通道、审批与 GitHub 按归属范围属于 v0.3 候选实现，不是 v0.2.0 已发布能力；发行版以[发布说明](releases/)为准。开发命令见[贡献指南](../CONTRIBUTING.md)，实现约定见[代码规范](code-standards.md)。

## 分层与源码入口

| 层次 | 职责 | 入口 |
| --- | --- | --- |
| React 界面 | 资源、Agent、动态、设置视图；表单与交互 | [App.tsx](../src/App.tsx)、[features](../src/features/) |
| 前端状态 | Zustand 数据快照、请求状态、视图状态和派生选择器 | [stores](../src/stores/) |
| 桌面边界 | 类型化命令调用、后端事件订阅、Rust IPC 入口 | [ipc.ts](../src/lib/ipc.ts)、[events.ts](../src/lib/events.ts)、[commands.rs](../src-tauri/src/ipc/commands.rs) |
| 后端协调 | 启动、修改串行化、任务与审批、私有路由、发布及反馈导入 | [ipc](../src-tauri/src/ipc/) |
| 领域模块 | SSH、探测、CLI 检测、编译、受管分发 | [ssh](../src-tauri/src/ssh/)、[probe](../src-tauri/src/probe/)、[cli](../src-tauri/src/cli/)、[compile](../src-tauri/src/compile/)、[deliver](../src-tauri/src/deliver/) |
| 数据与系统能力 | SQLite、路径、凭据、文件操作、桌面更新 | [db](../src-tauri/src/db/)、[paths.rs](../src-tauri/src/paths.rs)、[secret](../src-tauri/src/secret/)、[fsx.rs](../src-tauri/src/fsx.rs)、[update](../src-tauri/src/update/) |
| Console sidecar | 兼容 hook，并提供命令、等待和单文件传输入口 | [cloudlink-guard](../src-tauri/crates/cloudlink-guard/) |
| 共享运行边界 | 规则、运行身份、路由读取和有界本地协议 | [guard-rules](../src-tauri/crates/guard-rules/) |

Rust 的领域模型位于 [model](../src-tauri/src/model/)，前端使用 [bindings](../src/bindings/)。字段、枚举和请求结构以这些文件为准，不在本文维护第二份清单。

## 前端如何接入后端

[main.tsx](../src/main.tsx) 安装主题、动画、提示等 Provider。启用 Mock 模式时，先安装模拟 IPC，再挂载应用；正式桌面模式使用 Tauri 后端。

[BackendGate](../src/components/app/BackendGate.tsx) 等事件订阅全部成功后才挂载应用，避免初次读取触发的事件丢失。订阅失败可重试，卸载或部分订阅失败时会清理已注册的监听器。

- `src/lib/ipc.ts` 是前端调用 `invoke` 的唯一入口。
- `src/lib/events.ts` 统一订阅事件，并把快照或任务结果分派到对应 store。
- `useUIStore` 管理视图切换，不引入路由；业务数据由各领域 store 管理。
- 表单草稿与持久化数据分开。保存后使用后端返回的资源、编译、列入及分发快照更新界面。
- 连接测试和探测先返回任务 ID，随后通过事件交付进度或结果；事件处理必须关联对应任务与资源。
- 执行审批通过 `execution://changed` 和 `runtime://changed` 更新；[execution store](../src/stores/execution.ts) 用会话 epoch 与 revision 拒绝旧状态，审批动作失败只刷新状态，不重发执行。

初始化与重试由 [load.ts](../src/stores/load.ts) 协调。窗口重新聚焦时检查副本与 CLI 状态；窗口可见时定期读取护栏和笔记反馈。具体节流与触发条件在 [App.tsx](../src/App.tsx)，不是服务端持续监控。

## Rust 协调层

[lib.rs](../src-tauri/src/lib.rs) 组装 Tauri 插件、后端状态、命令入口及窗口生命周期。

[Backend](../src-tauri/src/ipc/backend.rs) 持有数据库、环境、凭据接口、任务集合、执行协调器、更新服务和事件出口。它负责跨模块顺序，领域模块不直接驱动 React。运行身份在插件和后端初始化前先登记为 `starting`，路由就绪后才转为 `active`。

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

[SSH 诊断](../src-tauri/src/ssh/diagnostic.rs) 只投影失败阶段、客户端种类、受限版本字符串、退出码和枚举摘要。远端 stderr 是不可信输入，不直接交给界面或写入诊断契约。

“测试成功”不等于“Agent 已可使用”。[列入计算](../src-tauri/src/deliver/inclusion.rs) 还检查运行环境、Agent 选择、认证方式和配置是否实际就绪。受管连接需要相应密钥及 SSH Include；发布对账还检查 OpenSSH 读回结果。只有密码的连接不会直接列入 Skill。

[cli](../src-tauri/src/cli/mod.rs) 通过可注入的 runner 执行固定的只读查询，检测程序、版本、登录账号和可选资源。目录缓存绑定提供方与账号，保存范围时验证来源；安装或登录命令通过明确的界面操作打开终端，不在检测流程中偷偷执行。

GitHub 将资源归属与登录身份分开：[GithubConfig](../src-tauri/src/model/github.rs) 绑定 host 和稳定 owner ID，各环境另存有效身份与仓库快照。自动模式跟随该归属当前及未来有权访问的仓库，手动模式保留明确选择；排除项使用稳定仓库 ID，不依赖可改名的仓库路径。

[GitHub IPC](../src-tauri/src/ipc/github.rs) 在网络查询后复核 revision 和重置 epoch。不完整或失败的查询保留历史快照，不据此推断删除或扩大范围；扩围需要完整核对。历史手选保留手动模式，归属无法核实则留待确认，不靠旧登录名猜测。执行前的身份与目标预检独立于这份展示快照。

### 2. 采集并审阅资源信息

[probe](../src-tauri/src/probe/mod.rs) 通过 SSH 执行仓库中的固定只读脚本，提取系统、服务和监听端口信息。

原始输出不作为持久化事实；解析层先做长度限制、清洗与来源标注。合并层区分可直接更新的探测数据和需要确认的变更，并支持基于快照撤销。缺失或失败的探测段不能直接证明某项服务已消失。

密码转密钥是另一条显式流程：生成受保护的密钥、安装公钥并验证；它不是只读探测的一部分。入口位于 [ipc/jobs.rs](../src-tauri/src/ipc/jobs.rs)，密钥操作位于 [secret](../src-tauri/src/secret/) 和 [ssh](../src-tauri/src/ssh/)。

### 3. 编译并检查输出

[compile::compile](../src-tauri/src/compile/mod.rs) 接收已列入资源、Skill 配置、环境、runner 入口和显式时间，生成正文与明细文件，并返回 lint、预算和阻断状态。预览与发布复用同一编译器；相同输入产生相同内容。

渲染与检查分别位于 [render.rs](../src-tauri/src/compile/render.rs) 和 [lint.rs](../src-tauri/src/compile/lint.rs)。生产 SSH 与云 CLI 的两种档位都生成基于稳定资源 ID 的受管入口；用户手动 SSH 别名仍保留。检查包括内容预算、资源数据及敏感信息；错误级 lint 阻止新产物发布。

[publication.rs](../src-tauri/src/ipc/publication.rs) 串起列入、策略与路由投影、编译及分发。策略和私有路由不依赖 Skill lint 放行；路由失效会取消未启动请求。编译受阻时可能保留上一份成功产物，但不能恢复已撤销的资源、范围或导出权限，必要时撤回旧副本。

### 4. 按真实目录分发

每个目标目录接收一个名为 `cloudlink-servers` 的 Skill，而不是每台服务器各写一份 Skill。

[deliver/groups.rs](../src-tauri/src/deliver/groups.rs) 按解析后的真实目录组织分发单位：同环境多个 Agent 共用目录时，只生成、写入和备份一次，再向各目标返回状态。不一致的已有选择先收窄，显式切换会返回受影响的共用成员。

“选择了 Agent”“资源满足列入条件”“副本已送达”是不同状态，界面不能用其中一个代替另一个。目标停用、目录共用、环境不可用和写入失败均由后端快照表达。

[compile/publish.rs](../src-tauri/src/compile/publish.rs) 使用暂存目录、内容哈希和目录交换发布产物；[deliver](../src-tauri/src/deliver/mod.rs) 复制到目标目录，不创建分发软链接。

副本丢失或过期时自动恢复；受管副本被改动时先备份。外来同名 Skill 需要用户明确选择备份并接管。撤销备份后暂停相关目标，防止自动同步立即覆盖恢复的内容。

## 执行通道与护栏

[cloudlink-guard](../src-tauri/crates/cloudlink-guard/src/main.rs) 同时承担两种入口：无子命令时兼容 `PreToolUse` hook；`exec / wait / put / get / discover / status` 进入 [runner](../src-tauri/crates/cloudlink-guard/src/runner/mod.rs)。GUI 负责协调与审批，runner 持有终端标准流并启动实际子进程。

Sidecar 不直接读取 SQLite 或原生密码库，但会读取受管运行身份与路由，通过本地协议联系桌面协调器，并调用 SSH、SFTP 或 CLI 访问目标。不能把整个程序理解为只读 policy、完全离线或始终不依赖桌面状态的旧 hook。

### 运行身份与私有路由

[runtime.rs](../src-tauri/crates/guard-rules/src/runtime.rs) 用安装身份、会话 epoch、PID、进程创建标识和每数据根的实例锁核实运行状态。关闭到托盘仍是 `active`；写有 `stopped` 的文件本身不是进程已退出的证明。启动、更新交接会短暂等待；记录损坏、身份不明或存活协调器不可达不能当成退出放行。

[ipc/routes.rs](../src-tauri/src/ipc/routes.rs) 生成私有 manifest 和内容寻址的 SSH 配置快照，绑定资源 ID、环境、程序、账号、策略哈希及 revision。[共享读取层](../src-tauri/crates/guard-rules/src/routes.rs) 检查所有权、哈希、启用状态和路径；这些文件不写入 Skill，也不保存密码或私钥内容。

只有核实应用完全退出后，新请求才可以沿已有有效路由转发而不做 CloudLink 命令检查或审批，并明确报告 `checked: false`。原审批不因退出获准，重启不恢复执行；正常退出取消未启动请求，不主动终止已经启动的独立命令。输入、路由与文件安全校验仍然存在。

### 判定、审批与最多一次消费

[执行规则](../src-tauri/crates/guard-rules/src/execution.rs) 区分查询、普通写入、高危或解析不明操作及不可批准红线。只读档拒绝写入；标准档允许常规操作，高危或解析不明请求进入审批。凭据导出、目标或范围无效、删除仓库、默认或未指定分支强推等不会因为审批而变成可执行。

[协调器](../src-tauri/src/ipc/execution.rs) 保存本会话待处理请求。其 [loopback 协议](../src-tauri/crates/guard-rules/src/protocol.rs) 有版本、帧上限、短读写超时和会话凭证，只暴露提交、领取、取消及状态回报；允许一次或拒绝只能由主窗口的具名 Tauri 命令进入。

- `exec` 内联等待约 90 秒；未获得执行许可时返回 `waiting` 和私有请求票据（退出码 75），调用方用 `wait` 继续同一请求，不能重新提交。
- 审批自请求创建起 5 分钟过期，后续 `wait` 不重置有效期。票据绑定请求与调用方能力，不等于批准，也不应公开分享。
- 领取许可只发生一次；执行前再次核对会话、到期时间、路由与策略 revision。上传还核对输入摘要，GitHub 还重新验证有效身份、稳定仓库与 owner。
- `approved`、`dispatching`、`running` 和最终结果分别记录，子进程创建后才报告运行。断线、超时或结果不明不能自动重试；不承诺跨崩溃的 exactly-once 或远端副作用回滚。
- 前端仅显示脱敏请求，未知调用方不冒认 Agent 品牌。通知只定位到现有审批卡片，不直接批准，也不带原始命令。

### Hook 分工与操作记录

[guard](../src-tauri/src/guard/mod.rs) 仍负责 hook 设置备份、安装记录、策略和受管可执行文件。Hook 分支读取 policy 与 runtime：运行中拦下可识别的生产直连并引导到执行通道；准确识别本安装的 runner 后避免重复判定。非生产直连沿用对应规则，核实完全退出后不继续把调用记录为受检。

这些检查不覆盖任意工具、凭据或未知别名，也不是同一系统用户之间的安全沙箱。原始 argv 与许可只留在必要的会话内存；持久化的是脱敏操作记录，不是可重放任务队列。

[operations](../src-tauri/src/operations/mod.rs) 导入有界记录并再次脱敏。记录区分来源、是否检查、执行状态、请求与会话；旧 hook 的 `allowed` 只是调用前放行，没有退出码不能显示为执行成功。Runner 的 stdout/stderr 与审计分离，有界流式转发，不默认落盘。

### 命令与单文件传输

[runner/process.rs](../src-tauri/crates/cloudlink-guard/src/runner/process.rs) 执行已解析程序与 argv；SSH 使用私有配置、非交互认证、已信任主机校验和别名前的 `--`。WSL 使用路由指定的发行版与互操作入口，任意请求不拼进 Login Shell。Windows npm shim 仅解析已知包入口后直接运行 Node，不解释整份 batch 文件。

[runner/transfer.rs](../src-tauri/crates/cloudlink-guard/src/runner/transfer.rs) 的 `put/get` 仅支持单文件新路径。上传绑定输入摘要并检查远端不存在，但检查与写入之间仍有竞态，不能宣称远端原子排他创建。下载在相邻受保护暂存目录完成后，以排他硬链接发布最终文件，不退回覆盖写入。

不接受不透明 stdin 脚本或 TTY。前台超时默认 90 秒、上限 3600 秒；终止本地进程不证明远端工作已停止。SFTP 路径按专用规则引用，不支持的路径直接报错，不以换工具或跟随链接作为回退。

## Agent 笔记

编译产物告诉 Agent 将经验写入共享收件箱，而不是直接改写受管 Skill。

[notes](../src-tauri/src/notes/mod.rs) 将收件箱文件绑定到资源，限制读取量，标记敏感信息或可疑指令，并维护可恢复的导入进度。原始笔记不会自动进入 Skill。

用户审阅、编辑并合并后，笔记才写入资源记录并触发重新编译；忽略操作只改变笔记处理状态。

## 桌面更新

更新完全由 [Rust update 模块](../src-tauri/src/update/mod.rs) 调度：根据设置检查版本，后台下载并验证签名，通过 `update://changed` 推送快照。前端不引入 updater 插件，也不维护另一套检查定时器。端点、公钥和安装模式来自 [tauri.conf.json](../src-tauri/tauri.conf.json)。

[ipc/update.rs](../src-tauri/src/ipc/update.rs) 保留连接、探测、CLI、凭据写入、重置及发布的忙碌检查；独立执行请求另走交接流程。安装前发布有时限的 `starting` 交接状态并取消未启动审批，避免更新间隙被误判成停止检查；安装失败恢复活动状态，但不恢复已取消的审批。

[受管 sidecar 更新](../src-tauri/src/guard/mod.rs) 先记录并改名旧可执行文件，再原子写入新版；失败尝试恢复，仍占用的旧文件留待后续按所有权记录清理。更新交接不等于批准旧请求或重新执行未知结果。

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
