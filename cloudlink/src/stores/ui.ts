// UI 状态（PRD 7.5）。主题不在这里，由 ThemeProvider 管理
import { create } from "zustand"
import { persist } from "zustand/middleware"

import type { AgentId, AssetType, EnvId, EnvTag } from "@/bindings"
import type { ViewId } from "@/lib/copy"

export const VIEWS: ViewId[] = ["assets", "skills", "mounts", "activity", "settings"]

export interface AssetFilter {
  query: string
  types: AssetType[]
  envTags: EnvTag[]
  tags: string[]
}

export type AssetSort = "name" | "probed" | "updated"

export type AssetTab = "overview" | "connection" | "paths" | "services" | "guardrails" | "mounts"

export interface Lens {
  targetId: string
  agent: AgentId
}

/** Skills 视图的状态筛选与排序（PRD 6.7：不做列头排序，用「排序」下拉菜单） */
export type SkillStateFilter = "all" | "ok" | "warning" | "blocked"
export type SkillSort = "slug" | "mounts" | "tokens"

export type SettingsSection =
  | "general"
  | "environments"
  | "agents"
  | "compile"
  | "probe"
  | "data"
  | "danger"

/**
 * 离开当前资产前的确认（PRD 6.4）。资产编辑器有未保存修改时注册：
 * 返回 true 表示已拦下，由它弹出「放弃修改 / 继续编辑」，确认后再调用 proceed
 */
export type LeaveGuard = (proceed: () => void) => boolean

let leaveGuard: LeaveGuard | null = null

export function setLeaveGuard(guard: LeaveGuard | null) {
  leaveGuard = guard
}

/** force：保存成功、删除资产这类内部跳转，不再询问 */
export interface NavOptions {
  force?: boolean
}

function guarded(opts: NavOptions | undefined, action: () => void) {
  if (!opts?.force && leaveGuard?.(action)) return
  action()
}

interface UIState {
  view: ViewId
  /** 本次会话中切换视图的次数，用于判断是否把焦点移到视图标题 */
  viewSwitches: number
  selectedAssetId: string | null
  /** 编辑器里是一个尚未保存的新资产 */
  creatingAsset: boolean
  selectedSkillId: string | null
  assetFilter: AssetFilter
  assetSort: AssetSort
  /** 资产编辑器当前的标签页，换资产、切视图后保持 */
  assetTab: AssetTab
  /** 每次请求展开探测面板时加一（「探测当前资产」、探测完成 Toast 的「查看」） */
  probePanelRequest: number
  importOpen: boolean
  mountsMode: "board" | "matrix"
  /** 挂载视图的运行环境筛选 */
  mountsEnv: EnvId | "all"
  /** 矩阵只显示「生产资产挂在全局目标上」的挂载（常驻提示的「查看」） */
  matrixProdGlobal: boolean
  lens: Lens | null
  skillQuery: string
  skillState: SkillStateFilter
  skillSort: SkillSort
  commandOpen: boolean
  settingsSection: SettingsSection
  /** 各视图主滚动区的位置，切回视图时恢复（PRD 6.3） */
  scrollByView: Partial<Record<ViewId, number>>

  setView: (view: ViewId, opts?: NavOptions) => void
  selectAsset: (id: string | null, opts?: NavOptions) => void
  startNewAsset: (opts?: NavOptions) => void
  /** 打开某个资产并展开探测面板 */
  openProbeResult: (assetId: string) => void
  requestProbePanel: () => void
  selectSkill: (id: string | null) => void
  setFilter: (patch: Partial<AssetFilter>) => void
  resetFilter: () => void
  setAssetSort: (sort: AssetSort) => void
  setAssetTab: (tab: AssetTab) => void
  setImportOpen: (open: boolean) => void
  setMountsMode: (mode: "board" | "matrix") => void
  setMountsEnv: (env: EnvId | "all") => void
  setMatrixProdGlobal: (on: boolean) => void
  setLens: (lens: Lens | null) => void
  setSkillQuery: (query: string) => void
  setSkillState: (state: SkillStateFilter) => void
  setSkillSort: (sort: SkillSort) => void
  setCommandOpen: (open: boolean) => void
  setSettingsSection: (section: SettingsSection) => void
  saveScroll: (view: ViewId, top: number) => void
}

export const DEFAULT_FILTER: AssetFilter = { query: "", types: [], envTags: [], tags: [] }

export const useUIStore = create<UIState>()(
  persist(
    (set, get) => ({
      view: "assets",
      viewSwitches: 0,
      selectedAssetId: null,
      creatingAsset: false,
      selectedSkillId: null,
      assetFilter: DEFAULT_FILTER,
      assetSort: "name",
      assetTab: "overview",
      probePanelRequest: 0,
      importOpen: false,
      mountsMode: "board",
      mountsEnv: "all",
      matrixProdGlobal: false,
      lens: null,
      skillQuery: "",
      skillState: "all",
      skillSort: "slug",
      commandOpen: false,
      settingsSection: "general",
      scrollByView: {},

      setView: (view, opts) => {
        if (get().view === view) return
        guarded(opts, () => set((s) => ({ view, viewSwitches: s.viewSwitches + 1 })))
      },
      selectAsset: (selectedAssetId, opts) => {
        const s = get()
        if (s.selectedAssetId === selectedAssetId && !s.creatingAsset) return
        guarded(opts, () => set({ selectedAssetId, creatingAsset: false }))
      },
      startNewAsset: (opts) =>
        guarded(opts, () =>
          set((s) => ({
            creatingAsset: true,
            selectedAssetId: null,
            assetTab: "overview",
            view: "assets",
            viewSwitches: s.view === "assets" ? s.viewSwitches : s.viewSwitches + 1,
          }))
        ),
      openProbeResult: (assetId) =>
        guarded(undefined, () =>
          set((s) => ({
            selectedAssetId: assetId,
            creatingAsset: false,
            view: "assets",
            viewSwitches: s.view === "assets" ? s.viewSwitches : s.viewSwitches + 1,
            probePanelRequest: s.probePanelRequest + 1,
          }))
        ),
      requestProbePanel: () => set((s) => ({ probePanelRequest: s.probePanelRequest + 1 })),
      selectSkill: (selectedSkillId) => set({ selectedSkillId }),
      setFilter: (patch) => set((s) => ({ assetFilter: { ...s.assetFilter, ...patch } })),
      resetFilter: () => set({ assetFilter: DEFAULT_FILTER }),
      setAssetSort: (assetSort) => set({ assetSort }),
      setAssetTab: (assetTab) => set({ assetTab }),
      setImportOpen: (importOpen) => set({ importOpen }),
      setMountsMode: (mountsMode) => set({ mountsMode }),
      setMountsEnv: (mountsEnv) => set({ mountsEnv }),
      setMatrixProdGlobal: (matrixProdGlobal) => set({ matrixProdGlobal }),
      setLens: (lens) => set({ lens }),
      setSkillQuery: (skillQuery) => set({ skillQuery }),
      setSkillState: (skillState) => set({ skillState }),
      setSkillSort: (skillSort) => set({ skillSort }),
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
