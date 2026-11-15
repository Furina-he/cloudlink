import { useEffect, useState } from "react"

/** active 持续超过 delayMs 才返回 true：加载很快时不闪 Skeleton（PRD 6.11：超过 150ms 才显示） */
export function useDelayedFlag(active: boolean, delayMs = 150): boolean {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    if (!active) return
    const timer = setTimeout(() => setShown(true), delayMs)
    return () => {
      clearTimeout(timer)
      setShown(false)
    }
  }, [active, delayMs])
  return active && shown
}
