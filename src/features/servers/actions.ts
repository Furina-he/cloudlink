// 资源的即时操作（PRD 6.4）：资源行、右键菜单、命令面板、检视面板共用同一套，确认对话框只挂一份
import { create } from "zustand"

import type { Asset, CliAsset, CliProvider, EnvId, IpcError, ServerAsset } from "@/bindings"
import { toast } from "@/components/ui/toast"
import { copy, ipcErrorText } from "@/lib/copy"
import { deliveryOutcome, deliveryProblemsText } from "@/lib/deliveryFeedback"
import { installMethods } from "@/lib/cliProviders"
import { compiledDir } from "@/lib/paths"
import { ipc } from "@/lib/ipc"
import { handleOf, selectCanDistribute, useAssetStore } from "@/stores/assets"
import { useCliStore } from "@/stores/cli"
import { announceTest, useConnectionStore } from "@/stores/connection"
import { useDeliveryStore } from "@/stores/deliveries"
import { selectActiveRun, useProbeStore } from "@/stores/probe"
import { useSettingsStore } from "@/stores/settings"
import { useSkillStore } from "@/stores/skills"
import { useTargetStore } from "@/stores/targets"
import { useUIStore } from "@/stores/ui"
import { missingIncludeEnvs } from "./includeState"
import { connectionInputOf } from "./serverForm"

const CONFIRM_REQUIRED = Symbol("auto-ops-confirmation")

export type PendingAction = { kind: "mode" | "delete"; assetId: string } | null

/** 等用户确认的操作：切到自动运维、删除 */
export const usePendingAction = create<{ pending: PendingAction; set: (p: PendingAction) => void }>()((set) => ({
  pending: null,
  set: (pending) => set({ pending }),
}))

export const toastError = (e: unknown) => {
  const err = e as IpcError
  toast.add({ title: ipcErrorText(err.id, err.params), type: "error" })
}

/** 正在「改用密钥登录」的服务器：详情的测试结果区显示进行中 */
export const useConverting = create<{ ids: string[]; set: (id: string, on: boolean) => void }>()((set) => ({
  ids: [],
  set: (id, on) => set((s) => ({ ids: on ? [...s.ids, id] : s.ids.filter((x) => x !== id) })),
}))

const alias = handleOf

/** 使用发布返回的完整快照，不把资源选择或列入当作送达。 */
export const currentDeliverySnapshot = () => ({
  inclusions: useDeliveryStore.getState().inclusions,
  deliveries: Object.values(useDeliveryStore.getState().byId),
  statuses: Object.values(useSkillStore.getState().statusByKey),
})

