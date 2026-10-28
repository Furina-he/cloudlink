import { ServerIcon } from "lucide-react"

import { EmptyState } from "@/components/app/EmptyState"
import { ViewShell } from "@/components/app/ViewShell"
import { copy } from "@/lib/copy"

// P1 占位：标题加空状态
export function AssetsView({ focusTitle }: { focusTitle: boolean }) {
  return (
    <ViewShell view="assets" title={copy.nav.assets} focusTitle={focusTitle}>
      <EmptyState
        icon={ServerIcon}
        title={copy.placeholder.assets.title}
        description={copy.placeholder.assets.description}
      />
    </ViewShell>
  )
}
