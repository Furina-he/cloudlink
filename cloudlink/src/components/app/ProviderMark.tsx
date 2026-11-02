// 云平台标识（DESIGN.md Official Brand Logos，2026-11-02 用户要求）：一律用官方 Logo，不自绘。
// Cloudflare、Vercel 取自 @lobehub/icons-static-svg（MIT）；Oracle 取自 simple-icons（CC0），放在 src/assets/brands。
// 彩色 Logo 用 <img>：品牌色留在资源文件里，不进业务代码
import cloudflareUrl from "@lobehub/icons-static-svg/icons/cloudflare-color.svg?url"
import vercelSvg from "@lobehub/icons-static-svg/icons/vercel.svg?raw"

import oracleUrl from "@/assets/brands/oracle.svg?url"
import type { CliProvider } from "@/bindings"
import { cn } from "@/lib/utils"

const VERCEL_PATH = /<path[^>]*\sd="([^"]+)"/.exec(vercelSvg)?.[1] ?? ""

const COLOR_URL: Partial<Record<CliProvider, string>> = { cloudflare: cloudflareUrl, oracle: oracleUrl }

/** 一个云平台的官方 Logo。名称由旁边的文字或 aria-label 给出 */
export function ProviderMark({ provider, className }: { provider: CliProvider; className?: string }) {
  const url = COLOR_URL[provider]
  if (url) return <img src={url} alt="" aria-hidden draggable={false} className={cn("size-4 shrink-0", className)} />
  // Vercel 是单色三角，用墨色，跟随浅深主题
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="currentColor" className={cn("size-4 shrink-0 text-foreground", className)}>
      <path d={VERCEL_PATH} />
    </svg>
  )
}
