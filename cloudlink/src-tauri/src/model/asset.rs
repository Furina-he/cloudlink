//! 资源（PRD 3.3）：服务器（SSH，`type: "vps"`）和云平台（CLI，`type: "cli"`）

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::env::EnvId;

/// 判别字段 `type` 的取值。两类资源各自带一个只接受固定字面量的标记，
/// 这样 `Asset` 用 untagged 反序列化时不会把一类误认成另一类
macro_rules! literal_tag {
    ($name:ident, $lit:literal) => {
        #[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
        pub enum $name {
            #[default]
            #[serde(rename = $lit)]
            Tag,
        }
    };
}
literal_tag!(VpsTag, "vps");
literal_tag!(CliTag, "cli");

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "asset.ts")]
pub enum AssetType {
    Vps,
    Cli,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "asset.ts")]
pub enum CliProvider {
    Cloudflare,
    Vercel,
    Oracle,
}

impl CliProvider {
    pub fn as_str(self) -> &'static str {
        match self {
            CliProvider::Cloudflare => "cloudflare",
            CliProvider::Vercel => "vercel",
            CliProvider::Oracle => "oracle",
        }
    }
    pub fn binary(self) -> CliBinary {
        match self {
            CliProvider::Cloudflare => CliBinary::Wrangler,
            CliProvider::Vercel => CliBinary::Vercel,
            CliProvider::Oracle => CliBinary::Oci,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "asset.ts")]
pub enum EnvTag {
    Prod,
    Staging,
    Dev,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "asset.ts")]
pub enum FieldSource {
    Manual,
    Probe,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "asset.ts")]
pub enum ProbeState {
    Never,
    Ok,
    Stale,
    Failed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export, export_to = "asset.ts")]
pub enum Mode {
    ReadOnly,
    Standard,
}

impl Mode {
    pub fn as_str(self) -> &'static str {
        match self {
            Mode::ReadOnly => "read-only",
            Mode::Standard => "standard",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "asset.ts")]
pub enum ConnectionSource {
    Managed,
    Imported,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "asset.ts")]
pub enum AuthMethod {
    Key,
    Agent,
    Password,
}

impl AuthMethod {
    pub fn as_str(self) -> &'static str {
        match self {
            AuthMethod::Key => "key",
            AuthMethod::Agent => "agent",
            AuthMethod::Password => "password",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "asset.ts")]
pub struct ResolvedConnection {
    pub hostname: String,
    pub user: String,
    pub port: u16,
    pub proxy_jump: Option<String>,
    pub resolved_at: String,
}

/// 按运行环境分别记录的私钥路径
pub type IdentityFiles = BTreeMap<EnvId, String>;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "asset.ts")]
pub struct AssetAuth {
    pub method: AuthMethod,
    #[ts(type = "Partial<Record<EnvId, string>>")]
    pub identity_file: IdentityFiles,
    pub generated_by_cloud_link: bool,
    pub password_saved: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "asset.ts")]
pub struct ConnectionVerified {
    pub ok: bool,
    pub at: String,
    pub env_ids: Vec<EnvId>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "asset.ts")]
pub struct AssetConnection {
    pub source: ConnectionSource,
    pub ssh_alias: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub host: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub port: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub user: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub auth: Option<AssetAuth>,
    // managed 时总是输出（可能为 null）；imported 时不输出
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "super::double_option"
    )]
    #[ts(optional, type = "string | null")]
    pub proxy_jump: Option<Option<String>>,
    pub defined_in: Vec<EnvId>,
    pub resolved: Option<ResolvedConnection>,
    pub verified: Option<ConnectionVerified>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "asset.ts")]
pub struct AssetAgent {
    pub agents: Vec<String>,
    pub mode: Mode,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "asset.ts")]
pub enum PanelType {
    #[serde(rename = "1panel")]
    OnePanel,
    Bt,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "asset.ts")]
