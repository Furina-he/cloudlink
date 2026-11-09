import { ChevronRightIcon, EyeIcon, EyeOffIcon, GlobeIcon, GripVerticalIcon, PencilIcon, PenLineIcon, PlusIcon, ServerIcon, Trash2Icon, Undo2Icon, WaypointsIcon } from "lucide-react"
import { useMemo, useRef, type ReactNode } from "react"
import { useFieldArray, useFormContext, useWatch } from "react-hook-form"

import type { Relation } from "@/bindings"
import { ProviderMark } from "@/components/app/ProviderMark"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { copy } from "@/lib/copy"
import type { SkillConfigValues } from "@/lib/schemas"
import { shortId } from "@/features/servers/serverForm"
import { SortableList, useSortableRow } from "@/features/servers/SortableList"
import { ValidationError } from "@/features/servers/ValidationError"
import { useAssetStore } from "@/stores/assets"
import { useSkillStore } from "@/stores/skills"
import { useUIStore } from "@/stores/ui"

/** 句子里用反引号标出的名称（别名、域名、实例名）用等宽字体 */
function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split("`").map((part, i) =>
        i % 2 === 1 ? (
          <code key={i} className="font-mono text-[0.8125rem]">
            {part}
          </code>
        ) : (
          part
        )
      )}
    </>
  )
}

