// 云平台 CLI 的固定信息（F-104）：命令是机器读的字符串，界面文案在 copy.ts
import type { CliInfo, CliProvider, CliScopeKind, EnvId } from "@/bindings"

export const CLI_PROVIDERS: CliProvider[] = ["cloudflare", "vercel", "oracle", "github"]

/** 添加对话框的分组（PRD 6.5）：云平台与代码托管 */
export const CLOUD_PROVIDERS: CliProvider[] = ["cloudflare", "vercel", "oracle"]
export const CODE_HOSTS: CliProvider[] = ["github"]

export const CLI_BINARY: Record<CliProvider, CliInfo["binary"]> = {
  cloudflare: "cf",
  vercel: "vercel",
  oracle: "oci",
  github: "gh",
}

/** 范围列表的分组顺序（6.5） */
export const SCOPE_KINDS: Record<CliProvider, CliScopeKind[]> = {
  cloudflare: ["zone", "worker", "pages"],
  vercel: ["project"],
  oracle: ["instance"],
  github: ["repo"],
}

const OCI_INSTALL_UNIX = 'bash -c "$(curl -L https://raw.githubusercontent.com/oracle/oci-cli/master/scripts/install/install.sh)"'

/** 一种安装方式：label 是包管理器的名字（不翻译），requires 是要先装好的运行时 */
export interface InstallMethod {
  id: string
  label: string
  command: string
  requires?: "node" | "python"
  /** 需要的最低运行时版本；不够时不显示必然失败的安装按钮 */
  requiresVersion?: string
}

/** 安装方式，按推荐顺序；第一个是默认（AC2）。Windows 和 WSL 各一套 */
export function installMethods(provider: CliProvider, envId: EnvId): InstallMethod[] {
  // gh 是单个程序，不需要运行时；命令和后端的白名单逐字一致
  if (provider === "github") {
    return envId === "windows"
      ? [{ id: "winget", label: "winget", command: "winget install --id GitHub.cli" }]
      : [{ id: "apt", label: "apt", command: "sudo apt install gh" }]
  }
  if (provider === "cloudflare") {
    // cf 官方不支持 Bun；Node 需要 ^22.23.0 || ^24.22.0 || ^26.12.0
    return [
      { id: "npm", label: "npm", command: "npm install --global cf", requires: "node", requiresVersion: "22.23" },
      { id: "pnpm", label: "pnpm", command: "pnpm add --global cf", requires: "node", requiresVersion: "22.23" },
    ]
  }
  if (provider === "vercel") {
    // 与 Rust 的固定命令表逐字一致（cli/setup.rs 的测试会比对）
    return [
      { id: "npm", label: "npm", command: "npm install -g vercel", requires: "node" },
      { id: "pnpm", label: "pnpm", command: "pnpm add -g vercel", requires: "node" },
      { id: "bun", label: "bun", command: "bun add -g vercel" },
    ]
  }
  const pip: InstallMethod = { id: "pip", label: "pip", command: "pip install oci-cli", requires: "python" }
  // winget 里的包名是 Oracle.OCI-CLI（2026-11-19 对照 winget 源核实）；写成 Oracle.OCICLI 找不到包
  return envId === "windows"
    ? [{ id: "winget", label: "winget", command: "winget install --exact --id Oracle.OCI-CLI" }, pip]
    : [{ id: "script", label: "install.sh", command: OCI_INSTALL_UNIX }, pip]
}

export const installCommand = (provider: CliProvider, envId: EnvId): string => installMethods(provider, envId)[0].command

/** 登录命令。oci 用浏览器登录的 setup bootstrap，不再要用户手填 OCID（AC2，P9b） */
export function loginCommand(provider: CliProvider): string {
  if (provider === "cloudflare") return "cf auth login"
  if (provider === "vercel") return "vercel login"
  if (provider === "github") return "gh auth login"
  return "oci setup bootstrap"
}
