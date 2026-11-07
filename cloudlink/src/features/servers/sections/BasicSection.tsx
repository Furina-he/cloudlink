import { CircleIcon } from "lucide-react"
import { useMemo } from "react"
import { Controller, useFormContext, useWatch } from "react-hook-form"
import { useShallow } from "zustand/react/shallow"

import type { EnvTag } from "@/bindings"
import { CreatableCombobox, CreatableMultiCombobox } from "@/components/app/CreatableCombobox"
import { ENV_DOT } from "@/components/app/EnvBadge"
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupText, InputGroupTextarea } from "@/components/ui/input-group"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { copy } from "@/lib/copy"
import { hostnameError, type ProfileFormValues, type ServerFormValues } from "@/lib/schemas"
import { cn } from "@/lib/utils"
import { collectValues, ENV_ORDER, isServer, useAssetStore } from "@/stores/assets"
import { Required } from "../Required"
import { ValidationError } from "../ValidationError"

const toOptions = (values: string[]) => values.map((v) => ({ value: v, label: v }))
const OPTIONAL = <span className="font-normal text-muted-foreground">{copy.common.optional}</span>

/** 名称（两类资源共用）。onChange 在新建时让别名跟随名称 */
/** `fallback`：添加服务器时名称可以不填，保存时用地址（与 Termius 的标签一致） */
export function NameField({ onChange, fallback }: { onChange?: (name: string) => void; fallback?: string }) {
  const {
    register,
    formState: { errors },
  } = useFormContext<ProfileFormValues>()
  const optional = fallback !== undefined
  return (
    <Field data-invalid={!!errors.name || undefined}>
      <FieldLabel htmlFor="server-name">
        {copy.basic.name} {!optional && <Required />}
      </FieldLabel>
      <Input
        id="server-name"
        aria-required={!optional}
        placeholder={optional ? copy.basic.nameFallback(fallback) : undefined}
        aria-invalid={!!errors.name || undefined}
        {...register("name", { onChange: (e: { target: { value: string } }) => onChange?.(e.target.value) })}
      />
      <ValidationError error={errors.name} />
    </Field>
  )
}

/** 环境标签：生产、预发、开发 */
export function EnvTagField() {
  const { control } = useFormContext<ProfileFormValues>()
  return (
    <FieldSet className="min-w-0 gap-2">
      <FieldLegend variant="label" className="mb-0">
        {copy.basic.env}
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
  )
}

/** 用途（两类资源共用）：写进总览表和 description */
export function SummaryField() {
  const { register, control } = useFormContext<ProfileFormValues>()
  const summary = useWatch({ control, name: "summary" })
  return (
    <Field>
      <FieldLabel htmlFor="server-summary">{copy.basic.summary}</FieldLabel>
      <InputGroup>
        <InputGroupTextarea id="server-summary" rows={2} aria-describedby="server-summary-hint server-summary-count" {...register("summary")} />
        <InputGroupAddon align="block-end">
          <InputGroupText id="server-summary-count" className="ml-auto text-xs tabular-nums">
            {copy.basic.chars(summary.length)}
          </InputGroupText>
        </InputGroupAddon>
      </InputGroup>
      <FieldDescription id="server-summary-hint">{copy.basic.summaryHint}</FieldDescription>
    </Field>
  )
}

/** 全部服务器上出现过的值，作为表单的候选项 */
function useServerOptions() {
  // byId 里的对象引用稳定，浅比较数组即可
  const assets = useAssetStore(useShallow((s) => s.ids.map((id) => s.byId[id]).filter(isServer)))
  return useMemo(
    () => ({
      providers: toOptions(collectValues(assets, (a) => [a.provider])),
      regions: toOptions(collectValues(assets, (a) => [a.region])),
      tags: toOptions(collectValues(assets, (a) => a.tags)),
      sites: toOptions(collectValues(assets, (a) => a.servedHostnames)),
    }),
    [assets]
  )
}

/** 承载的站点（服务器）：写进 description，用户只说站点名时 Agent 也能找到这台服务器 */
export function SitesField() {
  const {
    control,
    formState: { errors },
  } = useFormContext<ServerFormValues>()
  const options = useServerOptions()
  // 数组字段的错误挂在下标上，取第一条显示
  const siteErrors = errors.servedHostnames
  const siteError = Array.isArray(siteErrors) ? siteErrors.find(Boolean) : siteErrors
  return (
    <Field data-invalid={!!siteError || undefined}>
      <FieldLabel htmlFor="server-sites">
        {copy.basic.servedHostnames}
        {OPTIONAL}
      </FieldLabel>
      <Controller
        name="servedHostnames"
        control={control}
        render={({ field }) => (
          <CreatableMultiCombobox
            id="server-sites"
            value={field.value}
            onChange={field.onChange}
            onBlur={field.onBlur}
            inputRef={field.ref}
            options={options.sites}
            placeholder={copy.basic.servedHostnamesPlaceholder}
            describedBy="server-sites-hint"
            invalid={!!siteError}
            normalize={(v) => v.trim().toLowerCase()}
            accept={(v) => hostnameError(v) === null}
            emptyText={copy.basic.servedHostnamesEmpty}
            mono
          />
        )}
      />
      <FieldDescription id="server-sites-hint">{copy.basic.servedHostnamesHint}</FieldDescription>
      <ValidationError error={siteError} />
    </Field>
  )
}

/** 其他信息（服务器）：标签、云厂商、地域 */
export function OtherFields() {
  const { control } = useFormContext<ServerFormValues>()
  const options = useServerOptions()
  return (
    <FieldGroup className="@container/field-group gap-4">
      <Field>
        <FieldLabel htmlFor="server-tags">
          {copy.basic.tags}
          {OPTIONAL}
        </FieldLabel>
        <Controller
          name="tags"
          control={control}
          render={({ field }) => (
            <CreatableMultiCombobox id="server-tags" value={field.value} onChange={field.onChange} options={options.tags} placeholder={copy.basic.tagsPlaceholder} />
          )}
        />
      </Field>
      <div className="grid gap-4 @md/field-group:grid-cols-2">
        {(["provider", "region"] as const).map((name) => (
          <Field key={name}>
            <FieldLabel htmlFor={`server-${name}`}>
              {copy.basic[name]}
              {OPTIONAL}
            </FieldLabel>
            <Controller
              name={name}
              control={control}
              render={({ field }) => (
                <CreatableCombobox
                  id={`server-${name}`}
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  inputRef={field.ref}
                  options={name === "provider" ? options.providers : options.regions}
                  clearable
                />
              )}
            />
          </Field>
        ))}
      </div>
    </FieldGroup>
  )
}
