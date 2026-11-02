import { BotIcon, EllipsisIcon, FolderIcon, FolderOpenIcon, RefreshCwIcon, Trash2Icon, WrenchIcon } from "lucide-react"

import type { Delivery, Target } from "@/bindings"
import { DELIVERY_STATE, StateBadge } from "@/components/app/StateBadge"
import { Truncate } from "@/components/app/Truncate"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { copy } from "@/lib/copy"
import { isDeliveryProblem } from "@/stores/deliveries"
import { targetActions, targetLabel, useTargetUI } from "./targetActions"

/** 副本状态（6.11 状态词表）：已同步 N 台 / 副本缺失 / 副本被改动 / 待同步 / 冲突 / 同步中 */
function DeliveryState({ target, delivery, included, busy }: { target: Target; delivery: Delivery | undefined; included: number; busy: boolean }) {
  if (busy) {
    return (
      <StateBadge tone="neutral" icon={null}>
        {copy.delivery.pending}
      </StateBadge>
    )
  }
  if (!target.enabled) return <span className="text-xs text-muted-foreground">{copy.targets.disabled}</span>
  if (!delivery) return <span className="text-xs text-muted-foreground">{copy.deliveryNone}</span>
  const { tone, icon } = DELIVERY_STATE[delivery.status]
  return (
    <StateBadge tone={tone} icon={icon}>
      {delivery.status === "ok" ? copy.deliveryOk(included) : copy.delivery[delivery.status]}
    </StateBadge>
  )
}

/**
 * Agent 目标卡片（PRD 6.6）：图标与名称、目录（等宽、截断）、检测状态、副本状态、修复、启用开关；
 * 「更多」里有在文件夹中显示、检查，自定义目录额外有「移除」
 */
export function TargetCard({ target, delivery, included }: { target: Target; delivery: Delivery | undefined; included: number }) {
  const busy = useTargetUI((s) => s.busy.includes(target.id))
  const label = targetLabel(target)
  const env = copy.env.long(target.envId)
  const problem = target.enabled && !!delivery && isDeliveryProblem(delivery)
  const Icon = target.agent === "custom" ? FolderIcon : BotIcon

  return (
    <Card size="sm" data-problem={problem || undefined} className="gap-2">
      <CardHeader className="gap-x-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span aria-hidden className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <Icon className="size-4" />
          </span>
          <div className="flex min-w-0 flex-col gap-1">
            <CardTitle className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {label}
              {!target.detected && <Badge variant="outline">{copy.targets.notDetected}</Badge>}
              <DeliveryState target={target} delivery={delivery} included={included} busy={busy} />
            </CardTitle>
            <CardDescription className="flex min-w-0">
              <Truncate text={target.path} className="font-mono text-xs" />
            </CardDescription>
          </div>
        </div>
        <CardAction className="flex items-center gap-1.5">
          {problem && delivery && delivery.status !== "conflict" && (
            <Button variant="outline" size="sm" disabled={busy} onClick={() => targetActions.repair(target, delivery)} aria-label={`${copy.targets.repair}：${label}（${env}）`}>
              {busy ? <Spinner data-icon="inline-start" aria-hidden /> : <WrenchIcon data-icon="inline-start" />}
              {copy.targets.repair}
            </Button>
          )}
          {problem && delivery?.status === "conflict" && (
            <Button variant="outline" size="sm" onClick={() => void targetActions.checkAll()} aria-label={`${copy.targets.check}：${label}（${env}）`}>
              <RefreshCwIcon data-icon="inline-start" />
              {copy.targets.check}
            </Button>
          )}
          <Switch checked={target.enabled} disabled={busy} onCheckedChange={(on) => targetActions.toggle(target, on)} aria-label={copy.targets.enable(label, env)} />
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={copy.targets.actions(label)} />}>
              <EllipsisIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-auto min-w-40">
              <DropdownMenuItem onClick={() => targetActions.reveal(target, delivery)}>
                <FolderOpenIcon />
                {copy.common.reveal}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void targetActions.checkAll()}>
                <RefreshCwIcon />
                {copy.targets.check}
              </DropdownMenuItem>
              {target.agent === "custom" && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onClick={() => useTargetUI.getState().set({ kind: "remove", targetId: target.id })}>
                    <Trash2Icon />
                    {copy.targets.removeCustom}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </CardAction>
      </CardHeader>
      {problem && delivery && <p className="px-3 text-xs text-muted-foreground">{copy.deliveryDetail[delivery.status]}</p>}
    </Card>
  )
}
