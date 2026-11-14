# CloudLink

面向 AI Agent 的服务器与云平台管理工具，Windows 优先。

接入 SSH 服务器和云平台 CLI，把已授权资源整理成一个总 Skill，自动同步给本机 Agent；在支持的命令上用护栏减少误操作，并集中查看操作记录和 Agent 笔记。

[下载安装](https://github.com/Furina-he/cloudlink/releases/latest) · [版本说明](docs/releases/v0.2.0.md) · [开发指南](docs/development.md) · [问题反馈](https://github.com/Furina-he/cloudlink/issues)

## 功能

- **统一管理资源**：SSH 服务器、Cloudflare、Vercel、Oracle Cloud 和 GitHub CLI。
- **让 Agent 直接上手**：生成一个 `cloudlink-servers` Skill，包含资源用途、连接入口、关联关系和运维约定。
- **按目标自动同步**：支持 Claude Code、Codex、Cursor 等 Agent，以及 Windows 和 WSL2 环境；覆盖或接管副本前先备份，支持撤销。
- **减少生产误操作**：只读巡检／标准运维两档，生产资源切换到标准运维前需要确认。
- **记录操作与经验**：查看护栏覆盖的命令记录，确认 Agent 笔记后并入资源资料。
- **桌面常驻**：浅色／深色主题、顶栏／侧栏切换、系统托盘、开机启动和应用内更新。

## 安装

支持 Windows 10／11 x64。

1. 打开 [GitHub Releases](https://github.com/Furina-he/cloudlink/releases/latest)。
2. 下载 `CloudLink_<版本号>_x64-setup.exe`，运行安装程序。
3. 启动 CloudLink，接入第一项资源。

Windows 需要 WebView2 Runtime。SSH 连接使用系统 OpenSSH；云平台使用本机已安装并登录的 `wrangler`、`vercel`、`oci` 或 `gh`。WSL2 仅在使用 WSL 中的 Agent 时需要。

应用内更新会校验更新包签名。发行版功能以 Releases 为准，`main` 分支可能包含尚未发布的改动。

## 开始使用

1. **接入资源**：添加 SSH 服务器，或选择已安装并登录的云平台 CLI。也可以从 `~/.ssh/config` 导入服务器。
2. **验证连接**：核对 SSH 主机指纹，按需允许加入 CloudLink 托管的 SSH 配置；密码接入可自动转换为免密密钥。
3. **选择 Agent**：启用目标 Agent，并在资源行选择要提供给它们的资源。
4. **交给 Agent**：例如让它“检查服务器的磁盘使用情况”。操作生产资源前，先确认当前档位和真实账号权限。

CloudLink 不提供终端，也不替代云平台控制台；它负责把资源背景、连接方式和操作边界交给 Agent。

## 安全边界

- 密码、私钥内容和 API Secret 不写入 Skill。认证由系统 OpenSSH 和本机云平台 CLI 处理。
- 当前命令护栏**仅支持 Claude Code 的 SSH、Cloudflare、Vercel 和 Oracle Cloud 命令**。GitHub 命令及其他 Agent 目前没有强制护栏。
- Skill 中的红线是给 Agent 的指令，不是安全沙箱。护栏用于防误操作，不能替代低权限账号、远端权限或系统隔离。
- 数据保存在本地，不收集遥测；连接验证、资源探测、CLI 查询和更新检查会按需联网。

## 从源码运行

项目使用 Tauri v2、Rust、React、TypeScript 和 Vite。完整环境要求、检查命令与测试隔离约定见 [开发指南](docs/development.md)。

```bash
pnpm --dir cloudlink install --frozen-lockfile
pnpm --dir cloudlink dev:mock
```

`dev:mock` 使用演示数据，只运行浏览器界面，不会连接真实资源。运行完整桌面应用：

```bash
pnpm --dir cloudlink tauri dev
```

仓库结构：

```text
cloudlink/
  src/              React 前端
  src-tauri/        Rust 后端与护栏程序
  e2e/              浏览器端到端测试与验收截图
  e2e-desktop/      桌面测试配置与 SSH 靶机
  scripts/          构建、测试与发布辅助脚本
docs/               开发指南、版本说明与品牌资源
.github/workflows/  CI 与发布流程
```

[发布流程](docs/releases/README.md) · [第三方资源声明](cloudlink/THIRD_PARTY_NOTICES.md)
