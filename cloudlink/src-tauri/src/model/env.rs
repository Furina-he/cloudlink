//! 运行环境（PRD 3.4）与 ssh config 的 Host 列表（F-102、F-107）

use std::fmt;

use serde::{Deserialize, Deserializer, Serialize, Serializer};
use ts_rs::TS;

/// `windows`、`macos`、`linux` 或 `wsl:<发行版>`
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, TS)]
#[ts(
    export,
    export_to = "env.ts",
    type = "\"windows\" | \"macos\" | \"linux\" | `wsl:${string}`"
)]
pub struct EnvId(String);

impl EnvId {
    pub const WINDOWS: &'static str = "windows";

    pub fn windows() -> Self {
        EnvId(Self::WINDOWS.to_string())
    }
    pub fn wsl(distro: &str) -> Self {
        EnvId(format!("wsl:{distro}"))
    }
    /// 校验后构造；不认识的值返回 None
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "windows" | "macos" | "linux" => Some(EnvId(s.to_string())),
            _ => {
                let distro = s.strip_prefix("wsl:")?;
                valid_distro(distro).then(|| EnvId(s.to_string()))
            }
        }
    }
    pub fn as_str(&self) -> &str {
        &self.0
    }
    pub fn is_windows(&self) -> bool {
        self.0 == Self::WINDOWS
    }
    pub fn wsl_distro(&self) -> Option<&str> {
        self.0.strip_prefix("wsl:")
    }
    /// 编译产物目录名：`windows`、`wsl-Ubuntu-24.04`（PRD 3.5）
    pub fn dir_name(&self) -> String {
        match self.wsl_distro() {
            Some(d) => format!("wsl-{d}"),
            None => self.0.clone(),
        }
    }
}

/// 发行版名称只允许 `wsl.exe` 实际会给出的字符，杜绝路径穿越和参数注入
pub fn valid_distro(d: &str) -> bool {
    !d.is_empty()
        && d.len() <= 64
        && !d.starts_with('-')
        && !d.starts_with('.')
        && d.chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
}

impl fmt::Display for EnvId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl Serialize for EnvId {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.0)
    }
}

impl<'de> Deserialize<'de> for EnvId {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let s = String::deserialize(d)?;
        EnvId::parse(&s).ok_or_else(|| serde::de::Error::custom(format!("invalid env id: {s}")))
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "env.ts")]
pub struct ManagedSshConfig {
    pub path: String,
    pub included: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "env.ts")]
pub struct Environment {
    pub id: EnvId,
    pub label: String,
    // 该环境自己的写法，例如 `C:\Users\me` 或 `/home/me`
    pub home: String,
    pub ssh_config_path: String,
    pub available: bool,
    pub managed_ssh_config: ManagedSshConfig,
    pub ssh_agent_keys: Option<u32>,
    /// 这个环境里检测到的 Agent（2026-11-07）
    pub agents: Vec<super::delivery::DetectedAgent>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "env.ts")]
pub struct SshHost {
    pub alias: String,
    pub defined_in: Vec<EnvId>,
    pub hostname: Option<String>,
    pub user: Option<String>,
    pub port: Option<u16>,
    pub imported: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "env.ts")]
pub struct ScannedConfig {
    pub env_id: EnvId,
    pub path: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "env.ts")]
pub struct SshHostList {
    pub hosts: Vec<SshHost>,
    pub scanned: Vec<ScannedConfig>,
    pub skipped_patterns: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "env.ts")]
pub struct SshConfigStatus {
    pub env_id: EnvId,
    pub managed_path: String,
    pub user_config_path: String,
    pub included: bool,
    pub include_line: String,
    pub known_hosts_path: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn env_id_parses_only_known_shapes() {
        assert!(EnvId::parse("windows").is_some());
        assert_eq!(EnvId::parse("wsl:Ubuntu-24.04").unwrap().dir_name(), "wsl-Ubuntu-24.04");
        assert!(EnvId::parse("wsl:").is_none());
        assert!(EnvId::parse("wsl:../x").is_none());
        assert!(EnvId::parse("wsl:-d").is_none());
        assert!(EnvId::parse("solaris").is_none());
    }
}
