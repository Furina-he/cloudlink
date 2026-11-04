//! 测试连接与主机指纹（F-106、F-108）

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::asset::ConnectionInput;
use super::env::EnvId;
use super::probe::SshError;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "connection.ts")]
pub struct ConnectionTestRequest {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub asset_id: Option<String>,
    pub connection: ConnectionInput,
    // 只在这次请求里经过后端，不进日志；Debug 输出由 `secret::SecretString` 负责隐藏
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub password: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub env_id: Option<EnvId>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export, export_to = "connection.ts")]
pub enum ConnectionTestStatus {
    Ok,
    Failed,
    Cancelled,
    HostKey,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "connection.ts")]
pub enum HostKeyKnown {
    New,
    Changed,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "connection.ts")]
pub struct HostKeyInfo {
    pub fingerprint: String,
    pub known: HostKeyKnown,
}

/// `connection://tested` 的载荷
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "connection.ts")]
pub struct ConnectionTestedEvent {
    pub test_id: String,
    pub status: ConnectionTestStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub ms: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub remote_os: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub error: Option<SshError>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub host_key: Option<HostKeyInfo>,
}
