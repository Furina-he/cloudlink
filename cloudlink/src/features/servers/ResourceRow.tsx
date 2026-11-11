import { ChevronDownIcon, ChevronRightIcon, CopyIcon, KeyRoundIcon, PencilIcon, PlugIcon, RadarIcon, RefreshCwIcon, ServerIcon, Trash2Icon, type LucideIcon } from "lucide-react"
import { motion } from "motion/react"
import { Fragment, useState, type ReactNode } from "react"

import type { Asset, CliAsset, Mode, ServerAsset } from "@/bindings"
import { ProviderMark } from "@/components/app/ProviderMark"
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu"
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Spinner } from "@/components/ui/spinner"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useAgentOptions } from "@/features/agents/agentKeys"
import { copy } from "@/lib/copy"
import { cn } from "@/lib/utils"
import { connState, handleOf, isProdWritable, selectCanDistribute, selectCliAccount, selectCliProblem, type ConnState } from "@/stores/assets"
import { useCliStore } from "@/stores/cli"
import { useConnectionStore } from "@/stores/connection"
import { useTargetStore } from "@/stores/targets"
import { isProbing, useProbeStore } from "@/stores/probe"
import { useUIStore } from "@/stores/ui"
import { serverActions, useConverting } from "./actions"
import { AgentPicker } from "./AgentPicker"
import { isUnreachableByAgents } from "./includeState"

/** 状态点（DESIGN.md The Dot Not Stripe Rule）：实心带 3px 同色 soft 光晕；未验证是空心圈 */
const DOT: Record<ConnState, string> = {
  connected: "bg-success shadow-[0_0_0_3px_var(--color-success-soft)]",
  unverified: "border-[1.5px] border-faint bg-transparent",
  changed: "bg-warning shadow-[0_0_0_3px_var(--color-warning-soft)]",
  failed: "bg-destructive shadow-[0_0_0_3px_var(--color-destructive-soft)]",
}

