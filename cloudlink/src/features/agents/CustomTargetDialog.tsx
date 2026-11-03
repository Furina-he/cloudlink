import { zodResolver } from "@hookform/resolvers/zod"
import { FolderOpenIcon } from "lucide-react"
import { useState } from "react"
import { Controller, useForm, useWatch } from "react-hook-form"

import type { EnvId, IpcError } from "@/bindings"
import { AgentMark } from "@/components/app/AgentMark"
import { DiscardChangesDialog } from "@/components/app/DiscardChangesDialog"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "@/components/ui/toast"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { copy, ipcErrorText } from "@/lib/copy"
import { ipc } from "@/lib/ipc"
import { toEnvPath } from "@/lib/paths"
import { customTargetSchema, type CustomTargetValues } from "@/lib/schemas"
import { Required } from "@/features/servers/Required"
import { useAvailableEnvs } from "@/features/servers/useServerForm"
import { ValidationError } from "@/features/servers/ValidationError"
import { useTargetStore } from "@/stores/targets"

const PRESET_AGENTS: { label: string; relPath: string }[] = [
  { label: "Cursor", relPath: ".cursor/skills" },
  { label: "Windsurf", relPath: ".codeium/windsurf/skills" },
  { label: "Gemini CLI", relPath: ".gemini/skills" },
  { label: "GitHub Copilot", relPath: ".copilot/skills" },
  { label: "OpenCode", relPath: ".config/opencode/skills" },
  { label: "Cline", relPath: ".cline/skills" },
  { label: "Roo Code", relPath: ".roo/skills" },
  { label: "Trae", relPath: ".trae/skills" },
]

function joinHome(home: string, envId: EnvId, rel: string): string {
  const sep = envId === "windows" ? "\\" : "/"
  return `${home.replace(/[\\/]+$/, "")}${sep}${rel.replace(/\//g, sep)}`
}

/** 添加自定义目录（F-301 AC）：支持一键选择主流 Agent 预设自动带入官方图标与默认路径，也可手动指定任意目录 */
export function CustomTargetDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const envs = useAvailableEnvs()
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const {
    register,
    control,
    handleSubmit,
    setError,
    setValue,
    reset,
    getValues,
    formState: { errors, isDirty, isSubmitting },
  } = useForm<CustomTargetValues>({
    resolver: zodResolver(customTargetSchema),
    defaultValues: { label: "", path: "", envId: envs[0]?.id ?? "windows" },
  })
  const currentLabel = useWatch({ control, name: "label" })
  const matchedPreset = PRESET_AGENTS.find((p) => p.label.toLowerCase() === currentLabel.trim().toLowerCase())
  const close = () => {
    onOpenChange(false)
    reset()
  }
  const applyPreset = (preset: { label: string; relPath: string }, envId = getValues("envId") as EnvId) => {
    const env = envs.find((e) => e.id === envId) ?? envs[0]
    setValue("label", preset.label, { shouldDirty: true, shouldValidate: true })
    if (env) setValue("path", joinHome(env.home, env.id, preset.relPath), { shouldDirty: true, shouldValidate: true })
  }
  const submit = handleSubmit(async (v) => {
    try {
      const t = await useTargetStore.getState().addCustom({ envId: v.envId as EnvId, label: v.label.trim(), path: v.path.trim() })
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
            <Field>
              <FieldLabel id="custom-presets-label">{copy.customTarget.presets}</FieldLabel>
              <ToggleGroup
                variant="outline"
                size="sm"
                spacing={1}
                value={matchedPreset ? [matchedPreset.label] : []}
                onValueChange={(next) => {
                  const picked = PRESET_AGENTS.find((p) => p.label === next[0])
                  if (picked) applyPreset(picked)
                }}
                aria-labelledby="custom-presets-label"
                className="flex-wrap"
              >
                {PRESET_AGENTS.map((p) => {
                  const active = matchedPreset?.label === p.label
                  return (
                    <ToggleGroupItem key={p.label} value={p.label} className={active ? "text-foreground" : "text-muted-foreground"}>
                      <AgentMark agent="custom" label={p.label} lit={active} />
                      {p.label}
                    </ToggleGroupItem>
                  )
                })}
              </ToggleGroup>
            </Field>
            <Field data-invalid={!!errors.label || undefined}>
              <FieldLabel htmlFor="custom-name">
                {copy.customTarget.name} <Required />
              </FieldLabel>
              <InputGroup>
                <InputGroupAddon>
                  <AgentMark agent="custom" label={currentLabel} lit={!!currentLabel.trim()} />
                </InputGroupAddon>
                <InputGroupInput id="custom-name" aria-required aria-invalid={!!errors.label || undefined} {...register("label")} />
              </InputGroup>
              <ValidationError error={errors.label} />
            </Field>
            <Controller
              control={control}
              name="envId"
              render={({ field }) => (
                <Field>
                  <FieldLabel htmlFor="custom-env">{copy.customTarget.env}</FieldLabel>
                  <Select
                    items={envs.map((e) => ({ value: e.id, label: copy.env.long(e.id) }))}
                    value={field.value}
                    onValueChange={(v) => {
                      if (!v) return
                      field.onChange(v)
                      const matched = PRESET_AGENTS.find((p) => p.label.toLowerCase() === getValues("label").trim().toLowerCase())
                      if (matched) applyPreset(matched, v as EnvId)
                    }}
                  >
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
                    <InputGroupInput
                      id="custom-path"
                      value={field.value}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      aria-required
                      aria-invalid={!!fieldState.error || undefined}
                      className="font-mono"
                    />
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
