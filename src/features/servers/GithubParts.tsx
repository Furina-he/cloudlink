import { InfoIcon, RefreshCwIcon } from "lucide-react"
import { useId, useMemo, useRef, useState } from "react"
import { useWatch, type UseFormReturn } from "react-hook-form"

import type { CliAsset, CliScopeItem, GithubConfig, GithubOwner, IpcError, Relation } from "@/bindings"
import { CopyValue, ListGroup, PrefRow } from "@/components/app/SettingsList"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Empty, EmptyContent, EmptyDescription } from "@/components/ui/empty"
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Item, ItemActions, ItemContent, ItemGroup } from "@/components/ui/item"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { copy, ipcErrorText } from "@/lib/copy"
import { useAssetStore } from "@/stores/assets"
import { useSkillStore } from "@/stores/skills"
import { githubComplete, githubProvidedIds, githubSetProvided, githubSwitchMode, type GithubScopeDraft } from "./githubScopeForm"

export function GithubOwnerPicker({ owners, value, taken = [], onChange }: { owners: GithubOwner[]; value: string; taken?: string[]; onChange: (login: string) => void }) {
  const id = useId()
  return (
    <FieldSet className="min-w-0 gap-2">
      <FieldLegend variant="label">{copy.github.ownerPick}</FieldLegend>
      <FieldDescription>{copy.github.ownerHint}</FieldDescription>
      <RadioGroup value={value} onValueChange={(login) => onChange(login as string)} aria-label={copy.github.ownerPick} className="gap-0 divide-y divide-line-2 rounded-[10px] border border-line">
        {owners.map((owner) => {
          const disabled = taken.includes(owner.id)
          const fieldId = `${id}-${owner.id}`
          return (
            <Field key={owner.id} orientation="horizontal" data-disabled={disabled || undefined} className="min-h-10 items-center gap-2.5 px-3 py-2">
              <RadioGroupItem id={fieldId} value={owner.login} disabled={disabled} />
              <FieldLabel htmlFor={fieldId} className="min-w-0 flex-1 font-normal">
                <span className="font-mono text-xs wrap-anywhere">{owner.login}</span>
                <span className="text-xs text-muted-foreground">{copy.github.ownerKind[owner.kind]}</span>
              </FieldLabel>
              {disabled && <span className="text-xs text-muted-foreground">{copy.cli.accountAdded}</span>}
            </Field>
          )
        })}
      </RadioGroup>
    </FieldSet>
  )
}

export function GithubSnapshotNote({ config, error, loading, onRetry }: { config?: GithubConfig; error?: IpcError | null; loading?: boolean; onRetry?: () => void }) {
  const problem = Object.values(config?.envStates ?? {}).find((snapshot) => snapshot && snapshot.status !== "complete")
  const text = error ? ipcErrorText(error.id, error.params) : problem ? copy.github.status[problem.status] : config?.migrationPending ? copy.github.migrationPending : null
  if (!text) return null
  return (
    <Alert variant={error ? "destructive" : "default"}>
      <InfoIcon />
      <AlertDescription className="flex flex-col gap-2">
        {text}
        {onRetry && <span><Button type="button" variant="outline" size="sm" disabled={loading} onClick={onRetry}>{loading ? <Spinner data-icon="inline-start" /> : <RefreshCwIcon data-icon="inline-start" />}{copy.github.refresh}</Button></span>}
      </AlertDescription>
    </Alert>
  )
}

