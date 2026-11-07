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
    /// 通用目录 `~/.agents/skills`：Codex、Cursor、Gemini CLI 等大多数 Agent 都读这里（4.5）
    Universal,
    Trae,
    TraeCn,
    Kiro,
    Continue,
    Custom,
}

impl AgentId {
    /// CloudLink 自己维护的目标，按显示顺序
    pub const BUILTIN: [AgentId; 6] = [
        AgentId::ClaudeCode,
        AgentId::Universal,
        AgentId::Trae,
        AgentId::TraeCn,
        AgentId::Kiro,
        AgentId::Continue,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            AgentId::ClaudeCode => "claude-code",
            AgentId::Universal => "universal",
            AgentId::Trae => "trae",
            AgentId::TraeCn => "trae-cn",
            AgentId::Kiro => "kiro",
            AgentId::Continue => "continue",
            AgentId::Custom => "custom",
        }
    }

    /// 内置目标的全局 skills 目录（相对家目录）
    pub fn skills_dir(self) -> Option<[&'static str; 2]> {
        Some(match self {
            AgentId::ClaudeCode => [".claude", "skills"],
            AgentId::Universal => [".agents", "skills"],
            AgentId::Trae => [".trae", "skills"],
            AgentId::TraeCn => [".trae-cn", "skills"],
            AgentId::Kiro => [".kiro", "skills"],
            AgentId::Continue => [".continue", "skills"],
            AgentId::Custom => return None,
        })
    }

    /// 存进数据库的名称；界面按 AgentId 取文案，不用它
    pub fn default_label(self) -> &'static str {
        match self {
            AgentId::ClaudeCode => "Claude Code",
            AgentId::Universal => "Agent Skills",
            AgentId::Trae => "Trae",
            AgentId::TraeCn => "Trae CN",
            AgentId::Kiro => "Kiro",
            AgentId::Continue => "Continue",
            AgentId::Custom => "Custom",
        }
    }

    /// Claude Code 和通用目录总是列出；只认自己目录的 Agent 检测到以后才加
    pub fn always_listed(self) -> bool {
        matches!(self, AgentId::ClaudeCode | AgentId::Universal)
    }
}

/// CloudLink 认得的 Agent 品牌（2026-11-07）。检测依据和读取的目录见 `deliver::agents`
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export, export_to = "delivery.ts")]
pub enum AgentBrand {
    ClaudeCode,
    Codex,
    Cursor,
    Windsurf,
    GeminiCli,
    Copilot,
    Opencode,
    Cline,
    RooCode,
    KiloCode,
    Goose,
    Amp,
    QwenCode,
    Droid,
    Augment,
    Crush,
    Junie,
    Warp,
    Trae,
    TraeCn,
    Kiro,
    Continue,
}

/// 某个运行环境里检测到的一个 Agent，和它读取的目标（第一个是它主要使用的那个）
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "delivery.ts")]
pub struct DetectedAgent {
    pub brand: AgentBrand,
    pub reads: Vec<AgentId>,
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
    Unverified,
    EnvUnavailable,
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
