import type { CliAsset, CliScopeKind } from "@/bindings"
import { SCOPE_KINDS } from "@/lib/cliProviders"
import { copy } from "@/lib/copy"
import { handleOf, useAssetStore } from "@/stores/assets"

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
