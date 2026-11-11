import { beforeEach, describe, expect, it, vi } from "vitest"

import type { Asset, UpdateStatus } from "@/bindings"
import type { ConnectionTest } from "./connection"
import type { ProbeRun } from "./probe"

const fake = vi.hoisted(() => ({
  status: vi.fn(),
  install: vi.fn(),
}))

vi.mock("@/lib/ipc", () => ({
  ipc: {
    getUpdateStatus: fake.status,
    installUpdate: fake.install,
  },
  toIpcError: (error: unknown) => error,
}))

import { ipcErrorText, updateWaitText } from "@/lib/copy"
import { downloadPercent, findUpdateBlocker, hasUpdate, showReminder, useUpdateStore } from "./update"

const state = useUpdateStore.getState

const available: UpdateStatus = {
  state: "available",
  currentVersion: "0.1.0",
  version: "0.2.0",
  date: "2026-11-20T08:00:00Z",
  notes: "Faster probes",
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((yes) => {
    resolve = yes
  })
  return { promise, resolve }
}

beforeEach(() => {
  vi.resetAllMocks()
  useUpdateStore.setState({ status: null, dialogOpen: false, rejected: null })
})

describe("更新状态缓存（F-406）", () => {
  it("启动时读取一次快照；读取失败不打扰用户，提醒保持隐藏", async () => {
    fake.status.mockResolvedValueOnce(available)
    await state().load()
    expect(state().status).toEqual(available)

    useUpdateStore.setState({ status: null })
    fake.status.mockRejectedValueOnce({ id: "internal" })
    await state().load()
    expect(state().status).toBeNull()
  })

  it("读取期间收到的 update://changed 快照比读到的旧值新", async () => {
    const read = deferred<UpdateStatus>()
    fake.status.mockReturnValueOnce(read.promise)
    const loading = state().load()
    const downloading: UpdateStatus = { ...available, state: "downloading", downloaded: 0 }
    state()._onChanged(downloading)
    read.resolve(available)
    await loading
    expect(state().status).toEqual(downloading)
  })

  it("安装被拒绝时记下原因；再次点击或关闭对话框时清掉", async () => {
    const busy = { id: "update-busy", params: { task: "publish" } }
    fake.install.mockRejectedValueOnce(busy)
    state().setDialogOpen(true)
    await state().install()
    expect(state().rejected).toEqual(busy)

    const retry = deferred<void>()
    fake.install.mockReturnValueOnce(retry.promise)
    const installing = state().install()
    expect(state().rejected).toBeNull()
    retry.resolve()
    await installing

    fake.install.mockRejectedValueOnce(busy)
    await state().install()
    state().setDialogOpen(false)
    expect(state().rejected).toBeNull()
    expect(state().dialogOpen).toBe(false)
  })

  it("顶栏只在下好、正在安装或后台下载失败时提醒；后台下载期间不显示；总大小未知时没有百分比", () => {
    expect(hasUpdate(null)).toBe(false)
    expect(hasUpdate({ state: "idle", currentVersion: "0.1.0" })).toBe(false)
    expect(hasUpdate(available)).toBe(true)
    expect(hasUpdate({ ...available, state: "installing" })).toBe(true)

    expect(showReminder(null)).toBe(false)
    expect(showReminder({ state: "idle", currentVersion: "0.1.0" })).toBe(false)
    expect(showReminder(available)).toBe(false)
    expect(showReminder({ ...available, state: "downloading", downloaded: 0 })).toBe(false)
    expect(showReminder({ ...available, state: "ready" })).toBe(true)
    expect(showReminder({ ...available, state: "installing" })).toBe(true)
    expect(showReminder({ ...available, error: { id: "update-signature-invalid" } })).toBe(true)

    expect(downloadPercent({ ...available, state: "downloading", downloaded: 1024 })).toBeNull()
    expect(downloadPercent({ ...available, state: "downloading", downloaded: 0, total: 8192 })).toBe(0)
    expect(downloadPercent({ ...available, state: "downloading", downloaded: 3500, total: 8192 })).toBe(42)
    expect(downloadPercent({ ...available, state: "downloading", downloaded: 9000, total: 8192 })).toBe(100)
  })
})

describe("安装要等的任务（F-406 AC4）", () => {
  const hk = { id: "ast_hk", type: "vps", connection: { sshAlias: "hk-edge" } } as unknown as Asset
  const none = { tests: {}, runs: {}, starting: [], cli: {}, assets: { [hk.id]: hk } }
  const test = (status: ConnectionTest["status"], alias = "203.0.113.10"): ConnectionTest => ({ testId: "t", status, signature: "", alias })
  const run = (status: ProbeRun["status"]): ProbeRun => ({
    runId: "r",
    assetId: hk.id,
    status,
    steps: [],
    applied: [],
    held: [],
    confirmedIds: [],
    undone: false,
    startedAt: "2026-11-05T00:00:00Z",
  })

  it("没有进行中的任务时不用等", () => {
    expect(findUpdateBlocker(none)).toBeNull()
    expect(findUpdateBlocker({ ...none, tests: { [hk.id]: test("ok") }, runs: { r: run("ok") } })).toBeNull()
  })

  it("测试连接用资源标识，新建表单用别名；停在指纹确认时不算进行中", () => {
    expect(findUpdateBlocker({ ...none, tests: { [hk.id]: test("running") } })).toEqual({ task: "connection", name: "hk-edge" })
    expect(findUpdateBlocker({ ...none, tests: { new: test("running", "new-box") } })).toEqual({ task: "connection", name: "new-box" })
    expect(findUpdateBlocker({ ...none, tests: { new: test("running", "") } })).toEqual({ task: "connection", name: undefined })
    expect(findUpdateBlocker({ ...none, tests: { [hk.id]: test("host-key") } })).toBeNull()
  })

  it("按测试连接、探测、CLI 检测的顺序取第一项，与后端一致", () => {
    const probing = { ...none, runs: { r: run("running") }, cli: { vercel: { detecting: true } as never } }
    expect(findUpdateBlocker(probing)).toEqual({ task: "probe", name: "hk-edge" })
    expect(findUpdateBlocker({ ...probing, tests: { [hk.id]: test("running") } })?.task).toBe("connection")
    expect(findUpdateBlocker({ ...none, starting: [hk.id] })).toEqual({ task: "probe", name: "hk-edge" })
    expect(findUpdateBlocker({ ...none, cli: { oracle: { scopeLoading: true } as never } })).toEqual({ task: "cli", name: "oracle" })
  })

  it("等待说明：CLI 显示平台名称，后端返回的 update-busy 用同一句", () => {
    expect(updateWaitText("probe", "hk-edge")).toBe("正在探测 hk-edge，结束后再安装")
    expect(updateWaitText("cli", "cloudflare")).toBe("正在检测 Cloudflare CLI，结束后再安装")
    expect(updateWaitText("publish")).toBe("正在发布 Skill，结束后再安装")
    expect(ipcErrorText("update-busy", { task: "connection", name: "hk-edge" })).toBe("正在测试 hk-edge 的连接，结束后再安装。")
    expect(ipcErrorText("update-busy", { task: "publish" })).toBe("正在发布 Skill，结束后再安装。")
  })
})
