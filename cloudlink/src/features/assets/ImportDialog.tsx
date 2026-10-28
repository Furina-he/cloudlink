import { CircleXIcon, FileInputIcon } from "lucide-react"
import { useEffect, useState } from "react"
import { useShallow } from "zustand/react/shallow"

import type { EnvId, IpcError } from "@/bindings"
import { DiscardChangesDialog } from "@/components/app/DiscardChangesDialog"
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Field, FieldLabel } from "@/components/ui/field"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { toast } from "@/components/ui/toast"
import { useDelayedFlag } from "@/hooks/use-delayed-flag"
import { copy, ipcErrorText } from "@/lib/copy"
import { useAssetStore } from "@/stores/assets"
import { useSkillStore } from "@/stores/skills"
import { useTargetStore } from "@/stores/targets"
import { useUIStore } from "@/stores/ui"

const envNames = (ids: EnvId[]) => ids.map(copy.env.short).join("、")
const DASH = <span className="text-muted-foreground">—</span>

/** 从 ssh config 导入（PRD 6.10、F-102）。挂在 App 上，命令面板在任何视图都能打开 */
export function ImportDialog() {
  const open = useUIStore((s) => s.importOpen)
  const { list, status, error } = useTargetStore(
    useShallow((s) => ({ list: s.sshHosts, status: s.sshHostsStatus, error: s.sshHostsError }))
  )
  // null 表示还没动过：默认勾选全部「新」主机（F-102 AC3：已导入的默认不勾）
  const [picked, setPicked] = useState<Set<string> | null>(null)
  const [probeAfter, setProbeAfter] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const loading = status === "loading" || status === "idle"
  const showSkeleton = useDelayedFlag(open && loading)

  useEffect(() => {
    if (open) void useTargetStore.getState().loadSshHosts()
  }, [open])

  const hosts = list?.hosts ?? []
  const selected = picked ?? new Set(hosts.filter((h) => !h.imported).map((h) => h.alias))
  const dirty = picked !== null || probeAfter
  const allChecked = hosts.length > 0 && hosts.every((h) => selected.has(h.alias))
  const someChecked = hosts.some((h) => selected.has(h.alias))

  const close = () => {
    useUIStore.getState().setImportOpen(false)
    setPicked(null)
    setProbeAfter(false)
  }
  const toggle = (alias: string, on: boolean) => {
    const next = new Set(selected)
    if (on) next.add(alias)
    else next.delete(alias)
    setPicked(next)
  }

  const submit = async () => {
    const chosen = hosts.filter((h) => selected.has(h.alias))
    if (!chosen.length) return
    setSubmitting(true)
    try {
      const created = await useAssetStore
        .getState()
        .importHosts(chosen.map((h) => ({ alias: h.alias, definedIn: h.definedIn })), probeAfter)
      close()
      void useSkillStore.getState().refresh()
      toast.add({ title: copy.importDialog.done(created.length), type: "success" })
      // 导入后自动选中第一项（PRD 6.10）
      const ui = useUIStore.getState()
      ui.setView("assets")
      if (created[0]) useUIStore.getState().selectAsset(created[0].id)
    } catch (e) {
      const err = e as IpcError
      toast.add({ title: ipcErrorText(err.id, err.params), type: "error" })
    } finally {
      setSubmitting(false)
    }
  }

  let body
  if (status === "error") {
    body = (
      <Alert variant="destructive">
        <CircleXIcon />
        <AlertTitle>{copy.importDialog.loadFailed}</AlertTitle>
        <AlertDescription>{error && ipcErrorText(error.id, error.params)}</AlertDescription>
        <AlertAction>
          <Button size="xs" variant="outline" onClick={() => void useTargetStore.getState().loadSshHosts()}>
            {copy.common.retry}
          </Button>
        </AlertAction>
      </Alert>
    )
  } else if (loading) {
    body = showSkeleton ? (
      <div className="flex flex-col gap-2" aria-busy="true" aria-label={copy.importDialog.loading}>
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-8" />
        ))}
      </div>
    ) : (
      <div className="h-36" />
    )
  } else if (hosts.length === 0) {
    body = (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FileInputIcon />
          </EmptyMedia>
          <EmptyTitle>{copy.importDialog.emptyTitle}</EmptyTitle>
          <EmptyDescription>{copy.importDialog.emptyDescription}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  } else {
    body = (
      <ScrollArea className="max-h-[50vh] rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-9 pl-3">
                <Checkbox
                  checked={allChecked}
                  indeterminate={someChecked && !allChecked}
                  onCheckedChange={(on) => setPicked(new Set(on ? hosts.map((h) => h.alias) : []))}
                  aria-label={copy.importDialog.selectAll}
                />
              </TableHead>
              <TableHead>{copy.importDialog.columns.alias}</TableHead>
              <TableHead>{copy.importDialog.columns.hostname}</TableHead>
              <TableHead>{copy.importDialog.columns.user}</TableHead>
              <TableHead>{copy.importDialog.columns.port}</TableHead>
              <TableHead>{copy.importDialog.columns.envs}</TableHead>
              <TableHead>{copy.importDialog.columns.status}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {hosts.map((h) => (
              <TableRow key={h.alias} data-state={selected.has(h.alias) ? "selected" : undefined}>
                <TableCell className="pl-3">
                  <Checkbox
                    checked={selected.has(h.alias)}
                    onCheckedChange={(on) => toggle(h.alias, on === true)}
                    aria-label={copy.importDialog.selectRow(h.alias)}
                  />
                </TableCell>
                <TableCell className="font-mono">{h.alias}</TableCell>
                <TableCell className="font-mono text-xs">{h.hostname ?? DASH}</TableCell>
                <TableCell className="font-mono text-xs">{h.user ?? DASH}</TableCell>
                <TableCell className="font-mono text-xs tabular-nums">{h.port ?? DASH}</TableCell>
                <TableCell>{envNames(h.definedIn)}</TableCell>
                <TableCell>
                  <Badge variant={h.imported ? "secondary" : "outline"}>
                    {h.imported ? copy.importDialog.statusImported : copy.importDialog.statusNew}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </ScrollArea>
    )
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) return
        if (dirty && !submitting) setConfirmDiscard(true)
        else close()
      }}
    >
      <DialogContent className="grid-cols-[minmax(0,1fr)] sm:max-w-3xl" closeLabel={copy.common.close}>
        <DialogHeader>
          <DialogTitle>{copy.importDialog.title}</DialogTitle>
          <DialogDescription className="flex flex-wrap gap-x-4 gap-y-1">
            {list && list.scanned.length > 0 && (
              <>
                <span>{copy.importDialog.scanned}</span>
                {list.scanned.map((s) => (
                  <span key={s.envId} className="flex gap-1.5">
                    {copy.env.long(s.envId)}
                    <span className="font-mono text-xs leading-5">{s.path}</span>
                  </span>
                ))}
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        {body}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {list && list.skippedPatterns.length > 0 &&
              copy.importDialog.skipped(
                list.skippedPatterns.length,
                list.skippedPatterns.map((p) => `Host ${p}`).join("、")
              )}
          </p>
          <Field orientation="horizontal" className="w-auto">
            <Switch id="import-probe-after" checked={probeAfter} onCheckedChange={setProbeAfter} />
            <FieldLabel htmlFor="import-probe-after" className="font-normal">
              {copy.importDialog.probeAfter}
            </FieldLabel>
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => (dirty ? setConfirmDiscard(true) : close())}>
            {copy.common.cancel}
          </Button>
          <Button disabled={selected.size === 0 || submitting || loading} onClick={() => void submit()}>
            {submitting && <Spinner data-icon="inline-start" aria-hidden />}
            {copy.importDialog.submit(selected.size)}
          </Button>
        </DialogFooter>
      </DialogContent>
      <DiscardChangesDialog
        open={confirmDiscard}
        onKeep={() => setConfirmDiscard(false)}
        onDiscard={() => {
          setConfirmDiscard(false)
          close()
        }}
      />
    </Dialog>
  )
}
