// Mock 命令：Agent 笔记、操作记录、活动、设置、清空数据、Tauri 插件（F-307、F-308、F-402、F-403）
import { emit } from "@tauri-apps/api/event"

import type { ActivityItem, ActivityQuery, Operation, OperationQuery, Settings } from "@/bindings"
import * as fx from "./fixtures"
import { secretRule } from "./lint"
import { aliasOf, assetById, db, fail, logActivity, now, recompile } from "./state"

function mergeNotes(items: { id: string; text?: string }[]) {
  const notes = items.map((i) => db.notes.find((n) => n.id === i.id) ?? fail("not-found"))
  // 命中密钥的笔记必须编辑后才能并入（F-308 AC2）：编辑后的内容也要再扫一遍
  items.forEach((i, k) => {
    if (secretRule(i.text ?? notes[k].text)) fail("note-has-secret")
  })
  const asset = assetById(notes[0].assetId)
  const lines = items.map((i, k) => `- ${notes[k].writtenAt.slice(0, 10)}: ${(i.text ?? notes[k].text).trim()}`)
  asset.notes = [asset.notes.trim(), ...lines].filter(Boolean).join("\n")
  asset.updatedAt = now()
  notes.forEach((n) => (n.status = "merged"))
  logActivity({ kind: "note", assetId: asset.id, messageId: "notes-merged", params: { alias: asset.connection.sshAlias, count: items.length }, ok: true })
  return { asset, statuses: recompile() }
}

function dismissNotes(ids: string[]) {
  const notes = db.notes.filter((n) => ids.includes(n.id))
  notes.forEach((n) => (n.status = "dismissed"))
  if (notes[0]) {
    logActivity({ kind: "note", assetId: notes[0].assetId, messageId: "notes-dismissed", params: { alias: aliasOf(notes[0].assetId), count: notes.length }, ok: true })
  }
}

function listOperations(q: OperationQuery) {
  return db.operations
    .filter((o) => (!q.assetId || o.assetId === q.assetId) && (!q.before || o.at < q.before))
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, q.limit)
}

/** 操作记录在活动里显示为「Agent 操作」（6.7）：标题只取远端命令 */
function opToActivity(o: Operation): ActivityItem {
  const remote = /^ssh \S+ '(.*)'$/s.exec(o.command)?.[1]?.replace(/'\\''/g, "'") ?? o.command
  return {
    id: `act_${o.id}`,
    kind: "agent-op",
    at: o.at,
    assetId: o.assetId,
    messageId: o.decision === "denied" ? "agent-op-denied" : o.decision === "unlocked" ? "agent-op-unlocked" : "agent-op-allowed",
    params: { alias: aliasOf(o.assetId), command: remote.length > 60 ? `${remote.slice(0, 59)}…` : remote, reason: o.reasonId ?? "" },
    detail: `${o.command}\ncwd: ${o.cwd}\nsession: ${o.sessionId}`,
    ok: o.decision !== "denied",
  }
}

function listActivity(q: ActivityQuery) {
  return [...db.activity, ...db.operations.map(opToActivity)]
    .filter((a) => (!q.before || a.at < q.before) && (!q.kinds?.length || q.kinds.includes(a.kind)) && (!q.assetId || a.assetId === q.assetId))
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, q.limit)
}

/** 清空数据：同时删除托管 ssh 配置、凭据库中的密码、护栏的 hook、笔记收件箱和操作记录；检测到的 Agent 目标保留 */
function resetData() {
  db.assets = []
  db.deliveries = []
  db.notes = []
  db.operations = []
  db.activity = []
  db.passwords.clear()
  db.cloudlinkKeys.clear()
  db.targets = db.targets.filter((t) => t.agent !== "custom")
  db.guard.forEach((g) => {
    g.state = "not-installed"
    g.deniedToday = 0
  })
  db.settings = structuredClone(fx.settings)
  db.sshHosts.hosts.forEach((h) => (h.imported = false))
  db.skillConfig = { relationships: "", conventions: [] }
  recompile({ silent: true })
  void emit("guard://changed", { statuses: db.guard })
}

type Args = Record<string, unknown>

export const miscHandlers: Record<string, (a: Args) => unknown> = {
  list_notes: (a) => db.notes.filter((n) => n.status === "pending" && (!a.assetId || n.assetId === a.assetId)),
  merge_notes: (a) => mergeNotes(a.items as { id: string; text?: string }[]),
  dismiss_notes: (a) => dismissNotes(a.ids as string[]),
  list_operations: (a) => listOperations(a.q as OperationQuery),
  list_activity: (a) => listActivity(a.q as ActivityQuery),
  get_settings: () => db.settings,
  update_settings: (a) => {
    db.settings = { ...db.settings, ...(a.patch as Partial<Settings>) }
    if ("bodyLineLimit" in (a.patch as object) || "writeSnapshotTime" in (a.patch as object)) recompile()
    return db.settings
  },
  reset_data: () => resetData(),
  // plugin-dialog 的 open()：选目录时返回固定的目录，选文件时返回固定的私钥路径
  "plugin:dialog|open": (a) => ((a.options as { directory?: boolean } | undefined)?.directory ? "D:\\tools\\agent-skills" : "C:\\Users\\me\\.ssh\\id_ed25519"),
  "plugin:opener|reveal_item_in_dir": () => null,
}
