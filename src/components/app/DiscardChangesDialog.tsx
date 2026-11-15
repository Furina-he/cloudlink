import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { copy } from "@/lib/copy"

/**
 * 对话框防误关（PRD 6.11）：有未提交的改动时，Esc、点遮罩、关闭按钮都先问一次。
 * 放在被保护的 Dialog 的 Root 里面渲染（Base UI 嵌套对话框的写法）
 */
export function DiscardChangesDialog({
  open,
  onKeep,
  onDiscard,
}: {
  open: boolean
  onKeep: () => void
  onDiscard: () => void
}) {
  return (
    <AlertDialog open={open} onOpenChange={(next) => !next && onKeep()}>
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>{copy.discardDialog.title}</AlertDialogTitle>
          <AlertDialogDescription>{copy.discardDialog.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{copy.discardDialog.keep}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onDiscard}>
            {copy.discardDialog.discard}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
