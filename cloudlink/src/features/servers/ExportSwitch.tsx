import { Controller, useFormContext } from "react-hook-form"

import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Switch } from "@/components/ui/switch"
import type { ServerFormValues } from "@/lib/schemas"

/** 导出开关（F-105）：开关在左，标签和说明在右 */
export function ExportSwitch({
  name,
  label,
  hint,
}: {
  name: `export.${keyof ServerFormValues["export"]}`
  label: string
  hint: string
}) {
  const { control } = useFormContext<ServerFormValues>()
  const id = `switch-${name.replace(".", "-")}`
  return (
    <Field orientation="horizontal" className="w-auto items-start">
      <Controller
        name={name}
        control={control}
        render={({ field }) => (
          <Switch id={id} checked={field.value} onCheckedChange={field.onChange} aria-describedby={`${id}-hint`} className="mt-0.5" />
        )}
      />
      <div className="flex flex-col gap-0.5">
        <FieldLabel htmlFor={id} className="font-normal">
          {label}
        </FieldLabel>
        <FieldDescription id={`${id}-hint`} className="text-xs">
          {hint}
        </FieldDescription>
      </div>
    </Field>
  )
}
