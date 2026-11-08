import { CopyIcon, FileInputIcon, PlusIcon, ServerIcon } from "lucide-react"
import { useEffect } from "react"

import { AgentMark } from "@/components/app/AgentMark"
import { ViewShell } from "@/components/app/ViewShell"
import { Button } from "@/components/ui/button"
import { toast } from "@/components/ui/toast"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useAgentOptions } from "@/features/agents/agentKeys"
import { copy } from "@/lib/copy"
import { useTargetStore } from "@/stores/targets"
import { useUIStore } from "@/stores/ui"

/** ssh config 里还没导入的主机数（已排除代码托管主机，F-102）；第一次用到时扫描 */
export function useImportableCount(): number {
  const count = useTargetStore((s) => s.sshHosts?.hosts.filter((h) => !h.imported).length ?? 0)
  useEffect(() => {
    if (useTargetStore.getState().sshHostsStatus === "idle") void useTargetStore.getState().loadSshHosts()
  }, [])
  return count
}

/**
 * 空状态 = 首次使用引导（PRD 6.9）：品牌方块 → 标题 → 一句话 → 可复制的示例话术 → 添加 / 导入 → 检测到的 Agent。
 * 空状态时顶栏不显示 `+`
 */
export function FirstLaunch({ focusTitle }: { focusTitle: boolean }) {
  const ui = useUIStore.getState
  const importable = useImportableCount()
  const { known, agents } = useAgentOptions()
  const example = copy.onboarding.example
  const copyExample = () =>
    void navigator.clipboard
      .writeText(example)
      .then(() => toast.add({ title: copy.common.copied }))
      .catch(() => undefined)

  return (
    <ViewShell view="servers" title={copy.nav.servers} focusTitle={focusTitle} titleHidden>
      <div className="mx-auto flex w-full max-w-md flex-col items-center gap-4 pt-[12vh] pb-8 text-center">
        <div aria-hidden className="flex size-13 items-center justify-center rounded-[12px] border border-line bg-card text-fg-2">
          <ServerIcon className="size-6" />
        </div>
        <div className="flex flex-col gap-1.5">
          <h2 className="text-lg font-semibold">{copy.onboarding.title}</h2>
          <p className="text-sm text-muted-foreground">{copy.onboarding.lead}</p>
        </div>
        <div className="flex w-full items-center gap-2 rounded-list border border-line bg-card py-2.5 pr-2 pl-4 text-left text-sm select-text">
          <span className="min-w-0 flex-1">{example}</span>
          <Tooltip>
            <TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label={copy.onboarding.copyExample} onClick={copyExample} />}>
              <CopyIcon />
            </TooltipTrigger>
            <TooltipContent>{copy.onboarding.copyExample}</TooltipContent>
          </Tooltip>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <Button onClick={() => ui().startCreate("ssh")}>
            <PlusIcon data-icon="inline-start" />
            {copy.onboarding.addSsh}
          </Button>
          {importable > 0 && (
            <Button variant="secondary" onClick={() => ui().setImportOpen(true)}>
              <FileInputIcon data-icon="inline-start" />
              {copy.onboarding.importSsh(importable)}
            </Button>
          )}
        </div>
        {known && (
          <p className="mt-4 flex flex-wrap items-center justify-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
            {agents.length > 0 ? (
              <>
                <span>{copy.onboarding.detectedLead}</span>
                <span className="inline-flex items-center gap-1" aria-hidden>
                  {agents.map((a) => (
                    <AgentMark key={a.key} agent={a.agent} label={a.label} lit className="size-3.5" />
                  ))}
                </span>
                <span>{copy.onboarding.detected(agents.map((a) => a.label).join("、"))}</span>
              </>
            ) : (
              <span>{copy.onboarding.noAgents}</span>
            )}
          </p>
        )}
      </div>
    </ViewShell>
  )
}
