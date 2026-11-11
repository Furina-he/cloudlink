// 路径换算（PRD 3.5、6.5）：编译目录位置、Windows 与 WSL 路径
import type { EnvId } from "@/bindings"

/** 一份总 Skill 的编译目录：~/.cloudlink/compiled/<环境>/<Agent>/cloudlink-servers，WSL 写成 wsl-<发行版>（3.5） */
export function compiledDir(dataDir: string, envId: EnvId, agentKey: string): string {
  const env = envId === "windows" ? "windows" : envId.replace(":", "-")
  return `${dataDir}\\compiled\\${env}\\${agentKey.replace(":", "-")}\\cloudlink-servers`
}

/** 详情文件路径：别名转小写，非法字符换成连字符（5.3）。重名时的 -2 后缀以编译结果为准 */
export function detailFileOf(alias: string): string {
  return `references/${alias.toLowerCase().replace(/[^a-z0-9-]/g, "-")}.md`
}

/** 文件选择器返回的 \\wsl.localhost\<发行版>\… 换成 WSL 里的路径；其他路径原样返回 */
export function toEnvPath(path: string, envId: EnvId): string {
  if (!envId.startsWith("wsl:")) return path
  const m = /^\\\\wsl(?:\$|\.localhost)\\[^\\]+(\\.*)$/i.exec(path)
  return m ? m[1].replace(/\\/g, "/") : path
}

/** WSL 中位于 /mnt/ 下的私钥：ssh 会因为权限过宽拒绝使用（F-108） */
export const isUnderMnt = (path: string) => /^\/mnt\/[a-z]\//i.test(path.trim())

/** WSL 里的 /mnt/c/… 换回 Windows 路径（「复制到 WSL」的源文件）；不在 /mnt/ 下返回 null */
export function mntToWindows(path: string): string | null {
  const m = /^\/mnt\/([a-z])\/(.*)$/i.exec(path.trim())
  return m ? `${m[1].toUpperCase()}:\\${m[2].replace(/\//g, "\\")}` : null
}
