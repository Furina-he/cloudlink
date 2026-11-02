import type { Mode, Settings } from "@/bindings"
import { useTheme } from "@/components/theme-provider"
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet, FieldTitle } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { copy } from "@/lib/copy"
import { Section, update } from "./Section"

const THEMES = ["system", "light", "dark"] as const
const MODES: Mode[] = ["read-only", "standard"]

/** 通用（PRD 6.7）：主题、编译产物语言、新建非生产服务器的默认档位 */
export function GeneralSection({ settings }: { settings: Settings }) {
  const { theme, setTheme } = useTheme()
  return (
    <Section id="general" title={copy.settings.section.general}>
      <FieldGroup className="gap-6">
        <FieldSet className="gap-3">
          <FieldLegend variant="label" className="mb-0">
            {copy.settings.theme}
          </FieldLegend>
          <RadioGroup
            value={theme}
            onValueChange={(v) => {
              const next = v as Settings["theme"]
              setTheme(next)
              update({ theme: next })
            }}
            className="flex flex-wrap gap-4"
          >
            {THEMES.map((t) => (
              <Field key={t} orientation="horizontal" className="w-auto">
                <RadioGroupItem value={t} id={`theme-${t}`} />
                <FieldLabel htmlFor={`theme-${t}`} className="font-normal">
                  {copy.settings.themeOption[t]}
                </FieldLabel>
              </Field>
            ))}
          </RadioGroup>
        </FieldSet>
        <Field>
          <FieldLabel htmlFor="output-language">{copy.settings.outputLanguage}</FieldLabel>
          <Input
            id="output-language"
            value={copy.settings.outputLanguageValue}
            readOnly
            aria-describedby="output-language-hint"
            className="max-w-xs text-muted-foreground"
          />
          <FieldDescription id="output-language-hint">{copy.settings.outputLanguageHint}</FieldDescription>
        </Field>
        <FieldSet className="gap-3">
          <FieldLegend variant="label" className="mb-0">
            {copy.settings.defaultMode}
          </FieldLegend>
          <FieldDescription>{copy.settings.defaultModeHint}</FieldDescription>
          <RadioGroup
            value={settings.defaultMode}
            onValueChange={(v) => update({ defaultMode: v as Mode })}
            className="grid gap-3 sm:grid-cols-2"
          >
            {MODES.map((m) => (
              <FieldLabel key={m} htmlFor={`default-mode-${m}`}>
                <Field orientation="horizontal">
                  <RadioGroupItem value={m} id={`default-mode-${m}`} />
                  <FieldContent>
                    <FieldTitle>{copy.mode[m]}</FieldTitle>
                    <FieldDescription>{copy.modeHint[m]}</FieldDescription>
                  </FieldContent>
                </Field>
              </FieldLabel>
            ))}
          </RadioGroup>
        </FieldSet>
      </FieldGroup>
    </Section>
  )
}
