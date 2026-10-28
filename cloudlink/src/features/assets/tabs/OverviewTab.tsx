import { CircleIcon, LockIcon } from "lucide-react"
import { useMemo } from "react"
import { Controller, useFormContext, useWatch } from "react-hook-form"
import { useShallow } from "zustand/react/shallow"

import { CreatableCombobox, CreatableMultiCombobox } from "@/components/app/CreatableCombobox"
import { ENV_DOT } from "@/components/app/EnvBadge"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
} from "@/components/ui/input-group"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import type { EnvTag } from "@/bindings"
import { copy } from "@/lib/copy"
import { hostnameError, type AssetFormValues } from "@/lib/schemas"
import { cn } from "@/lib/utils"
import { collectValues, ENV_ORDER, useAssetStore } from "@/stores/assets"
import { ValidationError } from "../ValidationError"

const toOptions = (values: string[]) => values.map((v) => ({ value: v, label: v }))

/** 必填标记：「*」只给眼睛看，读屏靠控件上的 aria-required */
export function Required() {
  return (
    <span aria-hidden className="text-muted-foreground">
      *
    </span>
  )
}

export function OverviewTab({
  slugLocked,
  onRename,
}: {
  slugLocked: boolean
  onRename: () => void
}) {
  const {
    register,
    control,
    trigger,
    formState: { errors },
  } = useFormContext<AssetFormValues>()
  const assets = useAssetStore(useShallow((s) => s.ids.map((id) => s.byId[id])))
  const providers = useMemo(() => toOptions(collectValues(assets, (a) => [a.provider])), [assets])
  const regions = useMemo(() => toOptions(collectValues(assets, (a) => [a.region])), [assets])
  const tags = useMemo(() => toOptions(collectValues(assets, (a) => a.tags)), [assets])
  const sites = useMemo(() => toOptions(collectValues(assets, (a) => a.servedHostnames)), [assets])
  const summary = useWatch({ control, name: "summary" })
  // 数组字段的错误挂在下标上，取第一条显示
  const siteErrors = errors.servedHostnames
  const siteError = Array.isArray(siteErrors) ? siteErrors.find(Boolean) : siteErrors

  return (
    <FieldGroup className="gap-4">
      <Field data-invalid={!!errors.name || undefined}>
        <FieldLabel htmlFor="asset-name">
          {copy.overview.name} <Required />
        </FieldLabel>
        <Input
          id="asset-name"
          aria-required
          aria-invalid={!!errors.name || undefined}
          {...register("name")}
        />
        <ValidationError error={errors.name} />
      </Field>

      <Field data-invalid={!!errors.slug || undefined}>
        <FieldLabel htmlFor="asset-slug">
          {copy.overview.slug} <Required />
        </FieldLabel>
        <InputGroup>
          <InputGroupInput
            id="asset-slug"
            className="font-mono"
            readOnly={slugLocked}
            aria-required
            aria-invalid={!!errors.slug || undefined}
            aria-describedby="asset-slug-hint"
            spellCheck={false}
            autoComplete="off"
            // F-101 AC1：slug 实时校验格式和唯一性
            {...register("slug", { onChange: () => void trigger("slug") })}
          />
          {slugLocked && (
            <InputGroupAddon align="inline-end">
              <InputGroupText>
                <LockIcon />
                {copy.overview.slugLocked}
              </InputGroupText>
              <InputGroupButton variant="outline" onClick={onRename}>
                {copy.overview.renameButton}
              </InputGroupButton>
            </InputGroupAddon>
          )}
        </InputGroup>
        <FieldDescription id="asset-slug-hint">
          {slugLocked ? copy.overview.slugLockedHint : copy.overview.slugHint}
        </FieldDescription>
        <ValidationError error={errors.slug} />
      </Field>

      <FieldSet className="min-w-0 gap-2">
        <FieldLegend variant="label" className="mb-0">
          {copy.overview.env} <Required />
        </FieldLegend>
        <Controller
          name="envTag"
          control={control}
          render={({ field }) => (
            <ToggleGroup
              variant="outline"
              size="sm"
              spacing={0}
              value={[field.value]}
              onValueChange={(next) => next[0] && field.onChange(next[0] as EnvTag)}
            >
              {ENV_ORDER.map((env) => (
                <ToggleGroupItem key={env} value={env} className="px-3">
                  <CircleIcon className={cn("size-2! fill-current", ENV_DOT[env])} />
                  {copy.env.tag[env]}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          )}
        />
      </FieldSet>

      <div className="grid gap-4 @md/field-group:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="asset-provider">
            {copy.overview.provider}
            <span className="font-normal text-muted-foreground">{copy.common.optional}</span>
          </FieldLabel>
          <Controller
            name="provider"
            control={control}
            render={({ field }) => (
              <CreatableCombobox
                id="asset-provider"
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                inputRef={field.ref}
                options={providers}
                clearable
              />
            )}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="asset-region">
            {copy.overview.region}
            <span className="font-normal text-muted-foreground">{copy.common.optional}</span>
          </FieldLabel>
          <Controller
            name="region"
            control={control}
            render={({ field }) => (
              <CreatableCombobox
                id="asset-region"
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                inputRef={field.ref}
                options={regions}
                clearable
              />
            )}
          />
        </Field>
      </div>

      <Field>
        <FieldLabel htmlFor="asset-tags">
          {copy.overview.tags}
          <span className="font-normal text-muted-foreground">{copy.common.optional}</span>
        </FieldLabel>
        <Controller
          name="tags"
          control={control}
          render={({ field }) => (
            <CreatableMultiCombobox
              id="asset-tags"
              value={field.value}
              onChange={field.onChange}
              options={tags}
              placeholder={copy.overview.tagsPlaceholder}
            />
          )}
        />
      </Field>

      <Field>
        <FieldLabel htmlFor="asset-summary">{copy.overview.summary}</FieldLabel>
        <InputGroup>
          <InputGroupTextarea
            id="asset-summary"
            rows={2}
            aria-describedby="asset-summary-hint asset-summary-count"
            {...register("summary")}
          />
          <InputGroupAddon align="block-end">
            <InputGroupText id="asset-summary-count" className="ml-auto text-xs tabular-nums">
              {copy.overview.chars(summary.length)}
            </InputGroupText>
          </InputGroupAddon>
        </InputGroup>
        <FieldDescription id="asset-summary-hint">{copy.overview.summaryHint}</FieldDescription>
      </Field>

      <Field data-invalid={!!siteError || undefined}>
        <FieldLabel htmlFor="asset-sites">
          {copy.overview.servedHostnames}
          <span className="font-normal text-muted-foreground">{copy.common.optional}</span>
        </FieldLabel>
        <Controller
          name="servedHostnames"
          control={control}
          render={({ field }) => (
            <CreatableMultiCombobox
              id="asset-sites"
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              inputRef={field.ref}
              options={sites}
              placeholder={copy.overview.servedHostnamesPlaceholder}
              describedBy="asset-sites-hint"
              invalid={!!siteError}
              normalize={(v) => v.trim().toLowerCase()}
              accept={(v) => hostnameError(v) === null}
              emptyText={copy.overview.servedHostnamesEmpty}
              mono
            />
          )}
        />
        <FieldDescription id="asset-sites-hint">{copy.overview.servedHostnamesHint}</FieldDescription>
        <ValidationError error={siteError} />
      </Field>

      <Field>
        <FieldLabel htmlFor="asset-notes">
          {copy.overview.notes}
          <span className="font-normal text-muted-foreground">{copy.common.optional}</span>
        </FieldLabel>
        <Textarea
          id="asset-notes"
          rows={4}
          aria-describedby="asset-notes-hint"
          {...register("notes")}
        />
        <FieldDescription id="asset-notes-hint">{copy.overview.notesHint}</FieldDescription>
      </Field>
    </FieldGroup>
  )
}
