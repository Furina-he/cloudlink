import { CopyIcon, DownloadIcon, LogInIcon, PlusIcon, RefreshCwIcon, ServerIcon, SquareTerminalIcon } from "lucide-react"
import { motion } from "motion/react"
import { useState } from "react"

import type { Asset, CliEnvState, CliProvider, CliScopeItem, EnvId } from "@/bindings"
import { CONN_STATE, EnvIcon, StateText } from "@/components/app/StateBadge"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field"
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "@/components/ui/toast"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { CLI_BINARY, installMethods, loginCommand, SCOPE_KINDS, type InstallMethod } from "@/lib/cliProviders"
import { copy } from "@/lib/copy"
import { sortEnvs } from "@/features/servers/serverForm"
import { cn } from "@/lib/utils"
import { cliEnvStatus, handleOf, useAssetStore } from "@/stores/assets"
import type { CliSetupRun } from "@/stores/cli"

const STATUS_ICON = {
  ready: { tone: "success", icon: CONN_STATE.connected.icon },
  "not-installed": { tone: "warning", icon: CONN_STATE.changed.icon },
  "not-logged-in": { tone: "warning", icon: CONN_STATE.changed.icon },
  expired: { tone: "warning", icon: CONN_STATE.changed.icon },
} as const

/**
 * 各运行环境的 CLI 状态（F-104 AC1、AC2）：只列已启用 Agent 所在的环境。
 * 未就绪时一个「安装并登录」／「登录」按钮；命令默认收起、可查看与复制。
 * cf／vercel／gh 在后台安装并让 CLI 打开浏览器登录（2026-11-21），不再显示终端；
 * 只有 OCI 的 setup bootstrap 仍用可见终端。等待与失败状态来自后端
 * `cli-setup://changed`；showDetail 时再显示路径和切换账号入口。
 * 结果区域设置 aria-live（6.12），检测结果淡入 150ms（7.7）
 */
