import { CopyIcon, KeyRoundIcon, PlugIcon, RadarIcon, RefreshCwIcon, Trash2Icon, TriangleAlertIcon } from "lucide-react"
import { motion } from "motion/react"
import type { ReactNode } from "react"

import type { Asset, CliAsset, CliScopeKind, ServerAsset } from "@/bindings"
import { ProviderMark } from "@/components/app/ProviderMark"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu"
import { Item } from "@/components/ui/item"
import { Spinner } from "@/components/ui/spinner"
import { useAgentOptions } from "@/features/agents/agentKeys"
import { SCOPE_KINDS } from "@/lib/cliProviders"
import { copy } from "@/lib/copy"
import { cn } from "@/lib/utils"
import { connState, handleOf, selectCanDistribute, selectCliAccount, selectCliProblem, useAssetStore, type ConnState } from "@/stores/assets"
import { useCliStore } from "@/stores/cli"
import { useConnectionStore } from "@/stores/connection"
import { selectPendingCount, useNotesStore } from "@/stores/notes"
import { isProbing, useProbeStore } from "@/stores/probe"
import { useUIStore } from "@/stores/ui"
import { serverActions, useConverting } from "./actions"
import { AgentPicker } from "./AgentPicker"
import { ModeBreaker } from "./ModeSwitch"

/** 连接状态圆点（DESIGN.md Single-Line Breaker Row）：已连接实心绿、未验证空心灰圈、连接已修改琥珀、失败红；状态词给读屏 */
const DOT: Record<ConnState, string> = {
  connected: "bg-success",
  unverified: "border border-muted-foreground bg-transparent",
  changed: "bg-warning",
  failed: "bg-destructive",
}

/** 回路行就地修复的轻量按钮（PRD 6.4）：叠在打开详情的按钮之上，点它不进入详情 */
function FixButton({ busy, onClick, children }: { busy?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <Button variant="outline" size="xs" disabled={busy} className="pointer-events-auto relative z-10 shrink-0" onClick={onClick}>
      {busy && <Spinner data-icon="inline-start" aria-hidden />}
      {children}
    </Button>
  )
}

function NotesBadge({ assetId }: { assetId: string }) {
  const notes = useNotesStore((s) => selectPendingCount(s.byAsset, assetId))
  return notes > 0 ? (
    <Badge variant="outline" className="shrink-0">
      {copy.servers.notesBadge(notes)}
    </Badge>
  ) : null
}

/**
 * 一条单行回路（DESIGN.md Signature 1，行高 46px）：左侧身份，点击进入详情；右侧档位闸刀和 Agent 开关，独立可操作。
 * 打开按钮铺满左侧，文字叠在它上面但不拦截点击，状态旁边的修复按钮因此不会嵌套在按钮里
 */
function RowShell({ asset, current, fresh, stateWords, children, menu }: { asset: Asset; current: boolean; fresh: boolean; stateWords: string; children: ReactNode; menu: ReactNode }) {
  const { agents } = useAgentOptions()
  const handle = handleOf(asset)
  return (
    <motion.div role="listitem" initial={fresh ? { opacity: 0, y: 4 } : false} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }}>
      <ContextMenu>
        <ContextMenuTrigger
          render={
            <Item
              className={cn(
                "min-h-11.5 flex-nowrap gap-3 rounded-none border-0 py-1.5 has-[[data-grid-cell]:hover]:bg-muted/50 has-[[data-grid-cell]:focus-visible]:ring-2 has-[[data-grid-cell]:focus-visible]:ring-ring has-[[data-grid-cell]:focus-visible]:ring-inset",
                current && "bg-muted"
              )}
            />
          }
        >
          <div className="relative flex min-w-0 flex-1 items-center gap-2.5 self-stretch">
            <button
              type="button"
              data-grid-cell
              data-asset-id={asset.id}
              aria-current={current ? "true" : undefined}
              aria-label={copy.servers.rowOpen(handle, asset.name, stateWords)}
              onClick={() => useUIStore.getState().selectAsset(asset.id)}
              className="absolute inset-0 outline-none"
            />
            <div className="pointer-events-none flex min-w-0 flex-1 items-center gap-2.5">{children}</div>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <ModeBreaker asset={asset} />
            {agents.length > 0 ? <AgentPicker asset={asset} agents={agents} compact /> : <span className="text-xs text-muted-foreground">{copy.servers.noAgents}</span>}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-auto min-w-44">{menu}</ContextMenuContent>
      </ContextMenu>
    </motion.div>
  )
}