export const serverActions = {
  /** 用已保存的连接参数测试；结果用 Toast 播报（详情里的「测试连接」用表单草稿，原地显示） */
  test(asset: ServerAsset) {
    announceTest(asset.id, (e) => {
      if (e.status === "ok") toast.add({ title: copy.activity["test-ok"]({ alias: asset.name, ms: e.ms ?? 0 }), type: "success" })
      else if (e.status === "failed" && e.error) toast.add({ title: copy.sshError[e.error.id].title(e.error.params), description: copy.sshError[e.error.id].hint(e.error.params), type: "error" })
    })
    void useConnectionStore.getState().test(asset.id, { assetId: asset.id, connection: connectionInputOf(asset) })
  },

  probe(asset: ServerAsset) {
    useUIStore.getState().openProbeSheet(asset.id)
    useProbeStore.getState().start(asset.id).catch(toastError)
  },

  cancelProbe(asset: ServerAsset) {
    const run = selectActiveRun(useProbeStore.getState(), asset.id)
    if (run) useProbeStore.getState().cancel(run.runId).catch(toastError)
  },

  /** 分发给某个 Agent，或者停止分发（F-303）：未验证、只用密码、CLI 未就绪时说明原因；完成后给出生效提示（AC3）。停止不需要确认（AC4） */
  toggleAgent(asset: Asset, agent: { key: string; label: string }, on: boolean) {
    const can = selectCanDistribute(asset)
    if (on && !can.ok) {
      toast.add({ title: copy.distributeBlock[can.reason], type: "warning" })
      return
    }
    useAssetStore
      .getState()
      .setDistribute(asset.id, agent.key, on)
      .then((result) => {
        const targets = useTargetStore.getState().targets
        const outcome = deliveryOutcome(asset.id, result.affectedAgentKeys, on, result, targets)
        const names = result.affectedAgentKeys.map((key) => {
          const t = targets.find((t) => t.agentKey === key)
          return t ? t.agent === "custom" ? t.label : copy.agent[t.agent] : key
        })
        if (!outcome.complete) {
          toast.add({
            title: on ? copy.deliveryFeedback.partial(result.asset.name, outcome.count) : copy.deliveryFeedback.withdrawPartial(result.asset.name),
            description: [names.length > 1 ? copy.deliveryFeedback.sharedHint(names) : "", outcome.problems.length ? deliveryProblemsText(outcome.problems) : copy.deliveryFeedback.none].filter(Boolean).join("\n"),
            type: "warning",
          })
          return
        }
        toast.add({
          title: names.length > 1 ? copy.deliveryFeedback.shared(names, result.asset.name, on) : on ? copy.agentSection.distributed(result.asset.name, agent.label) : copy.agentSection.undistributed(result.asset.name, agent.label),
          description: on ? copy.agentSection.effectHint : undefined,
          type: on ? "success" : undefined,
          actionProps: { children: copy.common.undo, onClick: () => void useAssetStore.getState().setDistribute(asset.id, agent.key, !on).catch(toastError) },
        })
      })
      .catch(toastError)
  },

  /**
   * 资源行的「加入 SSH 配置」（PRD 6.5）：把还没加入的运行环境都加上；
   * 添加时选了「暂不加入」的服务器还没同步给任何 Agent，这时一并同步给全部已启用的 Agent
   */
  async joinSshConfig(asset: ServerAsset, agentKeys: string[]) {
    try {
      for (const env of missingIncludeEnvs(asset, useTargetStore.getState().environments)) await useTargetStore.getState().addSshInclude(env)
      if (asset.agent.agents.length === 0 && selectCanDistribute(asset).ok && agentKeys.length > 0) {
        await useAssetStore.getState().setDistributeMany(asset.id, agentKeys, true)
      }
      // 加入之后重新读取实际结果，不能因 Include 写入成功就冒报 Skill 已同步。
      const [deliveries, inclusions, statuses] = await Promise.all([ipc.listDeliveries(), ipc.listInclusions(), ipc.getCompileStatus()])
      useDeliveryStore.getState()._onChanged({ deliveries, inclusions })
      useSkillStore.getState()._onCompiled(statuses)
      const current = useAssetStore.getState().byId[asset.id] ?? asset
      const outcome = deliveryOutcome(current.id, current.agent.agents, true, { deliveries, inclusions, statuses }, useTargetStore.getState().targets)
      toast.add({
        title: outcome.complete ? copy.include.joined(current.name, outcome.count) : copy.deliveryFeedback.joinedPartial(current.name, outcome.count),
        description: outcome.complete ? undefined : outcome.problems.length ? deliveryProblemsText(outcome.problems) : copy.deliveryFeedback.none,
        type: outcome.complete ? "success" : "warning",
      })
    } catch (e) {
      toastError(e)
    }
  },

  /** 执行模式切换（PRD 6.4）：任意资源切到自动运维前轻确认（F-202 AC2）；切回确认变更一键完成 */
  requestMode(asset: Asset, mode: Asset["agent"]["mode"]) {
    const latest = useAssetStore.getState().byId[asset.id]
    if (!latest || mode === latest.agent.mode) return
    if (mode === "auto-ops") {
      usePendingAction.getState().set({ kind: "mode", assetId: asset.id })
      return
    }
    void serverActions.setMode(latest, mode)
  },

  /** F-407 AC2「全部改为确认变更」：命令面板入口；托盘的入口由 Rust 处理并发系统通知 */
  async allReadOnly() {
    try {
      const names = await ipc.allReadOnly()
      if (names.length > 0) await useAssetStore.getState().refresh()
      toast.add({ title: names.length > 0 ? copy.allReadOnly.done(names.length) : copy.allReadOnly.none })
    } catch (e) {
      toastError(e)
    }
  },

  async setMode(asset: Asset, mode: Asset["agent"]["mode"], confirmed = false) {
    let prev = asset.agent.mode
    try {
      await useAssetStore.getState().setMode(asset.id, mode, (latest) => {
        prev = latest.agent.mode
        if (mode === "auto-ops" && prev !== mode && !confirmed) {
          usePendingAction.getState().set({ kind: "mode", assetId: latest.id })
          throw CONFIRM_REQUIRED
        }
      })
      const name = useAssetStore.getState().byId[asset.id]?.name ?? asset.name
      const id: string = toast.add({
        title: copy.agentSection.modeChanged(name, copy.mode[mode]),
        actionProps: {
          children: copy.common.undo,
          onClick: () => {
            toast.close(id)
            const latest = useAssetStore.getState().byId[asset.id]
            if (latest) serverActions.requestMode(latest, prev)
          },
        },
      })
    } catch (e) {
      if (e !== CONFIRM_REQUIRED) toastError(e)
    }
  },

  /** 重新检测云平台 CLI（F-104 AC1），顺带拉取账号下的资源 */
  recheckCli(asset: CliAsset) {
    useCliStore.getState().detect(asset.cliProvider, asset.id).catch(toastError)
  },

  /**
   * 资源行与详情的「去安装／去登录」（F-104 AC2，P9b；2026-11-21）：后端按环境与安装方式
   * 查固定表。cf／vercel／gh 在后台安装并由 CLI 打开浏览器，OCI 仍用可见终端；
   * 等待状态由 `cli-setup://changed` 推进，不依赖窗口焦点
   */
  openCliTerminal(asset: CliAsset, envId: EnvId) {
    const method = installMethods(asset.cliProvider, envId)[0]
    serverActions.startCliSetup(asset.cliProvider, envId, method.id, asset.id)
  },

  /** assetId 为 null 表示新建向导里还没有资源 */
  startCliSetup(provider: CliProvider, envId: EnvId, method: string, assetId: string | null) {
    useCliStore.getState().startSetup(provider, envId, method, assetId).catch(toastError)
  },

  copyAlias(asset: Asset) {
    void navigator.clipboard.writeText(alias(asset)).then(() => toast.add({ title: copy.detail.aliasCopied(alias(asset)) }))
  },

  /** 改用密钥登录（F-108 AC1）：成功后可以删除保存的密码（AC3）；失败时认证方式不变 */
  async convertToKey(assetId: string) {
    const converting = useConverting.getState()
    if (converting.ids.includes(assetId)) return
    converting.set(assetId, true)
    try {
      const asset = await useConnectionStore.getState().convertToKey(assetId)
      const id: string = toast.add({
        title: copy.convertKey.done(asset.name),
        type: "success",
        timeout: 8000,
        actionProps: {
          children: copy.convertKey.deletePassword,
          onClick: () => {
            toast.close(id)
            void serverActions.deletePassword(assetId)
          },
        },
      })
    } catch (e) {
      toastError(e)
    } finally {
      useConverting.getState().set(assetId, false)
    }
  },

  async deletePassword(assetId: string) {
    try {
      await ipc.setPassword(assetId, null)
      toast.add({ title: copy.connection.passwordDeleted })
      await useAssetStore.getState().refresh()
    } catch (e) {
      toastError(e)
    }
  },

  requestDelete(asset: Asset) {
    usePendingAction.getState().set({ kind: "delete", assetId: asset.id })
  },

  /** 严重错误时的「打开日志目录」（PRD 6.10） */
  openLogs() {
    const logDir = useSettingsStore.getState().settings?.logDir
    if (logDir) void ipc.revealInDir(logDir)
  },

  /** 在文件夹中显示这项资源列入的第一份总 Skill 的编译目录 */
  revealCompiled(asset: Asset) {
    const inc = useDeliveryStore.getState().inclusions.find((i) => i.assetId === asset.id && i.included)
    const dataDir = useSettingsStore.getState().settings?.dataDir
    if (dataDir) void ipc.revealInDir(compiledDir(dataDir, inc?.envId ?? "windows", inc?.agentKey ?? "claude-code"))
  },
}
