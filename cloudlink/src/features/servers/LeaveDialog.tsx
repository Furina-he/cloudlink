import { useLayoutEffect, useState } from "react"

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
import { setLeaveGuard } from "@/stores/ui"

/**
 * 有未保存修改时离开当前对象（切换服务器、新建、离开视图）先确认（PRD 6.4）。
 * 返回给 LeaveDialog 的状态；onDiscard 负责丢弃草稿，之后再继续原来的跳转
 */
export function useLeaveGuard(dirty: boolean, onDiscard: () => void) {
  const [pending, setPending] = useState<(() => void) | null>(null)
  // 必须用 useLayoutEffect：登记要和「让离开变得有风险」的那次渲染在同一帧完成。
  // 用 useEffect 会在 DOM 已经更新、被动效果还没跑的间隙留一个窗口——连接过程里
  // 「加入 SSH 配置」卡片一出现的那一刻按 Esc，就会绕过确认直接关掉弹窗、丢掉草稿
  // （2026-11-11 CI 偶发失败）。布局效果在提交阶段同步执行，任何按键都不可能在它之前到达。
  useLayoutEffect(() => {
    if (!dirty) return
    setLeaveGuard((proceed) => {
      setPending(() => proceed)
      return true
    })
    return () => setLeaveGuard(null)
  }, [dirty])
  return {
    open: pending !== null,
    keep: () => setPending(null),
    discard: () => {
      const proceed = pending
      setPending(null)
      onDiscard()
      proceed?.()
    },
  }
}

export function LeaveDialog({ guard }: { guard: ReturnType<typeof useLeaveGuard> }) {
  return (
    <AlertDialog open={guard.open} onOpenChange={(open) => !open && guard.keep()}>
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>{copy.detail.leave.title}</AlertDialogTitle>
          <AlertDialogDescription>{copy.detail.leave.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{copy.detail.leave.keep}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={guard.discard}>
            {copy.detail.leave.discard}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
