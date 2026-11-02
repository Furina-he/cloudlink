import { Keys } from "@/components/app/Keys"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { copy } from "@/lib/copy"
import { KEY_HINT } from "@/lib/hotkeys"

/** 有未保存修改时固定在底部的操作条（PRD 6.4）：「未保存的修改」、「放弃」、主按钮「保存」（Ctrl+S） */
export function SaveBar({ saving, onDiscard, onSave }: { saving: boolean; onDiscard: () => void; onSave: () => void }) {
  return (
    <div role="region" aria-label={copy.detail.saveBar.unsaved} className="flex shrink-0 items-center gap-2 border-t bg-background px-3 py-2">
      <span className="text-sm text-muted-foreground">{copy.detail.saveBar.unsaved}</span>
      <Button variant="ghost" size="sm" className="ml-auto" disabled={saving} onClick={onDiscard}>
        {copy.detail.saveBar.discard}
      </Button>
      <Button size="sm" disabled={saving} onClick={onSave}>
        {saving && <Spinner data-icon="inline-start" aria-hidden />}
        {saving ? copy.detail.saveBar.saving : copy.detail.saveBar.save}
        <Keys keys={KEY_HINT.save} className="[&>kbd]:bg-primary-foreground/15 [&>kbd]:text-primary-foreground" />
      </Button>
    </div>
  )
}
