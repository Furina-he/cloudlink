# 发布

安装包在 GitHub Actions 上构建、签名并生成 `latest.json`（[`.github/workflows/release.yml`](../../.github/workflows/release.yml)），发布时本机不需要签名私钥。

签名私钥和口令存放在仓库的 Actions Secrets 里（`TAURI_SIGNING_PRIVATE_KEY`、`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`），只有构建签名的那一步引用它们。Secrets 写入后无法再读出，所以原件仍由维护者保管在密码管理器里并另行备份：私钥丢了，已安装的版本就再也无法在应用内更新。

## 发布新版本

1. 改版本号，三处必须一致：`cloudlink/src-tauri/tauri.conf.json`、`cloudlink/src-tauri/Cargo.toml`、`cloudlink/package.json`。然后同步 `Cargo.lock`：

   ```bash
   cargo update --workspace --offline --manifest-path cloudlink/src-tauri/Cargo.toml
   ```

2. 写更新说明 `docs/releases/v<版本号>.md`。已安装的 CloudLink 会在更新对话框里按纯文本显示它，所以只写几行，可以用 `- ` 开头的列表，不要用标题、链接和图片。它同时是 GitHub Release 草稿的正文。
3. 提交并推送到 `main`，等 CI 通过。
4. 打标签并推送：

   ```bash
   git tag v<版本号>
   git push origin v<版本号>
   ```

5. Release 工作流同时运行 CI 和签名构建。构建完成后，它像已安装的 CloudLink 一样校验签名（公钥、内容和版本号），再生成 `latest.json`。两者都通过后，它创建一个草稿 Release，附带安装包和 `latest.json`。
6. 在 GitHub 上检查草稿，可以补充安装说明（例如 SmartScreen 提示怎么处理），然后发布。发布之后 `releases/latest/download/latest.json` 才指向新版本，已安装的 CloudLink 才会检测到它。

标签和版本号对不上，或者缺少更新说明，构建会在一开始就失败。工作流失败后可以直接重新运行：草稿已经存在时只替换附件，已经发布的版本不会被改动。

## 本地更新验收

发布前需要验证更新流程时，依次运行 `pnpm --dir cloudlink build:update-test` 和 `pnpm --dir cloudlink e2e:update`。构建与其他 Rust、Vitest、Playwright 全套检查串行执行。

测试安装包使用独立的 `CloudLink Update Test` 产品名、应用标识与发布者，数据目录编译固定在仓库根目录 `test-results/update/` 下；它不会卸载或覆盖本机已安装的正式 CloudLink。脚本会核对安装包身份，并在结束后卸载测试版，比较正式安装、Skills、SSH 配置和注册表的前后快照。

测试用的 0.1.0 和 0.1.1 都由当前源码构建，只验证安装、后台下载、签名拒绝、更新重启和数据保留机制；旧数据库迁移由数据库回归另外覆盖。测试密钥签名的安装包绝不能发布；正式安装包仍由 GitHub Actions 构建和签名。

## 试运行

在 Actions 页面手动运行 Release 工作流（或者 `gh workflow run release.yml`），它会完整地构建、签名和校验，但不创建 Release。产物在运行页面的 Artifacts 里，保留 7 天。

## CI

推送到 `main` 和每个 PR 都会运行 [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)，检查内容和本机一致：

- 前端：类型检查、ESLint、Vitest、Playwright（Mock 模式）和生产构建。
- Rust：fmt、clippy、测试，以及 ts-rs 生成的类型是否已经提交。

只改了根目录的 Markdown 或 `docs/` 时不运行。
