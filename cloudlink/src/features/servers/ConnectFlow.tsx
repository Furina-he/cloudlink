import {
  CircleCheckIcon,
  CircleDashedIcon,
  CircleMinusIcon,
  CircleXIcon,
  CopyIcon,
  FileTextIcon,
  FingerprintIcon,
  ServerIcon,
  ShieldAlertIcon,
} from "lucide-react"
import { motion } from "motion/react"
import type { ReactNode } from "react"

import type { EnvId, KeyCheck, SshErrorId } from "@/bindings"
import { CommandChip } from "@/components/app/CommandChip"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "@/components/ui/toast"
import { Trace, TraceDescription, TraceIcon, TraceLine, TraceTitle } from "@/components/ui/trace"
import { copy } from "@/lib/copy"
import { formatDuration } from "@/lib/format"
import type { ServerFormValues } from "@/lib/schemas"
import { cn } from "@/lib/utils"
import type { ConnectionTest } from "@/stores/connection"
import { IncludeDetails } from "./IncludeParts"
import { useKeyCheck } from "./keyCheck"

export type ConnectStepId = "key" | "reach" | "hostKey" | "login" | "include" | "convert" | "sync"
/** 「让 Agent 能用别名连接」这一步：还没到、等用户决定、正在加入、已加入、暂不加入 */
export type IncludeState = "todo" | "waiting" | "adding" | "added" | "declined"
export type ConnectStepState = "pending" | "running" | "done" | "attention" | "failed" | "skipped"
/** 连接通过之后的启用阶段 */
export type EnableStage = "saving" | "converting" | "enabling"

export interface ConnectStep {
  id: ConnectStepId
  state: ConnectStepState
  /** 标题右侧的一句状态 */
  detail?: string
}

/** 错误发生在哪一步（PRD 8.3 的分类按连接过程归位） */
export function stepOfError(id: SshErrorId): ConnectStepId {
  switch (id) {
    case "key-not-found":
    case "key-permissions":
    case "key-invalid":
      return "key"
    case "host-key-unknown":
    case "host-key-changed":
      return "hostKey"
    case "auth-failed":
    case "password-rejected":
    case "needs-interaction":
    case "partial":
      return "login"
    case "resolve-failed":
    case "timeout":
    case "connection-refused":
    case "unknown":
      return "reach"
  }
}

const ORDER: ConnectStepId[] = ["key", "reach", "hostKey", "login", "include", "convert", "sync"]

/**
 * 由一次测试连接的结果推出各步骤的状态。后端只在结束时报告一次结果，
 * 所以进行中的那一步按已知信息推断：确认过指纹之后在登录，否则在连接。
 * 「检查私钥」只有私钥方式有，「安装免密密钥」只有密码方式有，
 * 「让 Agent 能用别名连接」只在有运行环境还没加入 SSH 配置、也没问过时出现（include 不为空）
 */
