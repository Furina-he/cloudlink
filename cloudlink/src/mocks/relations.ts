// mock 模式的资源关系推导，与 src-tauri/src/compile/relations.rs 保持一致（2026-11-07）
import type { Asset, Relation, RelationKind, ServerAsset, SkillConfig } from "@/bindings"

const code = (s: string) => `\`${[...s].filter((c) => c !== "`" && c >= " ").slice(0, 128).join("")}\``

const hostOf = (s: ServerAsset) => (s.connection.host ?? s.connection.resolved?.hostname ?? "").trim().toLowerCase() || null

function jumpOf(s: ServerAsset): string | null {
  const j = (s.connection.proxyJump ?? s.connection.resolved?.proxyJump ?? "").trim()
  return j && j.toLowerCase() !== "none" ? j : null
}

const isIp = (s: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(s) || /^[0-9a-f:]+:[0-9a-f:]*$/i.test(s)

function relation(kind: RelationKind, id: string, assetIds: string[], params: Record<string, string>, text: string): Relation {
  return { id, kind, assetIds, params, text, hidden: false }
}

/** 从全部资源推出关系，按 id 排序、去重 */
export function deriveRelations(assets: Asset[]): Relation[] {
  const servers = assets.filter((a): a is ServerAsset => a.type === "vps")
  const byAlias = (alias: string) => servers.find((s) => s.connection.sshAlias.toLowerCase() === alias.toLowerCase())
  const out = new Map<string, Relation>()
  const push = (r: Relation) => {
    if (!out.has(r.id)) out.set(r.id, r)
  }

  for (const s of servers) {
    const jump = jumpOf(s)
    if (!jump) continue
    const alias = s.connection.sshAlias
    const ids = [s.id, ...jump.split(",").flatMap((hop) => byAlias(hop.trim())?.id ?? [])]
    push(
      relation("proxy-jump", `jump:${s.id}`, ids, { from: alias, via: jump }, `${code(alias)} is reached through the jump host ${code(jump)}; if ${code(jump)} is unreachable, so is ${code(alias)}.`)
    )
  }

  const byHost = new Map<string, ServerAsset[]>()
  for (const s of servers) {
    const h = hostOf(s)
    if (h) byHost.set(h, [...(byHost.get(h) ?? []), s])
  }
  for (const group of byHost.values()) {
    if (group.length < 2) continue
    const aliases = group.map((s) => s.connection.sshAlias).sort()
    const ids = group.map((s) => s.id).sort()
    push(
      relation("same-host", `same:${ids.join("+")}`, ids, { aliases: aliases.join("、") }, `${aliases.map(code).join(", ")} are the same machine; a change made through one affects the others.`)
    )
  }

  for (const c of assets) {
    if (c.type !== "cli") continue
    const binary = c.cli.binary
    for (const item of c.cli.scope.filter((i) => i.selected)) {
      if (c.cliProvider === "cloudflare" && item.kind === "zone") {
        const zone = item.name.trim().replace(/\.$/, "").toLowerCase()
        if (!zone) continue
        const sitesOn = (s: ServerAsset) =>
          [...new Set(s.servedHostnames.map((h) => h.trim().replace(/\.$/, "").toLowerCase()).filter((h) => h === zone || h.endsWith(`.${zone}`)))].sort()
        const list = (sites: string[]) => sites.map(code).join(", ")
        const linked = servers.find((s) => s.id === item.linkedAssetId)
        if (linked) {
          const sites = sitesOn(linked)
          push(
            relation(
              "dns",
              `dns:${c.id}:${item.id}`,
              [c.id, linked.id],
              { zone: item.name, provider: c.handle, to: linked.connection.sshAlias, sites: sites.join("、") },
              `DNS for ${code(item.name)} (${c.handle}, managed with \`${binary}\`) points at ${code(linked.connection.sshAlias)}${sites.length ? `, which serves ${list(sites)}` : ""}.`
            )
          )
        }
        for (const s of servers.filter((x) => x.id !== linked?.id)) {
          const sites = sitesOn(s)
          if (sites.length === 0) continue
          push(
            relation(
              "site",
              `site:${c.id}:${item.id}:${s.id}`,
              [c.id, s.id],
              { sites: sites.join("、"), to: s.connection.sshAlias, zone: item.name, provider: c.handle },
              `${list(sites)} ${sites.length === 1 ? "is" : "are"} served by ${code(s.connection.sshAlias)}; the DNS zone ${code(item.name)} is managed with \`${binary}\` (${c.handle}).`
            )
          )
        }
      } else if (c.cliProvider === "oracle" && item.kind === "instance") {
        const ip = item.address?.trim()
        const server = ip && isIp(ip) ? servers.find((s) => hostOf(s) === ip.toLowerCase()) : undefined
        if (!server) continue
        push(
          relation(
            "instance",
            `instance:${c.id}:${item.id}`,
            [c.id, server.id],
            { instance: item.name, provider: c.handle, to: server.connection.sshAlias },
            `${code(server.connection.sshAlias)} is the ${c.handle} instance ${code(item.name)}: manage the VM itself (start, stop, resize) with \`${binary}\`, and everything inside it over SSH.`
          )
        )
      }
    }
  }
  return [...out.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/** 标出用户隐藏的，供 list_relations 返回 */
export function withHidden(relations: Relation[], config: SkillConfig): Relation[] {
  return relations.map((r) => ({ ...r, hidden: config.hiddenRelations.includes(r.id) }))
}

/** SKILL.md「How they fit together」的各行：涉及的资源都列入、未隐藏的自动关系，再加用户写的 */
export function relationLines(included: Asset[], config: SkillConfig): string[] {
  const present = new Set(included.map((a) => a.id))
  const auto = deriveRelations(included)
    .filter((r) => !config.hiddenRelations.includes(r.id) && r.assetIds.every((id) => present.has(id)))
    .map((r) => r.text)
  const notes = config.relationNotes.map((n) => n.text.split(/\s+/).filter(Boolean).join(" ")).filter(Boolean)
  return [...auto, ...notes]
}
