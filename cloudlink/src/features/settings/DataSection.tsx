import type { Settings } from "@/bindings"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup, FieldTitle } from "@/components/ui/field"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { copy } from "@/lib/copy"
import { PathField, Section } from "./Section"

/** 数据（PRD 6.7）：数据目录、日志目录；导出或导入 JSON 在 P1 */
export function DataSection({ settings }: { settings: Settings }) {
  return (
    <Section id="data" title={copy.settings.section.data}>
      <FieldGroup className="gap-6">
        <PathField id="data-dir" label={copy.settings.dataDir} path={settings.dataDir} />
        <PathField id="log-dir" label={copy.settings.logDir} path={settings.logDir} />
        <Field>
          <FieldTitle>{copy.settings.importExport}</FieldTitle>
          <div>
            <Tooltip>
              <TooltipTrigger render={<span className="inline-flex" />}>
                <Button variant="outline" size="sm" disabled>
                  {copy.settings.importExport}
                  <span className="sr-only">（{copy.settings.importExportLater}）</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>{copy.settings.importExportLater}</TooltipContent>
            </Tooltip>
          </div>
        </Field>
      </FieldGroup>
    </Section>
  )
}
