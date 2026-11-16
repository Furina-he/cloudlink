import { useEffect, useRef } from "react"

import type { ExecutionRequest } from "@/bindings"
import { InvocationAvatar, invocationName } from "@/components/app/InvocationAvatar"
import { Button } from "@/components/ui/button"
import { Item, ItemActions, ItemContent, ItemHeader, ItemMedia, ItemTitle } from "@/components/ui/item"
import { Spinner } from "@/components/ui/spinner"
import { copy, ipcErrorText } from "@/lib/copy"
import { formatRelative } from "@/lib/format"
import { useAssetStore } from "@/stores/assets"
import { useExecutionStore } from "@/stores/execution"

/** Original Ask Card composition: source/resource, complete command, allow once / deny. */
export function ExecutionCard({ request }: { request: ExecutionRequest }) {
  const name = useAssetStore((state) => state.byId[request.assetId]?.name ?? copy.feed.deletedAsset)
  const busy = useExecutionStore((state) => state.busyIds.includes(request.requestId))
  const error = useExecutionStore((state) => state.errorsById[request.requestId])
  const focusId = useExecutionStore((state) => state.focusId)
  const ref = useRef<HTMLDivElement>(null)
  const textId = `execution-command-${request.requestId}`
  useEffect(() => {
    if (focusId !== request.requestId) return
    ref.current?.focus({ preventScroll: true })
    ref.current?.scrollIntoView({ block: "nearest" })
  }, [focusId, request.requestId])

  return (
    <Item id={`execution-${request.requestId}`} ref={ref} role="listitem" tabIndex={-1} className="items-start rounded-none border-0 px-3.5 py-3">
      <ItemHeader>
        <div className="flex min-w-0 items-center gap-2.5">
          <ItemMedia><InvocationAvatar caller={request.caller} channel="runner" /></ItemMedia>
          <ItemTitle className="line-clamp-none">{copy.execution.ask(name, invocationName(request.caller))}</ItemTitle>
        </div>
        <time dateTime={request.createdAt} className="shrink-0 text-xs text-muted-foreground tabular-nums">{formatRelative(request.createdAt)}</time>
      </ItemHeader>
      <ItemContent className="min-w-0 gap-2 pl-8">
        <code id={textId} className="font-mono text-xs whitespace-pre-wrap wrap-anywhere select-text">{request.command}</code>
        {request.state === "waiting" ? (
          <ItemActions>
            <Button size="sm" disabled={busy} aria-describedby={textId} onClick={() => void useExecutionStore.getState().respond(request.requestId, "allow-once")}>
              {busy && <Spinner data-icon="inline-start" aria-hidden />}
              {copy.execution.allow}
            </Button>
            <Button variant="outline" size="sm" disabled={busy} aria-describedby={textId} onClick={() => void useExecutionStore.getState().respond(request.requestId, "deny")}>
              {copy.execution.deny}
            </Button>
          </ItemActions>
        ) : (
          <p role="status" aria-live="polite" className="text-xs text-muted-foreground">{copy.execution.state[request.state]}</p>
        )}
        {error && <p role="alert" className="text-xs text-destructive">{ipcErrorText(error.id, error.params)}</p>}
      </ItemContent>
    </Item>
  )
}