/** 列表行里的图标按钮：灰色、常驻（不靠悬停才出现），名称放在 Tooltip 和 aria-label */
function RowAction({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<Button type="button" variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label={label} onClick={onClick} />}>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

/** 一条自动关系的标识：域名和云主机用云平台官方 Logo，跳板机和同一台机器用 Lucide 图标 */
function RelationIcon({ relation }: { relation: Relation }) {
  const provider = useAssetStore((s) => {
    const a = s.byId[relation.assetIds[0]]
    return a?.type === "cli" ? a.cliProvider : null
  })
  if (relation.kind === "proxy-jump") return <WaypointsIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
  if (relation.kind === "same-host") return <ServerIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
  if (provider) return <ProviderMark provider={provider} />
  return <GlobeIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
}

/** 无边框、随内容长高的输入框：平时像一行字，悬停有底色，聚焦时有描边 */
const INLINE_TEXTAREA =
  "min-h-8 resize-none rounded-md border-transparent bg-transparent px-2 py-1.5 shadow-none hover:bg-muted/60 focus-visible:bg-background dark:bg-transparent dark:hover:bg-muted/60"

function NoteRow({ index, onRemove }: { index: number; onRemove: () => void }) {
  const {
    register,
    control,
    formState: { errors },
  } = useFormContext<SkillConfigValues>()
  const replaces = useWatch({ control, name: `relationNotes.${index}.replaces` })
  const error = errors.relationNotes?.[index]?.text
  const n = index + 1
  return (
    <li className="flex items-start gap-2 px-2 py-1.5">
      <PenLineIcon aria-hidden className="mt-2 ml-1 size-4 shrink-0 text-muted-foreground" />
      <div className="flex min-w-0 flex-1 flex-col gap-1" data-invalid={!!error || undefined}>
        <Textarea
          rows={1}
          className={INLINE_TEXTAREA}
          placeholder={copy.skillContent.notePlaceholder}
          aria-label={replaces ? copy.skillContent.rewriteNoteAria(n) : copy.skillContent.noteAria(n)}
          aria-required
          aria-invalid={!!error || undefined}
          {...register(`relationNotes.${index}.text`)}
        />
        <ValidationError error={error} />
      </div>
      <Badge variant="outline" className="mt-1.5 shrink-0 text-muted-foreground">
        {replaces ? copy.skillContent.rewritten : copy.skillContent.added}
      </Badge>
      <RowAction label={replaces ? copy.skillContent.removeRewrite(n) : copy.skillContent.removeNote(n)} onClick={onRemove}>
        {replaces ? <Undo2Icon /> : <Trash2Icon />}
      </RowAction>
    </li>
  )
}

/**
 * 资源关系（2026-11-07）：CloudLink 从资源推出的关系逐条列出，可以隐藏、改写（改写后原来那条隐藏，换成用户的一句）；
 * 推不出来的由用户补充。只有补充和改写的那几句是输入框，不再是一大块文本框
 */
export function RelationsBlock() {
  const relations = useSkillStore((s) => s.relations)
  const { control, getValues, setValue } = useFormContext<SkillConfigValues>()
  const notes = useFieldArray({ control, name: "relationNotes", keyName: "key" })
  const hidden = useWatch({ control, name: "hiddenRelations" })
  const setHidden = (next: string[]) => setValue("hiddenRelations", next, { shouldDirty: true })
  const hiddenTriggerRef = useRef<HTMLButtonElement>(null)
  const addRef = useRef<HTMLButtonElement>(null)
  // 隐藏、恢复后被点的按钮消失了：焦点放到「已隐藏 N 条」上，没有它时放到「补充一条」
  const refocus = () =>
    requestAnimationFrame(() => {
      ;(hiddenTriggerRef.current ?? addRef.current)?.focus()
    })

  const { replacing, hiddenOnly } = useMemo(() => {
    const replacing = new Map(notes.fields.flatMap((f, i) => (f.replaces ? [[f.replaces, i] as const] : [])))
    return { replacing, hiddenOnly: relations.filter((r) => hidden.includes(r.id) && !replacing.has(r.id)) }
  }, [notes.fields, relations, hidden])
  const shownIds = new Set(relations.map((r) => r.id))
  // 改写的那一条不存在了（资源被删除）时，改写和补充的一样排在最后
  const trailing = notes.fields.flatMap((f, i) => (!f.replaces || !shownIds.has(f.replaces) ? [i] : []))

  const rewrite = (r: Relation) => {
    notes.append({ id: shortId("rel"), text: r.text, replaces: r.id })
    setHidden([...getValues("hiddenRelations"), r.id])
  }
  const removeNote = (i: number) => {
    const replaces = getValues(`relationNotes.${i}.replaces`)
    notes.remove(i)
    if (replaces) setHidden(getValues("hiddenRelations").filter((id) => id !== replaces))
  }

  let autoIndex = 0
  const rows = relations.flatMap((r) => {
    const noteIndex = replacing.get(r.id)
    if (noteIndex !== undefined) return [<NoteRow key={notes.fields[noteIndex].key} index={noteIndex} onRemove={() => removeNote(noteIndex)} />]
    if (hidden.includes(r.id)) return []
    const n = ++autoIndex
    return [
      <li key={r.id} className="flex items-start gap-2 px-2 py-1.5">
        <span className="mt-2 ml-1 flex shrink-0">
          <RelationIcon relation={r} />
        </span>
        <p className="min-w-0 flex-1 px-2 py-1.5 text-sm" aria-label={copy.skillContent.autoAria(n)}>
          <Rich text={copy.skillContent.relation[r.kind](r.params)} />
        </p>
        <RowAction label={copy.skillContent.rewriteAria(n)} onClick={() => rewrite(r)}>
          <PencilIcon />
        </RowAction>
        <RowAction
          label={copy.skillContent.hideAria(n)}
          onClick={() => {
            setHidden([...getValues("hiddenRelations"), r.id])
            refocus()
          }}
        >
          <EyeOffIcon />
        </RowAction>
      </li>,
    ]
  })
  const all = [...rows, ...trailing.map((i) => <NoteRow key={notes.fields[i].key} index={i} onRemove={() => removeNote(i)} />)]

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3 id="skill-relations" className="text-sm font-medium">
            {copy.skillContent.relations}
          </h3>
          <p className="text-xs text-muted-foreground">{copy.skillContent.relationsHint}</p>
        </div>
        <Button ref={addRef} type="button" variant="outline" size="sm" className="ml-auto shrink-0" onClick={() => notes.append({ id: shortId("rel"), text: "" })}>
          <PlusIcon data-icon="inline-start" />
          {copy.skillContent.addRelation}
        </Button>
      </div>
      {all.length > 0 ? (
        <ul aria-labelledby="skill-relations" className="divide-y divide-line-2 rounded-list border border-line bg-card">
          {all}
        </ul>
      ) : (
        <p className="rounded-list border border-line bg-card px-3 py-2.5 text-sm text-muted-foreground">{copy.skillContent.relationsEmpty}</p>
      )}
      {hiddenOnly.length > 0 && (
        <Collapsible>
          <CollapsibleTrigger render={<Button ref={hiddenTriggerRef} type="button" variant="ghost" size="xs" className="group w-fit text-muted-foreground" />}>
            <ChevronRightIcon data-icon="inline-start" className="transition-transform group-aria-expanded:rotate-90" />
            {copy.skillContent.hiddenCount(hiddenOnly.length)}
          </CollapsibleTrigger>
          <CollapsibleContent className="h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-200 data-ending-style:h-0 data-starting-style:h-0">
            <ul aria-label={copy.skillContent.hiddenListLabel} className="mt-1 divide-y divide-line-2 rounded-list border border-line bg-card border-dashed">
              {hiddenOnly.map((r) => (
                <li key={r.id} className="flex items-center gap-2 px-2 py-1 text-muted-foreground">
                  <span className="ml-1 flex shrink-0 opacity-60">
                    <RelationIcon relation={r} />
                  </span>
                  <p className="min-w-0 flex-1 px-2 py-1 text-sm">
                    <Rich text={copy.skillContent.relation[r.kind](r.params)} />
                  </p>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setHidden(getValues("hiddenRelations").filter((id) => id !== r.id))
                      refocus()
                    }}
                  >
                    <EyeIcon data-icon="inline-start" />
                    {copy.skillContent.restore}
                  </Button>
                </li>
              ))}
            </ul>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  )
}

