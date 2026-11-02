import { create } from "zustand"

import type {
  ProbeChange,
  ProbeError,
  ProbeFinishedEvent,
  ProbeProgressEvent,
  ProbeRunStatus,
  ProbeStep,
  ProbeStepStatus,
  SaveResult,
} from "@/bindings"
import { toast, type ToastData } from "@/components/ui/toast"
import { copy, ipcErrorText } from "@/lib/copy"
import { ipc, toIpcError } from "@/lib/ipc"
import { handleOf, useAssetStore } from "./assets"
import { useSkillStore } from "./skills"
import { useUIStore } from "./ui"

export interface ProbeRun {
  runId: string
  assetId: string
  status: ProbeRunStatus
  steps: { step: ProbeStep; status: ProbeStepStatus; ms?: number }[]
  error?: ProbeError
  /** 已自动合并的变化（F-103 AC2） */
  applied: ProbeChange[]
  /** 疑似注入、等用户确认的变化（F-103 AC5） */
  held: ProbeChange[]
  /** 用户已确认合并的待确认项 */
  confirmedIds: string[]
  /** 已撤销本次更新（F-103 AC4） */
  undone: boolean
  durationMs?: number
  finishedAt?: string
  startedAt: string
}

interface ProbeState {
  runs: Record<string, ProbeRun>
  /** 每台服务器最近一次探测的 runId（运行中或已结束） */
  activeRunByAsset: Record<string, string>
  /** 已发起、还没拿到 runId 的服务器：探测 Sheet 先显示「正在探测」，不闪出上一次的结果 */
  starting: string[]

  start: (assetId: string) => Promise<string>
  /** 探测全部不在探测中的服务器，返回发起的数量 */
  startAll: () => Promise<number>
  cancel: (runId: string) => Promise<void>
  confirmItems: (runId: string, changeIds: string[]) => Promise<SaveResult>
  undo: (runId: string) => Promise<SaveResult>
  _onProgress: (e: ProbeProgressEvent) => void
  _onFinished: (e: ProbeFinishedEvent) => void
}

const newRun = (runId: string, assetId: string): ProbeRun => ({
  runId,
  assetId,
  status: "running",
  steps: [],
  applied: [],
  held: [],
  confirmedIds: [],
  undone: false,
  startedAt: new Date().toISOString(),
})

const aliasOf = (assetId: string) => {
  const a = useAssetStore.getState().byId[assetId]
  return a ? handleOf(a) : assetId
}

const applyResult = (result: SaveResult) => {
  useAssetStore.getState()._upsert(result.asset)
  useSkillStore.getState()._onCompiled(result.statuses)
}

/** 探测 Sheet 没在显示这台服务器时，用 Toast 通知（PRD 6.4 探测流程第 2 步）：「查看」回到结果，有更新时可以「撤销」 */
function notifyIfAway({ runId, assetId, status, error, applied = [], held = [] }: ProbeFinishedEvent) {
  if (status === "cancelled") return
  const ui = useUIStore.getState()
  if (ui.view === "servers" && ui.probeSheetAssetId === assetId) return
  const alias = aliasOf(assetId)
  let id = ""
  const view = {
    children: copy.probeToast.view,
    onClick: () => {
      toast.close(id)
      useUIStore.getState().openProbeSheet(assetId)
    },
  }
  const undo = {
    label: copy.probeToast.undo,
    onClick: () => {
      toast.close(id)
      void undoAndAnnounce(runId)
    },
  }
  if (status === "failed") {
    const e = error ?? { id: "unknown" as const, params: { alias } }
    id = toast.add({ title: copy.probeToast.failed(alias), description: copy.sshError[e.id].title(e.params), type: "error", actionProps: view })
    return
  }
  const title =
    applied.length && held.length
      ? copy.probeToast.updatedHeld(alias, applied.length, held.length)
      : held.length
        ? copy.probeToast.heldOnly(alias, held.length)
        : applied.length
          ? copy.probeToast.updated(alias, applied.length)
          : copy.probeToast.noChanges(alias)
  id = toast.add({
    title,
    // 带「撤销」的 Toast 停留 8 秒（PRD 7.3）
    timeout: applied.length ? 8000 : undefined,
    actionProps: view,
    data: applied.length ? ({ secondary: undo } satisfies ToastData) : undefined,
  })
}

