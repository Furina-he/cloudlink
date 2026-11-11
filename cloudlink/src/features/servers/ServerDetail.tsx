import { PencilIcon, RadarIcon } from "lucide-react"
import { useRef, useState } from "react"
import { FormProvider, useFormContext, useWatch, type FieldPath } from "react-hook-form"
import { useHotkeys } from "react-hotkeys-hook"

import type { ServerAsset } from "@/bindings"
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
import { DetailPage, NameRow, NotesRow, PermissionGroup, RecentActivityGroup, RulesGroup, SummaryRow } from "./DetailParts"
import { DraftPreview, SaveErrorAlert } from "./DraftPreview"
import { CompileSummary } from "./InspectorParts"
import { OtherFields, SitesField } from "./sections/BasicSection"
import { ListeningPorts } from "./sections/ConnectionSection"
import { PathsSection } from "./sections/PathsSection"
import { ServicesSection } from "./sections/ServicesSection"
import { sortEnvs, toAssetInput } from "./serverForm"
import { useAutoSave } from "./useAutoSave"
import { useAliasContext, useServerForm } from "./useServerForm"

/** 页面上能直接改的字段：编辑即保存；连接参数在连接编辑里改，不在这里 */
const PAGE_FIELDS: FieldPath<ServerFormValues>[] = ["name", "production", "summary", "servedHostnames", "tags", "provider", "region", "notes", "rules", "services", "paths"]

function ProbeButton({ asset }: { asset: ServerAsset }) {
  const probing = useProbeStore((s) => isProbing(s, asset.id))
  return (
    <Button variant="ghost" size="sm" onClick={() => (probing ? serverActions.cancelProbe(asset) : serverActions.probe(asset))}>
      {probing ? <Spinner data-icon="inline-start" aria-hidden /> : <RadarIcon data-icon="inline-start" />}
      {probing ? copy.detail.cancelProbe : copy.detail.probe}
    </Button>
  )
}

/** 连接（SSH）：地址、登录方式、跳板机，值用等宽字、悬停可复制；「编辑」打开连接编辑 */
function ConnectionGroup({ asset, onEdit }: { asset: ServerAsset; onEdit: () => void }) {
  const c = asset.connection
  const r = c.resolved
  const imported = c.source === "imported"
  const host = imported ? r?.hostname : c.host
  const user = imported ? r?.user : c.user
  const port = imported ? r?.port : c.port
  const address = host ? `${user ? `${user}@` : ""}${host}${port && port !== 22 ? `:${port}` : ""}` : copy.common.none
  const jump = (imported ? r?.proxyJump : c.proxyJump) ?? null
  const method = c.auth?.method
  const keyPath = c.auth ? (c.auth.identityFile.windows ?? Object.values(c.auth.identityFile)[0]) : undefined
  return (
    <ListGroup
      id="detail-connection"
      title={copy.detail.groups.connection}
      action={
        <Button variant="ghost" size="sm" onClick={onEdit}>
          <PencilIcon data-icon="inline-start" />
          {copy.detail.edit}
        </Button>
      }
    >
      <PrefRow label={copy.detail.rows.address} hint={imported ? copy.connection.importedFrom(sortEnvs(c.definedIn).map(copy.env.long).join("、")) : undefined}>
        <CopyValue value={address} label={copy.detail.rows.address} />
      </PrefRow>
      {method && (
        <PrefRow label={copy.detail.rows.auth}>
          {method === "key" && keyPath ? (
            <CopyValue value={keyPath} label={copy.detail.rows.auth} />
          ) : (
            <span className="text-xs text-fg-2">{copy.detail.authMethod[method]}</span>
          )}
        </PrefRow>
      )}
      <PrefRow label={copy.detail.rows.jump}>
        {jump ? <CopyValue value={jump} label={copy.detail.rows.jump} /> : <span className="text-xs text-muted-foreground">{copy.common.none}</span>}
      </PrefRow>
    </ListGroup>
  )
}

/**
 * Agent 需要知道的（SSH）：你写给 Agent 的字段——名称、用途、承载的站点直接显示；
 * 标签、云厂商、地域、笔记收进最后一行「更多信息」，默认收起，副行写摘要（PRD 6.4，2026-11-10）
 */
