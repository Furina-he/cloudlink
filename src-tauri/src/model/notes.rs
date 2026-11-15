//! Agent 笔记收件箱（F-308）。

use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "notes.ts")]
pub enum AgentNoteFlag {
    Secret,
    Injection,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "notes.ts")]
pub enum AgentNoteStatus {
    Pending,
    Merged,
    Dismissed,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "notes.ts")]
pub struct AgentNote {
    pub id: String,
    pub asset_id: String,
    pub text: String,
    pub written_at: String,
    pub flags: Vec<AgentNoteFlag>,
    pub status: AgentNoteStatus,
}
