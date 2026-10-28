import { PackageIcon } from "lucide-react"

import { EmptyState } from "@/components/app/EmptyState"
import { ViewShell } from "@/components/app/ViewShell"
import { copy } from "@/lib/copy"

// P1 占位：标题加空状态
export function SkillsView({ focusTitle }: { focusTitle: boolean }) {
  return (
    <ViewShell view="skills" title={copy.nav.skills} focusTitle={focusTitle}>
      <EmptyState
        icon={PackageIcon}
        title={copy.placeholder.skills.title}
        description={copy.placeholder.skills.description}
      />
    </ViewShell>
  )
}
