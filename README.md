# CloudLink

面向 AI Agent 的服务器与云平台管理工具，Windows 优先。

把 SSH 服务器和云平台 CLI 接入 CloudLink，选择要提供给哪些 Agent。CloudLink 将资源用途、连接入口、关联关系和运维约定整理成一个总 Skill，自动同步到本机 Agent，并在支持的命令上提供护栏与操作记录。

[下载安装](https://github.com/Furina-he/cloudlink/releases/latest) · [版本说明](docs/releases/) · [参与开发](CONTRIBUTING.md) · [反馈问题](https://github.com/Furina-he/cloudlink/issues)

## 主要功能

- **统一管理资源**：SSH 服务器，以及 Cloudflare、Vercel、Oracle Cloud 和 GitHub CLI。
- **让 Agent 获得准确背景**：生成一个 `cloudlink-servers` Skill，按目标整理已授权的资源与操作约定。
- **独立选择与自动同步**：支持 Windows、WSL2 和自定义 Agent 目标；点谁只改谁的选择，共用目录只提供共同选择的交集，实际送达、部分同步和受阻如实显示。
- **控制操作档位**：确认变更／自动运维两档。查询直接执行；确认变更的变更先问，自动运维只直接执行范围内规则明确的常规变更。生产标记独立，生产启用自动运维需要确认。
- **确认高风险命令**：所有已提供资源统一引导独立执行入口；高危或目标明确但解析不明的操作在「动态」中允许一次或拒绝，红线与目标不明不能审批放行。
- **管理 GitHub 范围**：新接入默认按个人账号或组织自动跟随仓库，也可排除或手动选择；已有手动范围不自动扩大，登录有效与范围核对状态分别显示。
- **积累运维经验**：操作记录区分实际调用来源、检查通道和执行结果；未知来源不猜品牌，自报只作展示。确认 Agent 笔记后可并入资源资料。
- **桌面常驻**：浅色／深色主题、顶栏／侧栏导航、系统托盘、开机启动和应用内更新。

## 安装与开始使用

支持 Windows 10／11 x64，需要 WebView2 Runtime。SSH 使用系统 OpenSSH；云平台功能需要相应 CLI 已安装并登录。使用 WSL 中的 Agent 时，还需要对应的 WSL2 环境。

1. 从 [GitHub Releases](https://github.com/Furina-he/cloudlink/releases/latest) 下载 `CloudLink_<版本号>_x64-setup.exe` 并安装。
2. 添加 SSH 服务器，或选择云平台 CLI；也可以从 `~/.ssh/config` 导入服务器。
3. 按连接流程核对主机指纹及 SSH 配置授权，完成连接验证。
4. 在资源行选择要提供给哪些 Agent，再让 Agent 执行具体任务，例如“检查服务器的磁盘使用情况”。

CloudLink 不提供终端，也不替代云平台控制台。它负责把资源背景和操作边界交给 Agent，真实访问权限仍由远端账号及本机凭据决定。

## 安全边界

- 密码、私钥内容和 API Secret 不写入 Skill；认证交给系统 OpenSSH 和相应 CLI。
- 执行通道检查覆盖经独立入口发起的已提供 SSH 与 Cloudflare、Vercel、Oracle Cloud、GitHub 请求，不按生产标记分流；Claude Code 护栏还会拦截并引导可识别的纳管直连。其他入口、工具或凭据不保证纳管。
- Skill 中的红线是给 Agent 的指令，不是安全沙箱。护栏用于减少误操作，不能替代低权限账号、远端权限控制或系统隔离。
- 数据保存在本地，不收集遥测；连接验证、资源探测、CLI 查询和更新检查会按需联网。

v0.3.1 修订执行模式、独立分发、来源显示和 Windows／WSL 入口，详见 [发布说明](docs/releases/v0.3.1.md)。升级时，原“只读巡检”和“标准运维”均转为“确认变更”；自动运维需要重新选择，不静默提升权限。旧版本的能力以各自发布说明为准。

这些执行通道检查只在 CloudLink 运行中（含托盘）生效；确认彻底退出后，新调用仍可通过独立入口运行，但不再接受 CloudLink 检查或审批。运行状态异常不能当作已退出；旧的未启动审批也不会因退出而获批。它仍不是限制同一系统用户的安全沙箱，详细模块与边界见 [架构说明](docs/architecture.md)。

## 从源码运行

在源码仓库根目录执行：

```bash
pnpm install --frozen-lockfile
pnpm dev:mock
```

Mock 模式使用演示数据，只运行浏览器界面，不调用真实 Tauri IPC。完整桌面开发需要 Rust 和 Windows 构建工具，环境配置及检查命令见 [贡献指南](CONTRIBUTING.md)。

## 工程文档

- [贡献指南](CONTRIBUTING.md)：环境、运行、测试和提交流程。
- [代码规范](docs/code-standards.md)：前端、Rust、类型契约与测试隔离要求。
- [设计规范](docs/design-system.md)：现有视觉、组件与交互约定。
- [架构说明](docs/architecture.md)：模块职责、数据流和安全边界。
- [发布流程](docs/releases/README.md)：版本、签名、CI 与 GitHub Releases。

## 许可证

CloudLink 使用 [MIT 许可证](LICENSE)。第三方材料保留其各自许可，见 [第三方声明](THIRD_PARTY_NOTICES.md)。
