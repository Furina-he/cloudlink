// Mock 的总 Skill 渲染（PRD 5.2、5.3、5.6）。只为界面提供接近真实的内容，真正的渲染在 Rust 编译器
import type { Asset, CliAsset, EnvId, ServerAsset, Settings, SkillConfig } from "@/bindings"
import { relationLines } from "./relations"
import { handleOf, isCli, isServer } from "@/stores/assets"

/** F-109 AC3：只对生产资源写 production */
export const envWord = (a: { production: boolean }) => (a.production ? "production" : "-")

const BUILTIN_RULES = [
  "Never read or print credential files (`.env`, `*.pem`, `*.key`, `id_*`, `/etc/shadow`, `~/.ssh/`) and never use `docker inspect` to view environment variables.",
  "Never ask for or record passwords, private keys or IP addresses; use the Connect entry in the resource's details file.",
  'If a host does not match its details file, report the difference to the user instead of "fixing" the server to match the document.',
  "If CloudLink's guard blocks a command, report it to the user; never try to work around the block with scripts, encoding or other tools.",
]

const HEALTH_CHECK = `# Health check

Check the servers the user asked about; if none were named, check every server in the overview table. Read each server's details first and use its Connect entry for one remote command, then report one table: server, status (OK / attention / unreachable), findings. Do not fix anything; list suggested actions separately and wait for the user.

For every server, pass each quoted remote command below after \`--\` in its absolute CloudLink runner Connect entry. Do not replace that entry with direct SSH, regardless of production or mode. Keep the stable resource ID and use the PowerShell variant when applicable. A waiting ticket is continued with \`wait\`, never by retrying the check through direct SSH.

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

export function skillHandle(a: Asset): string {
  if (!isServer(a) || a.export.resolvedConnection) return handleOf(a)
  const alias = a.connection.sshAlias.toLowerCase()
  const privateAlias = [a.connection.host, a.connection.resolved?.hostname].some((host) =>
    host && !a.servedHostnames.some((site) => site.toLowerCase() === host.toLowerCase()) &&
    [host.toLowerCase(), host.replace(/[.:]/g, "-"), host.replace(/[.:]/g, "_")].some((value) => alias.includes(value.toLowerCase()))
  )
  return privateAlias ? `server-${a.id.toLowerCase().replaceAll("_", "-")}` : handleOf(a)
}

function runnerCommand(settings: Settings, envId: EnvId, op: string, assetId?: string, tail = "", powershell = false): string {
  const path = `${inboxPath(settings.dataDir, envId).slice(0, -"/inbox".length)}/bin/cloudlink-guard.exe`
  const quote = (s: string) => powershell ? `'${s.replaceAll("'", "''")}'` : `'${s.replaceAll("'", "'\\''")}'`
  return `${powershell ? "& " : ""}${quote(path)} ${op}${op === "status" ? "" : ` --env ${quote(envId)}`}${assetId ? ` --asset ${quote(assetId)}` : ""}${tail ? ` ${tail}` : ""}`
}

function entryLines(settings: Settings, envId: EnvId, op: string, assetId?: string, tail = ""): string[] {
  return ["", `    ${runnerCommand(settings, envId, op, assetId, tail)}`, ...(envId === "windows" ? ["", "PowerShell:", "", `    ${runnerCommand(settings, envId, op, assetId, tail, true)}`] : []), ""]
}

