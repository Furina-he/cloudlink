// Intl 封装（PRD 7.3）：相对时间、数字。不引入 dayjs 之类的库
const LOCALE = "zh-CN"

const relative = new Intl.RelativeTimeFormat(LOCALE, { numeric: "auto" })
const integer = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 })
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

const time = new Intl.DateTimeFormat(LOCALE, { hour: "2-digit", minute: "2-digit", hour12: false })

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

/** 活动按天分组的标题 */
export function formatDay(iso: string): string {
  return day.format(new Date(iso))
}

/** 活动记录的时刻：「14:02」 */
export function formatTime(iso: string): string {
  return time.format(new Date(iso))
}

/** 本地日期的键，用于按天分组：「2026-10-29」 */
export function dayKey(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

export function formatNumber(n: number): string {
  return integer.format(n)
}

/** 发布日期：「2026-11-20」（本地时区）；无法解析时为 null */
export function formatDate(iso: string): string | null {
  return Number.isNaN(new Date(iso).getTime()) ? null : dayKey(iso)
}

const oneDecimal = new Intl.NumberFormat(LOCALE, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const BYTE_UNITS = ["KB", "MB", "GB"]

/** 下载量：「512 B」「3.2 MB」，按 1024 进位，与 Windows 资源管理器一致 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${integer.format(bytes)} B`
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024
    unit++
  }
  return `${oneDecimal.format(value)} ${BYTE_UNITS[unit]}`
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
