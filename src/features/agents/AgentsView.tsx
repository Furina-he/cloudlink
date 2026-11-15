import { zodResolver } from "@hookform/resolvers/zod"
import { ChevronLeftIcon, ChevronRightIcon, CircleXIcon, FileTextIcon, InfoIcon, RefreshCwIcon, TriangleAlertIcon } from "lucide-react"
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { FormProvider, useForm, useWatch, type Control } from "react-hook-form"
import { useHotkeys } from "react-hotkeys-hook"

import type { EnvId, GuardRules } from "@/bindings"
import { EnvIcon } from "@/components/app/StateBadge"
import { PreviewSheet } from "@/components/app/PreviewSheet"
import { CommandChip } from "@/components/app/CommandChip"
import { FoldRow, ListGroup, ListNote, PrefRow } from "@/components/app/SettingsList"
import { useScrollRestore, useViewTitleFocus } from "@/components/app/ViewShell"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { toast } from "@/components/ui/toast"
import { copy } from "@/lib/copy"
import { HOTKEY_OPTIONS, HOTKEYS, isModalOpen } from "@/lib/hotkeys"
import { skillConfigSchema, type SkillConfigValues } from "@/lib/schemas"
import { toastError } from "@/features/servers/actions"
import { LeaveDialog, useLeaveGuard } from "@/features/servers/LeaveDialog"
import { SaveBar } from "@/features/servers/SaveBar"
import { update } from "@/features/settings/settingsUpdate"
import { useGuardStore } from "@/stores/guard"
import { useSettingsStore } from "@/stores/settings"
import { compileKey, selectCompileSummary, useSkillStore } from "@/stores/skills"
import { useTargetStore } from "@/stores/targets"
import { useUIStore, type AgentsPage } from "@/stores/ui"
import { AgentList } from "./AgentList"
import { compileLabel, useAgentOptions } from "./agentKeys"
import { allowExamples, groupAllowlist } from "./guardGroups"
import { ConventionsBlock, HealthCheckRow, RelationsBlock } from "./SkillContentSection"

const EMPTY_CONFIG: SkillConfigValues = { relationNotes: [], hiddenRelations: [], conventions: [] }

/** 整个 Skill 的预览：有未保存的内容时预览草稿 */
function ConfigPreview({ control, dirty }: { control: Control<SkillConfigValues>; dirty: boolean }) {
  const values = useWatch({ control }) as SkillConfigValues
  return <PreviewSheet scope="agents" draft={{ config: dirty ? values : undefined }} dirty={dirty} defaultFile="SKILL.md" />
}

const openPreview = () => useUIStore.getState().openPreview({ file: "SKILL.md" })

/** 编译受阻时顶部一行琥珀说明（6.12），警告合成一行；正常时隐身 */
function CompileLine() {
  const statusByKey = useSkillStore((s) => s.statusByKey)
  const { compileTargets } = useAgentOptions()
  const compile = useMemo(() => selectCompileSummary(Object.values(statusByKey)), [statusByKey])
  const show = (s: { envId: EnvId; agentKey: string }) => {
    useUIStore.getState().setPreviewKey(compileKey(s))
    useUIStore.getState().openPreview({ file: "SKILL.md", lint: true })
  }
  if (compile.blocked.length === 0 && !compile.firstWarning) return null
  const blocked = compile.blocked.length > 0
  const first = blocked ? compile.blocked[0] : compile.firstWarning!
  return (
    <p role="status" className={blocked ? "flex items-center gap-1.5 text-xs text-destructive" : "flex items-center gap-1.5 text-xs text-warning"}>
      {blocked ? <CircleXIcon className="size-3.5 shrink-0" aria-hidden /> : <TriangleAlertIcon className="size-3.5 shrink-0" aria-hidden />}
      {blocked ? copy.agents.compileBlocked(compile.blocked.map((s) => compileLabel(compileTargets, s)).join("、")) : copy.agents.compileWarnings(compile.warnings)}
      {/* 文字链接用信号青（DESIGN.md The Signal Four Rule），不跟着琥珀或红色的说明走 */}
      <Button variant="link" size="xs" className="h-auto p-0 text-signal underline underline-offset-2" onClick={() => show(first)}>
        {copy.agents.showLint}
      </Button>
    </p>
  )
}

