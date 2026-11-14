# 开发指南

CloudLink 使用 Tauri v2 + Rust 后端，以及 React 19、TypeScript、Vite 和 Tailwind CSS 前端。应用源码位于 `cloudlink/`。

## 环境

与当前 CI 保持一致：

- Windows 10／11 x64、WebView2 Runtime。
- Node.js 22.20 或更新的 22.x 版本，pnpm 10.12.3。
- Rust 1.95.0，`x86_64-pc-windows-msvc` 工具链，安装 rustfmt 和 clippy。
- Visual Studio 2022 Build Tools 的 C++ 工具集及 Windows SDK。
- 系统 OpenSSH。验证 WSL 场景时另需 WSL2；桌面 SSH 靶机需要 WSL 中的 Docker。

## 安装依赖与运行

以下命令均在仓库根目录执行：

```bash
pnpm --dir cloudlink install --frozen-lockfile
```

只开发界面时使用 Mock 模式：

```bash
pnpm --dir cloudlink dev:mock
```

它使用 `.env.mock` 中的 `VITE_MOCK=1` 和演示夹具，不调用真实 Tauri IPC、不连接真实资源。

运行完整桌面应用：

```bash
pnpm --dir cloudlink tauri dev
```

桌面启动会准备护栏 sidecar，并运行前端开发服务器。完整应用会使用本机资源与配置；自动化验证应使用下文的隔离测试入口。

## 检查

前端：

```bash
pnpm --dir cloudlink typecheck
pnpm --dir cloudlink lint
pnpm --dir cloudlink test
pnpm --dir cloudlink e2e
pnpm --dir cloudlink build
```

Rust 检查前先准备 Tauri 所需的护栏 sidecar，尤其是全新检出时：

```bash
pnpm --dir cloudlink build:guard
cargo fmt --check --manifest-path cloudlink/src-tauri/Cargo.toml
cargo clippy --locked --jobs 1 --manifest-path cloudlink/src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --locked --jobs 1 --manifest-path cloudlink/src-tauri/Cargo.toml -- --test-threads=1
```

**在内存有限的开发机上串行运行 Rust 检查，不要与全量 Vitest／Playwright 并发。** Cargo workspace 包含主应用、`guard-rules` 与 `cloudlink-guard`；根目录 `.cargo/config.toml` 确保 ts-rs 更新同一份前端类型。

真实桌面验收：

```bash
pnpm --dir cloudlink build:desktop-test
pnpm --dir cloudlink e2e:desktop
```

桌面测试使用隔离数据目录与 SSH 靶机，不应改动正式安装或真实用户配置。更新安装包验收另见 [发布指南](releases/README.md#本地更新验收)。

## 代码约定

- 依赖以 `cloudlink/package.json`、`cloudlink/src-tauri/Cargo.toml` 及锁文件为准；优先复用已有依赖，新增依赖先与维护者讨论。
- UI 使用 shadcn/ui `base-nova`／Base UI。组合原语使用 `render`，不用 Radix 的 `asChild`。
- `react-resizable-panels` v4 的尺寸使用 `"42%"`、`"300px"` 等字符串。
- `useFieldArray` 必须指定 `keyName: "key"`，避免覆盖领域模型的 `id`。
- 所有界面文案集中在 `cloudlink/src/lib/copy.ts`。Rust 返回错误／原因 ID 和参数，不返回本地化句子。
- 只有 `cloudlink/src/lib/ipc.ts` 可以调用 `invoke`，只有 `cloudlink/src/lib/events.ts` 可以调用 `listen`。
- Rust 模型通过 ts-rs 生成 `cloudlink/src/bindings/generated/`。修改契约时同步前端封装、Mock、store 和测试，并提交生成结果；CI 会检查生成文件是否一致。
- 颜色和主题复用 `cloudlink/src/index.css` 中的令牌。Agent 与云平台品牌资源集中在 `AgentMark`／`ProviderMark`，不用通用图标冒充品牌。
- 文本换行遵循根目录 `.gitattributes`；Linux 探测脚本必须保持 LF。

## 测试与文件安全

这些约束适用于单元测试、桌面测试及开发辅助脚本：

1. **真实配置不可作为测试夹具。** 不读写用户真实的 Skills、SSH 配置、凭据库或正式应用数据。测试注入临时路径与模拟凭据存储。
2. **隔离路径零回退。** 设置 `CLOUDLINK_HOME` 或其他测试覆盖后，不得回退到真实 `HOME`／`USERPROFILE`／`APPDATA`；解析链接后的路径也必须留在隔离根内。
3. **单元测试禁止原生凭据库。** `OsCredentialStore` 在 `cfg!(test)` 下拒绝访问，使用注入的 mock store。
4. **受管文件先验所有权。** 覆盖或删除受管 Skill 前检查 `.cloudlink.json`、`symlink_metadata` 和 Windows `FILE_ATTRIBUTE_REPARSE_POINT`（`0x400`）。不得跟随叶子或内部链接覆盖／递归删除外部内容；父级链接需解析真实目录并重新检查隔离与重叠关系。
5. **临时输出不提交。** `test-results/`、`playwright-report/`、日志、覆盖率、构建缓存和安装包由 `.gitignore` 排除。既有 `cloudlink/e2e/__screenshots__/` 验收截图保留；仅在确实需要更新验收资源时提交其变更。
6. **本机工具不提交。** 项目内安装的 Agent Skills、MCP 配置、工具锁文件与产品设计工作稿留在本地；公共开发约定由本指南维护。

## SSH 与凭据处理

相关改动必须保留以下回归保护：

- `src-tauri/src/main.rs` 的第一条语句分流 `SSH_ASKPASS` 辅助模式，使用 `CLOUDLINK_SSH_ASKPASS=1`，不能等到单实例插件、日志或数据库初始化之后。
- Windows OpenSSH 的 `SSH_ASKPASS` 使用 `./cloudlink.exe`，并将子进程工作目录设为可执行文件父目录，避免非 ASCII 路径损坏。
- `TcpListener::accept()` 返回的连接在 Windows 上显式调用 `set_nonblocking(false)`。
- 所有 SSH 参数数组在目标别名前加 `--`，阻止目标之后的选项注入。
- 复用已保存密码前，比对请求与持久化连接的 `(host, port, user, auth.method)`；目标变化时拒绝读取旧凭据。
- 不把 Windows `\\?\` 规范路径传给 OpenSSH；写入带引号的 SSH 配置路径时将反斜杠转为 `/`。

## 提交与发布

提交前运行与改动相关的检查，不混入本机配置、测试临时产物或无关的截图差异。源码与测试应能从公开仓库检出后构建，不依赖本地安装的 Agent 工具。

版本号、签名、CI 和 GitHub Releases 流程见 [发布指南](releases/README.md)。`docs/archive/` 是只读历史资料，不作为当前开发规格，也不在整理中修改。
