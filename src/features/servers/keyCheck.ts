import { useEffect, useState } from "react"

import type { EnvId, KeyCheck } from "@/bindings"
import { ipc } from "@/lib/ipc"

/** 同一路径的预检结果短时间内复用：私钥行和连接步骤读同一份，不重复启动 ssh-keygen */
const cache = new Map<string, { at: number; result: Promise<KeyCheck> }>()
const TTL_MS = 5_000
const UNCHECKED: KeyCheck = { status: "unchecked" }

const cacheKey = (envId: EnvId, path: string) => `${envId}\n${path.trim()}`

/** 私钥预检（F-108）：只读；后端没能检查时返回 unchecked，不下结论 */
export function checkKey(envId: EnvId, path: string): Promise<KeyCheck> {
  const key = cacheKey(envId, path)
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.result
  const result = ipc.checkKey({ envId, path: path.trim() }).catch(() => UNCHECKED)
  cache.set(key, { at: Date.now(), result })
  return result
}

/** 文件被替换或修好之后，下一次预检重新执行 */
export function forgetKeyCheck(envId: EnvId, path: string) {
  cache.delete(cacheKey(envId, path))
}

/** 路径停止输入 400ms 后预检；空路径不检查，路径变了之前的结果立即作废 */
export function useKeyCheck(envId: EnvId | undefined, path: string | undefined, delayMs = 400): KeyCheck | null {
  const trimmed = path?.trim() ?? ""
  const key = envId && trimmed ? cacheKey(envId, trimmed) : ""
  const [state, setState] = useState<{ key: string; check: KeyCheck } | null>(null)
  useEffect(() => {
    if (!envId || !trimmed) return
    let live = true
    const timer = window.setTimeout(() => {
      void checkKey(envId, trimmed).then((check) => {
        if (live) setState({ key: cacheKey(envId, trimmed), check })
      })
    }, delayMs)
    return () => {
      live = false
      window.clearTimeout(timer)
    }
  }, [envId, trimmed, delayMs])
  return key && state?.key === key ? state.check : null
}
