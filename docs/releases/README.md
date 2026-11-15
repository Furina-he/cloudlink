# 发布

安装包在 GitHub Actions 上构建、签名并生成 `latest.json`（[`.github/workflows/release.yml`](../../.github/workflows/release.yml)），发布时本机不需要签名私钥。

签名私钥和口令存放在仓库的 Actions Secrets 里（`TAURI_SIGNING_PRIVATE_KEY`、`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`），只有构建签名的那一步引用它们。Secrets 写入后无法再读出，所以原件仍由维护者保管在密码管理器里并另行备份：私钥丢了，已安装的版本就再也无法在应用内更新。

## 发布新版本

1. 改版本号，三处必须一致：`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml`、`package.json`。然后同步 `Cargo.lock`：

   ```bash
   cargo update --workspace --offline --manifest-path src-tauri/Cargo.toml
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

更新验收分为准备、构建、运行三个显式步骤。没有参数时不会自动构建或安装；构建与运行安装器须分别获得授权，并与其他 Rust、Vitest、Playwright 全套检查串行执行。

```bash
node scripts/build-update-test.mjs --prepare
# 按输出路径准备夹具自己的 Rust 工具链与离线依赖缓存，然后分别执行：
node scripts/build-update-test.mjs --build --root "<本次夹具目录>" --rust-bin "<夹具内的 Rust bin>"
node scripts/check-update.mjs --run --root "<本次夹具目录>"
```

每次准备都在源码根 `test-results/p8/update-<runId>/` 新建目录，生成本次独立的测试产品名、应用标识和一次性签名身份。应用、安装器与重启进程只使用该夹具内的 HOME、AppData、临时目录和数据根；不读取真实账户、Skills、SSH 配置或 OS 凭据库，不注册正式产品的快捷方式或系统集成。构建使用已核对哈希的源码快照，不改原源码的版本、sidecar 或配置。

所有文件替换仍须检查本次所有权、哈希和重解析点。验收只回收本次明确启动的进程与容器，保留夹具和证据；它不是正式安装包的系统集成／卸载验收。

移动源码目录后必须重新准备和构建，不能搬用旧包或修改旧夹具标记继续运行：配置、安装器和 `CLOUDLINK_TEST_BUILD_HOME` 都绑定绝对隔离路径。Playwright 只清理 `test-results/playwright/`，不清理同级 `p8/` 下的更新夹具。

测试用的 0.1.0 和 0.1.1 都由当前源码构建，只验证更新、签名拒绝、重启、数据保留和执行请求交接机制；旧数据库迁移与上一协议版本兼容需要另外覆盖。测试签名材料和安装包绝不能发布；正式安装包仍由 GitHub Actions 构建和签名。

## 试运行

在 Actions 页面手动运行 Release 工作流（或者 `gh workflow run release.yml`），它会完整地构建、签名和校验，但不创建 Release。产物在运行页面的 Artifacts 里，保留 7 天。

## CI

推送到 `main` 和每个 PR 都会运行 [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)，检查内容和本机一致：

- 前端：类型检查、ESLint、Vitest、Playwright（Mock 模式）和生产构建。
- Rust：fmt、clippy、测试，以及 ts-rs 生成的类型是否已经提交。

只改了根目录的 Markdown 或 `docs/` 时不运行。
