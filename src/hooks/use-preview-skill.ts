import { useEffect, useRef, useState } from "react"

import type { CompilePreview, IpcError, PreviewRequest } from "@/bindings"
import { ipc, toIpcError } from "@/lib/ipc"

interface Result {
  key: string
  scope: string
  preview?: CompilePreview
  error?: IpcError
}

/**
 * 草稿预览（PRD 6.4、F-204）：同一份输入交给 Rust 编译器的预览命令。
 * 草稿变化时做 200ms 防抖；只采用最后一次请求的结果，较早返回的直接丢弃。
 * scope 标识当前对象：换了服务器，就不再显示上一台的旧结果
 */
export function usePreviewSkill(req: PreviewRequest | null, scope: string, debounceMs: number) {
  const key = req ? JSON.stringify(req) : ""
  const [result, setResult] = useState<Result | null>(null)
  const latest = useRef(0)

  useEffect(() => {
    if (!key) return
    const seq = ++latest.current
    const timer = setTimeout(() => {
      ipc.previewSkill(JSON.parse(key) as PreviewRequest).then(
        (preview) => seq === latest.current && setResult({ key, scope, preview }),
        (e: unknown) => seq === latest.current && setResult({ key, scope, error: toIpcError(e) })
      )
    }, debounceMs)
    return () => clearTimeout(timer)
  }, [key, scope, debounceMs])

  const sameScope = result?.scope === scope
  return {
    preview: sameScope ? (result?.preview ?? null) : null,
    error: sameScope && result?.key === key ? (result?.error ?? null) : null,
    pending: !!key && result?.key !== key,
  }
}
