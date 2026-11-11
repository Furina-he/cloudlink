import { FileCogIcon, TriangleAlertIcon } from "lucide-react"
import { useState } from "react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { copy } from "@/lib/copy"
import { IncludeDetails } from "./IncludeParts"
import type { SaveFlow } from "./useSaveFlow"

/**
 * 保存途中的两个确认：连接未验证（PRD 6.5）、加入 SSH 配置（F-107 AC1）。
 * inlineInclude：添加流程里「加入 SSH 配置」是过程页的一步，不在对话框上再叠对话框，这里就不渲染它
 */
export function SaveFlowDialogs({ flow, inlineInclude }: { flow: SaveFlow; inlineInclude?: boolean }) {
  // 关闭后保留最后一次的内容，退场动画期间文字不消失
  const [last, setLast] = useState(flow.confirm)
  if (flow.confirm && flow.confirm !== last) setLast(flow.confirm)
  const shown = flow.confirm ?? last
  const envIds = shown?.stage === "include" ? shown.envIds : []

  return (
    <>
      <AlertDialog open={flow.confirm?.stage === "unverified"} onOpenChange={(open) => !open && flow.cancelConfirm()}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogMedia>
              <TriangleAlertIcon className="text-warning" />
            </AlertDialogMedia>
            <AlertDialogTitle>{copy.serverForm.unverifiedTitle}</AlertDialogTitle>
            <AlertDialogDescription>{copy.serverForm.unverifiedDescription}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{copy.common.cancel}</AlertDialogCancel>
            <AlertDialogAction onClick={flow.confirmUnverified}>{copy.serverForm.unverifiedConfirm}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!inlineInclude && flow.confirm?.stage === "include"} onOpenChange={(open) => !open && flow.cancelConfirm()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia>
              <FileCogIcon />
            </AlertDialogMedia>
            <AlertDialogTitle>{copy.include.title}</AlertDialogTitle>
            <AlertDialogDescription>{copy.include.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <IncludeDetails envIds={envIds} />
          <AlertDialogFooter>
            {/* 「暂不加入」照常保存，不是取消；用普通按钮，避免和关闭事件的先后顺序纠缠 */}
            <AlertDialogAction variant="outline" onClick={flow.declineInclude}>
              {copy.include.skip}
            </AlertDialogAction>
            <AlertDialogAction onClick={() => void flow.acceptInclude()}>{copy.include.add}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
