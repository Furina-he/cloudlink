import { create } from "zustand"

import type { ExecutionChangedEvent, ExecutionRequest, ExecutionResponse, IpcError, RuntimeStatus } from "@/bindings"
import { ipc, toIpcError } from "@/lib/ipc"
import type { LoadStatus } from "./assets"

interface ExecutionStore {
  runtime: RuntimeStatus | null
  epoch: string | null
  revision: number
  requests: ExecutionRequest[]
  status: LoadStatus
  error: IpcError | null
  busyIds: string[]
  errorsById: Record<string, IpcError | undefined>
  focusId: string | null
  load: () => Promise<void>
  respond: (id: string, decision: ExecutionResponse) => Promise<void>
  cancel: (id: string) => Promise<void>
  focus: (id: string) => void
  _onChanged: (event: ExecutionChangedEvent) => void
  _onRuntime: (status: RuntimeStatus) => void
  reset: () => void
}

export const useExecutionStore = create<ExecutionStore>()((set, get) => {
  const retiredEpochs = new Set<string>()
  let loadGeneration = 0
  let actionGeneration = 0
  const acceptRequest = (request: ExecutionRequest) => {
    const state = get()
    if (state.epoch !== request.epoch) return
    const old = state.requests.find((old) => old.requestId === request.requestId)
    if (old && old.revision > request.revision || !old && state.revision > request.revision) return
    set({ revision: Math.max(state.revision, request.revision), requests: [...state.requests.filter((old) => old.requestId !== request.requestId), request] })
  }
  const action = async (id: string, invoke: (request: ExecutionRequest) => Promise<ExecutionRequest>) => {
    if (get().busyIds.includes(id)) return
    const request = get().requests.find((request) => request.requestId === id)
    if (!request) return
    const generation = actionGeneration
    set((state) => ({ busyIds: [...state.busyIds, id], errorsById: { ...state.errorsById, [id]: undefined } }))
    try {
      const response = await invoke(request)
      if (generation === actionGeneration) acceptRequest(response)
    } catch (error) {
      if (generation !== actionGeneration) return
      set((state) => ({ errorsById: { ...state.errorsById, [id]: toIpcError(error) } }))
      // Refresh state after a stale answer, not the command. A response never resubmits execution.
      await get().load()
    } finally {
      if (generation === actionGeneration) set((state) => ({ busyIds: state.busyIds.filter((busy) => busy !== id) }))
    }
  }
  return {
    runtime: null, epoch: null, revision: 0, requests: [], status: "idle", error: null,
    busyIds: [], errorsById: {}, focusId: null,
    load: async () => {
      const generation = ++loadGeneration
      set({ status: "loading", error: null })
      try {
        const runtime = await ipc.getRuntimeStatus()
        if (generation !== loadGeneration) return
        get()._onRuntime(runtime)
        const requests = await ipc.listExecutionRequests()
        if (generation !== loadGeneration || get().epoch !== runtime.epoch) return
        get()._onChanged({ epoch: runtime.epoch, revision: Math.max(runtime.revision, ...requests.map((request) => request.revision)), requests })
        set({ status: "ready", error: null })
      } catch (error) {
        if (generation === loadGeneration) set({ status: "error", error: toIpcError(error) })
      }
    },
    respond: (id, decision) => action(id, (request) => ipc.respondExecution({ requestId: id, expectedRevision: request.revision, decision })),
    cancel: (id) => action(id, (request) => ipc.cancelExecution({ requestId: id, expectedRevision: request.revision })),
    focus: (id) => set({ focusId: id }),
    _onRuntime: (runtime) => {
      if (retiredEpochs.has(runtime.epoch)) return
      const old = get().runtime
      if (old?.epoch === runtime.epoch && old.revision > runtime.revision) return
      if (get().epoch && get().epoch !== runtime.epoch) retiredEpochs.add(get().epoch!)
      if (get().epoch !== runtime.epoch) actionGeneration += 1
      set((state) => ({ runtime, epoch: runtime.epoch, ...(state.epoch !== runtime.epoch ? { revision: 0, requests: [], busyIds: [], errorsById: {}, focusId: null } : {}) }))
    },
    _onChanged: (event) => {
      const state = get()
      if (retiredEpochs.has(event.epoch) || state.epoch && state.epoch !== event.epoch || event.revision < state.revision) return
      const requests = event.requests.map((request) => {
        const old = state.requests.find((old) => old.requestId === request.requestId)
        return old && old.revision > request.revision ? old : request
      })
      set({ epoch: event.epoch, revision: event.revision, requests, status: "ready", error: null })
    },
    reset: () => { loadGeneration += 1; actionGeneration += 1; set({ requests: [], errorsById: {}, busyIds: [], focusId: null }) },
  }
})

export const pendingExecution = (requests: ExecutionRequest[]) => requests.filter((request) => request.state === "waiting")
