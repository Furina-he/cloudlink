import { zodResolver } from "@hookform/resolvers/zod"
import {
  CircleXIcon,
  CopyIcon,
  EllipsisIcon,
  FolderOpenIcon,
  PanelBottomIcon,
  PanelRightIcon,
  PencilLineIcon,
  RadarIcon,
  ServerIcon,
  Trash2Icon,
} from "lucide-react"
import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { createPortal } from "react-dom"
import {
  FormProvider,
  useForm,
  useFormContext,
  useWatch,
  type FieldErrors,
  type FieldPath,
} from "react-hook-form"
import { useHotkeys } from "react-hotkeys-hook"
import { useDefaultLayout, usePanelRef } from "react-resizable-panels"
import { useShallow } from "zustand/react/shallow"

import type { Asset, IpcError, Mode } from "@/bindings"
import { Keys } from "@/components/app/Keys"
import { useScrollRestore, useToolbarSlot, useViewTitleFocus } from "@/components/app/ViewShell"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { useSidebar } from "@/components/ui/sidebar"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "@/components/ui/toast"
import { Toggle } from "@/components/ui/toggle"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useDelayedFlag } from "@/hooks/use-delayed-flag"
import { copy, ipcErrorText } from "@/lib/copy"
import { HOTKEY_OPTIONS, HOTKEYS, isModalOpen, KEY_HINT, SINGLE_KEY_OPTIONS } from "@/lib/hotkeys"
import { ipc } from "@/lib/ipc"
import { assetFormSchema, type AssetFormValues } from "@/lib/schemas"
import { useAssetStore } from "@/stores/assets"
import { selectMountsBySkill, useMountStore } from "@/stores/mounts"
import { isProbing, selectActiveRun, useProbeStore } from "@/stores/probe"
import { selectSkillOfAsset, useSkillStore } from "@/stores/skills"
import { setLeaveGuard, useUIStore } from "@/stores/ui"
import { AssetEditor } from "./AssetEditor"
import { AssetList } from "./AssetList"
import {
  countTabErrors,
  firstErrorPath,
  FORM_TABS,
  formValuesOf,
  newAssetValues,
  toAssetInput,
} from "./assetForm"
import { DeleteAssetDialog } from "./DeleteAssetDialog"
import { FirstLaunch, OnboardingChecklist, useOnboardingSteps } from "./Onboarding"
import { ProbePanel } from "./ProbePanel"
import { RenameDialog } from "./RenameDialog"
import { usePreviewCompile } from "./usePreviewCompile"

// 预览带 streamdown 和 Shiki，探测脚本对话框带 Shiki：都按需加载（PRD 9）
const SkillPreview = lazy(() => import("@/components/app/SkillPreview"))
const ProbeScriptDialog = lazy(() => import("./ProbeScriptDialog"))

/** 窗口窄于这个宽度时，预览栏默认折叠（PRD 6.4） */
const PREVIEW_MIN_WINDOW = 1200

/** 已处理过的「展开探测面板」请求；放在模块里，视图重新挂载后也不会重复处理旧请求 */
let handledProbePanelRequest = 0

/** 资产视图（PRD 6.4）：没有资产时是首次启动的空状态，否则是三栏工作区 */
export function AssetsView({ focusTitle }: { focusTitle: boolean }) {
  const status = useAssetStore((s) => s.status)
  const count = useAssetStore((s) => s.ids.length)
  const creating = useUIStore((s) => s.creatingAsset)
  const loading = (status === "idle" || status === "loading") && count === 0
  if (!loading && count === 0 && !creating && status !== "error") {
    return <FirstLaunch focusTitle={focusTitle} />
  }
  return <AssetWorkspace focusTitle={focusTitle} loading={loading} />
}

function NoSelection() {
  const { steps, complete } = useOnboardingSteps()
  const failed = useAssetStore((s) => s.status === "error" && s.ids.length === 0)
  return (
    <div className="flex h-full items-start justify-center overflow-auto p-6">
      <Empty className="max-w-lg flex-none border">
        <EmptyHeader>
          <EmptyMedia variant="icon">{failed ? <CircleXIcon /> : <ServerIcon />}</EmptyMedia>
          <EmptyTitle>{failed ? copy.assets.loadFailedTitle : copy.assets.noSelectionTitle}</EmptyTitle>
          <EmptyDescription>
            {failed ? copy.assets.loadFailedDescription : copy.assets.noSelectionDescription}
          </EmptyDescription>
        </EmptyHeader>
        {!failed && !complete && <OnboardingChecklist steps={steps} />}
      </Empty>
    </div>
  )
}

