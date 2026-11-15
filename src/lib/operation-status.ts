import type { Operation } from "@/bindings"
import type { DotTone } from "@/components/app/StatusDot"
import { copy } from "./copy"

/** Permission decisions and observed execution outcomes are deliberately not interchangeable. */
export function operationStatus(operation: Operation): { text: string; tone: DotTone } {
  if (operation.checked === false || operation.source === "runner" && operation.checked !== true) return { text: copy.execution.unchecked, tone: "warn" }
  if (operation.source === "runner" && operation.executionState) {
    const state = operation.executionState
    if (state === "succeeded" && operation.exitCode !== 0) return { text: copy.execution.state.unknown, tone: "warn" }
    if (state === "failed" && operation.exitCode === undefined) return { text: copy.execution.startFailed, tone: "err" }
    const tone: DotTone = state === "succeeded" ? "ok" : ["failed", "denied", "rejected"].includes(state) ? "err" : ["expired", "unknown"].includes(state) ? "warn" : "off"
    return { text: copy.execution.state[state], tone }
  }
  if (operation.decision === "denied") return { text: copy.feed.denied, tone: "err" }
  if (operation.reasonId === "unparsed") return { text: copy.feed.unparsed, tone: "warn" }
  return { text: copy.feed.allowed, tone: "off" }
}
