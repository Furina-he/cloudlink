// Intl 封装（PRD 7.3）：相对时间、数字。不引入 dayjs 之类的库
const LOCALE = "zh-CN"

const relative = new Intl.RelativeTimeFormat(LOCALE, { numeric: "auto" })
const integer = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 })
const compact = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
})
const dateTime = new Intl.DateTimeFormat(LOCALE, {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
})
const day = new Intl.DateTimeFormat(LOCALE, {
  year: "numeric",
  month: "long",
  day: "numeric",
  weekday: "short",
})

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
]

/** 「2 小时前」「昨天」「刚刚」 */
export function formatRelative(iso: string, now: number = Date.now()): string {
  const diffSec = Math.round((new Date(iso).getTime() - now) / 1000)
  const abs = Math.abs(diffSec)
  if (abs < 60) return "刚刚"
  for (const [unit, sec] of UNITS) {
    if (abs >= sec) return relative.format(Math.round(diffSec / sec), unit)
  }
  return relative.format(Math.round(diffSec / 60), "minute")
}

export function formatDateTime(iso: string): string {
  return dateTime.format(new Date(iso))
}

/** 活动视图按天分组的标题 */
export function formatDay(iso: string): string {
  return day.format(new Date(iso))
}

export function formatNumber(n: number): string {
  return integer.format(n)
}

/** Token 估算：「≈86」「≈1.2K」 */
export function formatTokens(n: number): string {
  return `≈${n < 1000 ? integer.format(n) : compact.format(n)}`
}

/** 耗时：「0.8s」「120ms」 */
export function formatDuration(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`
}

export function isOlderThanDays(
  iso: string,
  days: number,
  now: number = Date.now()
): boolean {
  return now - new Date(iso).getTime() > days * 24 * 3600 * 1000
}
