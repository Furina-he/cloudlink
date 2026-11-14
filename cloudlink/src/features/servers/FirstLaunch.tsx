import { FileInputIcon, PlusIcon, ServerIcon } from "lucide-react"
import { useEffect, type ReactNode } from "react"

import type { AgentBrand } from "@/bindings"
import { AgentMark, BrandMark } from "@/components/app/AgentMark"
import { ViewShell } from "@/components/app/ViewShell"
import { Button } from "@/components/ui/button"
import { useAgentOptions, type AgentOption } from "@/features/agents/agentKeys"
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
 * 「检测到 …」列的是 Agent，不列目录（PRD 6.9）：通用目录换成把它当主要目录的、检测到的 Agent（Codex、Cursor…），
 * 自定义目录用它的名字。只剩没人读的通用目录时退回目录名，免得说成「没有检测到 Agent」
 */
function detectedAgents(agents: AgentOption[]): { key: string; name: string; mark: ReactNode }[] {
  const out = new Map<string, { key: string; name: string; mark: ReactNode }>()
  for (const a of agents) {
    if (a.agent === "custom") {
      out.set(a.key, { key: a.key, name: a.label, mark: <AgentMark agent="custom" label={a.label} lit={false} className="size-3.5" /> })
      continue
    }
    const brands: AgentBrand[] = a.agent === "universal" ? a.readers : [a.agent]
    for (const b of brands) if (!out.has(b)) out.set(b, { key: b, name: copy.brand[b], mark: <BrandMark brand={b} className="size-3.5" /> })
  }
  if (out.size > 0) return [...out.values()]
  return agents.map((a) => ({ key: a.key, name: a.label, mark: <AgentMark agent={a.agent} label={a.label} lit={false} className="size-3.5" /> }))
}

/**
 * 空状态 = 首次使用引导（PRD 6.9）：品牌方块 → 标题 → 一句话 → 不含别名的示例 → 添加 / 导入 → 检测到的 Agent。
 * 空状态时顶栏不显示 `+`
 */
export function FirstLaunch({ focusTitle }: { focusTitle: boolean }) {
  const ui = useUIStore.getState
  const importable = useImportableCount()
  const { known, agents } = useAgentOptions()
  const detected = detectedAgents(agents)
  const example = copy.onboarding.example

  return (
    <ViewShell view="servers" title={copy.nav.servers} focusTitle={focusTitle} titleHidden>
      {/* 在可视高度里上下居中（PRD 6.9）：ViewShell 的内容区是撑满一屏的 flex 列 */}
      <div className="mx-auto my-auto flex w-full max-w-md flex-col items-center gap-4 py-8 text-center">
        <div aria-hidden className="flex size-13 items-center justify-center rounded-[12px] border border-line bg-card text-fg-2">
          <ServerIcon className="size-6" />
        </div>
        <div className="flex flex-col gap-1.5">
          <h2 className="text-lg font-semibold">{copy.onboarding.title}</h2>
          <p className="text-sm text-muted-foreground">{copy.onboarding.lead}</p>
        </div>
        <p className="w-full rounded-list border border-line bg-card px-4 py-2.5 text-left text-sm select-text">{example}</p>
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
        {/* 图标一行、文字一行：检测到的 Agent 多时，图标和名字挤在一行会折成三行 */}
        {known && (
          <div className="mt-4 flex flex-col items-center gap-1.5 text-xs text-muted-foreground">
            {detected.length > 0 ? (
              <>
                <span className="inline-flex flex-wrap items-center justify-center gap-1.5" aria-hidden>
                  {detected.map((a) => (
                    <span key={a.key} className="inline-flex">
                      {a.mark}
                    </span>
                  ))}
                </span>
                <p>{copy.onboarding.detected(detected.map((a) => a.name))}</p>
              </>
            ) : (
              <p>{copy.onboarding.noAgents}</p>
            )}
          </div>
        )}
      </div>
    </ViewShell>
  )
}