async function undoAndAnnounce(runId: string) {
  try {
    const run = useProbeStore.getState().runs[runId]
    await useProbeStore.getState().undo(runId)
    if (run) toast.add({ title: copy.probeToast.undone(aliasOf(run.assetId)) })
  } catch (e) {
    const err = e as ReturnType<typeof toIpcError>
    toast.add({ title: ipcErrorText(err.id, err.params), type: "error" })
  }
}

export const useProbeStore = create<ProbeState>()((set, get) => ({
  runs: {},
  activeRunByAsset: {},
  starting: [],

  start: async (assetId) => {
    set((s) => ({ starting: [...s.starting, assetId] }))
    let runId: string
    try {
      runId = (await ipc.startProbe(assetId)).runId
    } catch (e) {
      set((s) => ({ starting: s.starting.filter((x) => x !== assetId) }))
      throw toIpcError(e)
    }
    // 事件可能先于 invoke 返回到达，那时已经登记过了
    set((s) => ({
      runs: { ...s.runs, [runId]: s.runs[runId] ?? newRun(runId, assetId) },
      activeRunByAsset: { ...s.activeRunByAsset, [assetId]: runId },
      starting: s.starting.filter((x) => x !== assetId),
    }))
    return runId
  },

  startAll: async () => {
    const { ids } = useAssetStore.getState()
    const targets = ids.filter((id) => !isProbing(get(), id))
    await Promise.all(targets.map((id) => get().start(id).catch(() => undefined)))
    return targets.length
  },

  cancel: async (runId) => {
    try {
      await ipc.cancelProbe(runId)
    } catch (e) {
      throw toIpcError(e)
    }
  },

  confirmItems: async (runId, changeIds) => {
    let result: SaveResult
    try {
      result = await ipc.confirmProbeItems(runId, changeIds)
    } catch (e) {
      throw toIpcError(e)
    }
    applyResult(result)
    set((s) => {
      const run = s.runs[runId]
      return run ? { runs: { ...s.runs, [runId]: { ...run, confirmedIds: [...run.confirmedIds, ...changeIds] } } } : s
    })
    return result
  },

  undo: async (runId) => {
    let result: SaveResult
    try {
      result = await ipc.undoProbe(runId)
    } catch (e) {
      throw toIpcError(e)
    }
    applyResult(result)
    set((s) => {
      const run = s.runs[runId]
      return run ? { runs: { ...s.runs, [runId]: { ...run, undone: true } } } : s
    })
    return result
  },

  _onProgress: ({ runId, assetId, step, status, ms }) =>
    set((s) => {
      const known = s.runs[runId]
      const run = known ?? newRun(runId, assetId)
      const steps = run.steps.some((x) => x.step === step)
        ? run.steps.map((x) => (x.step === step ? { step, status, ms } : x))
        : [...run.steps, { step, status, ms }]
      return {
        runs: { ...s.runs, [runId]: { ...run, steps } },
        // 后端发起的探测（导入后立即探测）第一次出现时，登记为这台服务器的当前探测
        activeRunByAsset: known ? s.activeRunByAsset : { ...s.activeRunByAsset, [assetId]: runId },
      }
    }),

  _onFinished: (e) => {
    const { runId, assetId, status, error, applied = [], held = [], durationMs, finishedAt } = e
    set((s) => ({
      runs: {
        ...s.runs,
        [runId]: { ...(s.runs[runId] ?? newRun(runId, assetId)), status, error, applied, held, durationMs, finishedAt },
      },
      activeRunByAsset: s.activeRunByAsset[assetId] ? s.activeRunByAsset : { ...s.activeRunByAsset, [assetId]: runId },
    }))
    // 自动合并、探测时间、连接验证都在后端更新了（F-103 AC2、AC8），这里同步一次
    if (status !== "cancelled") void useAssetStore.getState().refresh()
    notifyIfAway(e)
  },
}))

export const isProbing = (s: Pick<ProbeState, "runs" | "activeRunByAsset">, assetId: string) => {
  const runId = s.activeRunByAsset[assetId]
  return !!runId && s.runs[runId]?.status === "running"
}

/** 某台服务器最近一次探测 */
export const selectActiveRun = (
  s: Pick<ProbeState, "runs" | "activeRunByAsset">,
  assetId: string | null
): ProbeRun | undefined => {
  const runId = assetId ? s.activeRunByAsset[assetId] : undefined
  return runId ? s.runs[runId] : undefined
}
