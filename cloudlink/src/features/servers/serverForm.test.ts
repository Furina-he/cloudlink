import type { FieldErrors } from "react-hook-form"
import { describe, expect, it } from "vitest"

import { WSL } from "@/mocks/fixtures"
import { serverFormSchema, type AliasContext, type ServerFormValues } from "@/lib/schemas"
import { baseAlias, connectionInputOfForm, firstError, newServerValues, uniqueAlias } from "./serverForm"

const ctx: AliasContext = {
  taken: ["hk-edge", "SG-DB"],
  sshHosts: [
    { alias: "jp-relay", definedIn: ["windows"] },
    { alias: "us-backup", definedIn: [WSL] },
  ],
}

/** 一份能通过校验的新建表单：私钥只配了 Windows，写入 Windows 和 WSL */
const valid = (patch: Partial<ServerFormValues> = {}, conn: Partial<ServerFormValues["connection"]> = {}): ServerFormValues => {
  const v = newServerValues(["windows", WSL])
  return {
    ...v,
    name: "东京中转机",
    alias: "tokyo",
    ...patch,
    connection: { ...v.connection, host: "198.51.100.20", identityFile: { windows: "C:\\Users\\me\\.ssh\\id_ed25519" }, ...conn },
  }
}

/** 和 RHF 一样，每个字段只看第一条错误 */
function errorsOf(values: ServerFormValues, context = ctx): Record<string, string> {
  const r = serverFormSchema(context).safeParse(values)
  const out: Record<string, string> = {}
  if (!r.success) for (const i of r.error.issues) out[i.path.join(".")] ??= i.message
  return out
}

describe("服务器表单校验（PRD 6.5）", () => {
  it("合法输入通过", () => {
    expect(errorsOf(valid())).toEqual({})
  })

  it("名称、地址、用户必填；地址不收 URL；端口在 1 到 65535 之间", () => {
    expect(errorsOf(valid({ name: " " }, { host: "", user: "" }))).toMatchObject({
      name: "name-required",
      "connection.host": "host-required",
      "connection.user": "user-required",
    })
    expect(errorsOf(valid({}, { host: "ssh://example.com" }))["connection.host"]).toBe("host-format")
    expect(errorsOf(valid({}, { port: 70000 }))["connection.port"]).toBe("port-format")
    expect(errorsOf(valid({}, { port: Number.NaN }))["connection.port"]).toBe("port-format")
  })

  it("别名必填、格式受限，与其他服务器重名时不区分大小写", () => {
    expect(errorsOf(valid({ alias: "" })).alias).toBe("alias-required")
    expect(errorsOf(valid({ alias: "my server" })).alias).toBe("alias-format")
    expect(errorsOf(valid({ alias: "sg-db" })).alias).toBe("alias-taken")
  })

  it("与要写入的运行环境 ssh config 里已有的 Host 重名（F-107 AC3）", () => {
    expect(errorsOf(valid({ alias: "jp-relay" })).alias).toBe("alias-conflict")
    // us-backup 只在 WSL 里；只写入 Windows 时不冲突
    expect(errorsOf(valid({ alias: "us-backup" }, { definedIn: ["windows"] })).alias).toBeUndefined()
    // 编辑自己时不算冲突
    expect(errorsOf(valid({ alias: "jp-relay" }), { ...ctx, selfAlias: "jp-relay" }).alias).toBeUndefined()
  })

  it("至少写入一个运行环境；私钥认证至少要给写入的一个环境配私钥", () => {
    expect(errorsOf(valid({}, { definedIn: [] }))["connection.definedIn"]).toBe("envs-required")
    expect(errorsOf(valid({}, { identityFile: { [WSL]: "/home/me/.ssh/id" }, definedIn: ["windows"] }))["connection.identityFile"]).toBe("key-required")
  })

  it("密码认证：没保存过密码时要填写", () => {
    expect(errorsOf(valid({}, { method: "password" }))["connection.password"]).toBe("password-required")
    expect(errorsOf(valid({}, { method: "password", password: "secret" }))).toEqual({})
    expect(errorsOf(valid({}, { method: "password", passwordSaved: true }))).toEqual({})
  })

  it("imported 不校验连接字段，也不检查 ssh config 冲突", () => {
    expect(errorsOf(valid({ source: "imported", alias: "jp-relay" }, { host: "", user: "", definedIn: [] }))).toEqual({})
  })
})

