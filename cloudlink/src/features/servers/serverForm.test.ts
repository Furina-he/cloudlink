import type { FieldErrors } from "react-hook-form"
import { describe, expect, it } from "vitest"

import type { ServerAsset } from "@/bindings"
import { assets, WSL } from "@/mocks/fixtures"
import { serverFormSchema, type AliasContext, type ServerFormValues } from "@/lib/schemas"
import { connectionEditValues, connectionInputOfForm, firstError, formValuesOf, newServerIdentity, newServerValues, toAssetInput } from "./serverForm"

const ctx: AliasContext = {
  taken: ["hk-edge", "SG-DB"],
  sshHosts: [
    { alias: "jp-relay", definedIn: ["windows"] },
    { alias: "us-backup", definedIn: [WSL] },
  ],
}

/** 一份能通过校验的新建表单：私钥方式，私钥只配了 Windows，写入 Windows 和 WSL */
const valid = (patch: Partial<ServerFormValues> = {}, conn: Partial<ServerFormValues["connection"]> = {}): ServerFormValues => {
  const v = newServerValues(["windows", WSL])
  return {
    ...v,
    name: "东京中转机",
    alias: "tokyo",
    ...patch,
    connection: { ...v.connection, host: "198.51.100.20", method: "key", identityFile: { windows: "C:\\Users\\me\\.ssh\\id_ed25519" }, ...conn },
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

  it("新建时先选中密码（PRD 6.5，2026-11-10）", () => {
    expect(newServerValues(["windows", WSL]).connection.method).toBe("password")
  })

  it("添加表单里名称可空；缺省名称不能泄露连接地址（P8 D7）", () => {
    const r = serverFormSchema(ctx, { nameOptional: true }).safeParse(valid({ name: " " }))
    expect(r.success).toBe(true)
    expect(toAssetInput(valid({ name: " " }), undefined).name).toBe("服务器 1")
    expect(toAssetInput(valid({ name: " 东京 " }), undefined).name).toBe("东京")
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

  it("资料弹窗仍拒绝重复的类型与名称，不能因跳过连接校验漏掉它", () => {
    const service = { kind: "docker" as const, name: "worker", ports: [], critical: false, source: "manual" as const, missing: false }
    const v = valid({ services: [service, { ...service }] })
    const result = serverFormSchema(ctx, { profileOnly: true }).safeParse(v)
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues).toContainEqual(expect.objectContaining({ path: ["services", 1, "name"], message: "service-duplicate" }))
    // 保留旧服务表单的不同类型同名允许规则，现在由真正保存资料的 schema 验证。
    v.services[1].kind = "systemd"
    expect(serverFormSchema(ctx, { profileOnly: true }).safeParse(v).success).toBe(true)
  })

  it("imported 不校验连接字段，也不检查 ssh config 冲突", () => {
    expect(errorsOf(valid({ source: "imported", alias: "jp-relay" }, { host: "", user: "", definedIn: [] }))).toEqual({})
  })
})

describe("P8 连接草稿的字段边界", () => {
  it("只改导出，不把刚转换的密钥和后台更新的资料覆盖回密码", () => {
    const initial = structuredClone(assets.find((a) => a.id === "ast_dev_box") as ServerAsset)
    const draft = formValuesOf(initial), latest = structuredClone(initial)
    draft.export.listeningPorts = true
    latest.connection.auth = { method: "key", identityFile: { windows: "C:\\test\\new-key" }, generatedByCloudLink: true, passwordSaved: false }
    latest.name = "后台改名"
    latest.notes = "新的笔记"
    latest.export.image = false
    const values = connectionEditValues(draft, initial, latest)
    expect(values.connection.method).toBe("key")
    expect(values.connection.identityFile.windows).toBe("C:\\test\\new-key")
    expect(values.name).toBe("后台改名")
    expect(values.notes).toBe("新的笔记")
    expect(values.export).toMatchObject({ listeningPorts: true, image: false })
  })

  it("保留实际改动的目标和新密码，密码不做 trim", () => {
    const initial = structuredClone(assets.find((a) => a.id === "ast_dev_box") as ServerAsset)
    const draft = formValuesOf(initial), latest = structuredClone(initial)
    draft.connection.host = "new.example.com"
    draft.connection.password = " password with spaces "
    latest.connection.auth = { method: "key", identityFile: { windows: "C:\\test\\key" }, generatedByCloudLink: true, passwordSaved: false }
    const values = connectionEditValues(draft, initial, latest)
    expect(values.connection).toMatchObject({ host: "new.example.com", method: "password", password: " password with spaces " })
  })

  it("端口草稿保留无效输入并阻止保存，表单元数据不进入 Asset", () => {
    const service = { kind: "docker" as const, name: "worker", ports: [], portsText: "not a mapping", critical: false, source: "manual" as const, missing: false }
    expect(errorsOf(valid({ services: [service] }))["services.0.portsText"]).toBe("ports-format")
    service.portsText = "8080"
    const profile = serverFormSchema(ctx, { profileOnly: true }).safeParse(valid({ services: [service] }))
    expect(profile.success).toBe(false)
    if (!profile.success) expect(profile.error.issues).toContainEqual(expect.objectContaining({ path: ["services", 0, "portsText"], message: "ports-format" }))
    service.portsText = "127.0.0.1:8080->80"
    const input = toAssetInput(valid({ services: [service] }), undefined)
    expect(input.services[0].ports[0]).toMatchObject({ hostPort: 8080, containerPort: 80 })
    expect(input.services[0]).not.toHaveProperty("portsText")
    expect(input).not.toHaveProperty("fallbackName")
  })
})

describe("稳定的中性名称与 SSH 别名（P8 D7）", () => {
  it("不使用显示名称或连接地址分配新标识；跳过所有已占用别名", () => {
    expect(newServerIdentity([])).toEqual({ alias: "cloudlink-1", name: "服务器 1" })
    expect(newServerIdentity(["CLOUDLINK-1", "cloudlink-2", "hk-edge"])).toEqual({ alias: "cloudlink-3", name: "服务器 3" })
  })

  it("预填或修改名称、地址、认证方式不改动已经分配的标识", () => {
    const v = newServerValues(["windows"], newServerIdentity(["cloudlink-1"]))
    v.name = "東京 HK 203.0.113.10"
    v.connection.host = "198.51.100.20"
    v.connection.method = "agent"
    expect(connectionInputOfForm(v).sshAlias).toBe("cloudlink-2")
    v.name = ""
    expect(toAssetInput(v, undefined).name).toBe("服务器 2")
    expect(newServerValues(["windows", WSL], { alias: v.alias, name: v.fallbackName }).alias).toBe(v.alias)
  })

  it("历史自定义别名、导入别名不会因为重命名而改动", async () => {
    const { assets } = await import("@/mocks/fixtures")
    for (const a of assets.filter((x) => x.type === "vps")) {
      const v = formValuesOf(a)
      v.name = "新名称"
      expect(toAssetInput(v, a).connection.sshAlias).toBe(a.connection.sshAlias)
    }
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

  it("按界面顺序：地址、端口、用户在名称之前（添加表单，PRD 6.5），连接字段在画像之前，别名在连接编辑的「高级」里", () => {
    expect(at({ name: leaf, connection: { user: leaf } })).toEqual({ advanced: false, path: "connection.user" })
    expect(at({ name: leaf, connection: { password: leaf } })).toEqual({ advanced: false, path: "name" })
    expect(at({ connection: { user: leaf }, rules: [{ text: leaf }] })).toEqual({ advanced: false, path: "connection.user" })
    expect(at({ alias: leaf, servedHostnames: [leaf] })).toEqual({ advanced: true, path: "alias" })
  })

  it("列表里的错误定位到具体一行的字段", () => {
    expect(at({ paths: [undefined, { label: leaf }] })).toEqual({ advanced: false, path: "paths.1.label" })
    expect(at({ rules: [{ text: leaf }] })).toEqual({ advanced: false, path: "rules.0.text" })
  })

  it("没有错误时为 null", () => {
    expect(at({})).toBeNull()
  })
})
