import { beforeEach, describe, expect, it, vi } from "vitest"

import type { Asset, AssetInput, CliAsset, DeleteResult, DistributeResult, SaveResult, ServerAsset } from "@/bindings"
import { cliProfileInput, cliValuesOf, renameInputOf, serverProfileInput } from "@/features/servers/profileForm"
import { formValuesOf } from "@/features/servers/serverForm"
import * as fx from "@/mocks/fixtures"

const fake = vi.hoisted(() => ({ save: vi.fn(), remove: vi.fn(), mode: vi.fn(), distribute: vi.fn(), scope: vi.fn() }))

vi.mock("@/lib/ipc", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ipc")>()
  return { ...actual, ipc: { ...actual.ipc, saveAsset: fake.save, deleteAsset: fake.remove, setMode: fake.mode, setDistribute: fake.distribute, setCliScope: fake.scope } }
})

import { useAssetStore } from "./assets"
import { useDeliveryStore } from "./deliveries"
import { compileKey, useSkillStore } from "./skills"

const state = useAssetStore.getState
const server = fx.assets.find((a) => a.id === "ast_hk_edge") as ServerAsset
const cli = fx.assets.find((a) => a.id === "ast_cloudflare") as CliAsset
const at = "2026-11-14T00:00:00Z"

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

/** 红测也先释放注入的延迟请求，避免一次失败把后续用例的同 id 队列卡住。 */
async function expectQueued(mock: ReturnType<typeof vi.fn>, release: () => void, work: Promise<unknown>[]) {
  await Promise.resolve()
  if (mock.mock.calls.length) {
    release()
    await Promise.allSettled(work)
  }
  expect(mock.mock.calls.length).toBe(0)
}

function snapshot(asset: Asset, key = "saved"): SaveResult {
  return {
    asset,
    statuses: [{ envId: "windows", agentKey: key, blocked: false, errors: 0, warnings: 0, compiledAt: at, lint: [] }],
    inclusions: [{ assetId: asset.id, envId: "windows", agentKey: key, included: true }],
    deliveries: [{ id: `delivery-${key}`, targetId: `target-${key}`, envId: "windows", path: `D:/cloudlink-test/${key}/cloudlink-servers`, status: "ok", checkedAt: at }],
  }
}

/** 内存里的 IPC 替身；不调用真实 Tauri、配置目录或凭据库。 */
function saveResult(input: AssetInput): SaveResult {
  const latest = state().byId[input.id!]
  if (input.type === "cli" && latest.type === "cli") return snapshot({ ...latest, ...input, id: latest.id })
  if (input.type === "vps" && latest.type === "vps") {
    return snapshot({
      ...latest,
      ...input,
      id: latest.id,
      connection: {
        ...latest.connection,
        ...input.connection,
        auth: input.connection.source === "managed" ? {
          generatedByCloudLink: latest.connection.auth?.generatedByCloudLink ?? false,
          passwordSaved: latest.connection.auth?.passwordSaved ?? false,
          ...input.connection.auth,
        } : latest.connection.auth,
      },
    })
  }
  throw new Error("Unexpected asset type in save fixture")
}

beforeEach(() => {
  vi.resetAllMocks()
  const assets = structuredClone([server, cli])
  useAssetStore.setState({ byId: Object.fromEntries(assets.map((a) => [a.id, a])), ids: assets.map((a) => a.id), lastSaved: {}, freshIds: [] })
  useSkillStore.setState({ statusByKey: {} })
  useDeliveryStore.setState({ byId: {}, inclusions: [] })
  fake.save.mockImplementation(async (input: AssetInput) => saveResult(input))
  fake.remove.mockResolvedValue({ statuses: [] })
})

