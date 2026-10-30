import { describe, expect, it } from "vitest"

import {
  assetFormSchema,
  formatPorts,
  hostnameError,
  parsePorts,
  projectFormSchema,
  serviceDraftSchema,
  settingsNumbersSchema,
  slugSchema,
  uniqueSlugSchema,
} from "./schemas"

const err = (r: { success: boolean; error?: { issues: { message: string }[] } }) =>
  r.success ? null : r.error!.issues[0].message

describe("slug 校验（PRD 5.1、5.4）", () => {
  it("接受合法 slug", () => {
    expect(slugSchema.safeParse("vps-hk-edge").success).toBe(true)
    expect(slugSchema.safeParse("a".repeat(64)).success).toBe(true)
  })

  it("拒绝格式错误、超长与保留名", () => {
    expect(err(slugSchema.safeParse("VPS"))).toBe("slug-format")
    expect(err(slugSchema.safeParse("-a"))).toBe("slug-format")
    expect(err(slugSchema.safeParse("a--b"))).toBe("slug-format")
    expect(err(slugSchema.safeParse("a".repeat(65)))).toBe("slug-too-long")
    expect(err(slugSchema.safeParse("synced"))).toBe("slug-reserved")
  })

  it("唯一性检查排除自身", () => {
    const taken = [{ id: "a1", slug: "vps-hk-edge" }]
    expect(err(uniqueSlugSchema(taken).safeParse("vps-hk-edge"))).toBe("slug-taken")
    expect(uniqueSlugSchema(taken, "a1").safeParse("vps-hk-edge").success).toBe(true)
  })
})

describe("端口映射（PRD 6.4 服务页）", () => {
  it("解析主机地址和协议，空串得到空列表", () => {
    expect(parsePorts("127.0.0.1:8080->8080, 80->80/udp")).toEqual([
      { hostIp: "127.0.0.1", hostPort: 8080, containerPort: 8080, proto: "tcp" },
      { hostIp: "0.0.0.0", hostPort: 80, containerPort: 80, proto: "udp" },
    ])
    expect(parsePorts("  ")).toEqual([])
  })

  it("格式或端口范围不对时返回 null", () => {
    expect(parsePorts("8080")).toBeNull()
    expect(parsePorts("1.2.3.4:70000->80")).toBeNull()
    expect(parsePorts("80->80/sctp")).toBeNull()
  })

  it("格式化后可以再解析回来", () => {
    const text = "127.0.0.1:8080->8080, 0.0.0.0:53->53/udp"
    expect(formatPorts(parsePorts(text)!)).toBe(text)
  })
})

describe("资产表单（PRD 6.4）", () => {
  const base = {
    name: "东京中转机",
    slug: "vps-jp-relay",
    envTag: "dev",
    provider: "",
    region: "",
    tags: [],
    summary: "",
    servedHostnames: ["api.example.com"],
    notes: "",
    sshAlias: "jp-relay",
    paths: [{ key: "p1", label: "站点", path: "/www", source: "manual" }],
    services: [],
    rules: [{ id: "r1", text: "禁止重启" }],
    defaultMode: "read-only",
    export: { resolvedConnection: false, listeningPorts: false, image: true },
  }
  const schema = assetFormSchema([{ id: "a1", slug: "vps-hk-edge" }])

  it("合法输入通过", () => {
    expect(schema.safeParse(base).success).toBe(true)
  })

  it("名称、别名必填；slug 不能与其他资产重复；路径和红线不能为空", () => {
    const r = schema.safeParse({
      ...base,
      name: " ",
      sshAlias: "",
      slug: "vps-hk-edge",
      paths: [{ ...base.paths[0], path: "" }],
      rules: [{ id: "r1", text: "  " }],
      servedHostnames: ["api.example.com", "203.0.113.10"],
    })
    expect(r.success).toBe(false)
    // 和 RHF 一样，每个字段只看第一条错误
    const byPath: Record<string, string> = {}
    for (const i of r.error!.issues) byPath[i.path.join(".")] ??= i.message
    expect(byPath).toMatchObject({
      name: "name-required",
      sshAlias: "alias-required",
      slug: "slug-taken",
      "paths.0.path": "path-required",
      "rules.0.text": "rule-empty",
      "servedHostnames.1": "hostname-ip",
    })
  })
})

describe("承载的站点", () => {
  it("接受域名和一层通配", () => {
    expect(hostnameError("api.example.com")).toBeNull()
    expect(hostnameError("*.example.com")).toBeNull()
    expect(hostnameError("localhost")).toBeNull()
  })

  it("不收 IP，拒绝格式不对的值", () => {
    expect(hostnameError("203.0.113.10")).toBe("hostname-ip")
    expect(hostnameError("API.example.com")).toBe("hostname-format")
    expect(hostnameError("example.com:8443")).toBe("hostname-format")
    expect(hostnameError("-bad.example.com")).toBe("hostname-format")
    expect(hostnameError("a.*.example.com")).toBe("hostname-format")
  })
})

describe("手动添加服务", () => {
  const draft = { kind: "docker", name: "openresty", image: "", ports: "", role: "", critical: false }

  it("同类型、同名称的服务不能重复", () => {
    const schema = serviceDraftSchema([{ kind: "docker", name: "openresty" }])
    expect(err(schema.safeParse(draft))).toBe("service-duplicate")
    expect(schema.safeParse({ ...draft, kind: "systemd" }).success).toBe(true)
  })

  it("端口格式不对时报错", () => {
    expect(err(serviceDraftSchema([]).safeParse({ ...draft, ports: "8080" }))).toBe("ports-format")
  })
})

describe("P3 表单校验", () => {
  it("添加项目至少要一个约定目录", () => {
    const r = projectFormSchema.safeParse({ label: "infra-tools", conventions: [], gitExclude: true })
    expect(r.success).toBe(false)
    expect(r.error?.issues[0].message).toBe("convention-required")
    expect(projectFormSchema.safeParse({ label: "x", conventions: ["claude"], gitExclude: false }).success).toBe(true)
  })

  it("正文行数上限和探测超时有合理范围", () => {
    expect(settingsNumbersSchema.safeParse({ bodyLineLimit: 60, probeTimeoutSec: 30 }).success).toBe(true)
    expect(settingsNumbersSchema.safeParse({ bodyLineLimit: 5, probeTimeoutSec: 30 }).error?.issues[0].message).toBe("body-line-limit")
    expect(settingsNumbersSchema.safeParse({ bodyLineLimit: 60, probeTimeoutSec: 3600 }).error?.issues[0].message).toBe("probe-timeout")
    expect(settingsNumbersSchema.safeParse({ bodyLineLimit: Number.NaN, probeTimeoutSec: 30 }).success).toBe(false)
  })
})