/** Checkbox meaning stays “provided to Agent” in both modes. RHF alone owns the draft. */
export function GithubScopeFields({ form, scope, config, initiallyProvided, loading = false, initialMode, onRefresh }: {
  form: UseFormReturn<GithubScopeDraft>
  scope: CliScopeItem[]
  config?: GithubConfig
  initiallyProvided: string[]
  loading?: boolean
  initialMode?: GithubScopeDraft["mode"]
  onRefresh?: () => void
}) {
  const id = useId()
  const draft = useWatch({ control: form.control }) as GithubScopeDraft
  const [query, setQuery] = useState("")
  const manualVisited = useRef(form.getValues("mode") === "manual")
  const complete = githubComplete(config)
  const normalized = query.trim().toLocaleLowerCase()
  const shown = scope.filter((repo) => repo.name.toLocaleLowerCase().includes(normalized))
  const provided = githubProvidedIds(draft, scope)
  const newlyProvided = provided.filter((repoId) => !initiallyProvided.includes(repoId)).length
  const mode = (next: string[]) => {
    if (next[0] !== "auto" && next[0] !== "manual") return
    const visible = complete ? scope : scope.filter((repo) => initiallyProvided.includes(repo.id))
    const update = githubSwitchMode(form.getValues(), next[0], visible, manualVisited.current)
    if (next[0] === "manual") manualVisited.current = true
    form.setValue("selectedRepoIds", update.selectedRepoIds, { shouldDirty: true })
    form.setValue("mode", update.mode, { shouldDirty: true })
  }
  const toggle = (repoId: string, on: boolean) => {
    if (on && !complete && !initiallyProvided.includes(repoId)) return
    const update = githubSetProvided(form.getValues(), repoId, on)
    form.setValue(update.mode === "auto" ? "excludedRepoIds" : "selectedRepoIds", update.mode === "auto" ? update.excludedRepoIds : update.selectedRepoIds, { shouldDirty: true })
  }
  return (
    <FieldGroup className="gap-4">
      <Field>
        <FieldLabel id={`${id}-mode`}>{copy.github.mode}</FieldLabel>
        <ToggleGroup aria-labelledby={`${id}-mode`} variant="outline" size="sm" value={[draft.mode]} onValueChange={mode}>
          <ToggleGroupItem value="auto">{copy.github.modeLabel.auto}</ToggleGroupItem>
          <ToggleGroupItem value="manual">{copy.github.modeLabel.manual}</ToggleGroupItem>
        </ToggleGroup>
        <FieldDescription>{draft.mode === "auto" ? copy.github.autoHint : copy.github.manualHint}</FieldDescription>
        {draft.mode === "manual" && initialMode === "manual" && <FieldDescription>{copy.github.manualPreserved}</FieldDescription>}
        {draft.mode === "auto" && initialMode === "manual" && <FieldDescription>{copy.github.expansion(newlyProvided)}</FieldDescription>}
      </Field>
      <Field>
        <div className="flex items-center justify-between gap-2">
          <FieldLabel htmlFor={`${id}-search`}>{copy.github.search}</FieldLabel>
          {onRefresh && <Button type="button" variant="ghost" size="xs" disabled={loading} onClick={onRefresh}>{loading ? <Spinner data-icon="inline-start" /> : <RefreshCwIcon data-icon="inline-start" />}{copy.github.refresh}</Button>}
        </div>
        <Input id={`${id}-search`} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={copy.github.searchPlaceholder} />
      </Field>
      {loading && scope.length === 0 ? (
        <div aria-busy="true" aria-label={copy.github.reposLoading} className="flex flex-col gap-2"><Skeleton className="h-10" /><Skeleton className="h-10" /><Skeleton className="h-10" /></div>
      ) : shown.length === 0 ? (
        <Empty className="border border-line p-4">
          <EmptyDescription>{normalized ? copy.github.noMatch : copy.github.noneAvailable}</EmptyDescription>
          {normalized && <EmptyContent><Button type="button" variant="outline" size="sm" onClick={() => setQuery("")}>{copy.github.clearSearch}</Button></EmptyContent>}
        </Empty>
      ) : (
        <ItemGroup className="gap-0 divide-y divide-line-2 overflow-hidden rounded-[10px] border border-line" aria-label={copy.github.scopeTitle}>
          {shown.map((repo) => {
            const selected = provided.includes(repo.id) && (complete || initiallyProvided.includes(repo.id))
            const excluded = draft.mode === "auto" && draft.excludedRepoIds.includes(repo.id)
            const addition = selected && !initiallyProvided.includes(repo.id)
            const fieldId = `${id}-repo-${repo.id}`
            return (
              <Item key={repo.id} role="listitem" size="sm">
                <ItemContent>
                  <Field orientation="horizontal" className="min-w-0 gap-2.5">
                    <Checkbox id={fieldId} checked={selected} disabled={!complete && !initiallyProvided.includes(repo.id)} onCheckedChange={(value) => toggle(repo.id, value === true)} aria-label={copy.github.repoLabel(repo.name)} />
                    <FieldLabel htmlFor={fieldId} className="min-w-0 flex-1 font-normal"><span className="font-mono text-xs wrap-anywhere">{repo.name}</span></FieldLabel>
                  </Field>
                </ItemContent>
                <ItemActions className="flex-wrap justify-end gap-1.5 text-xs text-muted-foreground">
                  {repo.visibility && <span>{copy.github.visibility[repo.visibility]}</span>}
                  {(excluded || addition || !selected) && <span>{excluded ? copy.github.excluded : addition ? copy.github.willAdd : copy.github.notProvided}</span>}
                </ItemActions>
              </Item>
            )
          })}
        </ItemGroup>
      )}
    </FieldGroup>
  )
}

