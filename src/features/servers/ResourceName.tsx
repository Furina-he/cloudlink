// 标题的轻量快捷改名：Enter/blur 保存、Esc 取消；中文输入法组词时不提交（P8 D6/D7）。
import { zodResolver } from "@hookform/resolvers/zod"
import { useRef, useState } from "react"
import { useForm } from "react-hook-form"
import { z } from "zod"
import type { Asset } from "@/bindings"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { toast } from "@/components/ui/toast"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { copy } from "@/lib/copy"
import { useAssetStore } from "@/stores/assets"
import { renameInputOf } from "./profileForm"
import { toastError } from "./actions"

const schema = z.object({ name: z.string().trim().min(1, "name-required") })

export function ResourceName({ asset }: { asset: Asset }) {
  const [editing, setEditing] = useState(false)
  const committing = useRef(false)
  const cancelled = useRef(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const form = useForm<{ name: string }>({ resolver: zodResolver(schema), defaultValues: { name: asset.name } })
  const begin = () => {
    const selection = window.getSelection()
    if (selection?.toString() && buttonRef.current?.contains(selection.anchorNode)) return
    cancelled.current = false
    form.reset({ name: asset.name })
    setEditing(true)
    requestAnimationFrame(() => form.setFocus("name", { shouldSelect: true }))
  }
  const commit = () => {
    if (committing.current || cancelled.current) return
    committing.current = true
    void form.handleSubmit(async ({ name }) => {
      const current = useAssetStore.getState().byId[asset.id]
      if (current && name === current.name) { setEditing(false); return }
      let oldName = asset.name
      try {
        await useAssetStore.getState().update(asset.id, (latest) => {
          oldName = latest.name
          return renameInputOf(latest, name)
        })
        setEditing(false)
        toast.add({
          title: copy.detail.rename.saved,
          actionProps: {
            children: copy.common.undo,
            onClick: () => {
              void useAssetStore.getState().update(asset.id, (latest) => renameInputOf(latest, oldName)).catch(toastError)
            },
          },
        })
      } catch {
        form.setError("name", { type: "server", message: "rename-failed" })
      }
    })().finally(() => { committing.current = false })
  }
  const cancel = () => {
    cancelled.current = true
    form.reset({ name: asset.name })
    setEditing(false)
    requestAnimationFrame(() => buttonRef.current?.focus({ preventScroll: true }))
  }
  const error = form.formState.errors.name
  return (
    <div className="flex min-w-0 flex-col gap-1">
      {editing ? (
        <Input
          variant="title"
          aria-label={copy.detail.rename.input}
          aria-invalid={!!error || undefined}
          aria-describedby={error ? "rename-error" : undefined}
          disabled={form.formState.isSubmitting}
          autoComplete="off"
          {...form.register("name")}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing || e.keyCode === 229) return
            if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); commit() }
            if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); cancel() }
          }}
        />
      ) : (
        <Tooltip>
          <TooltipTrigger render={<Button ref={buttonRef} variant="title" size="title" aria-label={copy.detail.rename.label(asset.name)} onClick={begin} />}>
            <span className="min-w-0 truncate">{asset.name}</span>
          </TooltipTrigger>
          <TooltipContent>{copy.detail.rename.hint}</TooltipContent>
        </Tooltip>
      )}
      {error && <span id="rename-error" role="alert" className="text-xs leading-normal font-normal text-destructive">{error.message === "name-required" ? copy.detail.rename.empty : copy.detail.rename.failed}</span>}
    </div>
  )
}
