import { useEffect, useRef, useState, type ReactNode } from "react"
import { FormProvider, type UseFormReturn } from "react-hook-form"
import { useHotkeys } from "react-hotkeys-hook"

import type { ServerAsset } from "@/bindings"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { copy } from "@/lib/copy"
import { HOTKEY_OPTIONS, HOTKEYS, isModalOpen } from "@/lib/hotkeys"
import type { AliasContext, ServerFormValues } from "@/lib/schemas"
import { selectPendingCount, useNotesStore } from "@/stores/notes"
import { useOperationStore } from "@/stores/operations"
import { isProbing, useProbeStore } from "@/stores/probe"
import { useUIStore, type DetailTab } from "@/stores/ui"
import { RadarIcon } from "lucide-react"
import { serverActions } from "./actions"
import { useConnectionTest } from "./ConnectionTest"
import { DetailHeader, type EditConnection } from "./DetailHeader"
import { DraftPreview, SaveErrorAlert } from "./DraftPreview"
import { LeaveDialog, useLeaveGuard } from "./LeaveDialog"
import { SaveBar } from "./SaveBar"
import { SaveFlowDialogs } from "./SaveFlowDialogs"
import { OtherFields, SitesField, SummaryField } from "./sections/BasicSection"
import { ConnectionSection } from "./sections/ConnectionSection"
import { GuardrailsSection } from "./sections/GuardrailsSection"
import { NotesSection } from "./sections/NotesSection"
import { OperationsSection } from "./sections/OperationsSection"
import { PathsSection } from "./sections/PathsSection"
import { ServicesSection } from "./sections/ServicesSection"
import { firstError, focusField } from "./serverForm"
import { useAliasContext, useServerForm } from "./useServerForm"
import { useSaveFlow, type RevealTarget } from "./useSaveFlow"

/** Tab 里的一组内容：标题是 h3（详情标题是 h2），层级不跳级 */
export function DetailGroup({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex min-h-7 items-center gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        {action && <span className="ml-auto">{action}</span>}
      </div>
      {children}
    </section>
  )
}

/** 3 个平铺 Tab（PRD 6.4）：有待处理笔记时第三个显示「动态 (N)」 */
export function DetailTabs({ assetId, children }: { assetId: string; children: Record<DetailTab, ReactNode> }) {
  const tab = useUIStore((s) => s.detailTab)
  const pending = useNotesStore((s) => selectPendingCount(s.byAsset, assetId))
  const label: Record<DetailTab, string> = {
    profile: copy.detail.tabs.profile,
    connection: copy.detail.tabs.connection,
    activity: pending ? copy.detail.activityCount(pending) : copy.detail.tabs.activity,
  }
  return (
    <Tabs value={tab} onValueChange={(v) => useUIStore.getState().setDetailTab(v as DetailTab)} className="min-h-0 flex-1 gap-0">
      <TabsList variant="line" aria-label={copy.detail.tabsLabel} className="w-full shrink-0 justify-start border-b px-4">
        {(["profile", "connection", "activity"] as const).map((t) => (
          <TabsTrigger key={t} value={t} className="flex-none tabular-nums">
            {label[t]}
          </TabsTrigger>
        ))}
      </TabsList>
      <ScrollArea className="min-h-0 flex-1">
        {(["profile", "connection", "activity"] as const).map((t) => (
          <TabsContent key={t} value={t} className="flex flex-col gap-6 p-4 pb-8">
            {children[t]}
          </TabsContent>
        ))}
      </ScrollArea>
    </Tabs>
  )
}

function ProbeNowButton({ asset }: { asset: ServerAsset }) {
  const probing = useProbeStore((s) => isProbing(s, asset.id))
  return (
    <Button variant="outline" size="xs" onClick={() => (probing ? serverActions.cancelProbe(asset) : serverActions.probe(asset))}>
      {probing ? <Spinner data-icon="inline-start" aria-hidden /> : <RadarIcon data-icon="inline-start" />}
      {probing ? copy.detail.cancelProbe : copy.detail.probe}
    </Button>
  )
}

