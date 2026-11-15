import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { UseFormReturn } from "react-hook-form"

import type { IpcError } from "@/bindings"

const fake = vi.hoisted(() => ({
  effects: [] as (() => void | (() => void))[],
  cleanups: [] as (() => void)[],
  error: null as IpcError | null,
  toast: vi.fn(),
}))

// Node 单测只驱动这个 hook 的异步流程；不引入 DOM／测试渲染依赖。
vi.mock("react", () => ({
  useCallback: <T,>(fn: T) => fn,
  useRef: <T,>(value: T) => ({ current: value }),
  useEffect: (effect: () => void | (() => void)) => { fake.effects.push(effect) },
  useState: (initial: IpcError | null) => [initial, (value: IpcError | null) => { fake.error = value }],
}))
vi.mock("@/components/ui/toast", () => ({ toast: { add: fake.toast } }))

import { DEBOUNCE_MS, useAutoSave } from "./useAutoSave"

type Values = { production: boolean }

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function AutoSaveHarness(save: (values: Values) => Promise<void>) {
  let values: Values = { production: true }
  const watchers: (() => void)[] = []
  const trigger = vi.fn(async () => true)
  const control = { _defaultValues: { production: true } }
  const form = {
    control,
    getValues: () => ({ ...values }),
    trigger,
    watch: (watcher: () => void) => { watchers.push(watcher); return { unsubscribe: vi.fn() } },
  } as unknown as UseFormReturn<Values>
  const auto = useAutoSave({ form, fields: ["production"], save })
  for (const effect of fake.effects) {
    const cleanup = effect()
    if (cleanup) fake.cleanups.push(cleanup)
  }
  return {
    auto,
    trigger,
    change: (production: boolean, notify = false) => {
      values = { production }
      if (notify) watchers.forEach((watcher) => watcher())
    },
    saved: (production: boolean) => { control._defaultValues = { production } },
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  fake.effects = []
  fake.cleanups = []
  fake.error = null
})

afterEach(() => {
  fake.cleanups.forEach((cleanup) => cleanup())
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe("自动保存 flush 等待（P8a／b）", () => {
  it("保存进行中时再次 flush 不能提前完成", async () => {
    const pending = deferred<void>()
    const save = vi.fn(() => pending.promise)
    const page = AutoSaveHarness(save)
    page.change(false)
    const first = page.auto.flush()
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    let completed = false
    const second = page.auto.flush().then(() => { completed = true })
    await Promise.resolve()
    expect(completed).toBe(false)

    page.saved(false)
    pending.resolve()
    await Promise.all([first, second])
    expect(completed).toBe(true)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it("保存中有新改动时，flush 等到后续保存完成，不能只等第一份", async () => {
    const a = deferred<void>(), b = deferred<void>()
    const save = vi.fn().mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise)
    const page = AutoSaveHarness(save)
    page.change(false)
    const first = page.auto.flush()
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    page.change(true)
    let completed = false
    const second = page.auto.flush().then(() => { completed = true })
    page.saved(false)
    a.resolve()
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2))
    expect(save.mock.calls.map(([values]) => values.production)).toEqual([false, true])
    expect(completed).toBe(false)

    page.saved(true)
    b.resolve()
    await Promise.all([first, second])
    expect(completed).toBe(true)
  })

  it("异步校验期间的重复 flush 也不能启动两份相同保存", async () => {
    const validation = deferred<boolean>(), pending = deferred<void>()
    const save = vi.fn(() => pending.promise)
    const page = AutoSaveHarness(save)
    page.change(false)
    page.trigger.mockReturnValue(validation.promise)
    const first = page.auto.flush(), second = page.auto.flush()
    await vi.waitFor(() => expect(page.trigger).toHaveBeenCalled())
    expect(page.trigger).toHaveBeenCalledTimes(1)
    validation.resolve(true)
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    page.saved(false)
    pending.resolve()
    await Promise.all([first, second])
    expect(save).toHaveBeenCalledTimes(1)
  })

  it("保存失败保留错误和输入；重试成功清除错误，队列不会卡住", async () => {
    const pending = deferred<void>()
    const save = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValueOnce(undefined)
    const page = AutoSaveHarness(save)
    page.change(false)
    const first = page.auto.flush()
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    pending.reject({ id: "internal" })
    await first
    expect(fake.error).toEqual({ id: "internal" })
    expect(fake.toast).not.toHaveBeenCalled()

    await page.auto.flush()
    expect(save.mock.calls.map(([values]) => values.production)).toEqual([false, false])
    expect(fake.error).toBeNull()
    expect(fake.toast).toHaveBeenCalledTimes(1)
  })

  it("600ms 防抖不变；输入失焦立即保存并取消原计时", async () => {
    vi.useFakeTimers()
    const save = vi.fn(async ({ production }: Values) => page.saved(production))
    const page = AutoSaveHarness(save)
    page.change(false, true)
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS - 1)
    expect(save).not.toHaveBeenCalled()
    page.auto.onBlurCapture({ target: { matches: () => true } } as unknown as React.FocusEvent)
    await page.auto.flush()
    page.saved(false)
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    expect(save).toHaveBeenCalledTimes(1)
  })
})
