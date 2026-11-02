// Mock 命令：探测（F-103）。3 秒的进度事件；自动合并，合并前保存快照用于撤销；疑似注入的值列为待确认
import { emit } from "@tauri-apps/api/event"

import type { ProbeChange, ProbeError, ProbeStep, ServerAsset } from "@/bindings"
import * as fx from "./fixtures"
import { db, fail, logActivity, newId, now, recompile, serverById } from "./state"

const STEPS: ProbeStep[] = ["resolve-alias", "connect", "collect-system", "collect-services", "collect-ports", "merge"]
const STEP_MS = 500

type Snapshot = Pick<ServerAsset, "facts" | "services" | "listeningPorts" | "probe">
const runs = new Map<string, { assetId: string; timers: number[] }>()
/** 每台服务器最近一次探测的快照，只能撤销最近一次（F-103 AC4） */
const snapshots = new Map<string, { runId: string; snapshot: Snapshot; held: ProbeChange[] }>()

const trustKey = (a: ServerAsset) => `${a.connection.definedIn[0] ?? "windows"}:${a.connection.source === "managed" ? a.connection.host : a.connection.sshAlias}`

/** hk-edge：系统 22.04 → 24.04、新增 api-gateway、old-worker 未发现（PRD 6.4 示例） */
function hkEdgeChanges(a: ServerAsset): ProbeChange[] {
  if (a.facts.os === "Ubuntu 24.04 LTS") return []
  a.facts = { ...a.facts, os: "Ubuntu 24.04 LTS", kernel: "6.8.0-45-generic" }
  a.services = a.services.map((s) => (s.name === "old-worker" ? { ...s, missing: true } : { ...s, lastSeenAt: now() }))
  a.services.push({ kind: "docker", name: "api-gateway", image: "my-api:v1.2", ports: [{ hostIp: "127.0.0.1", hostPort: 8080, containerPort: 8080, proto: "tcp" }], critical: false, source: "probe", lastSeenAt: now(), missing: false })
  return structuredClone(fx.hkEdgeApplied)
}

/** 从未探测过的服务器：第一次采集到系统信息，之后再探测就是「未发现变化」 */
function firstProbeChanges(a: ServerAsset): ProbeChange[] {
  if (a.facts.os) return []
  a.facts = { os: "Ubuntu 22.04.4 LTS", kernel: "5.15.0-122-generic", arch: "x86_64", cpuCores: 4, memoryTotalMiB: 7940, diskTotalGiB: 100, panel: null }
  a.listeningPorts = [{ addr: "0.0.0.0", port: 22, proto: "tcp" }]
  return [{ id: newId("chg"), kind: "changed", field: "facts", label: "系统信息", after: "Ubuntu 22.04.4 LTS · 4 vCPU / 8 GB" }]
}

