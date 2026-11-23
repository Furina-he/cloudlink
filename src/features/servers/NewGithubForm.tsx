import { zodResolver } from "@hookform/resolvers/zod"
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { FormProvider, useForm, useWatch } from "react-hook-form"
import { useHotkeys } from "react-hotkeys-hook"
import { useShallow } from "zustand/react/shallow"

import type { CliAsset, GithubOwner, IpcError } from "@/bindings"
import { ProviderMark } from "@/components/app/ProviderMark"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "@/components/ui/toast"
import { useAgentOptions } from "@/features/agents/agentKeys"
import { copy, ipcErrorText } from "@/lib/copy"
import { deliveryOutcome, deliveryProblemsText } from "@/lib/deliveryFeedback"
import { toIpcError } from "@/lib/ipc"
import { HOTKEY_OPTIONS, HOTKEYS } from "@/lib/hotkeys"
import { cliEnvStatus, useAssetStore } from "@/stores/assets"
import { useCliStore } from "@/stores/cli"
import { emptyGithubScope, githubQueryKey, useGithubStore } from "@/stores/github"
import { useTargetStore } from "@/stores/targets"
import { setLeaveGuard, useUIStore } from "@/stores/ui"
import { currentDeliverySnapshot, serverActions } from "./actions"
import { CliEnvList, RecheckButton } from "./CliParts"
import { CreateHeader } from "./CreateParts"
import { DetailGroup } from "./DetailParts"
import { GithubOwnerPicker, GithubScopeFields, GithubSnapshotNote } from "./GithubParts"
import { githubComplete, githubScopeSchema, type GithubScopeDraft } from "./githubScopeForm"

const EMPTY_OWNERS: GithubOwner[] = []

