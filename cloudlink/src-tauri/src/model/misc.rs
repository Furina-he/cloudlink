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
    NoteHasSecret,
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
