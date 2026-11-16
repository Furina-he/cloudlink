//! P8：审批视图只含展示信息；许可、原始 argv 和可重放输入不进入持久化契约。

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::env::EnvId;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export, export_to = "execution.ts")]
pub enum RuntimeState {
    Starting,
    Active,
    Stopping,
    Stopped,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "execution.ts")]
pub struct RuntimeStatus {
    pub state: RuntimeState,
    pub epoch: String,
    pub revision: u64,
    pub checked_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub reason_id: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export, export_to = "execution.ts")]
pub enum ExecutionState {
    Waiting,
    Approved,
    Dispatching,
    Running,
    Denied,
    Rejected,
    Expired,
    Cancelled,
    Succeeded,
    Failed,
    Unknown,
}

impl ExecutionState {
    pub fn unstarted(self) -> bool {
        matches!(self, Self::Waiting | Self::Approved | Self::Dispatching)
    }

    pub fn terminal(self) -> bool {
        matches!(
            self,
            Self::Denied
                | Self::Rejected
                | Self::Expired
                | Self::Cancelled
                | Self::Succeeded
                | Self::Failed
                | Self::Unknown
        )
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "execution.ts")]
pub enum ExecutionKind {
    Exec,
    Put,
    Get,
    Discover,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "execution.ts")]
pub struct ExecutionRequest {
    pub request_id: String,
    pub epoch: String,
    pub revision: u64,
    pub policy_revision: u64,
    pub asset_id: String,
    pub env_id: EnvId,
    pub kind: ExecutionKind,
    // Legacy channel field; caller carries bounded display-only provenance, never authorization.
    #[ts(type = "\"unidentified\"")]
    pub source: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub caller: Option<super::guard::InvocationSource>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub session_id: Option<String>,
    // Complete redacted display command, never an executable input.
    pub command: String,
    pub cwd: String,
    pub state: ExecutionState,
    pub checked: bool,
    pub approval_required: bool,
    pub created_at: String,
    pub expires_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub reason_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub exit_code: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub duration_ms: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "execution.ts")]
pub struct ExecutionChangedEvent {
    pub epoch: String,
    pub revision: u64,
    pub requests: Vec<ExecutionRequest>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export, export_to = "execution.ts")]
pub enum ExecutionResponse {
    AllowOnce,
    Deny,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export, export_to = "execution.ts")]
pub struct RespondExecutionRequest {
    pub request_id: String,
    pub expected_revision: u64,
    pub decision: ExecutionResponse,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export, export_to = "execution.ts")]
pub struct CancelExecutionRequest {
    pub request_id: String,
    pub expected_revision: u64,
}
