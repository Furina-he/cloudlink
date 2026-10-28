import {
  ChevronRightIcon,
  EyeIcon,
  GripVerticalIcon,
  PlusIcon,
  ShieldAlertIcon,
  Trash2Icon,
  WrenchIcon,
} from "lucide-react"
import { Controller, useFieldArray, useFormContext } from "react-hook-form"

import type { Mode } from "@/bindings"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from "@/components/ui/field"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { copy } from "@/lib/copy"
import type { AssetFormValues } from "@/lib/schemas"
import { shortId } from "../assetForm"
import { SortableList, useSortableRow } from "../SortableList"
import { ValidationError } from "../ValidationError"

const MODES: { mode: Mode; icon: typeof EyeIcon }[] = [
  { mode: "read-only", icon: EyeIcon },
  { mode: "standard", icon: WrenchIcon },
]

function RuleRow({ id, index, onRemove }: { id: string; index: number; onRemove: () => void }) {
  const {
    register,
    formState: { errors },
  } = useFormContext<AssetFormValues>()
  const { rowProps, handleProps } = useSortableRow(id)
  const error = errors.rules?.[index]?.text
  const n = index + 1

  return (
    <li
      {...rowProps}
      className="relative grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2 rounded-lg bg-background data-dragging:z-10"
    >
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="mt-1 cursor-grab touch-none text-muted-foreground"
        aria-label={copy.guardrails.dragAria(n)}
        {...handleProps}
      >
        <GripVerticalIcon />
      </Button>
      <div className="flex flex-col gap-1" data-invalid={!!error || undefined}>
        <Textarea
          rows={2}
          className="min-h-14"
          aria-label={copy.guardrails.ruleAria(n)}
          aria-required
          aria-invalid={!!error || undefined}
          {...register(`rules.${index}.text`)}
        />
        <ValidationError error={error} />
      </div>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="mt-1 text-muted-foreground"
              aria-label={copy.guardrails.removeAria(n)}
              onClick={onRemove}
            />
          }
        >
          <Trash2Icon />
        </TooltipTrigger>
        <TooltipContent>{copy.guardrails.removeAria(n)}</TooltipContent>
      </Tooltip>
    </li>
  )
}

export function GuardrailsTab() {
  const { control } = useFormContext<AssetFormValues>()
  // keyName "key"：领域数据自带 id，不能被 RHF 覆盖；排序用领域 id（PRD 7.2 已知的坑第 2 条）
  const { fields, append, remove, move } = useFieldArray({ control, name: "rules", keyName: "key" })
  const ids = fields.map((f) => f.id)

  return (
    <FieldGroup className="gap-6">
      <Alert>
        <ShieldAlertIcon className="text-warning!" />
        <AlertTitle>{copy.guardrails.advisoryTitle}</AlertTitle>
        <AlertDescription>{copy.guardrails.advisoryDescription}</AlertDescription>
      </Alert>

      <FieldSet className="min-w-0 gap-3">
        <div>
          <FieldLegend variant="label" className="mb-0.5">
            {copy.guardrails.defaultMode}
          </FieldLegend>
          <FieldDescription>{copy.guardrails.defaultModeHint}</FieldDescription>
        </div>
        <Controller
          name="defaultMode"
          control={control}
          render={({ field }) => (
            <RadioGroup
              value={field.value}
              onValueChange={(v) => field.onChange(v as Mode)}
              className="grid gap-3 @md/field-group:grid-cols-2"
            >
              {MODES.map(({ mode, icon: Icon }) => (
                <FieldLabel key={mode} htmlFor={`mode-${mode}`}>
                  <Field orientation="horizontal">
                    <RadioGroupItem value={mode} id={`mode-${mode}`} />
                    <FieldContent>
                      <FieldTitle>
                        <Icon className="size-4" aria-hidden />
                        {copy.mode[mode]}
                      </FieldTitle>
                      <FieldDescription>{copy.guardrails.modeDescription[mode]}</FieldDescription>
                    </FieldContent>
                  </Field>
                </FieldLabel>
              ))}
            </RadioGroup>
          )}
        />
      </FieldSet>

      <FieldSet className="min-w-0 gap-3">
        <div>
          <FieldLegend variant="label" className="mb-0.5">
            {copy.guardrails.custom}
          </FieldLegend>
          <FieldDescription>{copy.guardrails.customHint}</FieldDescription>
        </div>
        {fields.length > 0 ? (
          <SortableList ids={ids} onMove={move}>
            <ol className="flex flex-col gap-2">
              {fields.map((f, i) => (
                <RuleRow key={f.key} id={f.id} index={i} onRemove={() => remove(i)} />
              ))}
            </ol>
          </SortableList>
        ) : (
          <p className="rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground">
            {copy.guardrails.empty}
          </p>
        )}
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => append({ id: shortId("r"), text: "" })}
          >
            <PlusIcon data-icon="inline-start" />
            {copy.guardrails.add}
          </Button>
        </div>
      </FieldSet>

      <Collapsible className="flex flex-col gap-2">
        <CollapsibleTrigger
          render={<Button type="button" variant="ghost" size="sm" className="group/builtin -ml-2 w-fit" />}
        >
          <ChevronRightIcon
            data-icon="inline-start"
            className="transition-transform group-aria-expanded/builtin:rotate-90"
          />
          {copy.guardrails.builtin(copy.guardrails.builtinRules.length)}
        </CollapsibleTrigger>
        <CollapsibleContent className="h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-200 data-ending-style:h-0 data-starting-style:h-0">
          <ol className="flex list-decimal flex-col gap-3 rounded-lg border bg-muted/50 py-3 pr-3 pl-8 text-sm">
            {copy.guardrails.builtinRules.map((r) => (
              <li key={r.text}>
                <p lang="en">{r.text}</p>
                <p className="text-muted-foreground">{r.note}</p>
              </li>
            ))}
          </ol>
        </CollapsibleContent>
      </Collapsible>
    </FieldGroup>
  )
}
