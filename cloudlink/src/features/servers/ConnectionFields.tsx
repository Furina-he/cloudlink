import { Controller, useFormContext } from "react-hook-form"

import type { AuthMethod } from "@/bindings"
import { Field, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { copy } from "@/lib/copy"
import type { ServerFormValues } from "@/lib/schemas"
import { AuthFields } from "./AuthFields"
import { Required } from "./Required"
import { ValidationError } from "./ValidationError"

/** 密码排在最前：新建时默认选中（PRD 6.5） */
const METHODS: AuthMethod[] = ["password", "key", "agent"]

/** 地址 + 端口一行。onHostChange 在新建时让别名在名称没有英文时跟随地址 */
export function HostPortFields({ onHostChange }: { onHostChange?: () => void }) {
  const {
    register,
    formState: { errors },
  } = useFormContext<ServerFormValues>()
  const e = errors.connection
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_6rem] gap-3">
      <Field data-invalid={!!e?.host || undefined}>
        <FieldLabel htmlFor="server-host">
          {copy.serverForm.host} <Required />
        </FieldLabel>
        <Input
          id="server-host"
          aria-required
          aria-invalid={!!e?.host || undefined}
          placeholder={copy.serverForm.hostPlaceholder}
          className="font-mono"
          spellCheck={false}
          autoComplete="off"
          {...register("connection.host", { onChange: () => onHostChange?.() })}
        />
        <ValidationError error={e?.host} />
      </Field>
      <Field data-invalid={!!e?.port || undefined}>
        <FieldLabel htmlFor="server-port">{copy.serverForm.port}</FieldLabel>
        <Input
          id="server-port"
          inputMode="numeric"
          aria-invalid={!!e?.port || undefined}
          className="font-mono tabular-nums"
          autoComplete="off"
          {...register("connection.port", { valueAsNumber: true })}
        />
        <ValidationError error={e?.port} />
      </Field>
    </div>
  )
}

export function UserField() {
  const {
    register,
    formState: { errors },
  } = useFormContext<ServerFormValues>()
  const e = errors.connection
  return (
    <Field data-invalid={!!e?.user || undefined}>
      <FieldLabel htmlFor="server-user">
        {copy.serverForm.user} <Required />
      </FieldLabel>
      <Input
        id="server-user"
        aria-required
        aria-invalid={!!e?.user || undefined}
        className="font-mono"
        spellCheck={false}
        autoComplete="off"
        {...register("connection.user")}
      />
      <ValidationError error={e?.user} />
    </Field>
  )
}

/** 登录方式的分段切换，以及随之变化的字段。compact：新建表单只留一行私钥路径 */
export function AuthMethodFields({ assetId, compact }: { assetId?: string; compact?: boolean }) {
  const { control } = useFormContext<ServerFormValues>()
  return (
    <>
      <FieldSet className="min-w-0 gap-2">
        <FieldLegend variant="label" className="mb-0">
          {copy.serverForm.auth}
        </FieldLegend>
        <Controller
          name="connection.method"
          control={control}
          render={({ field }) => (
            <ToggleGroup
              variant="outline"
              size="sm"
              spacing={0}
              value={[field.value]}
              onValueChange={(next) => next[0] && field.onChange(next[0] as AuthMethod)}
            >
              {METHODS.map((m) => (
                <ToggleGroupItem key={m} value={m} className="px-3">
                  {copy.auth[m]}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          )}
        />
      </FieldSet>

      <AuthFields assetId={assetId} compact={compact} />
    </>
  )
}

/** 地址、端口、用户、登录方式（PRD 6.4）：详情的连接编辑态。新建表单用上面几块自己排（6.5） */
export function ConnectionFields({ assetId }: { assetId?: string }) {
  return (
    <>
      <HostPortFields />
      <UserField />
      <AuthMethodFields assetId={assetId} />
    </>
  )
}
