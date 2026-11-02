// UI 状态（PRD 7.5）。主题不在这里，由 ThemeProvider 管理
import { create } from "zustand"
import { persist } from "zustand/middleware"

import type { ViewId } from "@/lib/copy"

export const VIEWS: ViewId[] = ["servers", "agents", "settings"]

/** 服务器详情的分段，顺序就是显示顺序（PRD 6.4）。Agent 分段固定在第一位 */
export const DETAIL_SECTIONS = [
  "agent",
  "notes",
  "operations",
  "connection",
  "basic",
  "paths",
  "services",
  "guardrails",
] as const
export type DetailSection = (typeof DETAIL_SECTIONS)[number]

export type SettingsSection =
  | "general"
  | "environments"
  | "ssh"
  | "compile"
  | "probe"
  | "activity"
  | "data"
  | "danger"

/**
 * 离开当前对象前的确认（PRD 6.4）。服务器详情、新建表单、Agent 页有未保存修改时注册：
 * 返回 true 表示已拦下，由它弹出「放弃修改 / 继续编辑」，确认后再调用 proceed
 */
export type LeaveGuard = (proceed: () => void) => boolean

let leaveGuard: LeaveGuard | null = null

export function setLeaveGuard(guard: LeaveGuard | null) {
  leaveGuard = guard
}

/** force：保存成功、删除服务器这类内部跳转，不再询问；then：真的跳转之后再做的事（例如筛选活动） */
export interface NavOptions {
  force?: boolean
  then?: () => void
}

function guarded(opts: NavOptions | undefined, action: () => void) {
  const run = () => {
    action()
    opts?.then?.()
  }
  if (!opts?.force && leaveGuard?.(run)) return
  run()
}

/** 预览 Sheet 的定位请求：每次 seq 加一，跳到指定文件，lint 为 true 时聚焦检查结果 */
export interface PreviewFocus {
  seq: number
  file?: string
  lint?: boolean
}

interface UIState {
  view: ViewId
  /** 本次会话中切换视图的次数，用于判断是否把焦点移到视图标题 */
  viewSwitches: number
  selectedAssetId: string | null
  /** 详情面板是新建表单（PRD 6.5） */
  creating: boolean
  query: string
  /** 详情各分段的展开状态；没记录的按默认值（PRD 6.4），只持久化这一项 */
  sectionsOpen: Partial<Record<DetailSection, boolean>>
  previewOpen: boolean
  /** 预览哪一份总 Skill（运行环境 × Agent，compileKey）；null 或已不存在时取第一份 */
  previewKey: string | null
  previewFocus: PreviewFocus
  /** 探测 Sheet 打开时显示哪台服务器 */
  probeSheetAssetId: string | null
  commandOpen: boolean
  importOpen: boolean
  settingsSection: SettingsSection
  /** 各视图主滚动区的位置，切回视图时恢复（PRD 6.3） */
  scrollByView: Partial<Record<ViewId, number>>

  setView: (view: ViewId, opts?: NavOptions) => void
  selectAsset: (id: string | null, opts?: NavOptions) => void
  startCreate: (opts?: NavOptions) => void
  setQuery: (query: string) => void
  toggleSection: (section: DetailSection, open: boolean) => void
  openPreview: (focus?: Omit<PreviewFocus, "seq">) => void
  setPreviewOpen: (open: boolean) => void
  setPreviewKey: (key: string) => void
  /** 打开某台服务器的探测 Sheet（「探测」按钮、Toast 的「查看」） */
  openProbeSheet: (assetId: string) => void
  closeProbeSheet: () => void
  setCommandOpen: (open: boolean) => void
  setImportOpen: (open: boolean) => void
  setSettingsSection: (section: SettingsSection) => void
  saveScroll: (view: ViewId, top: number) => void
}

