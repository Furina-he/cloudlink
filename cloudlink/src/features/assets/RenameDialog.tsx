import { zodResolver } from "@hookform/resolvers/zod"
import { BotIcon, FolderGit2Icon } from "lucide-react"
import { useState } from "react"
import { useForm } from "react-hook-form"
import { z } from "zod"

import type { Asset, IpcError, Mount } from "@/bindings"
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
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Item, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "@/components/ui/toast"
import { copy, ipcErrorText } from "@/lib/copy"
import { uniqueSlugSchema } from "@/lib/schemas"
import { useAssetStore } from "@/stores/assets"
import { useSkillStore } from "@/stores/skills"
import { useTargetStore } from "@/stores/targets"
import { formValuesOf, toAssetInput } from "./assetForm"
import { Required } from "./tabs/OverviewTab"
import { ValidationError } from "./ValidationError"

/**
 * 重命名迁移（F-101 AC2）：已挂载资产的 slug 只能在这里改。改的是已保存的资产，
 * 编辑器里其他未保存的修改不受影响；后端按新 slug 重建全部链接
 */
export function RenameDialog({
  open,
  onOpenChange,
  asset,
  mounts,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  asset: Asset
  mounts: Mount[]
}) {
  const byId = useAssetStore((s) => s.byId)
  const targets = useTargetStore((s) => s.targets)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const schema = z.object({
    slug: uniqueSlugSchema(Object.values(byId), asset.id).refine((v) => v !== asset.slug, "slug-same"),
  })
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isDirty, isSubmitting },
  } = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { slug: asset.slug },
    mode: "onChange",
  })

  const submit = handleSubmit(async ({ slug }) => {
    try {
      await useAssetStore.getState().save({ ...toAssetInput(formValuesOf(asset), asset), slug })
    } catch (e) {
      const err = e as IpcError
      if (err.id === "slug-taken") setError("slug", { message: "slug-taken" })
      else toast.add({ title: ipcErrorText(err.id, err.params), type: "error" })
      return
    }
    void useSkillStore.getState().refresh()
    toast.add({ title: copy.editor.renamed(slug), type: "success" })
    onOpenChange(false)
  })

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && isDirty && !isSubmitting) setConfirmDiscard(true)
        else onOpenChange(next)
      }}
    >
      <DialogContent className="grid-cols-[minmax(0,1fr)] sm:max-w-lg" closeLabel={copy.common.close}>
        <DialogHeader>
          <DialogTitle>{copy.renameDialog.title}</DialogTitle>
          <DialogDescription>{copy.renameDialog.description(mounts.length)}</DialogDescription>
        </DialogHeader>
        <form id="rename-form" noValidate onSubmit={submit} className="flex flex-col gap-4">
          <Field>
            <FieldLabel htmlFor="rename-current">{copy.renameDialog.current}</FieldLabel>
            <Input id="rename-current" value={asset.slug} readOnly className="font-mono text-muted-foreground" />
          </Field>
          <Field data-invalid={!!errors.slug || undefined}>
            <FieldLabel htmlFor="rename-next">
              {copy.renameDialog.next} <Required />
            </FieldLabel>
            <Input
              id="rename-next"
              className="font-mono"
              aria-required
              aria-invalid={!!errors.slug || undefined}
              spellCheck={false}
              autoComplete="off"
              {...register("slug")}
            />
            <ValidationError error={errors.slug} />
          </Field>
        </form>
        {mounts.length > 0 && (
          <section aria-labelledby="rename-affected" className="flex flex-col gap-1.5">
            <h3 id="rename-affected" className="text-xs font-medium text-muted-foreground">
              {copy.renameDialog.affected}
            </h3>
            <ItemGroup className="gap-1">
              {mounts.map((m) => {
                const t = targets.find((x) => x.id === m.targetId)
                return (
                  <Item key={m.id} size="xs" variant="muted">
                    <ItemMedia>
                      {t?.kind === "agent-global" ? <BotIcon className="size-4" /> : <FolderGit2Icon className="size-4" />}
                    </ItemMedia>
                    <ItemContent className="min-w-0">
                      <ItemTitle>{t?.label ?? m.targetId}</ItemTitle>
                      <ItemDescription className="truncate font-mono text-xs">
                        {m.links.map((l) => l.path).join("、")}
                      </ItemDescription>
                    </ItemContent>
                  </Item>
                )
              })}
            </ItemGroup>
          </section>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => (isDirty ? setConfirmDiscard(true) : onOpenChange(false))}>
            {copy.common.cancel}
          </Button>
          <Button type="submit" form="rename-form" disabled={isSubmitting}>
            {isSubmitting && <Spinner data-icon="inline-start" aria-hidden />}
            {copy.renameDialog.submit(mounts.length)}
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
