import { useSyncExternalStore } from "react"

const PERIOD = 30_000

let now = Date.now()
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setInterval> | undefined

function subscribe(onChange: () => void) {
  listeners.add(onChange)
  if (!timer) {
    // 订阅者从无到有时先校准一次，避免长时间没人订阅后拿到很旧的时间
    now = Date.now()
    timer = setInterval(() => {
      now = Date.now()
      listeners.forEach((l) => l())
    }, PERIOD)
  }
  return () => {
    listeners.delete(onChange)
    if (listeners.size === 0) {
      clearInterval(timer)
      timer = undefined
    }
  }
}

const getSnapshot = () => now

/**
 * 每 30 秒更新一次的当前时间（毫秒）。「2 小时前」这类相对时间跟着刷新；
 * 时间放在 store 外部，渲染时不直接调用 Date.now()
 */
export function useMinuteTick(): number {
  return useSyncExternalStore(subscribe, getSnapshot)
}
