import { InfoIcon, PlusIcon, RefreshCwIcon, ServerIcon } from "lucide-react"
import { useId, useMemo, useRef, useState } from "react"
import { useWatch, type UseFormReturn } from "react-hook-form"

import type { Asset, CliAsset, CliScopeItem, CloudScopeConfig, CloudScopeMode, IpcError } from "@/bindings"
import { CopyValue, ListGroup, ListNote, PrefRow } from "@/components/app/SettingsList"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Empty, EmptyContent, EmptyDescription } from "@/components/ui/empty"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Item, ItemActions, ItemContent, ItemGroup } from "@/components/ui/item"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { copy, ipcErrorText } from "@/lib/copy"
import { selectCliAccount, useAssetStore } from "@/stores/assets"
import { useUIStore } from "@/stores/ui"
import { cloudProvidedIds, cloudSetProvided, cloudSwitchMode, type CloudScopeDraft } from "./cloudScopeForm"

export function CloudSnapshotNote({
  config,
  error,
  mode,
  creating = false,
  loading = false,
  onRetry,
}: {
  config?: CloudScopeConfig
  error?: IpcError | null
  mode?: CloudScopeMode
  creating?: boolean
  loading?: boolean
  onRetry?: () => void
}) {
  const effectiveMode = mode ?? config?.mode ?? "auto"
  const status = config?.snapshotStatus
  const text = error
    ? creating
      ? effectiveMode === "auto"
        ? copy.cloudScope.snapshotFailedCreateAuto
        : copy.cloudScope.snapshotFailedCreateManual
      : copy.cloudScope.snapshotFailedDetail
    : status === "failed"
      ? copy.cloudScope.snapshotFailedDetail
      : status === "partial"
        ? copy.cloudScope.snapshotPartial
        : null
  const reason = error
    ? ipcErrorText(error.id, error.params)
    : config?.snapshotErrorId
      ? ipcErrorText(config.snapshotErrorId)
      : null
  if (!text) return null
  return (
    <Alert variant="default">
      <InfoIcon />
      <AlertDescription className="flex flex-col gap-2 text-xs leading-normal">
        <span>{text}</span>
        {reason && <span className="text-xs text-muted-foreground">{reason}</span>}
        {onRetry && (
          <span>
            <Button type="button" variant="outline" size="xs" disabled={loading} onClick={onRetry}>
              {loading ? <Spinner data-icon="inline-start" /> : <RefreshCwIcon data-icon="inline-start" />}
              {copy.cloudScope.refresh}
            </Button>
          </span>
        )}
      </AlertDescription>
    </Alert>
  )
}