export function CliEnvList({
  provider,
  envStates,
  detecting,
  showDetail = false,
  setup,
  onSetup,
}: {
  provider: CliProvider
  envStates: Partial<Record<EnvId, CliEnvState>>
  detecting: boolean
  showDetail?: boolean
  setup?: CliSetupRun
  onSetup: (envId: EnvId, methodId: string) => void
}) {
  const envIds = sortEnvs(Object.keys(envStates))
  // 每个环境选的安装方式；点按钮时后端按它查固定命令
  const [methodByEnv, setMethodByEnv] = useState<Partial<Record<EnvId, string>>>({})
  // 未就绪时的命令默认收起（P9b）
  const [openByEnv, setOpenByEnv] = useState<Partial<Record<EnvId, boolean>>>({})
  if (envIds.length === 0) {
    return detecting ? (
      <div className="flex flex-col gap-1.5" aria-busy="true" aria-label={copy.cli.checking}>
        <Skeleton className="h-12 rounded-lg" />
        <Skeleton className="h-12 rounded-lg" />
      </div>
    ) : (
      <p className="text-xs text-muted-foreground">{copy.cli.unchecked}</p>
    )
  }
  return (
    <ItemGroup aria-label={copy.cli.envCheckLabel} aria-live="polite" aria-busy={detecting || undefined} className="gap-1.5">
      {envIds.map((envId) => {
        const state = envStates[envId]!
        const status = cliEnvStatus(state)
        const { tone, icon } = STATUS_ICON[status]
        const methods = installMethods(provider, envId)
        const method = methods.find((m) => m.id === methodByEnv[envId]) ?? methods[0]
        const run = setup?.envId === envId ? setup : undefined
        const waiting = run?.state === "waiting-install" || run?.state === "waiting-login"
        const failed = run?.state === "failed" || run?.state === "timed-out"
        const open = !!openByEnv[envId]
        const terminal = provider === "oracle"
        const failure =
          run?.state === "timed-out"
            ? copy.cli.setupTimedOut
            : terminal
              ? run?.step === "login"
                ? copy.cli.setupFailedLoginTerminal
                : copy.cli.setupFailedInstallTerminal
              : run?.step === "login"
                ? copy.cli.setupFailedLogin
                : copy.cli.setupFailedInstall
        return (
          <motion.div key={`${envId}:${state.checkedAt}`} role="listitem" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.15 }}>
            <Item variant="outline" size="sm" className="items-start">
              <ItemMedia className="pt-0.5">
                <EnvIcon envId={envId} className="text-muted-foreground" />
              </ItemMedia>
              <ItemContent className="min-w-0">
                <ItemTitle className="flex-wrap text-[13px]">
                  {copy.env.long(envId)}
                  {detecting ? (
                    <span className="flex items-center gap-1 text-xs font-normal text-muted-foreground">
                      <Spinner className="size-3" aria-hidden />
                      {copy.cli.checking}
                    </span>
                  ) : waiting ? (
                    <span role="status" className="flex items-center gap-1 text-xs font-normal text-muted-foreground">
                      <Spinner className="size-3" aria-hidden />
                      {run?.state === "waiting-install" ? copy.cli.waitingInstall : copy.cli.waitingLogin}
                    </span>
                  ) : (
                    <StateText tone={tone} icon={icon} className="text-xs font-normal">
                      {copy.cli.status[status]}
                    </StateText>
                  )}
                </ItemTitle>
                {state.version && (
                  <ItemDescription className="font-mono text-xs">{copy.cli.versionAccount(`${CLI_BINARY[provider]} ${state.version}`, state.account)}</ItemDescription>
                )}
                {showDetail && state.path && <ItemDescription className="truncate font-mono text-xs">{state.path}</ItemDescription>}
                {waiting && (
                  <ItemDescription className="text-xs">
                    {terminal
                      ? run?.state === "waiting-install"
                        ? copy.cli.setupNoteInstallTerminal
                        : copy.cli.setupNoteLoginTerminal
                      : run?.state === "waiting-install"
                        ? copy.cli.setupNoteInstall
                        : copy.cli.setupNoteLogin}
                  </ItemDescription>
                )}
                {failed && <ItemDescription className="text-xs text-warning">{failure}</ItemDescription>}
                {!waiting && status !== "ready" && !detecting && (
                  <Button
                    variant="link"
                    size="xs"
                    className="h-auto justify-start p-0 text-xs text-muted-foreground"
                    aria-expanded={open}
                    onClick={() => setOpenByEnv((m) => ({ ...m, [envId]: !m[envId] }))}
                  >
                    {open ? copy.cli.hideCommands : copy.cli.viewCommands}
                  </Button>
                )}
                {open && status === "not-installed" && (
                  <InstallGuide envId={envId} methods={methods} method={method} onMethod={(id) => setMethodByEnv((m) => ({ ...m, [envId]: id }))} />
                )}
                {open && status !== "ready" && status !== "not-installed" && (
                  <CommandLine envId={envId} command={loginCommand(provider)} className="mt-1" />
                )}
                {status !== "ready" && provider === "oracle" && status !== "not-installed" && (
                  <ItemDescription className="text-xs">{copy.cli.loginHintOci}</ItemDescription>
                )}
              </ItemContent>
              <ItemActions>
                {status !== "ready" ? (
                  <Button variant="outline" size="xs" disabled={detecting} onClick={() => onSetup(envId, method.id)}>
                    {waiting ? (
                      terminal ? (
                        <SquareTerminalIcon data-icon="inline-start" />
                      ) : (
                        <RefreshCwIcon data-icon="inline-start" />
                      )
                    ) : terminal ? (
                      <SquareTerminalIcon data-icon="inline-start" />
                    ) : status === "not-installed" ? (
                      <DownloadIcon data-icon="inline-start" />
                    ) : (
                      <LogInIcon data-icon="inline-start" />
                    )}
                    {waiting
                      ? terminal
                        ? copy.cli.reopenTerminal
                        : copy.cli.restartSetup
                      : status === "not-installed"
                        ? copy.cli.installAndLogin
                        : copy.cli.login}
                  </Button>
                ) : (
                  showDetail && (
                    <Button variant="ghost" size="xs" onClick={() => onSetup(envId, methods[0].id)}>
                      {terminal ? <SquareTerminalIcon data-icon="inline-start" /> : <LogInIcon data-icon="inline-start" />}
                      {terminal ? copy.cli.switchAccountTerminal : copy.cli.switchAccount}
                    </Button>
                  )
                )}
              </ItemActions>
            </Item>
          </motion.div>
        )
      })}
    </ItemGroup>
  )
}

/** 一条可复制的命令。前面的提示符跟着运行环境走（Windows 是 PS>，WSL 是 $），一眼看出该在哪个终端里跑 */
function CommandLine({ envId, command, className }: { envId: EnvId; command: string; className?: string }) {
  const copyCommand = () => void navigator.clipboard.writeText(command).then(() => toast.add({ title: copy.cli.commandCopied }))
  return (
    <div className={cn("flex min-w-0 items-start gap-1 rounded-md border bg-muted/60 py-1 pr-1 pl-2", className)}>
      <code className="min-w-0 flex-1 py-0.5 font-mono text-xs break-all">
        <span aria-hidden className="mr-1.5 text-muted-foreground select-none">
          {envId === "windows" ? "PS>" : "$"}
        </span>
        {command}
      </code>
      <Button variant="ghost" size="icon-xs" className="shrink-0" aria-label={copy.cli.copyCommand} onClick={copyCommand}>
        <CopyIcon />
      </Button>
    </div>
  )
}

/**
 * 安装指引（F-104 AC2）：未安装时代替单行命令。先选包管理器，下面是对应的命令；
 * 需要先装运行时（Node.js、Python）时在右侧注明，装完切回窗口自动重新检测
 */