function ConventionRow({ id, index, onRemove }: { id: string; index: number; onRemove: () => void }) {
  const {
    register,
    formState: { errors },
  } = useFormContext<SkillConfigValues>()
  const { rowProps, handleProps } = useSortableRow(id)
  const error = errors.conventions?.[index]?.text
  const n = index + 1

  return (
    <li {...rowProps} className="relative flex items-start gap-1 bg-background px-1 py-1.5 first:rounded-t-xl last:rounded-b-xl data-dragging:z-10 data-dragging:rounded-xl data-dragging:shadow-md">
      <Button type="button" variant="ghost" size="icon-sm" className="mt-0.5 cursor-grab touch-none text-muted-foreground" aria-label={copy.skillContent.dragAria(n)} {...handleProps}>
        <GripVerticalIcon />
      </Button>
      <div className="flex min-w-0 flex-1 flex-col gap-1" data-invalid={!!error || undefined}>
        <Textarea
          rows={1}
          className={INLINE_TEXTAREA}
          placeholder={copy.skillContent.conventionPlaceholder}
          aria-label={copy.skillContent.conventionAria(n)}
          aria-required
          aria-invalid={!!error || undefined}
          {...register(`conventions.${index}.text`)}
        />
        <ValidationError error={error} />
      </div>
      <RowAction label={copy.skillContent.removeAria(n)} onClick={onRemove}>
        <Trash2Icon />
      </RowAction>
    </li>
  )
}

export function ConventionsBlock() {
  const { control } = useFormContext<SkillConfigValues>()
  // keyName "key"：约定自带 id，排序用领域 id（PRD 7.2 已知的坑第 2 条）
  const { fields, append, remove, move } = useFieldArray({ control, name: "conventions", keyName: "key" })
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3 id="skill-conventions" className="text-sm font-medium">
            {copy.skillContent.conventions}
          </h3>
          <p className="text-xs text-muted-foreground">{copy.skillContent.conventionsHint}</p>
        </div>
        <Button type="button" variant="outline" size="sm" className="ml-auto shrink-0" onClick={() => append({ id: shortId("c"), text: "" })}>
          <PlusIcon data-icon="inline-start" />
          {copy.skillContent.addConvention}
        </Button>
      </div>
      {fields.length > 0 ? (
        <SortableList ids={fields.map((f) => f.id)} onMove={move}>
          <ol aria-labelledby="skill-conventions" className="divide-y divide-line-2 rounded-list border border-line bg-card">
            {fields.map((f, i) => (
              <ConventionRow key={f.key} id={f.id} index={i} onRemove={() => remove(i)} />
            ))}
          </ol>
        </SortableList>
      ) : (
        <p className="rounded-list border border-line bg-card px-3 py-2.5 text-sm text-muted-foreground">{copy.skillContent.conventionsEmpty}</p>
      )}
    </div>
  )
}

/** 巡检清单：内置只读，在运维约定页底部 */
export function HealthCheckRow() {
  return (
    <div className="flex items-center gap-3 rounded-list border border-line bg-card px-3.5 py-2.5">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[13px] font-medium">{copy.skillContent.healthCheck}</span>
        <span className="text-xs text-muted-foreground">{copy.skillContent.healthCheckHint}</span>
      </div>
      <Button type="button" variant="outline" size="sm" onClick={() => useUIStore.getState().openPreview({ file: "references/health-check.md" })}>
        <EyeIcon data-icon="inline-start" />
        {copy.skillContent.viewHealthCheck}
      </Button>
    </div>
  )
}
