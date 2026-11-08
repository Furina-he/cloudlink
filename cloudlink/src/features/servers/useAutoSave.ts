// 编辑即保存（PRD 6.4）：文本类字段停止输入 600ms 或失焦后保存，开关、标签和列表的改动走同一个计时。
// 保存前只校验页面上能改的字段，不通过就等用户改完（错误就地显示）；成功后底部提示条「已保存」，连续保存不叠加
import { useCallback, useEffect, useRef, useState } from "react"
import type { FieldPath, FieldValues, UseFormReturn } from "react-hook-form"

import type { IpcError } from "@/bindings"
import { toast } from "@/components/ui/toast"
import { copy } from "@/lib/copy"

/** 深比较两份表单值（普通对象、数组、原始值）；值为 undefined 的键视同不存在 */
export function sameValues(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const keys = (o: object) => Object.keys(o).filter((k) => (o as Record<string, unknown>)[k] !== undefined)
  const ka = keys(a)
  const kb = keys(b)
  if (ka.length !== kb.length) return false
  return ka.every((k) => sameValues((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
}

/** 「已保存」提示条的固定 id：同一个提示条原地刷新计时，不会一条条叠起来 */
export const SAVED_TOAST_ID = "asset-saved"

export const DEBOUNCE_MS = 600

/**
 * 表单值和已保存的不一样时（RHF 的 defaultValues 由 values 同步为已保存的资源），计时结束或失焦就保存。
 * fields：保存前要校验的字段；连接参数不在页面上编辑，不参与校验
 */
export function useAutoSave<T extends FieldValues>({
  form,
  fields,
  save,
}: {
  form: UseFormReturn<T>
  fields: FieldPath<T>[]
  save: (values: T) => Promise<void>
}) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const busy = useRef(false)
  const again = useRef(false)
  const saveRef = useRef(save)
  const fieldsRef = useRef(fields)
  useEffect(() => {
    saveRef.current = save
    fieldsRef.current = fields
  })
  const [error, setError] = useState<IpcError | null>(null)

  const flush = useCallback(async (): Promise<void> => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    if (busy.current) {
      again.current = true
      return
    }
    // control._defaultValues 是 RHF 当前的默认值（values 同步后立即更新）；formState.defaultValues 要等下一次渲染
    if (sameValues(form.getValues(), form.control._defaultValues)) return
    if (!(await form.trigger(fieldsRef.current))) return
    busy.current = true
    try {
      await saveRef.current(form.getValues())
      setError(null)
      toast.add({ id: SAVED_TOAST_ID, title: copy.detail.saved })
    } catch (e) {
      setError(e as IpcError)
    } finally {
      busy.current = false
      if (again.current) {
        again.current = false
        void flushRef.current()
      }
    }
  }, [form])
  // 保存途中又有改动：保存完再来一次（通过 ref 调用，避免回调引用自己）
  const flushRef = useRef(flush)
  useEffect(() => {
    flushRef.current = flush
  }, [flush])

  // 每次改动重新计时；资源在后台更新（values 同步）也会触发，但值和已保存的一样，不会保存
  useEffect(() => {
    const sub = form.watch(() => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => void flush(), DEBOUNCE_MS)
    })
    return () => sub.unsubscribe()
  }, [form, flush])

  // 离开详情时，把还在计时的改动立即存掉
  useEffect(
    () => () => {
      if (timer.current) void flush()
    },
    [flush]
  )

  return {
    flush,
    error,
    /** 文本框失焦立即保存（PRD 6.4）；按钮、开关自己调用 flush */
    onBlurCapture: (e: React.FocusEvent) => {
      const el = e.target as HTMLElement
      if (el.matches("input, textarea")) void flush()
    },
  }
}
