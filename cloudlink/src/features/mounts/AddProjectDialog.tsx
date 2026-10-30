import { zodResolver } from "@hookform/resolvers/zod"
import { useState } from "react"
import { Controller, useForm } from "react-hook-form"

import type { Convention, IpcError, ProjectInspection } from "@/bindings"
import { DiscardChangesDialog } from "@/components/app/DiscardChangesDialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { toast } from "@/components/ui/toast"
import { Required } from "@/features/assets/tabs/OverviewTab"
import { ValidationError } from "@/features/assets/ValidationError"
import { CONVENTION_DIRS } from "@/lib/agents"
import { copy, ipcErrorText } from "@/lib/copy"
import { ipc, toIpcError } from "@/lib/ipc"
import { projectFormSchema, type ProjectFormValues } from "@/lib/schemas"
import { useTargetStore } from "@/stores/targets"

const CONVENTIONS: Convention[] = ["claude", "agents"]

/**
 * 「添加项目」（PRD 6.10）：先用 plugin-dialog 选目录，再检查它（是否 Git 仓库、已有哪些约定目录、属于哪个运行环境），
 * 然后打开对话框。返回 start（开始流程）与要渲染的 dialog
 */
export function useAddProject() {
  const [inspection, setInspection] = useState<ProjectInspection | null>(null)

  const start = async () => {
    const path = await ipc.pickDirectory()
    if (typeof path !== "string") return
    try {
      setInspection(await ipc.inspectProject(path))
    } catch (e) {
      const err = toIpcError(e)
      toast.add({ title: ipcErrorText(err.id, err.params), type: "error" })
    }
  }

  const dialog = inspection && (
    <AddProjectDialog key={inspection.path} inspection={inspection} onClose={() => setInspection(null)} />
  )
  return { start, dialog }
}

function AddProjectDialog({ inspection, onClose }: { inspection: ProjectInspection; onClose: () => void }) {
  const [open, setOpen] = useState(true)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors, isDirty, isSubmitting },
  } = useForm<ProjectFormValues>({
    resolver: zodResolver(projectFormSchema),
    defaultValues: {
      label: inspection.name,
      // 按仓库里已存在的目录预先勾选；一个都没有时两个都勾上
      conventions: inspection.existingConventions.length ? inspection.existingConventions : CONVENTIONS,
      gitExclude: inspection.isGitRepo,
    },
  })

  const close = () => setOpen(false)
  const submit = handleSubmit(async (values) => {
    try {
      const t = await useTargetStore.getState().addProject({
        path: inspection.path,
        label: values.label.trim(),
        conventions: values.conventions,
        gitExclude: inspection.isGitRepo && values.gitExclude,
      })
      toast.add({ title: copy.addProject.added(t.label), type: "success" })
      close()
    } catch (e) {
      const err = e as IpcError
      if (err.id === "target-exists") setError("label", { message: ipcErrorText(err.id, err.params) })
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
      onOpenChangeComplete={(next) => !next && onClose()}
    >
      <DialogContent className="grid-cols-[minmax(0,1fr)] sm:max-w-lg" closeLabel={copy.common.close}>
        <DialogHeader>
          <DialogTitle>{copy.addProject.title}</DialogTitle>
          <DialogDescription>{copy.addProject.description}</DialogDescription>
        </DialogHeader>
        <form id="add-project-form" noValidate onSubmit={submit}>
          <FieldGroup className="gap-4">
            <Field data-invalid={!!errors.label || undefined}>
              <FieldLabel htmlFor="project-name">
                {copy.addProject.name} <Required />
              </FieldLabel>
              <Input id="project-name" aria-required aria-invalid={!!errors.label || undefined} {...register("label")} />
              <ValidationError error={errors.label} />
            </Field>
            <Field>
              <FieldLabel htmlFor="project-path">{copy.addProject.path}</FieldLabel>
              <Input id="project-path" value={inspection.path} readOnly className="font-mono text-muted-foreground" />
            </Field>
            <Field>
              <FieldLabel htmlFor="project-env">{copy.addProject.env}</FieldLabel>
              <Input
                id="project-env"
                value={copy.env.long(inspection.envId)}
                readOnly
                aria-describedby="project-env-hint"
                className="text-muted-foreground"
              />
              <FieldDescription id="project-env-hint">{copy.addProject.envHint}</FieldDescription>
            </Field>
            <Controller
              control={control}
              name="conventions"
              render={({ field, fieldState }) => (
                <FieldSet data-invalid={!!fieldState.error || undefined} className="gap-2">
                  <FieldLegend variant="label" className="mb-0">
                    {copy.addProject.conventions} <Required />
                  </FieldLegend>
                  <FieldDescription>{copy.addProject.conventionsHint}</FieldDescription>
                  <FieldGroup className="gap-2">
                    {CONVENTIONS.map((c) => (
                      <Field key={c} orientation="horizontal">
                        <Checkbox
                          id={`convention-${c}`}
                          checked={field.value.includes(c)}
                          onCheckedChange={(on) =>
                            field.onChange(on ? [...field.value, c] : field.value.filter((x) => x !== c))
                          }
                        />
                        <FieldContent>
                          <FieldLabel htmlFor={`convention-${c}`} className="font-mono font-normal">
                            {CONVENTION_DIRS[c]}
                          </FieldLabel>
                          <FieldDescription>{copy.addProject.conventionNote[c]}</FieldDescription>
                        </FieldContent>
                      </Field>
                    ))}
                  </FieldGroup>
                  <ValidationError error={fieldState.error} />
                </FieldSet>
              )}
            />
            <Controller
              control={control}
              name="gitExclude"
              render={({ field }) => (
                <Field orientation="horizontal" data-disabled={!inspection.isGitRepo || undefined}>
                  <FieldContent>
                    <FieldLabel htmlFor="project-exclude">{copy.addProject.gitExclude}</FieldLabel>
                    <FieldDescription>
                      {inspection.isGitRepo ? copy.addProject.gitExcludeHint : copy.addProject.notGit}
                    </FieldDescription>
                  </FieldContent>
                  <Switch
                    id="project-exclude"
                    checked={inspection.isGitRepo && field.value}
                    disabled={!inspection.isGitRepo}
                    onCheckedChange={field.onChange}
                  />
                </Field>
              )}
            />
          </FieldGroup>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => (isDirty ? setConfirmDiscard(true) : close())}>
            {copy.common.cancel}
          </Button>
          <Button type="submit" form="add-project-form" disabled={isSubmitting}>
            {isSubmitting && <Spinner data-icon="inline-start" aria-hidden />}
            {copy.addProject.submit}
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
