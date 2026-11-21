import { z } from "zod"

import type { CliScopeItem, CloudScopeConfig } from "@/bindings"

export const cloudScopeSchema = z.object({
  mode: z.enum(["auto", "manual"]),
  selectedIds: z.array(z.string()),
  excludedIds: z.array(z.string()),
})
export type CloudScopeDraft = z.infer<typeof cloudScopeSchema>

export function cloudScopeDraft(config?: CloudScopeConfig, scope: CliScopeItem[] = []): CloudScopeDraft {
  return {
    mode: config?.mode ?? "manual",
    selectedIds: [...(config?.selectedIds ?? scope.filter((item) => item.selected).map((item) => item.id))],
    excludedIds: [...(config?.excludedIds ?? [])],
  }
}

/** Stable IDs, not names, carry both manual selections and automatic exclusions. */
export function cloudProvidedIds(draft: CloudScopeDraft, scope: CliScopeItem[]): string[] {
  return scope
    .filter((item) =>
      draft.mode === "auto" ? !draft.excludedIds.includes(item.id) : draft.selectedIds.includes(item.id)
    )
    .map((item) => item.id)
}

export function cloudSetProvided(draft: CloudScopeDraft, id: string, on: boolean): CloudScopeDraft {
  const key = draft.mode === "auto" ? "excludedIds" : "selectedIds"
  const add = draft.mode === "auto" ? !on : on
  const values = draft[key].filter((value) => value !== id)
  return { ...draft, [key]: add ? [...values, id] : values }
}

/** The first auto→manual switch captures today's provided items; subsequent switches preserve edits. */
export function cloudSwitchMode(
  draft: CloudScopeDraft,
  mode: CloudScopeDraft["mode"],
  scope: CliScopeItem[],
  manualVisited: boolean
): CloudScopeDraft {
  return {
    ...draft,
    mode,
    selectedIds: mode === "manual" && !manualVisited ? cloudProvidedIds(draft, scope) : draft.selectedIds,
  }
}
