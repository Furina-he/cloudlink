import { CableIcon } from "lucide-react"

import { EmptyState } from "@/components/app/EmptyState"
import { ViewShell } from "@/components/app/ViewShell"
import { copy } from "@/lib/copy"

// P1 占位：标题加空状态
export function MountsView({ focusTitle }: { focusTitle: boolean }) {
  return (
    <ViewShell view="mounts" title={copy.nav.mounts} focusTitle={focusTitle}>
      <EmptyState
        icon={CableIcon}
        title={copy.placeholder.mounts.title}
        description={copy.placeholder.mounts.description}
      />
    </ViewShell>
  )
}
