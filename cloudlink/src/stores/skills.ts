// 总 Skill：全局内容（F-201 AC1）与每一份的编译状态（F-203）。每个「运行环境 × Agent」一份，只含分发给这个 Agent 的服务器
import { create } from "zustand"

import type { CompileStatus, IpcError, LintItem, SkillConfig } from "@/bindings"
import { ipc, toIpcError } from "@/lib/ipc"
import type { LoadStatus } from "./assets"

/** 一份总 Skill 的键：运行环境 × Agent。只用来比较，不拆开解析 */
export const compileKey = (s: { envId: string; agentKey: string }) => `${s.envId}|${s.agentKey}`

interface SkillState {
  config: SkillConfig | null
  /** 键是 compileKey */
  statusByKey: Record<string, CompileStatus>
  status: LoadStatus
  error: IpcError | null

  load: () => Promise<void>
  /** 保存后重新编译；失败时抛出 IpcError */
  saveConfig: (input: SkillConfig) => Promise<void>
  /** 后端每次都返回全部的编译状态：整体替换，停用的目标对应的那一份随之消失 */
  _onCompiled: (statuses: CompileStatus[]) => void
}

export const useSkillStore = create<SkillState>()((set, get) => ({
  config: null,
  statusByKey: {},
  status: "idle",
  error: null,

  load: async () => {
    set((s) => ({ status: s.status === "ready" ? "ready" : "loading", error: null }))
    try {
      const [config, statuses] = await Promise.all([ipc.getSkillConfig(), ipc.getCompileStatus()])
      set({ config, status: "ready" })
      get()._onCompiled(statuses)
    } catch (e) {
      set({ status: "error", error: toIpcError(e) })
    }
  },

  saveConfig: async (input) => {
    let statuses: CompileStatus[]
    try {
      statuses = await ipc.saveSkillConfig(input)
    } catch (e) {
      throw toIpcError(e)
    }
    set({ config: input })
    get()._onCompiled(statuses)
  },

  _onCompiled: (statuses) => set({ statusByKey: Object.fromEntries(statuses.map((x) => [compileKey(x), x])) }),
}))

// ---------- selectors ----------

/**
 * 同一条问题在每一份总 Skill 里各出现一次，去重用的键。服务器的问题按详情文件和行号区分；
 * SKILL.md 里的全局问题（关系、约定）行号随总览表的行数变化，只按规则区分
 */
export const lintKey = (l: LintItem) =>
  l.assetId ? `${l.id}:${l.assetId}:${l.file ?? ""}:${l.line ?? ""}` : `${l.id}:${String(l.params?.rule ?? "")}`

const uniqueCount = (items: LintItem[], level: LintItem["level"]) => new Set(items.filter((l) => l.level === level).map(lintKey)).size

/** 详情头部的编译摘要（PRD 6.4）：这台服务器自己的错误、警告，以及因为其他服务器出错而受阻的那几份 */
export function selectAssetCompile(statuses: CompileStatus[], assetId: string) {
  const own = statuses.flatMap((s) => s.lint.filter((l) => l.assetId === assetId))
  const blockedByOthers = statuses.filter((s) => s.blocked && !s.lint.some((l) => l.level === "error" && l.assetId === assetId))
  return { errors: uniqueCount(own, "error"), warnings: uniqueCount(own, "warning"), blockedByOthers }
}

/** Agent 页顶部的编译摘要（PRD 6.6）：受阻的那几份，以及去重后的错误数、警告数 */
export function selectCompileSummary(statuses: CompileStatus[]) {
  const lint = statuses.flatMap((s) => s.lint)
  return {
    blocked: statuses.filter((s) => s.blocked),
    errors: uniqueCount(lint, "error"),
    warnings: uniqueCount(lint, "warning"),
    /** 点击警告时打开的那一份 */
    firstWarning: statuses.find((s) => s.warnings > 0) ?? null,
  }
}

/** 导致编译受阻的服务器（侧栏「服务器」的红色受阻数，PRD 6.2） */
export function selectBlockedAssetIds(statuses: CompileStatus[]): string[] {
  const ids = new Set<string>()
  statuses.forEach((s) => s.lint.forEach((l) => l.level === "error" && l.assetId && ids.add(l.assetId)))
  return [...ids]
}
