// 唯一允许调用 invoke 的地方（PRD 7.3、7.8）
import { invoke } from "@tauri-apps/api/core"
import { open } from "@tauri-apps/plugin-dialog"
import { revealItemInDir } from "@tauri-apps/plugin-opener"

import type {
  ActivityItem,
  ActivityQuery,
  AddAgentTargetRequest,
  AddProjectRequest,
  Asset,
  AssetInput,
  CompilePreview,
  DeleteResult,
  EnvId,
  Environment,
  ImportHost,
  IpcError,
  Mode,
  Mount,
  MountRequest,
  ProjectInspection,
  SaveResult,
  Settings,
  SkillStatus,
  SshHostList,
  Target,
  UpdateTargetPatch,
} from "@/bindings"

export const ipc = {
  detectEnvironments: () => invoke<Environment[]>("detect_environments"),
  listSshHosts: (envId?: EnvId) =>
    invoke<SshHostList>("list_ssh_hosts", { envId }),
  listAssets: () => invoke<Asset[]>("list_assets"),
  saveAsset: (input: AssetInput) => invoke<SaveResult>("save_asset", { input }),
  deleteAsset: (id: string) => invoke<DeleteResult>("delete_asset", { id }),
  importHosts: (hosts: ImportHost[], probeAfter: boolean) =>
    invoke<Asset[]>("import_hosts", { hosts, probeAfter }),
  startProbe: (assetId: string) =>
    invoke<{ runId: string }>("start_probe", { assetId }),
  cancelProbe: (runId: string) => invoke<void>("cancel_probe", { runId }),
  applyProbe: (runId: string, changeIds: string[]) =>
    invoke<SaveResult>("apply_probe", { runId, changeIds }),
  previewCompile: (input: AssetInput, mode: Mode) =>
    invoke<CompilePreview>("preview_compile", { input, mode }),
  listSkills: () => invoke<SkillStatus[]>("list_skills"),
  listTargets: () => invoke<Target[]>("list_targets"),
  inspectProject: (path: string) =>
    invoke<ProjectInspection>("inspect_project", { path }),
  addProjectTarget: (req: AddProjectRequest) =>
    invoke<Target>("add_project_target", { req }),
  removeTarget: (id: string) => invoke<void>("remove_target", { id }),
  // 以下四个命令是 P3 的契约扩展（2026-10-29 用户确认），PRD 7.8 中没有
  updateTarget: (id: string, patch: UpdateTargetPatch) =>
    invoke<Target>("update_target", { id, patch }),
  addAgentTarget: (req: AddAgentTargetRequest) =>
    invoke<Target>("add_agent_target", { req }),
  unmountAll: () => invoke<void>("unmount_all"),
  /** 清空数据：卸载全部挂载、删除资产与目标、恢复默认设置 */
  resetData: () => invoke<void>("reset_data"),
  listMounts: () => invoke<Mount[]>("list_mounts"),
  mount: (req: MountRequest) => invoke<Mount>("mount", { req }),
  unmount: (mountId: string) => invoke<void>("unmount", { mountId }),
  setMountMode: (mountId: string, mode: Mode) =>
    invoke<Mount>("set_mount_mode", { mountId, mode }),
  checkMounts: () => invoke<Mount[]>("check_mounts"),
  repairMount: (mountId: string) => invoke<Mount>("repair_mount", { mountId }),
  listActivity: (q: ActivityQuery) =>
    invoke<ActivityItem[]>("list_activity", { q }),
  getSettings: () => invoke<Settings>("get_settings"),
  updateSettings: (patch: Partial<Settings>) =>
    invoke<Settings>("update_settings", { patch }),
  getProbeScript: () => invoke<string>("get_probe_script"),
  /** 在文件管理器中显示（PRD 7.3：plugin-opener 的 revealItemInDir） */
  revealInDir: (path: string) => revealItemInDir(path),
  /** 选择目录（PRD 7.3：plugin-dialog 的 open({ directory: true })）；取消时返回 null */
  pickDirectory: () => open({ directory: true, multiple: false }),
}

/** 把 invoke 的拒绝值规整为 IpcError。后端约定抛出 { id, params } */
export function toIpcError(err: unknown): IpcError {
  if (err && typeof err === "object" && "id" in err) {
    return err as IpcError
  }
  return { id: "internal", params: { message: String(err) } }
}