/** New GitHub resources choose an owner, not a new login. All source facts come from the bridge. */
export function NewGithubForm() {
  const form = useForm<GithubScopeDraft>({ resolver: zodResolver(githubScopeSchema), defaultValues: { ownerLogin: "", mode: "auto", selectedRepoIds: [], excludedRepoIds: [] } })
  const ownerLogin = useWatch({ control: form.control, name: "ownerLogin" })
  const setup = useCliStore((state) => state.setups.github)
  const all = useGithubStore((state) => state.byKey[githubQueryKey({})]) ?? emptyGithubScope
  const key = githubQueryKey({ ownerLogin: ownerLogin || undefined })
  const queried = useGithubStore((state) => state.byKey[key]) ?? emptyGithubScope
  const result = ownerLogin ? queried.result : all.result
  const owners = result?.owners ?? all.result?.owners ?? EMPTY_OWNERS
  const taken = useAssetStore(useShallow((state) => state.ids.flatMap((id) => {
    const asset = state.byId[id]
    return asset?.type === "cli" && asset.cliProvider === "github" && asset.github?.host === "github.com" && asset.github.owner ? [asset.github.owner.id] : []
  })))
  const { agents } = useAgentOptions()
  const [error, setError] = useState<IpcError | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [discovering, setDiscovering] = useState(true)
  const confirmRef = useRef(false)
  const setConfirmState = (value: boolean) => { confirmRef.current = value; setConfirming(value) }
  const pendingClose = useRef<(() => void) | null>(null)
  const previousFocus = useRef<HTMLElement | null>(null)
  const keepRef = useRef<HTMLButtonElement>(null)
  const busy = form.formState.isSubmitting
  const loading = queried.loading || all.loading || discovering
  const envStates = result?.envStates ?? all.result?.envStates ?? {}
  const ready = Object.values(envStates).some((state) => state && cliEnvStatus(state) === "ready")
  const allBound = owners.length > 0 && owners.every((owner) => taken.includes(owner.id))
  const complete = githubComplete(result?.config) && result?.config.owner?.login === ownerLogin

  useEffect(() => {
    let active = true
    const state = useAssetStore.getState()
    const legacy = state.ids.filter((id) => {
      const asset = state.byId[id]
      return asset?.type === "cli" && asset.cliProvider === "github" && (!asset.github || asset.github.migrationPending)
    })
    // Stable-ID verification, not repository-name inference, establishes legacy owners before
    // the new-resource picker can mark them as already added.
    void Promise.all(legacy.map((assetId) => useGithubStore.getState().load({ assetId }))).then(() => useGithubStore.getState().load({})).finally(() => { if (active) setDiscovering(false) })
    return () => { active = false }
  }, [])
  useEffect(() => {
    // Do not provisionally select a legacy owner before its verification marks it as taken.
    if (!ownerLogin && !discovering && !all.loading) {
      const first = owners.find((owner) => !taken.includes(owner.id))
      if (first) form.reset({ ...form.getValues(), ownerLogin: first.login })
    }
  }, [owners, taken, ownerLogin, form, discovering, all.loading])
  useEffect(() => {
    if (ownerLogin) void useGithubStore.getState().load({ ownerLogin })
  }, [ownerLogin])
  useEffect(() => {
    const refresh = () => { void useGithubStore.getState().load({ ownerLogin: ownerLogin || undefined, force: true }) }
    window.addEventListener("focus", refresh)
    return () => window.removeEventListener("focus", refresh)
  }, [ownerLogin])
  useEffect(() => {
    setLeaveGuard((proceed) => {
      if (busy) return true
      if (!form.formState.isDirty) return false
      pendingClose.current = proceed
      previousFocus.current = document.activeElement as HTMLElement | null
      setConfirmState(true)
      return true
    })
    return () => setLeaveGuard(null)
  }, [busy, form, form.formState.isDirty])
  useLayoutEffect(() => {
    if (confirming) keepRef.current?.focus({ preventScroll: true })
    else previousFocus.current?.focus({ preventScroll: true })
  }, [confirming])

  const refresh = () => { void useGithubStore.getState().load({ ownerLogin: ownerLogin || undefined, force: true }) }
  const save = () => {
    if (busy || confirmRef.current || !ready || !complete || allBound) return
    void form.handleSubmit(async (draft) => {
      setError(null)
      try {
        const savedResult = await useAssetStore.getState().save({
          type: "cli", cliProvider: "github", name: copy.cli.name.github,
          account: draft.ownerLogin, summary: "", guardrails: { rules: [] }, notes: "",
          scope: result?.scope ?? [],
          github: { host: result?.config.host ?? "github.com", ownerLogin: draft.ownerLogin, mode: draft.mode, selectedRepoIds: draft.selectedRepoIds, excludedRepoIds: draft.excludedRepoIds },
        })
        const saved = savedResult.asset as CliAsset
        if (agents.length > 0) {
          await useAssetStore.getState().setDistributeMany(saved.id, agents.map((agent) => agent.key), true)
        }
        const outcome = deliveryOutcome(saved.id, agents.map((agent) => agent.key), true, currentDeliverySnapshot(), useTargetStore.getState().targets)
        toast.add({
          title: outcome.complete ? copy.create.added(saved.name, outcome.count) : copy.deliveryFeedback.addedPartial(saved.name, outcome.count),
          description: outcome.complete ? undefined : outcome.problems.length ? deliveryProblemsText(outcome.problems) : copy.deliveryFeedback.none,
          type: outcome.complete ? "success" : "warning",
        })
        useAssetStore.getState().flash([saved.id])
        useUIStore.getState().closeInspector({ force: true })
      } catch (failure) { setError(toIpcError(failure)) }
    })()
  }

  useHotkeys(HOTKEYS.save, save, HOTKEY_OPTIONS)

  return (
    <FormProvider {...form}>
      <section aria-labelledby="detail-title" className="flex h-full min-h-0 flex-col" onKeyDownCapture={(event) => {
        if (confirming && event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setConfirmState(false) }
      }}>
        <CreateHeader title={copy.create.titleCli(copy.cli.name.github)} icon={<ProviderMark provider="github" />} />
        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-5 px-4.5 py-3.5" inert={confirming || busy}>
            <DetailGroup title={copy.cli.envCheckTitle} action={<RecheckButton detecting={loading} onClick={refresh} />}>
              <CliEnvList
                provider="github"
                envStates={envStates}
                detecting={loading}
                setup={setup}
                onSetup={(envId, method) => serverActions.startCliSetup("github", envId, method, null)}
              />
              <p className="text-xs text-muted-foreground">{copy.cli.setupNoteIdle}</p>
            </DetailGroup>
            {owners.length > 0 && <GithubOwnerPicker owners={owners} value={ownerLogin} taken={taken} onChange={(login) => {
              form.reset({ ownerLogin: login, mode: "auto", selectedRepoIds: [], excludedRepoIds: [] })
              setError(null)
            }} />}
            {allBound ? <p className="text-xs text-muted-foreground">{copy.github.ownerAllAdded}</p> : !owners.length && loading ? <p className="text-xs text-muted-foreground">{copy.github.ownerLoading}</p> : null}
            <GithubSnapshotNote config={result?.config} error={queried.error ?? all.error} loading={loading} />
            {ownerLogin && !allBound && (
              <DetailGroup title={copy.github.scopeTitle}>
                <GithubScopeFields form={form} scope={result?.scope ?? []} config={result?.config} initiallyProvided={[]} loading={loading} initialMode="auto" />
              </DetailGroup>
            )}
            {error && <Alert variant="destructive"><AlertDescription>{ipcErrorText(error.id, error.params)}</AlertDescription></Alert>}
          </div>
        </ScrollArea>
        <Separator />
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 px-4.5 py-3" data-editor-footer>
          {confirming ? <>
            <span className="mr-auto min-w-0 text-xs text-muted-foreground" role="alert">{copy.detail.editor.leave}</span>
            <Button ref={keepRef} variant="ghost" size="sm" onClick={() => setConfirmState(false)}>{copy.detail.leave.keep}</Button>
            <Button size="sm" onClick={() => { const close = pendingClose.current; pendingClose.current = null; close?.() }}>{copy.detail.leave.discard}</Button>
          </> : <>
            <span className="mr-auto min-w-0 text-xs text-muted-foreground">{copy.create.footHint}</span>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => useUIStore.getState().closeInspector()}>{copy.common.cancel}</Button>
            <Button size="sm" disabled={busy || !ready || !complete || allBound} onClick={save}>{busy && <Spinner data-icon="inline-start" />}{busy ? copy.cli.saving : copy.cli.saveEnable}</Button>
          </>}
        </div>
      </section>
    </FormProvider>
  )
}
