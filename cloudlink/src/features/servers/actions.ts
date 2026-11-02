// 服务器的即时操作（PRD 6.4）：右键菜单、命令面板、详情面板共用同一套，确认对话框只挂一份
import { create } from "zustand"

import type { Asset, IpcError } from "@/bindings"
import { toast } from "@/components/ui/toast"
import { copy, ipcErrorText } from "@/lib/copy"
import { compiledDir } from "@/lib/paths"
import { ipc } from "@/lib/ipc"
import { selectCanDistribute, useAssetStore } from "@/stores/assets"
import { announceTest, useConnectionStore } from "@/stores/connection"
import { useDeliveryStore } from "@/stores/deliveries"
import { selectActiveRun, useProbeStore } from "@/stores/probe"
import { useSettingsStore } from "@/stores/settings"
import { useUIStore } from "@/stores/ui"
import { connectionInputOf } from "./serverForm"

export type PendingAction = { kind: "mode" | "unlock" | "delete"; assetId: string } | null

/** 等用户确认的操作：生产服务器切到标准运维、生产服务器临时解锁、删除 */
export const usePendingAction = create<{ pending: PendingAction; set: (p: PendingAction) => void }>()((set) => ({
  pending: null,
  set: (pending) => set({ pending }),
}))

export const toastError = (e: unknown) => {
  const err = e as IpcError
  toast.add({ title: ipcErrorText(err.id, err.params), type: "error" })
}

/** 正在「改用密钥登录」的服务器：详情的测试结果区和 Agent 分段都显示进行中 */
export const useConverting = create<{ ids: string[]; set: (id: string, on: boolean) => void }>()((set) => ({
  ids: [],
  set: (id, on) => set((s) => ({ ids: on ? [...s.ids, id] : s.ids.filter((x) => x !== id) })),
}))

const alias = (a: Asset) => a.connection.sshAlias

export const serverActions = {
  /** 用已保存的连接参数测试；结果用 Toast 播报（详情里的「测试连接」用表单草稿，原地显示） */
  test(asset: Asset) {
    announceTest(asset.id, (e) => {
      if (e.status === "ok") toast.add({ title: copy.activity["test-ok"]({ alias: alias(asset), ms: e.ms ?? 0 }), type: "success" })
      else if (e.status === "failed" && e.error) toast.add({ title: copy.sshError[e.error.id].title(e.error.params), description: copy.sshError[e.error.id].hint(e.error.params), type: "error" })
    })
    void useConnectionStore.getState().test(asset.id, { assetId: asset.id, connection: connectionInputOf(asset) })
  },

  probe(asset: Asset) {
    useUIStore.getState().openProbeSheet(asset.id)
    useProbeStore.getState().start(asset.id).catch(toastError)
  },

  cancelProbe(asset: Asset) {
    const run = selectActiveRun(useProbeStore.getState(), asset.id)
    if (run) useProbeStore.getState().cancel(run.runId).catch(toastError)
  },

  /** 分发给某个 Agent，或者停止分发（F-303）：未验证、只用密码时说明原因；完成后给出生效提示（AC3）。停止不需要确认（AC4） */
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

  /** 生产服务器切到标准运维前确认（F-202 AC2） */
  requestMode(asset: Asset, mode: Asset["agent"]["mode"]) {
    if (mode === asset.agent.mode) return
    if (mode === "standard" && asset.envTag === "prod") {
      usePendingAction.getState().set({ kind: "mode", assetId: asset.id })
      return
    }
    void serverActions.setMode(asset, mode)
  },

  async setMode(asset: Asset, mode: Asset["agent"]["mode"]) {
    try {
      await useAssetStore.getState().setMode(asset.id, mode)
      toast.add({ title: copy.agentSection.modeChanged(alias(asset), copy.mode[mode]) })
    } catch (e) {
      toastError(e)
    }
  },

  /** 生产服务器解锁前确认（F-306 AC2） */
  requestUnlock(asset: Asset) {
    if (asset.envTag === "prod") usePendingAction.getState().set({ kind: "unlock", assetId: asset.id })
    else void serverActions.unlock(asset)
  },

  async unlock(asset: Asset) {
    try {
      await useAssetStore.getState().unlock(asset.id)
      toast.add({ title: copy.agentSection.unlockedToast(alias(asset)) })
    } catch (e) {
      toastError(e)
    }
  },

  lock(asset: Asset) {
    useAssetStore
      .getState()
      .lock(asset.id)
      .then(() => toast.add({ title: copy.agentSection.lockedToast(alias(asset)) }))
      .catch(toastError)
  },

  copyAlias(asset: Asset) {
    void navigator.clipboard.writeText(alias(asset)).then(() => toast.add({ title: copy.detail.aliasCopied(alias(asset)) }))
  },

  /** 改用密钥登录（F-108 AC1）：成功后可以删除保存的密码（AC3）；失败时认证方式不变（AC2） */
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

  /** 在文件夹中显示这台服务器列入的第一份总 Skill 的编译目录 */
  revealCompiled(asset: Asset) {
    const inc = useDeliveryStore.getState().inclusions.find((i) => i.assetId === asset.id && i.included)
    const dataDir = useSettingsStore.getState().settings?.dataDir
    if (dataDir) void ipc.revealInDir(compiledDir(dataDir, inc?.envId ?? "windows", inc?.agentKey ?? "claude-code"))
  },
}