function Dot({ state, label }: { state: ConnState; label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="pointer-events-auto inline-flex size-3.5 items-center justify-center" />}>
        <span aria-hidden className={cn("size-1.75 rounded-full", DOT[state])} />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

/** 资源行就地修复按钮（PRD 6.3）：每行最多一个，灰色 pill */
function FixButton({ busy, onClick, children }: { busy?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      disabled={busy}
      onClick={onClick}
      className="inline-flex h-6.5 shrink-0 items-center gap-1.5 rounded-button bg-pill px-2.5 text-xs font-medium text-foreground outline-none hover:bg-pill-hover focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
    >
      {busy && <Spinner className="size-3.5" aria-hidden />}
      {children}
    </button>
  )
}

/**
 * 档位弹出菜单（PRD 6.3）：两个选项各带一句后果说明；生产资源切到标准运维时菜单底部展开确认。
 * 生产资源处于标准运维时文字琥珀色、加粗
 */
export function ModeMenu({ asset }: { asset: Asset }) {
  const [open, setOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const mode = asset.agent.mode
  const warn = isProdWritable(asset)
  const alias = handleOf(asset)
  const choose = (next: Mode) => {
    if (next === mode) return setOpen(false)
    if (next === "standard" && asset.production) return setConfirming(true)
    setOpen(false)
    void serverActions.setMode(asset, next)
  }
  return (
    <DropdownMenu
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) setConfirming(false)
      }}
    >
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label={`${copy.row.modeMenuLabel(alias)}：${copy.mode[mode]}${warn ? `。${copy.servers.prodWritable}` : ""}`}
            className={cn(
              "pointer-events-auto relative z-10 -mx-1 inline-flex h-5 items-center gap-0.5 rounded-sm px-1 text-xs text-muted-foreground outline-none hover:bg-pill-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
              warn && "font-semibold text-warning hover:text-warning"
            )}
          />
        }
      >
        {copy.mode[mode]}
        <ChevronDownIcon className="size-3" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72 p-1">
        <div role="group" aria-label={copy.row.modeMenuLabel(alias)} className="flex flex-col">
          {(["read-only", "standard"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="menuitemradio"
              aria-checked={m === mode}
              onClick={() => choose(m)}
              className="flex flex-col items-start gap-0.5 rounded-control px-2.5 py-2 text-left outline-none hover:bg-pill focus-visible:bg-pill aria-checked:bg-pill"
            >
              <span className="flex w-full items-center text-[13px] font-medium">
                {copy.mode[m]}
                {m === mode && <span aria-hidden className="ml-auto size-1.5 rounded-full bg-foreground" />}
              </span>
              <span className="text-xs text-muted-foreground">{copy.row.modeShort[m]}</span>
            </button>
          ))}
        </div>
        {confirming && (
          <div role="alert" className="mt-1 flex flex-col gap-2 border-t border-line-2 px-2.5 pt-2.5 pb-1.5">
            <p className="text-xs text-fg-2">{copy.row.prodConfirm(alias)}</p>
            <div className="flex justify-end gap-1.5">
              <button type="button" className="h-6.5 rounded-button bg-pill px-2.5 text-xs hover:bg-pill-hover focus-visible:ring-2 focus-visible:ring-ring outline-none" onClick={() => setConfirming(false)}>
                {copy.common.cancel}
              </button>
              <button
                type="button"
                autoFocus
                className="h-6.5 rounded-button bg-ink px-2.5 text-xs text-primary-foreground hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring outline-none"
                onClick={() => {
                  setOpen(false)
                  setConfirming(false)
                  void serverActions.setMode(asset, "standard")
                }}
              >
                {copy.row.switch}
              </button>
            </div>
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

interface RowAction {
  key: string
  icon: LucideIcon
  label: string
  onClick: () => void
  destructive?: boolean
  separated?: boolean
}

/**
 * 两行资源行（PRD 6.3、DESIGN.md row）：左品牌方块；第一行名称 + 别名 + 生产，第二行状态点 + 问题 + 档位；
 * 右侧修复按钮 → Agent 图标组 → ›。打开详情的按钮铺满整行，其余控件叠在上面各自响应
 */
function RowShell({
  asset,
  fresh,
  mark,
  alias,
  problem,
  dot,
  fix,
  stateWords,
  actions,
}: {
  asset: Asset
  fresh: boolean
  mark: ReactNode
  alias?: string
  problem?: ReactNode
  dot: ReactNode
  fix?: ReactNode
  stateWords: string
  actions: RowAction[]
}) {
  const { agents } = useAgentOptions()
  const prod = asset.production
  return (
    <motion.div
      role="listitem"
      data-fresh={fresh || undefined}
      initial={fresh ? { opacity: 0 } : false}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.18 }}
      // 新加的行短暂高亮：中性底色，不用信号青（PRD 6.5）
      className="transition-colors duration-500 data-fresh:bg-pill-hover"
    >
      <ContextMenu>
        <ContextMenuTrigger
          render={
            <div className="group/row relative flex min-h-14 items-center gap-3 px-3.5 py-2 has-[[data-grid-cell]:hover]:bg-card-2 has-[[data-grid-cell]:focus-visible]:ring-2 has-[[data-grid-cell]:focus-visible]:ring-ring has-[[data-grid-cell]:focus-visible]:ring-inset" />
          }
        >
          <button
            type="button"
            data-grid-cell
            data-asset-id={asset.id}
            aria-label={copy.servers.rowOpen(handleOf(asset), asset.name, stateWords)}
            onClick={() => useUIStore.getState().selectAsset(asset.id)}
            className="absolute inset-0 outline-none"
          />
          <div className="pointer-events-none relative flex size-8 shrink-0 items-center justify-center rounded-tile border border-line bg-card text-fg-2">{mark}</div>
          <div className="pointer-events-none relative flex min-w-0 flex-1 flex-col gap-0.5">
            <div className="flex min-w-0 items-baseline gap-2">
              <span className="truncate text-[13.5px] font-medium">{asset.name}</span>
              {alias && <span className="shrink-0 font-mono text-xs text-muted-foreground">{alias}</span>}
              {prod && <span className="shrink-0 text-xs font-medium text-destructive">{copy.row.prod}</span>}
            </div>
            <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
              {dot}
              {problem && (
                <>
                  <span className="truncate">{problem}</span>
                  <span aria-hidden className="text-faint">·</span>
                </>
              )}
              <ModeMenu asset={asset} />
            </div>
          </div>
          <div className="relative z-10 flex shrink-0 items-center gap-3">
            {fix}
            {agents.length > 0 && <AgentPicker asset={asset} agents={agents} compact />}
            <ChevronRightIcon aria-hidden className="pointer-events-none size-4 text-faint" />
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-auto min-w-44">
          {actions.map((a) => (
            <Fragment key={a.key}>
              {a.separated && <ContextMenuSeparator />}
              <ContextMenuItem variant={a.destructive ? "destructive" : "default"} onClick={a.onClick}>
                <a.icon />
                {a.label}
              </ContextMenuItem>
            </Fragment>
          ))}
        </ContextMenuContent>
      </ContextMenu>
    </motion.div>
  )
}

const openDetail = (asset: Asset) => useUIStore.getState().selectAsset(asset.id)

