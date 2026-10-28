import { FieldError } from "@/components/ui/field"
import { copy } from "@/lib/copy"
import type { ValidationKey } from "@/lib/schemas"
import { errorKey } from "./assetForm"

/** 把 zod 返回的校验 key 映射成中文，显示在字段下方 */
export function ValidationError({ error, id }: { error: unknown; id?: string }) {
  const key = errorKey(error)
  if (!key) return null
  return <FieldError id={id}>{copy.validation[key as ValidationKey] ?? key}</FieldError>
}
