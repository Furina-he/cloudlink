use serde::Deserialize;

use crate::model::asset::{CliProvider, Mode};
use crate::model::env::EnvId;
use crate::model::misc::{EnvSetting, OutputLanguage, Theme};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeleteOptions {
    pub remove_generated_key: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CliRequest {
    pub provider: CliProvider,
    pub asset_id: Option<String>,
    pub account: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CopyKeyRequest {
    pub source: String,
    pub env_id: EnvId,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TerminalRequest {
    pub env_id: EnvId,
    pub command: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MergeNote {
    pub id: String,
    pub text: Option<String>,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SettingsPatch {
    pub theme: Option<Theme>,
    pub output_language: Option<OutputLanguage>,
    pub environments: Option<Vec<EnvSetting>>,
    pub body_line_limit: Option<u32>,
    pub write_snapshot_time: Option<bool>,
    pub default_mode: Option<Mode>,
    pub probe_timeout_sec: Option<u32>,
    pub windows_ssh_path: Option<String>,
    pub data_dir: Option<String>,
    pub log_dir: Option<String>,
    pub ssh_include_asked: Option<Vec<EnvId>>,
    pub auto_check_updates: Option<bool>,
    pub close_to_tray: Option<bool>,
    pub launch_at_login: Option<bool>,
}