export function connectSteps(input: {
  method: ServerFormValues["connection"]["method"]
  test: ConnectionTest | undefined
  keyCheck: KeyCheck | null
  enable: EnableStage | null
  /** 会同步到几个目录 */
  dirs: number
  include?: IncludeState | null
}): ConnectStep[] {
  const { method, test, keyCheck, enable, dirs, include } = input
  const ids = ORDER.filter((id) => (id !== "key" || method === "key") && (id !== "include" || !!include) && (id !== "convert" || method === "password"))
  const d = copy.connect.detail
  /** 用户对加入 SSH 配置的决定，不随连接结果变化 */
  const includeStep: ConnectStep | undefined =
    include === "waiting"
      ? { id: "include", state: "attention", detail: d.includeWaiting }
      : include === "adding"
        ? { id: "include", state: "running", detail: d.includeAdding }
        : include === "added"
          ? { id: "include", state: "done", detail: d.includeAdded }
          : include === "declined"
            ? { id: "include", state: "skipped", detail: d.includeDeclined }
            : undefined
  const keyDone: ConnectStep = {
    id: "key",
    state: "done",
    detail: keyCheck?.status === "ok" && keyCheck.keyType ? keyCheck.keyType : undefined,
  }
  const hostKeyDone = (): ConnectStep => {
    const k = test?.hostKey
    const detail =
      k?.known === "adopted"
        ? d.hostKeyAdopted(k.knownAs ?? "")
        : k?.known === "trusted"
          ? d.hostKeyTrusted
          : d.hostKeyKnown
    return { id: "hostKey", state: "done", detail }
  }
  const byId = (steps: Partial<Record<ConnectStepId, ConnectStep>>, rest: ConnectStepState) =>
    ids.map((id) => (id === "include" && includeStep) || steps[id] || { id, state: rest })

  if (!test) return byId({}, "pending")
  switch (test.status) {
    case "running": {
      // 用户刚信任了指纹：连接与指纹已经完成，正在登录
      if (test.hostKey?.known === "trusted") {
        return byId(
          {
            key: keyDone,
            reach: { id: "reach", state: "done" },
            hostKey: { id: "hostKey", state: "done", detail: d.hostKeyTrusted },
            login: { id: "login", state: "running", detail: d.loggingIn },
          },
          "pending"
        )
      }
      const keyRunning = method === "key" && keyCheck?.status !== "ok"
      return byId(
        {
          key: keyRunning ? { id: "key", state: "running", detail: d.checking } : keyDone,
          reach: { id: "reach", state: keyRunning ? "pending" : "running", detail: keyRunning ? undefined : d.connecting },
        },
        "pending"
      )
    }
    case "host-key": {
      const changed = test.hostKey?.known === "changed"
      return byId(
        {
          key: keyDone,
          reach: { id: "reach", state: "done" },
          hostKey: { id: "hostKey", state: changed ? "failed" : "attention", detail: changed ? undefined : d.hostKeyWaiting },
        },
        changed ? "skipped" : "pending"
      )
    }
    case "ok": {
      // 保存排在「安装免密密钥」之前；没有那一步时算在「同步给 Agent」里
      const password = method === "password"
      const convert: ConnectStep =
        enable === "converting"
          ? { id: "convert", state: "running", detail: d.converting }
          : enable === "saving"
            ? { id: "convert", state: "running", detail: d.saving }
            : { id: "convert", state: enable === "enabling" ? "done" : "pending" }
      const sync: ConnectStep =
        enable === "enabling"
          ? { id: "sync", state: "running", detail: d.syncing(dirs) }
          : enable === "saving" && !password
            ? { id: "sync", state: "running", detail: d.saving }
            : { id: "sync", state: "pending" }
      return byId(
        {
          key: keyDone,
          reach: { id: "reach", state: "done" },
          hostKey: hostKeyDone(),
          login: {
            id: "login",
            state: "done",
            detail: [d.loggedIn(test.remoteOs), test.ms != null ? formatDuration(test.ms) : null].filter(Boolean).join(" · "),
          },
          convert,
          sync,
        },
        "pending"
      )
    }
    case "failed": {
      const at = stepOfError(test.error?.id ?? "unknown")
      const index = ids.indexOf(at)
      const steps: Partial<Record<ConnectStepId, ConnectStep>> = {}
      ids.forEach((id, i) => {
        if (i < index) steps[id] = id === "key" ? keyDone : id === "hostKey" ? hostKeyDone() : { id, state: "done" }
        else if (i === index) steps[id] = { id, state: "failed" }
        else steps[id] = { id, state: "skipped" }
      })
      return byId(steps, "skipped")
    }
    case "cancelled":
      return byId({}, "skipped")
  }
}

function StepIcon({ id, state }: { id: ConnectStepId; state: ConnectStepState }) {
  switch (state) {
    case "running":
      return <Spinner aria-hidden />
    case "done":
      return <CircleCheckIcon className="text-success" />
    case "failed":
      return <CircleXIcon className="text-destructive" />
    case "attention":
      return id === "include" ? <FileTextIcon className="text-foreground" /> : <FingerprintIcon className="text-foreground" />
    case "skipped":
      return <CircleMinusIcon />
    case "pending":
      return <CircleDashedIcon />
  }
}