function InstallGuide({ envId, methods, method, onMethod }: { envId: EnvId; methods: InstallMethod[]; method: InstallMethod; onMethod: (id: string) => void }) {
  return (
    <div className="mt-1.5 flex flex-col gap-1.5" role="group" aria-label={copy.cli.installGuide}>
      <div className="flex flex-wrap items-center gap-2">
        <ToggleGroup
          size="sm"
          variant="outline"
          value={[method.id]}
          onValueChange={(v: string[]) => v[0] && onMethod(v[0])}
          aria-label={copy.cli.installMethod}
        >
          {methods.map((m) => (
            <ToggleGroupItem key={m.id} value={m.id} className="h-6 px-2 font-mono text-xs">
              {m.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {method.requires && <span className="text-xs text-muted-foreground">{copy.cli.requires[method.requires]}</span>}
      </div>
      <CommandLine envId={envId} command={method.command} />
    </div>
  )
}

/** 重新检测按钮：检测中显示 Spinner */
export function RecheckButton({ detecting, onClick }: { detecting: boolean; onClick: () => void }) {
  return (
    <Button variant="outline" size="xs" disabled={detecting} onClick={onClick}>
      {detecting ? <Spinner data-icon="inline-start" aria-hidden /> : <RefreshCwIcon data-icon="inline-start" />}
      {copy.cli.recheck}
    </Button>
  )
}

/**
 * 允许 Agent 操作的资源范围（F-104 AC3、AC4）：按类型分组勾选，未勾选的不进入编译产物。
 * 域名旁标出自动识别的关联服务器；OCI 实例旁提供「同时加为 SSH 服务器」
 */
export function CliScopeList({
  provider,
  items,
  loading,
  waiting,
  allBound,
  onChange,
  onAddAsServer,
}: {
  provider: CliProvider
  items: CliScopeItem[] | null
  loading: boolean
  /** 还没有就绪的运行环境，拉取不了 */
  waiting: boolean
  /** 这次登录下的账号都已接入：上面已经写了怎么换账号，这里不再说「就绪后才能拉取」 */
  allBound?: boolean
  onChange: (selectedIds: string[]) => void
  onAddAsServer?: (item: CliScopeItem) => void
}) {
  const byId = useAssetStore((s) => s.byId)
  const aliasOf = (id?: string) => {
    const a: Asset | undefined = id ? byId[id] : undefined
    return a ? handleOf(a) : undefined
  }
  if (loading && !items) {
    return (
      <div className="flex flex-col gap-1.5" aria-busy="true" aria-label={copy.cli.scopeLoading}>
        <Skeleton className="h-6 w-1/2" />
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-6 w-1/3" />
      </div>
    )
  }
  if (!items && allBound) return <p className="text-xs text-muted-foreground">{copy.cli.scopeAllBound}</p>
  if (!items) return <p className="text-xs text-muted-foreground">{waiting ? copy.cli.scopeWaiting : copy.cli.scopeLoading}</p>
  if (items.length === 0) return <p className="text-xs text-muted-foreground">{copy.cli.scopeEmpty}</p>

  const selected = items.filter((x) => x.selected).map((x) => x.id)
  const set = (ids: string[], on: boolean) => onChange(on ? [...new Set([...selected, ...ids])] : selected.filter((id) => !ids.includes(id)))

  return (
    <div className="flex flex-col gap-4">
      {SCOPE_KINDS[provider].map((kind) => {
        const group = items.filter((x) => x.kind === kind)
        if (group.length === 0) return null
        const all = group.every((x) => x.selected)
        return (
          <FieldSet key={kind} className="min-w-0 gap-1.5">
            <div className="flex items-center gap-2">
              <FieldLegend variant="label" className="mb-0">
                {copy.cli.kind[kind]}
              </FieldLegend>
              <Button variant="link" size="xs" className="ml-auto h-auto p-0" onClick={() => set(group.map((x) => x.id), !all)}>
                {all ? copy.cli.clearAll : copy.cli.selectAll}
              </Button>
            </div>
            <div className="flex flex-col divide-y rounded-lg border">
              {group.map((x) => {
                const linked = aliasOf(x.linkedAssetId)
                const id = `scope-${x.id}`
                return (
                  <Field key={x.id} orientation="horizontal" className="min-h-9 items-center gap-2.5 px-2.5 py-1.5">
                    <Checkbox id={id} checked={x.selected} onCheckedChange={(v) => set([x.id], v === true)} />
                    <FieldLabel htmlFor={id} className="min-w-0 flex-1 truncate font-mono text-[0.8125rem] font-normal">
                      {x.name}
                    </FieldLabel>
                    {linked && (
                      <Badge variant="outline" className="shrink-0">
                        <ServerIcon data-icon="inline-start" />
                        {copy.cli.linked(linked)}
                      </Badge>
                    )}
                    {x.kind === "instance" && onAddAsServer && (
                      <Button variant="secondary" size="xs" className="shrink-0" onClick={() => onAddAsServer(x)}>
                        <PlusIcon data-icon="inline-start" />
                        {copy.cli.addAsServer}
                      </Button>
                    )}
                  </Field>
                )
              })}
            </div>
          </FieldSet>
        )
      })}
      {provider === "cloudflare" && (
        <p className="text-xs leading-relaxed text-muted-foreground">{copy.cli.scopeOtherProducts}</p>
      )}
      {loading && (
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Spinner className="size-3.5" aria-hidden />
          {copy.cli.scopeLoading}
        </span>
      )}
    </div>
  )
}