function KnowledgeGroup({ asset }: { asset: ServerAsset }) {
  const { control } = useFormContext<ServerFormValues>()
  const [tags, provider, region, notes] = useWatch({ control, name: ["tags", "provider", "region", "notes"] })
  const summary = [tags.length > 0 && copy.basic.tagCount(tags.length), provider.trim(), region.trim(), notes.trim() && copy.detail.hasNotes].filter((x): x is string => !!x)
  return (
    <ListGroup id="detail-knowledge" title={copy.detail.groups.knowledge}>
      <NameRow placeholder={asset.connection.sshAlias} />
      <SummaryRow />
      <div className="px-3.5 py-3">
        <SitesField />
      </div>
      <FoldRow label={copy.detail.more} hint={summary.length ? copy.basic.summaryLine(summary) : copy.detail.moreEmpty}>
        <div className="px-3.5 py-3">
          <OtherFields />
        </div>
        <NotesRow />
      </FoldRow>
    </ListGroup>
  )
}

/**
 * 服务与目录（PRD 6.4，2026-11-10 从「Agent 需要知道的」里拆出）：探测到的服务、关键目录和监听端口，
 * 「重新探测」在组标题右边。角色、关键、手动添加的服务和目录照常可以改。
 * 整组收在一行「探测结果」里，默认收起，副行写有几个服务、目录和端口（2026-11-10）
 */
function ProbedGroup({ asset }: { asset: ServerAsset }) {
  const { control } = useFormContext<ServerFormValues>()
  const [services, paths] = useWatch({ control, name: ["services", "paths"] })
  const summary = copy.detail.probedSummary(services.length, services.filter((x) => x.critical).length, paths.length, asset.listeningPorts.length)
  return (
    <ListGroup id="detail-probed" title={copy.detail.groups.probed} action={<ProbeButton asset={asset} />}>
      <FoldRow label={copy.detail.probedRow} hint={summary}>
      <PrefRow label={copy.detail.groups.services} block>
        <ServicesSection />
      </PrefRow>
      <PrefRow label={copy.detail.groups.paths} block>
        <PathsSection />
      </PrefRow>
      <PrefRow label={copy.connection.listening} block>
        <ListeningPorts asset={asset} />
      </PrefRow>
      </FoldRow>
    </ListGroup>
  )
}

/**
 * 服务器的详情视图（PRD 6.4）：全宽一页，没有 Tab。编辑即保存：文本类字段失焦或停止输入 600ms 后保存，提示条「已保存」；
 * 连接字段在「编辑」里改，走连接流程。档位、分发、笔记的并入和忽略立即生效
 */
export function ServerDetail({ asset }: { asset: ServerAsset }) {
  const ctx = useAliasContext(asset.id)
  const form = useServerForm(asset, ctx)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const conn = useConnectionTest(form, asset.id, asset.id)
  const [editing, setEditing] = useState(false)
  const auto = useAutoSave({
    form,
    fields: PAGE_FIELDS,
    save: async (v) => {
      await useAssetStore.getState().save(toAssetInput(v, asset))
    },
  })
  const [name, production] = useWatch({ control: form.control, name: ["name", "production"] })
  useHotkeys(HOTKEYS.save, () => !isModalOpen() && void auto.flush(), HOTKEY_OPTIONS)

  const edit = () => {
    void auto.flush()
    setEditing(true)
  }
  const runTest = () => void conn.run()
  const convert = () => void auto.flush().then(() => serverActions.convertToKey(asset.id))

  return (
    <FormProvider {...form}>
      <DetailPage onBlurCapture={auto.onBlurCapture}>
        <DetailHeader asset={asset} name={name.trim() || asset.name} production={production} titleRef={titleRef} conn={conn} onTest={runTest} />
        <TestResult className="empty:hidden" test={conn.test} current={conn.current} method={conn.method} assetId={asset.id} onConvert={convert} />
        <div className="empty:hidden">
          <CompileSummary asset={asset} dirty={form.formState.isDirty} />
        </div>
        {auto.error && <SaveErrorAlert error={auto.error} onRetry={() => void auto.flush()} />}
        <PermissionGroup asset={asset} problems={<ServerProblems asset={asset} onTest={runTest} onConvert={convert} onEdit={edit} />} />
        <ConnectionGroup asset={asset} onEdit={edit} />
        <KnowledgeGroup asset={asset} />
        <ProbedGroup asset={asset} />
        <RulesGroup />
        <RecentActivityGroup assetId={asset.id} />
      </DetailPage>
      <ConnectionDialog asset={asset} open={editing} onOpenChange={setEditing} />
      <DraftPreview control={form.control} asset={asset} dirty={form.formState.isDirty} />
    </FormProvider>
  )
}