pub struct PanelInfo {
    #[serde(rename = "type")]
    pub kind: PanelType,
    pub install_path: String,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "asset.ts")]
pub struct AssetFacts {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub os: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub kernel: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub arch: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub cpu_cores: Option<u32>,
    #[serde(rename = "memoryTotalMiB", default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub memory_total_mib: Option<u32>,
    #[serde(rename = "diskTotalGiB", default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub disk_total_gib: Option<u32>,
    // 没有探测过时不输出；探测过、没有面板时为 null
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "super::double_option"
    )]
    #[ts(optional, type = "PanelInfo | null")]
    pub panel: Option<Option<PanelInfo>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "asset.ts")]
pub struct AssetPath {
    pub key: String,
    pub label: String,
    pub path: String,
    pub source: FieldSource,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "asset.ts")]
pub enum Proto {
    Tcp,
    Udp,
}

impl Proto {
    pub fn as_str(self) -> &'static str {
        match self {
            Proto::Tcp => "tcp",
            Proto::Udp => "udp",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "asset.ts")]
pub struct PortMapping {
    pub host_ip: String,
    pub host_port: u16,
    pub container_port: u16,
    pub proto: Proto,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "asset.ts")]
pub enum ServiceKind {
    Docker,
    Systemd,
}

impl ServiceKind {
    pub fn as_str(self) -> &'static str {
        match self {
            ServiceKind::Docker => "docker",
            ServiceKind::Systemd => "systemd",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "asset.ts")]
pub struct Service {
    pub kind: ServiceKind,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub image: Option<String>,
    pub ports: Vec<PortMapping>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub role: Option<String>,
    pub critical: bool,
    pub source: FieldSource,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub last_seen_at: Option<String>,
    pub missing: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub sanitized: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "asset.ts")]
pub struct ListeningPort {
    pub addr: String,
    pub port: u16,
    pub proto: Proto,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "asset.ts")]
pub struct GuardrailRule {
    pub id: String,
    pub text: String,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "asset.ts")]
pub struct Guardrails {
    pub rules: Vec<GuardrailRule>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "asset.ts")]
pub struct ExportFlags {
    pub resolved_connection: bool,
    pub listening_ports: bool,
    pub image: bool,
}

impl Default for ExportFlags {
    /// F-105：解析后的连接信息和监听端口默认关，镜像版本默认开
    fn default() -> Self {
        ExportFlags {
            resolved_connection: false,
            listening_ports: false,
            image: true,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "asset.ts")]
pub struct AssetProbeInfo {
    pub last_run_id: Option<String>,
    pub last_success_at: Option<String>,
    pub status: ProbeState,
}

impl Default for AssetProbeInfo {
    fn default() -> Self {
        AssetProbeInfo {
            last_run_id: None,
            last_success_at: None,
            status: ProbeState::Never,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "asset.ts")]
pub struct ServerAsset {
    #[serde(rename = "type")]
    #[ts(rename = "type", type = "\"vps\"")]
    pub tag: VpsTag,
    pub id: String,
    pub name: String,
    pub env_tag: EnvTag,
    pub summary: String,
    pub agent: AssetAgent,
    pub guardrails: Guardrails,
    pub notes: String,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub provider: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub region: Option<String>,
    pub tags: Vec<String>,
    pub connection: AssetConnection,
    pub facts: AssetFacts,
    pub paths: Vec<AssetPath>,
    pub services: Vec<Service>,
    pub served_hostnames: Vec<String>,
    pub listening_ports: Vec<ListeningPort>,
    pub export: ExportFlags,
    pub probe: AssetProbeInfo,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "asset.ts")]
pub struct CliEnvState {
    pub installed: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub path: Option<String>,
    pub authenticated: bool,
    pub expired: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub account: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub accounts: Option<Vec<String>>,
    pub checked_at: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "asset.ts")]
pub enum CliScopeKind {
    Zone,
    Worker,
    Pages,
    Project,
    Instance,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "asset.ts")]
