import { CopyIcon, EyeIcon, EyeOffIcon, FolderOpenIcon, TriangleAlertIcon } from "lucide-react"
import { useState } from "react"
import { Controller, useFormContext, useWatch } from "react-hook-form"

import type { EnvId } from "@/bindings"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"
import { toast } from "@/components/ui/toast"
import { copy } from "@/lib/copy"
import { ipc } from "@/lib/ipc"
import { isUnderMnt, mntToWindows, toEnvPath } from "@/lib/paths"
import type { ServerFormValues } from "@/lib/schemas"
import { useAssetStore } from "@/stores/assets"
import { serverActions } from "./actions"
import { CopyKeyDialog, type CopyKeyRequest } from "./CopyKeyDialog"
import { sortEnvs } from "./serverForm"
import { useAvailableEnvs } from "./useServerForm"
import { ValidationError } from "./ValidationError"

/** 私钥文件：每个写入的运行环境一行路径，带文件选择；WSL 的行可以「复制到 WSL」（F-108 AC4） */
function KeyRows() {
  const { control, getValues, setValue, formState: { errors } } = useFormContext<ServerFormValues>()
  const definedIn = useWatch({ control, name: "connection.definedIn" })
  const envs = useAvailableEnvs().filter((e) => definedIn.includes(e.id))
  const [copyReq, setCopyReq] = useState<CopyKeyRequest | null>(null)
  const error = errors.connection?.identityFile

  // 运行环境 id 带点号，不能拼进表单路径；整个记录一起更新
  const setKey = (env: EnvId, path: string) =>
    setValue("connection.identityFile", { ...getValues("connection.identityFile"), [env]: path }, { shouldDirty: true, shouldValidate: !!error })
  const pick = async (env: EnvId) => {
    const path = await ipc.pickFile()
    if (typeof path === "string") setKey(env, toEnvPath(path, env))
  }
  const requestCopy = (env: EnvId) => {
    const keys = getValues("connection.identityFile")
    const source = keys.windows?.trim() || mntToWindows(keys[env] ?? "") || ""
    if (!source) toast.add({ title: copy.copyKey.noSource, type: "warning" })
    else setCopyReq({ source, envId: env })
  }

  return (
    <FieldSet className="min-w-0 gap-2" data-invalid={!!error || undefined}>
      <FieldLegend variant="label" className="mb-0">
        {copy.serverForm.key}
      </FieldLegend>
      <Controller
        name="connection.identityFile"
        control={control}
        render={({ field }) => (
          <div className="grid grid-cols-[max-content_minmax(0,1fr)] items-center gap-x-3 gap-y-2">
            {sortEnvs(envs.map((e) => e.id)).map((env, i) => {
              const value = field.value[env] ?? ""
              const wsl = env.startsWith("wsl:")
              const mnt = wsl && isUnderMnt(value)
              const id = `server-key-${i}`
              return (
                <div key={env} className="contents">
                  <FieldLabel htmlFor={id} className="text-xs font-normal text-muted-foreground">
                    {copy.env.long(env)}
                  </FieldLabel>
                  <InputGroup>
                    <InputGroupInput
                      id={id}
                      ref={i === 0 ? field.ref : undefined}
                      value={value}
                      onChange={(e) => setKey(env, e.target.value)}
                      onBlur={field.onBlur}
                      aria-label={copy.serverForm.keyLabel(copy.env.long(env))}
                      aria-invalid={!!error || undefined}
                      aria-describedby={mnt ? `${id}-mnt` : undefined}
                      className="font-mono"
                      spellCheck={false}
                      autoComplete="off"
                    />
                    <InputGroupAddon align="inline-end">
                      <InputGroupButton size="xs" onClick={() => void pick(env)} aria-label={copy.serverForm.keyPickLabel(copy.env.long(env))}>
                        <FolderOpenIcon />
                        {copy.serverForm.keyPick}
                      </InputGroupButton>
                    </InputGroupAddon>
                  </InputGroup>
                  {wsl && (
                    <div className="col-start-2 flex flex-wrap items-center gap-x-2 gap-y-1">
                      {mnt && (
                        <span id={`${id}-mnt`} className="flex items-center gap-1 text-xs text-warning">
                          <TriangleAlertIcon className="size-3.5 shrink-0" aria-hidden />
                          {copy.serverForm.keyMntWarning}
                        </span>
                      )}
                      <Button type="button" variant="outline" size="xs" onClick={() => requestCopy(env)}>
                        <CopyIcon data-icon="inline-start" />
                        {copy.serverForm.copyToWsl}
                      </Button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      />
      <ValidationError error={error} />
      <CopyKeyDialog request={copyReq} onClose={() => setCopyReq(null)} onCopied={(env, path) => setKey(env, path)} />
    </FieldSet>
  )
}

/** ssh-agent：说明 + 各运行环境 ssh-add -l 检测到的密钥数 */
function AgentInfo() {
  const { control } = useFormContext<ServerFormValues>()
  const definedIn = useWatch({ control, name: "connection.definedIn" })
  const envs = useAvailableEnvs().filter((e) => definedIn.includes(e.id))
  return (
    <div className="flex flex-col gap-1 text-sm">
      <p className="text-muted-foreground">{copy.serverForm.agentHint}</p>
      <ul className="flex flex-col gap-0.5 text-xs text-muted-foreground">
        {envs.map((e) => (
          <li key={e.id}>{copy.serverForm.agentKeys(copy.env.long(e.id), e.sshAgentKeys)}</li>
        ))}
      </ul>
    </div>
  )
}

/** 密码（F-108）：只在这次请求里经 IPC 交给后端，存进系统凭据库；下方常驻提示 Agent 无法输入密码 */
function PasswordField({ assetId }: { assetId?: string }) {
  const { register, control, setValue, formState: { errors } } = useFormContext<ServerFormValues>()
  const saved = useWatch({ control, name: "connection.passwordSaved" })
  const [show, setShow] = useState(false)
  const error = errors.connection?.password

  const removeSaved = async () => {
    if (!assetId) return
    await serverActions.deletePassword(assetId)
    const a = useAssetStore.getState().byId[assetId]
    setValue("connection.passwordSaved", (a?.type === "vps" && a.connection.auth?.passwordSaved) || false)
  }

  return (
    <div className="flex flex-col gap-3">
      <Field data-invalid={!!error || undefined}>
        <FieldLabel htmlFor="server-password">{copy.serverForm.password}</FieldLabel>
        <InputGroup>
          <InputGroupInput
            id="server-password"
            type={show ? "text" : "password"}
            autoComplete="new-password"
            placeholder={saved ? copy.serverForm.passwordKeep : undefined}
            aria-invalid={!!error || undefined}
            aria-describedby={saved ? "server-password-saved" : undefined}
            {...register("connection.password")}
          />
          <InputGroupAddon align="inline-end">
            <InputGroupButton size="icon-xs" onClick={() => setShow((v) => !v)} aria-label={show ? copy.serverForm.hidePassword : copy.serverForm.showPassword}>
              {show ? <EyeOffIcon /> : <EyeIcon />}
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
        {saved && (
          <FieldDescription id="server-password-saved" className="flex flex-wrap items-center gap-2">
            {copy.connection.passwordSaved}
            {assetId && (
              <Button type="button" variant="link" size="xs" className="h-auto p-0" onClick={() => void removeSaved()}>
                {copy.connection.deletePassword}
              </Button>
            )}
          </FieldDescription>
        )}
        <ValidationError error={error} />
      </Field>
      {/* 新建时「连接并启用」会自动改用密钥（F-108 AC1），只给一句说明；已保存的服务器仍要提醒 Agent 无法输入密码 */}
      {assetId ? (
        <Alert>
          <TriangleAlertIcon className="text-warning!" />
          <AlertDescription>{copy.serverForm.passwordAlert}</AlertDescription>
        </Alert>
      ) : (
        <p className="text-xs text-muted-foreground">{copy.create.passwordHint}</p>
      )}
    </div>
  )
}

/** 认证方式下面随之变化的字段 */
export function AuthFields({ assetId }: { assetId?: string }) {
  const { control } = useFormContext<ServerFormValues>()
  const method = useWatch({ control, name: "connection.method" })
  if (method === "key") return <KeyRows />
  if (method === "agent") return <AgentInfo />
  return <PasswordField assetId={assetId} />
}