function DetailBody({ asset, form, ctx }: { asset: ServerAsset; form: UseFormReturn<ServerFormValues>; ctx: AliasContext }) {
  const titleRef = useRef<HTMLHeadingElement>(null)
  // 从列表进入详情：焦点移到标题，读屏和键盘都从这里开始
  useEffect(() => titleRef.current?.focus({ preventScroll: true }), [])
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const conn = useConnectionTest(form, asset.id, asset.id)

  /** 切到出错字段所在的 Tab，必要时展开「高级」 */
  const reveal = (target: RevealTarget) => {
    useUIStore.getState().setDetailTab(target.tab)
    if (target.advanced) setAdvancedOpen(true)
    focusField(form, target.path)
  }
  const flow = useSaveFlow({ asset, form, testKey: asset.id, reveal })
  const discard = () => {
    // 必须关掉 keepDirtyValues：它只用于后台同步，RHF 的 reset() 也会带上 useForm 的 resetOptions
    form.reset(undefined, { keepDirtyValues: false })
    flow.clearError()
  }
  const guard = useLeaveGuard(form.formState.isDirty, discard)

  useEffect(() => {
    void useOperationStore.getState().load(asset.id)
  }, [asset.id])
  useHotkeys(HOTKEYS.save, () => !isModalOpen() && flow.submit(), HOTKEY_OPTIONS)

  const runTest = async () => {
    if (await conn.run()) return
    const target = firstError(form.formState.errors)
    if (target) reveal(target)
  }
  // 「改用密钥登录」用凭据库里的密码：草稿里改过密码时先保存
  const convert = () => {
    if (form.formState.isDirty) flow.submit({ after: (saved) => void serverActions.convertToKey(saved.id) })
    else void serverActions.convertToKey(asset.id)
  }
  const editConnection: EditConnection = (path) => reveal({ tab: "connection", advanced: path === "connection.definedIn", path })

  return (
    <section aria-labelledby="detail-title" className="flex h-full min-h-0 flex-col">
      <DetailHeader asset={asset} titleRef={titleRef} conn={conn} onTest={() => void runTest()} onConvert={convert} onEdit={editConnection} />
      {flow.error && (
        <div className="px-3 pt-3">
          <SaveErrorAlert error={flow.error} onRetry={() => flow.submit()} />
        </div>
      )}
      <DetailTabs assetId={asset.id}>
        {{
          profile: (
            <>
              <div className="flex flex-col gap-4">
                <SummaryField />
                <SitesField />
              </div>
              <DetailGroup title={copy.detail.groups.guardrails}>
                <GuardrailsSection />
              </DetailGroup>
              <DetailGroup title={copy.detail.groups.services} action={<ProbeNowButton asset={asset} />}>
                <ServicesSection />
              </DetailGroup>
              <DetailGroup title={copy.detail.groups.paths}>
                <PathsSection />
              </DetailGroup>
              <DetailGroup title={copy.detail.groups.other}>
                <OtherFields />
              </DetailGroup>
            </>
          ),
          connection: <ConnectionSection asset={asset} ctx={ctx} advancedOpen={advancedOpen} onAdvancedChange={setAdvancedOpen} />,
          activity: (
            <>
              <DetailGroup title={copy.detail.groups.notes}>
                <NotesSection assetId={asset.id} />
              </DetailGroup>
              <DetailGroup title={copy.detail.groups.operations}>
                <OperationsSection assetId={asset.id} />
              </DetailGroup>
            </>
          ),
        }}
      </DetailTabs>
      {form.formState.isDirty && <SaveBar saving={flow.saving} onDiscard={discard} onSave={() => flow.submit()} />}
      <SaveFlowDialogs flow={flow} />
      <LeaveDialog guard={guard} />
      <DraftPreview control={form.control} asset={asset} dirty={form.formState.isDirty} />
    </section>
  )
}

/**
 * 服务器的详情视图（PRD 6.4）：带「← 返回」的常驻控制头加 3 个平铺 Tab，底部保存条。草稿只在 RHF 里（7.5）；
 * 分发、档位、笔记的并入和忽略立即生效，不经过保存
 */
export function ServerDetail({ asset }: { asset: ServerAsset }) {
  const ctx = useAliasContext(asset.id)
  const form = useServerForm(asset, ctx)
  return (
    <FormProvider {...form}>
      <DetailBody asset={asset} form={form} ctx={ctx} />
    </FormProvider>
  )
}
