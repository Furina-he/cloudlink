import { CircleCheckIcon, EyeIcon, GripVerticalIcon, PlusIcon, Trash2Icon } from "lucide-react"
import { useFieldArray, useFormContext, useWatch } from "react-hook-form"

import { Button } from "@/components/ui/button"
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet, FieldTitle } from "@/components/ui/field"
import { InputGroup, InputGroupAddon, InputGroupText, InputGroupTextarea } from "@/components/ui/input-group"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { copy } from "@/lib/copy"
import type { SkillConfigValues } from "@/lib/schemas"
import { shortId } from "@/features/servers/serverForm"
import { SortableList, useSortableRow } from "@/features/servers/SortableList"
import { ValidationError } from "@/features/servers/ValidationError"
import { useUIStore } from "@/stores/ui"

function ConventionRow({ id, index, onRemove }: { id: string; index: number; onRemove: () => void }) {
  const {
    register,
    formState: { errors },
  } = useFormContext<SkillConfigValues>()
  const { rowProps, handleProps } = useSortableRow(id)
  const error = errors.conventions?.[index]?.text
  const n = index + 1

  return (
    <li {...rowProps} className="relative grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2 rounded-lg bg-background data-dragging:z-10">
      <Button type="button" variant="ghost" size="icon-sm" className="mt-1 cursor-grab touch-none text-muted-foreground" aria-label={copy.skillContent.dragAria(n)} {...handleProps}>
        <GripVerticalIcon />
      </Button>
      <div className="flex flex-col gap-1" data-invalid={!!error || undefined}>
        <Textarea rows={2} className="min-h-14" aria-label={copy.skillContent.conventionAria(n)} aria-required aria-invalid={!!error || undefined} {...register(`conventions.${index}.text`)} />
        <ValidationError error={error} />
      </div>
      <Tooltip>
        <TooltipTrigger
          render={<Button type="button" variant="ghost" size="icon-sm" className="mt-1 text-muted-foreground" aria-label={copy.skillContent.removeAria(n)} onClick={onRemove} />}
        >
          <Trash2Icon />
        </TooltipTrigger>
        <TooltipContent>{copy.skillContent.removeAria(n)}</TooltipContent>
      </Tooltip>
    </li>
  )
}

/**
 * 交给 Agent 的内容（PRD 6.6、F-201 AC1）：服务器之间的关系、运维约定、巡检清单入口。
 * 全局内容，不属于任何一台服务器，原文逐字输出；修改后底部出现保存操作条
 */
export function SkillContentSection({ saved }: { saved: boolean }) {
  const { register, control } = useFormContext<SkillConfigValues>()
  // keyName "key"：约定自带 id，排序用领域 id（PRD 7.2 已知的坑第 2 条）
  const { fields, append, remove, move } = useFieldArray({ control, name: "conventions", keyName: "key" })
  const relationships = useWatch({ control, name: "relationships" })

  return (
    <section aria-labelledby="agents-content" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 id="agents-content" className="text-sm font-semibold">
          {copy.skillContent.title}
        </h2>
        {saved && (
          <span role="status" className="flex items-center gap-1 text-xs text-success">
            <CircleCheckIcon className="size-3.5" aria-hidden />
            {copy.skillContent.saved}
          </span>
        )}
      </div>
      <p className="text-sm text-muted-foreground">{copy.skillContent.hint}</p>
      <FieldGroup className="gap-6">
        <Field>
          <FieldLabel htmlFor="skill-relationships">{copy.skillContent.relationships}</FieldLabel>
          <InputGroup>
            <InputGroupTextarea id="skill-relationships" rows={3} aria-describedby="skill-relationships-hint skill-relationships-count" {...register("relationships")} />
            <InputGroupAddon align="block-end">
              <InputGroupText id="skill-relationships-count" className="ml-auto text-xs tabular-nums">
                {copy.basic.chars(relationships.length)}
              </InputGroupText>
            </InputGroupAddon>
          </InputGroup>
          <FieldDescription id="skill-relationships-hint">{copy.skillContent.relationshipsHint}</FieldDescription>
        </Field>

        <FieldSet className="min-w-0 gap-3">
          <div>
            <FieldLegend variant="label" className="mb-0.5">
              {copy.skillContent.conventions}
            </FieldLegend>
            <FieldDescription>{copy.skillContent.conventionsHint}</FieldDescription>
          </div>
          {fields.length > 0 ? (
            <SortableList ids={fields.map((f) => f.id)} onMove={move}>
              <ol className="flex flex-col gap-2">
                {fields.map((f, i) => (
                  <ConventionRow key={f.key} id={f.id} index={i} onRemove={() => remove(i)} />
                ))}
              </ol>
            </SortableList>
          ) : (
            <p className="rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground">{copy.skillContent.conventionsEmpty}</p>
          )}
          <div>
            <Button type="button" variant="outline" size="sm" onClick={() => append({ id: shortId("c"), text: "" })}>
              <PlusIcon data-icon="inline-start" />
              {copy.skillContent.addConvention}
            </Button>
          </div>
        </FieldSet>

        <Field orientation="horizontal">
          <FieldContent>
            <FieldTitle>{copy.skillContent.healthCheck}</FieldTitle>
            <FieldDescription>{copy.skillContent.healthCheckHint}</FieldDescription>
          </FieldContent>
          <Button type="button" variant="outline" size="sm" onClick={() => useUIStore.getState().openPreview({ file: "references/health-check.md" })}>
            <EyeIcon data-icon="inline-start" />
            {copy.skillContent.viewHealthCheck}
          </Button>
        </Field>
      </FieldGroup>
    </section>
  )
}
