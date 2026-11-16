//! Claude Code 护栏与操作记录（F-306、F-307）。

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::Detail;
use super::delivery::AgentBrand;
use super::env::EnvId;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export, export_to = "guard.ts")]
pub enum GuardState {
    Active,
    NotInstalled,
    Broken,
    Unavailable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export, export_to = "guard.ts")]
pub enum GuardDetailId {
    EntryMissing,
    SelfTestFailed,
    HooksDisabled,
    SettingsInvalid,
    InteropDisabled,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "guard.ts")]
pub struct GuardPlanned {
    pub entry: String,
    pub backup_path: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "guard.ts")]
pub struct GuardStatus {
    pub env_id: EnvId,
    pub state: GuardState,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub detail: Option<Detail<GuardDetailId>>,
    pub settings_path: String,
    pub planned: GuardPlanned,
    pub denied_today: u32,
    pub checked_at: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "guard.ts")]
pub enum OperationDecision {
    Allowed,
    Denied,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export, export_to = "guard.ts")]
pub enum GuardReasonId {
    ReadOnly,
    CredentialRead,
    VolumeDelete,
    DataDelete,
    HostReboot,
    Firewall,
    SshConfig,
    CriticalService,
    FileTransfer,
    Interactive,
    CliEnvExport,
    CliWrite,
    CliDestroy,
    CliAccount,
    CliScope,
    Unparsed,
    ExecutionChannel,
    #[serde(rename = "runtime-protected", alias = "runtime-protection")]
    RuntimeProtection,
    CliIdentity,
    GithubRepoDelete,
    #[serde(rename = "github-default-force", alias = "github-default-branch")]
    GithubDefaultBranch,
    GithubDangerous,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "guard.ts")]
pub enum OperationSource {
    Hook,
    Runner,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export, export_to = "guard.ts")]
pub enum InvocationProvenance {
    Hook,
    SelfReported,
    Unknown,
}

/// Display metadata, never an authorization input. Missing historical metadata stays unknown.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export, export_to = "guard.ts")]
pub struct InvocationSource {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub agent: Option<AgentBrand>,
    pub provenance: InvocationProvenance,
}

impl InvocationSource {
    pub fn valid(self) -> bool {
        matches!(
            (self.provenance, self.agent),
            (InvocationProvenance::Hook, Some(AgentBrand::ClaudeCode))
                | (InvocationProvenance::SelfReported, Some(_))
                | (InvocationProvenance::Unknown, None)
        )
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "guard.ts")]
pub struct Operation {
    pub id: String,
    pub asset_id: String,
    pub env_id: EnvId,
    pub at: String,
    pub session_id: String,
    pub cwd: String,
    pub command: String,
    pub decision: OperationDecision,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub reason_id: Option<GuardReasonId>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub source: Option<OperationSource>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub caller: Option<InvocationSource>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub checked: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub execution_state: Option<super::execution::ExecutionState>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub request_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub epoch: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub exit_code: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub duration_ms: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "guard.ts")]
pub struct OperationQuery {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub asset_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub before: Option<String>,
    pub limit: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "guard.ts")]
pub struct GuardRuleGroup {
    pub id: GuardReasonId,
    pub examples: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "guard.ts")]
pub struct GuardRules {
    pub read_only_allow: Vec<String>,
    pub standard_deny: Vec<GuardRuleGroup>,
    pub always_deny: Vec<GuardRuleGroup>,
}
