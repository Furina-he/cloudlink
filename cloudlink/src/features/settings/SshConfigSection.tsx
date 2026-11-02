import { CircleCheckIcon, FileCogIcon, TriangleAlertIcon } from "lucide-react"
import { useEffect, useState } from "react"

import type { EnvId, IpcError } from "@/bindings"
import { EnvIcon, StateBadge } from "@/components/app/StateBadge"
import { Button } from "@/components/ui/button"
import { CodeBlock, CodeBlockActions, CodeBlockContent, CodeBlockCopyButton } from "@/components/ui/code-block"
import { FieldDescription, FieldGroup, FieldLegend, FieldSet } from "@/components/ui/field"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "@/components/ui/toast"
import { copy, ipcErrorText } from "@/lib/copy"
import { useTargetStore } from "@/stores/targets"
import { PathField, Section } from "./Section"

/**
 * ssh 配置（PRD 6.7、F-107）：每个运行环境一组：托管文件、用户 config 是否已加入 Include、known_hosts。
 * 未加入时提供「加入 Include」和手动添加的那一行
 */
export function SshConfigSection() {
  const list = useTargetStore((s) => s.sshConfig)
  const [adding, setAdding] = useState<EnvId | null>(null)
  // 托管文件和用户 config 可能在外部被改过：每次打开分区重新读取
  useEffect(() => {
    void useTargetStore.getState().loadSshConfig().catch(() => {})
  }, [])

  const add = (envId: EnvId) => {
    setAdding(envId)
    useTargetStore
      .getState()
      .addSshInclude(envId)
      .then(() => toast.add({ title: copy.include.added(copy.env.long(envId)), type: "success" }))
      .catch((e: IpcError) => toast.add({ title: ipcErrorText(e.id, e.params), type: "error" }))
      .finally(() => setAdding(null))
  }

  return (
    <Section id="ssh" title={copy.settings.section.ssh} hint={copy.settings.sshHint}>
      <FieldGroup className="gap-6">
        {list.map((c) => (
          <FieldSet key={c.envId} className="min-w-0 gap-3">
            <FieldLegend variant="label" className="mb-0 flex items-center gap-1.5">
              <EnvIcon envId={c.envId} />
              {copy.env.long(c.envId)}
              {c.included ? (
                <StateBadge tone="success" icon={CircleCheckIcon}>
                  {copy.settings.sshIncluded}
                </StateBadge>
              ) : (
                <StateBadge tone="warning" icon={TriangleAlertIcon}>
                  {copy.settings.sshNotIncluded}
                </StateBadge>
              )}
            </FieldLegend>
            <PathField id={`ssh-managed-${c.envId}`} label={copy.settings.sshManaged} path={c.managedPath} />
            <PathField id={`ssh-user-${c.envId}`} label={copy.settings.sshUserConfig} path={c.userConfigPath} />
            <PathField id={`ssh-known-${c.envId}`} label={copy.settings.sshKnownHosts} path={c.knownHostsPath} />
            {!c.included && (
              <div className="flex flex-col gap-2">
                <div>
                  <Button variant="outline" size="sm" disabled={adding !== null} onClick={() => add(c.envId)}>
                    {adding === c.envId ? <Spinner data-icon="inline-start" aria-hidden /> : <FileCogIcon data-icon="inline-start" />}
                    {copy.settings.sshAddInclude}
                  </Button>
                </div>
                <FieldDescription>{copy.settings.sshManual}</FieldDescription>
                <CodeBlock size="sm">
                  <CodeBlockActions>
                    <CodeBlockCopyButton value={c.includeLine} labels={{ copy: copy.common.copy, copied: copy.common.copied }} />
                  </CodeBlockActions>
                  <CodeBlockContent>{c.includeLine}</CodeBlockContent>
                </CodeBlock>
              </div>
            )}
          </FieldSet>
        ))}
      </FieldGroup>
    </Section>
  )
}