/** 详情文件名：别名转小写，非法字符换成连字符；重名时后创建的加 -2（5.3）。两份固定的参考文件占着自己的名字 */
export function detailNames(assets: Asset[]): Map<string, string> {
  const out = new Map<string, string>()
  const used = new Set<string>(["health-check", "execution"])
  ;[...assets]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .forEach((a) => {
      const base = skillHandle(a).toLowerCase().replace(/[^a-z0-9-]/g, "-")
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

/** 用途留空、也没有站点或范围可写时的替代说明：显示名称（和别名不同时），服务器再加探测到的服务名 */
function standIn(a: Asset, withServices: boolean): string {
  const parts: string[] = []
  const name = a.name.trim()
  if (name && name.toLowerCase() !== skillHandle(a).toLowerCase()) parts.push(name)
  if (a.type === "vps" && withServices) {
    const names = [...a.services]
      .filter((s) => !s.missing)
      .sort((x, y) => Number(y.critical) - Number(x.critical))
      .map((s) => s.name)
      .filter((n) => /^[A-Za-z0-9._@-]{1,64}$/.test(n) && !/ignore[\s_-]*(all[\s_-]*)?previous|system[\s_-]*prompt/i.test(n))
      .slice(0, 5)
    if (names.length) parts.push(`runs ${names.map(code).join(", ")}`)
  }
  return parts.join("; ")
}

const roleOrStandIn = (a: Asset) => role(a) || standIn(a, true)

/** frontmatter 的值写成 YAML 双引号字符串：用途里的冒号、井号、引号不能让严格的解析器拒收整份 Skill */
const yamlString = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[\p{Cc}\u2028\u2029\ufeff]/gu, " ")}"`

/**
 * description（F-201 AC2）：超过 1024 字符时依次去掉站点名、缩短用途、只列前若干台并注明其余数量。
 * 只写「有什么、管什么」，不写档位：档位随时会切，而 description 在会话开始时就加载了
 */
export function description(assets: Asset[]): { text: string; rawChars: number } {
  const item = (a: Asset, withRole: boolean, short: boolean) => {
    const r = (withRole ? role(a) : a.summary.trim()) || standIn(a, withRole)
    const text = short && r.length > 40 ? `${r.slice(0, 39)}…` : r
    const inner = [text, a.production ? "production" : ""].filter(Boolean).join("; ")
    return inner ? `${skillHandle(a)} (${inner})` : skillHandle(a)
  }
  const hasServer = assets.some((a) => a.type === "vps")
  const hasCli = assets.some((a) => a.type === "cli")
  // 接了 GitHub 时，仓库相关的任务也要能触发这份 Skill（F-110）
  const hasGithub = assets.some((a) => a.type === "cli" && a.cliProvider === "github")
  const hasCloud = assets.some((a) => a.type === "cli" && a.cliProvider !== "github")
  const servers = hasServer || !hasCli
  const subject = hasServer && hasCli ? "servers and cloud platforms" : hasCli ? "cloud platforms" : "servers"
  const targetWords = [...(servers ? ["servers", "sites"] : []), ...(hasCloud ? ["cloud projects"] : []), ...(hasGithub ? ["repositories"] : [])]
  const targets = targetWords.length > 1 ? `${targetWords.slice(0, -1).join(", ")} or ${targetWords.at(-1)}` : targetWords[0]
  const topicWords = ["deployments", "logs", ...(servers ? ["Docker containers"] : []), ...(hasCloud ? ["DNS"] : [])].join(", ")
  const topics = servers ? `${topicWords}, configuration, troubleshooting, or a health check of the servers` : `${topicWords}, configuration or troubleshooting`
  const wrap = (list: string) => `The user's ${subject} and how to operate them — ${list}. Use for any task on these ${targets}: ${topics}.`
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
  return { text: wrap(`${assets.length} resources`), rawChars: full.length }
}

const SCOPE_WORD = { zone: "DNS zone", worker: "Worker", pages: "Pages project", project: "Project", instance: "Compute instance", repo: "Repository" } as const

/** 同一家接了多个账号时，每条命令都要指明账号（不靠 CLI 当前登录的默认账号） */
const ACCOUNT_FLAG: Record<CliAsset["cliProvider"], (account: string) => string> = {
  cloudflare: (x) => `Target this account on every command: set \`CLOUDFLARE_ACCOUNT_ID\` to the id of \`${x}\` from \`cf auth whoami\`. Do not add \`--profile\`.`,
  vercel: (x) => `Target this team on every command: append \`--scope ${x}\`.`,
  oracle: (x) => `Target this profile on every command: append \`--profile ${x}\`.`,
  github: () => "The repository owner is not the active `gh` login; never switch accounts to expand access. The `gh` identity does not identify SSH Git or custom Git credential helpers.",
}

/** 云平台的详情文件（references/cloudflare.md）：只写勾选的范围和关联的服务器，不写凭据 */
function renderCliDetails(a: CliAsset, aliasById: (id: string) => string | undefined, settings: Settings, envId: EnvId): string {
  const account = a.account ?? Object.values(a.cli.envStates).find((s) => s?.account)?.account
  const scope = a.cli.scope.filter((x) => x.selected)
  const github = a.github
  const snapshot = github?.envStates[envId]
  return [
    `# ${a.handle} — ${a.name}`,
    "",
    `> ${a.production ? "Production | " : ""}Mode: ${a.agent.mode}`,
    "",
    "## Connect",
    "Use separate CLI arguments after `--`, without the provider binary or a shell wrapper. Never print or export credentials:",
    ...entryLines(settings, envId, "exec", a.id, "-- <command arguments>"),
    ...(a.cliProvider === "github"
      ? [`- Host: ${code(github?.host ?? "github.com")}`, `- Owner: ${github?.owner ? code(github.owner.login) : "not verified; preserve the historical selection"}`, `- Effective \`gh\` login in this environment: ${snapshot?.identity ? code(snapshot.identity.login) : "not verified"}`, `- Snapshot: ${snapshot?.status ?? "not verified"}. The owner is not the login identity; never switch accounts to expand access. A \`gh\` login does not identify SSH Git or custom Git credential helpers.`]
      : account ? [`- Account: ${account}`, `- ${ACCOUNT_FLAG[a.cliProvider](account)}`] : []),
    ...(a.summary.trim() ? [`- Role: ${a.summary.trim()}`] : []),
    ...(a.guardrails.rules.length ? ["", "## Guardrails (must follow)", ...a.guardrails.rules.map((r, i) => `${i + 1}. ${r.text}`)] : []),
    "",
    ...(a.cliProvider === "github"
      ? [
          "## Repositories",
          github?.mode === "auto" && !github.migrationPending
            ? "Auto scope follows the verified owner: current and future repositories this environment's login can access, including private repositories, except the excluded stable IDs below. Repository renames do not remove an exclusion; a repository transferred out of the owner is no longer in scope. This table is a known snapshot, not an exhaustive future list."
            : "Manual scope: only the selected stable repository IDs represented below. Historical selections never expand automatically; an unverified owner must be confirmed in CloudLink, not inferred from names.",
          ...(github?.mode === "auto" && github.excludedRepoIds.length ? [`Excluded stable repository IDs: ${github.excludedRepoIds.map(code).join(", ")}.`] : []),
          "A valid login does not mean the repository scope was completely verified. Partial, offline or denied refreshes preserve known history and cannot enlarge authorization. Refresh through this read-only metadata entry before relying on a new repository, changed identity or deployment relation; failure is not permission to switch accounts or broaden scope:",
          ...entryLines(settings, envId, "discover", a.id),
          "| Repository | Default branch | Visibility |",
          "| --- | --- | --- |",
          ...scope.map((x) => `| ${code(x.name)} | ${x.defaultBranch ? code(x.defaultBranch) : "-"} | ${x.visibility ?? "-"} |`),
          "",
          "Deleting repositories, exporting credentials, or force-pushing the default/unspecified branch cannot be approved. Ordinary commits/pushes are not blanket-protected by CloudLink. Deployment relations are collected evidence, not additional authorization.",
          "For the specifically checked high-risk Git operations, use `--tool git` and explicit Git arguments/branch; the runner verifies the actual push remote and repository. This is not an arbitrary local-program runner:",
          ...entryLines(settings, envId, "exec", a.id, "--tool git -- <git arguments>"),
        ]
      : a.cloudScope?.mode === "auto"
        ? [
            "## Resources",
            "Auto scope follows this account: current and future resources this account can access (including products not listed below), except any excluded items.",
            ...(a.cloudScope.excludedIds.length
              ? [
                  `Excluded resources (do not touch): ${a.cloudScope.excludedIds
                    .map((id) => {
                      const item = a.cli.scope.find((x) => x.id === id)
                      return item ? `${code(item.name)} (${code(item.id)})` : code(id)
                    })
                    .join(", ")}.`,
                ]
              : []),
            ...(scope.length
              ? [
                  "",
                  "Known snapshot (not an exhaustive list):",
                  "",
                  "| Kind | Name | Linked server |",
                  "| --- | --- | --- |",
                  ...scope.map((x) => `| ${SCOPE_WORD[x.kind]} | ${code(x.name)} | ${(x.linkedAssetId && aliasById(x.linkedAssetId)) || "-"} |`),
                ]
              : []),
          ]
        : [
            "## Scope",
            "Only operate on these resources; ask the user before touching anything else in the account.",
            "| Kind | Name | Linked server |",
            "| --- | --- | --- |",
            ...scope.map((x) => `| ${SCOPE_WORD[x.kind]} | ${code(x.name)} | ${(x.linkedAssetId && aliasById(x.linkedAssetId)) || "-"} |`),
          ]),
    ...(a.notes.trim() ? ["", "## Notes", a.notes.trim()] : []),
    "",
  ].join("\n")
}

/** 每台服务器的详情文件（5.2 的 references/hk-edge.md） */
export function renderDetails(a: ServerAsset, settings: Settings, envId: EnvId): string {
  const f = a.facts
  const alias = skillHandle(a)
  const critical = a.services.filter((s) => s.critical)
  const rules = [
    ...a.guardrails.rules.map((r) => r.text),
    ...critical.map((s) => `Stopping or restarting the ${code(s.name)} ${s.kind === "docker" ? "container" : "service"} is high risk (critical); request the user's one-time approval through the CloudLink runner`),
  ]
  const system = [
    f.os,
    f.cpuCores && f.memoryTotalMiB ? `${f.cpuCores} vCPU / ${Math.round(f.memoryTotalMiB / 1024)} GB RAM` : null,
    f.panel ? `managed by ${f.panel.type === "1panel" ? "1Panel" : "aaPanel (BT)"} (${f.panel.installPath})` : null,
  ].filter(Boolean)
  const snapshot = settings.writeSnapshotTime && a.probe.lastSuccessAt ? ` | Snapshot: ${a.probe.lastSuccessAt.slice(0, 10)}` : ""
  const resolved = a.connection.resolved
  return [
    `# ${alias} — ${a.name}`,
    "",
    `> ${a.production ? "Production | " : ""}Mode: ${a.agent.mode}${snapshot}`,
    "",
    "## Connect",
    "Pass exactly one quoted remote command after `--`; the stable ID maps to the private SSH configuration. Do not replace this entry with a direct alias:",
    ...entryLines(settings, envId, "exec", a.id, "-- '<command>'"),
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
    "", "## Single-file transfer", "Only new destination paths, never overwrite, recurse, glob or resume. Upload is a write and binds the source digest; a changed source invalidates approval. Download refuses credential paths and follows no local links. Failure may leave remote partial data; do not delete user directories. The remote existence check is not an exclusive safe-publication guarantee.",
    ...entryLines(settings, envId, "put", a.id, "-- '<localFile>' '<remoteFile>'"),
    ...entryLines(settings, envId, "get", a.id, "-- '<remoteFile>' '<localFile>'"),
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

/** 等待审批、超时和结果不明时怎么办（references/execution.md）；SKILL.md 正文只留一句指向它 */
function renderExecution(settings: Settings, envId: EnvId): string {
  return [
    "# Waiting, timeouts and unknown results",
    "",
    "Every Connect entry in the details files calls the CloudLink runner. This file covers what follows a call: a request waiting for the user's approval, a timeout, or a result you cannot interpret.",
    "",
    "## Waiting for approval",
    "`exec` waits up to about 90 seconds for approval. A structured `waiting` result with a request ticket (exit 75) is not rejection or execution failure. Keep the original ticket private and continue the same request; never resubmit through another tool:",
    ...entryLines(settings, envId, "wait", undefined, "'<requestId.ownerToken>'"),
    "- Do not add source/session options to `wait`: it retains the original request's source.",
    "- Approval expires 5 minutes after request creation. Only the original inline caller or `wait` consumes it, at most once.",
    "- “Approved” is not “executed”; expired/cancelled requests do not run. `wait` can return waiting again.",
    "- Restarting CloudLink never approves or resumes an old request.",
    "",
    "## Timeouts and unknown results",
    "- A timeout may leave remote work running; inspect rather than retry. Never replay unknown results.",
    "- Output streams are bounded and not saved by default.",
    "",
    "## When the runner refuses",
    "While CloudLink is starting or updating, or when its state is unreadable or it cannot be reached, the runner refuses instead of running the command. Report this to the user; it is not a reason to use another route. Inspect the runtime with the same quoted runner followed by `status` (no other arguments):",
    ...entryLines(settings, envId, "status"),
  ].join("\n")
}

/** 总 Skill（5.2）：SKILL.md 排第一，然后是每项资源的详情和两份固定的参考文件。一项都没列入时没有文件 */
export function renderSkill(envId: EnvId, assets: Asset[], config: SkillConfig, settings: Settings): RenderedSkill {
  const relationships = relationLines(assets, config)
  const names = detailNames(assets)
  const detailPath = new Map([...names].map(([id, n]) => [id, `references/${n}.md`]))
  if (assets.length === 0) return { files: [], descriptionChars: 0, rawDescriptionChars: 0, bodyLines: 0, detailPath }
  const desc = description(assets)
  const snapshot = settings.writeSnapshotTime ? ` | Snapshot: ${new Date().toISOString().slice(0, 10)}` : ""
  const rules = [...BUILTIN_RULES, ...config.conventions.map((c) => c.text)]
  const servers = assets.filter(isServer)
  const clis = assets.filter(isCli)
  const exampleName = names.get((servers[0] ?? assets[0]).id)
  const body = [
    `# ${servers.length && clis.length ? "Servers and cloud platforms" : clis.length ? "Cloud platforms" : "Servers"}`,
    "",
    `> Generated by CloudLink — do not edit${snapshot}`,
    "",
    "Before operating on any resource, read its details file and use its exact CloudLink runner Connect entry, in both modes and regardless of the production marker. Authentication stays in the local SSH/CLI configuration; never ask for or record passwords, IPs or private keys.",
    ...(servers.length
      ? [
          "",
          "| Alias | Role | Env | Details |",
          "| --- | --- | --- | --- |",
          ...servers.map((a) => `| \`${skillHandle(a)}\` | ${roleOrStandIn(a) || "-"} | ${envWord(a)} | \`${detailPath.get(a.id)}\` |`),
        ]
      : []),
    ...(clis.length
      ? [
          "",
          "## Cloud platforms",
          "Only touch the owner/account and scope in each details file. Always use its runner entry, not a bare local CLI. CLI arguments remain separate arguments; do not wrap them in a shell string.",
          "",
          "| Platform | CLI | Role | Env | Details |",
          "| --- | --- | --- | --- | --- |",
          ...clis.map((a) => `| ${a.handle} | \`${a.cli.binary}\` | ${roleOrStandIn(a) || "-"} | ${envWord(a)} | \`${detailPath.get(a.id)}\` |`),
        ]
      : []),
    ...(relationships.length ? ["", "## How they fit together", ...relationships.map((r) => `- ${r}`)] : []),
    "",
    "## Modes",
    "Each details file states its resource's mode.",
    "- **confirm-changes**: recognized, non-sensitive queries run directly. Routine changes require the user's one-time approval in CloudLink.",
    "- **auto-ops**: queries and changes within the provided scope run directly, except data deletion, explicitly named critical services, opaque scripts, host reboot or shutdown, firewall changes, and SSH configuration or stopping sshd.",
    "- In both modes, data deletion, critical services, opaque scripts, host reboot or shutdown, firewall and SSH configuration changes require one-time approval. Credentials, repository deletion and default/unspecified-branch force-pushes cannot be approved. Uncertain identities, targets or scope are denied.",
    "- Production is an independent risk marker, not a different mode or a switch for checks. The runner checks all provided resources, and Claude Code's hook redirects recognized direct connections to it.",
    "",
    "## Running commands",
    "- Use the absolute runner path and stable resource ID in the details, never a name as a route. Git Bash/WSL and PowerShell examples use their own quoting; do not alter the executable path.",
    "- Identify your actual invoking Agent with `--agent claude-code`, `--agent codex` or `--agent cursor` before `--` in exec/put/get when known; omit it when unknown. This is a display-only self-report, never approval.",
    "- No TTY or opaque stdin scripts. Foreground execution defaults to 90 seconds; set `--timeout <seconds>` before `--` (maximum 3600) and raise your own tool timeout when needed.",
    "- A structured `waiting` result with a request ticket (exit 75) is not rejection or execution failure: the user is being asked in CloudLink. Continue the same request as `references/execution.md` describes; never resubmit it through another tool. Read that file as well after a timeout or a result you cannot interpret.",
    "",
    "## Rules for every resource",
    ...rules.map((r, i) => `${i + 1}. ${r}`),
    "",
    "## Health check",
    "When the user asks for a health check of all or some servers, follow `references/health-check.md` using each resource's Connect entry.",
    "",
    "## Notes for next time",
    `When you learn something durable about a resource that its details file does not cover — how something is deployed, where a config lives, a pitfall — append one line to \`${inboxPath(settings.dataDir, envId)}/<name>.md\`, where \`<name>\` matches the resource's details file (\`${exampleName}\` for \`references/${exampleName}.md\`); create the file if needed:`,
    "`- YYYY-MM-DD: <what you learned>`",
    "Never write secrets, IP addresses, credentials or transient state such as current load. The user reviews these notes in CloudLink before they become part of this skill.",
  ]
  const skill = ["---", "name: cloudlink-servers", `description: ${yamlString(desc.text)}`, "---", "", ...body, ""].join("\n")
  return {
    files: [
      { path: "SKILL.md", content: skill },
      ...assets.map((a) => ({
        path: detailPath.get(a.id)!,
        content: a.type === "vps" ? renderDetails(a, settings, envId) : renderCliDetails(a, (id) => { const linked = assets.find((x) => x.id === id && x.type === "vps"); return linked && skillHandle(linked) }, settings, envId),
      })),
      { path: "references/execution.md", content: renderExecution(settings, envId) },
      { path: "references/health-check.md", content: HEALTH_CHECK },
    ],
    descriptionChars: desc.text.length,
    rawDescriptionChars: desc.rawChars,
    bodyLines: body.length,
    detailPath,
  }
}
