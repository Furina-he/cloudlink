// 首次加载与「重试」：各数据源互不依赖，同时发起，失败的各自记在自己的 error 里
import { useAssetStore } from "./assets"
import { useDeliveryStore } from "./deliveries"
import { useGuardStore } from "./guard"
import { useNotesStore } from "./notes"
import { useSettingsStore } from "./settings"
import { useSkillStore } from "./skills"
import { useTargetStore } from "./targets"

export function loadAll() {
  void useTargetStore.getState().detect()
  void useAssetStore.getState().load()
  void useSkillStore.getState().load()
  void useDeliveryStore.getState().load()
  void useGuardStore.getState().load()
  void useNotesStore.getState().load()
  void useSettingsStore.getState().load()
}

/** 加载失败的数据源里排第一个的错误（PRD 6.10），App 顶部的 Alert 用它 */
export function useLoadError() {
  const errors = [
    useAssetStore((s) => s.error),
    useTargetStore((s) => s.error),
    useSkillStore((s) => s.error),
    useDeliveryStore((s) => s.error),
    useGuardStore((s) => s.error),
    useNotesStore((s) => s.error),
    useSettingsStore((s) => s.error),
  ]
  return errors.find(Boolean) ?? null
}