describe("同资源保存串行与 latest-builder（P8a／b）", () => {
  it("现有 save(input) 也按持久化 id 串行，不能提前发送第二份完整输入", async () => {
    const pending = deferred<SaveResult>()
    fake.save.mockReturnValueOnce(pending.promise)
    const first = state().save({ ...renameInputOf(server, server.name), production: false })
    await vi.waitFor(() => expect(fake.save).toHaveBeenCalledTimes(1))
    const second = state().save(renameInputOf(server, "新名称"))
    await Promise.resolve()
    expect(fake.save).toHaveBeenCalledTimes(1)

    pending.resolve(snapshot({ ...server, production: false }))
    await Promise.all([first, second])
    expect(fake.save).toHaveBeenCalledTimes(2)
    expect(fake.save.mock.calls[1][0].name).toBe("新名称")
  })

  it("生产保存 A 延迟时改名 B 排队；B 的 builder 在完整发布快照写回后执行", async () => {
    const pending = deferred<SaveResult>()
    const resultA = snapshot({ ...server, production: false }, "production-a")
    fake.save.mockReturnValueOnce(pending.promise)
    const first = state().save({ ...renameInputOf(server, server.name), production: false })
    await vi.waitFor(() => expect(fake.save).toHaveBeenCalledTimes(1))
    const build = vi.fn((latest: Asset) => {
      expect(latest.production).toBe(false)
      expect(useSkillStore.getState().statusByKey).toEqual(Object.fromEntries(resultA.statuses.map((s) => [compileKey(s), s])))
      expect(useDeliveryStore.getState().inclusions).toEqual(resultA.inclusions)
      expect(Object.values(useDeliveryStore.getState().byId)).toEqual(resultA.deliveries)
      return renameInputOf(latest, "新名称")
    })
    const second = state().update(server.id, build)
    expect(build).not.toHaveBeenCalled()

    pending.resolve(resultA)
    await Promise.all([first, second])
    expect(build).toHaveBeenCalledTimes(1)
    expect(fake.save.mock.calls[1][0]).toMatchObject({ id: server.id, name: "新名称", production: false })
    expect(state().byId[server.id]).toMatchObject({ name: "新名称", production: false, connection: { sshAlias: server.connection.sshAlias, verified: server.connection.verified } })
  })

  it.each([server, cli])("$type 资料／名称保存 A 延迟时生产 B 只覆盖 production，保留 A 的新资料", async (initial) => {
    const pending = deferred<SaveResult>()
    const changed: Asset = { ...initial, name: "已保存的新名称", summary: "已保存的新用途", notes: "已保存的新笔记", guardrails: { rules: [{ id: "r-new", text: "新红线" }] } }
    if (changed.type === "vps") {
      changed.tags = ["new-tag"]
      changed.servedHostnames = ["new.example.com"]
      changed.provider = "New Provider"
      changed.region = "New Region"
    }
    fake.save.mockReturnValueOnce(pending.promise)
    const first = initial.type === "vps"
      ? state().update(initial.id, (latest) => serverProfileInput(formValuesOf(changed as ServerAsset), initial, latest as ServerAsset))
      : state().update(initial.id, (latest) => cliProfileInput(cliValuesOf(changed as CliAsset), initial, latest as CliAsset))
    await vi.waitFor(() => expect(fake.save).toHaveBeenCalledTimes(1))
    const second = state().update(initial.id, (latest) => ({ ...renameInputOf(latest, latest.name), production: false }))
    expect(fake.save).toHaveBeenCalledTimes(1)

    pending.resolve(snapshot(changed, "profile-a"))
    await Promise.all([first, second])
    expect(fake.save.mock.calls[1][0]).toMatchObject({ name: changed.name, summary: changed.summary, notes: changed.notes, guardrails: changed.guardrails, production: false })
    if (changed.type === "vps") expect(fake.save.mock.calls[1][0]).toMatchObject({ tags: changed.tags, servedHostnames: changed.servedHostnames, provider: changed.provider, region: changed.region })
    expect(state().byId[initial.id]).toMatchObject({ ...changed, production: false })
  })

  it("保存失败会释放队列；后续 builder 沿用最后成功的资源并能继续保存", async () => {
    const pending = deferred<SaveResult>()
    fake.save.mockReturnValueOnce(pending.promise)
    const first = state().save(renameInputOf(server, "不应写回的名称"))
    const rejected = expect(first).rejects.toEqual({ id: "internal", params: { message: "disk busy" } })
    await vi.waitFor(() => expect(fake.save).toHaveBeenCalledTimes(1))
    const second = state().update(server.id, (latest) => {
      expect(latest.name).toBe(server.name)
      return renameInputOf(latest, "重试后的名称")
    })
    pending.reject("disk busy")
    await rejected
    await second
    expect(fake.save).toHaveBeenCalledTimes(2)
    expect(state().byId[server.id].name).toBe("重试后的名称")
  })

  it("不同资源没有全局互锁，一个资源的慢发布不阻塞另一个资源", async () => {
    const pending = deferred<SaveResult>()
    fake.save.mockReturnValueOnce(pending.promise)
    const first = state().save(renameInputOf(server, "慢资源"))
    await vi.waitFor(() => expect(fake.save).toHaveBeenCalledTimes(1))
    const second = await state().update(cli.id, (latest) => renameInputOf(latest, "另一资源"))
    expect(second.asset).toMatchObject({ id: cli.id, name: "另一资源" })
    expect(state().byId[server.id].name).toBe(server.name)

    pending.resolve(snapshot({ ...server, name: "慢资源" }))
    await first
    expect(state().byId[server.id].name).toBe("慢资源")
  })

  it("资源已删除时 update 返回既有 not-found，不运行 builder、不新建资源", async () => {
    useAssetStore.setState({ byId: {}, ids: [] })
    const build = vi.fn(() => renameInputOf(server, "不应新建"))
    await expect(state().update(server.id, build)).rejects.toEqual({ id: "not-found" })
    expect(build).not.toHaveBeenCalled()
    expect(fake.save).not.toHaveBeenCalled()
  })

  it("删除排在已有保存之后；删除后的更新不能被前一次保存响应复活", async () => {
    const pending = deferred<SaveResult>()
    fake.save.mockReturnValueOnce(pending.promise)
    const first = state().save(renameInputOf(server, "保存中的名称"))
    await vi.waitFor(() => expect(fake.save).toHaveBeenCalledTimes(1))
    const removed = state().remove(server.id, false)
    await expectQueued(fake.remove, () => pending.resolve(snapshot({ ...server, name: "保存中的名称" })), [first, removed])
    const build = vi.fn((latest: Asset) => renameInputOf(latest, "不应复活"))
    const afterDelete = state().update(server.id, build)
    const rejected = expect(afterDelete).rejects.toEqual({ id: "not-found" })

    pending.resolve(snapshot({ ...server, name: "保存中的名称" }))
    await Promise.all([first, removed])
    await rejected
    expect(fake.remove).toHaveBeenCalledWith(server.id, { removeGeneratedKey: false })
    expect(build).not.toHaveBeenCalled()
    expect(fake.save).toHaveBeenCalledTimes(1)
    expect(state().byId[server.id]).toBeUndefined()
    expect(state().ids).not.toContain(server.id)
  })

  it("删除请求进行中时更新等待，成功删除后 builder 返回 not-found", async () => {
    const pending = deferred<DeleteResult>()
    fake.remove.mockReturnValueOnce(pending.promise)
    const removed = state().remove(server.id, true)
    await vi.waitFor(() => expect(fake.remove).toHaveBeenCalledTimes(1))
    const build = vi.fn((latest: Asset) => renameInputOf(latest, "不应保存"))
    const afterDelete = state().update(server.id, build)
    const outcome = afterDelete.catch((error: unknown) => error)
    await expectQueued(build, () => pending.resolve({ statuses: [] }), [removed, outcome])
    expect(fake.save).not.toHaveBeenCalled()

    pending.resolve({ statuses: [] })
    await removed
    await expect(outcome).resolves.toEqual({ id: "not-found" })
    expect(state().byId[server.id]).toBeUndefined()
  })

  it("删除失败释放队列并保留资源，后续更新仍可成功", async () => {
    const pending = deferred<DeleteResult>()
    fake.remove.mockReturnValueOnce(pending.promise)
    const removed = state().remove(server.id, false)
    const outcome = removed.catch((error: unknown) => error)
    await vi.waitFor(() => expect(fake.remove).toHaveBeenCalledTimes(1))
    const build = vi.fn((latest: Asset) => {
      expect(latest.name).toBe(server.name)
      return renameInputOf(latest, "删除失败后改名")
    })
    const next = state().update(server.id, build)
    await expectQueued(build, () => pending.reject("delete denied"), [outcome, next])

    pending.reject("delete denied")
    await expect(outcome).resolves.toEqual({ id: "internal", params: { message: "delete denied" } })
    await next
    expect(fake.save).toHaveBeenCalledTimes(1)
    expect(state().byId[server.id].name).toBe("删除失败后改名")
  })

  it.each([
    { action: "setMode" as const, initial: server },
    { action: "setDistribute" as const, initial: server },
    { action: "setCliScope" as const, initial: cli },
  ])("$action 与保存共用队列，后续 builder 读取其完整最新结果且公共返回值不变", async ({ action, initial }) => {
    const a = deferred<SaveResult>(), b = deferred<DistributeResult>()
    const resultA = snapshot({ ...initial, name: "前一次保存" }, "save-a")
    fake.save.mockReturnValueOnce(a.promise)
    const first = state().save(renameInputOf(initial, "前一次保存"))
    await vi.waitFor(() => expect(fake.save).toHaveBeenCalledTimes(1))
    const mutation = { setMode: fake.mode, setDistribute: fake.distribute, setCliScope: fake.scope }[action]
    mutation.mockReturnValueOnce(b.promise)
    const changed: Asset = action === "setMode"
      ? { ...resultA.asset, agent: { ...initial.agent, mode: "standard" } }
      : action === "setDistribute"
        ? { ...resultA.asset, agent: { ...initial.agent, agents: [] } }
        : { ...(resultA.asset as CliAsset), cli: { ...cli.cli, scope: cli.cli.scope.map((item) => ({ ...item, selected: false })) } }
    const resultB: DistributeResult = { ...snapshot(changed, action), affectedAgentKeys: ["claude-code", "universal"] }
    const changing = action === "setMode" ? state().setMode(initial.id, "standard")
      : action === "setDistribute" ? state().setDistribute(initial.id, "claude-code", false)
        : state().setCliScope(initial.id, [])
    await expectQueued(mutation, () => { a.resolve(resultA); b.resolve(resultB) }, [first, changing])

    a.resolve(resultA)
    await first
    await vi.waitFor(() => expect(mutation).toHaveBeenCalledTimes(1))
    const build = vi.fn((latest: Asset) => {
      expect(latest).toMatchObject(changed)
      expect(useSkillStore.getState().statusByKey).toEqual(Object.fromEntries(resultB.statuses.map((s) => [compileKey(s), s])))
      expect(Object.values(useDeliveryStore.getState().byId)).toEqual(resultB.deliveries)
      expect(useDeliveryStore.getState().inclusions).toEqual(resultB.inclusions)
      return renameInputOf(latest, "最后改名")
    })
    const last = state().update(initial.id, build)
    expect(build).not.toHaveBeenCalled()
    b.resolve(resultB)
    const [returned] = await Promise.all([changing, last])
    expect(returned).toEqual(action === "setDistribute" ? resultB : undefined)
    expect(build).toHaveBeenCalledTimes(1)
    expect(state().byId[initial.id]).toMatchObject({ ...changed, name: "最后改名" })
  })

  it("范围保存失败时从队首基线恢复，不把前一次成功保存的新资料回滚", async () => {
    const a = deferred<SaveResult>(), b = deferred<SaveResult>()
    const resultA = snapshot({ ...cli, name: "新的云平台名称", notes: "新笔记" }, "save-a")
    fake.save.mockReturnValueOnce(a.promise)
    const first = state().save(renameInputOf(cli, "新的云平台名称"))
    await vi.waitFor(() => expect(fake.save).toHaveBeenCalledTimes(1))
    fake.scope.mockReturnValueOnce(b.promise)
    const scope = state().setCliScope(cli.id, [])
    const outcome = scope.catch((error: unknown) => error)
    await expectQueued(fake.scope, () => { a.resolve(resultA); b.reject({ id: "cli-scope-failed" }) }, [first, outcome])
    a.resolve(resultA)
    await first
    await vi.waitFor(() => expect(fake.scope).toHaveBeenCalledTimes(1))
    const last = state().update(cli.id, (latest) => {
      expect(latest).toMatchObject(resultA.asset)
      return renameInputOf(latest, "范围失败后改名")
    })
    b.reject({ id: "cli-scope-failed" })
    await expect(outcome).resolves.toEqual({ id: "cli-scope-failed" })
    await last
    expect(state().byId[cli.id]).toMatchObject({ ...resultA.asset, name: "范围失败后改名" })
  })
})
