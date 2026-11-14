import { LockIcon, TriangleAlertIcon } from "lucide-react"

import type { ServerAsset } from "@/bindings"
import { CommandChip } from "@/components/app/CommandChip"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { FieldGroup } from "@/components/ui/field"
import { useMinuteTick } from "@/hooks/use-minute-tick"
import { copy } from "@/lib/copy"
import { formatRelative } from "@/lib/format"
import type { AliasContext } from "@/lib/schemas"
import { AdvancedFields } from "../AdvancedFields"
import { ConnectionFields } from "../ConnectionFields"
import { ExportSwitch } from "../ExportSwitch"
import { sortEnvs } from "../serverForm"

const envList = (ids: string[]) => sortEnvs(ids).map(copy.env.long).join("、")

/** 字段导出（F-105）：连接与监听端口默认关，镜像版本默认开。 */
export function ExportSwitches({ untitled }: { untitled?: boolean }) {
  return (
    <div className="flex flex-col gap-3">
      {!untitled && <span className="text-sm font-medium">{copy.connection.exportTitle}</span>}
      <ExportSwitch name="export.resolvedConnection" label={copy.connection.exportResolved} hint={copy.connection.exportResolvedHint} />
      <ExportSwitch name="export.listeningPorts" label={copy.connection.exportListening} hint={copy.connection.exportListeningHint} />
      <ExportSwitch name="export.image" label={copy.services.exportImage} hint={copy.services.exportImageHint} />
    </div>
  )
}

/** 探测得到的监听端口，只读 */
export function ListeningPorts({ asset }: { asset: ServerAsset }) {
  return (
    // 标题由外层的 PrefRow 给出，这里不再重复
    <div className="flex flex-col gap-1.5">
      {asset.listeningPorts.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {asset.listeningPorts.map((p) => (
            <li key={`${p.addr}:${p.port}/${p.proto}`}>
              <CommandChip>{`${p.addr}:${p.port}/${p.proto}`}</CommandChip>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">{copy.connection.listeningEmpty}</p>
      )}
    </div>
  )
}

/** imported：ssh -G 的解析结果，只读，每行前有 LockIcon（PRD 6.4） */
export function ImportedConnection({ asset }: { asset: ServerAsset }) {
  const now = useMinuteTick()
  const r = asset.connection.resolved
  const rows: [string, string][] = r
    ? [
        ["Host", asset.connection.sshAlias],
        ["HostName", r.hostname],
        ["User", r.user],
        ["Port", String(r.port)],
        ["ProxyJump", r.proxyJump ?? copy.common.none],
      ]
    : []
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm">{copy.connection.importedNote}</p>
      <p className="text-xs text-muted-foreground">{copy.connection.importedFrom(envList(asset.connection.definedIn))}</p>
      {r ? (
        <>
          <dl className="grid grid-cols-[auto_auto_minmax(0,1fr)] items-center gap-x-2 gap-y-1 rounded-lg border bg-muted/50 px-3 py-2 text-sm">
            {rows.map(([k, v]) => (
              <div key={k} className="contents">
                <LockIcon className="size-3.5 text-muted-foreground" aria-label={copy.connection.lockedField} />
                <dt className="font-mono text-xs text-muted-foreground">{k}</dt>
                <dd className="truncate font-mono text-xs">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="text-xs text-muted-foreground">{copy.connection.resolvedAt(formatRelative(r.resolvedAt, now))}</p>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">{copy.connection.resolvedNone}</p>
      )}
    </div>
  )
}

/** F-107 AC4：写入后用 ssh -G 回读，生效值与录入值不一致（被用户 config 里更靠前的规则覆盖）时指出字段 */
export function ResolvedMismatch({ asset }: { asset: ServerAsset }) {
  const c = asset.connection
  const r = c.resolved
  if (!r) return null
  const fields = [
    r.hostname !== c.host && "HostName",
    r.user !== c.user && "User",
    r.port !== c.port && "Port",
    (r.proxyJump ?? null) !== (c.proxyJump ?? null) && "ProxyJump",
  ].filter((f): f is string => !!f)
  if (fields.length === 0) return null
  return (
    <Alert>
      <TriangleAlertIcon className="text-warning!" />
      <AlertTitle>{copy.connection.mismatchTitle}</AlertTitle>
      <AlertDescription>{copy.connection.mismatch(fields.join("、"))}</AlertDescription>
    </Alert>
  )
}

/**
 * 连接编辑（PRD 6.4）：managed 用新建表单的同一组字段（6.5），别名、跳板机、写入的运行环境和「导出到 Skill」的开关（F-105）
 * 折叠在「高级」里；imported 只读展示 ssh -G 的解析结果，只能改导出开关
 */
export function ConnectionEditor({
  asset,
  ctx,
  advancedOpen,
  onAdvancedChange,
}: {
  asset: ServerAsset
  ctx: AliasContext
  advancedOpen: boolean
  onAdvancedChange: (open: boolean) => void
}) {
  if (asset.connection.source === "imported") {
    return (
      <div className="flex flex-col gap-4">
        <ImportedConnection asset={asset} />
        {/* 对话框标题已经写明是在选「让 Agent 知道哪些」 */}
        <ExportSwitches untitled />
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-4">
      <ResolvedMismatch asset={asset} />
      <FieldGroup className="@container/field-group gap-4">
        <ConnectionFields assetId={asset.id} />
        <AdvancedFields open={advancedOpen} onOpenChange={onAdvancedChange} ctx={ctx}>
          <ExportSwitches />
        </AdvancedFields>
      </FieldGroup>
    </div>
  )
}
