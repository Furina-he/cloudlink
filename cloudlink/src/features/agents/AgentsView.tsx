import { zodResolver } from "@hookform/resolvers/zod"
import { CircleXIcon, PackageIcon, RefreshCwIcon, TriangleAlertIcon } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { FormProvider, useForm, useWatch, type Control } from "react-hook-form"
import { useHotkeys } from "react-hotkeys-hook"

import { PreviewSheet } from "@/components/app/PreviewSheet"
import { useScrollRestore, useViewTitleFocus } from "@/components/app/ViewShell"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { copy } from "@/lib/copy"
import { HOTKEY_OPTIONS, HOTKEYS, isModalOpen } from "@/lib/hotkeys"
import { skillConfigSchema, type SkillConfigValues } from "@/lib/schemas"
import { toastError } from "@/features/servers/actions"
import { LeaveDialog, useLeaveGuard } from "@/features/servers/LeaveDialog"
import { SaveBar } from "@/features/servers/SaveBar"
import { useDeliveryStore } from "@/stores/deliveries"
import { useGuardStore } from "@/stores/guard"
import { selectHealth } from "@/stores/health"
import { compileKey, selectCompileSummary, useSkillStore } from "@/stores/skills"
import { useTargetStore } from "@/stores/targets"
import { useUIStore } from "@/stores/ui"
import { compileLabel, useAgentOptions } from "./agentKeys"
import { GuardSection } from "./GuardSection"
import { SkillContentSection } from "./SkillContentSection"
import { targetActions } from "./targetActions"
import { TargetsSection } from "./TargetsSection"

const EMPTY_CONFIG: SkillConfigValues = { relationships: "", conventions: [] }

/** 整个总 Skill 的预览：有未保存的全局内容时预览草稿 */
function ConfigPreview({ control, dirty }: { control: Control<SkillConfigValues>; dirty: boolean }) {
  const values = useWatch({ control }) as SkillConfigValues
  return <PreviewSheet scope="agents" draft={{ config: dirty ? values : undefined }} dirty={dirty} defaultFile="SKILL.md" />
}

/** 顶部摘要（PRD 6.6）：列入的服务器、启用的目标、需要修复的问题；编译受阻时列出受阻的那几份，警告去重后合成一行 */
function Summary() {
  const inclusions = useDeliveryStore((s) => s.inclusions)
  const deliveries = useDeliveryStore((s) => s.byId)
  const targets = useTargetStore((s) => s.targets)
  const guards = useGuardStore((s) => s.statusByEnv)
  const statusByKey = useSkillStore((s) => s.statusByKey)
  const { compileTargets } = useAgentOptions()
  const included = new Set(inclusions.filter((i) => i.included).map((i) => i.assetId)).size
  const enabled = targets.filter((t) => t.enabled).length
  const statuses = useMemo(() => Object.values(statusByKey), [statusByKey])
  const health = useMemo(() => selectHealth(Object.values(deliveries), Object.values(guards), statuses), [deliveries, guards, statuses])
  const problems = health.deliveryProblems + health.guardProblems
  const compile = useMemo(() => selectCompileSummary(statuses), [statuses])
  const showLint = (s: { envId: string; agentKey: string }) => {
    useUIStore.getState().setPreviewKey(compileKey(s))
    useUIStore.getState().openPreview({ file: "SKILL.md", lint: true })
  }

  // 跳到第一个有问题的位置，并把焦点放在它的处理按钮上
  const jump = () => {
    const el = document.querySelector<HTMLElement>("[data-problem]")
    el?.scrollIntoView({ block: "center" })
    el?.querySelector<HTMLElement>("button:not(:disabled)")?.focus()
  }

  return (
    <div className="flex flex-col gap-1 text-xs text-muted-foreground">
      <p className="flex flex-wrap items-center gap-x-1.5">
        <span className="tabular-nums">{copy.agents.summary(included, enabled)}</span>
        {problems > 0 && (
          <>
            <span aria-hidden>·</span>
            <Button variant="link" size="xs" className="h-auto p-0 text-destructive tabular-nums" onClick={jump} aria-label={copy.agents.problemsLabel(problems)}>
              {copy.agents.problems(problems)}
            </Button>
          </>
        )}
      </p>
      {compile.blocked.length > 0 && (
        <Button variant="link" size="xs" className="h-auto w-fit gap-1 p-0 text-destructive" onClick={() => showLint(compile.blocked[0])}>
          <CircleXIcon />
          {copy.agents.compileBlocked(compile.errors, compile.blocked.map((s) => compileLabel(compileTargets, s)).join("、"))}
          {` · ${copy.detail.showLint}`}
        </Button>
      )}
      {compile.firstWarning && (
        <Button variant="link" size="xs" className="h-auto w-fit gap-1 p-0 text-warning" onClick={() => compile.firstWarning && showLint(compile.firstWarning)}>
          <TriangleAlertIcon />
          {copy.agents.compileWarnings(compile.warnings)}
          {` · ${copy.detail.showLint}`}
        </Button>
      )}
    </div>
  )
}

