// The mock renderer only feeds the browser preview, but its fixed text is a hand-kept copy of
// the Rust templates. These checks compare that text with the compiler's golden files, so the
// preview cannot drift from what CloudLink really writes.
import { describe, expect, it } from "vitest"

import type { Asset, ServerAsset } from "@/bindings"
import goldenExecution from "../../src-tauri/tests/golden/windows-claude-code-cli/cloudlink-servers/references/execution.md?raw"
import goldenHealthCheck from "../../src-tauri/tests/golden/windows-claude-code-cli/cloudlink-servers/references/health-check.md?raw"
import goldenSkill from "../../src-tauri/tests/golden/windows-claude-code-cli/cloudlink-servers/SKILL.md?raw"
import { assets, settings, skillConfig } from "./fixtures"
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
    expect(skill).not.toMatch(/\| Mode \||full exit|While CloudLink runs/)
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

  it("stands in for an empty role and never prints empty parentheses", () => {
    const alias = server.connection.sshAlias
    const bare: Asset = { ...server, name: alias.toUpperCase(), summary: "", servedHostnames: [], services: [], production: false }
    expect(description([bare]).text).toContain(`— ${alias}. Use for any task on these servers or sites:`)
    const named: Asset = { ...bare, name: "Build box" }
    expect(description([named]).text).toContain(`— ${alias} (Build box). Use for`)
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
})
