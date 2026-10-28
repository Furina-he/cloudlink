import { EllipsisIcon, PlusIcon, SearchXIcon, ShieldCheckIcon } from "lucide-react"
import { useState } from "react"
import { Controller, useFieldArray, useFormContext, useWatch } from "react-hook-form"

import type { Asset, Service } from "@/bindings"
import { StateBadge } from "@/components/app/StateBadge"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Field, FieldDescription, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { copy } from "@/lib/copy"
import { formatPorts, type AssetFormValues } from "@/lib/schemas"
import { ServiceDialog } from "../ServiceDialog"

const DASH = <span className="text-muted-foreground">—</span>

/** 导出开关：标签在右，说明在下（服务页上方两个） */
function ExportSwitch({
  name,
  label,
  hint,
}: {
  name: "export.image" | "export.listeningPorts"
  label: string
  hint: string
}) {
  const { control } = useFormContext<AssetFormValues>()
  const id = `switch-${name.replace(".", "-")}`
  return (
    <Field orientation="horizontal" className="w-auto items-start">
      <Controller
        name={name}
        control={control}
        render={({ field }) => (
          <Switch
            id={id}
            checked={field.value}
            onCheckedChange={field.onChange}
            aria-describedby={`${id}-hint`}
            className="mt-0.5"
          />
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

export function ServicesTab({ asset }: { asset: Asset | undefined }) {
  const { control, register } = useFormContext<AssetFormValues>()
  const { fields, append, update, remove } = useFieldArray({ control, name: "services", keyName: "key" })
  const services = useWatch({ control, name: "services" })
  // 每次打开对话框换一个 session，表单从头来；关闭时保留 key，退场动画照常播放
  const [dialog, setDialog] = useState<{ open: boolean; index: number | null; session: number }>({
    open: false,
    index: null,
    session: 0,
  })
  const openDialog = (index: number | null) =>
    setDialog((d) => ({ open: true, index, session: d.session + 1 }))
  const editing = dialog.index === null ? undefined : services[dialog.index]
  const others = services.filter((_, i) => i !== dialog.index)

  const submit = (draft: Pick<Service, "kind" | "name" | "image" | "ports" | "role" | "critical">) => {
    if (dialog.index === null) append({ ...draft, source: "manual", missing: false })
    else update(dialog.index, { ...services[dialog.index], ...draft })
  }

  const listening = asset?.listeningPorts ?? []

  return (
    <div className="flex flex-col gap-6">
      <FieldSet className="min-w-0 gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <FieldLegend variant="label" className="mb-0.5">
              {copy.services.title}
            </FieldLegend>
            <FieldDescription>{copy.services.hint}</FieldDescription>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => openDialog(null)}>
            <PlusIcon data-icon="inline-start" />
            {copy.services.add}
          </Button>
        </div>
        <ExportSwitch name="export.image" label={copy.services.exportImage} hint={copy.services.exportImageHint} />

        {fields.length > 0 ? (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>{copy.services.columns.name}</TableHead>
                  <TableHead>{copy.services.columns.kind}</TableHead>
                  <TableHead>{copy.services.columns.image}</TableHead>
                  <TableHead>{copy.services.columns.ports}</TableHead>
                  <TableHead>{copy.services.columns.role}</TableHead>
                  <TableHead>{copy.services.columns.critical}</TableHead>
                  <TableHead>{copy.services.columns.source}</TableHead>
                  <TableHead>{copy.services.columns.status}</TableHead>
                  <TableHead>
                    <span className="sr-only">{copy.services.columns.actions}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {fields.map((f, i) => {
                  const s = services[i] ?? f
                  return (
                    <TableRow key={f.key}>
                      <TableCell className="font-mono text-[0.8125rem]">
                        <span className="flex items-center gap-1.5">
                          {s.name}
                          {s.sanitized && (
                            <Tooltip>
                              <TooltipTrigger render={<span tabIndex={0} className="rounded-4xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50" />}>
                                <StateBadge tone="warning" icon={ShieldCheckIcon} className="font-sans">
                                  {copy.services.sanitized}
                                </StateBadge>
                              </TooltipTrigger>
                              <TooltipContent>{copy.services.sanitizedTip}</TooltipContent>
                            </Tooltip>
                          )}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">{copy.services.kind[s.kind]}</Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{s.image || DASH}</TableCell>
                      <TableCell className="font-mono text-xs">{s.ports.length ? formatPorts(s.ports) : DASH}</TableCell>
                      <TableCell>
                        <Input
                          className="h-7 min-w-28"
                          aria-label={copy.services.roleAria(s.name)}
                          {...register(`services.${i}.role`)}
                        />
                      </TableCell>
                      <TableCell>
                        <Controller
                          name={`services.${i}.critical`}
                          control={control}
                          render={({ field }) => (
                            <Switch
                              size="sm"
                              checked={field.value}
                              onCheckedChange={field.onChange}
                              aria-label={copy.services.criticalAria(s.name)}
                            />
                          )}
                        />
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{copy.services.source[s.source]}</Badge>
                      </TableCell>
                      <TableCell>
                        {s.missing ? (
                          <Tooltip>
                            <TooltipTrigger render={<span tabIndex={0} className="rounded-4xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50" />}>
                              <StateBadge tone="warning" icon={SearchXIcon}>
                                {copy.services.missing}
                              </StateBadge>
                            </TooltipTrigger>
                            <TooltipContent>{copy.services.missingTip}</TooltipContent>
                          </Tooltip>
                        ) : (
                          DASH
                        )}
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-xs"
                                aria-label={copy.services.rowActions(s.name)}
                              />
                            }
                          >
                            <EllipsisIcon />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {s.source === "manual" && (
                              <DropdownMenuItem onClick={() => openDialog(i)}>{copy.services.edit}</DropdownMenuItem>
                            )}
                            <DropdownMenuItem variant="destructive" onClick={() => remove(i)}>
                              {copy.services.remove}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        ) : (
          <p className="rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground">
            {copy.services.empty}
          </p>
        )}
      </FieldSet>

      <FieldSet className="min-w-0 gap-3">
        <FieldLegend variant="label" className="mb-0">
          {copy.services.listening}
        </FieldLegend>
        <ExportSwitch
          name="export.listeningPorts"
          label={copy.services.exportListening}
          hint={copy.services.exportListeningHint}
        />
        {listening.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5">
            {listening.map((p) => (
              <li key={`${p.addr}:${p.port}/${p.proto}`}>
                <Badge variant="outline" className="font-mono">
                  {p.addr}:{p.port}/{p.proto}
                </Badge>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{copy.services.listeningEmpty}</p>
        )}
      </FieldSet>

      <ServiceDialog
        key={dialog.session}
        open={dialog.open}
        onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
        editing={editing}
        others={others}
        onSubmit={submit}
      />
    </div>
  )
}
