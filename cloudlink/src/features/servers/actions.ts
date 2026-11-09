// 资源的即时操作（PRD 6.4）：资源行、右键菜单、命令面板、检视面板共用同一套，确认对话框只挂一份
import { create } from "zustand"

import type { Asset, CliAsset, CliProvider, EnvId, IpcError, ServerAsset } from "@/bindings"
import { toast } from "@/components/ui/toast"
import { copy, ipcErrorText } from "@/lib/copy"
import { installCommand, loginCommand } from "@/lib/cliProviders"
import { compiledDir } from "@/lib/paths"
import { ipc } from "@/lib/ipc"
import { cliEnvStatus, handleOf, selectCanDistribute, useAssetStore } from "@/stores/assets"
import { useCliStore } from "@/stores/cli"
import { announceTest, useConnectionStore } from "@/stores/connection"
import { useDeliveryStore } from "@/stores/deliveries"
import { selectActiveRun, useProbeStore } from "@/stores/probe"
import { useSettingsStore } from "@/stores/settings"
import { useUIStore } from "@/stores/ui"
import { connectionInputOf } from "./serverForm"

export type PendingAction = { kind: "mode" | "delete"; assetId: string } | null

/** 等用户确认的操作：生产资源切到标准运维、删除 */
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

export const serverActions = {
  /** 用已保存的连接参数测试；结果用 Toast 播报（详情里的「测试连接」用表单草稿，原地显示） */
  test(asset: ServerAsset) {
    announceTest(asset.id, (e) => {
      if (e.status === "ok") toast.add({ title: copy.activity["test-ok"]({ alias: alias(asset), ms: e.ms ?? 0 }), type: "success" })
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
      .then(() =>
        toast.add(
          on
            ? { title: copy.agentSection.distributed(alias(asset), agent.label), description: copy.agentSection.effectHint, type: "success", timeout: 8000 }
            : { title: copy.agentSection.undistributed(alias(asset), agent.label) }
        )
      )
      .catch(toastError)
  },

  /** 档位闸刀（PRD 6.4）：生产资源切到标准运维前确认（F-202 AC2）；切回只读巡检一键完成 */
  requestMode(asset: Asset, mode: Asset["agent"]["mode"]) {
    if (mode === asset.agent.mode) return
    if (mode === "standard" && asset.production) {
      usePendingAction.getState().set({ kind: "mode", assetId: asset.id })
      return
    }
    void serverActions.setMode(asset, mode)
  },

  /** F-407 AC2「全部切回只读」：命令面板入口；托盘的入口由 Rust 处理并发系统通知 */
  async allReadOnly() {
    try {
      const names = await ipc.allReadOnly()
      if (names.length > 0) await useAssetStore.getState().refresh()
      toast.add({ title: names.length > 0 ? copy.allReadOnly.done(names.length) : copy.allReadOnly.none })
    } catch (e) {
      toastError(e)
    }
  },

  async setMode(asset: Asset, mode: Asset["agent"]["mode"]) {
    const prev = asset.agent.mode
    try {
      await useAssetStore.getState().setMode(asset.id, mode)
      // 切换后底部提示条带「撤销」（PRD 6.3）；撤销直接回到原档位，不再确认
      const id: string = toast.add({
        title: copy.agentSection.modeChanged(alias(asset), copy.mode[mode]),
        actionProps: {
          children: copy.common.undo,
          onClick: () => {
            toast.close(id)
            useAssetStore.getState().setMode(asset.id, prev).catch(toastError)
          },
        },
      })
    } catch (e) {
      toastError(e)
    }
  },

  /** 重新检测云平台 CLI（F-104 AC1），顺带拉取账号下的资源 */
  recheckCli(asset: CliAsset) {
    useCliStore.getState().detect(asset.cliProvider, asset.id).catch(toastError)
  },

  /** 在对应运行环境打开终端（F-104 AC2）：没装时预填安装命令，否则预填登录命令；切回窗口时自动重新检测 */
  openCliTerminal(asset: CliAsset, envId: EnvId) {
    const state = asset.cli.envStates[envId]
    const command = state && cliEnvStatus(state) === "not-installed" ? installCommand(asset.cliProvider, envId) : loginCommand(asset.cliProvider)
    serverActions.openTerminal(envId, command, asset.cliProvider, asset.id)
  },

  /** assetId 为 null 表示新建向导里还没有资源 */
  openTerminal(envId: EnvId, command: string, provider: CliProvider, assetId: string | null) {
    useCliStore.getState().awaitFocus(provider, assetId)
    ipc
      .openEnvTerminal({ envId, command })
      .then(() => toast.add({ title: copy.cli.terminalOpened(copy.env.long(envId)) }))
      .catch(toastError)
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
        title: copy.convertKey.done(alias(asset)),
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