pub struct CliScopeItem {
    pub id: String,
    pub kind: CliScopeKind,
    pub name: String,
    pub selected: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub linked_asset_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub address: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "asset.ts")]
pub enum CliBinary {
    Wrangler,
    Vercel,
    Oci,
}

impl CliBinary {
    pub fn as_str(self) -> &'static str {
        match self {
            CliBinary::Wrangler => "wrangler",
            CliBinary::Vercel => "vercel",
            CliBinary::Oci => "oci",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "asset.ts")]
pub struct CliInfo {
    pub binary: CliBinary,
    #[ts(type = "Partial<Record<EnvId, CliEnvState>>")]
    pub env_states: BTreeMap<EnvId, CliEnvState>,
    pub scope: Vec<CliScopeItem>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "asset.ts")]
pub struct CliAsset {
    #[serde(rename = "type")]
    #[ts(rename = "type", type = "\"cli\"")]
    pub tag: CliTag,
    pub id: String,
    pub name: String,
    pub env_tag: EnvTag,
    pub summary: String,
    pub agent: AssetAgent,
    pub guardrails: Guardrails,
    pub notes: String,
    pub created_at: String,
    pub updated_at: String,
    pub cli_provider: CliProvider,
    pub handle: String,
    pub account: Option<String>,
    pub cli: CliInfo,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(untagged)]
#[ts(export, export_to = "asset.ts")]
#[allow(
    clippy::large_enum_variant,
    reason = "数据模型，按引用传递；装箱会让 serde 与 ts-rs 的结构变复杂"
)]
pub enum Asset {
    Vps(ServerAsset),
    Cli(CliAsset),
}

impl Asset {
    pub fn id(&self) -> &str {
        match self {
            Asset::Vps(a) => &a.id,
            Asset::Cli(a) => &a.id,
        }
    }
    pub fn kind(&self) -> AssetType {
        match self {
            Asset::Vps(_) => AssetType::Vps,
            Asset::Cli(_) => AssetType::Cli,
        }
    }
    /// Skill 里的名字：服务器取别名，云平台取标识（前端 `handleOf`）
    pub fn handle(&self) -> &str {
        match self {
            Asset::Vps(a) => &a.connection.ssh_alias,
            Asset::Cli(a) => &a.handle,
        }
    }
    pub fn name(&self) -> &str {
        match self {
            Asset::Vps(a) => &a.name,
            Asset::Cli(a) => &a.name,
        }
    }
    pub fn env_tag(&self) -> EnvTag {
        match self {
            Asset::Vps(a) => a.env_tag,
            Asset::Cli(a) => a.env_tag,
        }
    }
    pub fn summary(&self) -> &str {
        match self {
            Asset::Vps(a) => &a.summary,
            Asset::Cli(a) => &a.summary,
        }
    }
    pub fn agent(&self) -> &AssetAgent {
        match self {
            Asset::Vps(a) => &a.agent,
            Asset::Cli(a) => &a.agent,
        }
    }
    pub fn agent_mut(&mut self) -> &mut AssetAgent {
        match self {
            Asset::Vps(a) => &mut a.agent,
            Asset::Cli(a) => &mut a.agent,
        }
    }
    pub fn guardrails(&self) -> &Guardrails {
        match self {
            Asset::Vps(a) => &a.guardrails,
            Asset::Cli(a) => &a.guardrails,
        }
    }
    pub fn notes(&self) -> &str {
        match self {
            Asset::Vps(a) => &a.notes,
            Asset::Cli(a) => &a.notes,
        }
    }
    pub fn created_at(&self) -> &str {
        match self {
            Asset::Vps(a) => &a.created_at,
            Asset::Cli(a) => &a.created_at,
        }
    }
    pub fn as_server(&self) -> Option<&ServerAsset> {
        match self {
            Asset::Vps(a) => Some(a),
            Asset::Cli(_) => None,
        }
    }
    pub fn as_cli(&self) -> Option<&CliAsset> {
        match self {
            Asset::Cli(a) => Some(a),
            Asset::Vps(_) => None,
        }
    }
}

