import { zodResolver } from "@hookform/resolvers/zod"
import {
  BotIcon,
  CircleXIcon,
  FolderOpenIcon,
  MonitorIcon,
  PlusIcon,
  RefreshCwIcon,
  SquareTerminalIcon,
  Trash2Icon,
  UnlinkIcon,
} from "lucide-react"
import { lazy, Suspense, useState, type ReactNode } from "react"
import { Controller, useForm } from "react-hook-form"

import type { AgentId, EnvId, IpcError, LinkMode, Mode, Settings, Target } from "@/bindings"
import { DiscardChangesDialog } from "@/components/app/DiscardChangesDialog"
import { StateBadge } from "@/components/app/StateBadge"
import { Truncate } from "@/components/app/Truncate"
import { useTheme } from "@/components/theme-provider"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { toast } from "@/components/ui/toast"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Required } from "@/features/assets/tabs/OverviewTab"
import { ValidationError } from "@/features/assets/ValidationError"
import { setLinkMode } from "@/features/mounts/TargetCard"
import { AGENTS } from "@/lib/agents"
import { copy, ipcErrorText } from "@/lib/copy"
import { ipc } from "@/lib/ipc"
import {
  customTargetSchema,
  settingsNumbersSchema,
  type CustomTargetValues,
  type SettingsNumbers,
} from "@/lib/schemas"
import { useActivityStore } from "@/stores/activity"
import { useAssetStore } from "@/stores/assets"
import { useMountStore } from "@/stores/mounts"
import { useSettingsStore } from "@/stores/settings"
import { useSkillStore } from "@/stores/skills"
import { useTargetStore } from "@/stores/targets"
import { useUIStore } from "@/stores/ui"

const ProbeScriptDialog = lazy(() => import("@/features/assets/ProbeScriptDialog"))

const MODES: Mode[] = ["read-only", "standard"]
const LINK_MODES: LinkMode[] = ["auto", "link", "copy"]
/** 可以手动启用的 Agent（PRD 4.5）；自定义目录另有入口 */
const KNOWN_AGENTS = (Object.keys(AGENTS) as AgentId[]).filter((a) => a !== "custom")

const EnvIcon = ({ envId }: { envId: string }) =>
  envId === "windows" ? <MonitorIcon className="size-4" aria-hidden /> : <SquareTerminalIcon className="size-4" aria-hidden />

/** 每个分区的外框：h2 + 说明，内容是 FieldSet（PRD 6.9） */
function Section({ id, title, hint, children }: { id: string; title: string; hint?: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`settings-${id}`} className="flex max-w-2xl min-w-0 flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id={`settings-${id}`} className="text-sm font-semibold">
          {title}
        </h2>
        {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  )
}

const update = (patch: Partial<Settings>) => void useSettingsStore.getState().update(patch)

// ---------- 通用 ----------

export function GeneralSection() {
  const { theme, setTheme } = useTheme()
  const options = ["system", "light", "dark"] as const
  return (
    <Section id="general" title={copy.settings.section.general}>
      <FieldGroup className="gap-6">
        <FieldSet className="gap-3">
          <FieldLegend variant="label" className="mb-0">
            {copy.settings.theme}
          </FieldLegend>
          <RadioGroup
            value={theme}
            onValueChange={(v) => {
              const next = v as Settings["theme"]
              setTheme(next)
              update({ theme: next })
            }}
            className="flex flex-wrap gap-4"
          >
            {options.map((t) => (
              <Field key={t} orientation="horizontal" className="w-auto">
                <RadioGroupItem value={t} id={`theme-${t}`} />
                <FieldLabel htmlFor={`theme-${t}`} className="font-normal">
                  {copy.settings.themeOption[t]}
                </FieldLabel>
              </Field>
            ))}
          </RadioGroup>
        </FieldSet>
        <Field>
          <FieldLabel htmlFor="output-language">{copy.settings.outputLanguage}</FieldLabel>
          <Input
            id="output-language"
            value={copy.settings.outputLanguageValue}
            readOnly
            aria-describedby="output-language-hint"
            className="max-w-xs text-muted-foreground"
          />
          <FieldDescription id="output-language-hint">{copy.settings.outputLanguageHint}</FieldDescription>
        </Field>
      </FieldGroup>
    </Section>
  )
}

// ---------- 运行环境 ----------

