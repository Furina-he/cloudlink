// 只读巡检放行清单的分组（PRD 6.6）：后端给的是一张平铺的清单（GuardRules.readOnlyAllow），界面按命令的第一个词归类
export type AllowGroupId = "system" | "services" | "docker" | "cloud"

export const ALLOW_GROUP_ORDER: AllowGroupId[] = ["system", "services", "docker", "cloud"]

const CLOUD = new Set(["wrangler", "vercel", "oci", "gh"])
const SERVICES = new Set(["systemctl", "journalctl", "service", "nginx", "openssl", "curl", "wget", "crontab"])

export function allowGroupOf(command: string): AllowGroupId {
  const head = command.trim().split(/\s+/)[0] ?? ""
  if (head === "docker" || head === "podman") return "docker"
  if (CLOUD.has(head)) return "cloud"
  if (SERVICES.has(head)) return "services"
  return "system"
}

/** 按固定顺序分组，组内保持后端给的顺序；空组不出现 */
export function groupAllowlist(commands: string[]): { id: AllowGroupId; commands: string[] }[] {
  return ALLOW_GROUP_ORDER.map((id) => ({ id, commands: commands.filter((c) => allowGroupOf(c) === id) })).filter((g) => g.commands.length > 0)
}

/** 折叠行副行里的例子：每组第一条，取前三个，只留命令的头两个词 */
export function allowExamples(commands: string[]): string[] {
  const pick = ["df", "docker ps", "journalctl"].filter((c) => commands.includes(c))
  if (pick.length === 3) return pick
  return groupAllowlist(commands)
    .map((g) => g.commands[0].split(/\s+/).slice(0, 2).join(" "))
    .slice(0, 3)
}
