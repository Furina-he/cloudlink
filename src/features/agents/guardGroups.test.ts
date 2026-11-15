import { describe, expect, it } from "vitest"

import { guardRules } from "@/mocks/fixtures-agent"
import { allowExamples, allowGroupOf, groupAllowlist } from "./guardGroups"

describe("只读巡检放行清单的分组（PRD 6.6）", () => {
  it("按命令的第一个词归到系统、服务与日志、Docker、云平台", () => {
    expect(allowGroupOf("df")).toBe("system")
    expect(allowGroupOf("ip addr")).toBe("system")
    expect(allowGroupOf("systemctl status")).toBe("services")
    expect(allowGroupOf("journalctl")).toBe("services")
    expect(allowGroupOf("curl -sI")).toBe("services")
    expect(allowGroupOf("docker compose ps")).toBe("docker")
    expect(allowGroupOf("wrangler tail")).toBe("cloud")
    expect(allowGroupOf("oci … list")).toBe("cloud")
  })

  it("每条命令只进一组，顺序固定，一条不丢", () => {
    const groups = groupAllowlist(guardRules.readOnlyAllow)
    expect(groups.map((g) => g.id)).toEqual(["system", "services", "docker", "cloud"])
    expect(groups.flatMap((g) => g.commands).sort()).toEqual([...guardRules.readOnlyAllow].sort())
    expect(groupAllowlist(["df"]).map((g) => g.id)).toEqual(["system"])
  })

  it("副行的例子优先用 df、docker ps、journalctl", () => {
    expect(allowExamples(guardRules.readOnlyAllow)).toEqual(["df", "docker ps", "journalctl"])
    expect(allowExamples(["uptime", "vercel ls"])).toEqual(["uptime", "vercel ls"])
  })
})
