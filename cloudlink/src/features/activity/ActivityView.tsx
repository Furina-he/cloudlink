import { ViewShell } from "@/components/app/ViewShell"
import { copy } from "@/lib/copy"
import { ActivitySection } from "@/features/settings/ActivitySection"

/** 动态视图（PRD 6.7）。P7a 先承载操作记录；等你确认（Agent 笔记）在 P7c 迁入 */
export function ActivityView({ focusTitle }: { focusTitle: boolean }) {
  return (
    <ViewShell view="activity" title={copy.nav.activity} focusTitle={focusTitle} titleHidden>
      <div className="mx-auto w-full max-w-190">
        <ActivitySection />
      </div>
    </ViewShell>
  )
}
