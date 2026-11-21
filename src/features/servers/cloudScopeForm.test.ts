import { describe, expect, it } from "vitest"

import type { CliScopeItem } from "@/bindings"
import { cloudProvidedIds, cloudScopeDraft, cloudSetProvided, cloudSwitchMode } from "./cloudScopeForm"

const scope: CliScopeItem[] = [
  { id: "zone:a", kind: "zone", name: "example.com", selected: true },
  { id: "worker:api", kind: "worker", name: "api", selected: false },
]

describe("cloudScopeForm", () => {
  it("defaults legacy assets without cloudScope conservatively to manual", () => {
    const draft = cloudScopeDraft(undefined, scope)
    expect(draft).toEqual({ mode: "manual", selectedIds: ["zone:a"], excludedIds: [] })
    expect(cloudProvidedIds(draft, scope)).toEqual(["zone:a"])
  })

  it("toggles exclusions in auto mode and selections in manual mode", () => {
    const auto = { mode: "auto" as const, selectedIds: [], excludedIds: [] }
    expect(cloudProvidedIds(auto, scope)).toEqual(["zone:a", "worker:api"])

    const excluded = cloudSetProvided(auto, "worker:api", false)
    expect(excluded.excludedIds).toEqual(["worker:api"])
    expect(cloudProvidedIds(excluded, scope)).toEqual(["zone:a"])

    const manual = cloudSwitchMode(excluded, "manual", scope, false)
    expect(manual).toEqual({ mode: "manual", selectedIds: ["zone:a"], excludedIds: ["worker:api"] })

    const added = cloudSetProvided(manual, "worker:api", true)
    expect(added.selectedIds).toEqual(["zone:a", "worker:api"])
    expect(cloudSwitchMode(added, "auto", scope, true).excludedIds).toEqual(["worker:api"])
  })
})