/** Agent 视图（PRD 6.6）：交给 Agent 的内容、护栏、分发目标三个分区 */
export function AgentsView({ focusTitle }: { focusTitle: boolean }) {
  const rootRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  useViewTitleFocus(titleRef, focusTitle)
  useScrollRestore("agents", () => rootRef.current?.querySelector<HTMLElement>("[data-slot=scroll-area-viewport]"))

  const config = useSkillStore((s) => s.config)
  const form = useForm<SkillConfigValues>({
    resolver: zodResolver(skillConfigSchema),
    values: config ?? EMPTY_CONFIG,
    resetOptions: { keepDirtyValues: true },
    mode: "onBlur",
  })
  const dirty = form.formState.isDirty
  const [saving, setSaving] = useState(false)
  // 保存后显示「已保存，已重新编译」，不弹 Toast；再次修改后消失（与服务器详情一致）
  const [saved, setSaved] = useState(false)
  if (saved && dirty) setSaved(false)
  // 必须关掉 keepDirtyValues：它只用于后台同步，RHF 的 reset() 也会带上 useForm 的 resetOptions
  const discard = () => form.reset(undefined, { keepDirtyValues: false })
  const guard = useLeaveGuard(dirty, discard)

  useEffect(() => {
    void useSkillStore.getState().load()
  }, [])

  const save = () =>
    void form.handleSubmit(async (v) => {
      setSaving(true)
      try {
        await useSkillStore.getState().saveConfig(v)
        form.reset(v, { keepDirtyValues: false })
        setSaved(true)
      } catch (e) {
        toastError(e)
      } finally {
        setSaving(false)
      }
    })()
  useHotkeys(HOTKEYS.save, () => dirty && !isModalOpen() && save(), HOTKEY_OPTIONS)

  return (
    <FormProvider {...form}>
      <div className="flex min-h-0 flex-1 flex-col">
        <ScrollArea ref={rootRef} className="min-h-0 flex-1">
          <div className="mx-auto flex max-w-4xl flex-col gap-5 p-3 pb-8">
            <header className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <h1 ref={titleRef} id="view-title" tabIndex={-1} className="text-base font-semibold outline-none">
                  {copy.nav.agents}
                </h1>
                <div className="ml-auto flex gap-1.5">
                  <Button variant="outline" size="sm" onClick={() => useUIStore.getState().openPreview({ file: "SKILL.md" })}>
                    <PackageIcon data-icon="inline-start" />
                    {copy.agents.preview}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => void targetActions.checkAll()}>
                    <RefreshCwIcon data-icon="inline-start" />
                    {copy.agents.checkAll}
                  </Button>
                </div>
              </div>
              <Summary />
            </header>
            <SkillContentSection saved={saved} />
            <Separator />
            <GuardSection />
            <Separator />
            <TargetsSection />
          </div>
        </ScrollArea>
        {dirty && <SaveBar saving={saving} onDiscard={discard} onSave={save} />}
      </div>
      <LeaveDialog guard={guard} />
      <ConfigPreview control={form.control} dirty={dirty} />
    </FormProvider>
  )
}
