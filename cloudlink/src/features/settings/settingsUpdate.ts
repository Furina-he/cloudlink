import type { Settings } from "@/bindings"
import { useSettingsStore } from "@/stores/settings"

/** 立即保存；失败时由 store 回滚并弹 Toast */
export const update = (patch: Partial<Settings>) => void useSettingsStore.getState().update(patch)
