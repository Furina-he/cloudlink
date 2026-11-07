// Mock 的总 Skill 渲染（PRD 5.2、5.3、5.6）。只为界面提供接近真实的内容，真正的渲染在 Rust 编译器
import type { Asset, CliAsset, EnvId, ServerAsset, Settings, SkillConfig } from "@/bindings"
import { relationLines } from "./relations"
import { handleOf, isCli, isServer } from "@/stores/assets"

export const ENV_WORD = { prod: "production", staging: "staging", dev: "development" } as const

const BUILTIN_RULES = [
  "Never read or print credential files (`.env`, `*.pem`, `*.key`, `id_*`, `/etc/shadow`, `~/.ssh/`) and never use `docker inspect` to view environment variables.",
  "Never ask for or record passwords, private keys or IP addresses; connect only through the SSH alias.",
  'If a host does not match its details file, report the difference to the user instead of "fixing" the server to match the document.',
  "If CloudLink's guard blocks a command, report it to the user; never try to work around the block with scripts, encoding or other tools.",
]

const HEALTH_CHECK = `# Health check

Check the servers the user asked about; if none were named, check every server in the overview table. Run the checks for one server in a single ssh call, then report one table: server, status (OK / attention / unreachable), findings. Do not fix anything; list suggested actions separately and wait for the user.

    ssh <alias> 'uptime; nproc; free -m; df -hP -x tmpfs -x devtmpfs -x overlay -x squashfs; docker ps -a --format "{{.Names}}\\t{{.Status}}"; systemctl --failed --no-legend --plain; journalctl -p err --since "24 hours ago" --no-pager | tail -n 30'

Mark a server as attention when:
- any filesystem is at 85% or more
- available memory is under 10% of the total
- the 1-minute load is above the number of CPU cores
- a container is exited, restarting or unhealthy (compare with the services in the details file)
- a systemd unit has failed
- the same error repeats in the last 24 hours

Certificates: for each site in the server's details file, run on that server

    ssh <alias> 'echo | openssl s_client -connect 127.0.0.1:443 -servername <site> 2>/dev/null | openssl x509 -noout -enddate'

and mark certificates that expire within 14 days.

If a command is missing on a server (no docker, no systemd), skip it and say so. If a server is unreachable, report it and continue with the next one.
`

const code = (s: string) => `\`${s.slice(0, 128)}\``
const portText = (p: ServerAsset["services"][number]["ports"][number]) =>
  `${p.hostIp}:${p.hostPort}->${p.containerPort}${p.proto === "udp" ? "/udp" : ""}`

/** 详情文件名：别名转小写，非法字符换成连字符；重名时后创建的加 -2（5.3） */
export function detailNames(assets: Asset[]): Map<string, string> {
  const out = new Map<string, string>()
  const used = new Set<string>()
  ;[...assets]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .forEach((a) => {
      const base = handleOf(a).toLowerCase().replace(/[^a-z0-9-]/g, "-")
      let name = base
      for (let n = 2; used.has(name); n++) name = `${base}-${n}`
      used.add(name)
      out.set(a.id, name)
    })
  return out
}

/** 笔记收件箱的绝对路径：Windows 环境渲染成 C:/…；WSL 中指向 Windows 侧的同一个目录（F-308） */
export function inboxPath(dataDir: string, envId: EnvId): string {
  const forward = dataDir.replace(/\\/g, "/")
  if (envId === "windows") return `${forward}/inbox`
  const m = /^([A-Za-z]):\/(.*)$/.exec(forward)
  return m ? `/mnt/${m[1].toLowerCase()}/${m[2]}/inbox` : `${forward}/inbox`
}

/** 云平台勾选的范围（未勾选的不进入产物，F-104 AC3） */
const scopeNames = (a: CliAsset) => a.cli.scope.filter((x) => x.selected).map((x) => x.name)

function role(a: Asset): string {
  if (a.type === "cli") return [a.summary.trim(), scopeNames(a).join(", ")].filter(Boolean).join("; ")
  const sites = a.servedHostnames.filter((h) => !a.summary.includes(h))
  return [a.summary.trim(), sites.length ? `serves ${sites.join(", ")}` : ""].filter(Boolean).join("; ")
}

