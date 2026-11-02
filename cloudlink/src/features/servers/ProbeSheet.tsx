import { CircleCheckIcon, CircleXIcon, FileCodeIcon, PlugIcon, RadarIcon, TriangleAlertIcon } from "lucide-react"
import { motion } from "motion/react"
import { lazy, Suspense, useState } from "react"

import type { Asset, ProbeError } from "@/bindings"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { CodeBlock, CodeBlockActions, CodeBlockContent, CodeBlockCopyButton } from "@/components/ui/code-block"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "@/components/ui/toast"
import { Trace, TraceDescription, TraceIcon, TraceLine, TraceTitle } from "@/components/ui/trace"
import { useMinuteTick } from "@/hooks/use-minute-tick"
import { copy } from "@/lib/copy"
import { formatDateTime, formatDuration, formatRelative } from "@/lib/format"
import { useAssetStore } from "@/stores/assets"
import { selectActiveRun, useProbeStore, type ProbeRun } from "@/stores/probe"
import { useUIStore } from "@/stores/ui"
import { serverActions, toastError } from "./actions"
import { AppliedChanges, HeldChanges } from "./ProbeChanges"

const ProbeScriptDialog = lazy(() => import("./ProbeScriptDialog"))

/** 探测步骤逐条出现（PRD 7.7：新步骤 150ms 淡入）；回看已结束的探测时不再播放 */
function Steps({ run }: { run: ProbeRun }) {
  const animate = run.status === "running"
  return (
    <Trace role="list" aria-label={copy.probeSheet.title}>
      {run.steps.map((s) => {
        const Icon = s.status === "done" ? CircleCheckIcon : s.status === "error" ? CircleXIcon : null
        return (
          <motion.div key={s.step} role="listitem" initial={animate ? { opacity: 0, y: 4 } : false} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.15 }}>
            <TraceLine status={s.status === "running" ? "running" : s.status === "error" ? "error" : undefined}>
              <TraceIcon>{Icon ? <Icon className={s.status === "done" ? "text-success" : undefined} /> : <Spinner aria-hidden />}</TraceIcon>
              <TraceTitle>{copy.probeStep[s.step]}</TraceTitle>
              <span className="sr-only">{copy.probeStepStatus[s.status]}</span>
              {s.ms != null && <TraceDescription className="tabular-nums">{formatDuration(s.ms)}</TraceDescription>}
            </TraceLine>
          </motion.div>
        )
      })}
    </Trace>
  )
}

/** 失败：分类文案和建议（8.3）；要在终端执行的命令用 CodeBlock 配复制按钮；可以直接测试连接 */
function Failure({ asset, error }: { asset: Asset; error: ProbeError | undefined }) {
  const e = error ?? { id: "unknown" as const, params: { alias: asset.connection.sshAlias } }
  const commands = copy.sshCommands[e.id]?.(e.params)
  return (
    <div className="flex flex-col gap-3">
      <Alert variant="destructive">
        <CircleXIcon />
        <AlertTitle>{copy.sshError[e.id].title(e.params)}</AlertTitle>
        <AlertDescription>{copy.sshError[e.id].hint(e.params)}</AlertDescription>
      </Alert>
      {commands && (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs text-muted-foreground">{copy.probeSheet.commands}</p>
          {commands.map((c) => (
            <CodeBlock key={c} size="sm">
              <CodeBlockActions>
                <CodeBlockCopyButton value={c} labels={{ copy: copy.common.copy, copied: copy.common.copied }} />
              </CodeBlockActions>
              <CodeBlockContent>{c}</CodeBlockContent>
            </CodeBlock>
          ))}
        </div>
      )}
      {e.id !== "partial" && (
        <div>
          <Button variant="outline" size="sm" onClick={() => serverActions.test(asset)}>
            <PlugIcon data-icon="inline-start" />
            {copy.probeSheet.testNow}
          </Button>
        </div>
      )}
    </div>
  )
}

/** 从未在本次会话里探测过：说明上一次的结果 */
function IdleNote({ asset }: { asset: Asset }) {
  const now = useMinuteTick()
  const { lastSuccessAt, status } = asset.probe
  return (
    <p className="text-sm text-muted-foreground">
      {lastSuccessAt ? copy.probeSheet.lastProbed(formatRelative(lastSuccessAt, now), copy.probeState[status]) : copy.probeSheet.idle(asset.connection.sshAlias)}
    </p>
  )
}

function Note({ children }: { children: string }) {
  return <p className="text-sm text-muted-foreground">{children}</p>
}

/** 成功：已更新几处（自动合并）、待确认几处（疑似注入）；没有变化时只有一行（PRD 6.4） */
function Result({ run, selected, onSelect }: { run: ProbeRun; selected: Set<string>; onSelect: (id: string, on: boolean) => void }) {
  const pending = run.held.filter((c) => !run.confirmedIds.includes(c.id))
  return (
    <div className="flex flex-col gap-4">
      {run.error?.id === "partial" && (
        <Alert>
          <TriangleAlertIcon className="text-warning!" />
          <AlertTitle>{copy.probeSheet.partialTitle}</AlertTitle>
          <AlertDescription>{copy.sshError.partial.title(run.error.params)}</AlertDescription>
        </Alert>
      )}
      {run.applied.length === 0 && run.held.length === 0 && <Note>{copy.probeSheet.noChanges}</Note>}
      {run.applied.length > 0 && <AppliedChanges changes={run.applied} undone={run.undone} />}
      {pending.length > 0 && <HeldChanges changes={pending} selected={selected} onSelect={onSelect} />}
      {run.confirmedIds.length > 0 && <Note>{copy.probeSheet.confirmed(run.confirmedIds.length)}</Note>}
    </div>
  )
}

