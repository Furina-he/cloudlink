import { describe, expect, it } from "vitest"
import type { CliAsset, ServerAsset } from "@/bindings"
import { assets } from "@/mocks/fixtures"
import { cliProfileInput, cliValuesOf, renameInputOf, serverProfileInput } from "./profileForm"
import { formValuesOf } from "./serverForm"

const server = () => structuredClone(assets.find((a) => a.id === "ast_hk_edge") as ServerAsset)

describe("P8 资料保存的字段边界", () => {
  it("改名不修改别名、认证、已采集事实和权限", () => {
    const a = server(), input = renameInputOf(a, "新名称")
    expect(input.name).toBe("新名称")
    if (input.type !== "vps") throw new Error("wrong type")
    expect(input.connection.sshAlias).toBe(a.connection.sshAlias)
    expect(input.facts).toEqual(a.facts)
    expect(input).not.toHaveProperty("agent")
  })

  it("保存资料时保留最新连接、事实及后台新增的服务", () => {
    const initial = server(), draft = structuredClone(formValuesOf(initial)), latest = server()
    draft.summary = "新的用途"
    draft.services[0].role = "人工用途"
    latest.connection.host = "changed.example.com"
    latest.facts.os = "新探测系统"
    latest.services[0].image = "new-image:2"
    latest.services[0].missing = true
    latest.services.push({ kind: "docker", name: "new-worker", ports: [], critical: false, source: "probe", missing: false })
    latest.notes += "\n后台并入的笔记"
    const result = serverProfileInput(draft, initial, latest)
    expect(result.summary).toBe(draft.summary)
    expect(result.connection).toMatchObject({ host: "changed.example.com" })
    expect(result.facts.os).toBe("新探测系统")
    expect(result.services[0]).toMatchObject({ image: "new-image:2", role: "人工用途", missing: true })
    expect(result.services.at(-1)?.name).toBe("new-worker")
    expect(result.notes).toBe(latest.notes)
  })

  it("移除资料里的服务记录不会复活它，也不会删除后台新增记录", () => {
    const initial = server(), latest = server(), draft = formValuesOf(initial)
    const removed = draft.services.shift()!
    const result = serverProfileInput(draft, initial, latest)
    expect(result.services.some((s) => s.name === removed.name)).toBe(false)
  })

  it("手工服务的镜像和端口仍能维护，不改动探测事实", () => {
    const initial = server()
    initial.services.push({ kind: "docker", name: "manual-worker", image: "worker:1", ports: [], source: "manual", critical: false, missing: false })
    const latest = structuredClone(initial), draft = formValuesOf(initial)
    const manual = draft.services.find((s) => s.name === "manual-worker")!
    manual.image = "worker:2"
    manual.ports = [{ hostIp: "127.0.0.1", hostPort: 8080, containerPort: 80, proto: "tcp" }]
    manual.portsText = "127.0.0.1:8080->80"
    latest.services[0].image = "new-probe:2"
    const result = serverProfileInput(draft, initial, latest)
    expect(result.services.find((s) => s.name === "manual-worker")).toMatchObject({ image: "worker:2", ports: manual.ports })
    expect(result.services[0].image).toBe("new-probe:2")
    expect(initial.services.find((s) => s.name === "manual-worker")?.image).toBe("worker:1")
  })

  it("手工新记录撞上后台首次探测的同名服务时，保留新事实并合并人工标注", () => {
    const initial = server(), latest = server(), draft = formValuesOf(initial)
    draft.services.push({ kind: "docker", name: "new-api", image: "manual:1", ports: [], portsText: "1234->80", role: "对外 API", critical: true, source: "manual", missing: false })
    const probed = { kind: "docker" as const, name: "new-api", image: "api:2", ports: [{ hostIp: "127.0.0.1", hostPort: 8080, containerPort: 80, proto: "tcp" as const }], source: "probe" as const, lastSeenAt: "2026-11-14T00:00:00Z", critical: false, missing: false }
    latest.services.push(probed)
    const input = serverProfileInput(draft, initial, latest)
    const merged = input.services.filter((s) => s.name === "new-api")
    expect(merged).toHaveLength(1)
    expect(merged[0]).toMatchObject({ ...probed, role: "对外 API", critical: true })
  })

  it("云平台只改资料，保留最新账号与生产标记", () => {
    const initial = structuredClone(assets.find((a) => a.type === "cli") as CliAsset)
    const draft = cliValuesOf(initial), latest = structuredClone(initial)
    draft.name = "新的显示名称"
    latest.account = "changed-account"
    latest.production = !initial.production
    const input = cliProfileInput(draft, initial, latest)
    expect(input.name).toBe(draft.name)
    expect(input.account).toBe(latest.account)
    expect(input.production).toBe(latest.production)
  })
})