/** 服务器行：正常即隐身，只有绿点；未验证、连接失败、只用密码时才写问题并给一个修复按钮 */
export function ServerRow({ asset, fresh }: { asset: ServerAsset; fresh: boolean }) {
  const probing = useProbeStore((s) => isProbing(s, asset.id))
  const testing = useConnectionStore((s) => s.testsByKey[asset.id]?.status === "running")
  const converting = useConverting((s) => s.ids.includes(asset.id))
  const state = connState(asset)
  const can = selectCanDistribute(asset)
  const passwordOnly = !can.ok && can.reason === "password-only"
  // 连得上，但所有运行环境都还没加入 SSH 配置：Agent 用别名连不上（PRD 6.5）
  const unreachable = useTargetStore((s) => can.ok && isUnreachableByAgents(asset, s.environments))
  const [joining, setJoining] = useState(false)
  const { agents } = useAgentOptions()
  const join = () => {
    setJoining(true)
    void serverActions.joinSshConfig(asset, agents.map((a) => a.key)).finally(() => setJoining(false))
  }
  const word = unreachable ? copy.include.rowProblem : copy.connState[state]

  return (
    <RowShell
      asset={asset}
      fresh={fresh}
      mark={<ServerIcon className="size-4" aria-hidden />}
      alias={asset.connection.sshAlias}
      dot={<Dot state={unreachable ? "changed" : state} label={state === "changed" ? copy.connChangedHint : word} />}
      problem={
        state !== "connected" || unreachable ? (
          word
        ) : probing ? (
          <span className="flex items-center gap-1">
            <Spinner className="size-3" aria-hidden />
            {copy.servers.probingLabel}
          </span>
        ) : undefined
      }
      stateWords={`${word}，${copy.mode[asset.agent.mode]}`}
      fix={
        passwordOnly ? (
          <FixButton busy={converting} onClick={() => void serverActions.convertToKey(asset.id)}>
            {copy.test.convertKey}
          </FixButton>
        ) : state !== "connected" ? (
          <FixButton busy={testing} onClick={() => serverActions.test(asset)}>
            {copy.detail.test}
          </FixButton>
        ) : unreachable ? (
          <FixButton busy={joining} onClick={join}>
            {copy.include.rowFix}
          </FixButton>
        ) : undefined
      }
      actions={[
        { key: "edit", icon: PencilIcon, label: copy.servers.edit, onClick: () => openDetail(asset) },
        { key: "test", icon: PlugIcon, label: copy.detail.test, onClick: () => serverActions.test(asset), separated: true },
        ...(passwordOnly ? [{ key: "convert", icon: KeyRoundIcon, label: copy.test.convertKey, onClick: () => void serverActions.convertToKey(asset.id) }] : []),
        {
          key: "probe",
          icon: RadarIcon,
          label: probing ? copy.detail.cancelProbe : copy.detail.probe,
          onClick: () => (probing ? serverActions.cancelProbe(asset) : serverActions.probe(asset)),
        },
        { key: "copy", icon: CopyIcon, label: copy.detail.copyAlias, onClick: () => serverActions.copyAlias(asset) },
        { key: "delete", icon: Trash2Icon, label: copy.detail.delete, onClick: () => serverActions.requestDelete(asset), destructive: true, separated: true },
      ]}
    />
  )
}

/** 云平台行：不写账号和范围摘要（在详情里）；某个运行环境未就绪时写「WSL 未登录」并给「去登录」 */
export function CliRow({ asset, fresh }: { asset: CliAsset; fresh: boolean }) {
  const detecting = useCliStore((s) => !!s.byProvider[asset.cliProvider]?.detecting)
  const problem = selectCliProblem(asset)
  const account = selectCliAccount(asset)
  const none = Object.keys(asset.cli.envStates).length === 0
  const state: ConnState = none ? "unverified" : problem ? (problem.status === "not-installed" ? "failed" : "changed") : "connected"
  const word = none ? copy.cli.unchecked : problem ? copy.cli.envProblem(copy.env.short(problem.envId), copy.cli.status[problem.status]) : copy.row.loggedIn(account ?? null)

  return (
    <RowShell
      asset={asset}
      fresh={fresh}
      mark={<ProviderMark provider={asset.cliProvider} className="size-4.5" />}
      dot={detecting ? <Spinner className="size-3.5" aria-hidden /> : <Dot state={state} label={word} />}
      problem={detecting ? copy.cli.checking : state !== "connected" ? word : undefined}
      stateWords={`${word}，${copy.mode[asset.agent.mode]}`}
      fix={
        detecting ? undefined : problem ? (
          <FixButton onClick={() => serverActions.openCliTerminal(asset, problem.envId)}>{copy.cli.fix[problem.status]}</FixButton>
        ) : none ? (
          <FixButton onClick={() => serverActions.recheckCli(asset)}>{copy.cli.recheck}</FixButton>
        ) : undefined
      }
      actions={[
        { key: "edit", icon: PencilIcon, label: copy.servers.edit, onClick: () => openDetail(asset) },
        { key: "recheck", icon: RefreshCwIcon, label: copy.cli.recheck, onClick: () => serverActions.recheckCli(asset), separated: true },
        { key: "delete", icon: Trash2Icon, label: copy.cli.delete, onClick: () => serverActions.requestDelete(asset), destructive: true, separated: true },
      ]}
    />
  )
}
