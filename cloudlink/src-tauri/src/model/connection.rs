//! 测试连接与主机指纹（F-106、F-108）

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::asset::ConnectionInput;
use super::env::EnvId;
use super::probe::SshError;

#[derive(Clone, PartialEq, Serialize, Deserialize, TS)]
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

impl std::fmt::Debug for ConnectionTestRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ConnectionTestRequest")
            .field("asset_id", &self.asset_id)
            .field("connection", &self.connection)
            .field("password", &self.password.as_ref().map(|_| "[REDACTED]"))
            .field("env_id", &self.env_id)
            .finish()
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_debug_never_exposes_the_password() {
        let request = ConnectionTestRequest {
            asset_id: None,
            connection: ConnectionInput::Imported {
                ssh_alias: "fixture".into(),
            },
            password: Some("unique-fixture-password".into()),
            env_id: Some(EnvId::windows()),
        };
        let debug = format!("{request:?}");
        assert!(debug.contains("[REDACTED]"));
        assert!(!debug.contains("unique-fixture-password"));
    }
}
