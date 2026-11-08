// 云平台 CLI 的固定信息（F-104）：命令是机器读的字符串，界面文案在 copy.ts
import type { CliInfo, CliProvider, CliScopeKind, EnvId } from "@/bindings"

export const CLI_PROVIDERS: CliProvider[] = ["cloudflare", "vercel", "oracle", "github"]

/** 添加对话框的分组（PRD 6.5）：云平台与代码托管 */
export const CLOUD_PROVIDERS: CliProvider[] = ["cloudflare", "vercel", "oracle"]
export const CODE_HOSTS: CliProvider[] = ["github"]

export const CLI_BINARY: Record<CliProvider, CliInfo["binary"]> = {
  cloudflare: "wrangler",
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
}

/** 安装方式，按推荐顺序；第一个是默认（AC2）。Windows 和 WSL 各一套 */
export function installMethods(provider: CliProvider, envId: EnvId): InstallMethod[] {
  // gh 是单个程序，不需要运行时；命令和后端的白名单逐字一致
  if (provider === "github") {
    return envId === "windows"
      ? [{ id: "winget", label: "winget", command: "winget install --id GitHub.cli" }]
      : [{ id: "apt", label: "apt", command: "sudo apt install gh" }]
  }
  if (provider !== "oracle") {
    const pkg = CLI_BINARY[provider]
    return [
      { id: "npm", label: "npm", command: `npm install -g ${pkg}`, requires: "node" },
      { id: "pnpm", label: "pnpm", command: `pnpm add -g ${pkg}`, requires: "node" },
      { id: "bun", label: "bun", command: `bun add -g ${pkg}` },
    ]
  }
  const pip: InstallMethod = { id: "pip", label: "pip", command: "pip install oci-cli", requires: "python" }
  return envId === "windows"
    ? [{ id: "winget", label: "winget", command: "winget install Oracle.OCICLI" }, pip]
    : [{ id: "script", label: "install.sh", command: OCI_INSTALL_UNIX }, pip]
}

export const installCommand = (provider: CliProvider, envId: EnvId): string => installMethods(provider, envId)[0].command

/** 登录命令。oci 优先引导长效的 ~/.oci/config，不用 1 小时过期的临时 session（AC2） */
export function loginCommand(provider: CliProvider): string {
  if (provider === "cloudflare") return "wrangler login"
  if (provider === "vercel") return "vercel login"
  if (provider === "github") return "gh auth login"
  return "oci setup config"
}
