import { XIcon } from "lucide-react"
import { useEffect, useState } from "react"
import { FormProvider } from "react-hook-form"
import { useHotkeys } from "react-hotkeys-hook"

import { Keys } from "@/components/app/Keys"
import { Button } from "@/components/ui/button"
import { FieldGroup } from "@/components/ui/field"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Spinner } from "@/components/ui/spinner"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { copy } from "@/lib/copy"
import { HOTKEY_OPTIONS, HOTKEYS, isModalOpen, KEY_HINT } from "@/lib/hotkeys"
import { NEW_KEY, useConnectionStore } from "@/stores/connection"
import { useUIStore } from "@/stores/ui"
import { serverActions } from "./actions"
import { AdvancedFields } from "./AdvancedFields"
import { ConnectionFields } from "./ConnectionFields"
import { TestButton, TestResult, useConnectionTest } from "./ConnectionTest"
import { DraftPreview, SaveErrorAlert } from "./DraftPreview"
import { LeaveDialog, useLeaveGuard } from "./LeaveDialog"
import { SaveFlowDialogs } from "./SaveFlowDialogs"
import { EnvTagField, NameField } from "./sections/BasicSection"
import { firstError, focusField } from "./serverForm"
import { useAliasContext, useAliasFollow, useServerForm } from "./useServerForm"
import { useSaveFlow, type RevealTarget } from "./useSaveFlow"

/**
 * 新建服务器（PRD 6.5）：详情面板切换为表单，不用对话框，可以对照左边的列表。
 * 只要求名称、地址、端口、用户、认证方式、环境；别名、跳板机、写入的运行环境在「高级」里
 */
export function NewServerForm() {
  const ctx = useAliasContext(undefined)
  const form = useServerForm(undefined, ctx)
  const alias = useAliasFollow(form, ctx)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const conn = useConnectionTest(form, NEW_KEY, undefined)

  const reveal = (target: RevealTarget) => {
    if (target.advanced) setAdvancedOpen(true)
    focusField(form, target.path)
  }
  const flow = useSaveFlow({ asset: undefined, form, testKey: NEW_KEY, reveal })
  const guard = useLeaveGuard(form.formState.isDirty, () => form.reset(undefined, { keepDirtyValues: false }))

  useEffect(() => {
    form.setFocus("name")
    // 离开新建表单时丢掉这次的测试结果，下次新建从头开始
    return () => {
      const s = useConnectionStore.getState()
      if (s.testsByKey[NEW_KEY]?.status === "running") void s.cancel(NEW_KEY).catch(() => undefined)
      s.clear(NEW_KEY)
    }
  }, [form])

  useHotkeys(HOTKEYS.save, () => !isModalOpen() && flow.submit(), HOTKEY_OPTIONS)

  const runTest = async () => {
    if (await conn.run()) return
    const target = firstError(form.formState.errors)
    if (target) reveal(target)
  }
  const running = conn.test?.status === "running" || conn.test?.status === "host-key"
  const close = () => useUIStore.getState().selectAsset(null)

  return (
    <FormProvider {...form}>
      <section aria-labelledby="detail-title" className="flex h-full min-h-0 flex-col">
        <div className="flex items-center gap-2 border-b px-3 py-2.5">
          <h2 id="detail-title" tabIndex={-1} className="text-base font-semibold outline-none">
            {copy.detail.newTitle}
          </h2>
          <Tooltip>
            <TooltipTrigger render={<Button variant="ghost" size="icon-sm" className="ml-auto" aria-label={copy.common.close} onClick={close} />}>
              <XIcon />
            </TooltipTrigger>
            <TooltipContent>{copy.common.close}</TooltipContent>
          </Tooltip>
        </div>

        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-4 p-3 pb-6">
            {flow.error && <SaveErrorAlert error={flow.error} onRetry={() => flow.submit()} />}
            <p className="text-xs text-muted-foreground">{copy.serverForm.required}</p>
            <FieldGroup className="@container/field-group gap-4">
              <NameField onChange={alias.sync} />
              <ConnectionFields onHostChange={alias.sync} />
              <EnvTagField />
              <AdvancedFields open={advancedOpen} onOpenChange={setAdvancedOpen} ctx={ctx} onAliasChange={alias.markTouched} />
            </FieldGroup>
          </div>
        </ScrollArea>

        <div className="flex shrink-0 flex-col gap-2 border-t px-3 py-2.5">
          <div className="flex min-w-0 items-start gap-3">
            <TestButton running={running} onRun={() => void runTest()} onCancel={conn.cancel} />
            <div className="min-w-0 flex-1 pt-1.5">
              <TestResult
                test={conn.test}
                current={conn.current}
                method={conn.method}
                // 改用密钥登录要先有这台服务器：先保存（密码进凭据库），再生成密钥
                onConvert={() => flow.submit((saved) => void serverActions.convertToKey(saved.id))}
              />
            </div>
          </div>
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" disabled={flow.saving} onClick={close}>
              {copy.serverForm.cancel}
            </Button>
            <Button size="sm" disabled={flow.saving} onClick={() => flow.submit()}>
              {flow.saving && <Spinner data-icon="inline-start" aria-hidden />}
              {flow.saving ? copy.serverForm.saving : conn.passed ? copy.serverForm.saveAndProbe : copy.serverForm.save}
              <Keys keys={KEY_HINT.save} className="[&>kbd]:bg-primary-foreground/15 [&>kbd]:text-primary-foreground" />
            </Button>
          </div>
        </div>
      </section>

      <SaveFlowDialogs flow={flow} />
      <LeaveDialog guard={guard} />
      <DraftPreview control={form.control} asset={undefined} dirty />
    </FormProvider>
  )
}
