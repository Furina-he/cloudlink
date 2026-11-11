// 服务器表单的公共 hooks：可用的运行环境、别名检查的上下文、表单实例、别名跟随名称（PRD 6.4、6.5）
import { zodResolver } from "@hookform/resolvers/zod"
import { useEffect, useMemo, useRef } from "react"
import { useForm, type UseFormReturn } from "react-hook-form"

import type { ServerAsset, Environment } from "@/bindings"
import { serverFormSchema, type AliasContext, type ServerFormValues } from "@/lib/schemas"
import { handleOf, useAssetStore } from "@/stores/assets"
import { useSettingsStore } from "@/stores/settings"
import { selectAvailableEnvs, useTargetStore } from "@/stores/targets"
import { baseAlias, formValuesOf, newServerValues, sortEnvs, uniqueAlias } from "./serverForm"

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
export function useServerForm(asset: ServerAsset | undefined, ctx: AliasContext): UseFormReturn<ServerFormValues> {
  const isNew = !asset
  const schema = useMemo(() => serverFormSchema(ctx, { nameOptional: isNew }), [ctx, isNew])
  const envs = useAvailableEnvs()
  const values = useMemo(() => (asset ? formValuesOf(asset) : newServerValues(sortEnvs(envs.map((e) => e.id)))), [asset, envs])
  return useForm<ServerFormValues>({
    resolver: zodResolver(schema),
    values,
    resetOptions: { keepDirtyValues: true },
    mode: "onBlur",
    reValidateMode: "onChange",
  })
}

/**
 * 新建时别名跟随名称（6.5，2026-10-31 用户确认）：名称里没有英文字母和数字时改用地址，重名追加 -2。
 * 用户在别名行里改过之后不再跟随；清空别名会恢复跟随
 */
export function useAliasFollow(form: UseFormReturn<ServerFormValues>, ctx: AliasContext) {
  const touched = useRef(false)
  return {
    sync: () => {
      if (touched.current) return
      const { name, connection } = form.getValues()
      const alias = uniqueAlias(baseAlias(name, connection.host), [...ctx.taken, ...ctx.sshHosts.map((h) => h.alias)])
      // 自动生成之后清掉「请填写别名」这类旧错误（PRD 6.5）
      form.setValue("alias", alias, { shouldDirty: true, shouldValidate: form.formState.isSubmitted || !!form.getFieldState("alias").error })
    },
    markTouched: (value: string) => {
      touched.current = value.trim() !== ""
    },
  }
}
