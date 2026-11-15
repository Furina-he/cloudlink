//! 编译、预览与 Lint（PRD 5.4、7.8）

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::Params;
use super::asset::AssetInput;
use super::env::EnvId;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export, export_to = "compile.ts")]
pub enum LintId {
    DescriptionTooLong,
    SecretDetected,
    ExportDisabledField,
    MissingReference,
    BodyTooLong,
    ProdStandardNoGuardrails,
    ProbeStale,
    SuspectedInjection,
    PublishFailed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "compile.ts")]
pub enum LintLevel {
    Error,
    Warning,
    Info,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "compile.ts")]
pub struct LintItem {
    pub id: LintId,
    pub level: LintLevel,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub asset_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "Record<string, string | number>")]
    pub params: Option<Params>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub file: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub line: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "compile.ts")]
pub struct CompileBudget {
    pub description_chars: u32,
    pub description_limit: u32,
    pub body_lines: u32,
    pub body_line_limit: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "compile.ts")]
pub struct CompiledFile {
    pub path: String,
    pub content: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "compile.ts")]
pub struct CompilePreview {
    pub env_id: EnvId,
    pub agent_key: String,
    pub files: Vec<CompiledFile>,
    pub budget: CompileBudget,
    pub lint: Vec<LintItem>,
    pub blocked: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "compile.ts")]
pub struct CompileStatus {
    pub env_id: EnvId,
    pub agent_key: String,
    pub blocked: bool,
    pub errors: u32,
    pub warnings: u32,
    pub compiled_at: Option<String>,
    pub lint: Vec<LintItem>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "compile.ts")]
pub struct Convention {
    pub id: String,
    pub text: String,
}

/// 用户补充或改写的一条关系（一句英文，写进「How they fit together」）
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "compile.ts")]
pub struct RelationNote {
    pub id: String,
    pub text: String,
    /// 改写自哪一条自动关系；那一条同时记在 `hidden_relations` 里
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub replaces: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "compile.ts")]
pub struct SkillConfig {
    /// 2026-11-07 之前的整段关系文本。读取时转成一条 `relation_notes`，之后不再写入
    #[serde(default, skip_serializing_if = "String::is_empty")]
    #[ts(skip)]
    pub relationships: String,
    /// 用户补充或改写的关系
    #[serde(default)]
    pub relation_notes: Vec<RelationNote>,
    /// 用户隐藏的自动关系 id
    #[serde(default)]
    pub hidden_relations: Vec<String>,
    pub conventions: Vec<Convention>,
}

impl SkillConfig {
    /// 旧版整段文本并入用户写的关系（id 固定，重复读取结果相同）
    pub fn migrated(mut self) -> Self {
        let legacy = std::mem::take(&mut self.relationships);
        let legacy = legacy.trim();
        if !legacy.is_empty() && !self.relation_notes.iter().any(|n| n.id == LEGACY_RELATION_ID) {
            self.relation_notes.insert(
                0,
                RelationNote {
                    id: LEGACY_RELATION_ID.into(),
                    text: legacy.to_string(),
                    replaces: None,
                },
            );
        }
        self
    }
}

pub const LEGACY_RELATION_ID: &str = "rel_legacy";

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export, export_to = "compile.ts")]
pub enum RelationKind {
    /// 经跳板机连接
    ProxyJump,
    /// 同一台机器上的多个别名
    SameHost,
    /// 域名解析到某台服务器
    Dns,
    /// 云主机实例就是某台服务器
    Instance,
    /// 服务器上的站点属于云平台管理的域名
    Site,
}

/// CloudLink 从资源数据推出的一条关系
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "compile.ts")]
pub struct Relation {
    /// 由资源 id 组成，资源不变时保持不变
    pub id: String,
    pub kind: RelationKind,
    pub asset_ids: Vec<String>,
    /// 界面文案用的参数（别名、域名、实例名等）
    #[ts(type = "Record<string, string | number>")]
    pub params: Params,
    /// 写进 SKILL.md 的一句英文
    pub text: String,
    /// 用户隐藏了这一条
    pub hidden: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "compile.ts")]
pub struct PreviewRequest {
    pub env_id: EnvId,
    pub agent_key: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub asset: Option<AssetInput>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub config: Option<SkillConfig>,
}