/** Checkbox meaning stays “provided to Agent” in both modes (mirrors GithubScopeFields). */
export function CloudScopeFields({
  form,
  scope,
  initiallyProvided,
  loading = false,
  initialMode,
  onRefresh,
  onAddAsServer,
}: {
  form: UseFormReturn<CloudScopeDraft>
  scope: CliScopeItem[]
  initiallyProvided: string[]
  loading?: boolean
  initialMode?: CloudScopeMode
  onRefresh?: () => void
  onAddAsServer?: (item: CliScopeItem) => void
}) {
  const id = useId()
  const draft = useWatch({ control: form.control }) as CloudScopeDraft
  const byId = useAssetStore((s) => s.byId)
  const [query, setQuery] = useState("")
  const manualVisited = useRef(form.getValues("mode") === "manual")
  const normalized = query.trim().toLocaleLowerCase()
  const shown = scope.filter((item) => item.name.toLocaleLowerCase().includes(normalized))
  const provided = cloudProvidedIds(draft, scope)
  const newlyProvided = provided.filter((itemId) => !initiallyProvided.includes(itemId)).length
  const nameOf = (assetId?: string) => {
    const a: Asset | undefined = assetId ? byId[assetId] : undefined
    return a ? a.name : undefined
  }
  const setMode = (next: string[]) => {
    if (next[0] !== "auto" && next[0] !== "manual") return
    const update = cloudSwitchMode(form.getValues(), next[0], scope, manualVisited.current)
    if (next[0] === "manual") manualVisited.current = true
    form.setValue("selectedIds", update.selectedIds, { shouldDirty: true })
    form.setValue("mode", update.mode, { shouldDirty: true })
  }
  const toggle = (itemId: string, on: boolean) => {
    const update = cloudSetProvided(form.getValues(), itemId, on)
    form.setValue(
      update.mode === "auto" ? "excludedIds" : "selectedIds",
      update.mode === "auto" ? update.excludedIds : update.selectedIds,
      { shouldDirty: true }
    )
  }

  return (
    <FieldGroup className="gap-3">
      <Field className="gap-1.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <FieldLabel id={`${id}-mode`} className="text-[13px] font-medium">
            {copy.cloudScope.mode}
          </FieldLabel>
          <ToggleGroup
            aria-labelledby={`${id}-mode`}
            variant="outline"
            size="sm"
            spacing={0}
            value={[draft.mode]}
            onValueChange={setMode}
          >
            <ToggleGroupItem value="auto" className="px-3">
              {copy.cloudScope.modeLabel.auto}
            </ToggleGroupItem>
            <ToggleGroupItem value="manual" className="px-3">
              {copy.cloudScope.modeLabel.manual}
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
        <FieldDescription className="text-xs leading-normal">
          {draft.mode === "auto" ? copy.cloudScope.autoHint : copy.cloudScope.manualHint}
        </FieldDescription>
        {draft.mode === "manual" && initialMode === "manual" && (
          <FieldDescription className="text-xs leading-normal">{copy.cloudScope.manualPreserved}</FieldDescription>
        )}
        {draft.mode === "auto" && initialMode === "manual" && (
          <FieldDescription className="text-xs leading-normal">{copy.cloudScope.expansion(newlyProvided)}</FieldDescription>
        )}
      </Field>
      <Field>
        <div className="flex items-center justify-between gap-2">
          <FieldLabel htmlFor={`${id}-search`} className="text-[13px] font-medium">
            {copy.cloudScope.search}
          </FieldLabel>
          {onRefresh && (
            <Button type="button" variant="ghost" size="xs" disabled={loading} onClick={onRefresh}>
              {loading ? <Spinner data-icon="inline-start" /> : <RefreshCwIcon data-icon="inline-start" />}
              {copy.cloudScope.refresh}
            </Button>
          )}
        </div>
        <Input
          id={`${id}-search`}
          className="text-[13px] md:text-[13px]"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={copy.cloudScope.searchPlaceholder}
        />
      </Field>
      {loading && scope.length === 0 ? (
        <div aria-busy="true" aria-label={copy.cloudScope.loading} className="flex flex-col gap-2">
          <Skeleton className="h-9" />
          <Skeleton className="h-9" />
          <Skeleton className="h-9" />
        </div>
      ) : shown.length === 0 ? (
        <Empty className="rounded-lg border border-line p-4">
          <EmptyDescription className="text-xs leading-normal">
            {normalized
              ? copy.cloudScope.noMatch
              : draft.mode === "auto"
                ? copy.cloudScope.noneAvailableAuto
                : copy.cloudScope.noneAvailableManual}
          </EmptyDescription>
          {normalized && (
            <EmptyContent>
              <Button type="button" variant="outline" size="sm" onClick={() => setQuery("")}>
                {copy.cloudScope.clearSearch}
              </Button>
            </EmptyContent>
          )}
        </Empty>
      ) : (
        <ItemGroup
          className="gap-0 divide-y divide-line-2 overflow-hidden rounded-lg border border-line"
          aria-label={copy.cloudScope.scopeTitle}
        >
          {shown.map((item) => {
            const selected = provided.includes(item.id)
            const excluded = draft.mode === "auto" && draft.excludedIds.includes(item.id)
            const addition = initialMode !== undefined && selected && !initiallyProvided.includes(item.id)
            const linked = nameOf(item.linkedAssetId)
            const fieldId = `${id}-item-${item.id}`
            return (
              <Item key={item.id} role="listitem" size="xs" className="px-3 py-2 text-xs">
                <ItemContent>
                  <Field orientation="horizontal" className="min-w-0 gap-2.5">
                    <Checkbox
                      id={fieldId}
                      checked={selected}
                      onCheckedChange={(value) => toggle(item.id, value === true)}
                      aria-label={copy.cloudScope.itemLabel(item.name)}
                    />
                    <FieldLabel htmlFor={fieldId} className="min-w-0 flex-1 font-normal">
                      <span className="font-mono text-xs wrap-anywhere">{item.name}</span>
                    </FieldLabel>
                  </Field>
                </ItemContent>
                <ItemActions className="flex-wrap justify-end gap-1.5 text-xs text-muted-foreground">
                  <span>{copy.cli.kind[item.kind]}</span>
                  {linked && (
                    <Badge variant="outline" className="shrink-0">
                      <ServerIcon data-icon="inline-start" />
                      {copy.cli.linked(linked)}
                    </Badge>
                  )}
                  {item.kind === "instance" && onAddAsServer && (
                    <Button type="button" variant="secondary" size="xs" className="shrink-0" onClick={() => onAddAsServer(item)}>
                      <PlusIcon data-icon="inline-start" />
                      {copy.cli.addAsServer}
                    </Button>
                  )}
                  {(excluded || addition || !selected) && (
                    <span>
                      {excluded
                        ? copy.cloudScope.excluded
                        : addition
                          ? copy.cloudScope.willAdd
                          : copy.cloudScope.notProvided}
                    </span>
                  )}
                </ItemActions>
              </Item>
            )
          })}
        </ItemGroup>
      )}
    </FieldGroup>
  )
}

