//! 活动日志、设置、保存结果与 IPC 错误（PRD 4.4、6.7、7.8）

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::Params;
use super::asset::{Asset, Mode};
use super::compile::CompileStatus;
use super::env::EnvId;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export, export_to = "misc.ts")]
pub enum ActivityKind {
    Connection,
    Probe,
    Compile,
    Deliver,
    Remove,
    Repair,
    SshConfig,
    Guard,
    Mode,
    Cli,
    Note,
    AgentOp,
    Update,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export, export_to = "misc.ts")]
pub enum ActivityMessageId {
    TestOk,
    TestFailed,
    ProbeUpdated,
    ProbeHeld,
    ProbeNoChanges,
    ProbeFailed,
    ProbeUndone,
    CompileOk,
    CompileBlocked,
    DeliverOk,
    RemoveOk,
    RepairOk,
    /// F-309：被改动的副本已备份并恢复，`params.target`、`params.env`
    CopyRestored,
    /// F-309：外来的同名 Skill 已移进备份并由 CloudLink 接管
    CopyTakenOver,
    /// F-309：备份已写回，这个目标的自动同步暂停（目标停用）
    BackupUndone,
    SshConfigWritten,
    SshIncludeAdded,
    GuardInstalled,
    GuardRemoved,
    ModeChanged,
    CliDetected,
    CliScopeUpdated,
    NotesMerged,
    NotesDismissed,
    AgentOpAllowed,
    AgentOpDenied,
    /// F-406 AC5：开始安装更新、CloudLink 即将退出前写入
    UpdateInstalling,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "misc.ts")]
pub struct ActivityItem {
    pub id: String,
    pub kind: ActivityKind,
    pub at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub asset_id: Option<String>,
    pub message_id: ActivityMessageId,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "Record<string, string | number>")]
    pub params: Option<Params>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub duration_ms: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub detail: Option<String>,
    pub ok: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "misc.ts")]
pub struct ActivityQuery {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub before: Option<String>,
    pub limit: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub kinds: Option<Vec<ActivityKind>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub asset_id: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "misc.ts")]
pub enum Theme {
    System,
    Light,
    Dark,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "misc.ts")]
pub enum OutputLanguage {
    #[default]
    En,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "misc.ts")]
pub struct EnvSetting {
    pub id: EnvId,
    pub enabled: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "misc.ts")]
pub struct Settings {
    pub theme: Theme,
    pub output_language: OutputLanguage,
    pub environments: Vec<EnvSetting>,
    pub body_line_limit: u32,
    pub write_snapshot_time: bool,
    pub default_mode: Mode,
    pub probe_timeout_sec: u32,
    pub windows_ssh_path: String,
    pub data_dir: String,
    pub log_dir: String,
    pub ssh_include_asked: Vec<EnvId>,
    /// F-406：定时检查更新，默认开启（旧数据由迁移 v4 补上）
    #[serde(default = "enabled_by_default")]
    pub auto_check_updates: bool,
    /// F-407：关闭窗口时留在托盘（默认），false 为退出
    #[serde(default = "enabled_by_default")]
    pub close_to_tray: bool,
    /// 开机时启动（tauri-plugin-autostart，写当前用户的启动项）
    #[serde(default)]
    pub launch_at_login: bool,
}

fn enabled_by_default() -> bool {
    true
}

/// Windows 自带 OpenSSH 的绝对路径（PRD 8.3 规则 1）
pub const DEFAULT_WINDOWS_SSH: &str = r"C:\Windows\System32\OpenSSH\ssh.exe";

impl Settings {
    /// 默认设置；数据目录和日志目录由调用方按 `Paths` 填入
    pub fn defaults(data_dir: String, log_dir: String) -> Self {
        Settings {
            theme: Theme::System,
            output_language: OutputLanguage::En,
            environments: Vec::new(),
            body_line_limit: 100,
            write_snapshot_time: true,
            default_mode: Mode::Standard,
            probe_timeout_sec: 30,
            windows_ssh_path: DEFAULT_WINDOWS_SSH.to_string(),
            data_dir,
            log_dir,
            ssh_include_asked: Vec::new(),
            auto_check_updates: true,
            close_to_tray: true,
            launch_at_login: false,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "misc.ts")]
pub struct SaveResult {
    pub asset: Asset,
    pub statuses: Vec<CompileStatus>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "misc.ts")]
pub struct DeleteResult {
    pub statuses: Vec<CompileStatus>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export, export_to = "misc.ts")]
pub enum DistributeBlockReason {
    Unverified,
    Failed,
    PasswordOnly,
    CliNotReady,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export, export_to = "misc.ts")]
pub enum IpcErrorId {
    NotFound,
    AliasTaken,
    AliasConflict,
    CannotDistribute,
    PasswordMissing,
    /// 未传新密码时，连接目标与已保存的记录不一致：不会把旧密码发往新目标（CC-SWITCH 二.4）
    PasswordTargetChanged,
    ConnectionFailed,
    SettingsInvalid,
    InteropDisabled,
    TargetExists,
    SourceMissing,
    CompileBlocked,
    CliAccountUnavailable,
    CliScopePermission,
    CliScopeFailed,
    CliCommandUnsupported,
    TerminalCommandInvalid,
    NoteHasSecret,
    ResetIncomplete,
    /// F-406 AC4：有进行中的任务，`params.task` 为 connection、probe、cli 或 publish，`params.name` 说明是哪一项
    UpdateBusy,
    UpdateDownloadFailed,
    UpdateSignatureInvalid,
    UpdateInstallFailed,
    Internal,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "misc.ts")]
pub struct IpcError {
    pub id: IpcErrorId,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "Record<string, string | number>")]
    pub params: Option<Params>,
}

/// F-406：发现新版本后在后台下载并校验，下好（ready）才在顶栏提醒。
/// idle 时界面不显示任何更新元素（没有新版本、尚未检查或已关闭检查）；available 只有带着失败原因时才提醒
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "misc.ts")]
pub enum UpdateState {
    Idle,
    Available,
    Downloading,
    Ready,
    Installing,
}

/// `update://changed` 推送的完整快照（PRD 7.8）
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "misc.ts")]
pub struct UpdateStatus {
    pub state: UpdateState,
    pub current_version: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub date: Option<String>,
    /// 来自 latest.json，不在签名范围内：界面按不可信纯文本展示
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub notes: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub downloaded: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub total: Option<u64>,
    /// 上次安装没有完成的原因，此时 state 回到 available
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub error: Option<IpcError>,
}

impl UpdateStatus {
    pub fn idle(current_version: &str) -> Self {
        UpdateStatus {
            state: UpdateState::Idle,
            current_version: current_version.into(),
            version: None,
            date: None,
            notes: None,
            downloaded: None,
            total: None,
            error: None,
        }
    }
}
