import { CircleCheckIcon, CircleXIcon, TriangleAlertIcon } from "lucide-react"
import { useFormContext, useWatch } from "react-hook-form"
import { useShallow } from "zustand/react/shallow"

import type { Asset, IpcError } from "@/bindings"
import { EnvBadge } from "@/components/app/EnvBadge"
import { PROBE_STATE, ProbeStateIcon, TONE_TEXT } from "@/components/app/StateBadge"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useMinuteTick } from "@/hooks/use-minute-tick"
import { copy, ipcErrorText } from "@/lib/copy"
import { formatRelative } from "@/lib/format"
import type { AssetFormValues } from "@/lib/schemas"
import { cn } from "@/lib/utils"
import { useAssetStore } from "@/stores/assets"
import { selectMountsBySkill, useMountStore } from "@/stores/mounts"
import { isProbing, useProbeStore } from "@/stores/probe"
import { selectSkillOfAsset, useSkillStore } from "@/stores/skills"
import { useUIStore, type AssetTab } from "@/stores/ui"
import { countTabErrors, FORM_TABS } from "./assetForm"
import { ConnectionTab } from "./tabs/ConnectionTab"
import { GuardrailsTab } from "./tabs/GuardrailsTab"
import { MountsTab } from "./tabs/MountsTab"
import { OverviewTab } from "./tabs/OverviewTab"
import { PathsTab } from "./tabs/PathsTab"
import { ServicesTab } from "./tabs/ServicesTab"

const TABS: AssetTab[] = [...FORM_TABS, "mounts"]

function ProbeStatus({ asset }: { asset: Asset }) {
  const probing = useProbeStore((s) => isProbing(s, asset.id))
  useMinuteTick()
  const { status, lastSuccessAt } = asset.probe
  const text = probing
    ? copy.probing
    : status === "never"
      ? copy.probeState.never
      : status === "failed"
        ? copy.editor.failedAt
        : lastSuccessAt
          ? (status === "stale" ? copy.editor.staleAt : copy.editor.probedAt)(formatRelative(lastSuccessAt))
          : copy.probeState[status]
  return (
    <span className={cn("flex items-center gap-1", !probing && status !== "ok" && TONE_TEXT[PROBE_STATE[status].tone])}>
      <ProbeStateIcon state={status} probing={probing} className="[&_svg]:size-3.5" />
      <span aria-hidden={probing || undefined}>{text}</span>
    </span>
  )
}

function CompileStatus({ asset, dirty, onShowLint }: { asset: Asset; dirty: boolean; onShowLint: () => void }) {
  const skill = useSkillStore((s) => selectSkillOfAsset(s.statusById, asset.id))
  const saved = useAssetStore((s) => s.lastSaved[asset.id])
  const variant = skill?.variants.find((v) => v.mode === asset.guardrails.defaultMode)
  if (!variant && !saved) return null
  const errors = variant ? variant.lint.filter((l) => l.level === "error").length : (saved?.errors ?? 0)
  const warnings = variant ? variant.lint.filter((l) => l.level === "warning").length : 0
  const blocked = variant ? variant.blocked : !!saved?.blocked

  return (
    <span role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {blocked ? (
        <Button
          variant="link"
          size="xs"
          className="h-auto gap-1 p-0 text-xs text-destructive"
          onClick={onShowLint}
          aria-label={`${copy.editor.compileBlocked(errors)}，${copy.editor.compileBlockedAction}`}
        >
          <CircleXIcon />
          {copy.editor.compileBlocked(errors)}
        </Button>
      ) : (
        <span className="flex items-center gap-1 text-success">
          <CircleCheckIcon className="size-3.5" aria-hidden />
          {saved && !dirty ? copy.editor.savedCompiled : copy.editor.compileOk}
        </span>
      )}
      {!blocked && warnings > 0 && (
        <span className="flex items-center gap-1 text-warning">
          <TriangleAlertIcon className="size-3.5" aria-hidden />
          {copy.editor.compileWarning(warnings)}
        </span>
      )}
    </span>
  )
}

