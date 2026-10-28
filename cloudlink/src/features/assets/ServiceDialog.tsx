import { zodResolver } from "@hookform/resolvers/zod"
import { useState } from "react"
import { Controller, useForm } from "react-hook-form"

import type { Service } from "@/bindings"
import { DiscardChangesDialog } from "@/components/app/DiscardChangesDialog"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { copy } from "@/lib/copy"
import { formatPorts, parsePorts, serviceDraftSchema, type ServiceDraft } from "@/lib/schemas"
import { Required } from "./tabs/OverviewTab"
import { ValidationError } from "./ValidationError"

const KIND_ITEMS = [
  { value: "docker", label: copy.services.kind.docker },
  { value: "systemd", label: copy.services.kind.systemd },
]

const EMPTY: ServiceDraft = { kind: "docker", name: "", image: "", ports: "", role: "", critical: false }

const draftOf = (s: Service): ServiceDraft => ({
  kind: s.kind,
  name: s.name,
  image: s.image ?? "",
  ports: formatPorts(s.ports),
  role: s.role ?? "",
  critical: s.critical,
})

/** 手动添加或编辑一个服务（PRD 6.4 服务页的「手动添加」）。每次打开由父组件换 key，得到一份新表单 */
export function ServiceDialog({
  open,
  onOpenChange,
  editing,
  others,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 编辑的那一行；新增时为 undefined */
  editing: Service | undefined
  /** 其余服务，用来检查「类型 + 名称」不重复 */
  others: { kind: string; name: string }[]
  onSubmit: (service: Pick<Service, "kind" | "name" | "image" | "ports" | "role" | "critical">) => void
}) {
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const form = useForm<ServiceDraft>({
    resolver: zodResolver(serviceDraftSchema(others)),
    defaultValues: editing ? draftOf(editing) : EMPTY,
    mode: "onBlur",
  })
  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isDirty },
  } = form

  const submit = handleSubmit((d) => {
    onSubmit({
      kind: d.kind,
      name: d.name,
      image: d.image || undefined,
      ports: parsePorts(d.ports) ?? [],
      role: d.role || undefined,
      critical: d.critical,
    })
    onOpenChange(false)
  })

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && isDirty) setConfirmDiscard(true)
        else onOpenChange(next)
      }}
    >
      <DialogContent className="grid-cols-[minmax(0,1fr)] sm:max-w-md" closeLabel={copy.common.close}>
        <DialogHeader>
          <DialogTitle>{editing ? copy.serviceDialog.editTitle : copy.serviceDialog.addTitle}</DialogTitle>
          <DialogDescription>{copy.serviceDialog.description}</DialogDescription>
        </DialogHeader>
        <form id="service-form" noValidate onSubmit={submit}>
          <FieldGroup className="gap-4">
            <Field>
              <FieldLabel htmlFor="service-kind">{copy.serviceDialog.kind}</FieldLabel>
              <Controller
                name="kind"
                control={control}
                render={({ field }) => (
                  <Select items={KIND_ITEMS} value={field.value} onValueChange={(v) => v && field.onChange(v)}>
                    <SelectTrigger id="service-kind" className="w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {KIND_ITEMS.map((k) => (
                        <SelectItem key={k.value} value={k.value}>
                          {k.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>
            <Field data-invalid={!!errors.name || undefined}>
              <FieldLabel htmlFor="service-name">
                {copy.serviceDialog.name} <Required />
              </FieldLabel>
              <Input
                id="service-name"
                className="font-mono"
                aria-required
                aria-invalid={!!errors.name || undefined}
                spellCheck={false}
                autoComplete="off"
                {...register("name")}
              />
              <ValidationError error={errors.name} />
            </Field>
            <Field>
              <FieldLabel htmlFor="service-image">{copy.serviceDialog.image}</FieldLabel>
              <Input
                id="service-image"
                className="font-mono"
                spellCheck={false}
                autoComplete="off"
                aria-describedby="service-image-hint"
                {...register("image")}
              />
              <FieldDescription id="service-image-hint">{copy.serviceDialog.imageHint}</FieldDescription>
            </Field>
            <Field data-invalid={!!errors.ports || undefined}>
              <FieldLabel htmlFor="service-ports">{copy.serviceDialog.ports}</FieldLabel>
              <Input
                id="service-ports"
                className="font-mono"
                spellCheck={false}
                autoComplete="off"
                aria-invalid={!!errors.ports || undefined}
                aria-describedby="service-ports-hint"
                {...register("ports")}
              />
              <FieldDescription id="service-ports-hint">{copy.serviceDialog.portsHint}</FieldDescription>
              <ValidationError error={errors.ports} />
            </Field>
            <Field>
              <FieldLabel htmlFor="service-role">{copy.serviceDialog.role}</FieldLabel>
              <Input id="service-role" {...register("role")} />
            </Field>
            <Field orientation="horizontal">
              <Controller
                name="critical"
                control={control}
                render={({ field }) => (
                  <Switch
                    id="service-critical"
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    aria-describedby="service-critical-hint"
                  />
                )}
              />
              <div className="flex flex-col gap-0.5">
                <FieldLabel htmlFor="service-critical">{copy.serviceDialog.critical}</FieldLabel>
                <FieldDescription id="service-critical-hint">{copy.serviceDialog.criticalHint}</FieldDescription>
              </div>
            </Field>
          </FieldGroup>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => (isDirty ? setConfirmDiscard(true) : onOpenChange(false))}>
            {copy.common.cancel}
          </Button>
          <Button type="submit" form="service-form">
            {editing ? copy.serviceDialog.submitEdit : copy.serviceDialog.submitAdd}
          </Button>
        </DialogFooter>
      </DialogContent>
      <DiscardChangesDialog
        open={confirmDiscard}
        onKeep={() => setConfirmDiscard(false)}
        onDiscard={() => {
          setConfirmDiscard(false)
          onOpenChange(false)
        }}
      />
    </Dialog>
  )
}
