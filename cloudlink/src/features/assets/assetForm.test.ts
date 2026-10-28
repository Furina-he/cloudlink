import { describe, expect, it } from "vitest"

import { assetFormSchema, type AssetFormValues } from "@/lib/schemas"
import * as fx from "@/mocks/fixtures"
import {
  countTabErrors,
  firstErrorPath,
  formValuesOf,
  newAssetValues,
  slugFromAlias,
  toAssetInput,
} from "./assetForm"

const hk = fx.assets.find((a) => a.id === "ast_hk_edge")!

/** 用真实的 zod 校验结果拼出 RHF 形状的错误对象（数组字段按下标嵌套） */
function errorsOf(values: AssetFormValues) {
  const r = assetFormSchema([]).safeParse(values)
  const errors: Record<string, unknown> = {}
  for (const issue of r.error?.issues ?? []) {
    let node = errors
    issue.path.forEach((key, i) => {
      if (i === issue.path.length - 1) {
        node[String(key)] = { type: issue.code, message: issue.message }
        return
      }
      node[String(key)] ??= typeof issue.path[i + 1] === "number" ? [] : {}
      node = node[String(key)] as Record<string, unknown>
    })
  }
  return errors
}

describe("表单与 AssetInput 的换算", () => {
  it("往返不丢字段；表单之外的事实、监听端口沿用已保存的资产", () => {
    const input = toAssetInput(formValuesOf(hk), hk)
    expect(input.id).toBe(hk.id)
    expect(input.facts).toEqual(hk.facts)
    expect(input.listeningPorts).toEqual(hk.listeningPorts)
    expect(input.servedHostnames).toEqual(["api.example.com", "blog.example.com"])
    expect(input.guardrails).toEqual(hk.guardrails)
    expect(input.connection).toEqual({ sshAlias: "hk-edge" })
  })

  it("新建资产：名称去掉首尾空白，空的云厂商不输出", () => {
    const input = toAssetInput({ ...newAssetValues(), name: " 东京 ", provider: "  " }, undefined)
    expect(input.id).toBeUndefined()
    expect(input.type).toBe("vps")
    expect(input.name).toBe("东京")
    expect(input.provider).toBeUndefined()
  })

  it("slug 跟随别名", () => {
    expect(slugFromAlias("hk-edge")).toBe("vps-hk-edge")
    expect(slugFromAlias("JP_Relay.01")).toBe("vps-jp-relay-01")
    expect(slugFromAlias("")).toBe("")
  })
})

describe("保存失败时的错误定位（PRD 6.4 三步）", () => {
  const values: AssetFormValues = {
    ...newAssetValues(),
    slug: "vps-x",
    sshAlias: "x",
    paths: [
      { key: "p1", label: "站点", path: "/www", source: "manual" },
      { key: "p2", label: "", path: "", source: "manual" },
    ],
    servedHostnames: ["ok.example.com", "10.0.0.1"],
  }
  const errors = errorsOf(values)

  it("按标签页统计错误数", () => {
    expect(countTabErrors(errors, "overview")).toBe(2)
    expect(countTabErrors(errors, "paths")).toBe(2)
    expect(countTabErrors(errors, "connection")).toBe(0)
  })

  it("找到标签页里第一个出错的字段", () => {
    expect(firstErrorPath(errors, "overview")).toBe("name")
    const sitesOnly: typeof errors = { servedHostnames: errors.servedHostnames }
    expect(firstErrorPath(sitesOnly, "overview")).toBe("servedHostnames")
    expect(firstErrorPath(errors, "paths")).toBe("paths.1.label")
    expect(firstErrorPath(errors, "guardrails")).toBeNull()
  })
})
