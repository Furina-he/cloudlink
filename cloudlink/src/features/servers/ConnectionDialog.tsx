// 连接编辑对话框（PRD 6.4）：连接字段不自动保存，在这里改完走保存流程（未验证提示、加入 SSH 配置、密码进凭据库）。
// 导入的服务器连接信息由用户自己的 ssh config 维护，这里只有两个导出开关，标题、说明和按钮跟着换
import { PlugIcon } from "lucide-react"
import { useState } from "react"
import { FormProvider } from "react-hook-form"

import type { ServerAsset } from "@/bindings"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Spinner } from "@/components/ui/spinner"
import { copy } from "@/lib/copy"
import { useConnectionStore } from "@/stores/connection"
import { serverActions } from "./actions"
import { TestResult, useConnectionTest } from "./ConnectionTest"
import { SaveErrorAlert } from "./DraftPreview"
import { SaveFlowDialogs } from "./SaveFlowDialogs"
import { ConnectionEditor } from "./sections/ConnectionSection"
import { firstError, focusField } from "./serverForm"
import { useAliasContext, useServerForm } from "./useServerForm"
import { useSaveFlow, type RevealTarget } from "./useSaveFlow"

/** 测试结果用单独的 key，和详情页标题行的「测试连接」互不覆盖 */
const testKeyOf = (id: string) => `${id}:edit`

function ConnectionDialogBody({ asset, onClose }: { asset: ServerAsset; onClose: () => void }) {
  const ctx = useAliasContext(asset.id)
  const form = useServerForm(asset, ctx)
  const [advancedOpen, setAdvancedOpen] = useState(() => asset.connection.source === "managed" && !!asset.connection.proxyJump)
  const testKey = testKeyOf(asset.id)
  const conn = useConnectionTest(form, testKey, asset.id)
  const reveal = (target: RevealTarget) => {
    if (target.advanced) setAdvancedOpen(true)
    focusField(form, target.path)
  }
  const flow = useSaveFlow({ asset, form, testKey, reveal })
  const running = conn.test?.status === "running" || conn.test?.status === "host-key"
  const managed = asset.connection.source === "managed"

  const runTest = async () => {
    if (await conn.run()) return
    const target = firstError(form.formState.errors)
    if (target) reveal(target)
  }
  const save = () =>
    flow.submit({
      after: () => {
        useConnectionStore.getState().clear(testKey)
        onClose()
      },
    })

  return (
    <FormProvider {...form}>
      <form
        className="flex min-h-0 flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
      >
        <ScrollArea className="-mx-4 max-h-[60vh] min-h-0">
          <div className="flex flex-col gap-4 px-4 pb-1">
            <ConnectionEditor asset={asset} ctx={ctx} advancedOpen={advancedOpen} onAdvancedChange={setAdvancedOpen} />
            {managed && <TestResult test={conn.test} current={conn.current} method={conn.method} assetId={asset.id} onConvert={() => void serverActions.convertToKey(asset.id)} />}
            {flow.error && <SaveErrorAlert error={flow.error} onRetry={save} />}
          </div>
        </ScrollArea>
        <DialogFooter>
          {managed && (
            <Button type="button" variant="outline" className="sm:mr-auto" onClick={running ? conn.cancel : () => void runTest()}>
              {running ? <Spinner data-icon="inline-start" aria-hidden /> : <PlugIcon data-icon="inline-start" />}
              {running ? copy.test.cancel : copy.detail.test}
            </Button>
          )}
          <Button type="button" variant="outline" onClick={onClose}>
            {copy.common.cancel}
          </Button>
          <Button type="submit" disabled={flow.saving || !form.formState.isDirty}>
            {flow.saving && <Spinner data-icon="inline-start" aria-hidden />}
            {managed ? copy.detail.saveConnection : copy.detail.saveExport}
          </Button>
        </DialogFooter>
      </form>
      <SaveFlowDialogs flow={flow} />
    </FormProvider>
  )
}

export function ConnectionDialog({ asset, open, onOpenChange }: { asset: ServerAsset; open: boolean; onOpenChange: (open: boolean) => void }) {
  const managed = asset.connection.source === "managed"
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="grid-cols-[minmax(0,1fr)] sm:max-w-[580px]" closeLabel={copy.common.close}>
        <DialogHeader>
          <DialogTitle>{managed ? copy.detail.editConnection : copy.detail.editExport}</DialogTitle>
          <DialogDescription>{managed ? copy.detail.editConnectionHint : copy.detail.editExportHint}</DialogDescription>
        </DialogHeader>
        {open && <ConnectionDialogBody asset={asset} onClose={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  )
}
