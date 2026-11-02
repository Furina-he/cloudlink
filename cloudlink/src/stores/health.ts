// 健康汇总（PRD 7.5 selectHealth）：侧栏计数和 Agent 页顶部摘要共用
import type { CompileStatus, Delivery, GuardStatus } from "@/bindings"
import { isDeliveryProblem } from "./deliveries"
import { selectBlockedAssetIds } from "./skills"

export interface Health {
  /** 副本缺失、被改动、待同步、冲突（F-305） */
  deliveryProblems: number
  /** 护栏未生效 */
  guardProblems: number
  /** 导致编译受阻的服务器数 */
  blockedAssets: number
}

export function selectHealth(
  deliveries: Delivery[],
  guards: (GuardStatus | undefined)[],
  statuses: CompileStatus[]
): Health {
  return {
    deliveryProblems: deliveries.filter(isDeliveryProblem).length,
    guardProblems: guards.filter((g) => g?.state === "broken").length,
    blockedAssets: selectBlockedAssetIds(statuses).length,
  }
}
