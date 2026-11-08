// 唯一允许调用 invoke 的地方（PRD 7.3、7.8）
import { invoke } from "@tauri-apps/api/core"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { open } from "@tauri-apps/plugin-dialog"
import { revealItemInDir } from "@tauri-apps/plugin-opener"

import type {
  ActivityItem,
  ActivityQuery,
  AddCustomTargetRequest,
  AgentNote,
  Asset,
  AssetInput,
  CliEnvState,
  CliProvider,
  CliScopeItem,
  CompilePreview,
  CompileStatus,
  ConnectionTestRequest,
  Delivery,
  DeleteResult,
  EnvId,
  Environment,
  GuardRules,
  GuardStatus,
  ImportHost,
  Inclusion,
  IpcError,
  KeyCheck,
  KeyCheckRequest,
  Mode,
  Operation,
  OperationQuery,
  PreviewRequest,
  Relation,
  SaveResult,
  Settings,
  SkillConfig,
  SshConfigStatus,
  SshHostList,
  Target,
  UpdateStatus,
} from "@/bindings"

export type CliEnvStates = Partial<Record<EnvId, CliEnvState>>

export const ipc = {
  detectEnvironments: () => invoke<Environment[]>("detect_environments"),
  listSshHosts: (envId?: EnvId) =>
    invoke<SshHostList>("list_ssh_hosts", { envId }),
  listAssets: () => invoke<Asset[]>("list_assets"),
  saveAsset: (input: AssetInput) => invoke<SaveResult>("save_asset", { input }),
  /** removeGeneratedKey：一并删除 CloudLink 生成或复制的密钥（F-101 AC2，2026-10-31 补充） */
  deleteAsset: (id: string, opts: { removeGeneratedKey: boolean }) =>
    invoke<DeleteResult>("delete_asset", { id, opts }),
  importHosts: (hosts: ImportHost[], probeAfter: boolean) =>
    invoke<Asset[]>("import_hosts", { hosts, probeAfter }),
  /** 结果经 connection://tested 返回 */
  testConnection: (req: ConnectionTestRequest) =>
    invoke<{ testId: string }>("test_connection", { req }),
  cancelConnectionTest: (testId: string) =>
    invoke<void>("cancel_connection_test", { testId }),
  trustHostKey: (testId: string, fingerprint: string) =>
    invoke<void>("trust_host_key", { testId, fingerprint }),
  /** 写入系统凭据库；null 为删除 */
  setPassword: (assetId: string, password: string | null) =>
    invoke<void>("set_password", { assetId, password }),
  convertToKeyAuth: (assetId: string) =>
    invoke<Asset>("convert_to_key_auth", { assetId }),
  /** F-108 AC4：复制到该发行版的 ~/.ssh/，600 权限，重名加后缀；返回副本路径（2026-10-31 补充） */
  copyKeyToWsl: (req: { source: string; envId: EnvId }) =>
    invoke<{ path: string }>("copy_key_to_wsl", { req }),
  /** Windows：复制一份只有当前用户能读的副本到 ~/.ssh/；WSL 与 copyKeyToWsl 相同（F-108） */
  copyKeyToSshDir: (req: { source: string; envId: EnvId }) =>
    invoke<{ path: string }>("copy_key_to_ssh_dir", { req }),
  /** 私钥预检：权限、格式、密码短语（F-108），只读 */
  checkKey: (req: KeyCheckRequest) => invoke<KeyCheck>("check_key", { req }),
  getSshConfigStatus: () => invoke<SshConfigStatus[]>("get_ssh_config_status"),
  addSshInclude: (envId: EnvId) =>
    invoke<SshConfigStatus>("add_ssh_include", { envId }),
  /** 把服务器分发给某个 Agent，或者停止分发（F-303）；返回这台服务器的列入情况 */
  setDistribute: (assetId: string, agentKey: string, on: boolean) =>
    invoke<Inclusion[]>("set_distribute", { assetId, agentKey, on }),
  setMode: (assetId: string, mode: Mode) =>
    invoke<SaveResult>("set_mode", { assetId, mode }),
  /** F-104 AC1：只检测已启用 Agent 所在的运行环境（Login Shell）；带 assetId 时同时更新这项资源 */
  detectCliEnvironment: (req: {
    provider: CliProvider
    assetId?: string
    account?: string
  }) => invoke<CliEnvStates>("detect_cli_environment", { req }),
  /** F-104 AC3：拉取账号下的可选资源；带 assetId 时保留已勾选的项并更新这项资源 */
  refreshCliScope: (req: {
    provider: CliProvider
    assetId?: string
    account?: string
  }) => invoke<CliScopeItem[]>("refresh_cli_scope", { req }),
  /** 范围勾选立即生效（PRD 6.4），重新编译（2026-11-02 补充） */
  setCliScope: (assetId: string, selectedIds: string[]) =>
    invoke<SaveResult>("set_cli_scope", { assetId, selectedIds }),
  /** F-104 AC2：在对应运行环境打开终端，预填安装或登录命令 */
  openEnvTerminal: (req: { envId: EnvId; command: string }) =>
    invoke<void>("open_env_terminal", { req }),
  startProbe: (assetId: string) =>
    invoke<{ runId: string }>("start_probe", { assetId }),
  cancelProbe: (runId: string) => invoke<void>("cancel_probe", { runId }),
  /** 只用于待确认项 */
  confirmProbeItems: (runId: string, changeIds: string[]) =>
    invoke<SaveResult>("confirm_probe_items", { runId, changeIds }),
  undoProbe: (runId: string) => invoke<SaveResult>("undo_probe", { runId }),
  getSkillConfig: () => invoke<SkillConfig>("get_skill_config"),
  /** CloudLink 从资源推出的关系，标出用户隐藏的（2026-11-07） */
  listRelations: () => invoke<Relation[]>("list_relations"),
  saveSkillConfig: (input: SkillConfig) =>
    invoke<CompileStatus[]>("save_skill_config", { input }),
  /** 带草稿时预览草稿 */
  previewSkill: (req: PreviewRequest) =>
    invoke<CompilePreview>("preview_skill", { req }),
  getCompileStatus: () => invoke<CompileStatus[]>("get_compile_status"),
  listTargets: () => invoke<Target[]>("list_targets"),
  setTargetEnabled: (id: string, enabled: boolean) =>
    invoke<Target>("set_target_enabled", { id, enabled }),
  addCustomTarget: (req: AddCustomTargetRequest) =>
    invoke<Target>("add_custom_target", { req }),
  removeCustomTarget: (id: string) =>
    invoke<void>("remove_custom_target", { id }),
  listInclusions: () => invoke<Inclusion[]>("list_inclusions"),
  listDeliveries: () => invoke<Delivery[]>("list_deliveries"),
  checkDeliveries: () => invoke<Delivery[]>("check_deliveries"),
  repairDelivery: (id: string) => invoke<Delivery>("repair_delivery", { id }),
  removeAllDeliveries: () => invoke<void>("remove_all_deliveries"),
  getGuardStatus: () => invoke<GuardStatus[]>("get_guard_status"),
  installGuard: (envId: EnvId) =>
    invoke<GuardStatus>("install_guard", { envId }),
  removeGuard: (envId: EnvId) => invoke<GuardStatus>("remove_guard", { envId }),
  getGuardRules: () => invoke<GuardRules>("get_guard_rules"),
  listOperations: (q: OperationQuery) =>
    invoke<Operation[]>("list_operations", { q }),
  listNotes: (assetId?: string) =>
    invoke<AgentNote[]>("list_notes", { assetId }),
  /** text 为编辑后的内容 */
  mergeNotes: (items: { id: string; text?: string }[]) =>
    invoke<SaveResult>("merge_notes", { items }),
  dismissNotes: (ids: string[]) => invoke<void>("dismiss_notes", { ids }),
  listActivity: (q: ActivityQuery) =>
    invoke<ActivityItem[]>("list_activity", { q }),
  getSettings: () => invoke<Settings>("get_settings"),
  updateSettings: (patch: Partial<Settings>) =>
    invoke<Settings>("update_settings", { patch }),
  getProbeScript: () => invoke<string>("get_probe_script"),
  /** 清空数据（P3 契约扩展，2026-10-29 用户确认；v3 起同时删除托管 ssh 配置、凭据库中的密码、护栏 hook、收件箱和操作记录） */
  resetData: () => invoke<void>("reset_data"),
  /** F-406：当前版本和最近一次检查的结果 */
  getUpdateStatus: () => invoke<UpdateStatus>("get_update_status"),
  /** F-406：下载、校验签名并安装，进度经 update://changed；有进行中的任务时返回 update-busy；Windows 上开始安装后应用退出 */
  installUpdate: () => invoke<void>("install_update"),
  /** 只能取消下载阶段，取消后回到 available */
  cancelUpdate: () => invoke<void>("cancel_update"),
  /** 在文件管理器中显示（PRD 7.3：plugin-opener 的 revealItemInDir） */
  revealInDir: (path: string) => revealItemInDir(path),
  /** 选择目录（PRD 7.3：plugin-dialog 的 open({ directory: true })）；取消时返回 null */
  pickDirectory: () => open({ directory: true, multiple: false }),
  /** 选择私钥文件（PRD 6.5）；取消时返回 null */
  pickFile: () => open({ directory: false, multiple: false }),
  /** 自绘窗口按钮（PRD 6.2，decorations: false） */
  minimizeWindow: () => getCurrentWindow().minimize(),
  toggleMaximizeWindow: () => getCurrentWindow().toggleMaximize(),
  closeWindow: () => getCurrentWindow().close(),
}

/** 把 invoke 的拒绝值规整为 IpcError。后端约定抛出 { id, params } */
export function toIpcError(err: unknown): IpcError {
  if (err && typeof err === "object" && "id" in err) {
    return err as IpcError
  }
  return { id: "internal", params: { message: String(err) } }
}
