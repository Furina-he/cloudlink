// SSH 配置有没有在运行环境里生效（F-107 AC1）
import type { EnvId, Environment, ServerAsset } from "@/bindings"
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