/** 服务器：状态圆点、名称、等宽别名；异常时紧跟「测试连接」或「改用密钥登录」，有待处理笔记时显示「笔记 N」。正常时不写多余文字 */
export function ServerRow({ asset, current, fresh }: { asset: ServerAsset; current: boolean; fresh: boolean }) {
  const probing = useProbeStore((s) => isProbing(s, asset.id))
  const testing = useConnectionStore((s) => s.testsByKey[asset.id]?.status === "running")
  const converting = useConverting((s) => s.ids.includes(asset.id))
  const state = connState(asset)
  const can = selectCanDistribute(asset)
  const passwordOnly = !can.ok && can.reason === "password-only"

  return (
    <RowShell
      asset={asset}
      current={current}
      fresh={fresh}
      stateWords={`${copy.connState[state]}，${copy.mode[asset.agent.mode]}`}
      menu={
        <>
          <ContextMenuItem onClick={() => serverActions.test(asset)}>
            <PlugIcon />
            {copy.detail.test}
          </ContextMenuItem>
          {passwordOnly && (
            <ContextMenuItem onClick={() => void serverActions.convertToKey(asset.id)}>
              <KeyRoundIcon />
              {copy.test.convertKey}
            </ContextMenuItem>
          )}
          <ContextMenuItem onClick={() => (probing ? serverActions.cancelProbe(asset) : serverActions.probe(asset))}>
            <RadarIcon />
            {probing ? copy.detail.cancelProbe : copy.detail.probe}
          </ContextMenuItem>
          <ContextMenuItem onClick={() => serverActions.copyAlias(asset)}>
            <CopyIcon />
            {copy.detail.copyAlias}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem variant="destructive" onClick={() => serverActions.requestDelete(asset)}>
            <Trash2Icon />
            {copy.detail.delete}
          </ContextMenuItem>
        </>
      }
    >
      <span aria-hidden className={cn("size-2 shrink-0 rounded-full", DOT[state])} />
      <span className="min-w-0 truncate text-sm font-medium">{asset.name}</span>
      <span className="shrink-0 rounded-sm bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">{asset.connection.sshAlias}</span>
      {probing && (
        <>
          <Spinner aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="sr-only">{copy.servers.probingLabel}</span>
        </>
      )}
      {passwordOnly ? (
        <FixButton busy={converting} onClick={() => void serverActions.convertToKey(asset.id)}>
          {copy.test.convertKey}
        </FixButton>
      ) : (
        state !== "connected" && (
          <FixButton busy={testing} onClick={() => serverActions.test(asset)}>
            {copy.detail.test}
          </FixButton>
        )
      )}
      <NotesBadge assetId={asset.id} />
    </RowShell>
  )
}

/** 已选资源的摘要：「2 个域名、1 个 Worker」 */
export function scopeSummary(asset: CliAsset): string {
  const count = (kind: CliScopeKind) => asset.cli.scope.filter((x) => x.selected && x.kind === kind).length
  const parts = SCOPE_KINDS[asset.cliProvider].filter((k) => count(k) > 0).map((k) => copy.cli.kindCount[k](count(k)))
  return parts.length ? parts.join("、") : copy.cli.scopeNone
}

/** 自动识别出的关联服务器的别名 */
export function useLinkedAliases(asset: CliAsset): string[] {
  const byId = useAssetStore((s) => s.byId)
  const ids = [...new Set(asset.cli.scope.filter((x) => x.selected && x.linkedAssetId).map((x) => x.linkedAssetId!))]
  return ids.map((id) => byId[id]).filter(Boolean).map(handleOf)
}

/** 云平台：官方 Logo、平台名称、账号与范围简述；某个环境未就绪时就地显示「⚠ WSL 未登录」和「去登录」。就绪时不写「已就绪」 */
export function CliRow({ asset, current, fresh }: { asset: CliAsset; current: boolean; fresh: boolean }) {
  const detecting = useCliStore((s) => !!s.byProvider[asset.cliProvider]?.detecting)
  const problem = selectCliProblem(asset)
  const account = selectCliAccount(asset)
  const none = Object.keys(asset.cli.envStates).length === 0
  const word = none ? copy.cli.unchecked : problem ? copy.cli.envProblem(copy.env.short(problem.envId), copy.cli.status[problem.status]) : copy.cli.status.ready
  const brief = [account, problem ? null : scopeSummary(asset)].filter(Boolean).join(" · ")

  return (
    <RowShell
      asset={asset}
      current={current}
      fresh={fresh}
      stateWords={`${word}，${copy.mode[asset.agent.mode]}`}
      menu={
        <>
          <ContextMenuItem onClick={() => serverActions.recheckCli(asset)}>
            <RefreshCwIcon />
            {copy.cli.recheck}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem variant="destructive" onClick={() => serverActions.requestDelete(asset)}>
            <Trash2Icon />
            {copy.cli.delete}
          </ContextMenuItem>
        </>
      }
    >
      <ProviderMark provider={asset.cliProvider} />
      <span className="shrink-0 text-sm font-medium">{asset.name}</span>
      {brief && <span className="min-w-0 truncate text-xs text-muted-foreground">{brief}</span>}
      {detecting ? (
        <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
          <Spinner className="size-3.5" aria-hidden />
          {copy.cli.checking}
        </span>
      ) : (
        (problem || none) && (
          <>
            <span className="flex shrink-0 items-center gap-1 text-xs text-warning">
              <TriangleAlertIcon className="size-3.5" aria-hidden />
              {word}
            </span>
            {problem ? (
              <FixButton onClick={() => serverActions.openCliTerminal(asset, problem.envId)}>{copy.cli.fix[problem.status]}</FixButton>
            ) : (
              <FixButton onClick={() => serverActions.recheckCli(asset)}>{copy.cli.recheck}</FixButton>
            )}
          </>
        )
      )}
      <NotesBadge assetId={asset.id} />
    </RowShell>
  )
}
