import { describe, expect, it } from "vitest"

import type { CliScopeItem, GithubConfig } from "@/bindings"
import { githubComplete, githubDraft, githubExpands, githubProvidedIds, githubSetProvided, githubSwitchMode } from "./githubScopeForm"

const scope: CliScopeItem[] = [
  { id: "repo:R1", kind: "repo", name: "owner/one", selected: true, visibility: "private" },
  { id: "repo:R2", kind: "repo", name: "owner/two", selected: true, visibility: "public" },
  { id: "repo:R3", kind: "repo", name: "owner/three", selected: false, visibility: "private" },
]
const config = (): GithubConfig => ({
  host: "github.com", owner: { id: "O1", login: "owner", kind: "organization" },
  mode: "auto", selectedRepoIds: [], excludedRepoIds: ["repo:R3"], revision: 1, migrationPending: false,
  envStates: { windows: { status: "complete", owner: { id: "O1", login: "owner", kind: "organization" }, identity: { id: "U1", login: "operator", host: "github.com" }, repos: [], checkedAt: "2026-11-15T00:00:00Z" } },
})

describe("GitHub 归属范围草稿", () => {
  it("旧手选仍是manual，保留stable IDs，不从仓库名称猜owner", () => {
    expect(githubDraft(undefined, scope)).toEqual({ ownerLogin: "", mode: "manual", selectedRepoIds: ["repo:R1", "repo:R2"], excludedRepoIds: [] })
  })

  it("auto里取消表示排除，重新选中取消排除，两个模式复选框意义相同", () => {
    const draft = githubDraft(config(), scope)
    const excluded = githubSetProvided(draft, "repo:R1", false)
    expect(excluded.excludedRepoIds).toEqual(["repo:R3", "repo:R1"])
    expect(githubProvidedIds(excluded, scope)).toEqual(["repo:R2"])
    const restored = githubSetProvided(excluded, "repo:R1", true)
    expect(githubProvidedIds(restored, scope)).toEqual(["repo:R1", "repo:R2"])
  })

  it("manual只调整手选，不丢自动排除的草稿", () => {
    const draft = { ...githubDraft(config()), mode: "manual" as const, selectedRepoIds: ["repo:R1", "repo:R2"] }
    const updated = githubSetProvided(draft, "repo:R2", false)
    expect(updated.selectedRepoIds).toEqual(["repo:R1"])
    expect(updated.excludedRepoIds).toEqual(["repo:R3"])
  })

  it("auto首次转manual复制当前已提供项，不纳入排除项", () => {
    const update = githubSwitchMode(githubDraft(config()), "manual", scope, false)
    expect(update.selectedRepoIds).toEqual(["repo:R1", "repo:R2"])
  })

  it("同一草稿来回切换不会抹掉手选", () => {
    const manual = githubSwitchMode(githubDraft(config()), "manual", scope, false)
    const edited = githubSetProvided(manual, "repo:R2", false)
    const auto = githubSwitchMode(edited, "auto", scope, true)
    const returned = githubSwitchMode(auto, "manual", scope, true)
    expect(returned.selectedRepoIds).toEqual(["repo:R1"])
    expect(returned.excludedRepoIds).toEqual(["repo:R3"])
  })

  it("仓库改名不使排除失效，检查的是stable ID", () => {
    const renamed = scope.map((repo) => repo.id === "repo:R3" ? { ...repo, name: "owner/renamed-three" } : repo)
    expect(githubProvidedIds(githubDraft(config()), renamed)).toEqual(["repo:R1", "repo:R2"])
  })

  it("转auto即使当前新增为0也会扩未来范围，partial下不能保存这种扩围", () => {
    const initial = { ...githubDraft(config()), mode: "manual" as const, selectedRepoIds: ["repo:R1", "repo:R2", "repo:R3"] }
    const auto = { ...initial, mode: "auto" as const, excludedRepoIds: [] }
    expect(githubExpands(auto, initial, scope, ["repo:R1", "repo:R2", "repo:R3"])).toBe(true)
    expect(githubExpands({ ...initial, selectedRepoIds: ["repo:R1"] }, initial, scope, ["repo:R1", "repo:R2", "repo:R3"])).toBe(false)
  })

  it("完整核对要求owner和各环境的有效身份；任何partial/offline/denied均不能扩围", () => {
    expect(githubComplete(config())).toBe(true)
    for (const status of ["partial", "offline", "denied"] as const) {
      const value = config()
      value.envStates.windows!.status = status
      expect(githubComplete(value)).toBe(false)
    }
    const foreign = config()
    foreign.envStates.windows!.owner!.id = "OTHER"
    expect(githubComplete(foreign)).toBe(false)
    expect(githubComplete({ ...config(), owner: undefined })).toBe(false)
    expect(githubComplete({ ...config(), migrationPending: true })).toBe(false)
  })
})
