// UI 状态（PRD 7.5）。主题不在这里，由 ThemeProvider 管理
import { create } from "zustand"

import type { CliProvider } from "@/bindings"
import type { ViewId } from "@/lib/copy"

export const VIEWS: ViewId[] = ["servers", "agents", "activity", "settings"]

/** 导航位置（F-408）：顶栏或左侧栏，记在 localStorage */
export type NavPosition = "top" | "side"
const NAV_KEY = "cloudlink-nav-position"
function readNav(): NavPosition {
  try {
    return localStorage.getItem(NAV_KEY) === "side" ? "side" : "top"
  } catch {
    return "top"
  }
}

/** 详情视图的 3 个 Tab（PRD 6.4）：画像与规则、连接配置、动态 */
export type DetailTab = "profile" | "connection" | "activity"

/** 添加资源的弹窗（PRD 6.5）：选类型、SSH 表单或某个云平台的向导 */
export type CreateKind = "pick" | "ssh" | CliProvider

/** OCI 实例旁的「同时加为 SSH 服务器」预填的字段（F-104 AC4） */
export interface CreatePrefill {
  host: string
  name: string
}

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
  /** 添加资源的弹窗（PRD 6.5）；null 表示没有打开 */
  creating: CreateKind | null
  createPrefill: CreatePrefill | null
  detailTab: DetailTab
  /** 从详情返回列表后，焦点回到这一行 */
  returnFocusId: string | null
  query: string
  previewOpen: boolean
  /** 预览哪一份总 Skill（运行环境 × Agent，compileKey）；null 或已不存在时取第一份 */
  previewKey: string | null
  previewFocus: PreviewFocus
  /** 探测 Sheet 打开时显示哪台服务器 */
  probeSheetAssetId: string | null
  commandOpen: boolean
  navPosition: NavPosition
  /** 顶栏搜索框展开（PRD 6.3） */
  searchOpen: boolean
  importOpen: boolean
  settingsSection: SettingsSection
  /** 各视图主滚动区的位置，切回视图时恢复（PRD 6.3） */
  scrollByView: Partial<Record<ViewId, number>>

  setView: (view: ViewId, opts?: NavOptions) => void
  /** 顶栏的视图切换：再点一次「资源」从详情返回列表（PRD 6.4） */
  goToView: (view: ViewId) => void
  selectAsset: (id: string | null, opts?: NavOptions) => void
  startCreate: (kind?: CreateKind, opts?: NavOptions & { prefill?: CreatePrefill }) => void
  /** 回到资源列表（详情的「← 返回」、Esc、关闭添加弹窗） */
  closeInspector: (opts?: NavOptions) => void
  setDetailTab: (tab: DetailTab) => void
  clearReturnFocus: () => void
  setQuery: (query: string) => void
  openPreview: (focus?: Omit<PreviewFocus, "seq">) => void
  setPreviewOpen: (open: boolean) => void
  setPreviewKey: (key: string) => void
  /** 打开某台服务器的探测 Sheet（「探测」按钮、Toast 的「查看」） */
  openProbeSheet: (assetId: string) => void
  closeProbeSheet: () => void
  setCommandOpen: (open: boolean) => void
  setNavPosition: (pos: NavPosition) => void
  toggleNavPosition: () => void
  setSearchOpen: (open: boolean) => void
  setImportOpen: (open: boolean) => void
  setSettingsSection: (section: SettingsSection) => void
  saveScroll: (view: ViewId, top: number) => void
}

export const useUIStore = create<UIState>()((set, get) => ({
      view: "servers",
      viewSwitches: 0,
      selectedAssetId: null,
      creating: null,
      createPrefill: null,
      detailTab: "profile",
      returnFocusId: null,
      query: "",
      previewOpen: false,
      previewKey: null,
      previewFocus: { seq: 0 },
      probeSheetAssetId: null,
      commandOpen: false,
      navPosition: readNav(),
      searchOpen: false,
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
      goToView: (view) => {
        if (get().view === view && view === "servers") get().closeInspector()
        else get().setView(view)
      },
      selectAsset: (selectedAssetId, opts) => {
        const s = get()
        if (s.selectedAssetId === selectedAssetId && !s.creating) return
        // 切到另一项资源时回到默认 Tab；云平台和服务器的 Tab 内容不同，停在「动态」没有意义
        guarded(opts, () => set({ selectedAssetId, creating: null, createPrefill: null, detailTab: "profile" }))
      },
      closeInspector: (opts) => {
        const s = get()
        if (!s.selectedAssetId && !s.creating) return
        guarded(opts, () => set({ selectedAssetId: null, creating: null, createPrefill: null, returnFocusId: s.selectedAssetId }))
      },
      setDetailTab: (detailTab) => set({ detailTab }),
      clearReturnFocus: () => set({ returnFocusId: null }),
      startCreate: (kind = "pick", opts) =>
        guarded(opts, () =>
          set((s) => ({
            creating: kind,
            createPrefill: opts?.prefill ?? null,
            selectedAssetId: null,
            view: "servers",
            viewSwitches: s.view === "servers" ? s.viewSwitches : s.viewSwitches + 1,
          }))
        ),
      setQuery: (query) => set({ query }),
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
            creating: null,
            view: "servers",
            viewSwitches: st.view === "servers" ? st.viewSwitches : st.viewSwitches + 1,
            probeSheetAssetId: assetId,
            previewOpen: false,
          }))
        )
      },
      closeProbeSheet: () => set({ probeSheetAssetId: null }),
      setCommandOpen: (commandOpen) => set({ commandOpen }),
      setNavPosition: (navPosition) => {
        try {
          localStorage.setItem(NAV_KEY, navPosition)
        } catch {
          // 存不下就只在本次会话生效
        }
        set({ navPosition })
      },
      toggleNavPosition: () => get().setNavPosition(get().navPosition === "top" ? "side" : "top"),
      setSearchOpen: (searchOpen) => set(searchOpen ? { searchOpen } : { searchOpen, query: "" }),
      setImportOpen: (importOpen) => set({ importOpen }),
      setSettingsSection: (settingsSection) => set({ settingsSection }),
      saveScroll: (view, top) => set((s) => ({ scrollByView: { ...s.scrollByView, [view]: top } })),
}))

/** 命令面板的「预览 Skill」：在当前视图打开预览；设置页没有预览，先切到 Agent 页再打开 */
export function openPreviewHere() {
  const s = useUIStore.getState()
  if (s.view === "settings" || s.view === "activity") s.setView("agents", { then: () => useUIStore.getState().openPreview() })
  else s.openPreview()
}

/** Ctrl+\（PRD 6.9）：开着就关，否则同「预览 Skill」 */
export function togglePreview() {
  if (useUIStore.getState().previewOpen) useUIStore.getState().setPreviewOpen(false)
  else openPreviewHere()
}
