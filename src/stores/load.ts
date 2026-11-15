// 首次加载与「重试」：各数据源互不依赖，同时发起，失败的各自记在自己的 error 里
import { useAssetStore } from "./assets"
import { useDeliveryStore } from "./deliveries"
import { useGuardStore } from "./guard"
import { useNotesStore } from "./notes"
import { useSettingsStore } from "./settings"
import { useSkillStore } from "./skills"
import { useTargetStore } from "./targets"
import { useUpdateStore } from "./update"

export function loadAll() {
  // 资源列表先读，首屏不等后端的启动检测（冷启动）。检测要等后端启动时的第一次对账做完才返回，
  // 对账会更新导入的服务器在哪些运行环境的 ssh config 里，所以之后再静默刷新一次资源
  void useTargetStore
    .getState()
    .detect()
    .then(() => useAssetStore.getState().refresh())
  void useAssetStore.getState().load()
  void useSkillStore.getState().load()
  void useDeliveryStore.getState().load()
  void useGuardStore.getState().load()
  void useNotesStore.getState().load()
  void useSettingsStore.getState().load()
  // 检查更新失败不打扰用户（F-406），不计入下面的加载错误
  void useUpdateStore.getState().load()
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
