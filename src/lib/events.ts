// 唯一允许订阅后端事件的地方（PRD 7.3、7.8）：启动时订阅一次，分发到各 store
import { listen, type UnlistenFn } from "@tauri-apps/api/event"

import type {
  ActivityItem,
  BackupEvent,
  CompileStatus,
  CliSetupChangedEvent,
  ConnectionTestedEvent,
  Delivery,
  ExecutionChangedEvent,
  RuntimeStatus,
  GuardStatus,
  Inclusion,
  ProbeFinishedEvent,
  ProbeProgressEvent,
  TrayConfirmMode,
  UpdateStatus,
} from "@/bindings"
import { useActivityStore } from "@/stores/activity"
import { useAssetStore } from "@/stores/assets"
import { useCliStore } from "@/stores/cli"
import { onBackedUp, onTrayConfirmMode } from "@/stores/backups"
import { useConnectionStore } from "@/stores/connection"
import { useDeliveryStore } from "@/stores/deliveries"
import { useGuardStore } from "@/stores/guard"
import { useExecutionStore } from "@/stores/execution"
import { useUIStore } from "@/stores/ui"
import { useNotesStore } from "@/stores/notes"
import { useOperationStore } from "@/stores/operations"
import { useProbeStore } from "@/stores/probe"
import { useSkillStore } from "@/stores/skills"
import { useUpdateStore } from "@/stores/update"

export async function subscribeBackendEvents(): Promise<UnlistenFn> {
  const subscriptions = await Promise.allSettled([
    listen<ProbeProgressEvent>("probe://progress", (e) =>
      useProbeStore.getState()._onProgress(e.payload)
    ),
    listen<ProbeFinishedEvent>("probe://finished", (e) =>
      useProbeStore.getState()._onFinished(e.payload)
    ),
    listen<ConnectionTestedEvent>("connection://tested", (e) =>
      useConnectionStore.getState()._onTested(e.payload)
    ),
    listen<{ deliveries: Delivery[]; inclusions: Inclusion[] }>(
      "deliveries://changed",
      (e) => {
        useDeliveryStore.getState()._onChanged(e.payload)
        // Shared-directory changes affect physical copies only, never the resource choices.
      }
    ),
    listen<{ statuses: CompileStatus[] }>("compile://finished", (e) =>
      useSkillStore.getState()._onCompiled(e.payload.statuses)
    ),
    listen<{ statuses: GuardStatus[] }>("guard://changed", (e) =>
      useGuardStore.getState()._onChanged(e.payload.statuses)
    ),
    listen<{ assetId: string; count: number; denied: number }>(
      "operations://new",
      (e) => useOperationStore.getState()._onNew(e.payload.assetId)
    ),
    listen<{ assetId: string; count: number }>("notes://new", (e) =>
      useNotesStore.getState()._onNew(e.payload.assetId)
    ),
    listen<{ item: ActivityItem }>("activity://new", (e) => {
      useActivityStore.getState()._onNew(e.payload.item)
      // 托盘里切换的档位（F-407）不经过前端，资源列表跟着刷新
      if (e.payload.item.kind === "mode") void useAssetStore.getState().refresh()
    }),
    listen<BackupEvent>("deliveries://backed-up", (e) => onBackedUp(e.payload)),
    listen<TrayConfirmMode>("tray://confirm-mode", (e) =>
      onTrayConfirmMode(e.payload.assetId)
    ),
    listen<CliSetupChangedEvent>("cli-setup://changed", (e) => useCliStore.getState()._onSetupChanged(e.payload)),
    listen<ExecutionChangedEvent>("execution://changed", (e) => useExecutionStore.getState()._onChanged(e.payload)),
    listen<{ status: RuntimeStatus }>("runtime://changed", (e) => useExecutionStore.getState()._onRuntime(e.payload.status)),
    listen<{ requestId: string }>("execution://focus", (e) => {
      useExecutionStore.getState().focus(e.payload.requestId)
      useUIStore.getState().setView("activity")
    }),
    listen<{ status: UpdateStatus }>("update://changed", (e) =>
      useUpdateStore.getState()._onChanged(e.payload.status)
    ),
  ])
  const offs = subscriptions.flatMap((subscription) =>
    subscription.status === "fulfilled" ? [subscription.value] : []
  )
  const failed = subscriptions.find(
    (subscription) => subscription.status === "rejected"
  )
  if (failed) {
    offs.forEach((off) => off())
    throw failed.reason
  }
  return () => offs.forEach((off) => off())
}