/** Skill 内容：三行可点，进入二级页 */
function ContentRows({ control }: { control: Control<SkillConfigValues> }) {
  const relations = useSkillStore((s) => s.relations)
  const hidden = useWatch({ control, name: "hiddenRelations" }) ?? []
  const conventions = useWatch({ control, name: "conventions" }) ?? []
  const rules = useGuardStore((s) => s.rules)
  useEffect(() => {
    useGuardStore.getState().loadRules().catch(() => undefined)
  }, [])
  // 数的是拦截几类危险操作，不把放行的命令算进去（PRD 6.6）
  const ruleCount = rules ? rules.standardDeny.length + rules.alwaysDeny.length : null
  const rows: { page: AgentsPage; label: string; value: string }[] = [
    { page: "relations", label: copy.agents.relations, value: copy.agents.relationsCount(relations.filter((r) => !hidden.includes(r.id)).length) },
    { page: "conventions", label: copy.agents.conventions, value: copy.agents.conventionsCount(conventions.length) },
    { page: "rules", label: copy.agents.rules, value: ruleCount === null ? copy.agents.rulesBuiltin : copy.agents.rulesCount(ruleCount) },
  ]
  return (
    <ListGroup id="agents-content" title={copy.agents.content}>
      {rows.map((r) => (
        <button
          key={r.page}
          type="button"
          onClick={() => useUIStore.getState().setAgentsPage(r.page)}
          className="flex min-h-11 w-full items-center gap-3 px-3.5 py-2.5 text-left outline-none hover:bg-card-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        >
          <span className="flex-1 text-[13px] font-medium">{r.label}</span>
          <span className="text-xs text-muted-foreground tabular-nums">{r.value}</span>
          <ChevronRightIcon aria-hidden className="size-4 text-faint" />
        </button>
      ))}
    </ListGroup>
  )
}

/** 运行环境（6.6）：Windows、各 WSL 发行版各一行开关 */
function EnvironmentsGroup() {
  const environments = useTargetStore((s) => s.environments)
  const detecting = useTargetStore((s) => s.status === "loading")
  const settings = useSettingsStore((s) => s.settings)
  const enabled = (id: EnvId) => settings?.environments.find((e) => e.id === id)?.enabled ?? true
  const setEnabled = (id: EnvId, on: boolean) =>
    update({ environments: environments.map((e) => ({ id: e.id, enabled: e.id === id ? on : enabled(e.id) })) })
  const redetect = (
    <Button
      variant="ghost"
      size="xs"
      className="text-muted-foreground"
      disabled={detecting}
      onClick={() =>
        void useTargetStore
          .getState()
          .detect()
          .then(() => toast.add({ title: copy.agents.redetected }))
      }
    >
      {detecting ? <Spinner data-icon="inline-start" aria-hidden /> : <RefreshCwIcon data-icon="inline-start" />}
      {copy.agents.redetect}
    </Button>
  )
  return (
    <ListGroup id="agents-envs" title={copy.agents.environments} action={redetect}>
      {environments.map((e) => (
        <PrefRow
          key={e.id}
          label={
            <span className="flex items-center gap-2">
              <EnvIcon envId={e.id} className="size-3.5 text-muted-foreground" />
              {copy.env.long(e.id)}
            </span>
          }
          hint={e.available ? undefined : copy.agents.envUnavailable}
        >
          <Switch
            checked={e.available && enabled(e.id)}
            disabled={!e.available || !settings}
            onCheckedChange={(on) => setEnabled(e.id, on)}
            aria-label={copy.agents.envEnable(copy.env.long(e.id))}
          />
        </PrefRow>
      ))}
    </ListGroup>
  )
}