export function GithubAccountGroup({ asset, config = asset.github, onScope }: { asset: CliAsset; config?: GithubConfig; onScope: () => void }) {
  const identities = [...new Set(Object.values(asset.cli.envStates).flatMap((state) => state?.authenticated && !state.expired && state.account ? [state.account] : []))]
  const owner = config?.owner?.login
  const count = config?.mode === "auto" ? config.excludedRepoIds.length : asset.cli.scope.filter((repo) => repo.selected).length
  return (
    <ListGroup id="detail-account" title={copy.github.scopeTitle} action={<Button variant="ghost" size="sm" aria-haspopup="dialog" onClick={onScope}>{copy.github.manageScope}</Button>}>
      <PrefRow label={copy.github.owner} hint={config?.owner ? [copy.github.ownerKind[config.owner.kind], identities.length === 1 && identities[0] === owner ? copy.github.sameIdentity : null].filter(Boolean).join(" · ") : undefined}>{owner ? <CopyValue value={owner} label={copy.github.owner} /> : <span className="text-xs text-muted-foreground">{copy.github.ownerMissing}</span>}</PrefRow>
      <PrefRow label={copy.github.mode} hint={config?.mode === "auto" ? copy.github.autoHint : copy.github.manualHint}>
        <span className="text-xs text-muted-foreground">{config?.mode === "auto" ? copy.github.autoSummary(count) : copy.github.manualSummary(count)}</span>
      </PrefRow>
      {config?.migrationPending && <PrefRow warn label={copy.github.migrationPending} />}
    </ListGroup>
  )
}

function deploymentRelations(asset: CliAsset, repo: CliScopeItem, relations: Relation[], assets: Record<string, import("@/bindings").Asset>) {
  return relations.filter((relation) => !relation.hidden && relation.assetIds.includes(asset.id) && relation.params.repoId === repo.id && typeof relation.params.evidence === "string" && !!copy.github.evidenceSource[relation.params.evidence]).flatMap((relation) => relation.assetIds.filter((id) => id !== asset.id).flatMap((id) => {
    const target = assets[id]
    if (!target || !target.agent.agents.some((key) => asset.agent.agents.includes(key))) return []
    return [{ id: `${relation.id}:${id}`, name: target.name, evidence: String(relation.params.evidence) }]
  }))
}

/** Four fixed columns; evidence is shown only for a selected repository and provided target. */
export function GithubReposGroup({ asset }: { asset: CliAsset }) {
  const [query, setQuery] = useState("")
  const id = useId()
  const relations = useSkillStore((state) => state.relations)
  const assets = useAssetStore((state) => state.byId)
  const repos = useMemo(() => asset.cli.scope.filter((repo) => repo.kind === "repo" && repo.selected), [asset.cli.scope])
  const shown = repos.filter((repo) => repo.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  return (
    <ListGroup id="detail-repos" title={copy.detail.groups.repos} count={repos.length}>
      <div className="px-3.5 py-3"><Field><FieldLabel htmlFor={id} className="sr-only">{copy.github.search}</FieldLabel><Input id={id} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={copy.github.searchPlaceholder} /></Field></div>
      {shown.length === 0 ? (
        <Empty className="border-0 p-4"><EmptyDescription>{query.trim() ? copy.github.noMatch : copy.github.noneProvided}</EmptyDescription>{query.trim() && <EmptyContent><Button variant="outline" size="sm" onClick={() => setQuery("")}>{copy.github.clearSearch}</Button></EmptyContent>}</Empty>
      ) : (
        <Table className="table-fixed text-xs" aria-label={copy.github.table}>
          <TableHeader><TableRow><TableHead className="w-[38%]">{copy.github.columns.name}</TableHead><TableHead className="w-[17%]">{copy.github.columns.branch}</TableHead><TableHead className="w-[13%]">{copy.github.columns.visibility}</TableHead><TableHead className="w-[32%]">{copy.github.columns.deployment}</TableHead></TableRow></TableHeader>
          <TableBody>{shown.map((repo) => {
            const targets = deploymentRelations(asset, repo, relations, assets)
            return <TableRow key={repo.id}>
              <TableCell className="font-mono whitespace-normal wrap-anywhere">{repo.name}</TableCell>
              <TableCell className="font-mono whitespace-normal wrap-anywhere">{repo.defaultBranch ?? copy.common.none}</TableCell>
              <TableCell>{repo.visibility ? copy.github.visibility[repo.visibility] : copy.common.none}</TableCell>
              <TableCell className="whitespace-normal">{targets.length ? <span className="flex flex-col gap-1">{targets.map((target) => <Tooltip key={target.id}><TooltipTrigger render={<span tabIndex={0} className="rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring wrap-anywhere" />}>{target.name}</TooltipTrigger><TooltipContent>{copy.github.evidence(copy.github.evidenceSource[target.evidence] ?? copy.common.none)}</TooltipContent></Tooltip>)}</span> : copy.common.none}</TableCell>
            </TableRow>
          })}</TableBody>
        </Table>
      )}
      <p className="px-3.5 py-2.5 text-xs text-muted-foreground">{copy.github.relationNote}</p>
    </ListGroup>
  )
}
