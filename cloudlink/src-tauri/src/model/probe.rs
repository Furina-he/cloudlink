//! ssh 错误分类（PRD 8.3）与探测（F-103）

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::Params;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export, export_to = "probe.ts")]
pub enum ProbeStep {
    ResolveAlias,
    Connect,
    CollectSystem,
    CollectServices,
    CollectPorts,
    Merge,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export, export_to = "probe.ts")]
pub enum ProbeStepStatus {
    Running,
    Done,
    Error,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export, export_to = "probe.ts")]
pub enum SshErrorId {
    AuthFailed,
    PasswordRejected,
    HostKeyUnknown,
    HostKeyChanged,
    ResolveFailed,
    Timeout,
    ConnectionRefused,
    NeedsInteraction,
    KeyPermissions,
    KeyNotFound,
    Partial,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "probe.ts")]
pub struct SshError {
    pub id: SshErrorId,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "Record<string, string | number>")]
    pub params: Option<Params>,
}

impl SshError {
    pub fn new(id: SshErrorId, params: Params) -> Self {
        SshError {
            id,
            params: (!params.is_empty()).then_some(params),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export, export_to = "probe.ts")]
pub enum ProbeChangeKind {
    Added,
    Changed,
    Missing,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "probe.ts")]
pub enum ProbeChangeField {
    Service,
    Os,
    Kernel,
    ListeningPorts,
    Facts,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "probe.ts")]
pub struct ProbeChange {
    pub id: String,
    pub kind: ProbeChangeKind,
    pub field: ProbeChangeField,
    pub label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub before: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub after: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "probe.ts")]
pub struct ProbeProgressEvent {
    pub run_id: String,
    pub asset_id: String,
    pub step: ProbeStep,
    pub status: ProbeStepStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub ms: Option<u32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export, export_to = "probe.ts")]
pub enum ProbeRunStatus {
    Running,
    Ok,
    Failed,
    Cancelled,
}

/// `probe://finished`：status 不会是 running
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export, export_to = "probe.ts")]
pub enum ProbeFinishedStatus {
    Ok,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "probe.ts")]
pub struct ProbeFinishedEvent {
    pub run_id: String,
    pub asset_id: String,
    pub status: ProbeFinishedStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub error: Option<SshError>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub applied: Option<Vec<ProbeChange>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub held: Option<Vec<ProbeChange>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub duration_ms: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub finished_at: Option<String>,
}