function stepTitle(id: ConnectStepId, method: ServerFormValues["connection"]["method"]) {
  const s = copy.connect.steps
  switch (id) {
    case "key":
      return s.key
    case "reach":
      return s.reach
    case "hostKey":
      return s.hostKey
    case "login":
      return s.login(copy.auth[method])
    case "include":
      return s.include
    case "convert":
      return s.convert
    case "sync":
      return s.sync
  }
}

/** 第一次连接：指纹就地核对，不再叠一层对话框（PRD 6.5、F-106 AC2） */
function FingerprintCheck({ host, fingerprint, onTrust, onBack }: { host: string; fingerprint: string; onTrust: () => void; onBack: () => void }) {
  const copyFingerprint = () =>
    void navigator.clipboard
      ?.writeText(fingerprint)
      .then(() => toast.add({ title: copy.common.copied, type: "success" }))
      .catch(() => undefined)
  return (
    <div className="flex flex-col gap-2.5 rounded-lg border bg-card p-3" data-testid="connect-fingerprint">
      <p className="text-sm">{copy.connect.newKey(host)}</p>
      <div className="flex items-center gap-2 rounded-md bg-muted py-1.5 pr-1.5 pl-2.5">
        <code className="min-w-0 flex-1 font-mono text-xs break-all" data-testid="connect-fingerprint-value">
          {fingerprint}
        </code>
        <Button type="button" variant="ghost" size="icon-xs" onClick={copyFingerprint} aria-label={copy.connect.copyFingerprint}>
          <CopyIcon />
        </Button>
      </div>
      <div className="flex flex-col gap-1 text-xs text-muted-foreground">
        <p>{copy.hostKey.verifyHint}</p>
        <code className="w-fit max-w-full rounded-sm bg-muted px-1.5 py-0.5 font-mono break-all text-foreground">{copy.hostKey.verifyCommand}</code>
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onBack}>
          {copy.connect.back}
        </Button>
        <Button type="button" size="sm" onClick={onTrust} autoFocus>
          <FingerprintIcon data-icon="inline-start" />
          {copy.hostKey.trust}
        </Button>
      </div>
    </div>
  )
}

/** 让 Agent 能用别名连接（F-107 AC1）：就地问一次，不再叠一层对话框；细节收在「了解详情」里 */
function IncludeAsk({ alias, envIds, onAdd, onSkip }: { alias: string; envIds: EnvId[]; onAdd: () => void; onSkip: () => void }) {
  return (
    <div className="flex flex-col gap-2.5 rounded-lg border bg-card p-3" data-testid="connect-include">
      <p className="text-sm leading-relaxed">
        {copy.include.ask.lead} <CommandChip>{copy.include.ask.command(alias)}</CommandChip> {copy.include.ask.tail}
      </p>
      <IncludeDetails envIds={envIds} />
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onSkip}>
          {copy.include.skip}
        </Button>
        <Button type="button" size="sm" onClick={onAdd} autoFocus>
          {copy.include.add}
        </Button>
      </div>
    </div>
  )
}

/** 失败的那一步：原因 + 下一步 + 就地修复 */
function StepError({ test, fix }: { test: ConnectionTest; fix?: ReactNode }) {
  const e = test.error ?? { id: "unknown" as const }
  const params = { alias: test.alias, ...e.params }
  const changed = test.status === "host-key" && test.hostKey?.known === "changed"
  return (
    <div className="flex flex-col gap-1.5" role="alert">
      {changed ? (
        <>
          <p className="flex items-start gap-1.5 text-sm text-destructive">
            <ShieldAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
            {copy.hostKey.changedTitle(test.alias)}
          </p>
          <p className="text-xs text-muted-foreground">{copy.hostKey.changedDescription}</p>
          {test.hostKey && <code className="rounded-md bg-muted px-2 py-1 font-mono text-xs break-all">{test.hostKey.fingerprint}</code>}
          <p className="text-xs text-muted-foreground">{copy.hostKey.changedFix(test.alias)}</p>
        </>
      ) : (
        <>
          <p className="text-sm text-destructive">{copy.sshError[e.id].title(params)}</p>
          <p className="text-xs text-muted-foreground">{copy.sshError[e.id].hint(params)}</p>
        </>
      )}
      {fix && <div className="flex flex-wrap gap-2 pt-0.5">{fix}</div>}
    </div>
  )
}

