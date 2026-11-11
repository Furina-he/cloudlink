// SSH 配置有没有在运行环境里生效（F-107 AC1），以及一项资源同步到了几个目录
import type { Asset, EnvId, Environment, Inclusion, ServerAsset } from "@/bindings"
import { sortEnvs } from "./serverForm"

/** 这台服务器要用到、但还没加入 SSH 配置的运行环境。导入的服务器用的是用户自己的 ssh config，不涉及 */
export function missingIncludeEnvs(asset: ServerAsset, environments: Environment[]): EnvId[] {
  if (asset.connection.source !== "managed") return []
  return sortEnvs(asset.connection.definedIn).filter((id) => !environments.find((e) => e.id === id)?.managedSshConfig.included)
}

/** 所有运行环境都没加入：Agent 在哪里都连不上，资源行写「Agent 还连不上」（PRD 6.3、6.5） */
export function isUnreachableByAgents(asset: ServerAsset, environments: Environment[]): boolean {
  const defined = asset.connection.source === "managed" ? asset.connection.definedIn : []
  return defined.length > 0 && missingIncludeEnvs(asset, environments).length === defined.length
}

/** 同步给了几个目录：已列入的「运行环境 × 目录」 */
export function syncedDirs(inclusions: Inclusion[], asset: Pick<Asset, "id" | "agent">): number {
  return new Set(
    inclusions.filter((i) => i.assetId === asset.id && i.included && asset.agent.agents.includes(i.agentKey)).map((i) => `${i.envId}|${i.agentKey}`)
  ).size
}
