import { PencilIcon, RadarIcon } from "lucide-react"
import { useRef, useState } from "react"
import { FormProvider, useWatch, type FieldPath } from "react-hook-form"
import { useHotkeys } from "react-hotkeys-hook"
import type { ServerAsset } from "@/bindings"
import { CommandChip } from "@/components/app/CommandChip"
import { CopyValue, FoldRow, ListGroup, PrefRow } from "@/components/app/SettingsList"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { copy } from "@/lib/copy"
import { HOTKEY_OPTIONS, HOTKEYS, isModalOpen } from "@/lib/hotkeys"
import type { ServerFormValues } from "@/lib/schemas"
import { useAssetStore } from "@/stores/assets"
import { isProbing, useProbeStore } from "@/stores/probe"
import { serverActions } from "./actions"
import { ConnectionDialog } from "./ConnectionDialog"
import { TestResult, useConnectionTest } from "./ConnectionTest"
import { DetailHeader, ServerProblems } from "./DetailHeader"
import { DetailPage, NotesRow, PermissionGroup, RecentActivityGroup, RulesGroup, SummaryRow } from "./DetailParts"
import { DraftPreview, SaveErrorAlert } from "./DraftPreview"
import { CompileSummary } from "./InspectorParts"
import { ProfileDialog } from "./ProfileDialog"
import { ListeningPorts } from "./sections/ConnectionSection"
import { ServiceInventory } from "./sections/ServicesSection"
import { renameInputOf } from "./profileForm"
import { sortEnvs } from "./serverForm"
import { useAutoSave } from "./useAutoSave"
import { useAliasContext, useServerForm } from "./useServerForm"

// 普通资料集中保存；生产标记仍为独立即时控制（P8 D6）。
const PAGE_FIELDS: FieldPath<ServerFormValues>[] = ["production"]

function ProbeButton({ asset }: { asset: ServerAsset }) {
  const probing = useProbeStore((s) => isProbing(s, asset.id))
  return <Button variant="ghost" size="sm" onClick={() => (probing ? serverActions.cancelProbe(asset) : serverActions.probe(asset))}>{probing ? <Spinner data-icon="inline-start" aria-hidden /> : <RadarIcon data-icon="inline-start" />}{probing ? copy.detail.cancelProbe : copy.detail.probe}</Button>
}

function ConnectionGroup({ asset, onEdit }: { asset: ServerAsset; onEdit: () => void }) {
  const c = asset.connection, r = c.resolved, imported = c.source === "imported"
  const host = imported ? r?.hostname : c.host, user = imported ? r?.user : c.user, port = imported ? r?.port : c.port
  const address = host ? `${user ? `${user}@` : ""}${host}${port && port !== 22 ? `:${port}` : ""}` : copy.common.none
  const jump = (imported ? r?.proxyJump : c.proxyJump) ?? null
  const method = c.auth?.method
  const keyPath = c.auth ? (c.auth.identityFile.windows ?? Object.values(c.auth.identityFile)[0]) : undefined
  return (
    <ListGroup id="detail-connection" title={copy.detail.groups.connection} action={<Button variant="ghost" size="sm" onClick={onEdit}><PencilIcon data-icon="inline-start" />{copy.detail.edit}</Button>}>
      <PrefRow label={copy.detail.rows.address} hint={imported ? copy.connection.importedFrom(sortEnvs(c.definedIn).map(copy.env.long).join("、")) : undefined}><CopyValue value={address} label={copy.detail.rows.address} className="max-w-80" /></PrefRow>
      {method && <PrefRow label={copy.detail.rows.auth}>{method === "key" && keyPath ? <CopyValue value={keyPath} label={copy.detail.rows.auth} className="max-w-80" /> : <span className="text-xs text-fg-2">{copy.detail.authMethod[method]}</span>}</PrefRow>}
      <PrefRow label={copy.detail.rows.jump}>{jump ? <CopyValue value={jump} label={copy.detail.rows.jump} className="max-w-80" /> : <span className="text-xs text-muted-foreground">{copy.common.none}</span>}</PrefRow>
    </ListGroup>
  )
}

