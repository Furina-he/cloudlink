import { CircleCheckIcon, CircleXIcon, KeyRoundIcon, PlugIcon } from "lucide-react"
import { motion } from "motion/react"
import type { ReactNode } from "react"
import { useWatch, type FieldPath, type UseFormReturn } from "react-hook-form"

import type { ConnectionTestRequest } from "@/bindings"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { copy } from "@/lib/copy"
import { formatDuration } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { ServerFormValues } from "@/lib/schemas"
import { isTestCurrent, useConnectionStore, type ConnectionTest } from "@/stores/connection"
import { toastError, useConverting } from "./actions"
import { connectionInputOfForm } from "./serverForm"

/** 测试前只校验连接用到的字段；名称等其他字段留到保存时 */
const TEST_FIELDS: FieldPath<ServerFormValues>[] = [
  "connection.host",
  "connection.port",
  "connection.user",
  "connection.identityFile",
  "connection.password",
  "connection.definedIn",
]

/** 测试连接的请求：表单草稿的连接参数；密码方式、凭据库里还没有密码时带上这次输入的密码（F-108） */
export function testRequestOf(v: ServerFormValues, assetId: string | undefined): ConnectionTestRequest {
  const c = v.connection
  const password = v.source === "managed" && c.method === "password" && c.password ? c.password : undefined
  return { assetId, connection: connectionInputOfForm(v), password }
}

/**
 * 用表单草稿测试连接（F-106 AC1）。key 是新建表单的 NEW_KEY 或服务器 id；
 * 表单参数改过之后旧结果作废（stale），要求重新测试
 */
export function useConnectionTest(form: UseFormReturn<ServerFormValues>, key: string, assetId: string | undefined) {
  const [source, alias, connection] = useWatch({ control: form.control, name: ["source", "alias", "connection"] })
  const test = useConnectionStore((s) => s.testsByKey[key])
  const input = connectionInputOfForm({ source, alias, connection })
  const current = isTestCurrent(test, input)

  return {
    test,
    current,
    method: connection.method,
    passed: current && test?.status === "ok",
    /** 校验不通过时返回 false，由调用方定位到第一个出错的字段 */
    run: async (): Promise<boolean> => {
      const fields = form.getValues("source") === "managed" ? TEST_FIELDS : []
      if (fields.length && !(await form.trigger(fields))) return false
      void useConnectionStore.getState().test(key, testRequestOf(form.getValues(), assetId))
      return true
    },
    cancel: () => void useConnectionStore.getState().cancel(key).catch(toastError),
  }
}

export type ConnTest = ReturnType<typeof useConnectionTest>

export function TestButton({ running, onRun, onCancel }: { running: boolean; onRun: () => void; onCancel: () => void }) {
  return running ? (
    <Button type="button" variant="outline" size="sm" onClick={onCancel}>
      <Spinner data-icon="inline-start" aria-hidden />
      {copy.test.cancel}
    </Button>
  ) : (
    <Button type="button" variant="outline" size="sm" onClick={onRun}>
      <PlugIcon data-icon="inline-start" />
      {copy.test.button}
    </Button>
  )
}

/**
 * 结果原地显示在按钮旁，不弹 Toast（PRD 6.5）；区域设置 aria-live="polite"（6.12）。
 * 密码方式测试通过后，紧接着显示「改用密钥登录」
 */
export function TestResult({
  test,
  current,
  method,
  assetId,
  onConvert,
  className,
}: {
  className?: string
  test: ConnectionTest | undefined
  current: boolean
  method: ServerFormValues["connection"]["method"]
  assetId?: string
  onConvert?: () => void
}) {
  const converting = useConverting((s) => !!assetId && s.ids.includes(assetId))
  let body: ReactNode = null
  if (converting) {
    body = (
      <span className="flex items-center gap-1.5 text-muted-foreground">
        <Spinner className="size-3.5" aria-hidden />
        {copy.convertKey.running}
      </span>
    )
  } else if (test && !current && test.status !== "running") {
    body = <span className="text-warning">{copy.test.stale}</span>
  } else if (test?.status === "running" || test?.status === "host-key") {
    body = <span className="text-muted-foreground">{copy.test.running}</span>
  } else if (test?.status === "cancelled") {
    body = <span className="text-muted-foreground">{copy.test.cancelled}</span>
  } else if (test?.status === "ok") {
    body = (
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="flex items-center gap-1.5 text-success">
          <CircleCheckIcon className="size-3.5 shrink-0" aria-hidden />
          {copy.test.ok(formatDuration(test.ms ?? 0), test.remoteOs)}
        </span>
        {method === "password" && onConvert && (
          <Button type="button" variant="outline" size="xs" onClick={onConvert}>
            <KeyRoundIcon data-icon="inline-start" />
            {copy.test.convertKey}
          </Button>
        )}
      </span>
    )
  } else if (test?.status === "failed") {
    const e = test.error ?? { id: "unknown" as const }
    const params = { alias: test.alias, ...e.params }
    body = (
      <span className="flex items-start gap-1.5 text-destructive">
        <CircleXIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span className="flex flex-col gap-0.5">
          <span>{copy.sshError[e.id].title(params)}</span>
          <span className="text-muted-foreground">{copy.sshError[e.id].hint(params)}</span>
        </span>
      </span>
    )
  }
  // 每个新结果淡入 150ms（PRD 7.7）；外层的 aria-live 区域保持不动，读屏照常播报
  const key = converting ? "converting" : test && !current && test.status !== "running" ? "stale" : (test?.status ?? "none")
  return (
    <div aria-live="polite" className={cn("min-w-0 text-xs", className)}>
      {body && (
        <motion.div key={key} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.15 }}>
          {body}
        </motion.div>
      )}
    </div>
  )
}