function EditorHeader({
  asset,
  onShowLint,
}: {
  asset: Asset | undefined
  onShowLint: () => void
}) {
  const {
    control,
    formState: { isDirty },
  } = useFormContext<AssetFormValues>()
  const [name, envTag, alias] = useWatch({ control, name: ["name", "envTag", "sshAlias"] })
  const skill = useSkillStore((s) => selectSkillOfAsset(s.statusById, asset?.id ?? null))
  const mounts = useMountStore(useShallow((s) => selectMountsBySkill(s.byId, skill?.id)))

  return (
    <div className="flex flex-col gap-1.5 border-b px-3 py-2.5">
      <div className="flex min-w-0 items-center gap-2">
        <h2 className="min-w-0 truncate text-base font-semibold">
          {name.trim() || asset?.name || copy.editor.newTitle}
        </h2>
        <EnvBadge env={envTag} />
        {alias && (
          <Badge variant="outline" className="max-w-40 font-mono">
            <span className="truncate">{alias}</span>
          </Badge>
        )}
        {isDirty && <Badge variant="secondary">{copy.editor.unsaved}</Badge>}
      </div>
      <div className="flex min-h-5 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {asset ? (
          <>
            <ProbeStatus asset={asset} />
            <span>{mounts.length ? copy.editor.mounted(mounts.length) : copy.editor.notMounted}</span>
            <CompileStatus asset={asset} dirty={isDirty} onShowLint={onShowLint} />
          </>
        ) : (
          <span>{copy.editor.notSavedYet}</span>
        )}
      </div>
    </div>
  )
}

/** 资产编辑器（PRD 6.4）：头部状态行 + 六个标签页。表单实例由 AssetsView 持有，预览面板共用 */
export function AssetEditor({
  asset,
  slugLocked,
  saveError,
  onRetrySave,
  onOpenLogs,
  onRename,
  onShowLint,
}: {
  asset: Asset | undefined
  slugLocked: boolean
  saveError: IpcError | null
  onRetrySave: () => void
  onOpenLogs: () => void
  onRename: () => void
  onShowLint: () => void
}) {
  const {
    control,
    formState: { errors, submitCount },
  } = useFormContext<AssetFormValues>()
  const defaultMode = useWatch({ control, name: "defaultMode" })
  const tab = useUIStore((s) => s.assetTab)
  const setTab = useUIStore((s) => s.setAssetTab)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <EditorHeader asset={asset} onShowLint={onShowLint} />
      {saveError && (
        <Alert variant="destructive" className="mx-3 mt-3 w-auto">
          <CircleXIcon />
          <AlertTitle>{copy.editor.saveFailed}</AlertTitle>
          <AlertDescription className="flex flex-col gap-2">
            <span>{ipcErrorText(saveError.id, saveError.params)}</span>
            <span className="flex gap-1.5">
              <Button size="xs" variant="outline" onClick={onRetrySave}>
                {copy.common.retry}
              </Button>
              {saveError.id === "internal" && (
                <Button size="xs" variant="outline" onClick={onOpenLogs}>
                  {copy.common.openLogs}
                </Button>
              )}
            </span>
          </AlertDescription>
        </Alert>
      )}
      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as AssetTab)}
        className="flex min-h-0 flex-1 flex-col gap-0"
      >
        <div className="border-b px-3 pt-1">
          <TabsList variant="line" aria-label={copy.editor.tabsLabel} className="max-w-full justify-start overflow-x-auto">
            {TABS.map((t) => {
              const n = submitCount > 0 && t !== "mounts" ? countTabErrors(errors, t) : 0
              return (
                <TabsTrigger key={t} value={t} className="flex-none">
                  {copy.editor.tabs[t]}
                  {n > 0 && (
                    <Badge variant="destructive" className="h-4 min-w-4 px-1 tabular-nums">
                      <span aria-hidden>{n}</span>
                      <span className="sr-only">{copy.editor.tabErrors(n)}</span>
                    </Badge>
                  )}
                </TabsTrigger>
              )
            })}
          </TabsList>
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <div className="p-3 pb-6">
            <TabsContent value="overview">
              <OverviewTab slugLocked={slugLocked} onRename={onRename} />
            </TabsContent>
            <TabsContent value="connection">
              <ConnectionTab asset={asset} />
            </TabsContent>
            <TabsContent value="paths">
              <PathsTab />
            </TabsContent>
            <TabsContent value="services">
              <ServicesTab asset={asset} />
            </TabsContent>
            <TabsContent value="guardrails">
              <GuardrailsTab />
            </TabsContent>
            <TabsContent value="mounts">
              <MountsTab assetId={asset?.id ?? null} defaultMode={defaultMode} />
            </TabsContent>
          </div>
        </ScrollArea>
      </Tabs>
    </div>
  )
}
