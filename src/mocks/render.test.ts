// The mock renderer only feeds the browser preview, but its fixed text is a hand-kept copy of
// the Rust templates. These checks compare that text with the compiler's golden files, so the
// preview cannot drift from what CloudLink really writes.
import { describe, expect, it } from "vitest"

import type { Asset, CliAsset, ServerAsset } from "@/bindings"
import goldenExecution from "../../src-tauri/tests/golden/windows-claude-code-cli/cloudlink-servers/references/execution.md?raw"
import goldenHealthCheck from "../../src-tauri/tests/golden/windows-claude-code-cli/cloudlink-servers/references/health-check.md?raw"
import goldenSkill from "../../src-tauri/tests/golden/windows-claude-code-cli/cloudlink-servers/SKILL.md?raw"
import { assets, settings, skillConfig } from "./fixtures"
import { compileSkill } from "./lint"
import { description, detailNames, renderSkill } from "./render"

const GOLDEN: Record<string, string> = {
  "SKILL.md": goldenSkill,
  "references/execution.md": goldenExecution,
  "references/health-check.md": goldenHealthCheck,
}
const golden = (file: string) => GOLDEN[file]
const section = (text: string, from: string, to: string) => text.slice(text.indexOf(from), text.indexOf(to))
/** Only the runner location differs between the mock's data directory and the golden fixture */
const anyRunner = (text: string) => text.replace(/'[^']*cloudlink-guard\.exe'/g, "'<runner>'")
const file = (rendered: ReturnType<typeof renderSkill>, path: string) => rendered.files.find((f) => f.path === path)!.content
const server = assets.find((a): a is ServerAsset => a.type === "vps")!

