import { ChevronDownIcon, GripVerticalIcon, LayoutTemplateIcon, PlusIcon, Trash2Icon } from "lucide-react"
import { useFieldArray, useFormContext, useWatch } from "react-hook-form"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { FieldDescription, FieldLegend, FieldSet } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { copy } from "@/lib/copy"
import { PANEL_TEMPLATES } from "@/lib/panelTemplates"
import type { AssetFormValues } from "@/lib/schemas"
import { shortId } from "../assetForm"
import { SortableList, useSortableRow } from "../SortableList"
import { ValidationError } from "../ValidationError"

function PathRow({ id, index, onRemove }: { id: string; index: number; onRemove: () => void }) {
  const {
    register,
    formState: { errors },
  } = useFormContext<AssetFormValues>()
  const { rowProps, handleProps } = useSortableRow(id)
  const rowErrors = errors.paths?.[index]
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
        className="mt-0.5 cursor-grab touch-none text-muted-foreground"
        aria-label={copy.paths.dragAria(n)}
        {...handleProps}
      >
        <GripVerticalIcon />
      </Button>
      <div className="grid gap-1.5 @lg/paths:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] @lg/paths:gap-2">
      <div className="flex flex-col gap-1" data-invalid={!!rowErrors?.label || undefined}>
        <Input
          aria-label={copy.paths.labelAria(n)}
          aria-required
          aria-invalid={!!rowErrors?.label || undefined}
          placeholder={copy.paths.label}
          {...register(`paths.${index}.label`)}
        />
        <ValidationError error={rowErrors?.label} />
      </div>
      <div className="flex flex-col gap-1" data-invalid={!!rowErrors?.path || undefined}>
        <Input
          aria-label={copy.paths.pathAria(n)}
          aria-required
          aria-invalid={!!rowErrors?.path || undefined}
          placeholder={copy.paths.path}
          className="font-mono"
          spellCheck={false}
          {...register(`paths.${index}.path`)}
        />
        <ValidationError error={rowErrors?.path} />
      </div>
      </div>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="mt-0.5 text-muted-foreground"
              aria-label={copy.paths.removeAria(n)}
              onClick={onRemove}
            />
          }
        >
          <Trash2Icon />
        </TooltipTrigger>
        <TooltipContent>{copy.paths.removeAria(n)}</TooltipContent>
      </Tooltip>
    </li>
  )
}

export function PathsTab() {
  const { control } = useFormContext<AssetFormValues>()
  // keyName "key"：RHF 生成的行 id 放在 fields[i].key，作为 React key 和排序 id（PRD 7.2 已知的坑第 2 条）
  const { fields, append, remove, move } = useFieldArray({ control, name: "paths", keyName: "key" })
  const values = useWatch({ control, name: "paths" })
  const usedKeys = new Set(values.map((p) => p.key))
  const ids = fields.map((f) => f.key)

  return (
    <FieldSet className="@container/paths min-w-0 gap-3">
      <div>
        <FieldLegend variant="label" className="mb-0.5">
          {copy.paths.title}
        </FieldLegend>
        <FieldDescription>{copy.paths.hint}</FieldDescription>
      </div>

      {fields.length > 0 ? (
        <>
          <div
            aria-hidden
            className="hidden grid-cols-[2rem_minmax(0,2fr)_minmax(0,3fr)_2rem] gap-2 text-xs font-medium text-muted-foreground @lg/paths:grid"
          >
            <span />
            <span>{copy.paths.label}</span>
            <span>{copy.paths.path}</span>
            <span />
          </div>
          <SortableList ids={ids} onMove={move}>
            <ol className="flex flex-col gap-2">
              {fields.map((f, i) => (
                <PathRow key={f.key} id={f.key} index={i} onRemove={() => remove(i)} />
              ))}
            </ol>
          </SortableList>
        </>
      ) : (
        <p className="rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground">
          {copy.paths.empty}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => append({ key: shortId("path"), label: "", path: "", source: "manual" })}
        >
          <PlusIcon data-icon="inline-start" />
          {copy.paths.add}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button type="button" variant="outline" size="sm" />}>
            <LayoutTemplateIcon data-icon="inline-start" />
            {copy.paths.fromTemplate}
            <ChevronDownIcon data-icon="inline-end" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-auto min-w-72">
            {PANEL_TEMPLATES.map((tpl, gi) => (
              <DropdownMenuGroup key={tpl.id}>
                {gi > 0 && <DropdownMenuSeparator />}
                <DropdownMenuLabel>{copy.panelTemplate[tpl.id]}</DropdownMenuLabel>
                {tpl.paths.map((p) => {
                  const added = usedKeys.has(p.key)
                  return (
                    <DropdownMenuItem
                      key={p.key}
                      disabled={added}
                      onClick={() =>
                        append({ key: p.key, label: copy.pathTemplates[p.key], path: p.path, source: "manual" })
                      }
                      className="flex-col items-start gap-0"
                    >
                      <span className="flex w-full items-center gap-2">
                        {copy.pathTemplates[p.key]}
                        {added && (
                          <span className="ml-auto text-xs text-muted-foreground">{copy.paths.added}</span>
                        )}
                      </span>
                      <span className="font-mono text-xs text-muted-foreground">{p.path}</span>
                    </DropdownMenuItem>
                  )
                })}
              </DropdownMenuGroup>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <FieldDescription>{copy.paths.templateHint}</FieldDescription>
    </FieldSet>
  )
}
