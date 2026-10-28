import {
  CircleCheckIcon,
  LockIcon,
  MonitorIcon,
  SquareTerminalIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { useEffect, useMemo } from "react"
import { Controller, useFormContext, useWatch } from "react-hook-form"

import type { Asset, EnvId } from "@/bindings"
import { CreatableCombobox } from "@/components/app/CreatableCombobox"
import { StateBadge } from "@/components/app/StateBadge"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import { Item, ItemActions, ItemContent, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item"
import { Switch } from "@/components/ui/switch"
import { useMinuteTick } from "@/hooks/use-minute-tick"
import { copy } from "@/lib/copy"
import { formatRelative } from "@/lib/format"
import type { AssetFormValues } from "@/lib/schemas"
import { useTargetStore } from "@/stores/targets"
import { useUIStore } from "@/stores/ui"
import { slugFromAlias } from "../assetForm"
import { ValidationError } from "../ValidationError"
import { Required } from "./OverviewTab"

const envList = (ids: EnvId[]) => ids.map(copy.env.long).join("、")

export function ConnectionTab({ asset }: { asset: Asset | undefined }) {
  const {
    control,
    getValues,
    setValue,
    formState: { errors },
  } = useFormContext<AssetFormValues>()
  const creating = useUIStore((s) => s.creatingAsset)
  const environments = useTargetStore((s) => s.environments)
  const sshHosts = useTargetStore((s) => s.sshHosts)
  const alias = useWatch({ control, name: "sshAlias" })
  useMinuteTick()

  // 别名候选来自 ssh config（F-102），每项标注定义在哪些运行环境
  useEffect(() => {
    if (useTargetStore.getState().sshHostsStatus === "idle") void useTargetStore.getState().loadSshHosts()
  }, [])
  const options = useMemo(
    () =>
      (sshHosts?.hosts ?? []).map((h) => ({
        value: h.alias,
        label: h.alias,
        hint: envList(h.definedIn),
      })),
    [sshHosts]
  )

  const savedAlias = asset?.connection.sshAlias
  const definedIn =
    sshHosts?.hosts.find((h) => h.alias === alias)?.definedIn ??
    (alias && alias === savedAlias ? asset?.connection.definedIn : undefined) ??
    []
  const resolved = alias === savedAlias ? asset?.connection.resolved : null
  const rows: [string, string][] = resolved
    ? [
        ["HostName", resolved.hostname],
        ["User", resolved.user],
        ["Port", String(resolved.port)],
        ["ProxyJump", resolved.proxyJump ?? copy.common.none],
      ]
    : []

  return (
    <FieldGroup className="gap-6">
      <Field data-invalid={!!errors.sshAlias || undefined}>
        <FieldLabel htmlFor="asset-alias">
          {copy.connection.alias} <Required />
        </FieldLabel>
        <Controller
          name="sshAlias"
          control={control}
          render={({ field }) => (
            <CreatableCombobox
              id="asset-alias"
              value={field.value}
              onChange={(next) => {
                // 新建资产时 slug 跟随别名，用户改过 slug 就不再跟随
                if (creating) {
                  const slug = getValues("slug")
                  if (!slug || slug === slugFromAlias(field.value)) {
                    setValue("slug", slugFromAlias(next), { shouldDirty: true, shouldValidate: !!next })
                  }
                }
                field.onChange(next)
              }}
              onBlur={field.onBlur}
              inputRef={field.ref}
              options={options}
              placeholder={copy.connection.aliasPlaceholder}
              invalid={!!errors.sshAlias}
              required
              describedBy="asset-alias-hint"
              inputClassName="font-mono"
            />
          )}
        />
        <FieldDescription id="asset-alias-hint">{copy.connection.aliasHint}</FieldDescription>
        <ValidationError error={errors.sshAlias} />
      </Field>

      <FieldSet className="min-w-0 gap-2">
        <div className="flex items-center justify-between gap-3">
          <FieldLegend variant="label" className="mb-0">
            {copy.connection.resolved}
          </FieldLegend>
          <Field orientation="horizontal" className="w-auto gap-2">
            <Controller
              name="export.resolvedConnection"
              control={control}
              render={({ field }) => (
                <Switch
                  id="export-resolved"
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
              )}
            />
            <FieldLabel htmlFor="export-resolved" className="font-normal">
              {copy.connection.exportResolved}
              <span className="sr-only">{copy.connection.exportResolvedLabel}</span>
            </FieldLabel>
          </Field>
        </div>
        <FieldDescription>{copy.connection.resolvedHint}</FieldDescription>
        {resolved ? (
          <>
            <ItemGroup className="gap-0 overflow-hidden rounded-lg border">
              {rows.map(([key, value]) => (
                <Item key={key} size="xs" className="rounded-none border-0 border-b last:border-b-0">
                  <ItemMedia>
                    <LockIcon className="size-3.5 text-muted-foreground" aria-hidden />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle className="font-normal text-muted-foreground">{key}</ItemTitle>
                  </ItemContent>
                  <ItemActions className="font-mono text-[0.8125rem]">
                    {value}
                    <span className="sr-only">（{copy.connection.lockedField}）</span>
                  </ItemActions>
                </Item>
              ))}
            </ItemGroup>
            <p className="text-xs text-muted-foreground">
              {copy.connection.resolvedAt(formatRelative(resolved.resolvedAt))}
            </p>
          </>
        ) : (
          <p className="rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground">
            {savedAlias && alias !== savedAlias
              ? copy.connection.resolvedStale
              : copy.connection.resolvedNone}
          </p>
        )}
      </FieldSet>

      <FieldSet className="min-w-0 gap-2">
        <FieldLegend variant="label" className="mb-0">
          {copy.connection.reachability}
        </FieldLegend>
        <FieldDescription>{copy.connection.reachabilityHint}</FieldDescription>
        <ItemGroup className="gap-1">
          {environments.map((env) => {
            const ok = definedIn.includes(env.id)
            const EnvIcon = env.id === "windows" ? MonitorIcon : SquareTerminalIcon
            return (
              <Item key={env.id} size="xs" variant="muted">
                <ItemMedia>
                  <EnvIcon className="size-4" aria-hidden />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle className="font-normal">{copy.env.long(env.id)}</ItemTitle>
                </ItemContent>
                <ItemActions>
                  <StateBadge
                    tone={ok ? "success" : "warning"}
                    icon={ok ? CircleCheckIcon : TriangleAlertIcon}
                  >
                    {ok ? copy.connection.defined : copy.connection.notDefined}
                  </StateBadge>
                </ItemActions>
              </Item>
            )
          })}
        </ItemGroup>
      </FieldSet>
    </FieldGroup>
  )
}