/// 录入的连接（save_asset）。imported 只有别名，连接信息由用户的 ssh config 维护
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "source", rename_all = "camelCase", rename_all_fields = "camelCase")]
#[ts(export, export_to = "asset.ts")]
pub enum ConnectionInput {
    Managed {
        ssh_alias: String,
        host: String,
        port: u16,
        user: String,
        auth: AuthInput,
        proxy_jump: Option<String>,
        defined_in: Vec<EnvId>,
    },
    Imported {
        ssh_alias: String,
    },
}

impl ConnectionInput {
    pub fn ssh_alias(&self) -> &str {
        match self {
            ConnectionInput::Managed { ssh_alias, .. } | ConnectionInput::Imported { ssh_alias } => ssh_alias,
        }
    }
}

/// `Pick<AssetAuth, "method" | "identityFile">`
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "asset.ts")]
pub struct AuthInput {
    pub method: AuthMethod,
    #[ts(type = "Partial<Record<EnvId, string>>")]
    pub identity_file: IdentityFiles,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "asset.ts")]
pub struct ServerAssetInput {
    #[serde(rename = "type")]
    #[ts(rename = "type", type = "\"vps\"")]
    pub tag: VpsTag,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub id: Option<String>,
    pub name: String,
    pub env_tag: EnvTag,
    pub summary: String,
    pub guardrails: Guardrails,
    pub notes: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub provider: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub region: Option<String>,
    pub tags: Vec<String>,
    pub connection: ConnectionInput,
    pub facts: AssetFacts,
    pub paths: Vec<AssetPath>,
    pub services: Vec<Service>,
    pub served_hostnames: Vec<String>,
    pub listening_ports: Vec<ListeningPort>,
    pub export: ExportFlags,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub test_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "asset.ts")]
pub struct CliAssetInput {
    #[serde(rename = "type")]
    #[ts(rename = "type", type = "\"cli\"")]
    pub tag: CliTag,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub id: Option<String>,
    pub name: String,
    pub env_tag: EnvTag,
    pub summary: String,
    pub guardrails: Guardrails,
    pub notes: String,
    pub cli_provider: CliProvider,
    pub account: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub scope: Option<Vec<CliScopeItem>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(untagged)]
#[ts(export, export_to = "asset.ts")]
#[allow(clippy::large_enum_variant, reason = "同 Asset")]
pub enum AssetInput {
    Vps(ServerAssetInput),
    Cli(CliAssetInput),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "asset.ts")]
pub struct ImportHost {
    pub alias: String,
    pub defined_in: Vec<EnvId>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn untagged_asset_respects_type_literal() {
        let cli = serde_json::json!({
            "type": "cli", "id": "ast_1", "name": "Cloudflare", "envTag": "prod", "summary": "",
            "agent": { "agents": [], "mode": "read-only" }, "guardrails": { "rules": [] }, "notes": "",
            "createdAt": "2026-11-01T00:00:00Z", "updatedAt": "2026-11-01T00:00:00Z",
            "cliProvider": "cloudflare", "handle": "cloudflare", "account": null,
            "cli": { "binary": "wrangler", "envStates": {}, "scope": [] }
        });
        let a: Asset = serde_json::from_value(cli.clone()).unwrap();
        assert_eq!(a.kind(), AssetType::Cli);
        assert_eq!(serde_json::to_value(&a).unwrap(), cli);
        let mut wrong = cli;
        wrong["type"] = "vps".into();
        assert!(serde_json::from_value::<Asset>(wrong).is_err());
    }

    #[test]
    fn connection_input_is_tagged_by_source() {
        let v = serde_json::json!({ "source": "imported", "sshAlias": "sg-db" });
        let c: ConnectionInput = serde_json::from_value(v).unwrap();
        assert_eq!(c.ssh_alias(), "sg-db");
    }
}
