import { useState, type Ref } from "react"

import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxValue,
  useComboboxAnchor,
} from "@/components/ui/combobox"
import { copy } from "@/lib/copy"
import { cn } from "@/lib/utils"

export interface ComboOption {
  value: string
  /** 列表里显示的文字；新建项是「使用「xxx」」 */
  label: string
  /** 右侧的补充说明，例如别名定义在哪些运行环境 */
  hint?: string
  create?: boolean
}

/**
 * Combobox 只能从候选里选值（Base UI 的约束），这里按官方 Creatable 示例的思路，
 * 在没有完全匹配时追加一项「使用「输入值」」，用于云厂商、地域、标签、SSH 别名这类可以新写的字段
 */
function withCreate(
  options: ComboOption[],
  query: string,
  normalize: (v: string) => string = (v) => v.trim(),
  accept: (v: string) => boolean = () => true
): ComboOption[] {
  const q = normalize(query)
  if (!q || !accept(q) || options.some((o) => o.value === q)) return options
  return [...options, { value: q, label: copy.common.createValue(q), create: true }]
}

const itemKey = (o: ComboOption) => (o.create ? `create:${o.value}` : o.value)

function OptionList({ emptyText = copy.common.noOptions }: { emptyText?: string }) {
  return (
    <>
      <ComboboxEmpty>{emptyText}</ComboboxEmpty>
      <ComboboxList>
        {(item: ComboOption) => (
          <ComboboxItem key={itemKey(item)} value={item}>
            <span className="truncate">{item.label}</span>
            {item.hint && (
              <span className="ml-auto shrink-0 text-xs text-muted-foreground">{item.hint}</span>
            )}
          </ComboboxItem>
        )}
      </ComboboxList>
    </>
  )
}

/** 单选：value 为空串表示未填 */
export function CreatableCombobox({
  id,
  value,
  onChange,
  onBlur,
  options,
  placeholder,
  invalid,
  required,
  describedBy,
  inputRef,
  inputClassName,
  clearable,
}: {
  id?: string
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  options: ComboOption[]
  placeholder?: string
  invalid?: boolean
  required?: boolean
  describedBy?: string
  inputRef?: Ref<HTMLInputElement>
  inputClassName?: string
  clearable?: boolean
}) {
  const [query, setQuery] = useState("")
  const selected = value ? (options.find((o) => o.value === value) ?? { value, label: value }) : null
  return (
    <Combobox
      items={withCreate(options, query)}
      value={selected}
      onValueChange={(item: ComboOption | null) => onChange(item?.value ?? "")}
      onInputValueChange={setQuery}
      itemToStringLabel={(item: ComboOption) => item.value}
      isItemEqualToValue={(a: ComboOption, b: ComboOption) => a.value === b.value}
      autoHighlight
    >
      <ComboboxInput
        id={id}
        ref={inputRef}
        placeholder={placeholder}
        aria-invalid={invalid || undefined}
        aria-required={required || undefined}
        aria-describedby={describedBy}
        onBlur={onBlur}
        className={cn("w-full", inputClassName)}
        showClear={clearable && !!value}
        clearLabel={copy.common.clear}
        triggerLabel={copy.common.showOptions}
      />
      <ComboboxContent>
        <OptionList />
      </ComboboxContent>
    </Combobox>
  )
}

/**
 * 多选，选中项显示为 Chip（标签、承载的站点）。
 * normalize 规整输入（例如域名转小写），accept 决定输入值能不能新建；不能时列表为空，显示 emptyText
 */
export function CreatableMultiCombobox({
  id,
  value,
  onChange,
  onBlur,
  options,
  placeholder,
  describedBy,
  inputRef,
  invalid,
  normalize,
  accept,
  emptyText,
  mono,
}: {
  id?: string
  value: string[]
  onChange: (value: string[]) => void
  onBlur?: () => void
  options: ComboOption[]
  placeholder?: string
  describedBy?: string
  inputRef?: Ref<HTMLInputElement>
  invalid?: boolean
  normalize?: (v: string) => string
  accept?: (v: string) => boolean
  emptyText?: string
  /** 值是机器字符串（域名）时用等宽字体（DESIGN.md Mono Is Data） */
  mono?: boolean
}) {
  const anchor = useComboboxAnchor()
  const [query, setQuery] = useState("")
  const selected = value.map((v) => options.find((o) => o.value === v) ?? { value: v, label: v })
  return (
    <Combobox
      multiple
      items={withCreate(options, query, normalize, accept)}
      value={selected}
      onValueChange={(items: ComboOption[]) => onChange(items.map((o) => o.value))}
      onInputValueChange={setQuery}
      itemToStringLabel={(item: ComboOption) => item.value}
      isItemEqualToValue={(a: ComboOption, b: ComboOption) => a.value === b.value}
      autoHighlight
    >
      <ComboboxChips ref={anchor}>
        <ComboboxValue>
          {(values: ComboOption[]) => (
            <>
              {values.map((o) => (
                <ComboboxChip
                  key={o.value}
                  removeLabel={copy.common.remove(o.value)}
                  className={cn(mono && "font-mono")}
                >
                  {o.value}
                </ComboboxChip>
              ))}
              <ComboboxChipsInput
                id={id}
                ref={inputRef}
                placeholder={values.length ? "" : placeholder}
                aria-describedby={describedBy}
                aria-invalid={invalid || undefined}
                onBlur={onBlur}
                className={cn(mono && "font-mono")}
              />
            </>
          )}
        </ComboboxValue>
      </ComboboxChips>
      <ComboboxContent anchor={anchor}>
        <OptionList emptyText={emptyText} />
      </ComboboxContent>
    </Combobox>
  )
}
