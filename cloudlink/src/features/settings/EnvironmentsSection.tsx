import { CircleXIcon, RefreshCwIcon } from "lucide-react"

import type { EnvId, Settings } from "@/bindings"
import { EnvIcon, StateBadge } from "@/components/app/StateBadge"
import { Truncate } from "@/components/app/Truncate"
import { Button } from "@/components/ui/button"
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { toast } from "@/components/ui/toast"
import { copy } from "@/lib/copy"
import { useTargetStore } from "@/stores/targets"
import { Section, update } from "./Section"

/** 运行环境（PRD 6.7）：已检测到的环境，每项有启用开关；重新检测 */
export function EnvironmentsSection({ settings }: { settings: Settings }) {
  const environments = useTargetStore((s) => s.environments)
  const detecting = useTargetStore((s) => s.status === "loading")
  const enabled = (id: EnvId) => settings.environments.find((e) => e.id === id)?.enabled ?? true
  const setEnabled = (id: EnvId, on: boolean) =>
    update({ environments: environments.map((e) => ({ id: e.id, enabled: e.id === id ? on : enabled(e.id) })) })

  return (
    <Section id="environments" title={copy.settings.section.environments} hint={copy.settings.envList}>
      <ItemGroup className="gap-2">
        {environments.map((e) => (
          <Item key={e.id} variant="outline" size="sm">
            <ItemMedia>
              <EnvIcon envId={e.id} />
            </ItemMedia>
            <ItemContent className="min-w-0">
              <ItemTitle>
                {copy.env.long(e.id)}
                {!e.available && (
                  <StateBadge tone="danger" icon={CircleXIcon}>
                    {copy.settings.envUnavailable}
                  </StateBadge>
                )}
              </ItemTitle>
              <ItemDescription className="flex min-w-0 flex-col gap-0.5 text-xs">
                <span className="flex min-w-0 gap-1">
                  <span className="shrink-0">{copy.settings.envHome}</span>
                  <Truncate text={e.home} className="font-mono" />
                </span>
                <span className="flex min-w-0 gap-1">
                  <span className="shrink-0">{copy.settings.envSshConfig}</span>
                  <Truncate text={e.sshConfigPath} className="font-mono" />
                </span>
                {!e.available && <span>{copy.settings.envUnavailableHint}</span>}
              </ItemDescription>
            </ItemContent>
            <ItemActions>
              <Switch
                checked={enabled(e.id)}
                disabled={!e.available}
                onCheckedChange={(on) => setEnabled(e.id, on)}
                aria-label={copy.settings.envEnabled(copy.env.long(e.id))}
              />
            </ItemActions>
          </Item>
        ))}
      </ItemGroup>
      <div>
        <Button
          variant="outline"
          size="sm"
          disabled={detecting}
          onClick={() =>
            void useTargetStore
              .getState()
              .detect()
              .then(() => toast.add({ title: copy.settings.redetected }))
          }
        >
          {detecting ? <Spinner data-icon="inline-start" aria-hidden /> : <RefreshCwIcon data-icon="inline-start" />}
          {copy.settings.redetect}
        </Button>
      </div>
    </Section>
  )
}
