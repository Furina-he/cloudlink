// 完整资料在当前详情上集中修改；连接/权限不进入这个草稿（P8 D6）。
import { zodResolver } from "@hookform/resolvers/zod"
import { useState } from "react"
import { FormProvider, useForm, useWatch } from "react-hook-form"
import type { Asset, CliAsset, IpcError, ServerAsset } from "@/bindings"
import { FoldRow } from "@/components/app/SettingsList"
import { toast } from "@/components/ui/toast"
import { copy } from "@/lib/copy"
import { toIpcError } from "@/lib/ipc"
import { cliFormSchema, type CliFormValues } from "@/lib/schemas"
import { useAssetStore } from "@/stores/assets"
import { DraftDialog } from "./DraftDialog"
import { SaveErrorAlert } from "./DraftPreview"
import { BasicProfileFields, RulesAndNotesFields } from "./ProfileFields"
import { cliProfileInput, cliValuesOf, serverProfileInput } from "./profileForm"
import { OtherFields, SitesField } from "./sections/BasicSection"
import { PathsSection } from "./sections/PathsSection"
import { ServicesSection } from "./sections/ServicesSection"
import { firstError, focusField } from "./serverForm"
import { useAliasContext, useServerForm } from "./useServerForm"

function ServerProfileDialog({ asset, onClose }: { asset: ServerAsset; onClose: () => void }) {
  const [initial] = useState(() => structuredClone(asset))
  const ctx = useAliasContext(asset.id)
  const form = useServerForm(initial, ctx, true)
  const [inventoryOpen, setInventoryOpen] = useState(false)
  const [error, setError] = useState<IpcError | null>(null)
  const [services, paths] = useWatch({ control: form.control, name: ["services", "paths"] })
  const save = () => {
    if (form.formState.isSubmitting) return
    void form.handleSubmit(async (v) => {
      setError(null)
      try {
        await useAssetStore.getState().update(asset.id, (latest) => {
          if (latest.type !== "vps") throw { id: "not-found" } satisfies IpcError
          return serverProfileInput(v, initial, latest)
        })
        toast.add({ title: copy.detail.saved })
        onClose()
      } catch (e) { setError(toIpcError(e)) }
    }, (errors) => {
      const target = firstError(errors)
      if (target) {
        if (target.path.startsWith("services.") || target.path.startsWith("paths.")) setInventoryOpen(true)
        focusField(form, target.path)
      }
    })()
  }
  return (
    <FormProvider {...form}>
      <DraftDialog title={copy.detail.editProfile} name={asset.name} handle={asset.connection.sshAlias} hint={copy.detail.profileHint} dirty={form.formState.isDirty} busy={form.formState.isSubmitting} saveLabel={copy.detail.saveProfile} onClose={onClose} onSave={save}>
        {error && <SaveErrorAlert error={error} onRetry={save} />}
        <BasicProfileFields />
        <SitesField />
        <div className="overflow-hidden rounded-[10px] border border-line">
          <FoldRow label={copy.detail.more} hint={copy.detail.editor.otherInfoHint} plain>
            <div className="p-3"><OtherFields /></div>
          </FoldRow>
        </div>
        <div className="overflow-hidden rounded-[10px] border border-line">
          <FoldRow label={copy.detail.groups.probed} hint={copy.detail.editor.inventorySummary(services.length, paths.length)} open={inventoryOpen} onOpenChange={setInventoryOpen} plain>
            <div className="flex flex-col gap-4 p-3">
              <p className="text-xs text-muted-foreground">{copy.detail.editor.inventoryHint}</p>
              <ServicesSection />
              <PathsSection />
            </div>
          </FoldRow>
        </div>
        <RulesAndNotesFields />
      </DraftDialog>
    </FormProvider>
  )
}

function CliProfileDialog({ asset, onClose }: { asset: CliAsset; onClose: () => void }) {
  const [initial] = useState(() => structuredClone(asset))
  const form = useForm<CliFormValues>({ resolver: zodResolver(cliFormSchema), defaultValues: cliValuesOf(initial), mode: "onBlur" })
  const [error, setError] = useState<IpcError | null>(null)
  const save = () => {
    if (form.formState.isSubmitting) return
    void form.handleSubmit(async (v) => {
      setError(null)
      try {
        await useAssetStore.getState().update(asset.id, (latest) => {
          if (latest.type !== "cli") throw { id: "not-found" } satisfies IpcError
          return cliProfileInput(v, initial, latest)
        })
        toast.add({ title: copy.detail.saved })
        onClose()
      } catch (e) { setError(toIpcError(e)) }
    })()
  }
  return (
    <FormProvider {...form}>
      <DraftDialog title={copy.detail.editProfile} name={asset.name} handle={asset.handle} hint={copy.detail.profileHint} dirty={form.formState.isDirty} busy={form.formState.isSubmitting} saveLabel={copy.detail.saveProfile} onClose={onClose} onSave={save}>
        {error && <SaveErrorAlert error={error} onRetry={save} />}
        <BasicProfileFields />
        <RulesAndNotesFields />
      </DraftDialog>
    </FormProvider>
  )
}

export function ProfileDialog({ asset, onClose }: { asset: Asset; onClose: () => void }) {
  return asset.type === "vps" ? <ServerProfileDialog asset={asset} onClose={onClose} /> : <CliProfileDialog asset={asset} onClose={onClose} />
}
