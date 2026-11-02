import { FolderOpenIcon } from "lucide-react"
import type { ReactNode } from "react"

import type { Settings } from "@/bindings"
import { Field, FieldLabel } from "@/components/ui/field"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"
import { copy } from "@/lib/copy"
import { ipc } from "@/lib/ipc"
import { cn } from "@/lib/utils"
import { useSettingsStore } from "@/stores/settings"

/** 每个分区的外框：h2 + 说明，内容是 FieldSet（PRD 6.7） */
export function Section({ id, title, hint, wide, children }: { id: string; title: string; hint?: string; wide?: boolean; children: ReactNode }) {
  return (
    <section aria-labelledby={`settings-${id}`} className={cn("flex min-w-0 flex-col gap-4", wide ? "max-w-3xl" : "max-w-2xl")}>
      <div className="flex flex-col gap-1">
        <h2 id={`settings-${id}`} className="text-sm font-semibold">
          {title}
        </h2>
        {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  )
}

/** 立即保存；失败时由 store 回滚并弹 Toast */
export const update = (patch: Partial<Settings>) => void useSettingsStore.getState().update(patch)

/** 只读路径，右侧「在文件夹中显示」 */
export function PathField({ id, label, path }: { id: string; label: string; path: string }) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <InputGroup>
        <InputGroupInput id={id} value={path} readOnly className="font-mono" />
        <InputGroupAddon align="inline-end">
          <InputGroupButton size="xs" onClick={() => void ipc.revealInDir(path)}>
            <FolderOpenIcon data-icon="inline-start" />
            {copy.common.reveal}
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </Field>
  )
}