describe("mock Skill renderer", () => {
  const rendered = renderSkill("windows", assets, skillConfig, settings)
  const skill = file(rendered, "SKILL.md")

  it("keeps the fixed sections identical to the compiler's golden SKILL.md", () => {
    const want = golden("SKILL.md")
    for (const [from, to] of [["## Modes", "## Rules for every resource"], ["## Health check", "## Notes for next time"]]) {
      expect(section(skill, from, to)).toBe(section(want, from, to))
    }
    expect(skill).toContain("\n## Rules for every resource\n1. Never read or print credential files")
    expect(skill).not.toMatch(/\| Mode \||\| Env \||full exit|While CloudLink runs|Production \|/)
  })

  it("renders the waiting reference exactly like the compiler", () => {
    expect(anyRunner(file(rendered, "references/execution.md"))).toBe(anyRunner(golden("references/execution.md")))
    expect(rendered.files.at(-1)!.path).toBe("references/health-check.md")
    expect(file(rendered, "references/health-check.md")).toBe(golden("references/health-check.md"))
  })

  it("writes the description as a quoted YAML string without the mode", () => {
    const line = skill.split("\n")[2]
    expect(line.startsWith('description: "The user\'s servers and cloud platforms and how to operate them — ')).toBe(true)
    expect(line.endsWith('."')).toBe(true)
    expect(line).not.toMatch(/confirm-changes|auto-ops/)
    const quoted: Asset = { ...server, summary: 'Edge: "blue" stack \\ path', servedHostnames: [] }
    expect(file(renderSkill("windows", [quoted], skillConfig, settings), "SKILL.md").split("\n")[2]).toContain('Edge: \\"blue\\" stack \\\\ path')
  })

  it("leads with display name, hides default cloudlink-N aliases, and annotates semantic aliases", () => {
    const alias = server.connection.sshAlias
    const bare: Asset = { ...server, name: alias.toUpperCase(), summary: "", servedHostnames: [], services: [] }
    expect(description([bare]).text).toContain(`— ${alias.toUpperCase()}. Use for any task on these servers or sites:`)
    const named: Asset = { ...bare, name: "Build box" }
    expect(description([named]).text).toContain(`— Build box / ${alias}. Use for`)
    const defaultAliasServer: Asset = {
      ...server,
      name: "腾讯云",
      summary: "Web app host",
      servedHostnames: [],
      connection: { ...server.connection, sshAlias: "cloudlink-1" },
    }
    const renderedDefault = renderSkill("windows", [defaultAliasServer], skillConfig, settings)
    const defaultSkill = file(renderedDefault, "SKILL.md")
    expect(description([defaultAliasServer]).text).toContain("— 腾讯云 (Web app host). Use for")
    expect(description([defaultAliasServer]).text).not.toContain("cloudlink-1")
    expect(defaultSkill).toContain("| 腾讯云 | Web app host | `references/cloudlink-1.md` |")
    expect(file(renderedDefault, "references/cloudlink-1.md")).toContain("# 腾讯云\n")
  })

  it("names what the Skill contains and reserves the bundled file names", () => {
    const cli = assets.filter((a) => a.type === "cli" && a.cliProvider === "github")
    expect(cli.length).toBeGreaterThan(0)
    const only = renderSkill("windows", cli, skillConfig, settings)
    expect(file(only, "SKILL.md")).toContain("\n# Cloud platforms\n")
    expect(description(cli).text).toMatch(/^The user's cloud platforms and how to operate them — .+\. Use for any task on these repositories: deployments, logs, configuration or troubleshooting\.$/)
    const clash: Asset = { ...server, connection: { ...server.connection, sshAlias: "execution" } }
    expect(detailNames([clash]).get(clash.id)).toBe("execution-2")
  })

  it("compacts multi-repo GitHub and multi-item cloud scopes without length lint warnings (P10d)", () => {
    const ghBase = assets.find((a): a is CliAsset => a.type === "cli" && a.cliProvider === "github")!
    const cfBase = assets.find((a): a is CliAsset => a.type === "cli" && a.cliProvider === "cloudflare")!
    const manyGh: CliAsset = {
      ...ghBase,
      summary: "",
      account: "Furina-he",
      cli: {
        ...ghBase.cli,
        scope: Array.from({ length: 19 }, (_, i) => ({
          id: `repo:r${i + 1}`,
          kind: "repo",
          name: `Furina-he/project-${String(i + 1).padStart(2, "0")}`,
          selected: true,
          defaultBranch: "main",
          visibility: "private",
        })),
      },
    }
    const manyCf: CliAsset = {
      ...cfBase,
      summary: "",
      cli: {
        ...cfBase.cli,
        scope: Array.from({ length: 9 }, (_, i) => ({
          id: `zone_${i + 1}`,
          kind: "zone",
          name: `site-${i + 1}.example.com`,
          selected: true,
        })),
      },
    }
    const preview = compileSkill("windows", "claude-code", [manyGh, manyCf], skillConfig, settings)
    const desc = preview.files[0].content.split("\n")[2]
    expect(desc).toContain("GitHub (Furina-he, 19 repos)")
    expect(desc).not.toContain("Furina-he/project-19")
    expect(desc).toContain("Cloudflare (site-1.example.com, site-2.example.com, site-3.example.com +6 more)")
    expect(desc).not.toContain("site-9.example.com")
    expect(preview.lint.some((l) => l.id === "description-too-long" || l.id === "body-too-long")).toBe(false)
    expect(preview.files.find((f) => f.path === "references/github.md")?.content).toContain("`Furina-he/project-19`")
    expect(preview.files.find((f) => f.path === "references/cloudflare.md")?.content).toContain("`site-9.example.com`")

    // 超长列表静默截断，标记 descriptionTrimmed 而不发长度警告
    const manyServers: Asset[] = Array.from({ length: 50 }, (_, i) => ({
      ...server,
      id: `ast_many_${i}`,
      name: `Edge Node ${i}`,
      connection: { ...server.connection, sshAlias: `edge-${i}` },
      servedHostnames: [`site-${i}.example.com`],
      createdAt: `2026-10-01T00:00:${String(i).padStart(2, "0")}Z`,
    }))
    const big = compileSkill("windows", "claude-code", manyServers, skillConfig, settings)
    expect(big.budget.descriptionChars).toBeLessThanOrEqual(1024)
    expect(big.budget.descriptionTrimmed).toBe(true)
    expect(big.lint.some((l) => l.id === "description-too-long" || l.id === "body-too-long")).toBe(false)
  })
})
