import { z } from "zod"

import type { CliScopeItem, GithubConfig } from "@/bindings"

export const githubScopeSchema = z.object({
  ownerLogin: z.string(),
  mode: z.enum(["auto", "manual"]),
  selectedRepoIds: z.array(z.string()),
  excludedRepoIds: z.array(z.string()),
})
export type GithubScopeDraft = z.infer<typeof githubScopeSchema>

export function githubDraft(config?: GithubConfig, scope: CliScopeItem[] = []): GithubScopeDraft {
  return {
    ownerLogin: config?.owner?.login ?? "",
    mode: config?.mode ?? "manual",
    selectedRepoIds: [...(config?.selectedRepoIds ?? scope.filter((repo) => repo.selected).map((repo) => repo.id))],
    excludedRepoIds: [...(config?.excludedRepoIds ?? [])],
  }
}

/** Stable IDs, not names, carry both manual selections and automatic exclusions. */
export function githubProvidedIds(draft: GithubScopeDraft, scope: CliScopeItem[]): string[] {
  return scope.filter((repo) => draft.mode === "auto" ? !draft.excludedRepoIds.includes(repo.id) : draft.selectedRepoIds.includes(repo.id)).map((repo) => repo.id)
}

export function githubSetProvided(draft: GithubScopeDraft, id: string, on: boolean): GithubScopeDraft {
  const key = draft.mode === "auto" ? "excludedRepoIds" : "selectedRepoIds"
  const add = draft.mode === "auto" ? !on : on
  const values = draft[key].filter((value) => value !== id)
  return { ...draft, [key]: add ? [...values, id] : values }
}

/** The first auto→manual switch takes today's visible grant; subsequent switches preserve edits. */
export function githubSwitchMode(draft: GithubScopeDraft, mode: GithubScopeDraft["mode"], scope: CliScopeItem[], manualVisited: boolean): GithubScopeDraft {
  return {
    ...draft,
    mode,
    selectedRepoIds: mode === "manual" && !manualVisited ? githubProvidedIds(draft, scope) : draft.selectedRepoIds,
  }
}

export function githubComplete(config?: GithubConfig): boolean {
  if (!config?.owner || config.migrationPending) return false
  const snapshots = Object.values(config.envStates).filter((snapshot) => !!snapshot)
  return snapshots.length > 0 && snapshots.every((snapshot) => snapshot?.status === "complete" && snapshot.owner?.id === config.owner?.id && !!snapshot.identity)
}

export function githubExpands(draft: GithubScopeDraft, initial: GithubScopeDraft, scope: CliScopeItem[], initiallyProvided: string[]): boolean {
  return draft.ownerLogin !== initial.ownerLogin
    || draft.mode === "auto" && initial.mode !== "auto"
    || githubProvidedIds(draft, scope).some((id) => !initiallyProvided.includes(id))
}
