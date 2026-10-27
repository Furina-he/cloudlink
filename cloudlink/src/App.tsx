import { CircleCheckIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Progress,
  ProgressLabel,
  ProgressValue,
} from "@/components/ui/progress"

// P0 占位页：只用来核对令牌（钢墨主按钮、状态绿徽章、琥珀进度条）。P1 由应用外壳替换
export function App() {
  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <div className="flex w-full max-w-sm flex-col gap-4">
        <h1 className="text-base font-semibold">CloudLink</h1>
        <div className="flex items-center gap-2">
          <Button>保存</Button>
          <Badge variant="success">
            <CircleCheckIcon data-icon="inline-start" />
            已挂载
          </Badge>
        </div>
        <Progress value={92} tone="warning">
          <ProgressLabel>正文行数</ProgressLabel>
          <ProgressValue />
        </Progress>
      </div>
    </main>
  )
}

export default App
