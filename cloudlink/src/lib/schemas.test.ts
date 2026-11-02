import { describe, expect, it } from "vitest"

import {
  customTargetSchema,
  formatPorts,
  hostnameError,
  hostSchema,
  parsePorts,
  serviceDraftSchema,
  settingsNumbersSchema,
  skillConfigSchema,
} from "./schemas"

const err = (r: { success: boolean; error?: { issues: { message: string }[] } }) =>
  r.success ? null : r.error!.issues[0].message

describe("服务器地址（PRD 6.5）", () => {
  it("接受域名、IPv4、IPv6", () => {
    for (const host of ["edge.example.com", "203.0.113.10", "2001:db8::1", "[2001:db8::1]", "localhost"]) {
      expect(hostSchema.safeParse(host).success).toBe(true)
    }
  })

  it("拒绝空值、URL 和带端口的写法", () => {
    expect(err(hostSchema.safeParse("  "))).toBe("host-required")
    expect(err(hostSchema.safeParse("https://example.com"))).toBe("host-format")
    expect(err(hostSchema.safeParse("root@example.com"))).toBe("host-format")
    expect(err(hostSchema.safeParse("example.com:22"))).toBe("host-format")
  })
})

describe("端口映射（PRD 6.4 服务分段）", () => {
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

describe("Agent 页与设置", () => {
  it("运维约定不能为空；关系可以为空", () => {
    expect(skillConfigSchema.safeParse({ relationships: "", conventions: [] }).success).toBe(true)
    expect(err(skillConfigSchema.safeParse({ relationships: "", conventions: [{ id: "c1", text: "  " }] }))).toBe("convention-empty")
  })

  it("自定义目录要有名称和目录", () => {
    expect(customTargetSchema.safeParse({ label: "Cursor", path: "D:\\tools\\skills", envId: "windows" }).success).toBe(true)
    expect(err(customTargetSchema.safeParse({ label: " ", path: "D:\\x", envId: "windows" }))).toBe("name-required")
    expect(err(customTargetSchema.safeParse({ label: "x", path: "", envId: "windows" }))).toBe("dir-required")
  })

  it("正文行数上限和探测超时有合理范围", () => {
    expect(settingsNumbersSchema.safeParse({ bodyLineLimit: 100, probeTimeoutSec: 30 }).success).toBe(true)
    expect(err(settingsNumbersSchema.safeParse({ bodyLineLimit: 5, probeTimeoutSec: 30 }))).toBe("body-line-limit")
    expect(err(settingsNumbersSchema.safeParse({ bodyLineLimit: 100, probeTimeoutSec: 3600 }))).toBe("probe-timeout")
    expect(settingsNumbersSchema.safeParse({ bodyLineLimit: Number.NaN, probeTimeoutSec: 30 }).success).toBe(false)
  })
})
