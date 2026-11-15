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
    /// 第一次见到，等用户核对
    New,
    /// 与已保存的记录不符，阻断
    Changed,
    /// 用户刚核对并信任，已写入 known_hosts
    Trusted,
    /// known_hosts 里这个地址已有同一把公钥（用户以前用 ssh 确认过），直接沿用
    Adopted,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "connection.ts")]
pub struct HostKeyInfo {
    pub fingerprint: String,
    pub known: HostKeyKnown,
    /// Adopted：known_hosts 里记录这把公钥的名字，例如 `203.0.113.10` 或 `[203.0.113.10]:2222`
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub known_as: Option<String>,
}

/// 私钥文件预检的结论（F-108「检测常见问题」）
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export, export_to = "connection.ts")]
pub enum KeyCheckStatus {
    Ok,
    Missing,
    /// 其他用户也能读取（Windows ACL 或 Linux 权限过宽），OpenSSH 会拒绝使用
    Permissions,
    /// 设有密码短语，Agent 无法输入
    Passphrase,
    /// PuTTY 格式（.ppk），OpenSSH 不认
    Putty,
    /// 选成了公钥（.pub）
    PublicKey,
    Invalid,
    /// 没能检查（找不到 ssh-keygen 等），不下结论
    Unchecked,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "connection.ts")]
pub struct KeyCheck {
    pub status: KeyCheckStatus,
    /// 例如 `ED25519`
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub key_type: Option<String>,
    /// 公钥的 SHA256 指纹
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub fingerprint: Option<String>,
}

impl KeyCheck {
    pub fn status(status: KeyCheckStatus) -> Self {
        KeyCheck {
            status,
            key_type: None,
            fingerprint: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "connection.ts")]
pub struct KeyCheckRequest {
    pub env_id: EnvId,
    /// 该运行环境里的写法
    pub path: String,
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
