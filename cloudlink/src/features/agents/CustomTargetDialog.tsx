import { zodResolver } from "@hookform/resolvers/zod"
import { FolderOpenIcon } from "lucide-react"
import { useState } from "react"
import { Controller, useForm } from "react-hook-form"

import type { EnvId, IpcError } from "@/bindings"
import { DiscardChangesDialog } from "@/components/app/DiscardChangesDialog"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "@/components/ui/toast"
import { copy, ipcErrorText } from "@/lib/copy"
import { ipc } from "@/lib/ipc"
import { toEnvPath } from "@/lib/paths"
import { customTargetSchema, type CustomTargetValues } from "@/lib/schemas"
import { Required } from "@/features/servers/Required"
import { useAvailableEnvs } from "@/features/servers/useServerForm"
import { ValidationError } from "@/features/servers/ValidationError"
import { useTargetStore } from "@/stores/targets"

/** 添加自定义目录（F-301 AC）：给其他 Agent 指定一个全局 skills 目录，总 Skill 以受管副本写进去 */
export function CustomTargetDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const envs = useAvailableEnvs()
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const {
    register,
    control,
    handleSubmit,
    setError,
    reset,
    getValues,
    formState: { errors, isDirty, isSubmitting },
  } = useForm<CustomTargetValues>({
    resolver: zodResolver(customTargetSchema),
    defaultValues: { label: "", path: "", envId: envs[0]?.id ?? "windows" },
  })
  const close = () => {
    onOpenChange(false)
    reset()
  }
  const submit = handleSubmit(async (v) => {
    try {
      const t = await useTargetStore.getState().addCustom({ envId: v.envId as EnvId, label: v.label.trim(), path: v.path })
      toast.add({ title: copy.customTarget.added(t.label), type: "success" })
      close()
    } catch (e) {
      const err = e as IpcError
      if (err.id === "target-exists") setError("path", { message: ipcErrorText(err.id, err.params) })
      else toast.add({ title: ipcErrorText(err.id, err.params), type: "error" })
    }
  })

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && isDirty && !isSubmitting) setConfirmDiscard(true)
        else if (!next) close()
      }}
    >
      <DialogContent className="grid-cols-[minmax(0,1fr)] sm:max-w-lg" closeLabel={copy.common.close}>
        <DialogHeader>
          <DialogTitle>{copy.customTarget.title}</DialogTitle>
          <DialogDescription>{copy.customTarget.description}</DialogDescription>
        </DialogHeader>
        <form id="custom-target-form" noValidate onSubmit={submit}>
          <FieldGroup className="gap-4">
            <Field data-invalid={!!errors.label || undefined}>
              <FieldLabel htmlFor="custom-name">
                {copy.customTarget.name} <Required />
              </FieldLabel>
              <Input id="custom-name" aria-required aria-invalid={!!errors.label || undefined} {...register("label")} />
              <ValidationError error={errors.label} />
            </Field>
            <Controller
              control={control}
              name="envId"
              render={({ field }) => (
                <Field>
                  <FieldLabel htmlFor="custom-env">{copy.customTarget.env}</FieldLabel>
                  <Select items={envs.map((e) => ({ value: e.id, label: copy.env.long(e.id) }))} value={field.value} onValueChange={(v) => v && field.onChange(v)}>
                    <SelectTrigger id="custom-env" className="w-56">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {envs.map((e) => (
                        <SelectItem key={e.id} value={e.id}>
                          {copy.env.long(e.id)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              )}
            />
            <Controller
              control={control}
              name="path"
              render={({ field, fieldState }) => (
                <Field data-invalid={!!fieldState.error || undefined}>
                  <FieldLabel htmlFor="custom-path">
                    {copy.customTarget.path} <Required />
                  </FieldLabel>
                  <InputGroup>
                    <InputGroupInput id="custom-path" value={field.value} readOnly aria-required aria-invalid={!!fieldState.error || undefined} className="font-mono" />
                    <InputGroupAddon align="inline-end">
                      <InputGroupButton
                        size="xs"
                        onClick={() => void ipc.pickDirectory().then((p) => typeof p === "string" && field.onChange(toEnvPath(p, getValues("envId") as EnvId)))}
                      >
                        <FolderOpenIcon data-icon="inline-start" />
                        {copy.customTarget.pick}
                      </InputGroupButton>
                    </InputGroupAddon>
                  </InputGroup>
                  <ValidationError error={fieldState.error} />
                </Field>
              )}
            />
          </FieldGroup>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => (isDirty ? setConfirmDiscard(true) : close())}>
            {copy.common.cancel}
          </Button>
          <Button type="submit" form="custom-target-form" disabled={isSubmitting}>
            {isSubmitting && <Spinner data-icon="inline-start" aria-hidden />}
            {copy.customTarget.submit}
          </Button>
        </DialogFooter>
      </DialogContent>
      <DiscardChangesDialog
        open={confirmDiscard}
        onKeep={() => setConfirmDiscard(false)}
        onDiscard={() => {
          setConfirmDiscard(false)
          close()
        }}
      />
    </Dialog>
  )
}
