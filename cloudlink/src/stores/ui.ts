// UI 状态（PRD 7.5）。主题不在这里，由 ThemeProvider 管理
import { create } from "zustand"
import { persist } from "zustand/middleware"

import type { AgentId, AssetType, EnvTag } from "@/bindings"
import type { ViewId } from "@/lib/copy"

export const VIEWS: ViewId[] = ["assets", "skills", "mounts", "activity", "settings"]

export interface AssetFilter {
  query: string
  types: AssetType[]
  envTags: EnvTag[]
  tags: string[]
}

export interface Lens {
  targetId: string
  agent: AgentId
}

export type SettingsSection =
  | "general"
  | "environments"
  | "agents"
  | "compile"
  | "probe"
  | "data"
  | "danger"

interface UIState {
  view: ViewId
  /** 本次会话中切换视图的次数，用于判断是否把焦点移到视图标题 */
  viewSwitches: number
  selectedAssetId: string | null
  selectedSkillId: string | null
  assetFilter: AssetFilter
  mountsMode: "board" | "matrix"
  lens: Lens | null
  commandOpen: boolean
  settingsSection: SettingsSection
  /** 各视图主滚动区的位置，切回视图时恢复（PRD 6.3） */
  scrollByView: Partial<Record<ViewId, number>>

  setView: (view: ViewId) => void
  selectAsset: (id: string | null) => void
  selectSkill: (id: string | null) => void
  setFilter: (patch: Partial<AssetFilter>) => void
  resetFilter: () => void
  setMountsMode: (mode: "board" | "matrix") => void
  setLens: (lens: Lens | null) => void
  setCommandOpen: (open: boolean) => void
  setSettingsSection: (section: SettingsSection) => void
  saveScroll: (view: ViewId, top: number) => void
}

export const DEFAULT_FILTER: AssetFilter = { query: "", types: [], envTags: [], tags: [] }

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      view: "assets",
      viewSwitches: 0,
      selectedAssetId: null,
      selectedSkillId: null,
      assetFilter: DEFAULT_FILTER,
      mountsMode: "board",
      lens: null,
      commandOpen: false,
      settingsSection: "general",
      scrollByView: {},

      setView: (view) =>
        set((s) => (s.view === view ? s : { view, viewSwitches: s.viewSwitches + 1 })),
      selectAsset: (selectedAssetId) => set({ selectedAssetId }),
      selectSkill: (selectedSkillId) => set({ selectedSkillId }),
      setFilter: (patch) => set((s) => ({ assetFilter: { ...s.assetFilter, ...patch } })),
      resetFilter: () => set({ assetFilter: DEFAULT_FILTER }),
      setMountsMode: (mountsMode) => set({ mountsMode }),
      setLens: (lens) => set({ lens }),
      setCommandOpen: (commandOpen) => set({ commandOpen }),
      setSettingsSection: (settingsSection) => set({ settingsSection }),
      saveScroll: (view, top) =>
        set((s) => ({ scrollByView: { ...s.scrollByView, [view]: top } })),
    }),
    {
      name: "cloudlink-ui",
      version: 1,
      // 只持久化 UI 偏好（PRD 7.5）
      partialize: (s) => ({
        mountsMode: s.mountsMode,
        assetFilter: { types: s.assetFilter.types, envTags: s.assetFilter.envTags },
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as {
          mountsMode?: UIState["mountsMode"]
          assetFilter?: Partial<AssetFilter>
        }
        return {
          ...current,
          mountsMode: p.mountsMode ?? current.mountsMode,
          assetFilter: {
            ...current.assetFilter,
            types: p.assetFilter?.types ?? [],
            envTags: p.assetFilter?.envTags ?? [],
          },
        }
      },
    }
  )
)
