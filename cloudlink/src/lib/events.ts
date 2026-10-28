// 唯一允许订阅后端事件的地方（PRD 7.3、7.8）：启动时订阅一次，分发到各 store
import { listen, type UnlistenFn } from "@tauri-apps/api/event"

import type {
  ActivityItem,
  Mount,
  ProbeFinishedEvent,
  ProbeProgressEvent,
} from "@/bindings"
import { useActivityStore } from "@/stores/activity"
import { useMountStore } from "@/stores/mounts"
import { useProbeStore } from "@/stores/probe"
import { useSkillStore, type CompileFinishedEvent } from "@/stores/skills"

export async function subscribeBackendEvents(): Promise<UnlistenFn> {
  const offs = await Promise.all([
    listen<ProbeProgressEvent>("probe://progress", (e) =>
      useProbeStore.getState()._onProgress(e.payload)
    ),
    listen<ProbeFinishedEvent>("probe://finished", (e) =>
      useProbeStore.getState()._onFinished(e.payload)
    ),
    listen<{ mounts: Mount[] }>("mounts://changed", (e) =>
      useMountStore.getState()._onChanged(e.payload.mounts)
    ),
    listen<CompileFinishedEvent>("compile://finished", (e) =>
      useSkillStore.getState()._onCompiled(e.payload)
    ),
    listen<{ item: ActivityItem }>("activity://new", (e) =>
      useActivityStore.getState()._onNew(e.payload.item)
    ),
  ])
  return () => offs.forEach((off) => off())
}
