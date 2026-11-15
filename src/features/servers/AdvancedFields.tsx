import { CopyIcon } from "lucide-react"
import { useMemo, type ReactNode } from "react"
import { Controller, useFormContext, useWatch } from "react-hook-form"
import { CreatableCombobox } from "@/components/app/CreatableCombobox"
import { FoldRow } from "@/components/app/SettingsList"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { toast } from "@/components/ui/toast"
import { copy } from "@/lib/copy"
import type { AliasContext, ServerFormValues } from "@/lib/schemas"
import { Required } from "./Required"
import { useAvailableEnvs } from "./useServerForm"
import { ValidationError } from "./ValidationError"

function ProxyJumpField({ ctx }: { ctx: AliasContext }) {
  const { control } = useFormContext<ServerFormValues>()
  const alias = useWatch({ control, name: "alias" })
  const jumpOptions = useMemo(() => [...new Set([...ctx.taken, ...ctx.sshHosts.map((h) => h.alias)])].sort().map((a) => ({ value: a, label: a })), [ctx])
  return (
    <Field>
      <FieldLabel htmlFor="server-proxy-jump">{copy.serverForm.proxyJump}<span className="font-normal text-muted-foreground">{copy.common.optional}</span></FieldLabel>
      <Controller name="connection.proxyJump" control={control} render={({ field }) => <CreatableCombobox id="server-proxy-jump" value={field.value} onChange={field.onChange} onBlur={field.onBlur} inputRef={field.ref} options={jumpOptions.filter((o) => o.value !== alias.trim())} placeholder={copy.serverForm.proxyJumpPlaceholder} describedBy="server-proxy-jump-hint" inputClassName="font-mono" clearable />} />
      <FieldDescription id="server-proxy-jump-hint">{copy.serverForm.proxyJumpHint}</FieldDescription>
    </Field>
  )
}

function EnvsField() {
  const { control, formState: { errors } } = useFormContext<ServerFormValues>()
  const envs = useAvailableEnvs()
  const error = errors.connection?.definedIn
  return (
    <FieldSet className="min-w-0 gap-2" data-invalid={!!error || undefined}>
      <FieldLegend variant="label" className="mb-0">{copy.serverForm.envs} <Required /></FieldLegend>
      <FieldDescription>{copy.serverForm.envsHint}</FieldDescription>
      <Controller name="connection.definedIn" control={control} render={({ field }) => <div className="flex flex-wrap gap-x-4 gap-y-2">{envs.map((env, i) => {
        const id = `server-env-${i}`, checked = field.value.includes(env.id)
        return <Field key={env.id} orientation="horizontal" className="w-auto"><Checkbox id={id} ref={i === 0 ? field.ref : undefined} checked={checked} aria-invalid={!!error || undefined} onCheckedChange={(on) => field.onChange(on ? [...field.value, env.id] : field.value.filter((x) => x !== env.id))} /><FieldLabel htmlFor={id} className="font-normal">{copy.env.long(env.id)}</FieldLabel></Field>
      })}</div>} />
      <ValidationError error={error} />
    </FieldSet>
  )
}

/** 高级里的稳定 SSH 别名；复制或修改不联动显示名称（P8 D7）。 */
export function AliasField({ editing = false }: { editing?: boolean }) {
  const { register, getValues, formState: { errors } } = useFormContext<ServerFormValues>()
  const copyAlias = () => void navigator.clipboard.writeText(getValues("alias")).then(() => toast.add({ title: copy.detail.aliasCopied(getValues("alias")) })).catch(() => toast.add({ title: copy.detail.aliasCopyFailed, type: "warning" }))
  return (
    <Field data-invalid={!!errors.alias || undefined}>
      <FieldLabel htmlFor="server-alias">{copy.create.aliasLabel} <Required /></FieldLabel>
      <div className="flex items-center gap-2"><Input id="server-alias" aria-required aria-invalid={!!errors.alias || undefined} aria-describedby="server-alias-hint" className="font-mono" spellCheck={false} autoComplete="off" {...register("alias")} />{editing && <Button type="button" variant="outline" size="icon-sm" aria-label={copy.detail.copyAlias} onClick={copyAlias}><CopyIcon /></Button>}</div>
      <FieldDescription id="server-alias-hint">{editing ? copy.create.aliasChangedHint : copy.create.aliasHint}</FieldDescription>
      <ValidationError error={errors.alias} />
    </Field>
  )
}

export function AdvancedExtras({ ctx }: { ctx: AliasContext }) {
  return <FieldGroup className="gap-4 px-3.5 py-3"><AliasField /><ProxyJumpField ctx={ctx} /><EnvsField /></FieldGroup>
}

export function AdvancedFields({ open, onOpenChange, ctx, children }: { open: boolean; onOpenChange: (open: boolean) => void; ctx: AliasContext; children?: ReactNode }) {
  return <div className="overflow-hidden rounded-[10px] border border-line"><FoldRow label={copy.connection.advanced} hint={copy.create.advancedHint} open={open} onOpenChange={onOpenChange} plain><FieldGroup className="gap-4 px-3.5 py-3"><AliasField editing /><ProxyJumpField ctx={ctx} /><EnvsField />{children}</FieldGroup></FoldRow></div>
}