/** description（F-201 AC2）：超过 1024 字符时依次去掉站点名、缩短用途、只列前若干台并注明其余数量 */
export function description(assets: Asset[]): { text: string; rawChars: number } {
  const item = (a: Asset, withRole: boolean, short: boolean) => {
    const r = withRole ? role(a) : a.summary.trim()
    const text = short && r.length > 40 ? `${r.slice(0, 39)}…` : r
    const tail = [ENV_WORD[a.envTag], a.agent.mode === "read-only" ? "read-only" : ""].filter(Boolean).join(", ")
    return `${handleOf(a)} (${[text, tail].filter(Boolean).join("; ")})`
  }
  const wrap = (list: string) =>
    `The user's servers and cloud platforms and how to operate them — ${list}. Use for any task on these servers, sites or cloud projects: deployments, logs, Docker containers, DNS, configuration, troubleshooting, or a health check of the servers.`
  const full = wrap(assets.map((a) => item(a, true, false)).join(", "))
  if (full.length <= 1024) return { text: full, rawChars: full.length }
  for (const [withRole, short] of [[false, false], [false, true]] as const) {
    const t = wrap(assets.map((a) => item(a, withRole, short)).join(", "))
    if (t.length <= 1024) return { text: t, rawChars: full.length }
  }
  for (let n = assets.length - 1; n > 0; n--) {
    const t = wrap(`${assets.slice(0, n).map((a) => item(a, false, true)).join(", ")} and ${assets.length - n} more`)
    if (t.length <= 1024) return { text: t, rawChars: full.length }
  }
  return { text: wrap(`${assets.length} servers`), rawChars: full.length }
}

const SCOPE_WORD = { zone: "DNS zone", worker: "Worker", pages: "Pages project", project: "Project", instance: "Compute instance" } as const

/** 同一家接了多个账号时，每条命令都要指明账号（不靠 CLI 当前登录的默认账号） */
const ACCOUNT_FLAG: Record<CliAsset["cliProvider"], (account: string) => string> = {
  cloudflare: (x) => `Target this account on every command: set \`CLOUDFLARE_ACCOUNT_ID\` to the id of \`${x}\` from \`wrangler whoami\`.`,
  vercel: (x) => `Target this team on every command: append \`--scope ${x}\`.`,
  oracle: (x) => `Target this profile on every command: append \`--profile ${x}\`.`,
}

/** 云平台的详情文件（references/cloudflare.md）：只写勾选的范围和关联的服务器，不写凭据 */
function renderCliDetails(a: CliAsset, aliasById: (id: string) => string | undefined): string {
  const env = ENV_WORD[a.envTag]
  const account = a.account ?? Object.values(a.cli.envStates).find((s) => s?.account)?.account
  const scope = a.cli.scope.filter((x) => x.selected)
  return [
    `# ${a.handle} — ${a.name}`,
    "",
    `> ${env[0].toUpperCase()}${env.slice(1)} | Mode: ${a.agent.mode}`,
    "",
    "## Connect",
    `- Run \`${a.cli.binary} <command>\` in the local shell; it is already logged in. Never print or export its credentials.`,
    ...(account ? [`- Account: ${account}`, `- ${ACCOUNT_FLAG[a.cliProvider](account)}`] : []),
    ...(a.summary.trim() ? [`- Role: ${a.summary.trim()}`] : []),
    ...(a.guardrails.rules.length ? ["", "## Guardrails (must follow)", ...a.guardrails.rules.map((r, i) => `${i + 1}. ${r.text}`)] : []),
    "",
    "## Scope",
    "Only operate on these resources; ask the user before touching anything else in the account.",
    "| Kind | Name | Linked server |",
    "| --- | --- | --- |",
    ...scope.map((x) => `| ${SCOPE_WORD[x.kind]} | ${code(x.name)} | ${(x.linkedAssetId && aliasById(x.linkedAssetId)) || "-"} |`),
    ...(a.notes.trim() ? ["", "## Notes", a.notes.trim()] : []),
    "",
  ].join("\n")
}

