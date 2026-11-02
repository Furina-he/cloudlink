import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { FormProvider, useWatch, type UseFormReturn } from "react-hook-form"
import { useHotkeys } from "react-hotkeys-hook"

import type { Asset } from "@/bindings"
import { ScrollArea } from "@/components/ui/scroll-area"
import { copy } from "@/lib/copy"
import { useAgentOptions } from "@/features/agents/agentKeys"
import { HOTKEY_OPTIONS, HOTKEYS, isModalOpen } from "@/lib/hotkeys"
import type { AliasContext, ServerFormValues } from "@/lib/schemas"
import { selectPendingCount, useNotesStore } from "@/stores/notes"
import { selectTodayCounts, useOperationStore } from "@/stores/operations"
import { isSectionOpen, useUIStore, type DetailSection as SectionId } from "@/stores/ui"
import { serverActions } from "./actions"
import { useConnectionTest } from "./ConnectionTest"
import { DetailHeader } from "./DetailHeader"
import { DetailSection } from "./DetailSection"
import { DraftPreview, SaveErrorAlert } from "./DraftPreview"
import { LeaveDialog, useLeaveGuard } from "./LeaveDialog"
import { SaveBar } from "./SaveBar"
import { SaveFlowDialogs } from "./SaveFlowDialogs"
import { AgentSection } from "./sections/AgentSection"
import { basicSummary, BasicSection } from "./sections/BasicSection"
import { ConnectionSection } from "./sections/ConnectionSection"
import { GuardrailsSection } from "./sections/GuardrailsSection"
import { NotesSection } from "./sections/NotesSection"
import { OperationsSection } from "./sections/OperationsSection"
import { PathsSection } from "./sections/PathsSection"
import { ServicesSection } from "./sections/ServicesSection"
import { firstError, focusField } from "./serverForm"
import { useAliasContext, useServerForm } from "./useServerForm"
import { useSaveFlow, type RevealTarget } from "./useSaveFlow"

const EMPTY_OPS: never[] = []

/** 折叠时标题行右侧的一句摘要（PRD 6.4），取草稿的值 */
function useSummaries(form: UseFormReturn<ServerFormValues>, asset: Asset) {
  const [connection, provider, region, tags, paths, services, rules] = useWatch({
    control: form.control,
    name: ["connection", "provider", "region", "tags", "paths", "services", "rules"],
  })
  const pending = useNotesStore((s) => selectPendingCount(s.byAsset, asset.id))
  const ops = useOperationStore((s) => s.recentByAsset[asset.id] ?? EMPTY_OPS)
  const today = useMemo(() => selectTodayCounts(ops), [ops])
  const { agents } = useAgentOptions()
  const distributedTo = agents.filter((a) => asset.agent.agents.includes(a.key)).map((a) => a.short).join("、")
  const s = copy.detail.summary
  return {
    pending,
    agent: s.agent(distributedTo, copy.mode[asset.agent.mode]),
    notes: pending ? s.notesPending(pending) : s.notesNone,
    operations: today.total ? s.opsToday(today.total, today.denied) : s.opsNone,
    connection:
      asset.connection.source === "imported"
        ? s.connectionImported
        : `${connection.user}@${connection.host}:${Number.isNaN(connection.port) ? "" : connection.port} · ${copy.auth[connection.method]}`,
    basic: basicSummary({ provider, region, tags }) || s.basicEmpty,
    paths: s.paths(paths.length),
    services: s.services(services.length, services.filter((x) => x.missing).length),
    guardrails: s.guardrails(rules.length, copy.guardrails.builtinRules.length),
  }
}

function DetailBody({ asset, form, ctx }: { asset: Asset; form: UseFormReturn<ServerFormValues>; ctx: AliasContext }) {
  const titleRef = useRef<HTMLHeadingElement>(null)
  const [editing, setEditing] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const conn = useConnectionTest(form, asset.id, asset.id)
  const sum = useSummaries(form, asset)

  /** 展开出错字段所在的分段；连接分段还要进入编辑态，必要时展开「高级」 */
  const reveal = (target: RevealTarget) => {
    const ui = useUIStore.getState()
    if (!isSectionOpen(ui.sectionsOpen, target.section, sum.pending)) ui.toggleSection(target.section, true)
    if (target.section === "connection") setEditing(true)
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
    if (form.formState.isDirty) flow.submit((saved) => void serverActions.convertToKey(saved.id))
    else void serverActions.convertToKey(asset.id)
  }
  const editConnection = (path: string) => reveal({ section: "connection", advanced: path === "connection.definedIn", path })

  const section = (id: SectionId, summary: string, children: ReactNode) => (
    <DetailSection id={id} summary={summary} pendingNotes={sum.pending}>
      {children}
    </DetailSection>
  )

  return (
    <section aria-labelledby="detail-title" className="flex h-full min-h-0 flex-col">
      <DetailHeader asset={asset} titleRef={titleRef} conn={conn} onTest={() => void runTest()} onConvert={convert} />
      <ScrollArea className="min-h-0 flex-1">
        {flow.error && (
          <div className="px-3 pt-3">
            <SaveErrorAlert error={flow.error} onRetry={() => flow.submit()} />
          </div>
        )}
        {section("agent", sum.agent, <AgentSection asset={asset} fixes={{ test: () => void runTest(), convert, editConnection }} />)}
        {section("notes", sum.notes, <NotesSection assetId={asset.id} />)}
        {section("operations", sum.operations, <OperationsSection assetId={asset.id} />)}
        {section(
          "connection",
          sum.connection,
          <ConnectionSection asset={asset} ctx={ctx} editing={editing} onEditingChange={setEditing} advancedOpen={advancedOpen} onAdvancedChange={setAdvancedOpen} />
        )}
        {section("basic", sum.basic, <BasicSection />)}
        {section("paths", sum.paths, <PathsSection />)}
        {section("services", sum.services, <ServicesSection />)}
        {section("guardrails", sum.guardrails, <GuardrailsSection />)}
      </ScrollArea>
      {form.formState.isDirty && <SaveBar saving={flow.saving} onDiscard={discard} onSave={() => flow.submit()} />}
      <SaveFlowDialogs flow={flow} />
      <LeaveDialog guard={guard} />
      <DraftPreview control={form.control} asset={asset} dirty={form.formState.isDirty} />
    </section>
  )
}

/**
 * 服务器详情（PRD 6.4）：头部、可折叠分段、底部保存操作条。草稿只在 RHF 里（7.5）；
 * 分发开关、档位、临时解锁、笔记的并入和忽略立即生效，不经过保存
 */
export function ServerDetail({ asset }: { asset: Asset }) {
  const ctx = useAliasContext(asset.id)
  const form = useServerForm(asset, ctx)
  return (
    <FormProvider {...form}>
      <DetailBody asset={asset} form={form} ctx={ctx} />
    </FormProvider>
  )
}
