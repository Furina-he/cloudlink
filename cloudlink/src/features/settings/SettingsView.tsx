import { SettingsIcon } from "lucide-react"

import { EmptyState } from "@/components/app/EmptyState"
import { ViewShell } from "@/components/app/ViewShell"
import { copy } from "@/lib/copy"

// P1 占位：标题加空状态
export function SettingsView({ focusTitle }: { focusTitle: boolean }) {
  return (
    <ViewShell view="settings" title={copy.nav.settings} focusTitle={focusTitle}>
      <EmptyState
        icon={SettingsIcon}
        title={copy.placeholder.settings.title}
        description={copy.placeholder.settings.description}
      />
    </ViewShell>
  )
}