/** 每台服务器的详情文件（5.2 的 references/hk-edge.md） */
export function renderDetails(a: ServerAsset, settings: Settings): string {
  const f = a.facts
  const alias = a.connection.sshAlias
  const critical = a.services.filter((s) => s.critical)
  const rules = [
    ...a.guardrails.rules.map((r) => r.text),
    ...critical.map((s) => `Never stop or restart the ${s.name} ${s.kind === "docker" ? "container" : "service"} (critical)`),
  ]
  const system = [
    f.os,
    f.cpuCores && f.memoryTotalMiB ? `${f.cpuCores} vCPU / ${Math.round(f.memoryTotalMiB / 1024)} GB RAM` : null,
    f.panel ? `managed by ${f.panel.type === "1panel" ? "1Panel" : "aaPanel (BT)"} (${f.panel.installPath})` : null,
  ].filter(Boolean)
  const snapshot = settings.writeSnapshotTime && a.probe.lastSuccessAt ? ` | Snapshot: ${a.probe.lastSuccessAt.slice(0, 10)}` : ""
  const resolved = a.connection.resolved
  const env = ENV_WORD[a.envTag]
  return [
    `# ${alias} — ${a.name}`,
    "",
    `> ${env[0].toUpperCase()}${env.slice(1)} | Mode: ${a.agent.mode}${snapshot}`,
    "",
    "## Connect",
    `- \`ssh ${alias} '<command>'\``,
    ...(system.length ? [`- System: ${system.join(" | ")}`] : []),
    ...(a.summary.trim() ? [`- Role: ${role(a)}`] : []),
    ...(a.export.resolvedConnection && resolved ? [`- Resolved: HostName ${resolved.hostname}, User ${resolved.user}, Port ${resolved.port}`] : []),
    ...(rules.length ? ["", "## Guardrails (must follow)", ...rules.map((r, i) => `${i + 1}. ${r}`)] : []),
    ...(a.paths.length
      ? ["", "## Key directories", "| Key | Path | Purpose |", "| --- | --- | --- |", ...a.paths.map((p) => `| ${p.key} | ${code(p.path)} | ${p.label} |`)]
      : []),
    ...(a.services.length
      ? [
          "",
          "## Services",
          "| Name | Kind | Image | Ports | Role | Critical |",
          "| --- | --- | --- | --- | --- | --- |",
          ...a.services.map(
            (s) =>
              `| ${code(s.name)} | ${s.kind} | ${a.export.image && s.image ? code(s.image) : "-"} | ${s.ports.map((p) => code(portText(p))).join(", ") || "-"} | ${s.role ?? "-"}${s.missing ? " (not seen in last probe)" : ""} | ${s.critical ? "yes" : "no"} |`
          ),
        ]
      : []),
    ...(a.servedHostnames.length ? ["", "## Sites served", a.servedHostnames.map(code).join(", ")] : []),
    ...(a.export.listeningPorts && a.listeningPorts.length
      ? ["", "## Listening ports", ...a.listeningPorts.map((p) => `- ${code(`${p.addr}:${p.port}/${p.proto}`)}`)]
      : []),
    ...(a.notes.trim() ? ["", "## Notes", a.notes.trim()] : []),
    "",
    "Live metrics such as free disk or memory are not recorded here; check them on the host when needed (e.g. `df -h`, `free -m`).",
    "",
  ].join("\n")
}

export interface RenderedSkill {
  files: { path: string; content: string }[]
  descriptionChars: number
  rawDescriptionChars: number
  bodyLines: number
  /** 每台服务器的详情文件路径 */
  detailPath: Map<string, string>
}

