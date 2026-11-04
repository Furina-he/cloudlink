import { CircleXIcon } from "lucide-react"
import { useEffect, useState, type ReactNode } from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { copy } from "@/lib/copy"
import { subscribeBackendEvents } from "@/lib/events"

/** Mount the app only after event subscriptions are ready, so its initial reads cannot lose events. */
export function BackendGate({ children }: { children: ReactNode }) {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading")

  useEffect(() => {
    let active = true
    let unsubscribe: (() => void) | undefined
    void subscribeBackendEvents().then(
      (off) => {
        if (!active) {
          off()
          return
        }
        unsubscribe = off
        setState("ready")
      },
      () => {
        if (active) setState("failed")
      }
    )
    return () => {
      active = false
      unsubscribe?.()
    }
  }, [attempt])

  if (state === "ready") return children

  return (
    <main className="flex h-svh items-center justify-center bg-background p-4">
      {state === "loading" ? (
        <div
          role="status"
          className="flex items-center gap-2 text-sm text-muted-foreground"
        >
          <Spinner />
          {copy.shell.starting}
        </div>
      ) : (
        <div className="flex w-full max-w-lg flex-col gap-3">
          <Alert variant="destructive">
            <CircleXIcon />
            <AlertTitle>{copy.shell.startFailed}</AlertTitle>
            <AlertDescription>{copy.shell.startFailedHint}</AlertDescription>
          </Alert>
          <Button
            className="self-start"
            onClick={() => {
              setState("loading")
              setAttempt((value) => value + 1)
            }}
          >
            {copy.shell.retry}
          </Button>
        </div>
      )}
    </main>
  )
}
