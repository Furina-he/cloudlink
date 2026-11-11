import { EllipsisIcon, PlusIcon, SearchXIcon, ShieldCheckIcon } from "lucide-react"
import { useState } from "react"
import { Controller, useFieldArray, useFormContext, useWatch } from "react-hook-form"

import type { Service } from "@/bindings"
import { StateBadge } from "@/components/app/StateBadge"
import { Truncate } from "@/components/app/Truncate"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { FieldDescription, FieldLegend, FieldSet } from "@/components/ui/field"
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
import { formatPorts, type ServerFormValues } from "@/lib/schemas"
import { ExportSwitch } from "../ExportSwitch"
import { ServiceDialog } from "../ServiceDialog"

const DASH = <span className="text-muted-foreground">—</span>

/**
 * 服务分段（PRD 6.4）：探测得到的和手动添加的服务；角色、关键是人工标注。
 * 2026-11-10 由 9 列压成 6 列：类型和「手动」写在名称下面，「未发现」「已清洗」跟在名称后面，
 * 「探测」是常态不显示；固定列宽，760 宽窗口里不用横向滚动就能看到「关键」开关
 */
export function ServicesSection() {
  const { control, register } = useFormContext<ServerFormValues>()
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

  return (
    <div className="flex flex-col gap-6">
      <FieldSet className="min-w-0 gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <FieldLegend className="sr-only">{copy.detail.groups.services}</FieldLegend>
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
            <Table className="table-fixed">
              <colgroup>
                <col className="w-[24%]" />
                <col className="w-[16%]" />
                <col className="w-[18%]" />
                <col />
                <col className="w-14" />
                <col className="w-10" />
              </colgroup>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>{copy.services.columns.name}</TableHead>
                  <TableHead>{copy.services.columns.image}</TableHead>
                  <TableHead>{copy.services.columns.ports}</TableHead>
                  <TableHead>{copy.services.columns.role}</TableHead>
                  <TableHead>{copy.services.columns.critical}</TableHead>
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
                      <TableCell>
                        <div className="flex min-w-0 flex-col gap-0.5">
                          <span className="flex min-w-0 items-center gap-1.5">
                            <Truncate text={s.name} className="font-mono text-[0.8125rem]" />
                            {s.sanitized && (
                              <Tooltip>
                                <TooltipTrigger render={<span tabIndex={0} className="shrink-0 rounded-4xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50" />}>
                                  <StateBadge tone="warning" icon={ShieldCheckIcon}>
                                    {copy.services.sanitized}
                                  </StateBadge>
                                </TooltipTrigger>
                                <TooltipContent>{copy.services.sanitizedTip}</TooltipContent>
                              </Tooltip>
                            )}
                            {s.missing && (
                              <Tooltip>
                                <TooltipTrigger render={<span tabIndex={0} className="shrink-0 rounded-4xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50" />}>
                                  <StateBadge tone="warning" icon={SearchXIcon}>
                                    {copy.services.missing}
                                  </StateBadge>
                                </TooltipTrigger>
                                <TooltipContent>{copy.services.missingTip}</TooltipContent>
                              </Tooltip>
                            )}
                          </span>
                          <span className="text-xs text-muted-foreground">{copy.services.meta(copy.services.kind[s.kind], s.source === "manual")}</span>
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{s.image ? <Truncate text={s.image} /> : DASH}</TableCell>
                      <TableCell className="font-mono text-xs">{s.ports.length ? <Truncate text={formatPorts(s.ports)} /> : DASH}</TableCell>
                      <TableCell>
                        <Input
                          className="h-7 w-full"
                          placeholder={copy.services.rolePlaceholder}
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
