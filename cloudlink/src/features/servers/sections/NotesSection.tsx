import { CheckIcon, PencilLineIcon, TriangleAlertIcon, XIcon } from "lucide-react"
import { AnimatePresence, motion } from "motion/react"
import { useState } from "react"
import { useFormContext } from "react-hook-form"

import type { AgentNote } from "@/bindings"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Item, ItemContent, ItemDescription, ItemFooter, ItemGroup, ItemTitle } from "@/components/ui/item"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/toast"
import { copy } from "@/lib/copy"
import { formatDay } from "@/lib/format"
import type { ServerFormValues } from "@/lib/schemas"
import { useNotesStore } from "@/stores/notes"
import { toastError } from "../actions"

const EMPTY: AgentNote[] = []

/** 一条待处理的笔记：原文是纯文本，不渲染 Markdown；命中密钥的必须编辑后才能并入（F-308 AC2） */
function NoteItem({ note, dirty, busy, onMerge, onDismiss }: {
  note: AgentNote
  dirty: boolean
  busy: boolean
  /** 成功时返回 true */
  onMerge: (text?: string) => Promise<boolean>
  onDismiss: () => void
}) {
  const [editing, setEditing] = useState<string | null>(null)
  const secret = note.flags.includes("secret")
  const hint = secret ? copy.notes.secretHint : note.flags.includes("injection") ? copy.notes.injectionHint : null
  const textId = `note-${note.id}`

  return (
    <Item variant="outline" size="xs" className="items-start">
      <ItemContent className="min-w-0">
        <ItemTitle className="flex-wrap text-xs font-normal text-muted-foreground">
          <time dateTime={note.writtenAt}>{formatDay(note.writtenAt)}</time>
          {note.flags.map((f) => (
            <Badge key={f} variant="warning">
              <TriangleAlertIcon data-icon="inline-start" />
              {copy.notes.flag[f]}
            </Badge>
          ))}
        </ItemTitle>
        {editing === null ? (
          <ItemDescription id={textId} className="line-clamp-none whitespace-pre-wrap break-words text-foreground">
            {note.text}
          </ItemDescription>
        ) : (
          <Textarea
            aria-label={copy.notes.editLabel}
            value={editing}
            onChange={(e) => setEditing(e.target.value)}
            rows={3}
            autoFocus
            className="mt-1"
          />
        )}
        {hint && <ItemDescription className="line-clamp-none text-xs text-warning">{hint}</ItemDescription>}
      </ItemContent>
      <ItemFooter className="justify-end gap-1.5">
        {editing === null ? (
          <>
            <Button variant="outline" size="xs" disabled={dirty || busy || secret} onClick={() => void onMerge()} aria-describedby={textId}>
              <CheckIcon data-icon="inline-start" />
              {copy.notes.merge}
            </Button>
            <Button variant="outline" size="xs" disabled={dirty || busy} onClick={() => setEditing(note.text)} aria-describedby={textId}>
              <PencilLineIcon data-icon="inline-start" />
              {copy.notes.editMerge}
            </Button>
            <Button variant="ghost" size="xs" disabled={busy} onClick={onDismiss} aria-describedby={textId}>
              <XIcon data-icon="inline-start" />
              {copy.notes.dismiss}
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" size="xs" onClick={() => setEditing(null)}>
              {copy.notes.cancelEdit}
            </Button>
            <Button
              size="xs"
              disabled={dirty || busy || !editing.trim()}
              onClick={() =>
                void onMerge(editing.trim()).then((ok) => {
                  if (ok) setEditing(null)
                })
              }
            >
              {busy && <Spinner data-icon="inline-start" aria-hidden />}
              {copy.notes.confirmEdit}
            </Button>
          </>
        )}
      </ItemFooter>
    </Item>
  )
}

/**
 * 笔记分段（PRD 6.4、F-308）：顶部是待处理的 Agent 笔记，下面是笔记字段本身。
 * 并入和忽略立即生效；详情有未保存的修改时，「并入」不可用
 */
export function NotesSection({ assetId }: { assetId: string }) {
  const {
    register,
    formState: { isDirty },
  } = useFormContext<ServerFormValues>()
  const notes = useNotesStore((s) => s.byAsset[assetId] ?? EMPTY)
  const [busy, setBusy] = useState(false)
  const mergeable = notes.filter((n) => !n.flags.includes("secret"))
  const skipped = notes.length - mergeable.length

  const merge = async (items: { id: string; text?: string }[]) => {
    setBusy(true)
    try {
      await useNotesStore.getState().merge(items)
      toast.add({ title: copy.notes.merged(items.length) })
      return true
    } catch (e) {
      toastError(e)
      return false
    } finally {
      setBusy(false)
    }
  }
  const dismiss = (ids: string[]) =>
    useNotesStore
      .getState()
      .dismiss(ids)
      .then(() => toast.add({ title: copy.notes.dismissed(ids.length) }))
      .catch(toastError)

  return (
    <div className="flex flex-col gap-4">
      {notes.length > 0 ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{copy.notes.pendingTitle}</span>
            <Button
              variant="outline"
              size="xs"
              className="ml-auto"
              disabled={isDirty || busy || mergeable.length === 0}
              onClick={() => void merge(mergeable.map((n) => ({ id: n.id })))}
            >
              {copy.notes.mergeAll}
            </Button>
          </div>
          {skipped > 0 && <p className="text-xs text-muted-foreground">{copy.notes.mergeAllSkipped(skipped)}</p>}
          {isDirty && (
            <p role="note" className="flex items-center gap-1.5 text-xs text-warning">
              <TriangleAlertIcon className="size-3.5 shrink-0" aria-hidden />
              {copy.notes.dirtyHint}
            </p>
          )}
          <ItemGroup className="gap-1.5" aria-label={copy.notes.pendingTitle}>
            {/* 并入或忽略后离场：淡出并上移 4px，120ms；其余条目用 layout 补位（PRD 7.7） */}
            <AnimatePresence initial={false}>
              {notes.map((n) => (
                <motion.div key={n.id} role="listitem" layout exit={{ opacity: 0, y: -4, transition: { duration: 0.12 } }}>
                  <NoteItem note={n} dirty={isDirty} busy={busy} onMerge={(text) => merge([{ id: n.id, text }])} onDismiss={() => void dismiss([n.id])} />
                </motion.div>
              ))}
            </AnimatePresence>
          </ItemGroup>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{copy.notes.none}</p>
      )}

      <Field>
        <FieldLabel htmlFor="server-notes">{copy.notes.field}</FieldLabel>
        <Textarea id="server-notes" rows={4} aria-describedby="server-notes-hint" {...register("notes")} />
        <FieldDescription id="server-notes-hint">{copy.notes.fieldHint}</FieldDescription>
      </Field>
    </div>
  )
}
