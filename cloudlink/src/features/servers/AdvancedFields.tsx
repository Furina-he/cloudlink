import { ChevronRightIcon } from "lucide-react"
import { useMemo, type ReactNode } from "react"
import { Controller, useFormContext, useWatch } from "react-hook-form"

import { CreatableCombobox } from "@/components/app/CreatableCombobox"
import { Checkbox } from "@/components/ui/checkbox"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { copy } from "@/lib/copy"
import type { AliasContext, ServerFormValues } from "@/lib/schemas"
import { Required } from "./Required"
import { useAvailableEnvs } from "./useServerForm"
import { ValidationError } from "./ValidationError"

/**
 * 「高级」（PRD 6.5）：别名、跳板机、写入的运行环境。折叠标题实时显示别名；
 * 展开状态由外层控制，保存校验失败时可以展开到出错的字段
 */
export function AdvancedFields({
  open,
  onOpenChange,
  ctx,
  onAliasChange,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  ctx: AliasContext
  /** 新建时：用户改过别名就不再跟随名称 */
  onAliasChange?: (alias: string) => void
  /** 详情编辑态追加的内容（导出开关） */
  children?: ReactNode
}) {
  const {
    register,
    control,
    formState: { errors },
  } = useFormContext<ServerFormValues>()
  const alias = useWatch({ control, name: "alias" })
  const envs = useAvailableEnvs()
  const e = errors.connection
  // 跳板机候选：其他服务器的别名和 ssh config 里的 Host
  const jumpOptions = useMemo(
    () => [...new Set([...ctx.taken, ...ctx.sshHosts.map((h) => h.alias)])].sort().map((a) => ({ value: a, label: a })),
    [ctx]
  )

  return (
    <Collapsible open={open} onOpenChange={onOpenChange} className="flex flex-col gap-3">
      <CollapsibleTrigger className="group/advanced flex min-w-0 items-center gap-2 rounded-md text-left text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
        <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-aria-expanded/advanced:rotate-90" aria-hidden />
        <span className="font-medium">{copy.connection.advanced}</span>
        <span className="min-w-0 truncate text-xs text-muted-foreground">{copy.connection.advancedSummary(alias.trim())}</span>
      </CollapsibleTrigger>
      <CollapsibleContent className="h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-200 data-ending-style:h-0 data-starting-style:h-0">
        <FieldGroup className="gap-4 border-l pb-1 pl-4">
          <Field data-invalid={!!errors.alias || undefined}>
            <FieldLabel htmlFor="server-alias">
              {copy.serverForm.alias} <Required />
            </FieldLabel>
            <Input
              id="server-alias"
              aria-required
              aria-invalid={!!errors.alias || undefined}
              aria-describedby="server-alias-hint"
              className="font-mono"
              spellCheck={false}
              autoComplete="off"
              {...register("alias", { onChange: (ev: { target: { value: string } }) => onAliasChange?.(ev.target.value) })}
            />
            <FieldDescription id="server-alias-hint">{copy.serverForm.aliasHint}</FieldDescription>
            <ValidationError error={errors.alias} />
          </Field>

          <Field>
            <FieldLabel htmlFor="server-proxy-jump">
              {copy.serverForm.proxyJump}
              <span className="font-normal text-muted-foreground">{copy.common.optional}</span>
            </FieldLabel>
            <Controller
              name="connection.proxyJump"
              control={control}
              render={({ field }) => (
                <CreatableCombobox
                  id="server-proxy-jump"
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  inputRef={field.ref}
                  options={jumpOptions.filter((o) => o.value !== alias.trim())}
                  placeholder={copy.serverForm.proxyJumpPlaceholder}
                  describedBy="server-proxy-jump-hint"
                  inputClassName="font-mono"
                  clearable
                />
              )}
            />
            <FieldDescription id="server-proxy-jump-hint">{copy.serverForm.proxyJumpHint}</FieldDescription>
          </Field>

          <FieldSet className="min-w-0 gap-2" data-invalid={!!e?.definedIn || undefined}>
            <FieldLegend variant="label" className="mb-0">
              {copy.serverForm.envs} <Required />
            </FieldLegend>
            <FieldDescription>{copy.serverForm.envsHint}</FieldDescription>
            <Controller
              name="connection.definedIn"
              control={control}
              render={({ field }) => (
                <div className="flex flex-wrap gap-x-4 gap-y-2">
                  {envs.map((env, i) => {
                    const id = `server-env-${i}`
                    const checked = field.value.includes(env.id)
                    return (
                      <Field key={env.id} orientation="horizontal" className="w-auto">
                        <Checkbox
                          id={id}
                          ref={i === 0 ? field.ref : undefined}
                          checked={checked}
                          aria-invalid={!!e?.definedIn || undefined}
                          onCheckedChange={(on) =>
                            field.onChange(on ? [...field.value, env.id] : field.value.filter((x) => x !== env.id))
                          }
                        />
                        <FieldLabel htmlFor={id} className="font-normal">
                          {copy.env.long(env.id)}
                        </FieldLabel>
                      </Field>
                    )
                  })}
                </div>
              )}
            />
            <ValidationError error={e?.definedIn} />
          </FieldSet>
          {children}
        </FieldGroup>
      </CollapsibleContent>
    </Collapsible>
  )
}