/**
 * 添加服务器时的连接过程（PRD 6.5，向 Termius 的连接页看齐）：逐步显示检查私钥、连接、核对指纹、登录、启用，
 * 指纹在对应步骤里就地核对，失败的那一步写明原因并给出修复动作
 */
export function ConnectFlow({
  name,
  alias,
  user,
  host,
  port,
  method,
  keyEnv,
  keyPath,
  test,
  enable,
  dirs,
  include,
  includeEnvs,
  onTrust,
  onBack,
  onInclude,
  onSkipInclude,
  fixKey,
}: {
  name: string
  alias: string
  user: string
  host: string
  port: number
  method: ServerFormValues["connection"]["method"]
  keyEnv?: EnvId
  keyPath?: string
  test: ConnectionTest | undefined
  enable: EnableStage | null
  dirs: number
  include?: IncludeState | null
  includeEnvs?: EnvId[]
  onTrust: () => void
  /** 指纹卡里的「返回修改」：取消这次连接并回到表单 */
  onBack: () => void
  onInclude?: () => void
  onSkipInclude?: () => void
  /** 私钥那一步失败时的修复按钮（复制到 ~/.ssh 等） */
  fixKey?: ReactNode
}) {
  const keyCheck = useKeyCheck(method === "key" ? keyEnv : undefined, keyPath, 0)
  const steps = connectSteps({ method, test, keyCheck, enable, dirs, include })
  const authLabel = copy.auth[method]

  return (
    <div className="flex flex-col gap-4" data-testid="connect-flow">
      <div className="flex items-center gap-3 rounded-lg border bg-muted/40 px-3 py-2.5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-background">
          <ServerIcon className="size-4" aria-hidden />
        </span>
        <div className="flex min-w-0 flex-col">
          <span className="text-sm font-medium break-all">{name || alias}</span>
          <span className="font-mono text-xs break-all text-muted-foreground">
            {copy.connect.target(user, host, port)} · {authLabel}
          </span>
        </div>
      </div>

      <Trace role="list" aria-label={copy.connect.title(alias)} className="gap-3">
        {steps.map((step) => (
          <div key={step.id} role="listitem" data-step={step.id} data-state={step.state} className="flex flex-col gap-2">
            <TraceLine
              status={step.state === "running" ? "running" : step.state === "failed" ? "error" : step.state === "pending" || step.state === "skipped" ? "pending" : undefined}
              className={cn("w-full", (step.state === "done" || step.state === "attention") && "text-foreground")}
            >
              <TraceIcon>
                <StepIcon id={step.id} state={step.state} />
              </TraceIcon>
              <TraceTitle>{stepTitle(step.id, method)}</TraceTitle>
              <span className="sr-only">{copy.connect.state[step.state]}</span>
              {step.detail && <TraceDescription className="ml-auto min-w-0 shrink text-right">{step.detail}</TraceDescription>}
            </TraceLine>
            {step.id === "hostKey" && step.state === "attention" && test?.hostKey && (
              <motion.div className="pl-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.15 }}>
                <FingerprintCheck host={host} fingerprint={test.hostKey.fingerprint} onTrust={onTrust} onBack={onBack} />
              </motion.div>
            )}
            {step.id === "include" && step.state === "attention" && onInclude && onSkipInclude && (
              <motion.div className="pl-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.15 }}>
                <IncludeAsk alias={alias} envIds={includeEnvs ?? []} onAdd={onInclude} onSkip={onSkipInclude} />
              </motion.div>
            )}
            {step.state === "failed" && step.id !== "include" && test && (
              <motion.div className="pl-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.15 }}>
                <StepError test={test} fix={step.id === "key" ? fixKey : undefined} />
              </motion.div>
            )}
          </div>
        ))}
      </Trace>

      {test?.status === "cancelled" && <p className="text-xs text-muted-foreground">{copy.connect.cancelled}</p>}
    </div>
  )
}
