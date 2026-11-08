import { describe, expect, it } from "vitest"

import type { CliAsset, CliEnvState, ServerAsset } from "@/bindings"
import * as fx from "@/mocks/fixtures"
import {
  cliEnvStatus,
  collectValues,
  connState,
  handleOf,
  isProdWritable,
  isServer,
  selectCanDistribute,
  selectCliAccount,
  selectCliProblem,
  selectResourceGroups,
} from "./assets"

const byId = Object.fromEntries(fx.assets.map((a) => [a.id, a]))
const ids = fx.assets.map((a) => a.id)
const servers = fx.assets.filter(isServer)
const [hkEdge, sgDb, devBox] = ["ast_hk_edge", "ast_sg_db", "ast_dev_box"].map((id) => byId[id] as ServerAsset)
const [cloudflare, vercel] = ["ast_cloudflare", "ast_vercel"].map((id) => byId[id] as CliAsset)

/** 在夹具上改连接或 CLI 状态 */
const withConn = (a: ServerAsset, patch: Partial<ServerAsset["connection"]>): ServerAsset => ({ ...a, connection: { ...a.connection, ...patch } })
const withEnvs = (a: CliAsset, envStates: CliAsset["cli"]["envStates"]): CliAsset => ({ ...a, cli: { ...a.cli, envStates } })
const env = (patch: Partial<CliEnvState>): CliEnvState => ({ installed: true, authenticated: true, expired: false, checkedAt: fx.ago(fx.MIN), ...patch })

describe("资源配电盘（PRD 6.4）", () => {
  it("分成服务器和云平台两组；组内按生产、预发、开发，再按名称排序", () => {
    const { servers: s, clis } = selectResourceGroups({ byId, ids }, "")
    // 中文名称按拼音：香港（xiang）在新加坡（xin）之前
    expect(s.map((a) => a.id)).toEqual(["ast_hk_edge", "ast_sg_db", "ast_dev_box"])
    expect(clis.map((a) => a.id)).toEqual(["ast_cloudflare", "ast_vercel", "ast_github"])
  })

  it("搜索匹配名称、别名、标签、站点名，云平台还匹配 CLI 名、账号和已选范围，不区分大小写", () => {
    const idsOf = (q: string) => {
      const g = selectResourceGroups({ byId, ids }, q)
      return [...g.servers, ...g.clis].map((a) => a.id)
    }
    expect(idsOf("1PANEL")).toEqual(["ast_hk_edge"])
    expect(idsOf("dev-box")).toEqual(["ast_dev_box"])
    expect(idsOf("blog.example")).toEqual(["ast_hk_edge"])
    expect(idsOf("新加坡")).toEqual(["ast_sg_db"])
    expect(idsOf("wrangler")).toEqual(["ast_cloudflare"])
    expect(idsOf("my-team")).toEqual(["ast_vercel"])
    expect(idsOf("api-gateway")).toEqual(["ast_cloudflare"])
    // 没勾选的范围不公开，也搜不到
    expect(idsOf("personal-blog")).toEqual([])
  })

  it("资源的标识：服务器是别名，云平台是云厂商", () => {
    expect(handleOf(hkEdge)).toBe("hk-edge")
    expect(handleOf(cloudflare)).toBe("cloudflare")
  })

  it("候选值去重、排序，跳过空值", () => {
    expect(collectValues(servers, (a) => [a.provider])).toEqual(["AWS Lightsail", "Tencent Cloud"])
    expect(collectValues(servers, (a) => a.tags)).toEqual(["1panel", "db", "edge"])
  })

  it("生产资源处于标准运维时琥珀色提醒，非生产或只读巡检不提醒", () => {
    expect(isProdWritable(sgDb)).toBe(true)
    expect(isProdWritable(hkEdge)).toBe(false)
    expect(isProdWritable(devBox)).toBe(false)
  })
})

describe("能否分发给新的 Agent（F-303 AC1）", () => {
  it("验证通过即可打开，imported 也一样", () => {
    expect(selectCanDistribute(hkEdge)).toEqual({ ok: true })
    expect(selectCanDistribute(sgDb)).toEqual({ ok: true })
  })

  it("只用密码时先说明原因，即使已经验证过", () => {
    expect(selectCanDistribute(devBox)).toEqual({ ok: false, reason: "password-only" })
    const verified = withConn(devBox, { verified: { ok: true, at: fx.ago(fx.MIN), envIds: ["windows"] } })
    expect(selectCanDistribute(verified)).toEqual({ ok: false, reason: "password-only" })
  })

  it("未验证、上次验证失败时不能打开", () => {
    expect(selectCanDistribute(withConn(hkEdge, { verified: null }))).toEqual({ ok: false, reason: "unverified" })
    const failed = withConn(hkEdge, { verified: { ok: false, at: fx.ago(fx.MIN), envIds: ["windows"] } })
    expect(selectCanDistribute(failed)).toEqual({ ok: false, reason: "failed" })
  })

  it("云平台：至少一个运行环境已就绪即可；全部未就绪时说明原因", () => {
    expect(selectCanDistribute(cloudflare)).toEqual({ ok: true })
    expect(selectCanDistribute(vercel)).toEqual({ ok: true })
    const none = withEnvs(vercel, { windows: env({ authenticated: false }), [fx.WSL]: env({ installed: false, authenticated: false }) })
    expect(selectCanDistribute(none)).toEqual({ ok: false, reason: "cli-not-ready" })
    expect(selectCanDistribute(withEnvs(vercel, {}))).toEqual({ ok: false, reason: "cli-not-ready" })
  })
})

describe("云平台 CLI 的状态（F-104、6.11）", () => {
  it("未安装优先于登录状态；登录已过期单独一种", () => {
    expect(cliEnvStatus(env({}))).toBe("ready")
    expect(cliEnvStatus(env({ installed: false, authenticated: true }))).toBe("not-installed")
    expect(cliEnvStatus(env({ authenticated: false }))).toBe("not-logged-in")
    expect(cliEnvStatus(env({ authenticated: true, expired: true }))).toBe("expired")
  })

  it("回路行就地修复：第一个有问题的运行环境，Windows 在前；全部就绪时为 null", () => {
    expect(selectCliProblem(cloudflare)).toBeNull()
    expect(selectCliProblem(vercel)).toEqual({ envId: fx.WSL, status: "not-logged-in" })
    const both = withEnvs(vercel, { [fx.WSL]: env({ authenticated: false }), windows: env({ installed: false, authenticated: false }) })
    expect(selectCliProblem(both)).toEqual({ envId: "windows", status: "not-installed" })
  })

  it("账号取第一个已就绪环境的 whoami", () => {
    expect(selectCliAccount(vercel)).toBe("my-team")
    expect(selectCliAccount(withEnvs(vercel, { windows: env({ authenticated: false, account: "old" }) }))).toBeUndefined()
  })
})

describe("连接状态（F-106 AC4）", () => {
  it("已连接、连接失败、未验证", () => {
    expect(connState(hkEdge)).toBe("connected")
    expect(connState(withConn(hkEdge, { verified: { ok: false, at: fx.ago(fx.MIN), envIds: ["windows"] } }))).toBe("failed")
    expect(connState(devBox)).toBe("unverified")
  })

  it("分发开着却没有验证结果：连接改过，需要重新测试", () => {
    expect(connState(withConn(hkEdge, { verified: null }))).toBe("changed")
  })
})
