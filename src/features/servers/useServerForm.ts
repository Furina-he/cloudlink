// 服务器表单的公共 hooks：可用环境、别名检查、表单实例与稳定的新建标识（PRD 6.4、6.5）
import { zodResolver } from "@hookform/resolvers/zod"
import { useEffect, useMemo, useState } from "react"
import { useForm, type UseFormReturn } from "react-hook-form"

import type { ServerAsset, Environment } from "@/bindings"
import { serverFormSchema, type AliasContext, type ServerFormValues } from "@/lib/schemas"
import { handleOf, useAssetStore } from "@/stores/assets"
import { useSettingsStore } from "@/stores/settings"
import { selectAvailableEnvs, useTargetStore } from "@/stores/targets"
import { formValuesOf, newServerIdentity, newServerValues, sortEnvs } from "./serverForm"

/** 可用的运行环境（设置里停用的不算）；数据不变时引用保持稳定 */
export function useAvailableEnvs(): Environment[] {
  const environments = useTargetStore((s) => s.environments)
  const enabled = useSettingsStore((s) => s.settings?.environments)
  return useMemo(() => selectAvailableEnvs(environments, enabled), [environments, enabled])
}

/** 别名唯一性（F-101 AC1）和与 ssh config 重名（F-107 AC3）的检查数据；ssh config 第一次用到时才扫描 */
export function useAliasContext(selfId: string | undefined): AliasContext {
  const assets = useAssetStore((s) => s.byId)
  const sshHosts = useTargetStore((s) => s.sshHosts)
  useEffect(() => {
    if (useTargetStore.getState().sshHostsStatus === "idle") void useTargetStore.getState().loadSshHosts()
  }, [])
  return useMemo(
    () => ({
      taken: Object.values(assets)
        .filter((a) => a.id !== selfId)
        .map(handleOf),
      // 已导入为服务器的 Host 由 taken 检查
      sshHosts: (sshHosts?.hosts ?? []).filter((h) => !h.imported).map((h) => ({ alias: h.alias, definedIn: h.definedIn })),
      selfAlias: selfId && assets[selfId] ? handleOf(assets[selfId]) : undefined,
    }),
    [assets, sshHosts, selfId]
  )
}

/**
 * 服务器表单实例：草稿只在 RHF 里（PRD 7.5）。服务器在后台变化时（测试连接、探测、并入笔记之后）
 * 用 values 同步，keepDirtyValues 保留用户正在改的字段；失焦时校验（6.4）
 */
export function useServerForm(asset: ServerAsset | undefined, ctx: AliasContext, profileOnly = false): UseFormReturn<ServerFormValues> {
  const isNew = !asset
  const schema = useMemo(() => serverFormSchema(ctx, { nameOptional: isNew, profileOnly }), [ctx, isNew, profileOnly])
  const envs = useAvailableEnvs()
  // 环境检测、预填、返回修改都不能重新分配名称或别名。
  const [identity] = useState(() => newServerIdentity([...ctx.taken, ...ctx.sshHosts.map((h) => h.alias)]))
  const values = useMemo(() => (asset ? formValuesOf(asset) : newServerValues(sortEnvs(envs.map((e) => e.id)), identity)), [asset, envs, identity])
  return useForm<ServerFormValues>({
    resolver: zodResolver(schema),
    values,
    resetOptions: { keepDirtyValues: true },
    mode: "onBlur",
    reValidateMode: "onChange",
  })
}
