import { useMemo } from "react"
import { Controller, useFormContext } from "react-hook-form"
import { useShallow } from "zustand/react/shallow"

import { CreatableCombobox, CreatableMultiCombobox } from "@/components/app/CreatableCombobox"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { copy } from "@/lib/copy"
import { hostnameError, type ProfileFormValues, type ServerFormValues } from "@/lib/schemas"
import { collectValues, isServer, useAssetStore } from "@/stores/assets"
import { Required } from "../Required"
import { ValidationError } from "../ValidationError"

const toOptions = (values: string[]) => values.map((v) => ({ value: v, label: v }))
const OPTIONAL = <span className="font-normal text-muted-foreground">{copy.common.optional}</span>

/** 名称（两类资源共用）。onChange 在新建时让别名跟随名称 */
/** `optional`：添加服务器时名称可以不填，保存时用地址（与 Termius 的标签一致） */
export function NameField({ onChange, optional = false }: { onChange?: (name: string) => void; optional?: boolean }) {
  const {
    register,
    formState: { errors },
  } = useFormContext<ProfileFormValues>()
  return (
    <Field data-invalid={!!errors.name || undefined}>
      <FieldLabel htmlFor="server-name">
        {copy.basic.name} {optional ? OPTIONAL : <Required />}
      </FieldLabel>
      <Input
        id="server-name"
        aria-required={!optional}
        placeholder={optional ? copy.create.nameFallback : undefined}
        aria-invalid={!!errors.name || undefined}
        {...register("name", { onChange: (e: { target: { value: string } }) => onChange?.(e.target.value) })}
      />
      <ValidationError error={errors.name} />
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
