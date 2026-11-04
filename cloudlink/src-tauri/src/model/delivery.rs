//! Agent 目标、列入与分发（PRD 3.4、4.5）

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::Detail;
use super::env::EnvId;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export, export_to = "delivery.ts")]
pub enum AgentId {
    ClaudeCode,
    Universal,
    Custom,
}

impl AgentId {
    pub fn as_str(self) -> &'static str {
        match self {
            AgentId::ClaudeCode => "claude-code",
            AgentId::Universal => "universal",
            AgentId::Custom => "custom",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "delivery.ts")]
pub struct Target {
    pub id: String,
    pub env_id: EnvId,
    pub agent: AgentId,
    pub agent_key: String,
    pub label: String,
    pub path: String,
    pub enabled: bool,
    pub detected: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export, export_to = "delivery.ts")]
pub enum InclusionReasonId {
    AgentOff,
    PasswordOnly,
    NotDefined,
    NotWritten,
    IncludeMissing,
    NoKeyInEnv,
    CliNotInstalled,
    CliNotLoggedIn,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "delivery.ts")]
pub struct Inclusion {
    pub asset_id: String,
    pub env_id: EnvId,
    pub agent_key: String,
    pub included: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub reason: Option<Detail<InclusionReasonId>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export, export_to = "delivery.ts")]
pub enum DeliveryStatus {
    Ok,
    Pending,
    Missing,
    Modified,
    Outdated,
    Conflict,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "delivery.ts")]
pub struct Delivery {
    pub id: String,
    pub target_id: String,
    pub env_id: EnvId,
    pub path: String,
    pub status: DeliveryStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub status_detail: Option<Detail<String>>,
    pub checked_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "delivery.ts")]
pub struct AddCustomTargetRequest {
    pub env_id: EnvId,
    pub label: String,
    pub path: String,
}
