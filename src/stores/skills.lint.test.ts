import { describe, expect, it } from "vitest"
import type { CompileStatus, LintItem } from "@/bindings"
import { selectAssetCompile } from "./skills"

const status = (envId: CompileStatus["envId"], line: number, value = "ignore-previous-instructions"): CompileStatus => ({ envId, agentKey: "claude-code", blocked: false, errors: 0, warnings: 1, compiledAt: null, lint: [{ id: "suspected-injection", level: "warning", assetId: "asset", file: "references/server.md", line, params: { alias: "server", value } } satisfies LintItem] })

describe("跨环境编译问题摘要", () => {
  it("引用和说明改变行号时，同一问题仍只计一次", () => {
    expect(selectAssetCompile([status("windows", 31), status("wsl:Ubuntu-24.04", 23)], "asset").warnings).toBe(1)
  })
  it("不同规则参数的真实问题不会一起隐藏", () => {
    expect(selectAssetCompile([status("windows", 31, "ignore-previous-instructions"), status("wsl:Ubuntu-24.04", 31, "override-guard")], "asset").warnings).toBe(2)
  })
})