export function CloudAccountGroup({ asset, onScope }: { asset: CliAsset; onScope: () => void }) {
  const account = selectCliAccount(asset)
  const config = asset.cloudScope
  const mode: CloudScopeMode = config?.mode ?? "manual"
  const count =
    mode === "auto"
      ? (config?.excludedIds.length ?? 0)
      : asset.cli.scope.filter((item) => item.selected).length
  return (
    <ListGroup
      id="detail-account"
      title={copy.cloudScope.scopeTitle}
      action={
        <Button variant="ghost" size="sm" aria-haspopup="dialog" onClick={onScope}>
          {copy.cloudScope.manageScope}
        </Button>
      }
    >
      <PrefRow label={copy.detail.rows.account}>
        {account ? (
          <CopyValue value={account} label={copy.detail.rows.account} />
        ) : (
          <span className="text-xs text-muted-foreground">{copy.common.none}</span>
        )}
      </PrefRow>
      <PrefRow
        label={copy.cloudScope.mode}
        hint={mode === "auto" ? copy.cloudScope.autoHint : copy.cloudScope.manualHint}
      >
        <span className="text-xs text-muted-foreground">
          {mode === "auto" ? copy.cloudScope.autoSummary(count) : copy.cloudScope.manualSummary(count)}
        </span>
      </PrefRow>
    </ListGroup>
  )
}

export function CloudResourcesGroup({
  asset,
  loading = false,
  onRefresh,
}: {
  asset: CliAsset
  loading?: boolean
  onRefresh: () => void
}) {
  const [query, setQuery] = useState("")
  const id = useId()
  const byId = useAssetStore((state) => state.byId)
  const mode: CloudScopeMode = asset.cloudScope?.mode ?? "manual"
  const items = useMemo(() => asset.cli.scope.filter((item) => item.selected), [asset.cli.scope])
  const shown = items.filter((item) => item.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  const nameOf = (assetId?: string) => {
    const a: Asset | undefined = assetId ? byId[assetId] : undefined
    return a ? a.name : undefined
  }
  const addAsServer = (item: CliScopeItem) =>
    useUIStore.getState().startCreate("ssh", { prefill: { host: item.address ?? "", name: item.name } })

  return (
    <ListGroup
      id="detail-resources"
      title={copy.cloudScope.listTitle}
      count={items.length}
      action={
        <Button type="button" variant="ghost" size="sm" disabled={loading} onClick={onRefresh}>
          {loading ? <Spinner data-icon="inline-start" /> : <RefreshCwIcon data-icon="inline-start" />}
          {copy.cloudScope.refresh}
        </Button>
      }
    >
      <div className="px-3.5 py-2.5">
        <Field>
          <FieldLabel htmlFor={id} className="sr-only">
            {copy.cloudScope.search}
          </FieldLabel>
          <Input
            id={id}
            className="text-[13px] md:text-[13px]"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={copy.cloudScope.searchPlaceholder}
          />
        </Field>
      </div>
      {shown.length === 0 ? (
        <Empty className="border-0 p-4">
          <EmptyDescription className="text-xs leading-normal">
            {query.trim()
              ? copy.cloudScope.noMatch
              : mode === "auto"
                ? copy.cloudScope.noneProvidedAuto
                : copy.cloudScope.noneProvidedManual}
          </EmptyDescription>
          {query.trim() && (
            <EmptyContent>
              <Button variant="outline" size="sm" onClick={() => setQuery("")}>
                {copy.cloudScope.clearSearch}
              </Button>
            </EmptyContent>
          )}
        </Empty>
      ) : (
        <Table className="table-fixed text-xs" aria-label={copy.cloudScope.table}>
          <TableHeader>
            <TableRow>
              <TableHead className="h-9 w-[46%] text-xs text-muted-foreground first:pl-3.5">{copy.cloudScope.columns.name}</TableHead>
              <TableHead className="h-9 w-[22%] text-xs text-muted-foreground">{copy.cloudScope.columns.kind}</TableHead>
              <TableHead className="h-9 w-[32%] text-xs text-muted-foreground last:pr-3.5">{copy.cloudScope.columns.link}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((item) => {
              const linked = nameOf(item.linkedAssetId)
              return (
                <TableRow key={item.id}>
                  <TableCell className="font-mono whitespace-normal wrap-anywhere first:pl-3.5">{item.name}</TableCell>
                  <TableCell>{copy.cli.kind[item.kind]}</TableCell>
                  <TableCell className="whitespace-normal last:pr-3.5">
                    <span className="flex flex-wrap items-center gap-1.5">
                      {linked ? (
                        <Badge variant="outline" className="shrink-0">
                          <ServerIcon data-icon="inline-start" />
                          {copy.cli.linked(linked)}
                        </Badge>
                      ) : item.kind === "instance" ? (
                        <Button type="button" variant="secondary" size="xs" onClick={() => addAsServer(item)}>
                          <PlusIcon data-icon="inline-start" />
                          {copy.cli.addAsServer}
                        </Button>
                      ) : (
                        copy.common.none
                      )}
                    </span>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      )}
      <ListNote icon={<InfoIcon />}>{copy.cloudScope.relationNote}</ListNote>
    </ListGroup>
  )
}