export const useUIStore = create<UIState>()(
  persist(
    (set, get) => ({
      view: "servers",
      viewSwitches: 0,
      selectedAssetId: null,
      creating: false,
      query: "",
      sectionsOpen: {},
      previewOpen: false,
      previewKey: null,
      previewFocus: { seq: 0 },
      probeSheetAssetId: null,
      commandOpen: false,
      importOpen: false,
      settingsSection: "general",
      scrollByView: {},

      setView: (view, opts) => {
        if (get().view === view) {
          opts?.then?.()
          return
        }
        guarded(opts, () => set((s) => ({ view, viewSwitches: s.viewSwitches + 1, previewOpen: false })))
      },
      selectAsset: (selectedAssetId, opts) => {
        const s = get()
        if (s.selectedAssetId === selectedAssetId && !s.creating) return
        guarded(opts, () => set({ selectedAssetId, creating: false }))
      },
      startCreate: (opts) =>
        guarded(opts, () =>
          set((s) => ({
            creating: true,
            selectedAssetId: null,
            view: "servers",
            viewSwitches: s.view === "servers" ? s.viewSwitches : s.viewSwitches + 1,
          }))
        ),
      setQuery: (query) => set({ query }),
      toggleSection: (section, open) => set((s) => ({ sectionsOpen: { ...s.sectionsOpen, [section]: open } })),
      openPreview: (focus) =>
        set((s) => ({ previewOpen: true, probeSheetAssetId: null, previewFocus: { ...focus, seq: s.previewFocus.seq + 1 } })),
      setPreviewOpen: (previewOpen) => set(previewOpen ? { previewOpen, probeSheetAssetId: null } : { previewOpen }),
      setPreviewKey: (previewKey) => set({ previewKey }),
      openProbeSheet: (assetId) => {
        const s = get()
        // 就在这台服务器的详情里时不离开，不用确认；预览和探测共用右侧，同时只开一个
        const stay = s.view === "servers" && s.selectedAssetId === assetId && !s.creating
        guarded({ force: stay }, () =>
          set((st) => ({
            selectedAssetId: assetId,
            creating: false,
            view: "servers",
            viewSwitches: st.view === "servers" ? st.viewSwitches : st.viewSwitches + 1,
            probeSheetAssetId: assetId,
            previewOpen: false,
          }))
        )
      },
      closeProbeSheet: () => set({ probeSheetAssetId: null }),
      setCommandOpen: (commandOpen) => set({ commandOpen }),
      setImportOpen: (importOpen) => set({ importOpen }),
      setSettingsSection: (settingsSection) => set({ settingsSection }),
      saveScroll: (view, top) => set((s) => ({ scrollByView: { ...s.scrollByView, [view]: top } })),
    }),
    {
      name: "cloudlink-ui",
      version: 2,
      // 只持久化详情分段的展开状态（PRD 7.5）；v1 的挂载视图偏好直接丢弃
      partialize: (s) => ({ sectionsOpen: s.sectionsOpen }),
      migrate: () => ({ sectionsOpen: {} }),
      merge: (persisted, current) => ({
        ...current,
        sectionsOpen: (persisted as { sectionsOpen?: UIState["sectionsOpen"] } | undefined)?.sectionsOpen ?? {},
      }),
    }
  )
)

/** 命令面板的「预览 Skill」：在当前视图打开预览；设置页没有预览，先切到 Agent 页再打开 */
export function openPreviewHere() {
  const s = useUIStore.getState()
  if (s.view === "settings") s.setView("agents", { then: () => useUIStore.getState().openPreview() })
  else s.openPreview()
}

/** Ctrl+\（PRD 6.9）：开着就关，否则同「预览 Skill」 */
export function togglePreview() {
  if (useUIStore.getState().previewOpen) useUIStore.getState().setPreviewOpen(false)
  else openPreviewHere()
}

/** 分段的默认展开状态（PRD 6.4）：Agent、连接默认展开；有待处理的笔记时笔记展开；其余折叠 */
export function isSectionOpen(
  sectionsOpen: UIState["sectionsOpen"],
  section: DetailSection,
  pendingNotes: number
): boolean {
  const saved = sectionsOpen[section]
  if (saved !== undefined) return saved
  if (section === "agent" || section === "connection") return true
  if (section === "notes") return pendingNotes > 0
  return false
}
