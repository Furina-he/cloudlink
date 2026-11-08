import { useMemo } from "react"
import { Controller, useFormContext } from "react-hook-form"
import { useShallow } from "zustand/react/shallow"

import { CreatableCombobox, CreatableMultiCombobox } from "@/components/app/CreatableCombobox"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { copy } from "@/lib/copy"
import { hostnameError, type ProfileFormValues, type ServerFormValues } from "@/lib/schemas"
import { collectValues, isServer, useAssetStore } from "@/stores/assets"
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

/** 生产环境开关（F-109）：生产资源新建时默认只读巡检，切到标准运维要确认 */
export function ProductionField() {
  const { control } = useFormContext<ProfileFormValues>()
  return (
    <Controller
      name="production"
      control={control}
      render={({ field }) => (
        <Field orientation="horizontal" className="items-center justify-between gap-4">
          <div className="flex flex-col gap-0.5">
            <FieldLabel htmlFor="asset-production">{copy.basic.production}</FieldLabel>
            <FieldDescription className="text-xs">{copy.basic.productionHint}</FieldDescription>
          </div>
          <Switch id="asset-production" checked={field.value} onCheckedChange={(v) => field.onChange(v)} />
        </Field>
      )}
    />
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
