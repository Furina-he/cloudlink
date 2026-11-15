// 编辑资料的公共字段（服务器/CLI）；动态记录用 RHF 与既有排序组件，不叠加编辑弹窗。
import { GripVerticalIcon, PlusIcon, XIcon } from "lucide-react"
import { useFieldArray, useFormContext } from "react-hook-form"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field"
import { Item, ItemActions, ItemContent } from "@/components/ui/item"
import { Textarea } from "@/components/ui/textarea"
import { copy } from "@/lib/copy"
import type { ProfileFormValues } from "@/lib/schemas"
import { NameField } from "./sections/BasicSection"
import { shortId } from "./serverForm"
import { SortableList, useSortableRow } from "./SortableList"
import { ValidationError } from "./ValidationError"

export function BasicProfileFields() {
  const { register } = useFormContext<ProfileFormValues>()
  return (
    <FieldSet className="min-w-0 gap-3">
      <FieldLegend variant="label" className="mb-0 text-xs text-muted-foreground">{copy.detail.editor.basic}</FieldLegend>
      <FieldGroup className="gap-3">
        <NameField />
        <Field>
          <FieldLabel htmlFor="editor-summary">{copy.basic.summary}</FieldLabel>
          <Textarea id="editor-summary" rows={3} {...register("summary")} />
        </Field>
      </FieldGroup>
    </FieldSet>
  )
}

function RuleField({ id, index, onRemove }: { id: string; index: number; onRemove: () => void }) {
  const { register, formState: { errors } } = useFormContext<ProfileFormValues>()
  const { rowProps, handleProps } = useSortableRow(id)
  const error = errors.rules?.[index]?.text
  return (
    <Item render={<li />} {...rowProps} size="xs" className="flex-nowrap items-start rounded-none">
      <Button type="button" variant="ghost" size="icon-xs" aria-label={copy.guardrails.dragAria(index + 1)} {...handleProps}><GripVerticalIcon /></Button>
      <span aria-hidden className="mt-1 w-4 text-right text-xs text-muted-foreground tabular-nums">{index + 1}</span>
      <ItemContent className="min-w-0">
        <Field data-invalid={!!error || undefined}>
          <FieldLabel className="sr-only" htmlFor={`editor-rule-${id}`}>{copy.guardrails.ruleAria(index + 1)}</FieldLabel>
          <Textarea id={`editor-rule-${id}`} rows={2} aria-invalid={!!error || undefined} {...register(`rules.${index}.text`)} />
          <ValidationError error={error} />
        </Field>
      </ItemContent>
      <ItemActions><Button type="button" variant="ghost" size="icon-xs" aria-label={copy.guardrails.removeAria(index + 1)} onClick={onRemove}><XIcon /></Button></ItemActions>
    </Item>
  )
}

export function RulesAndNotesFields() {
  const { control, register } = useFormContext<ProfileFormValues>()
  const { fields, append, remove, move } = useFieldArray({ control, name: "rules", keyName: "key" })
  return (
    <FieldSet className="min-w-0 gap-2">
      <FieldLegend variant="label" className="mb-0 text-xs text-muted-foreground">{copy.detail.editor.rulesNotes}</FieldLegend>
      <div className="divide-y divide-line-2 overflow-hidden rounded-[10px] border border-line">
        <div className="flex items-center justify-between gap-2 px-3 py-2">
          <span className="text-[13px] font-medium">{copy.detail.groups.guardrails}</span>
          <Button type="button" variant="ghost" size="xs" onClick={() => append({ id: shortId("r"), text: "" })}><PlusIcon data-icon="inline-start" />{copy.detail.addRule}</Button>
        </div>
        {fields.length > 0 ? (
          <SortableList ids={fields.map((f) => f.id)} onMove={move}>
            <ol className="divide-y divide-line-2">
              {fields.map((f, i) => <RuleField key={f.key} id={f.id} index={i} onRemove={() => remove(i)} />)}
            </ol>
          </SortableList>
        ) : <p className="px-3 pb-3 text-xs text-muted-foreground">{copy.guardrails.empty}</p>}
        <FieldGroup className="gap-3 px-3 py-3">
          <Field>
            <FieldLabel htmlFor="editor-notes">{copy.detail.rows.notes}</FieldLabel>
            <Textarea id="editor-notes" rows={4} {...register("notes")} />
          </Field>
        </FieldGroup>
      </div>
    </FieldSet>
  )
}