export function EnvironmentsSection({ settings }: { settings: Settings }) {
  const environments = useTargetStore((s) => s.environments)
  const detecting = useTargetStore((s) => s.status === "loading")
  const enabled = (id: EnvId) => settings.environments.find((e) => e.id === id)?.enabled ?? true
  const setEnabled = (id: EnvId, on: boolean) => {
    const list = environments.map((e) => ({ id: e.id, enabled: e.id === id ? on : enabled(e.id) }))
    update({ environments: list })
  }

  return (
    <Section id="environments" title={copy.settings.section.environments} hint={copy.settings.envList}>
      <ItemGroup className="gap-2">
        {environments.map((e) => (
          <Item key={e.id} variant="outline" size="sm">
            <ItemMedia>
              <EnvIcon envId={e.id} />
            </ItemMedia>
            <ItemContent className="min-w-0">
              <ItemTitle>
                {copy.env.long(e.id)}
                {!e.available && (
                  <StateBadge tone="danger" icon={CircleXIcon}>
                    {copy.settings.envUnavailable}
                  </StateBadge>
                )}
              </ItemTitle>
              <ItemDescription className="flex min-w-0 flex-col gap-0.5 text-xs">
                <span className="flex min-w-0 gap-1">
                  <span className="shrink-0">{copy.settings.envHome}</span>
                  <Truncate text={e.home} className="font-mono" />
                </span>
                <span className="flex min-w-0 gap-1">
                  <span className="shrink-0">{copy.settings.envSshConfig}</span>
                  <Truncate text={e.sshConfigPath} className="font-mono" />
                </span>
                {!e.available && <span>{copy.settings.envUnavailableHint}</span>}
              </ItemDescription>
            </ItemContent>
            <ItemActions>
              <Switch
                checked={enabled(e.id)}
                disabled={!e.available}
                onCheckedChange={(on) => setEnabled(e.id, on)}
                aria-label={copy.settings.envEnabled(copy.env.long(e.id))}
              />
            </ItemActions>
          </Item>
        ))}
      </ItemGroup>
      <div>
        <Button
          variant="outline"
          size="sm"
          disabled={detecting}
          onClick={() =>
            void useTargetStore
              .getState()
              .detect()
              .then(() => toast.add({ title: copy.settings.redetected }))
          }
        >
          {detecting ? <Spinner data-icon="inline-start" aria-hidden /> : <RefreshCwIcon data-icon="inline-start" />}
          {copy.settings.redetect}
        </Button>
      </div>
    </Section>
  )
}

// ---------- Agent 目标 ----------

function CustomTargetDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const environments = useTargetStore((s) => s.environments)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const {
    register,
    control,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isDirty, isSubmitting },
  } = useForm<CustomTargetValues>({
    resolver: zodResolver(customTargetSchema),
    defaultValues: { label: "", path: "", envId: environments[0]?.id ?? "windows" },
  })
  const close = () => {
    onOpenChange(false)
    reset()
  }
  const submit = handleSubmit(async (v) => {
    try {
      const t = await useTargetStore
        .getState()
        .addAgentTarget({ envId: v.envId as EnvId, agent: "custom", path: v.path, label: v.label.trim() })
      toast.add({ title: copy.settings.customAdded(t.label), type: "success" })
      close()
    } catch (e) {
      const err = e as IpcError
      if (err.id === "target-exists") setError("path", { message: ipcErrorText(err.id, err.params) })
      else toast.add({ title: ipcErrorText(err.id, err.params), type: "error" })
    }
  })

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && isDirty && !isSubmitting) setConfirmDiscard(true)
        else if (!next) close()
      }}
    >
      <DialogContent className="grid-cols-[minmax(0,1fr)] sm:max-w-lg" closeLabel={copy.common.close}>
        <DialogHeader>
          <DialogTitle>{copy.settings.customTitle}</DialogTitle>
          <DialogDescription>{copy.settings.customDescription}</DialogDescription>
        </DialogHeader>
        <form id="custom-target-form" noValidate onSubmit={submit}>
          <FieldGroup className="gap-4">
            <Field data-invalid={!!errors.label || undefined}>
              <FieldLabel htmlFor="custom-name">
                {copy.settings.customName} <Required />
              </FieldLabel>
              <Input id="custom-name" aria-required aria-invalid={!!errors.label || undefined} {...register("label")} />
              <ValidationError error={errors.label} />
            </Field>
            <Controller
              control={control}
              name="envId"
              render={({ field }) => (
                <Field>
                  <FieldLabel htmlFor="custom-env">{copy.settings.customEnv}</FieldLabel>
                  <Select
                    items={environments.map((e) => ({ value: e.id, label: copy.env.long(e.id) }))}
                    value={field.value}
                    onValueChange={(v) => v && field.onChange(v)}
                  >
                    <SelectTrigger id="custom-env" className="w-56">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {environments.map((e) => (
                        <SelectItem key={e.id} value={e.id}>
                          {copy.env.long(e.id)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              )}
            />
            <Controller
              control={control}
              name="path"
              render={({ field, fieldState }) => (
                <Field data-invalid={!!fieldState.error || undefined}>
                  <FieldLabel htmlFor="custom-path">
                    {copy.settings.customPath} <Required />
                  </FieldLabel>
                  <InputGroup>
                    <InputGroupInput
                      id="custom-path"
                      value={field.value}
                      readOnly
                      aria-required
                      aria-invalid={!!fieldState.error || undefined}
                      className="font-mono"
                    />
                    <InputGroupAddon align="inline-end">
                      <InputGroupButton
                        size="xs"
                        onClick={() =>
                          void ipc.pickDirectory().then((p) => typeof p === "string" && field.onChange(p))
                        }
                      >
                        <FolderOpenIcon data-icon="inline-start" />
                        {copy.settings.customPathPick}
                      </InputGroupButton>
                    </InputGroupAddon>
                  </InputGroup>
                  <ValidationError error={fieldState.error} />
                </Field>
              )}
            />
          </FieldGroup>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => (isDirty ? setConfirmDiscard(true) : close())}>
            {copy.common.cancel}
          </Button>
          <Button type="submit" form="custom-target-form" disabled={isSubmitting}>
            {isSubmitting && <Spinner data-icon="inline-start" aria-hidden />}
            {copy.settings.customSubmit}
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

function GlobalTargetItem({ target }: { target: Target }) {
  return (
    <Item variant="outline" size="sm">
      <ItemMedia>
        <BotIcon className="size-4" aria-hidden />
      </ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle className="w-full">
          <Truncate text={target.label} />
        </ItemTitle>
        <ItemDescription className="flex min-w-0">
          <Truncate text={target.path} className="font-mono text-xs" />
        </ItemDescription>
      </ItemContent>
      <ItemActions>
        <Select
          items={LINK_MODES.map((m) => ({ value: m, label: copy.targetCard.linkModeOption[m] }))}
          value={target.linkMode}
          onValueChange={(v) => v && setLinkMode(target, v as LinkMode)}
        >
          <SelectTrigger size="sm" aria-label={copy.settings.linkMode(target.label)} className="min-w-20">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LINK_MODES.map((m) => (
              <SelectItem key={m} value={m}>
                {copy.targetCard.linkModeOption[m]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </ItemActions>
    </Item>
  )
}

export function AgentsSection({ settings }: { settings: Settings }) {
  const environments = useTargetStore((s) => s.environments)
  const targets = useTargetStore((s) => s.targets)
  const [customOpen, setCustomOpen] = useState(false)
  const [enabling, setEnabling] = useState<string | null>(null)

  const enable = (envId: EnvId, agent: AgentId) => {
    setEnabling(`${envId}:${agent}`)
    useTargetStore
      .getState()
      .addAgentTarget({ envId, agent })
      .then((t) => toast.add({ title: copy.settings.agentEnabled(t.label), type: "success" }))
      .catch((e: IpcError) => toast.add({ title: ipcErrorText(e.id, e.params), type: "error" }))
      .finally(() => setEnabling(null))
  }

  return (
    <Section id="agents" title={copy.settings.section.agents} hint={copy.settings.agentsHint}>
      {environments.map((env) => {
        const globals = targets.filter((t) => t.kind === "agent-global" && t.envId === env.id)
        const missing = KNOWN_AGENTS.filter((a) => !globals.some((t) => t.agent === a))
        return (
          <FieldSet key={env.id} className="min-w-0 gap-2">
            <FieldLegend variant="label" className="mb-0 flex items-center gap-1.5">
              <EnvIcon envId={env.id} />
              {copy.env.long(env.id)}
            </FieldLegend>
            <ItemGroup className="gap-1.5">
              {globals.map((t) => (
                <GlobalTargetItem key={t.id} target={t} />
              ))}
            </ItemGroup>
            <FieldDescription className="mt-1">
              {missing.length ? copy.settings.agentsAvailableHint : copy.settings.agentsAllEnabled}
            </FieldDescription>
            {missing.length > 0 && (
              <div className="flex flex-wrap gap-1.5" role="group" aria-label={`${copy.settings.agentsAvailable}：${copy.env.long(env.id)}`}>
                {missing.map((a) => (
                  <Button
                    key={a}
                    variant="outline"
                    size="xs"
                    disabled={enabling !== null}
                    aria-label={`${copy.settings.agentEnable}：${copy.agent[a]}`}
                    onClick={() => enable(env.id, a)}
                  >
                    {enabling === `${env.id}:${a}` ? <Spinner data-icon="inline-start" aria-hidden /> : <PlusIcon data-icon="inline-start" />}
                    {copy.agent[a]}
                  </Button>
                ))}
              </div>
            )}
          </FieldSet>
        )
      })}
      <div>
        <Button variant="outline" size="sm" onClick={() => setCustomOpen(true)}>
          <PlusIcon data-icon="inline-start" />
          {copy.settings.addCustom}
        </Button>
      </div>
      {environments.some((e) => e.id === "windows") && (
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor="windows-junction">{copy.settings.junction}</FieldLabel>
            <FieldDescription>{copy.settings.junctionHint}</FieldDescription>
          </FieldContent>
          <Switch
            id="windows-junction"
            checked={settings.windowsJunction}
            onCheckedChange={(on) => update({ windowsJunction: on })}
          />
        </Field>
      )}
      <CustomTargetDialog open={customOpen} onOpenChange={setCustomOpen} />
    </Section>
  )
}

// ---------- 编译、探测：数字字段失焦时校验并保存 ----------

function useNumbersForm(settings: Settings) {
  const form = useForm<SettingsNumbers>({
    resolver: zodResolver(settingsNumbersSchema),
    mode: "onBlur",
    values: { bodyLineLimit: settings.bodyLineLimit, probeTimeoutSec: settings.probeTimeoutSec },
  })
  const commit = form.handleSubmit((v) => {
    if (v.bodyLineLimit === settings.bodyLineLimit && v.probeTimeoutSec === settings.probeTimeoutSec) return
    update(v)
    toast.add({ title: copy.settings.saved })
  })
  return { form, commit }
}

export function CompileSection({ settings }: { settings: Settings }) {
  const { form, commit } = useNumbersForm(settings)
  const error = form.formState.errors.bodyLineLimit
  return (
    <Section id="compile" title={copy.settings.section.compile}>
      <FieldGroup className="gap-6">
        <Field data-invalid={!!error || undefined}>
          <FieldLabel htmlFor="body-line-limit">{copy.settings.bodyLineLimit}</FieldLabel>
          <Input
            id="body-line-limit"
            type="number"
            inputMode="numeric"
            min={20}
            max={500}
            className="w-28 font-mono tabular-nums"
            aria-invalid={!!error || undefined}
            aria-describedby="body-line-limit-hint"
            {...form.register("bodyLineLimit", { valueAsNumber: true, onBlur: () => void commit() })}
          />
          <FieldDescription id="body-line-limit-hint">{copy.settings.bodyLineLimitHint}</FieldDescription>
          <ValidationError error={error} />
        </Field>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor="write-snapshot">{copy.settings.snapshot}</FieldLabel>
            <FieldDescription>{copy.settings.snapshotHint}</FieldDescription>
          </FieldContent>
          <Switch
            id="write-snapshot"
            checked={settings.writeSnapshotTime}
            onCheckedChange={(on) => update({ writeSnapshotTime: on })}
          />
        </Field>
        <FieldSet className="gap-3">
          <FieldLegend variant="label" className="mb-0">
            {copy.settings.defaultMode}
          </FieldLegend>
          <FieldDescription>{copy.settings.defaultModeHint}</FieldDescription>
          <RadioGroup
            value={settings.defaultMode}
            onValueChange={(v) => update({ defaultMode: v as Mode })}
            className="grid gap-3 sm:grid-cols-2"
          >
            {MODES.map((m) => (
              <FieldLabel key={m} htmlFor={`default-mode-${m}`}>
                <Field orientation="horizontal">
                  <RadioGroupItem value={m} id={`default-mode-${m}`} />
                  <FieldContent>
                    <FieldTitle>{copy.mode[m]}</FieldTitle>
                    <FieldDescription>{copy.guardrails.modeDescription[m]}</FieldDescription>
                  </FieldContent>
                </Field>
              </FieldLabel>
            ))}
          </RadioGroup>
        </FieldSet>
      </FieldGroup>
    </Section>
  )
}

export function ProbeSection({ settings }: { settings: Settings }) {
  const { form, commit } = useNumbersForm(settings)
  const error = form.formState.errors.probeTimeoutSec
  const [scriptOpen, setScriptOpen] = useState(false)
  const [sshPath, setSshPath] = useState(settings.windowsSshPath)
  return (
    <Section id="probe" title={copy.settings.section.probe}>
      <FieldGroup className="gap-6">
        <Field data-invalid={!!error || undefined}>
          <FieldLabel htmlFor="probe-timeout">{copy.settings.probeTimeout}</FieldLabel>
          <Input
            id="probe-timeout"
            type="number"
            inputMode="numeric"
            min={10}
            max={120}
            className="w-28 font-mono tabular-nums"
            aria-invalid={!!error || undefined}
            aria-describedby="probe-timeout-hint"
            {...form.register("probeTimeoutSec", { valueAsNumber: true, onBlur: () => void commit() })}
          />
          <FieldDescription id="probe-timeout-hint">{copy.settings.probeTimeoutHint}</FieldDescription>
          <ValidationError error={error} />
        </Field>
        <Field>
          <FieldLabel htmlFor="host-key">{copy.settings.hostKey}</FieldLabel>
          <Input id="host-key" value={copy.settings.hostKeyValue} readOnly className="max-w-sm text-muted-foreground" aria-describedby="host-key-hint" />
          <FieldDescription id="host-key-hint">{copy.settings.hostKeyHint}</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="ssh-path">{copy.settings.sshPath}</FieldLabel>
          <Input
            id="ssh-path"
            value={sshPath}
            onChange={(e) => setSshPath(e.target.value)}
            onBlur={() => {
              const next = sshPath.trim()
              if (next && next !== settings.windowsSshPath) {
                update({ windowsSshPath: next })
                toast.add({ title: copy.settings.saved })
              } else setSshPath(settings.windowsSshPath)
            }}
            spellCheck={false}
            className="font-mono"
            aria-describedby="ssh-path-hint"
          />
          <FieldDescription id="ssh-path-hint">{copy.settings.sshPathHint}</FieldDescription>
        </Field>
        <Field>
          <FieldTitle>{copy.settings.probeScript}</FieldTitle>
          <FieldDescription>{copy.settings.probeScriptHint}</FieldDescription>
          <div>
            <Button variant="outline" size="sm" onClick={() => setScriptOpen(true)}>
              {copy.probePanel.viewScript}
            </Button>
          </div>
        </Field>
      </FieldGroup>
      {scriptOpen && (
        <Suspense fallback={null}>
          <ProbeScriptDialog open={scriptOpen} onOpenChange={setScriptOpen} />
        </Suspense>
      )}
    </Section>
  )
}

// ---------- 数据 ----------

function PathField({ id, label, path }: { id: string; label: string; path: string }) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <InputGroup>
        <InputGroupInput id={id} value={path} readOnly className="font-mono" />
        <InputGroupAddon align="inline-end">
          <InputGroupButton size="xs" onClick={() => void ipc.revealInDir(path)}>
            <FolderOpenIcon data-icon="inline-start" />
            {copy.settings.reveal}
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </Field>
  )
}

export function DataSection({ settings }: { settings: Settings }) {
  return (
    <Section id="data" title={copy.settings.section.data}>
      <FieldGroup className="gap-6">
        <PathField id="data-dir" label={copy.settings.dataDir} path={settings.dataDir} />
        <PathField id="log-dir" label={copy.settings.logDir} path={settings.logDir} />
        <Field>
          <FieldTitle>{copy.settings.importExport}</FieldTitle>
          <div>
            <Tooltip>
              <TooltipTrigger render={<span className="inline-flex" />}>
                <Button variant="outline" size="sm" disabled>
                  {copy.settings.importExport}
                  <span className="sr-only">（{copy.settings.importExportLater}）</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>{copy.settings.importExportLater}</TooltipContent>
            </Tooltip>
          </div>
        </Field>
      </FieldGroup>
    </Section>
  )
}

// ---------- 危险操作：AlertDialog，并要求输入确认文字（2026-10-29 用户确认两段文字各自不同） ----------

function TypedConfirm({
  open,
  onOpenChange,
  title,
  description,
  phrase,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  phrase: string
  onConfirm: () => Promise<void>
}) {
  const [text, setText] = useState("")
  const [busy, setBusy] = useState(false)
  const close = () => {
    onOpenChange(false)
    setText("")
  }
  return (
    <AlertDialog open={open} onOpenChange={(next) => !next && !busy && close()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia>
            <Trash2Icon className="text-destructive" />
          </AlertDialogMedia>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <Field>
          <FieldLabel htmlFor="danger-confirm">{copy.settings.typeToConfirm(phrase)}</FieldLabel>
          <Input id="danger-confirm" value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" />
        </Field>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{copy.common.cancel}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={busy || text.trim() !== phrase}
            onClick={() => {
              setBusy(true)
              void onConfirm()
                .then(close)
                .catch(() => {})
                .finally(() => setBusy(false))
            }}
          >
            {busy && <Spinner data-icon="inline-start" aria-hidden />}
            {title}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export function DangerSection() {
  const mountCount = useMountStore((s) => Object.keys(s.byId).length)
  const [dialog, setDialog] = useState<"unmount" | "reset" | null>(null)

  const unmountAll = async () => {
    const n = Object.keys(useMountStore.getState().byId).length
    await useMountStore.getState().unmountAll()
    toast.add({ title: copy.settings.unmountAllDone(n) })
  }
  const resetData = async () => {
    try {
      await ipc.resetData()
    } catch (e) {
      const err = e as IpcError
      toast.add({ title: ipcErrorText(err.id, err.params), type: "error" })
      throw e
    }
    useUIStore.getState().selectAsset(null, { force: true })
    useUIStore.getState().setLens(null)
    void useAssetStore.getState().load()
    void useSkillStore.getState().refresh()
    void useMountStore.getState().load()
    void useTargetStore.getState().detect()
    void useActivityStore.getState().load({})
    void useSettingsStore.getState().load()
    toast.add({ title: copy.settings.resetDone })
  }

  return (
    <Section id="danger" title={copy.settings.section.danger} hint={copy.settings.dangerHint}>
      <ItemGroup className="gap-2">
        <Item variant="outline">
          <ItemMedia>
            <UnlinkIcon className="size-4" aria-hidden />
          </ItemMedia>
          <ItemContent>
            <ItemTitle>{copy.settings.unmountAll}</ItemTitle>
            <ItemDescription>{copy.settings.unmountAllHint(mountCount)}</ItemDescription>
          </ItemContent>
          <ItemActions>
            <Button variant="destructive" size="sm" disabled={mountCount === 0} onClick={() => setDialog("unmount")}>
              {copy.settings.unmountAll}
            </Button>
          </ItemActions>
        </Item>
        <Item variant="outline">
          <ItemMedia>
            <Trash2Icon className="size-4" aria-hidden />
          </ItemMedia>
          <ItemContent>
            <ItemTitle>{copy.settings.resetData}</ItemTitle>
            <ItemDescription>{copy.settings.resetDataHint}</ItemDescription>
          </ItemContent>
          <ItemActions>
            <Button variant="destructive" size="sm" onClick={() => setDialog("reset")}>
              {copy.settings.resetData}
            </Button>
          </ItemActions>
        </Item>
      </ItemGroup>
      <TypedConfirm
        open={dialog === "unmount"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={copy.settings.unmountAll}
        description={copy.settings.unmountAllHint(mountCount)}
        phrase={copy.settings.unmountAllConfirm}
        onConfirm={unmountAll}
      />
      <TypedConfirm
        open={dialog === "reset"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={copy.settings.resetData}
        description={copy.settings.resetDataHint}
        phrase={copy.settings.resetDataConfirm}
        onConfirm={resetData}
      />
    </Section>
  )
}