function EditorSkeleton() {
  return (
    <div className="flex flex-col gap-4 p-3" aria-busy="true">
      <Skeleton className="h-5 w-1/2" />
      <Skeleton className="h-3.5 w-1/3" />
      <Skeleton className="h-8 w-2/3" />
      <div className="flex flex-col gap-3 pt-2">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="flex flex-col gap-1.5">
            <Skeleton className="h-3.5 w-16" />
            <Skeleton className="h-8" />
          </div>
        ))}
      </div>
    </div>
  )
}

/** 预览面板：取表单草稿，200ms 防抖后调用预览编译 */
function PreviewPane({
  asset,
  open,
  scope,
  mode,
  onModeChange,
  lintRequest,
}: {
  asset: Asset | undefined
  open: boolean
  scope: string
  mode: Mode
  onModeChange: (mode: Mode) => void
  lintRequest: number
}) {
  const {
    control,
    formState: { isDirty },
  } = useFormContext<AssetFormValues>()
  const values = useWatch({ control }) as AssetFormValues
  const { preview, pending, error } = usePreviewCompile(
    open ? toAssetInput(values, asset) : null,
    mode,
    scope,
    isDirty ? 200 : 0
  )
  const skill = useSkillStore((s) => selectSkillOfAsset(s.statusById, asset?.id ?? null))
  const path = skill?.variants.find((v) => v.mode === mode)?.path

  return (
    <Suspense fallback={<EditorSkeleton />}>
      <SkillPreview
        preview={preview}
        pending={pending}
        error={error}
        draft={open && isDirty}
        mode={mode}
        onModeChange={onModeChange}
        publish={!open ? null : !asset ? { kind: "unsaved" } : path ? { kind: "path", path } : { kind: "unpublished" }}
        lintRequest={lintRequest}
      />
    </Suspense>
  )
}

