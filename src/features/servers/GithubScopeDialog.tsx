import { zodResolver } from "@hookform/resolvers/zod"
import { useEffect, useState } from "react"
import { FormProvider, useForm, useWatch } from "react-hook-form"

import type { CliAsset, IpcError } from "@/bindings"
import { copy } from "@/lib/copy"
import { toIpcError } from "@/lib/ipc"
import { useAssetStore } from "@/stores/assets"
import { emptyGithubScope, githubQueryKey, useGithubStore } from "@/stores/github"
import { toast } from "@/components/ui/toast"
import { DraftDialog } from "./DraftDialog"
import { SaveErrorAlert } from "./DraftPreview"
import { GithubOwnerPicker, GithubScopeFields, GithubSnapshotNote } from "./GithubParts"
import { githubComplete, githubDraft, githubExpands, githubScopeSchema, type GithubScopeDraft } from "./githubScopeForm"

/** The existing editor shell owns fixed chrome, focus restoration and same-footer dirty protection. */
export function GithubScopeDialog({ asset, onClose }: { asset: CliAsset; onClose: () => void }) {
  const [initial] = useState(() => structuredClone(asset))
  const [initialDraft] = useState(() => githubDraft(initial.github, initial.cli.scope))
  const form = useForm<GithubScopeDraft>({ resolver: zodResolver(githubScopeSchema), defaultValues: initialDraft })
  const draft = useWatch({ control: form.control }) as GithubScopeDraft
  const persisted = useAssetStore((state) => state.byId[asset.id])
  const current = persisted?.type === "cli" ? persisted : asset
  const stored = useGithubStore((state) => state.byKey[asset.id]) ?? emptyGithubScope
  const pending = current.github?.migrationPending ?? true
  const candidateKey = githubQueryKey({ host: current.github?.host, ownerLogin: draft.ownerLogin || undefined })
  const candidate = useGithubStore((state) => state.byKey[candidateKey]) ?? emptyGithubScope
  const loaded = pending && draft.ownerLogin ? candidate : stored
  const config = loaded.result?.config ?? current.github
  const scope = loaded.result?.scope ?? current.cli.scope
  const owners = stored.result?.owners ?? loaded.result?.owners ?? []
  const initiallyProvided = initial.cli.scope.filter((repo) => repo.selected).map((repo) => repo.id)
  const complete = githubComplete(config)
  const expands = githubExpands(draft, initialDraft, scope, initiallyProvided)
  const mismatch = pending && complete && initiallyProvided.some((id) => !scope.some((repo) => repo.id === id))
  const expansionBlocked = !complete && expands
  const [error, setError] = useState<IpcError | null>(null)
  const dirty = form.formState.isDirty

  useEffect(() => { void useGithubStore.getState().load({ assetId: asset.id }) }, [asset.id])
  useEffect(() => {
    if (pending && draft.ownerLogin) void useGithubStore.getState().load({ host: current.github?.host, ownerLogin: draft.ownerLogin })
  }, [pending, draft.ownerLogin, current.github?.host])
  useEffect(() => {
    if (!dirty && stored.result && !stored.result.config.migrationPending) form.reset(githubDraft(stored.result.config, stored.result.scope))
  }, [stored.result, form, dirty])

  const refresh = () => {
    if (pending && draft.ownerLogin) void useGithubStore.getState().load({ host: current.github?.host, ownerLogin: draft.ownerLogin, force: true })
    else void useGithubStore.getState().load({ assetId: asset.id, force: true })
  }
  const save = () => {
    if (form.formState.isSubmitting || expansionBlocked || mismatch || !draft.ownerLogin) return
    void form.handleSubmit(async (values) => {
      setError(null)
      try {
        await useGithubStore.getState().save({
          assetId: asset.id,
          expectedRevision: current.github?.revision ?? stored.result?.config.revision ?? 1,
          ownerLogin: pending ? values.ownerLogin : undefined,
          mode: values.mode,
          selectedRepoIds: values.selectedRepoIds,
          excludedRepoIds: values.excludedRepoIds,
        })
        toast.add({ title: copy.github.scopeSaved })
        onClose()
      } catch (failure) { setError(toIpcError(failure)) }
    })()
  }
  return (
    <FormProvider {...form}>
      <DraftDialog title={copy.github.manageScope} name={current.name} handle={config?.owner?.login ?? current.handle} hint={expansionBlocked ? copy.github.expansionBlocked : copy.github.scopeFoot} dirty={dirty} busy={form.formState.isSubmitting} saveLabel={copy.github.saveScope} saveEnabled={!loaded.loading && !expansionBlocked && !mismatch && !!draft.ownerLogin} onClose={onClose} onSave={save}>
        {pending && <GithubOwnerPicker owners={owners} value={draft.ownerLogin} onChange={(login) => form.setValue("ownerLogin", login, { shouldDirty: true })} />}
        <GithubSnapshotNote config={config} error={loaded.error ?? stored.error} loading={loaded.loading} />
        {mismatch && <p role="alert" className="text-xs text-destructive">{copy.github.legacyOwnerMismatch}</p>}
        {error && <SaveErrorAlert error={error} onRetry={save} />}
        <GithubScopeFields form={form} scope={scope} config={config} initiallyProvided={initiallyProvided} loading={loaded.loading} initialMode={initialDraft.mode} onRefresh={refresh} />
      </DraftDialog>
    </FormProvider>
  )
}