/** 总 Skill（5.2）：SKILL.md 排第一，然后是每台服务器的详情和巡检清单。一台都没列入时没有文件 */
export function renderSkill(envId: EnvId, assets: Asset[], config: SkillConfig, settings: Settings): RenderedSkill {
  const relationships = relationLines(assets, config)
  const names = detailNames(assets)
  const detailPath = new Map([...names].map(([id, n]) => [id, `references/${n}.md`]))
  if (assets.length === 0) return { files: [], descriptionChars: 0, rawDescriptionChars: 0, bodyLines: 0, detailPath }
  const desc = description(assets)
  const snapshot = settings.writeSnapshotTime ? ` | Snapshot: ${new Date().toISOString().slice(0, 10)}` : ""
  const rules = [...BUILTIN_RULES, ...config.conventions.map((c) => c.text)]
  const body = [
    "# Servers",
    "",
    `> Generated by CloudLink — do not edit${snapshot}`,
    "",
    "Connect only through the SSH aliases below: `ssh <alias> '<command>'`. Authentication is handled by the local SSH configuration; never ask for or record passwords, IPs or private keys. Before running commands on a server, read its details file.",
    "",
    "| Alias | Role | Env | Mode | Details |",
    "| --- | --- | --- | --- | --- |",
    ...assets.filter(isServer).map(
      (a) => `| \`${a.connection.sshAlias}\` | ${role(a) || "-"} | ${ENV_WORD[a.envTag]} | ${a.agent.mode} | \`${detailPath.get(a.id)}\` |`
    ),
    ...(assets.some(isCli)
      ? [
          "",
          "## Cloud platforms",
          "Use these CLIs from the local shell. They are already logged in; only touch the resources listed in each details file.",
          "",
          "| Platform | CLI | Role | Env | Mode | Details |",
          "| --- | --- | --- | --- | --- | --- |",
          ...assets.filter(isCli).map(
            (a) => `| ${a.handle} | \`${a.cli.binary}\` | ${role(a) || "-"} | ${ENV_WORD[a.envTag]} | ${a.agent.mode} | \`${detailPath.get(a.id)}\` |`
          ),
        ]
      : []),
    ...(relationships.length ? ["", "## How they fit together", ...relationships.map((r) => `- ${r}`)] : []),
    "",
    "## Modes",
    "- **read-only**: inspection commands only, e.g. `docker ps`, `docker logs --tail 200 <container>`, `df -h`, `free -m`, `uptime`, `ss -tln`, `journalctl -u <service> -n 200`. If a change is needed, describe the plan to the user and stop; the user can switch it to standard mode in CloudLink.",
    "- **standard**: routine deployments and service restarts are allowed. Ask the user before deleting data or volumes, changing the firewall or SSH configuration, stopping critical services, or rebooting.",
    "- In Claude Code, CloudLink's guard enforces these modes. A blocked command comes back with the reason.",
    "",
    "## Rules for every server",
    ...rules.map((r, i) => `${i + 1}. ${r}`),
    "",
    "## Health check",
    "When the user asks for a health check of all or some servers, follow `references/health-check.md`.",
    "",
    "## Notes for next time",
    `When you learn something durable about a server that its details file does not cover — how something is deployed, where a config lives, a pitfall — append one line to \`${inboxPath(settings.dataDir, envId)}/<name>.md\`, where \`<name>\` matches the server's details file; create the file if needed:`,
    "`- YYYY-MM-DD: <what you learned>`",
    "Never write secrets, IP addresses, credentials or transient state such as current load. The user reviews these notes in CloudLink before they become part of this skill.",
  ]
  const skill = ["---", "name: cloudlink-servers", `description: ${desc.text}`, "---", "", ...body, ""].join("\n")
  return {
    files: [
      { path: "SKILL.md", content: skill },
      ...assets.map((a) => ({
        path: detailPath.get(a.id)!,
        content: a.type === "vps" ? renderDetails(a, settings) : renderCliDetails(a, (id) => assets.find((x) => x.id === id && x.type === "vps") && handleOf(assets.find((x) => x.id === id)!)),
      })),
      { path: "references/health-check.md", content: HEALTH_CHECK },
    ],
    descriptionChars: desc.text.length,
    rawDescriptionChars: desc.rawChars,
    bodyLines: body.length,
    detailPath,
  }
}
