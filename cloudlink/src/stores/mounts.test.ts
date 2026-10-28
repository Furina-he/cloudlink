import { describe, expect, it } from "vitest"

import type { Mount } from "@/bindings"
import * as fx from "@/mocks/fixtures"
import { selectHealth, selectVisibleSkills } from "./mounts"

const ids = (list: Mount[]) => list.map((m) => m.id).sort()
const visible = (targetId: string, agent: Parameters<typeof selectVisibleSkills>[0]["agent"]) =>
  selectVisibleSkills({ targetId, agent }, fx.targets, fx.mounts)

describe("selectVisibleSkills（F-306）", () => {
  it("WSL 项目看不到 Windows 侧的全局目录", () => {
    // OpenPet 在 WSL；Claude Code 的全局目标 tgt_cc_win 在 Windows
    const r = visible("tgt_openpet", "claude-code")
    expect(ids(r.project)).toEqual(["mnt_hk_openpet"])
    expect(r.global).toEqual([])
    expect(ids(r.unhealthy)).toEqual(["mnt_sg_openpet"])
  })

  it("Codex 与 Claude Code 读取不同的约定目录和全局目录", () => {
    // Codex（通用 .agents）读 .agents/skills 与同环境的 ~/.agents/skills
    const codex = visible("tgt_openpet", "universal")
    expect(ids(codex.project)).toEqual(["mnt_hk_openpet"])
    expect(ids(codex.global)).toEqual(["mnt_dev_agents"])

    // Blog-Astro 只启用了 .claude：Codex 在这里看不到任何项目挂载
    const codexBlog = visible("tgt_blog", "universal")
    expect(codexBlog.project).toEqual([])
    expect(codexBlog.unhealthy).toEqual([])

    // Claude Code 在 Blog-Astro（Windows）读 .claude/skills 与 Windows 的 ~/.claude/skills
    const claudeBlog = visible("tgt_blog", "claude-code")
    expect(ids(claudeBlog.project)).toEqual(["mnt_hk_blog"])
    expect(ids(claudeBlog.global)).toEqual(["mnt_hk_cc"])
  })

  it("失效、别名不可达、冲突的挂载单独计数，不算可见", () => {
    const r = visible("tgt_blog", "claude-code")
    // mnt_dev_blog 冲突（项目）、mnt_sg_cc 别名不可达（全局）
    expect(ids(r.unhealthy)).toEqual(["mnt_dev_blog", "mnt_sg_cc"])
    // stale-copy 仍然可见：Agent 能看到旧副本
    expect(r.project.map((m) => m.status)).toEqual(["stale-copy"])
  })

  it("全局目标视角只看这个全局目录本身", () => {
    const r = visible("tgt_cc_win", "claude-code")
    expect(r.project).toEqual([])
    expect(ids(r.global)).toEqual(["mnt_hk_cc"])
    expect(ids(r.unhealthy)).toEqual(["mnt_sg_cc"])
  })

  it("目标不存在时返回空集合", () => {
    expect(visible("tgt_missing", "claude-code")).toEqual({ project: [], global: [], unhealthy: [] })
  })
})

describe("selectHealth", () => {
  it("统计失效与冲突", () => {
    const h = selectHealth(fx.mounts, [])
    expect(h).toEqual({ broken: 1, conflict: 1, blocked: 0 })
  })
})