describe("别名生成（PRD 6.5，2026-10-31 用户确认）", () => {
  it("取名称里的英文字母和数字", () => {
    expect(baseAlias("HK Edge", "203.0.113.10")).toBe("hk-edge")
    expect(baseAlias("新加坡 DB 02", "")).toBe("db-02")
  })

  it("名称里没有时改用地址", () => {
    expect(baseAlias("东京中转机", "203.0.113.10")).toBe("vps-203-0-113-10")
    expect(baseAlias("开发机", "Edge.Example.com")).toBe("edge")
    expect(baseAlias("开发机", "[2001:db8::1]")).toBe("vps-2001-db8-1")
    expect(baseAlias("开发机", "")).toBe("")
  })

  it("重名时追加 -2、-3，不区分大小写", () => {
    expect(uniqueAlias("hk-edge", ["HK-EDGE"])).toBe("hk-edge-2")
    expect(uniqueAlias("hk-edge", ["hk-edge", "hk-edge-2"])).toBe("hk-edge-3")
    expect(uniqueAlias("tokyo", ["hk-edge"])).toBe("tokyo")
    expect(uniqueAlias("", ["x"])).toBe("")
  })
})

describe("测试连接和保存用的连接参数", () => {
  it("只保留写入的运行环境里填了的私钥，去掉首尾空白；跳板机空着时为 null", () => {
    const v = valid({ alias: " tokyo " }, { identityFile: { windows: " C:\\k ", [WSL]: "" }, proxyJump: " " })
    expect(connectionInputOfForm(v)).toEqual({
      source: "managed",
      sshAlias: "tokyo",
      host: "198.51.100.20",
      port: 22,
      user: "root",
      auth: { method: "key", identityFile: { windows: "C:\\k" } },
      proxyJump: null,
      definedIn: ["windows", WSL],
    })
  })

  it("密码不进入连接参数；imported 只有别名", () => {
    const pw = connectionInputOfForm(valid({}, { method: "password", password: "secret" }))
    expect(JSON.stringify(pw)).not.toContain("secret")
    expect(connectionInputOfForm(valid({ source: "imported" }))).toEqual({ source: "imported", sshAlias: "tokyo" })
  })
})

describe("保存校验失败时定位第一个出错字段（PRD 6.4）", () => {
  const leaf = { type: "custom", message: "x" }
  const at = (errors: object) => firstError(errors as FieldErrors<ServerFormValues>)

  it("按界面顺序：「连接配置」Tab 在「画像与规则」之前，名称在连接字段之前，别名在「高级」里", () => {
    expect(at({ name: leaf, connection: { user: leaf } })).toEqual({ tab: "connection", advanced: false, path: "name" })
    expect(at({ connection: { user: leaf }, rules: [{ text: leaf }] })).toEqual({ tab: "connection", advanced: false, path: "connection.user" })
    expect(at({ alias: leaf, servedHostnames: [leaf] })).toEqual({ tab: "connection", advanced: true, path: "alias" })
  })

  it("列表里的错误定位到具体一行的字段", () => {
    expect(at({ paths: [undefined, { label: leaf }] })).toEqual({ tab: "profile", advanced: false, path: "paths.1.label" })
    expect(at({ rules: [{ text: leaf }] })).toEqual({ tab: "profile", advanced: false, path: "rules.0.text" })
  })

  it("没有错误时为 null", () => {
    expect(at({})).toBeNull()
  })
})
