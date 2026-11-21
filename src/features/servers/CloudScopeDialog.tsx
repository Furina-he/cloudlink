import { zodResolver } from "@hookform/resolvers/zod"
import { useState } from "react"
import { FormProvider, useForm } from "react-hook-form"

import type { CliAsset, IpcError } from "@/bindings"
import { toast } from "@/components/ui/toast"
import { copy } from "@/lib/copy"
import { toIpcError } from "@/lib/ipc"
import { useAssetStore } from "@/stores/assets"
import { useCliStore } from "@/stores/cli"
import { useUIStore } from "@/stores/ui"
import { serverActions } from "./actions"
import { CloudScopeFields, CloudSnapshotNote } from "./CloudScopeParts"
import { cloudScopeDraft, cloudScopeSchema, type CloudScopeDraft } from "./cloudScopeForm"
import { DraftDialog } from "./DraftDialog"
import { SaveErrorAlert } from "./DraftPreview"

/** Mirrors GithubScopeDialog: DraftDialog shell, focus restoration, dirty guard, optimistic revision. */
export function CloudScopeDialog({ asset, onClose }: { asset: CliAsset; onClose: () => void }) {
  const [initial] = useState(() => structuredClone(asset))
  const [initialDraft] = useState(() => cloudScopeDraft(initial.cloudScope, initial.cli.scope))
  const form = useForm<CloudScopeDraft>({ resolver: zodResolver(cloudScopeSchema), defaultValues: initialDraft })
  const persisted = useAssetStore((state) => state.byId[asset.id])
  const current = persisted?.type === "cli" ? persisted : asset
  const detection = useCliStore((state) => state.byProvider[current.cliProvider])
  const initiallyProvided = initial.cli.scope.filter((item) => item.selected).map((item) => item.id)
  const [error, setError] = useState<IpcError | null>(null)
  const dirty = form.formState.isDirty
  const loading = !!detection?.scopeLoading || !!detection?.detecting

  const refresh = () => {
    serverActions.recheckCli(current)
  }

  const save = () => {
    if (form.formState.isSubmitting) return
    void form.handleSubmit(async (values) => {
      setError(null)
      try {
        await useAssetStore.getState().saveCloudScope({
          assetId: current.id,
          expectedRevision: current.cloudScope?.revision ?? 1,
          mode: values.mode,
          selectedIds: values.mode === "manual" ? values.selectedIds : [],
          excludedIds: values.mode === "auto" ? values.excludedIds : [],
        })
        toast.add({ title: copy.cloudScope.scopeSaved })
        onClose()
      } catch (failure) {
        setError(toIpcError(failure))
      }
    })()
  }

  return (
    <FormProvider {...form}>
      <DraftDialog
        title={copy.cloudScope.manageScope}
        name={current.name}
        handle={current.account ?? current.handle}
        hint={copy.cloudScope.scopeFoot}
        dirty={dirty}
        busy={form.formState.isSubmitting}
        saveLabel={copy.cloudScope.saveScope}
        saveEnabled={!form.formState.isSubmitting}
        onClose={onClose}
        onSave={save}
      >
        <CloudSnapshotNote
          config={current.cloudScope}
          error={detection?.scopeError}
          loading={loading}
          onRetry={refresh}
        />
        {error && <SaveErrorAlert error={error} onRetry={save} />}
        <CloudScopeFields
          form={form}
          scope={current.cli.scope}
          initiallyProvided={initiallyProvided}
          loading={loading}
          initialMode={initialDraft.mode}
          onRefresh={refresh}
          onAddAsServer={(item) => {
            onClose()
            useUIStore.getState().startCreate("ssh", { prefill: { host: item.address ?? "", name: item.name } })
          }}
        />
      </DraftDialog>
    </FormProvider>
  )
}
