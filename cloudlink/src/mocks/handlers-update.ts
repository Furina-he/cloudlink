// Mock 命令：检测更新（F-406）。地址栏参数选择场景：
// - 不带参数：没有新版本，界面上没有任何更新元素
// - ?update=available：启动时已经发现 0.2.0；下载约 3 秒，之后停在「正在安装」（Mock 不会退出）
// - ?update=signature：下载完成后签名校验失败，安装包被丢弃
// - ?update=busy：第一次「下载并安装」被正在发布的 Skill 挡住（update-busy），再点一次正常下载
// - ?update=long：更新说明很长，还带一行没有断点的长串，对话框不能被撑开
import { emit } from "@tauri-apps/api/event"

import type { UpdateStatus } from "@/bindings"
import { runningProbe } from "./handlers-probe"
import { aliasOf, db, fail, logActivity } from "./state"

const scenario = new URLSearchParams(window.location.search).get("update")
const CURRENT = "0.1.0"
const TOTAL = 8_912_896
const TICK_MS = 150
const TICKS = 20

/** 更新说明是不可信的纯文本：Markdown 和链接都应原样显示 */
const RELEASE = {
  version: "0.2.0",
  date: "2026-11-20T08:00:00Z",
  notes: [
    "探测速度提升约 30%，大列表滚动更流畅。",
    "",
    "- 护栏识别更多 wrangler 子命令",
    "- 修复 WSL 路径中含空格时的分发问题",
    "- **详情**见 [发布说明](https://example.com/release)",
  ].join("\n"),
}

const LONG_NOTES = Array.from({ length: 60 }, (_, i) => `第 ${i + 1} 行更新说明`)
  .concat("x".repeat(400))
  .join("\n")

const idle = (): UpdateStatus => ({ state: "idle", currentVersion: CURRENT })
const available = (): UpdateStatus => ({
  state: "available",
  currentVersion: CURRENT,
  ...RELEASE,
  ...(scenario === "long" && { notes: LONG_NOTES }),
})

let status: UpdateStatus = scenario && db.settings.autoCheckUpdates ? available() : idle()
let download: { timer: number } | null = null
let busyOnce = scenario === "busy"

function publish(next: UpdateStatus) {
  status = next
  void emit("update://changed", { status })
}

function stopDownload() {
  if (download) window.clearInterval(download.timer)
  download = null
}

function install() {
  if (status.state === "downloading" || status.state === "installing") return
  if (status.state !== "available") fail("not-found")
  const probing = runningProbe()
  if (probing) fail("update-busy", { task: "probe", name: aliasOf(probing) })
  if (busyOnce) {
    busyOnce = false
    fail("update-busy", { task: "publish" })
  }
  publish({ ...available(), state: "downloading", downloaded: 0 })
  let tick = 0
  download = {
    timer: window.setInterval(() => {
      tick++
      if (tick < TICKS) {
        publish({ ...status, downloaded: Math.round((TOTAL * tick) / TICKS), total: TOTAL })
        return
      }
      stopDownload()
      if (scenario === "signature") {
        publish({ ...available(), error: { id: "update-signature-invalid" } })
        return
      }
      publish({ ...status, state: "installing", downloaded: TOTAL, total: TOTAL })
      logActivity({ kind: "update", messageId: "update-installing", params: { from: CURRENT, to: RELEASE.version }, ok: true })
    }, TICK_MS),
  }
}

/** 关闭检查时立即隐藏提醒并取消下载；重新打开时立即检查一次（F-406 AC6） */
export function setAutoCheck(enabled: boolean) {
  if (!enabled) {
    stopDownload()
    if (status.state !== "installing" && status.state !== "idle") publish(idle())
    return
  }
  if (scenario && status.state === "idle") window.setTimeout(() => db.settings.autoCheckUpdates && publish(available()), 300)
}

type Args = Record<string, unknown>

export const updateHandlers: Record<string, (a: Args) => unknown> = {
  get_update_status: () => status,
  install_update: () => install(),
  cancel_update: () => {
    if (status.state !== "downloading") return
    stopDownload()
    publish(available())
  },
}