function AssetWorkspace({ focusTitle, loading }: { focusTitle: boolean; loading: boolean }) {
  const titleRef = useRef<HTMLHeadingElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  useViewTitleFocus(titleRef, focusTitle)
  useScrollRestore(
    "assets",
    () => document.querySelector<HTMLElement>("#assets-list [data-slot=command-list]"),
    !loading
  )
  const showSkeleton = useDelayedFlag(loading)

  const selectedAssetId = useUIStore((s) => s.selectedAssetId)
  const creating = useUIStore((s) => s.creatingAsset)
  const asset = useAssetStore((s) => (selectedAssetId ? s.byId[selectedAssetId] : undefined))
  const editorOpen = creating || !!asset
  const formKey = creating ? "new" : (asset?.id ?? "none")

  // ---------- 表单：草稿只在 RHF 里（PRD 7.5）；资产数据变化时用 values 同步，保留用户正在改的字段 ----------
  const byId = useAssetStore((s) => s.byId)
  const schema = useMemo(() => assetFormSchema(Object.values(byId), asset?.id), [byId, asset?.id])
  const values = useMemo(() => (asset ? formValuesOf(asset) : newAssetValues()), [asset])
  const form = useForm<AssetFormValues>({
    resolver: zodResolver(schema),
    values,
    resetOptions: { keepDirtyValues: true },
    mode: "onBlur",
    reValidateMode: "onChange",
  })
  const { isDirty, isSubmitting } = form.formState
  const alias = useWatch({ control: form.control, name: "sshAlias" })
  const defaultMode = useWatch({ control: form.control, name: "defaultMode" })

  // ---------- 离开当前资产前确认（PRD 6.4）：切资产、新建、切视图都会经过这里 ----------
  const [leaveAction, setLeaveAction] = useState<(() => void) | null>(null)
  useEffect(() => {
    if (!isDirty) return
    setLeaveGuard((proceed) => {
      setLeaveAction(() => proceed)
      return true
    })
    return () => setLeaveGuard(null)
  }, [isDirty])

  // ---------- 保存（PRD 6.4）：校验失败时标出各标签页的错误数，切到第一个出错的标签页，再聚焦字段 ----------
  const [saveError, setSaveError] = useState<IpcError | null>(null)
  const [focusRequest, setFocusRequest] = useState<{ name: string } | null>(null)
  useEffect(() => {
    if (!focusRequest) return
    // 等新标签页的字段挂载完成再聚焦；不能只靠 shouldFocusError
    const raf = requestAnimationFrame(() => form.setFocus(focusRequest.name as FieldPath<AssetFormValues>))
    return () => cancelAnimationFrame(raf)
  }, [focusRequest, form])

  const onValid = async (v: AssetFormValues) => {
    setSaveError(null)
    try {
      const result = await useAssetStore.getState().save(toAssetInput(v, asset))
      form.reset(formValuesOf(result.asset))
      void useSkillStore.getState().refresh()
      if (!asset) useUIStore.getState().selectAsset(result.asset.id, { force: true })
    } catch (e) {
      const err = e as IpcError
      if (err.id === "slug-taken") {
        form.setError("slug", { message: "slug-taken" })
        useUIStore.getState().setAssetTab("overview")
        setFocusRequest({ name: "slug" })
      } else {
        setSaveError(err)
      }
    }
  }
  const onInvalid = (errors: FieldErrors<AssetFormValues>) => {
    const tab = FORM_TABS.find((t) => countTabErrors(errors, t) > 0)
    if (!tab) return
    useUIStore.getState().setAssetTab(tab)
    const name = firstErrorPath(errors, tab)
    if (name) setFocusRequest({ name })
  }
  const save = () => {
    if (!editorOpen || isSubmitting) return
    void form.handleSubmit(onValid, onInvalid)()
  }
  const openLogs = () =>
    void ipc
      .getSettings()
      .then((s) => ipc.revealInDir(s.logDir))
      .catch(() => undefined)

  // ---------- 面板：布局持久化 id 为 assets（PRD 6.4）；预览、探测面板可折叠 ----------
  const layout = useDefaultLayout({ id: "assets" })
  const editorLayout = useDefaultLayout({ id: "assets-editor" })
  const previewRef = usePanelRef()
  const probeRef = usePanelRef()
  const [previewOpen, setPreviewOpen] = useState(true)
  const [probeOpen, setProbeOpen] = useState(true)
  const toggle = (ref: typeof previewRef) => {
    const p = ref.current
    if (!p) return
    if (p.isCollapsed()) p.expand()
    else p.collapse()
  }

  // 窗口窄、侧栏展开时，按 6.4 的最小宽度放不下预览栏：先把侧栏收成图标模式腾出空间
  // （2026-10-28 用户确认）；侧栏收起有过渡，宽度稳定前逐帧重试。仍然放不下就说明原因
  const sidebar = useSidebar()
  const showPreview = () => {
    const p = previewRef.current
    if (!p) return
    p.expand()
    if (!p.isCollapsed()) return
    if (!sidebar.open) {
      toast.add({ title: copy.editor.previewNoRoom })
      return
    }
    sidebar.setOpen(false)
    const until = performance.now() + 600
    const retry = () => {
      const panel = previewRef.current
      if (!panel) return
      panel.expand()
      if (!panel.isCollapsed()) return
      if (performance.now() < until) requestAnimationFrame(retry)
      else toast.add({ title: copy.editor.previewNoRoom })
    }
    requestAnimationFrame(retry)
  }
  const togglePreview = () => {
    if (previewRef.current?.isCollapsed()) showPreview()
    else previewRef.current?.collapse()
  }

  useEffect(() => {
    if (window.innerWidth < PREVIEW_MIN_WINDOW) previewRef.current?.collapse()
    let wide = window.innerWidth >= PREVIEW_MIN_WINDOW
    const onResize = () => {
      const now = window.innerWidth >= PREVIEW_MIN_WINDOW
      if (wide && !now) previewRef.current?.collapse()
      wide = now
    }
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [previewRef])

  // 探测开始时自动展开探测面板（PRD 6.5）；「探测当前资产」、Toast 的「查看」也会请求展开
  const runningRunId = useProbeStore((s) => {
    const run = selectActiveRun(s, asset?.id ?? null)
    return run?.status === "running" ? run.runId : null
  })
  const probePanelRequest = useUIStore((s) => s.probePanelRequest)
  useEffect(() => {
    if (runningRunId) probeRef.current?.expand()
  }, [runningRunId, probeRef])
  useEffect(() => {
    if (probePanelRequest <= handledProbePanelRequest) return
    handledProbePanelRequest = probePanelRequest
    probeRef.current?.expand()
  }, [probePanelRequest, probeRef])

  // ---------- 预览档位：默认跟随资产的默认档位，用户在预览里选过就按选的来，换资产后复位 ----------
  const [modeChoice, setModeChoice] = useState<{ key: string; mode: Mode } | null>(null)
  const previewMode = modeChoice?.key === formKey ? modeChoice.mode : defaultMode
  const [lintRequest, setLintRequest] = useState(0)
  const showLint = () => {
    showPreview()
    if (asset) setModeChoice({ key: formKey, mode: asset.guardrails.defaultMode })
    setLintRequest((n) => n + 1)
  }

  // ---------- 探测 ----------
  const probing = useProbeStore((s) => (asset ? isProbing(s, asset.id) : false))
  const startProbe = () => {
    if (!asset) return
    useProbeStore
      .getState()
      .start(asset.id)
      .catch((e: IpcError) => toast.add({ title: ipcErrorText(e.id, e.params), type: "error" }))
  }
  const cancelProbe = () => {
    const run = selectActiveRun(useProbeStore.getState(), asset?.id ?? null)
    if (run) void useProbeStore.getState().cancel(run.runId)
  }

  // ---------- 更多菜单里的对话框 ----------
  const skill = useSkillStore((s) => selectSkillOfAsset(s.statusById, asset?.id ?? null))
  const mounts = useMountStore(useShallow((s) => selectMountsBySkill(s.byId, skill?.id)))
  const compiledPath = skill?.variants.find((v) => v.mode === asset?.guardrails.defaultMode)?.path
  const [dialog, setDialog] = useState<{ kind: "rename" | "delete" | null; session: number }>({ kind: null, session: 0 })
  const openDialog = (kind: "rename" | "delete") => setDialog((d) => ({ kind, session: d.session + 1 }))
  const closeDialog = () => setDialog((d) => ({ ...d, kind: null }))
  const [script, setScript] = useState({ open: false, mounted: false })

  // ---------- 快捷键（PRD 6.12）；有模态对话框时交给对话框处理 ----------
  useHotkeys(HOTKEYS.save, () => !isModalOpen() && save(), HOTKEY_OPTIONS)
  useHotkeys(HOTKEYS.preview, () => !isModalOpen() && togglePreview(), HOTKEY_OPTIONS)
  useHotkeys(HOTKEYS.probe, () => editorOpen && !isModalOpen() && toggle(probeRef), HOTKEY_OPTIONS)
  useHotkeys(HOTKEYS.focusSearch, () => !isModalOpen() && searchRef.current?.focus(), SINGLE_KEY_OPTIONS)

  const slot = useToolbarSlot()
  const actions = (
    <>
      <Button
        variant="outline"
        size="sm"
        disabled={!asset || !asset.connection.sshAlias}
        onClick={probing ? cancelProbe : startProbe}
      >
        {probing ? <Spinner data-icon="inline-start" aria-hidden /> : <RadarIcon data-icon="inline-start" />}
        {probing ? copy.editor.cancelProbe : copy.editor.probe}
      </Button>
      <Button size="sm" disabled={!editorOpen || isSubmitting || (!isDirty && !creating)} onClick={save}>
        {isSubmitting && <Spinner data-icon="inline-start" aria-hidden />}
        {isSubmitting ? copy.editor.saving : copy.editor.save}
        <Keys keys={KEY_HINT.save} className="[&>kbd]:bg-primary-foreground/15 [&>kbd]:text-primary-foreground" />
      </Button>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger
            render={
              <DropdownMenuTrigger
                render={<Button variant="outline" size="icon-sm" aria-label={copy.editor.more} disabled={!asset} />}
              />
            }
          >
            <EllipsisIcon />
          </TooltipTrigger>
          <TooltipContent>{copy.editor.more}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end" className="w-auto min-w-48">
          <DropdownMenuItem
            onClick={() =>
              asset &&
              void navigator.clipboard
                .writeText(asset.slug)
                .then(() => toast.add({ title: copy.editor.slugCopied(asset.slug) }))
            }
          >
            <CopyIcon />
            {copy.editor.copySlug}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!compiledPath} onClick={() => compiledPath && void ipc.revealInDir(compiledPath)}>
            <FolderOpenIcon />
            {copy.editor.revealCompiled}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => openDialog("rename")}>
            <PencilLineIcon />
            {copy.editor.rename}
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={() => openDialog("delete")}>
            <Trash2Icon />
            {copy.editor.delete}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Separator orientation="vertical" className="mx-1 data-vertical:h-4 data-vertical:self-center" />
      <Tooltip>
        <TooltipTrigger
          render={
            <Toggle
              size="sm"
              aria-label={copy.editor.probePanel}
              pressed={editorOpen && probeOpen}
              disabled={!editorOpen}
              onPressedChange={() => toggle(probeRef)}
            />
          }
        >
          <PanelBottomIcon />
        </TooltipTrigger>
        <TooltipContent>
          {copy.editor.probePanel} <Keys keys={KEY_HINT.probe} />
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <Toggle
              size="sm"
              aria-label={copy.editor.preview}
              pressed={previewOpen}
              onPressedChange={togglePreview}
            />
          }
        >
          <PanelRightIcon />
        </TooltipTrigger>
        <TooltipContent>
          {copy.editor.preview} <Keys keys={KEY_HINT.preview} />
        </TooltipContent>
      </Tooltip>
    </>
  )

  return (
    <FormProvider {...form}>
      <ResizablePanelGroup
        id="assets"
        orientation="horizontal"
        defaultLayout={layout.defaultLayout}
        onLayoutChanged={layout.onLayoutChanged}
        className="min-h-0 flex-1"
      >
        <ResizablePanel id="list" defaultSize="24%" minSize="220px" maxSize="40%">
          <div id="assets-list" className="h-full">
            <AssetList titleRef={titleRef} searchRef={searchRef} loading={showSkeleton} />
          </div>
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel id="editor" defaultSize="42%" minSize="420px">
          {loading ? (
            showSkeleton && <EditorSkeleton />
          ) : editorOpen ? (
            <ResizablePanelGroup
              id="assets-editor"
              orientation="vertical"
              defaultLayout={editorLayout.defaultLayout}
              onLayoutChanged={editorLayout.onLayoutChanged}
            >
              <ResizablePanel id="form" minSize="160px">
                <AssetEditor
                  asset={asset}
                  slugLocked={mounts.length > 0}
                  saveError={saveError}
                  onRetrySave={save}
                  onOpenLogs={openLogs}
                  onRename={() => openDialog("rename")}
                  onShowLint={showLint}
                />
              </ResizablePanel>
              <ResizableHandle />
              <ResizablePanel
                id="probe"
                defaultSize="30%"
                minSize="120px"
                collapsible
                collapsedSize="0px"
                panelRef={probeRef}
                onResize={(size) => setProbeOpen(size.inPixels > 0)}
              >
                <ProbePanel
                  assetId={asset?.id ?? null}
                  alias={alias}
                  dirty={isDirty}
                  onCollapse={() => probeRef.current?.collapse()}
                  onViewScript={() => setScript({ open: true, mounted: true })}
                />
              </ResizablePanel>
            </ResizablePanelGroup>
          ) : (
            <NoSelection />
          )}
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel
          id="preview"
          defaultSize="34%"
          minSize="280px"
          collapsible
          collapsedSize="0px"
          panelRef={previewRef}
          onResize={(size) => setPreviewOpen(size.inPixels > 0)}
        >
          <PreviewPane
            asset={asset}
            open={editorOpen}
            scope={formKey}
            mode={previewMode}
            onModeChange={(mode) => setModeChoice({ key: formKey, mode })}
            lintRequest={lintRequest}
          />
        </ResizablePanel>
      </ResizablePanelGroup>

      {slot && createPortal(actions, slot)}

      <AlertDialog open={leaveAction !== null} onOpenChange={(open) => !open && setLeaveAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{copy.editor.leave.title}</AlertDialogTitle>
            <AlertDialogDescription>{copy.editor.leave.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{copy.editor.leave.keep}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                const proceed = leaveAction
                setLeaveAction(null)
                setSaveError(null)
                form.reset()
                proceed?.()
              }}
            >
              {copy.editor.leave.discard}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {asset && (
        <>
          <RenameDialog
            key={`rename-${dialog.session}`}
            open={dialog.kind === "rename"}
            onOpenChange={(open) => !open && closeDialog()}
            asset={asset}
            mounts={mounts}
          />
          <DeleteAssetDialog
            key={`delete-${dialog.session}`}
            open={dialog.kind === "delete"}
            onOpenChange={(open) => !open && closeDialog()}
            asset={asset}
            mounts={mounts}
          />
        </>
      )}
      {script.mounted && (
        <Suspense fallback={null}>
          <ProbeScriptDialog open={script.open} onOpenChange={(open) => setScript((s) => ({ ...s, open }))} />
        </Suspense>
      )}
    </FormProvider>
  )
}
