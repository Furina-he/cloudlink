import { FingerprintIcon, ShieldAlertIcon } from "lucide-react"

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
import { CodeBlock, CodeBlockContent } from "@/components/ui/code-block"
import { copy } from "@/lib/copy"
import { NEW_KEY, useConnectionStore } from "@/stores/connection"
import { toastError } from "./actions"

/**
 * 首次连接时核对主机指纹（F-106 AC2）：用户确认后才写入 known_hosts；
 * 指纹与已知记录不符时阻断，并提示可能的中间人风险。挂在 App 上，任何地方发起的测试都会走到这里；
 * 添加服务器的弹窗在连接步骤里就地核对（ConnectFlow），这里不再叠一层
 */
export function HostKeyDialog() {
  // 只选出 key（字符串），避免每次渲染都得到新对象
  const key = useConnectionStore((s) => Object.keys(s.testsByKey).find((k) => k !== NEW_KEY && s.testsByKey[k].status === "host-key") ?? null)
  const test = useConnectionStore((s) => (key ? s.testsByKey[key] : undefined))
  const hostKey = test?.hostKey
  const changed = hostKey?.known === "changed"
  const cancel = () => key && void useConnectionStore.getState().cancel(key).catch(toastError)

  return (
    <AlertDialog open={!!hostKey} onOpenChange={(open) => !open && cancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia>{changed ? <ShieldAlertIcon className="text-destructive" /> : <FingerprintIcon />}</AlertDialogMedia>
          <AlertDialogTitle>{changed ? copy.hostKey.changedTitle(test?.alias ?? "") : copy.hostKey.title}</AlertDialogTitle>
          <AlertDialogDescription>
            {changed ? copy.hostKey.changedDescription : copy.hostKey.description(test?.alias ?? "")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {hostKey && (
          <CodeBlock size="sm">
            <CodeBlockContent wrap className="font-mono">
              {hostKey.fingerprint}
            </CodeBlockContent>
          </CodeBlock>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>{changed ? copy.common.close : copy.common.cancel}</AlertDialogCancel>
          {!changed && (
            <AlertDialogAction onClick={() => key && void useConnectionStore.getState().trustHostKey(key).catch(toastError)}>
              {copy.hostKey.trust}
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
