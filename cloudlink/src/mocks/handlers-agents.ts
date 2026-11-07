// Mock 命令：总 Skill 的全局内容与预览、Agent 目标、分发副本、护栏（F-201、F-204、F-301 到 F-306）
import { emit } from "@tauri-apps/api/event"

import type { AddCustomTargetRequest, EnvId, PreviewRequest, SkillConfig } from "@/bindings"
import * as fx from "./fixtures"
import { compileSkill } from "./lint"
import { deriveRelations, withHidden } from "./relations"
import { agentKeyOf, db, draftToAsset, emitCompiled, emitDeliveries, fail, includedIn, logActivity, newId, now, recompile, sleep } from "./state"

/** 预览（F-204）：带 asset 时，这台服务器按「已列入」计算（2026-10-31 用户确认）；带 config 时预览全局内容草稿 */
function previewSkill(req: PreviewRequest) {
  const list = includedIn(req.envId, req.agentKey)
  const assets = req.asset ? [...list.filter((a) => a.id !== req.asset!.id), draftToAsset(req.asset)] : list
  return compileSkill(req.envId, req.agentKey, assets, req.config ?? db.skillConfig, db.settings)
}

function saveSkillConfig(input: SkillConfig) {
  db.skillConfig = structuredClone(input)
  return recompile()
}

const targetById = (id: string) => db.targets.find((t) => t.id === id) ?? fail("not-found")

async function setTargetEnabled(id: string, enabled: boolean) {
  const t = targetById(id)
  await sleep(300)
  t.enabled = enabled
  t.detected = t.detected || enabled
  if (!enabled) {
    // 只移除 CloudLink 创建的副本（F-302 AC2）；冲突的目录不是我们的
    const d = db.deliveries.find((x) => x.targetId === id)
    if (d && d.status !== "conflict") db.deliveries = db.deliveries.filter((x) => x !== d)
    logActivity({ kind: "remove", messageId: "remove-ok", params: { target: t.label, env: t.envId }, ok: true })
  } else {
    logActivity({ kind: "deliver", messageId: "deliver-ok", params: { target: t.label, env: t.envId }, ok: true })
  }
  // 编译单元随目标增减：停用后这个 Agent 在该环境的那一份不再编译
  recompile({ silent: true })
  emitCompiled()
  emitDeliveries()
  return t
}

function addCustomTarget(req: AddCustomTargetRequest) {
  const same = (a: string, b: string) => a.replace(/[\\/]+$/, "").toLowerCase() === b.replace(/[\\/]+$/, "").toLowerCase()
  if (db.targets.some((t) => same(t.path, req.path))) fail("target-exists", { path: req.path })
  const t = { id: newId("tgt"), envId: req.envId, agent: "custom" as const, agentKey: agentKeyOf("custom", req.label), label: req.label, path: req.path, enabled: true, detected: false }
  db.targets.push(t)
  recompile({ silent: true })
  emitCompiled()
  emitDeliveries()
  return t
}

function removeCustomTarget(id: string) {
  const t = targetById(id)
  db.targets = db.targets.filter((x) => x.id !== id)
  // 目标没了，副本记录一并删除；冲突的目录不是 CloudLink 的，只是不再跟踪，文件不动
  db.deliveries = db.deliveries.filter((d) => d.targetId !== id)
  // 这个自定义 Agent 的最后一个目录也移除了：服务器上对它的点选一并清掉，以后重新添加不会悄悄恢复
  if (!db.targets.some((x) => x.agentKey === t.agentKey)) {
    db.assets.forEach((a) => (a.agent.agents = a.agent.agents.filter((k) => k !== t.agentKey)))
  }
  logActivity({ kind: "remove", messageId: "remove-ok", params: { target: t.label, env: t.envId }, ok: true })
  recompile({ silent: true })
  emitCompiled()
  emitDeliveries()
}

function checkDeliveries() {
  db.deliveries.forEach((d) => (d.checkedAt = now()))
  recompile({ silent: true })
  emitDeliveries()
  return db.deliveries
}

async function repairDelivery(id: string) {
  const d = db.deliveries.find((x) => x.id === id) ?? fail("not-found")
  await sleep(300)
  // 冲突的目录不是 CloudLink 创建的，修复也不覆盖（F-304 AC1）
  if (d.status !== "conflict") d.status = "ok"
  d.checkedAt = now()
  const t = db.targets.find((x) => x.id === d.targetId)
  logActivity({ kind: "repair", messageId: "repair-ok", params: { target: t?.label ?? "", env: d.envId }, durationMs: 90, ok: true })
  emitDeliveries()
  return d
}

function removeAllDeliveries() {
  for (const d of db.deliveries.filter((x) => x.status !== "conflict")) {
    const t = db.targets.find((x) => x.id === d.targetId)
    logActivity({ kind: "remove", messageId: "remove-ok", params: { target: t?.label ?? "", env: d.envId }, ok: true })
  }
  db.deliveries = db.deliveries.filter((d) => d.status === "conflict")
  db.targets.forEach((t) => (t.enabled = false))
  recompile({ silent: true })
  emitCompiled()
  emitDeliveries()
}

function setGuard(envId: EnvId, install: boolean) {
  const g = db.guard.find((x) => x.envId === envId) ?? fail("not-found")
  const env = db.environments.find((e) => e.id === envId)
  if (!env?.available) fail("interop-disabled", { env: envId })
  g.state = install ? "active" : "not-installed"
  g.detail = undefined
  g.checkedAt = now()
  logActivity({ kind: "guard", messageId: install ? "guard-installed" : "guard-removed", params: { env: envId }, ok: true })
  void emit("guard://changed", { statuses: db.guard })
  return g
}

type Args = Record<string, unknown>

export const agentHandlers: Record<string, (a: Args) => unknown> = {
  get_skill_config: () => db.skillConfig,
  list_relations: () => withHidden(deriveRelations(db.assets), db.skillConfig),
  save_skill_config: (a) => saveSkillConfig(a.input as SkillConfig),
  preview_skill: (a) => previewSkill(a.req as PreviewRequest),
  get_compile_status: () => Object.values(db.compile),
  list_targets: () => db.targets,
  set_target_enabled: (a) => setTargetEnabled(a.id as string, a.enabled as boolean),
  add_custom_target: (a) => addCustomTarget(a.req as AddCustomTargetRequest),
  remove_custom_target: (a) => removeCustomTarget(a.id as string),
  list_inclusions: () => db.inclusions,
  list_deliveries: () => db.deliveries,
  check_deliveries: () => checkDeliveries(),
  repair_delivery: (a) => repairDelivery(a.id as string),
  remove_all_deliveries: () => removeAllDeliveries(),
  get_guard_status: () => db.guard,
  install_guard: (a) => setGuard(a.envId as EnvId, true),
  remove_guard: (a) => setGuard(a.envId as EnvId, false),
  get_guard_rules: () => fx.guardRules,
}
