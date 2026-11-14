import { CheckIcon, PlusIcon, XIcon } from "lucide-react"
import { Controller, useFieldArray, useFormContext, useWatch } from "react-hook-form"
import type { Service } from "@/bindings"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Item, ItemContent } from "@/components/ui/item"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { copy } from "@/lib/copy"
import { formatPorts, type ServerFormValues } from "@/lib/schemas"
import { ValidationError } from "../ValidationError"

/** 详情只展示事实和人工标注；编辑在资料弹窗，不在表格里即输即存（P8 D6）。 */
export function ServiceInventory({ services }: { services: Service[] }) {
  if (!services.length) return <p className="text-xs text-muted-foreground">{copy.services.empty}</p>
  return (
    <Table className="table-fixed [&_td]:whitespace-normal">
      <colgroup><col className="w-[25%]" /><col className="w-[18%]" /><col className="w-[19%]" /><col /><col className="w-12" /></colgroup>
      <TableHeader><TableRow>
        <TableHead>{copy.services.columns.name}</TableHead><TableHead>{copy.services.columns.image}</TableHead><TableHead>{copy.services.columns.ports}</TableHead><TableHead>{copy.services.columns.role}</TableHead><TableHead>{copy.services.columns.critical}</TableHead>
      </TableRow></TableHeader>
      <TableBody>{services.map((s) => <TableRow key={`${s.kind}:${s.name}`}>
        <TableCell><div className="flex flex-col gap-0.5"><span className="font-mono text-xs wrap-anywhere">{s.name}</span><span className="text-xs text-muted-foreground">{copy.services.meta(copy.services.kind[s.kind], s.source === "manual")}{s.missing ? ` · ${copy.services.missing}` : ""}{s.sanitized ? ` · ${copy.services.sanitized}` : ""}</span></div></TableCell>
        <TableCell className="font-mono text-xs wrap-anywhere">{s.image || "—"}</TableCell>
        <TableCell className="font-mono text-xs wrap-anywhere">{s.ports.length ? formatPorts(s.ports) : "—"}</TableCell>
        <TableCell className="text-xs wrap-anywhere">{s.role || "—"}</TableCell>
        <TableCell>{s.critical ? <CheckIcon className="size-3.5" aria-label={copy.services.columns.critical} /> : "—"}</TableCell>
      </TableRow>)}</TableBody>
    </Table>
  )
}

/** 统一草稿：探测事实只读，人工角色/关键可改，手工记录仍可维护类型、镜像和端口。 */
export function ServicesSection() {
  const { control, register, formState: { errors } } = useFormContext<ServerFormValues>()
  const { fields, append, remove } = useFieldArray({ control, name: "services", keyName: "key" })
  const services = useWatch({ control, name: "services" })
  return (
    <FieldSet className="min-w-0 gap-2">
      <div className="flex items-center justify-between gap-2">
        <FieldLegend variant="label" className="mb-0">{copy.detail.groups.services}</FieldLegend>
        <Button type="button" variant="ghost" size="xs" onClick={() => append({ kind: "docker", name: "", image: "", ports: [], portsText: "", role: "", critical: false, source: "manual", missing: false }, { focusName: `services.${fields.length}.name` })}><PlusIcon data-icon="inline-start" />{copy.services.add}</Button>
      </div>
      {fields.length > 0 ? <div className="divide-y divide-line-2">
        {fields.map((f, i) => {
          const s = services[i] ?? f, error = errors.services?.[i]
          return (
            <Item key={f.key} size="xs" className="items-stretch px-0">
              <ItemContent className="min-w-0">
                <FieldGroup className="gap-3">
                  <FieldGroup className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto] items-start gap-3">
                    {s.source === "manual" ? <Field data-invalid={!!error?.name || undefined}>
                      <FieldLabel htmlFor={`editor-service-${f.key}`}>{copy.serviceDialog.name}</FieldLabel>
                      <Input id={`editor-service-${f.key}`} className="font-mono" aria-invalid={!!error?.name || undefined} {...register(`services.${i}.name`)} />
                      <ValidationError error={error?.name} />
                    </Field> : <div className="flex flex-col gap-0.5 pt-6"><span className="font-mono text-xs wrap-anywhere">{s.name}</span><span className="text-xs text-muted-foreground">{copy.services.kind[s.kind]}{s.missing ? ` · ${copy.services.missing}` : ""}</span></div>}
                    <Field><FieldLabel htmlFor={`editor-role-${f.key}`}>{copy.serviceDialog.role}</FieldLabel><Input id={`editor-role-${f.key}`} {...register(`services.${i}.role`)} /></Field>
                    <Field className="w-auto gap-2"><FieldLabel htmlFor={`editor-critical-${f.key}`}>{copy.services.columns.critical}</FieldLabel><Controller name={`services.${i}.critical`} control={control} render={({ field }) => <Switch id={`editor-critical-${f.key}`} checked={field.value} onCheckedChange={field.onChange} aria-label={copy.services.criticalAria(s.name)} />} /></Field>
                    <Button type="button" variant="ghost" size="icon-xs" className="mt-5" aria-label={copy.services.removeRecord(s.name, i + 1)} onClick={() => remove(i)}><XIcon /></Button>
                  </FieldGroup>
                  {s.source === "manual" && <FieldGroup className="grid grid-cols-[6.5rem_minmax(0,1fr)_minmax(0,1fr)] items-start gap-3">
                    <Field><FieldLabel htmlFor={`editor-kind-${f.key}`}>{copy.serviceDialog.kind}</FieldLabel><Controller name={`services.${i}.kind`} control={control} render={({ field }) => <Select value={field.value} onValueChange={(v) => v && field.onChange(v)}><SelectTrigger id={`editor-kind-${f.key}`} size="sm"><SelectValue>{copy.services.kind[field.value]}</SelectValue></SelectTrigger><SelectContent><SelectGroup>{(["docker", "systemd"] as const).map((k) => <SelectItem key={k} value={k}>{copy.services.kind[k]}</SelectItem>)}</SelectGroup></SelectContent></Select>} /></Field>
                    <Field><FieldLabel htmlFor={`editor-image-${f.key}`}>{copy.serviceDialog.image}</FieldLabel><Input id={`editor-image-${f.key}`} className="font-mono" spellCheck={false} {...register(`services.${i}.image`)} /></Field>
                    <Field data-invalid={!!error?.portsText || undefined}><FieldLabel htmlFor={`editor-ports-${f.key}`}>{copy.serviceDialog.ports}</FieldLabel><Input id={`editor-ports-${f.key}`} className="font-mono" aria-invalid={!!error?.portsText || undefined} {...register(`services.${i}.portsText`)} /><FieldDescription>{copy.serviceDialog.portsHint}</FieldDescription><ValidationError error={error?.portsText} /></Field>
                  </FieldGroup>}
                </FieldGroup>
              </ItemContent>
            </Item>
          )
        })}
      </div> : <p className="text-xs text-muted-foreground">{copy.services.empty}</p>}
    </FieldSet>
  )
}