export function startProbe(assetId: string) {
  const asset = serverById(assetId)
  const alias = asset.connection.sshAlias
  const runId = newId("prb")
  const run = { assetId, timers: [] as number[] }
  runs.set(runId, run)
  // 主机密钥未信任：在「建立连接」一步失败（sg-db 在 Windows 上）
  const failAt = db.trusted.has(trustKey(asset)) ? -1 : 1
  const at = (ms: number, fn: () => void) => run.timers.push(window.setTimeout(fn, ms))

  STEPS.forEach((step, i) => {
    if (failAt >= 0 && i > failAt) return
    at(i * STEP_MS, () => void emit("probe://progress", { runId, assetId, step, status: "running" }))
    at((i + 1) * STEP_MS - 20, () => {
      if (i === failAt) {
        void emit("probe://progress", { runId, assetId, step, status: "error", ms: STEP_MS - 20 })
        const error: ProbeError = { id: "host-key-unknown", params: { alias } }
        asset.probe = { ...asset.probe, status: "failed", lastRunId: runId }
        asset.connection.verified = { ok: false, at: now(), envIds: [] }
        logActivity({ kind: "probe", assetId, messageId: "probe-failed", params: { alias, error: error.id }, durationMs: (i + 1) * STEP_MS, ok: false })
        void emit("probe://finished", { runId, assetId, status: "failed", error, durationMs: (i + 1) * STEP_MS, finishedAt: now() })
        runs.delete(runId)
        return
      }
      void emit("probe://progress", { runId, assetId, step, status: "done", ms: STEP_MS - 20 })
      if (i < STEPS.length - 1) return
      const snapshot = structuredClone({ facts: asset.facts, services: asset.services, listeningPorts: asset.listeningPorts, probe: asset.probe })
      const applied = assetId === "ast_hk_edge" ? hkEdgeChanges(asset) : firstProbeChanges(asset)
      // 疑似注入的值不自动合并（F-103 AC5）：只有 hk-edge 的示例里有
      const held = assetId === "ast_hk_edge" && !asset.services.some((s) => s.name === "ignore-previous-instructions") ? structuredClone(fx.hkEdgeHeld) : []
      const partial: ProbeError | undefined = alias === "us-backup" ? { id: "partial", params: { alias, section: "docker" } } : undefined
      asset.probe = { lastRunId: runId, lastSuccessAt: now(), status: "ok" }
      asset.connection.verified = { ok: true, at: now(), envIds: [asset.connection.definedIn[0] ?? "windows"] }
      snapshots.set(assetId, { runId, snapshot, held })
      if (applied.length) recompile()
      logActivity({
        kind: "probe",
        assetId,
        messageId: held.length ? "probe-held" : applied.length ? "probe-updated" : "probe-no-changes",
        params: { alias, count: applied.length, held: held.length },
        durationMs: STEPS.length * STEP_MS,
        detail: "cat /etc/os-release\nuname -srm\ndocker ps --format …\nss -H -tln",
        ok: true,
      })
      void emit("probe://finished", { runId, assetId, status: "ok", error: partial, applied, held, durationMs: STEPS.length * STEP_MS, finishedAt: now() })
      runs.delete(runId)
    })
  })
  return { runId }
}

function cancelProbe(runId: string) {
  const run = runs.get(runId)
  if (!run) return
  run.timers.forEach((t) => clearTimeout(t))
  runs.delete(runId)
  void emit("probe://finished", { runId, assetId: run.assetId, status: "cancelled" })
}

function latest(runId: string) {
  const entry = [...snapshots.entries()].find(([, s]) => s.runId === runId) ?? fail("not-found")
  return { assetId: entry[0], ...entry[1] }
}

function confirmItems(runId: string, changeIds: string[]) {
  const { assetId, held } = latest(runId)
  const asset = serverById(assetId)
  for (const c of held.filter((x) => changeIds.includes(x.id))) {
    if (c.field === "service" && c.kind === "added") {
      asset.services.push({ kind: "docker", name: c.label, image: c.after, ports: [], critical: false, source: "probe", lastSeenAt: now(), missing: false })
    }
  }
  asset.updatedAt = now()
  return { asset, statuses: recompile() }
}

function undoProbe(runId: string) {
  const { assetId, snapshot } = latest(runId)
  const asset = serverById(assetId)
  Object.assign(asset, structuredClone(snapshot))
  asset.updatedAt = now()
  snapshots.delete(assetId)
  logActivity({ kind: "probe", assetId, messageId: "probe-undone", params: { alias: asset.connection.sshAlias }, ok: true })
  return { asset, statuses: recompile() }
}

type Args = Record<string, unknown>

export const probeHandlers: Record<string, (a: Args) => unknown> = {
  start_probe: (a) => startProbe(a.assetId as string),
  cancel_probe: (a) => cancelProbe(a.runId as string),
  confirm_probe_items: (a) => confirmItems(a.runId as string, a.changeIds as string[]),
  undo_probe: (a) => undoProbe(a.runId as string),
  get_probe_script: () => fx.PROBE_SCRIPT,
}
