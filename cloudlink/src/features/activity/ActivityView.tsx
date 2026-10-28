import { HistoryIcon } from "lucide-react"

import { EmptyState } from "@/components/app/EmptyState"
import { ViewShell } from "@/components/app/ViewShell"
import { copy } from "@/lib/copy"

// P1 占位：标题加空状态
export function ActivityView({ focusTitle }: { focusTitle: boolean }) {
  return (
    <ViewShell view="activity" title={copy.nav.activity} focusTitle={focusTitle}>
      <EmptyState
        icon={HistoryIcon}
        title={copy.placeholder.activity.title}
        description={copy.placeholder.activity.description}
      />
    </ViewShell>
  )
}
