import { create } from "zustand"

import type {
  ProbeDiff,
  ProbeError,
  ProbeFinishedEvent,
  ProbeProgressEvent,
  ProbeRunStatus,
  ProbeStep,
  ProbeStepStatus,
  SaveResult,
} from "@/bindings"
import { toast } from "@/components/ui/toast"
import { copy } from "@/lib/copy"
import { ipc, toIpcError } from "@/lib/ipc"
import { useAssetStore } from "./assets"
import { useUIStore } from "./ui"

export interface ProbeRun {
  runId: string
  assetId: string
  status: ProbeRunStatus
  steps: { step: ProbeStep; status: ProbeStepStatus; ms?: number }[]
  error?: ProbeError
  diff?: ProbeDiff
  startedAt: string
  /** 差异已处理：应用了几项（「全部忽略」为 0） */
  applied?: number
}

interface ProbeState {
  runs: Record<string, ProbeRun>
  /** 每个资产最近一次探测的 runId（运行中或已结束） */
  activeRunByAsset: Record<string, string>

  start: (assetId: string) => Promise<string>
  /** 探测全部有别名、且不在探测中的资产，返回发起的数量 */
  startAll: () => Promise<number>
  cancel: (runId: string) => Promise<void>
  apply: (runId: string, changeIds: string[]) => Promise<SaveResult>
  _onProgress: (e: ProbeProgressEvent) => void
  _onFinished: (e: ProbeFinishedEvent) => void
}

const newRun = (runId: string, assetId: string): ProbeRun => ({
  runId,
  assetId,
  status: "running",
  steps: [],
  startedAt: new Date().toISOString(),
})

/** 用户没在看这个资产时，探测结束用 Toast 通知，附「查看」（PRD 6.5） */
function notifyIfAway({ assetId, status, error, diff }: ProbeFinishedEvent) {
  if (status === "cancelled") return
  const ui = useUIStore.getState()
  if (ui.view === "assets" && ui.selectedAssetId === assetId) return
  const alias = useAssetStore.getState().byId[assetId]?.connection.sshAlias ?? assetId
  let id = ""
  const actionProps = {
    children: copy.probeToast.view,
    onClick: () => {
      toast.close(id)
      useUIStore.getState().openProbeResult(assetId)
    },
  }
  if (status === "failed") {
    const e = error ?? { id: "unknown" as const, params: { alias } }
    id = toast.add({
      title: copy.probeToast.failed(alias),
      description: copy.probeError[e.id].title(e.params),
      type: "error",
      actionProps,
    })
    return
  }
  const count = diff?.changes.length ?? 0
  id = toast.add({
    title: count ? copy.probeToast.changes(alias, count) : copy.probeToast.noChanges(alias),
    actionProps,
  })
}

export const useProbeStore = create<ProbeState>()((set, get) => ({
  runs: {},
  activeRunByAsset: {},

  start: async (assetId) => {
    let runId: string
    try {
      runId = (await ipc.startProbe(assetId)).runId
    } catch (e) {
      throw toIpcError(e)
    }
    // 事件可能先于 invoke 返回到达，那时已经登记过了
    set((s) => ({
      runs: { ...s.runs, [runId]: s.runs[runId] ?? newRun(runId, assetId) },
      activeRunByAsset: { ...s.activeRunByAsset, [assetId]: runId },
    }))
    return runId
  },

  startAll: async () => {
    const { byId, ids } = useAssetStore.getState()
    const targets = ids.filter(
      (id) => byId[id].connection.sshAlias && !isProbing(get(), id)
    )
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

  apply: async (runId, changeIds) => {
    let result: SaveResult
    try {
      result = await ipc.applyProbe(runId, changeIds)
    } catch (e) {
      throw toIpcError(e)
    }
    const assets = useAssetStore.getState()
    assets._upsert(result.asset)
    assets._recordSave(result)
    set((s) => {
      const run = s.runs[runId]
      return run ? { runs: { ...s.runs, [runId]: { ...run, applied: changeIds.length } } } : s
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
        // 后端发起的探测（导入后立即探测）第一次出现时，登记为这个资产的当前探测
        activeRunByAsset: known
          ? s.activeRunByAsset
          : { ...s.activeRunByAsset, [assetId]: runId },
      }
    }),

  _onFinished: (e) => {
    const { runId, assetId, status, error, diff } = e
    set((s) => ({
      runs: {
        ...s.runs,
        [runId]: { ...(s.runs[runId] ?? newRun(runId, assetId)), status, error, diff },
      },
      activeRunByAsset: s.activeRunByAsset[assetId]
        ? s.activeRunByAsset
        : { ...s.activeRunByAsset, [assetId]: runId },
    }))
    // 无变更或失败时，资产的探测状态已在后端更新，这里同步一次
    if (status === "failed" || (status === "ok" && diff?.changes.length === 0)) {
      void useAssetStore.getState().load()
    }
    notifyIfAway(e)
  },
}))

export const isProbing = (s: Pick<ProbeState, "runs" | "activeRunByAsset">, assetId: string) => {
  const runId = s.activeRunByAsset[assetId]
  return !!runId && s.runs[runId]?.status === "running"
}

/** 某个资产最近一次探测 */
export const selectActiveRun = (
  s: Pick<ProbeState, "runs" | "activeRunByAsset">,
  assetId: string | null
): ProbeRun | undefined => {
  const runId = assetId ? s.activeRunByAsset[assetId] : undefined
  return runId ? s.runs[runId] : undefined
}
