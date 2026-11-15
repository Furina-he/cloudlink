# 贡献指南

欢迎通过问题反馈、文档改进、测试和代码提交参与 CloudLink。本文的命令均在源码仓库根目录执行。

修改前先阅读与任务相关的 [架构说明](docs/architecture.md)、[代码规范](docs/code-standards.md) 和 [设计规范](docs/design-system.md)。这些说明描述当前实现及约束，不要求取得额外的私人研发资料。

## 开发环境

- Windows 10／11 x64 与 WebView2 Runtime。
- Node.js 22.20 或更新的 22.x 版本，pnpm 10.12.3。
- 推荐与 CI 一致的 Rust 1.95.0，MSVC 工具链，安装 rustfmt 和 clippy。
- Visual Studio 2022 Build Tools 的 C++ 工具集及 Windows SDK。
- 系统 OpenSSH；涉及 WSL 场景时还需 WSL2。桌面 SSH 靶机使用 WSL 中的 Docker。

仅开发 Mock 界面时，不需要启动 Rust 后端。

## 安装与运行

```bash
pnpm install --frozen-lockfile
pnpm dev:mock
```

`dev:mock` 使用 `.env.mock` 中的 `VITE_MOCK=1` 和演示夹具，不调用真实 IPC。不要把登录令牌或本机连接信息写入这个公开文件。

完整桌面应用：

```bash
pnpm tauri dev
```

此命令会准备护栏 sidecar 并启动真实后端，应用会使用本机资源与配置。自动化验证不要依赖真实账户、SSH 配置或 Skills，请使用下面的隔离测试入口。

## 检查改动

前端检查：

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm exec playwright install chromium
pnpm e2e
pnpm build
```

Rust 检查前先准备护栏 sidecar。全新检出直接运行 Cargo 时也需要这一步：

```bash
pnpm build:guard
cargo fmt --check --manifest-path src-tauri/Cargo.toml
cargo clippy --locked --jobs 1 --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --locked --jobs 1 --manifest-path src-tauri/Cargo.toml -- --test-threads=1
```

在内存有限的开发机上，Rust 构建与全量 Vitest／Playwright 串行运行。不要同时启动多套重型验收。

Cargo workspace 包含主应用、`guard-rules` 和 `cloudlink-guard`。`cargo test` 会重新导出 `src/bindings/generated/`；契约变化产生的文件需一起提交，不能靠手改生成文件消除差异。

### 真实桌面与更新验收

```bash
pnpm build:desktop-test
pnpm e2e:desktop
```

桌面测试需要可用的 Windows 桌面、WebView2 和测试靶机。它使用隔离路径，不应改动正式安装、真实 Skills 或真实 SSH 配置。

更新安装包验收使用单独的测试产品，命令和前提见 [发布流程](docs/releases/README.md#本地更新验收)。Mock 浏览器测试不能替代原生窗口、SSH、托盘和安装更新的真实验收。

## 测试隔离与产物

- `CLOUDLINK_HOME` 及测试路径覆盖必须留在测试根内，不能回退真实 `HOME`／`USERPROFILE`／`APPDATA`。
- 单元测试注入模拟凭据存储，禁止使用原生系统凭据库。
- 不用生产服务器或真实 Agent Skills 充当测试夹具。
- 测试报告、失败截图、日志、覆盖率和构建缓存不提交。
- 默认输出位于源码根 `test-results/`：Playwright 只清理 `test-results/playwright/`；保留的验收截图、桌面与更新夹具使用它的同级目录，不能放进这个清理目录。
- `e2e/__screenshots__/` 是版本管理中的验收资源，不要与临时截图一起清理，也不要提交无关的图像差异。
- 发生失败时，报告实际命令与结果；没有执行的验收明确标注，不把“应该通过”当作结果。

## 提交与评审

1. 将功能改动、目录迁移、依赖升级等不同目的拆开，不混入无关文件。
2. 补充能覆盖行为变化的测试，运行相关检查。
3. 如果职责、接口、状态或安全边界发生变化，在同一提交或 PR 中更新对应公开文档。
4. PR 说明变化的触发条件、修改前后行为、验证方式和未验证项目。

### Commit message

**所有 Git commit 标题和正文都使用英文**，包括功能、修复、文档、发布和回退提交。采用 Conventional Commits：

```text
fix(delivery): preserve shared targets when disabling one agent

- Keep the managed copy while another target still uses it
- Add regression coverage for shared-directory ownership
```

常用类型包括 `feat`、`fix`、`docs`、`test`、`refactor`、`build`、`ci`、`chore` 和 `revert`。正文解释变化及原因，不只重复标题。现有中文提交不为统一语言而重写历史；界面和文档的中文不受提交语言要求影响。

## 依赖与许可

依赖版本由 `package.json`、Cargo manifest 和锁文件管理；新增依赖先说明必要性，优先使用已有能力。CloudLink 使用 [MIT](LICENSE)，第三方代码、规则和资源保留原许可及声明，不把项目许可当成对第三方材料的重新授权。

版本号、签名和发布步骤见 [发布流程](docs/releases/README.md)。请勿把签名私钥、令牌或测试安装包提交到仓库。
