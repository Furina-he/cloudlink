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

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "compile.ts")]
pub struct SkillConfig {
    pub relationships: String,
    pub conventions: Vec<Convention>,
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
