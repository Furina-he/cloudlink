import { useSyncExternalStore } from "react"

const PERIOD = 30_000

function subscribe(onChange: () => void) {
  const timer = setInterval(onChange, PERIOD)
  return () => clearInterval(timer)
}

const getSnapshot = () => Math.floor(Date.now() / PERIOD)

/** 每 30 秒变化一次，让「2 小时前」这类相对时间跟着刷新 */
export function useMinuteTick(): number {
  return useSyncExternalStore(subscribe, getSnapshot)
}