function KnowledgeGroup({ asset }: { asset: ServerAsset }) {
  const summary = [asset.tags.length > 0 && copy.basic.tagCount(asset.tags.length), asset.provider, asset.region, asset.notes.trim() && copy.detail.hasNotes].filter((x): x is string => !!x)
  return (
    <ListGroup id="detail-knowledge" title={copy.detail.groups.knowledge}>
      <SummaryRow summary={asset.summary} />
      <PrefRow label={copy.basic.servedHostnames} hint={copy.basic.servedHostnamesHint}>
        {asset.servedHostnames.length ? <ul className="flex max-w-80 flex-wrap justify-end gap-1.5">{asset.servedHostnames.map((s) => <li key={s}><CommandChip>{s}</CommandChip></li>)}</ul> : <span className="text-xs text-muted-foreground">{copy.common.none}</span>}
      </PrefRow>
      <FoldRow label={copy.detail.more} hint={summary.length ? copy.basic.summaryLine(summary) : copy.detail.moreEmpty}>
        <PrefRow label={copy.basic.tags}><span className="text-xs text-fg-2">{asset.tags.join("、") || copy.common.none}</span></PrefRow>
        <PrefRow label={copy.basic.provider}><span className="text-xs text-fg-2">{asset.provider || copy.common.none}</span></PrefRow>
        <PrefRow label={copy.basic.region}><span className="text-xs text-fg-2">{asset.region || copy.common.none}</span></PrefRow>
        <NotesRow notes={asset.notes} />
      </FoldRow>
    </ListGroup>
  )
}

function ProbedGroup({ asset }: { asset: ServerAsset }) {
  const summary = copy.detail.probedSummary(asset.services.length, asset.services.filter((x) => x.critical).length, asset.paths.length, asset.listeningPorts.length)
  return (
    <ListGroup id="detail-probed" title={copy.detail.groups.probed} action={<ProbeButton asset={asset} />}>
      <FoldRow label={copy.detail.probedRow} hint={summary}>
        <PrefRow label={copy.detail.groups.services} block><ServiceInventory services={asset.services} /></PrefRow>
        <PrefRow label={copy.detail.groups.paths} block>
          {asset.paths.length ? <ul className="flex flex-col gap-2">{asset.paths.map((p) => <li key={p.key} className="flex flex-col gap-0.5"><span className="text-xs text-fg-2">{p.label}</span><span className="font-mono text-xs wrap-anywhere select-text">{p.path}</span></li>)}</ul> : <span className="text-xs text-muted-foreground">{copy.paths.empty}</span>}
        </PrefRow>
        <PrefRow label={copy.connection.listening} block><ListeningPorts asset={asset} /></PrefRow>
      </FoldRow>
    </ListGroup>
  )
}

/** 资料以查看为主；更多 → 编辑资料/连接均在当前详情上打开居中弹窗（P8 D6）。 */
export function ServerDetail({ asset }: { asset: ServerAsset }) {
  const ctx = useAliasContext(asset.id)
  const form = useServerForm(asset, ctx)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const conn = useConnectionTest(form, asset.id, asset.id)
  const [editor, setEditor] = useState<"connection" | "profile" | null>(null)
  const auto = useAutoSave({
    form,
    fields: PAGE_FIELDS,
    save: async ({ production }) => {
      await useAssetStore.getState().update(asset.id, (latest) => ({ ...renameInputOf(latest, latest.name), production }))
    },
  })
  const production = useWatch({ control: form.control, name: "production" })
  useHotkeys(HOTKEYS.save, () => !isModalOpen() && void auto.flush(), HOTKEY_OPTIONS)
  const edit = () => { void auto.flush(); setEditor("connection") }
  const runTest = () => void conn.run()
  const convert = () => void auto.flush().then(() => serverActions.convertToKey(asset.id))
  return (
    <FormProvider {...form}>
      <DetailPage onBlurCapture={auto.onBlurCapture}>
        <DetailHeader asset={asset} name={asset.name} production={production} titleRef={titleRef} conn={conn} onTest={runTest} onEditConnection={edit} onEditProfile={() => setEditor("profile")} />
        <TestResult className="empty:hidden" test={conn.test} current={conn.current} method={conn.method} assetId={asset.id} onConvert={convert} />
        <div className="empty:hidden"><CompileSummary asset={asset} dirty={form.formState.isDirty} /></div>
        {auto.error && <SaveErrorAlert error={auto.error} onRetry={() => void auto.flush()} />}
        <PermissionGroup asset={asset} problems={<ServerProblems asset={asset} onTest={runTest} onConvert={convert} onEdit={edit} />} />
        <ConnectionGroup asset={asset} onEdit={edit} />
        <KnowledgeGroup asset={asset} />
        <ProbedGroup asset={asset} />
        <RulesGroup rules={asset.guardrails.rules} />
        <RecentActivityGroup assetId={asset.id} />
      </DetailPage>
      <ConnectionDialog asset={asset} open={editor === "connection"} onOpenChange={(open) => !open && setEditor(null)} />
      {editor === "profile" && <ProfileDialog asset={asset} onClose={() => setEditor(null)} />}
      <DraftPreview control={form.control} asset={asset} dirty={form.formState.isDirty} />
    </FormProvider>
  )
}
