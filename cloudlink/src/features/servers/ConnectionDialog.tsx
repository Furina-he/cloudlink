// 连接编辑复用既有验证/凭据/Include规则；未保存确认与其他编辑弹窗保持同一底栏（P8 D6）。
import { PlugIcon } from "lucide-react"
import { useEffect, useState } from "react"
import { FormProvider } from "react-hook-form"
import type { ServerAsset } from "@/bindings"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "@/components/ui/toast"
import { copy } from "@/lib/copy"
import { connectionSignature, useConnectionStore } from "@/stores/connection"
import { useAssetStore } from "@/stores/assets"
import { serverActions, useConverting } from "./actions"
import { TestResult, useConnectionTest } from "./ConnectionTest"
import { DraftDialog } from "./DraftDialog"
import { SaveErrorAlert } from "./DraftPreview"
import { IncludeDetails } from "./IncludeParts"
import { ConnectionEditor } from "./sections/ConnectionSection"
import { connectionInputOf, connectionInputOfForm, firstError, focusField, formValuesOf } from "./serverForm"
import { useAliasContext, useServerForm } from "./useServerForm"
import { useSaveFlow, type RevealTarget } from "./useSaveFlow"

const testKeyOf = (id: string) => `${id}:edit`

function ConnectionDialogBody({ asset, onClose }: { asset: ServerAsset; onClose: () => void }) {
  const [initial, setInitial] = useState(() => structuredClone(asset))
  const ctx = useAliasContext(asset.id)
  const form = useServerForm(initial, ctx)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const testKey = testKeyOf(asset.id)
  const conn = useConnectionTest(form, testKey, asset.id)
  const reveal = (target: RevealTarget) => { if (target.advanced) setAdvancedOpen(true); focusField(form, target.path) }
  const flow = useSaveFlow({ asset: initial, form, testKey, reveal, connectionOnly: true, quiet: true })
  const running = conn.test?.status === "running" || conn.test?.status === "host-key"
  const converting = useConverting((s) => s.ids.includes(asset.id))
  const managed = asset.connection.source === "managed"
  const canConvert = !form.getValues("connection.password") && connectionSignature(connectionInputOfForm(form.getValues())) === connectionSignature(connectionInputOf(asset))
  const convert = async () => {
    const latest = useAssetStore.getState().byId[asset.id]
    if (!latest || latest.type !== "vps" || form.getValues("connection.password") || connectionSignature(connectionInputOfForm(form.getValues())) !== connectionSignature(connectionInputOf(latest))) {
      toast.add({ title: copy.test.stale, type: "warning" })
      return
    }
    await serverActions.convertToKey(asset.id)
    const updated = useAssetStore.getState().byId[asset.id]
    if (updated?.type === "vps" && updated.connection.auth?.method === "key") {
      setInitial(structuredClone(updated))
      form.reset(formValuesOf(updated), { keepDirtyValues: true })
    }
  }
  useEffect(() => () => {
    const s = useConnectionStore.getState()
    if (["running", "host-key"].includes(s.testsByKey[testKey]?.status ?? "")) void s.cancel(testKey).catch(() => undefined)
    s.clear(testKey)
  }, [testKey])
  const runTest = async () => { if (!await conn.run()) { const target = firstError(form.formState.errors); if (target) reveal(target) } }
  const save = () => flow.submit({ after: () => { useConnectionStore.getState().clear(testKey); toast.add({ title: copy.detail.saved }); onClose() } })

  return (
    <FormProvider {...form}>
      <DraftDialog
        title={managed ? copy.detail.editConnection : copy.detail.editExport}
        name={asset.name}
        handle={asset.connection.sshAlias}
        hint={managed ? copy.detail.editor.connectionHint : copy.detail.editExportHint}
        dirty={form.formState.isDirty}
        busy={flow.saving || converting}
        saveEnabled={!flow.confirm && !running && !converting}
        saveLabel={managed ? copy.detail.saveConnection : copy.detail.saveExport}
        onClose={onClose}
        onSave={save}
        actions={managed && <Button type="button" variant="outline" size="sm" disabled={flow.saving || converting || !!flow.confirm} onClick={running ? conn.cancel : () => void runTest()}>{running ? <Spinner data-icon="inline-start" aria-hidden /> : <PlugIcon data-icon="inline-start" />}{running ? copy.test.cancel : copy.detail.test}</Button>}
      >
        <div inert={!!flow.confirm}><ConnectionEditor asset={initial} ctx={ctx} advancedOpen={advancedOpen} onAdvancedChange={setAdvancedOpen} /></div>
        {managed && <TestResult test={conn.test} current={conn.current} method={conn.method} assetId={asset.id} onConvert={canConvert && !flow.confirm ? () => void convert() : undefined} />}
        {flow.error && <SaveErrorAlert error={flow.error} onRetry={save} />}
        {flow.confirm?.stage === "unverified" && <Alert><AlertTitle>{copy.serverForm.unverifiedTitle}</AlertTitle><AlertDescription>{copy.serverForm.unverifiedDescription}</AlertDescription><div className="col-span-full flex justify-end gap-2"><Button type="button" autoFocus variant="ghost" size="sm" onClick={flow.cancelConfirm}>{copy.common.cancel}</Button><Button type="button" size="sm" onClick={flow.confirmUnverified}>{copy.serverForm.unverifiedConfirm}</Button></div></Alert>}
        {flow.confirm?.stage === "include" && <Alert><AlertTitle>{copy.include.title}</AlertTitle><AlertDescription>{copy.include.description}</AlertDescription><div className="col-span-full"><IncludeDetails envIds={flow.confirm.envIds} /></div><div className="col-span-full flex justify-end gap-2"><Button type="button" autoFocus variant="ghost" size="sm" onClick={flow.declineInclude}>{copy.include.skip}</Button><Button type="button" size="sm" onClick={() => void flow.acceptInclude()}>{copy.include.add}</Button></div></Alert>}
      </DraftDialog>
    </FormProvider>
  )
}

export function ConnectionDialog({ asset, open, onOpenChange }: { asset: ServerAsset; open: boolean; onOpenChange: (open: boolean) => void }) {
  return open ? <ConnectionDialogBody asset={asset} onClose={() => onOpenChange(false)} /> : null
}