function ProbeBody({ asset, run, starting, onViewScript }: { asset: Asset; run: ProbeRun | undefined; starting: boolean; onViewScript: () => void }) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<"undo" | "merge" | null>(null)
  const alias = asset.connection.sshAlias
  // 刚点了「重新探测」、新的 runId 还没回来：按运行中显示，不再显示上一次的结果
  const state = starting && run?.status !== "running" ? "running" : (run?.status ?? "idle")
  const shown = state === "running" && run?.status !== "running" ? undefined : run
  const pending = shown?.held.filter((c) => !shown.confirmedIds.includes(c.id)) ?? []
  const canUndo = state === "ok" && !!shown && shown.applied.length > 0 && !shown.undone

  const act = async (kind: "undo" | "merge") => {
    if (!shown) return
    setBusy(kind)
    try {
      if (kind === "undo") {
        await useProbeStore.getState().undo(shown.runId)
        toast.add({ title: copy.probeToast.undone(alias) })
      } else {
        const ids = [...selected]
        await useProbeStore.getState().confirmItems(shown.runId, ids)
        setSelected(new Set())
        toast.add({ title: copy.probeSheet.confirmed(ids.length) })
      }
    } catch (e) {
      toastError(e)
    } finally {
      setBusy(null)
    }
  }
  const select = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })

  return (
    <>
      <SheetHeader className="pr-12">
        <SheetTitle className="flex min-w-0 items-center gap-2">
          {copy.probeSheet.stateTitle[state]}
          <span className="truncate font-mono">{alias}</span>
        </SheetTitle>
        <SheetDescription className="tabular-nums">
          {shown?.finishedAt && state !== "running"
            ? [formatDateTime(shown.finishedAt), shown.durationMs != null && copy.probeSheet.duration(formatDuration(shown.durationMs))].filter(Boolean).join(" · ")
            : copy.probeSheet.description}
        </SheetDescription>
      </SheetHeader>
      <ScrollArea className="min-h-0 flex-1">
        <div role="status" className="flex flex-col gap-4 px-4 pb-4">
          {state === "idle" && <IdleNote asset={asset} />}
          {shown && state !== "ok" && <Steps run={shown} />}
          {state === "failed" && shown && <Failure asset={asset} error={shown.error} />}
          {state === "cancelled" && <Note>{copy.probeSheet.cancelled}</Note>}
          {state === "ok" && shown && <Result run={shown} selected={selected} onSelect={select} />}
        </div>
      </ScrollArea>
      <SheetFooter className="flex-row flex-wrap items-center border-t">
        <Button variant="ghost" size="sm" onClick={onViewScript}>
          <FileCodeIcon data-icon="inline-start" />
          {copy.probeSheet.viewScript}
        </Button>
        <span className="ml-auto flex flex-wrap gap-2">
          {state === "running" ? (
            <Button variant="outline" size="sm" onClick={() => serverActions.cancelProbe(asset)}>
              <Spinner data-icon="inline-start" aria-hidden />
              {copy.probeSheet.cancel}
            </Button>
          ) : canUndo || pending.length > 0 ? (
            <>
              {canUndo && (
                <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => void act("undo")}>
                  {busy === "undo" && <Spinner data-icon="inline-start" aria-hidden />}
                  {copy.probeSheet.undo}
                </Button>
              )}
              {pending.length > 0 && (
                <Button size="sm" disabled={busy !== null || selected.size === 0} onClick={() => void act("merge")}>
                  {busy === "merge" && <Spinner data-icon="inline-start" aria-hidden />}
                  {copy.probeSheet.mergeSelected(selected.size)}
                </Button>
              )}
            </>
          ) : (
            <Button variant={state === "idle" ? "default" : "outline"} size="sm" onClick={() => serverActions.probe(asset)}>
              <RadarIcon data-icon="inline-start" />
              {state === "idle" ? copy.probeSheet.start : copy.probeSheet.retry}
            </Button>
          )}
        </span>
      </SheetFooter>
    </>
  )
}

/**
 * 探测 Sheet（PRD 6.4 探测流程）。关掉 Sheet 或切换服务器，探测在后台继续；
 * 不在显示这台服务器时，完成后由 Toast 通知（stores/probe.ts）
 */
export function ProbeSheet() {
  const assetId = useUIStore((s) => s.probeSheetAssetId)
  // 关闭后保留最后一次的内容，退场动画期间文字不消失
  const [last, setLast] = useState(assetId)
  if (assetId && assetId !== last) setLast(assetId)
  const shownId = assetId ?? last
  const asset = useAssetStore((s) => (shownId ? s.byId[shownId] : undefined))
  const run = useProbeStore((s) => selectActiveRun(s, shownId))
  const starting = useProbeStore((s) => !!shownId && s.starting.includes(shownId))
  const [script, setScript] = useState({ open: false, mounted: false })

  return (
    <>
      <Sheet open={!!assetId && !!asset} onOpenChange={(open) => !open && useUIStore.getState().closeProbeSheet()}>
        <SheetContent side="right" closeLabel={copy.common.close} className="gap-0 data-[side=right]:w-[min(560px,60vw)] data-[side=right]:min-w-[min(420px,100vw)] data-[side=right]:sm:max-w-none">
          {asset && <ProbeBody key={run?.runId ?? "idle"} asset={asset} run={run} starting={starting} onViewScript={() => setScript({ open: true, mounted: true })} />}
        </SheetContent>
      </Sheet>
      {script.mounted && (
        <Suspense fallback={null}>
          <ProbeScriptDialog open={script.open} onOpenChange={(open) => setScript((s) => ({ ...s, open }))} />
        </Suspense>
      )}
    </>
  )
}
