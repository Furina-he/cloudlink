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
import { ipc, toIpcError } from "@/lib/ipc"
import { useAssetStore } from "./assets"

export interface ProbeRun {
  runId: string
  assetId: string
  status: ProbeRunStatus
  steps: { step: ProbeStep; status: ProbeStepStatus; ms?: number }[]
  error?: ProbeError
  diff?: ProbeDiff
  startedAt: string
}

interface ProbeState {
  runs: Record<string, ProbeRun>
  /** 每个资产最近一次探测的 runId（运行中或已结束） */
  activeRunByAsset: Record<string, string>

  start: (assetId: string) => Promise<string>
  cancel: (runId: string) => Promise<void>
  apply: (runId: string, changeIds: string[]) => Promise<SaveResult>
  _onProgress: (e: ProbeProgressEvent) => void
  _onFinished: (e: ProbeFinishedEvent) => void
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
    set((s) => ({
      runs: {
        ...s.runs,
        // 事件可能先于 invoke 返回到达，保留已收到的步骤
        [runId]: {
          ...s.runs[runId],
          steps: s.runs[runId]?.steps ?? [],
          runId,
          assetId,
          status: s.runs[runId]?.status ?? "running",
          startedAt: new Date().toISOString(),
        },
      },
      activeRunByAsset: { ...s.activeRunByAsset, [assetId]: runId },
    }))
    return runId
  },

  cancel: async (runId) => {
    try {
      await ipc.cancelProbe(runId)
    } catch (e) {
      throw toIpcError(e)
    }
  },

  apply: async (runId, changeIds) => {
    try {
      const result = await ipc.applyProbe(runId, changeIds)
      useAssetStore.getState()._upsert(result.asset)
      return result
    } catch (e) {
      throw toIpcError(e)
    }
  },

  _onProgress: ({ runId, step, status, ms }) =>
    set((s) => {
      const run: ProbeRun = s.runs[runId] ?? {
        runId,
        assetId: "",
        status: "running",
        steps: [],
        startedAt: new Date().toISOString(),
      }
      const steps = run.steps.some((x) => x.step === step)
        ? run.steps.map((x) => (x.step === step ? { step, status, ms } : x))
        : [...run.steps, { step, status, ms }]
      return { runs: { ...s.runs, [runId]: { ...run, steps } } }
    }),

  _onFinished: ({ runId, status, error, diff }) => {
    const run = get().runs[runId]
    set((s) => ({
      runs: {
        ...s.runs,
        [runId]: {
          ...(run ?? { runId, assetId: "", steps: [], startedAt: new Date().toISOString() }),
          status,
          error,
          diff,
        },
      },
    }))
    // 无变更或失败时，资产的探测状态已在后端更新，这里同步一次
    if (run?.assetId && (status === "failed" || diff?.changes.length === 0)) {
      void useAssetStore.getState().load()
    }
  },
}))

export const isProbing = (s: ProbeState, assetId: string) => {
  const runId = s.activeRunByAsset[assetId]
  return !!runId && s.runs[runId]?.status === "running"
}