/** 一行：名称 + 一排命令示例（Command Chip，整块换行） */
function ChipRow({ label, commands }: { label: string; commands: string[] }) {
  return (
    <div className="flex flex-col gap-1.5 px-3.5 py-2.5">
      <span className="text-[13px] font-medium">{label}</span>
      <ul aria-label={label} className="flex flex-wrap gap-1.5">
        {commands.map((c) => (
          <li key={c} className="flex">
            <CommandChip>{c}</CommandChip>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** 一组拦下的类别：中文说明加命令示例；组标题右边写「N 类」 */
function Categories({ id, title, list }: { id: string; title: string; list: GuardRules["standardDeny"] }) {
  return (
    <ListGroup id={id} title={title} action={<span className="text-xs text-muted-foreground tabular-nums">{copy.guard.categoryCount(list.length)}</span>}>
      {list.map((c) => (
        <ChipRow key={c.id} label={copy.guardReason[c.id]} commands={c.examples} />
      ))}
    </ListGroup>
  )
}

/**
 * 护栏规则（只读，PRD 6.6、8.6）：先讲拦什么（标准运维时、任何档位），再讲只读巡检时放行什么；
 * 放行清单很长，默认收起，展开后按系统 / 服务与日志 / Docker / 云平台分组
 */
function RulesPage() {
  const rules = useGuardStore((s) => s.rules)
  if (!rules) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true" aria-label={copy.guard.loading}>
        <Skeleton className="h-20 rounded-list" />
        <Skeleton className="h-32 rounded-list" />
      </div>
    )
  }
  const allow = rules.readOnlyAllow
  return (
    <>
      <p className="text-[13px] text-fg-2">{copy.guard.intro}</p>
      <Categories id="rules-standard" title={copy.guard.standardTitle} list={rules.standardDeny} />
      <Categories id="rules-always" title={copy.guard.alwaysTitle} list={rules.alwaysDeny} />
      <ListGroup id="rules-read-only" title={copy.guard.readOnlyTitle}>
        <FoldRow label={copy.guard.readOnlyRow} hint={copy.guard.readOnlySummary(allow.length, allowExamples(allow))}>
          {groupAllowlist(allow).map((g) => (
            <ChipRow key={g.id} label={copy.guard.allowGroup[g.id]} commands={g.commands} />
          ))}
          <p className="px-3.5 py-2.5 text-xs leading-relaxed text-muted-foreground">{copy.guard.readOnlyNote}</p>
        </FoldRow>
        <ListNote icon={<InfoIcon aria-hidden />}>{copy.guard.honest}</ListNote>
      </ListGroup>
    </>
  )
}

const SUBPAGE_TITLE: Record<Exclude<AgentsPage, "main">, string> = {
  relations: copy.agents.relations,
  conventions: copy.agents.conventions,
  rules: copy.agents.rules,
}

/** 二级页的外框：左上「‹ Agent」返回（Esc 也返回），标题 */
function Subpage({ page, titleRef, children }: { page: Exclude<AgentsPage, "main">; titleRef: React.RefObject<HTMLHeadingElement | null>; children: ReactNode }) {
  useEffect(() => titleRef.current?.focus(), [titleRef])
  return (
    <>
      <div className="flex flex-col items-start gap-1">
        <Button variant="ghost" size="xs" className="-ml-2 text-muted-foreground" onClick={() => useUIStore.getState().setAgentsPage("main")} aria-label={copy.agents.backLabel}>
          <ChevronLeftIcon data-icon="inline-start" />
          {copy.agents.back}
        </Button>
        <h1 ref={titleRef} id="view-title" tabIndex={-1} className="text-lg font-semibold outline-none">
          {SUBPAGE_TITLE[page]}
        </h1>
      </div>
      {children}
    </>
  )
}

/** Agent 视图（PRD 6.6，v0.2）：一句说明、已检测到的 Agent、Skill 内容（二级页）、运行环境 */
export function AgentsView({ focusTitle }: { focusTitle: boolean }) {
  const rootRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const page = useUIStore((s) => s.agentsPage)
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
  // 必须关掉 keepDirtyValues：它只用于后台同步，RHF 的 reset() 也会带上 useForm 的 resetOptions
  const discard = () => form.reset(undefined, { keepDirtyValues: false })
  const guard = useLeaveGuard(dirty, discard)

  useEffect(() => {
    void useSkillStore.getState().load()
  }, [])
  // Esc 从二级页返回 Agent 页；浮层打开时交给浮层
  useHotkeys(HOTKEYS.escape, () => page !== "main" && !isModalOpen() && useUIStore.getState().setAgentsPage("main"), { enableOnFormTags: false }, [page])

  const save = () =>
    void form.handleSubmit(async (v) => {
      setSaving(true)
      try {
        await useSkillStore.getState().saveConfig(v)
        form.reset(v, { keepDirtyValues: false })
        toast.add({ title: copy.skillContent.saved })
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
          <div className="mx-auto flex w-full max-w-190 flex-col gap-5 px-5 pt-5 pb-10">
            {page === "main" ? (
              <>
                <h1 ref={titleRef} id="view-title" tabIndex={-1} className="sr-only">
                  {copy.nav.agents}
                </h1>
                <div className="flex items-center gap-3">
                  <p className="flex-1 text-[13px] text-fg-2">{copy.agents.intro}</p>
                  <Button variant="outline" size="sm" onClick={openPreview}>
                    <FileTextIcon data-icon="inline-start" />
                    {copy.agents.preview}
                  </Button>
                </div>
                <CompileLine />
                <AgentList />
                <ContentRows control={form.control} />
                <EnvironmentsGroup />
              </>
            ) : (
              <Subpage key={page} page={page} titleRef={titleRef}>
                {page === "relations" ? (
                  <RelationsBlock />
                ) : page === "conventions" ? (
                  <>
                    <ConventionsBlock />
                    <HealthCheckRow />
                  </>
                ) : (
                  <RulesPage />
                )}
              </Subpage>
            )}
          </div>
        </ScrollArea>
        {dirty && <SaveBar saving={saving} onDiscard={discard} onSave={save} />}
      </div>
      <LeaveDialog guard={guard} />
      <ConfigPreview control={form.control} dirty={dirty} />
    </FormProvider>
  )
}
