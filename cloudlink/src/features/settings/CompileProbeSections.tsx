import { zodResolver } from "@hookform/resolvers/zod"
import { lazy, Suspense, useState } from "react"
import { useForm } from "react-hook-form"

import type { Settings } from "@/bindings"
import { Button } from "@/components/ui/button"
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel, FieldTitle } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { toast } from "@/components/ui/toast"
import { ValidationError } from "@/features/servers/ValidationError"
import { copy } from "@/lib/copy"
import { settingsNumbersSchema, type SettingsNumbers } from "@/lib/schemas"
import { Section, update } from "./Section"

const ProbeScriptDialog = lazy(() => import("@/features/servers/ProbeScriptDialog"))

/** 编译、探测的数字字段：失焦时校验并保存 */
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

/** 编译（PRD 6.7）：正文行数上限；是否写入数据快照时间 */
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
          <Switch id="write-snapshot" checked={settings.writeSnapshotTime} onCheckedChange={(on) => update({ writeSnapshotTime: on })} />
        </Field>
      </FieldGroup>
    </Section>
  )
}

/** 探测（PRD 6.7）：超时；主机密钥策略只展示；Windows ssh 路径；查看探测脚本 */
export function ProbeSection({ settings }: { settings: Settings }) {
  const { form, commit } = useNumbersForm(settings)
  const error = form.formState.errors.probeTimeoutSec
  const [script, setScript] = useState({ open: false, mounted: false })
  const [sshPath, setSshPath] = useState(settings.windowsSshPath)
  const saveSshPath = () => {
    const next = sshPath.trim()
    if (next && next !== settings.windowsSshPath) {
      update({ windowsSshPath: next })
      toast.add({ title: copy.settings.saved })
    } else setSshPath(settings.windowsSshPath)
  }
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
            onBlur={saveSshPath}
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
            <Button variant="outline" size="sm" onClick={() => setScript({ open: true, mounted: true })}>
              {copy.probeSheet.viewScript}
            </Button>
          </div>
        </Field>
      </FieldGroup>
      {script.mounted && (
        <Suspense fallback={null}>
          <ProbeScriptDialog open={script.open} onOpenChange={(open) => setScript((s) => ({ ...s, open }))} />
        </Suspense>
      )}
    </Section>
  )
}
