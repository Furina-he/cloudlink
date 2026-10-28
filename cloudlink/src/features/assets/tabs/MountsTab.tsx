import { BotIcon, EyeIcon, FolderGit2Icon, WrenchIcon } from "lucide-react"
import { useMemo } from "react"
import { useShallow } from "zustand/react/shallow"

import type { Mode, Target } from "@/bindings"
import { MountStatusBadge } from "@/components/app/StateBadge"
import { Button } from "@/components/ui/button"
import {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
} from "@/components/ui/combobox"
import { Field, FieldDescription, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import { useMountPipeline } from "@/features/mounts/useMountPipeline"
import { copy } from "@/lib/copy"
import { selectMountsBySkill, useMountStore } from "@/stores/mounts"
import { selectSkillOfAsset, useSkillStore } from "@/stores/skills"
import { useTargetStore } from "@/stores/targets"
import { useUIStore } from "@/stores/ui"

const ModeIcon = ({ mode }: { mode: Mode }) =>
  mode === "read-only" ? <EyeIcon className="size-3.5" aria-hidden /> : <WrenchIcon className="size-3.5" aria-hidden />

function targetLine(t: Target) {
  return `${copy.env.long(t.envId)} · ${t.kind === "agent-global" ? copy.mountsTab.groupGlobal : copy.mountsTab.groupProject}`
}

/** 本资产的挂载（PRD 6.4 挂载页）：列表 + 「挂载到…」+ 去挂载中心的链接 */
export function MountsTab({ assetId, defaultMode }: { assetId: string | null; defaultMode: Mode }) {
  const skill = useSkillStore((s) => selectSkillOfAsset(s.statusById, assetId))
  const mounts = useMountStore(useShallow((s) => selectMountsBySkill(s.byId, skill?.id)))
  const targets = useTargetStore((s) => s.targets)
  const { requestMount, dialog } = useMountPipeline()

  const mountedTargets = new Set(mounts.map((m) => m.targetId))
  const groups = useMemo(
    () =>
      [
        { value: copy.mountsTab.groupGlobal, items: targets.filter((t) => t.kind === "agent-global") },
        { value: copy.mountsTab.groupProject, items: targets.filter((t) => t.kind === "project") },
      ].filter((g) => g.items.length > 0),
    [targets]
  )

  if (!assetId || !skill) {
    return <p className="rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground">{copy.mountsTab.unsaved}</p>
  }

  return (
    <div className="flex flex-col gap-6">
      <FieldSet className="min-w-0 gap-3">
        <FieldLegend variant="label" className="mb-0">
          {copy.mountsTab.title}
        </FieldLegend>
        {mounts.length > 0 ? (
          <ItemGroup className="gap-1.5">
            {mounts.map((m) => {
              const t = targets.find((x) => x.id === m.targetId)
              return (
                <Item key={m.id} size="xs" variant="outline">
                  <ItemMedia>
                    {t?.kind === "agent-global" ? <BotIcon className="size-4" /> : <FolderGit2Icon className="size-4" />}
                  </ItemMedia>
                  <ItemContent className="min-w-0">
                    <ItemTitle className="w-full truncate">{t?.label ?? m.targetId}</ItemTitle>
                    <ItemDescription className="flex items-center gap-1.5">
                      {t && <span>{targetLine(t)}</span>}
                      <span aria-hidden>·</span>
                      <span className="flex items-center gap-1">
                        <ModeIcon mode={m.mode} />
                        {copy.mode[m.mode]}
                      </span>
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <MountStatusBadge mount={m} />
                  </ItemActions>
                </Item>
              )
            })}
          </ItemGroup>
        ) : (
          <p className="text-sm text-muted-foreground">{copy.mountsTab.empty}</p>
        )}
      </FieldSet>

      <Field>
        <FieldLabel htmlFor="mount-to">{copy.mountsTab.mountTo}</FieldLabel>
        <Combobox
          items={groups}
          value={null}
          onValueChange={(t: Target | null) => {
            if (t) void requestMount({ skillId: skill.id, targetId: t.id, mode: defaultMode })
          }}
          itemToStringLabel={(t: Target) => t.label}
          isItemEqualToValue={(a: Target, b: Target) => a.id === b.id}
          autoHighlight
        >
          <ComboboxInput
            id="mount-to"
            placeholder={copy.mountsTab.mountToPlaceholder}
            className="w-full max-w-sm"
            triggerLabel={copy.common.showOptions}
            aria-describedby="mount-to-hint"
          />
          <ComboboxContent>
            <ComboboxEmpty>{copy.common.noOptions}</ComboboxEmpty>
            <ComboboxList>
              {(group: { value: string; items: Target[] }) => (
                <ComboboxGroup key={group.value} items={group.items}>
                  <ComboboxLabel>{group.value}</ComboboxLabel>
                  <ComboboxCollection>
                    {(t: Target) => (
                      <ComboboxItem key={t.id} value={t} disabled={mountedTargets.has(t.id)}>
                        <span className="truncate">{t.label}</span>
                        <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                          {mountedTargets.has(t.id) ? copy.mountsTab.already : copy.env.long(t.envId)}
                        </span>
                      </ComboboxItem>
                    )}
                  </ComboboxCollection>
                </ComboboxGroup>
              )}
            </ComboboxList>
          </ComboboxContent>
        </Combobox>
        <FieldDescription id="mount-to-hint">
          {copy.mountsTab.modeHint(copy.mode[defaultMode])}
        </FieldDescription>
      </Field>

      <div>
        <Button
          type="button"
          variant="link"
          className="px-0"
          onClick={() => useUIStore.getState().setView("mounts")}
        >
          {copy.mountsTab.viewInCenter}
        </Button>
      </div>
      {dialog}
    </div>
  )
}
