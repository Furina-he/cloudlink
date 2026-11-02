# CC Switch VPS 模块开发实战经验与 CloudLink 落地指南

> **来源：** `cc-switch` 仓库 `feat/vps-skill-management` 分支（Issue [#7739](https://github.com/farion1231/cc-switch/issues/7739) / PR [#7804](https://github.com/farion1231/cc-switch/pull/7804)，2026-09-29 至 2026-10-02 完成阶段 A–G、本机密码库、一次性客户端密码复用 CLI 及全量门禁，含 120 项 VPS 定向 Rust 测试与 Windows OpenSSH 9.5p1 / Git OpenSSH 9.9p2 真机链路验证）。
>
> **用途：** 在实施 CloudLink 的 **P4（P4a / P4b / P4c Rust 后端）** 与 **P5（联调与端到端验收）** 前必读。本文把我们在 `cc-switch` 中实际踩过并修复的底层坑、安全边界、跨进程/跨平台细节，逐一映射到 CloudLink 的模块设计中。

---

## 一、从 CC Switch VPS 到 CloudLink 的演进对照

| 维度 | CC Switch（VPS 模块） | CloudLink（独立产品 v0.1） | 可直接复用的经验 |
| :--- | :--- | :--- | :--- |
| **定位** | 多工具配置管理器内的全局 VPS 页 | 独立的「服务器 → 编译总 Skill → 分发给 Agent → 护栏与记录」桌面工具 | 服务器卡片直接点选 Agent（`ToggleGroup` + 品牌 Logo）、无第二开关 |
| **Skill 形态** | 每个客户端一份 `cc-switch-vps/SKILL.md` + `clients/<app>.json` 目录 | 每个「运行环境 × Agent」编译一份总 Skill `cloudlink-servers`（含 `SKILL.md`、`references/<别名>.md`、`references/health-check.md`） | 按目标分别编译/投影、不在共享源上原地改写、所有权回执与整树哈希校验 |
| **分发方式** | 复用既有 Auto / Symlink / Copy | **一律受管复制**（`.cloudlink.json` 所有权标记） | 直接规避 Windows 1314 无权限建 symlink 和各 Agent 对链接的兼容缺陷；保留祖先路径重叠检查与 `FILE_ATTRIBUTE_REPARSE_POINT` 防护 |
| **SSH 配置** | 私有 `<data-dir>/vps/ssh_config` | 托管 `~/.ssh/cloudlink.conf`（经用户 `~/.ssh/config` 开头 `Include` 生效）+ 未保存测试时的临时配置 | 字段防注入校验、Windows 路径斜杠规范化、首匹配原则（`Host *` 放末尾、`Include` 放开头）、`HostKeyAlias` 固定 |
| **密码认证** | 系统凭据库（`keyring`）+ 一次性 loopback `SSH_ASKPASS` + `cc-switch vps exec` 密码自动复用入口 | 系统凭据库（`keyring`）+ `SSH_ASKPASS`（用于测试连接、探测和**一键改用密钥登录** `convert_to_key_auth`） | `SSH_ASKPASS` 早期分流、Windows 窄字符路径破损修复、loopback 阻塞模式修复、凭据读取锁释放与目标一致性校验 |
| **安全护栏** | Skill 提示词约束 + CLI 单命令边界 | Skill 内置红线 + Claude Code `PreToolUse` hook（`cloudlink-guard`）+ 30 分钟临时解锁 + 操作记录 + Agent 笔记收件箱 | 原子写与备份回滚、不可信远端输入清洗与防提示词注入、不把同 OS 用户包装成安全沙箱 |

---

## 二、必改项：对照 CloudLink 当前 PRD / 契约发现的 6 个实战暗坑

在 `cc-switch` 真机实测与代码审阅中，以下 6 个问题**全部真实触发过故障或安全漏洞**，且与 CloudLink 当前 `docs/PRD.md` / `docs/EXECUTION-PLAN.md` 的描述直接相关，**在 P4a 编码时必须按以下方案落地**：

### 1. `SSH_ASKPASS` 不能传 `--askpass` 参数（修正 PRD 8.1 / P4a 第 5 项）

- **PRD 现状：** `docs/PRD.md` 8.1 与 `EXECUTION-PLAN.md` P4a 第 5 项写的是「应用自身以 `--askpass` 参数启动」。
- **实测事实：** OpenSSH 调用 `SSH_ASKPASS` 时，会直接把环境变量 `SSH_ASKPASS` 的值当作**单个可执行文件路径**调用，并只追加一个参数（提示文本，如 `root@203.0.113.10's password: `），**不会像 shell 一样拆分 `--askpass` 参数**。如果把 `SSH_ASKPASS` 设成 `"C:\...\cloudlink.exe --askpass"`，OpenSSH 会去找名为 `cloudlink.exe --askpass` 的文件并直接报 `CreateProcess` 失败。
- **正确做法（已在 `cc-switch` 验证）：**
  1. 用**专用标记环境变量**（如 `CLOUDLINK_SSH_ASKPASS=1`）触发辅助模式，而不是命令行 flag。
  2. 同时传入 `SSH_ASKPASS_REQUIRE=force` 和占位的 `DISPLAY=cloudlink-askpass`。
  3. 辅助分支中必须校验：
     - `std::env::var("SSH_ASKPASS_PROMPT").as_deref() != Ok("confirm")`（防止主机密钥确认提示把密码吐出去）；
     - `args().skip(1)` 恰好只有 1 个参数，长度 `<= 1024`，转小写后包含 `"password"` 且去除末尾空白后以 `:` 结尾。

### 2. Windows OpenSSH 9.5p1 的 `SSH_ASKPASS` 非 ASCII 路径破损 Bug

- **实测故障：** 在本机 Windows 自带 OpenSSH `9.5p1` 实测中，只要应用安装路径或用户名包含中文/非 ASCII 字符（例如 `C:\Users\中文名\...`），OpenSSH 通过窄字符 CRT 环境读取 `SSH_ASKPASS` 再按 UTF-8 解释时会损坏路径，`CreateProcess` 直接报 `error 2`（找不到文件）。
- **正确做法（已在 `cc-switch` 验证）：**
  - 保持打包后的主程序文件名为纯 ASCII（`cloudlink.exe`）。
  - 在 Windows 下启动 `ssh.exe` 子进程时，通过 `command.current_dir(exe_parent)` 设置工作目录（Rust 标准库底层直接传宽字符给 `CreateProcessW`，完美支持 Unicode），并把环境变量设为相对 ASCII 路径：
    ```rust
    command
        .current_dir(exe_parent)
        .env("SSH_ASKPASS", format!("./{exe_name}"));
    ```
  - 无需复制临时二进制，也无需修改系统区域编码。

### 3. `main.rs` 必须在 `tauri-plugin-single-instance` 与任何插件前分流

- **致命冲突：** CloudLink 在 PRD 8.1 中引入了 `tauri-plugin-single-instance`。如果 `SSH_ASKPASS` 辅助进程进入 `tauri::Builder`，单实例插件会直接把这次调用拦截并转发给已打开的 GUI 主进程然后退出，导致 OpenSSH 拿不到 stdout 密码！
- **正确做法：**
  - `askpass::dispatch()` **必须是 `fn main()` 的第一行代码**（在日志、SQLite、Tauri Builder 之前）。
  - 一旦检测到 `CLOUDLINK_SSH_ASKPASS` 环境变量存在（哪怕参数格式损坏或连接失败），**必须立即 `std::process::exit(0 或 1)`**，绝不能落入后续的 `tauri::Builder` 打开第二个窗口，且绝不能向 `stderr` 或日志文件输出任何内容（防止泄漏凭据或污染 OpenSSH stderr 解析）。
  - 写一条源码级单测守护 `main.rs` 的第一行调用顺序（参考 `cc-switch` 的 `helper_branch_is_before_all_application_startup`）。

### 4. 编辑服务器时的「凭据目标篡改漏洞」（`PasswordTargetChanged`）

- **契约隐患：** 看 CloudLink 的 `src/bindings/connection.ts`：
  ```ts
  export interface ConnectionTestRequest {
    assetId?: string
    connection: ConnectionInput
    /** 仅密码方式、且凭据库里还没有这台服务器的密码时 */
    password?: string
    envId?: EnvId
  }
  ```
  当用户打开一台已保存密码的生产服务器（`assetId = "ast_1"`，原地址 `203.0.113.10`），在表单里把草稿的 `host` 改成另一台机器（甚至攻击者地址）、`password` 留空（「留空保持已保存密码」），然后点击「测试连接」——如果后端仅凭 `assetId` 去凭据库取出密码并发起连接，**就会把原服务器的真实密码发给新地址！**
- **正确做法（已在 `cc-switch` 第 19 节修复并加回归）：**
  - 当 `req.password` 为空、需要按 `assetId` 读取已保存密码时，后端必须在锁内比对数据库中该 `assetId` 已持久化的 `(host, port, user, auth.method)` 与本次请求的 `req.connection`：
  - **只要 `host`、`port`、`user` 或认证方式任一字段与已保存记录不一致，立即拒绝读取凭据库**，返回明确错误（要求先重新输入密码或保存匹配的目标），绝不将旧目标的密码发往新目标。

### 5. OpenSSH 目标别名后的选项注入（缺少 `--` 分隔符）

- **实测漏洞：** OpenSSH 默认会继续解析目标主机名之后的命令行参数（例如 `ssh hk-edge -V` 会打印本地版本并返回 0，或被注入 `-oProxyCommand=...`）。
- **正确做法：** 所有由程序构造的 `ssh` 参数数组，在传入 `<alias>` 和远端命令前**必须显式加上 `--`**：
  ```rust
  // 正确：-- 之后紧跟 alias 和远端命令
  ["-F", config_path, "-o", "BatchMode=yes", "-T", "--", alias, remote_cmd]
  ```
  这适用于测试连接（F-106）、只读探测（F-103）和公钥安装（F-108 `convert_to_key_auth`）。

### 6. Windows Loopback Socket `accept()` 继承非阻塞模式导致分片失败

- **实测故障：** 在 `SSH_ASKPASS` 主从进程通信中（无论用 `127.0.0.1:0` loopback TCP 还是管道），主进程监听 socket 设为 `set_nonblocking(true)` 以配合 20ms 轮询取消/超时。但在 Windows（及 BSD）上，**`listener.accept()` 返回的子连接会继承非阻塞模式**！此时即使调用了 `set_read_timeout`，一旦 64 字节一次性 token 分片到达，`read_exact` 仍会立即返回 `WouldBlock` 导致认证偶发中断。
- **正确做法：**
  - `accept()` 成功后，第一步显式调用 `connection.set_nonblocking(false)?`，再设置短读写超时（如 20ms–100ms）。
  - 推荐使用 **`127.0.0.1:0` Loopback TCP + 64 字节随机 Hex 一次性 Capability Token（常时间异或比对）**：既无需编写 Windows 命名管道复杂的 DACL 安全描述符，又能在 v0.5 macOS / v1.0 Linux 上 100% 零改动复用。
  - 密码装在 `Option<Arc<SecretString>>` 中，首次验证 token 后立即 `.take()` 消费，取消或超时时也立即 `.take()` 销毁；由主轮询循环驱动 `broker.poll()`，不启动后台常驻监听线程。

---

## 三、P4 各模块实现细则与防坑清单

### 3.1 `secret` 模块（系统凭据库与密码安全）

1. **内存零化与防日志泄漏：**
   - 使用 `zeroize::Zeroizing<String>` 封装 `SecretString`，手动实现 `fmt::Debug` 固定输出 `"[REDACTED]"`，不实现 `Serialize` / `Display`。
   - 密码合法性校验：非空、`<= 4096` 字节、不含 `\0` / `\r` / `\n`（因为 `SSH_ASKPASS` 按单行传输；**严禁对用户密码做 `.trim()`**，以防密码首尾本来就有空格）。
2. **测试硬隔离（防止单元测试污染或误删真实凭据）：**
   - 抽出 `pub trait CredentialStore: Send + Sync { fn get(...); fn set(...); fn delete(...); }`。
   - 在 `OsCredentialStore::entry()` 开头加上硬门禁：
     ```rust
     if cfg!(test) {
         bail!("Native credential storage is disabled in unit tests; inject a mock");
     }
     ```
   - 凭据库的 service/namespace 中拼入规范化后的 `CLOUDLINK_HOME` 目录哈希（如 `cloudlink.password.v1.<sha256(canonical_home)>`），确保验收环境、开发环境与日常环境的凭据天然隔离。
3. **释放状态锁后再调 OS 凭据库：**
   - OS 钥匙串/凭据管理器调用可能因系统弹窗或服务响应慢而阻塞。**绝不能在持有全局状态锁/数据库事务锁期间调用 `keyring`**，否则用户点击「取消测试」时会导致整个后端死锁。
4. **不可变 Revision 或先写后换：**
   - 替换密码或删除服务器时，不要在数据库事务提交前直接覆盖凭据库中正在使用的旧密码；用不可变 revision UUID（或待清理回执）保证保存中途失败时旧密码不丢失。

### 3.2 `ssh` 与 `probe` 模块（子进程、路径与配置生成）

1. **避免管道读取死锁与黑框闪烁：**
   - **黑框闪烁：** Windows 下衍生 `ssh.exe`、`ssh-keyscan.exe`、`ssh-keygen.exe`、`wsl.exe` 时，必须加 `command.creation_flags(0x08000000)`（`CREATE_NO_WINDOW`）。
   - **子进程残留与管道死锁：** 当 `ssh` 派生了孙进程或超时被 `kill()` 时，标准库 `wait_with_output()` 的管道读取线程在 Windows 上可能因为句柄被孙进程继承而永久挂起。
   - **解决方案（已在 `cc-switch` 验证）：**
     - 用 `ReapedChild(Child)` 包装子进程，在 `Drop` 中无条件执行 `let _ = self.0.kill(); let _ = self.0.wait();`；
     - 对于有限输出的探测/测试命令，将 `stdout` / `stderr` 重定向到 `tempfile::tempfile()` 匿名临时文件，主循环每 20ms 检查 `cancelled`、`deadline`、`broker.poll()`、文件大小上限（如 `MAX_OUTPUT = 64 KiB` 防输出炸弹）和 `child.try_wait()`。
2. **Windows `canonicalize()` 的 `\\?\` 前缀陷阱：**
   - `std::fs::canonicalize` 在 Windows 上会返回 `\\?\C:\Users\...` 扩展长度路径前缀。**OpenSSH（尤其是 `-F`、`IdentityFile`、`UserKnownHostsFile`）以及部分 WSL 路径工具不认 `\\?\` 前缀**！
   - 规则：`canonicalize()` 只用于内部路径等价性/重叠性判断；写进 `cloudlink.conf` 或传给 `ssh` 命令行的路径保持原生写法，并在 Windows 下将引号内的 `\` 统一替换为 `/`（避免 OpenSSH 把 `\` 当转义符）。
3. **严防 `ssh_config` 指令注入：**
   - 所有拼入 `cloudlink.conf` 或临时 `ssh_config` 的字段（`sshAlias`、`host`、`user`、`port`、`identityFile`、`proxyJump`）必须经过严格校验：
     - 禁止任何控制字符（含 `\r`、`\n`、`\0`）；
     - `sshAlias`、`host`、`user`、`proxyJump` 禁止空白字符和开头的 `-`；
     - `identityFile` 必须为绝对路径，禁止 `Component::ParentDir`（`..`），禁止 `"`、`%`（OpenSSH token 展开）、`$`（环境变量展开）。
4. **未保存草稿的隔离测试配置（F-106）：**
   - 测试连接使用 `-F <临时配置>` 时，临时配置末尾应附带收敛的 `Host *` 块：
     - 显式指定 `GlobalKnownHostsFile none`、`PermitLocalCommand no`、`ControlMaster no`、`ControlPath none`、`UpdateHostKeys no`、`VerifyHostKeyDNS no`、`CheckHostIP no`、`ForwardX11 no`、`ClearAllForwardings yes`、`RequestTTY no`、`ConnectTimeout 10`、`ConnectionAttempts 1`；
     - 使用 `HostKeyAlias <alias>`，这样即使服务器使用非默认端口（如 `2222`），`known_hosts` 中的主机键也不会因 `[host]:2222` 与 `host` 格式差异而对不上；
     - 私钥认证时显式加 `IdentitiesOnly yes`，密码认证时显式加 `PubkeyAuthentication no`、`IdentityAgent none`、`IdentityFile none`，避免 ssh-agent 里无关密钥耗尽服务器的 `MaxAuthTries`。
5. **主机密钥扫描不等于信任：**
   - `ssh-keyscan` 只用于首次连接前获取未验证公钥并计算 `SHA256:...` 指纹展示给用户；
   - 待确认的 `testId` 需绑定 `(host, port, public_key)` 并设置有效期（如 5 分钟）与单次消费限制；取消测试、窗口关闭或确认失败时立即作废该 token，要求重新发起测试。

### 3.3 `compile` 与 `deliver` 模块（所有权、重解析点与恢复）

1. **Windows 重解析点（Symlink / Junction）安全检查：**
   - CloudLink v3 已决定分发一律用受管复制，但外部环境或用户可能在 `~/.claude/skills/cloudlink-servers` 或内部目录放置符号链接/Junction。
   - 在覆盖或删除任何目录/文件前，先用 `fs::symlink_metadata` 检查，并在 Windows 上额外检查 `FILE_ATTRIBUTE_REPARSE_POINT`（`0x400`）：
     ```rust
     pub fn is_link(metadata: &fs::Metadata) -> bool {
         #[cfg(windows)]
         {
             use std::os::windows::fs::MetadataExt;
             if metadata.file_attributes() & 0x0400 != 0 {
                 return true;
             }
         }
         metadata.file_type().is_symlink()
     }
     ```
   - 凡是目标目录本身或内部文件为链接/重解析点，一律判定为 `conflict` 或 `modified`，**绝不跟随链接递归删除或覆写目标目录之外的用户文件**。
2. **自定义目标目录（`addCustomTarget`）的祖先路径重叠检查：**
   - 在 `cc-switch` PR #7804 评审中发现：如果只对已存在的目标目录做 `canonicalize`，当目标父目录尚不存在或路径中某一级祖先是目录别名/软链接时，简单的词法比较会漏判目录嵌套（例如用户把自定义目标填成 `~/.cloudlink/compiled` 的子目录，或两个目标互相包含）。
   - **正确做法：** 从目标路径向父目录向上遍历，找到**最近一个已存在的祖先目录**执行 `canonicalize()`，再把剩余相对后缀拼回，用来检查：
     - 自定义目标不得与 `~/.cloudlink` 数据根、`~/.ssh` 或其他已登记的目标目录相等或互相包含（`left.starts_with(right) || right.starts_with(left)`）。
3. **整树内容哈希（区分 `ok` / `modified` / `outdated` / `conflict`）：**
   - 检查已分发副本时：
     - 目录不存在 → `missing`；
     - 目录存在但无 `.cloudlink.json`（或 `.cloudlink.json` 非本软件合法格式）→ `conflict`（严禁覆盖）；
     - 递归遍历目录内除 `.cloudlink.json` 外的全部条目，若包含任何非普通文件/链接、或计算出的确定性目录树哈希（相对路径 + 文件内容）与 `.cloudlink.json` 记录的 `contentHash` 不一致 → `modified`（修复前必须提示用户会覆盖改动）；
     - 副本自身哈希与 `.cloudlink.json` 一致，但与当前最新编译产物的 `contentHash` 不一致 → `outdated`（「待同步」）。
4. **数据库与多文件同步的非事务收敛：**
   - SQLite 写入与多个目标目录的复制不是同一个原子事务。
   - 若服务器保存成功但某个目标同步失败，后端不得吞掉状态，前端也不得依赖乐观缓存掩盖失败：保存接口返回的最新 `CompileStatus` / `Delivery` 状态必须立即写回 store；启动和「检查全部」执行幂等重算与同步。

### 3.4 备选参考：若未来需要「Agent 免改密钥直接使用密码主机」

CloudLink v0.1 当前采用的是 **「密码仅用于测试/探测 + 一键生成 ed25519 并追加 `authorized_keys` 改用密钥登录（F-108）」**。这一方案让 Agent 直接执行标准 `ssh <alias>`，与 `cloudlink-guard` 的 `ssh` 命令解析天然契合，**v0.1 应坚持该方案**。

如果后续版本遇到「服务器禁止公钥登录、只能用密码，但仍想让 Agent 调用」的场景，可以直接复用我们在 `cc-switch` 第 21 节验证通过的方案：
- 提供早期分流的单命令入口 `cloudlink.exe exec --env <env> --agent <agent> --server <id> -- <remote_cmd>`；
- 在 Windows GUI subsystem 下，通过 `AttachConsole(ATTACH_PARENT_PROCESS)` 附加父终端，并在 `AttachConsole` 前先用 `GetFileType` 保存已被重定向的 `FILE_TYPE_PIPE` / `FILE_TYPE_DISK` 标准句柄，结束后用 `SetStdHandle` 恢复（实测 2MB 二进制 stdout/stdin 与 128KB stderr 逐字节无损转发，无弹窗闪烁）。

---

## 四、本工作站（Windows 11 + WSL2，16 GiB 内存）开发与测试硬规约

在开发 `cc-switch` 期间，我们在同一台机器上踩过以下环境级问题，在 CloudLink 的 P3.5–P6 中必须遵守：

1. **测试目录零回退（最高优先级）：**
   - 本机的 `~/.claude/skills` 下有 17 个日常 Skill，WSL 的 `~/.agents/skills` 下也有真实 Skill。
   - 在 `cc-switch` 阶段 A 和阶段 C 中，曾因「临时目录缺少数据库时回退到 `HOME`」和「未覆盖 `%LOCALAPPDATA%`」导致测试差点触碰真实目录。
   - **硬规则：** 当设置了 `CLOUDLINK_HOME`（或测试配置根）时，路径解析函数**绝对禁止任何向真实 `USERPROFILE` / `HOME` / `APPDATA` 的回退分支**。必须专门写一条单元测试：用两个临时目录验证设置 `CLOUDLINK_HOME` 后绝不读取真实家目录。
2. **内存与页面文件保护（避免 `os error 1455`）：**
   - 本机为 16 GiB 内存环境。**严禁同时并行运行前端全量测试（Vitest / Playwright）与 Rust 编译/测试（`cargo test` / `cargo clippy`）**。
   - 执行 Rust 重型命令时使用单 job / 单测试线程：
     ```bash
     cargo clippy --locked --jobs 1 --manifest-path cloudlink/src-tauri/Cargo.toml --all-targets -- -D warnings
     cargo test --locked --jobs 1 --manifest-path cloudlink/src-tauri/Cargo.toml -- --test-threads=1
     ```
   - 若频繁重编译导致增量缓存膨胀，可临时加 `CARGO_INCREMENTAL=0`。
3. **Windows 符号链接权限（Error 1314）：**
   - 本机未开启 Windows Developer Mode，非管理员进程调用 `std::os::windows::fs::symlink_dir` 会报 `os error 1314`。
   - CloudLink 生产代码已改用受管复制；若在 `deliver` 单元测试中需要构造重解析点来测试「拒绝覆盖/跟随链接」，使用测试专用的 junction helper（通过 `cmd.exe /D /V:OFF` 读取环境变量路径执行 `mklink /J`，仅在 `1314` 时回退），不要改系统权限或提权运行 Agent。
4. **本地真机 SSH 闭环验证（无需连接生产服务器）：**
   - 除了 P5 的 WSL `sshd` 靶机外，可以用仅监听 `127.0.0.1:0` 的本地 SSH 协议夹具（如 Python `paramiko` ServerInterface，只响应固定探测命令，不执行任意 shell）分别驱动：
     - `C:\Windows\System32\OpenSSH\ssh.exe`（9.5p1）
     - Git for Windows 的 `usr\bin\ssh.exe`（9.9p2）
   - 在服务端握手日志中核对客户端版本字符串，确保两套 SSH 客户端、空格与中文目录、`SSH_ASKPASS` 密码传递、主机密钥变更阻断、超时与取消回收全部经过真实进程验证。
5. **Playwright 与浮层动画时序：**
   - 验证 `Dialog` / `AlertDialog` / `Sheet` 的 `Escape` 关闭和焦点恢复时，先等待浮层入场动画稳定（或检查 `data-open` 状态）再发送按键，避免动画中途按键丢失造成假阴性；同时确保启用 `MotionConfig reducedMotion="user"`。
