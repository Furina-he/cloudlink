//! IPC entry points. Arguments retain Tauri's default camelCase mapping.
//! All backend work runs outside the async event loop, including database reads.

use std::collections::BTreeMap;
use std::sync::Arc;

use serde::Serialize;
use tauri::State;

use super::backend::Backend;
use super::requests::{CliRequest, CopyKeyRequest, DeleteOptions, MergeNote, SettingsPatch, TerminalRequest};
use crate::error::{AppError, Result};
use crate::model::asset::{Asset, AssetInput, CliEnvState, CliScopeItem, ImportHost, Mode};
use crate::model::compile::{CompilePreview, CompileStatus, PreviewRequest, SkillConfig};
use crate::model::connection::ConnectionTestRequest;
use crate::model::delivery::{AddCustomTargetRequest, Delivery, Inclusion, Target};
use crate::model::env::{EnvId, Environment, SshConfigStatus, SshHostList};
use crate::model::guard::{GuardRules, GuardStatus, Operation, OperationQuery};
use crate::model::misc::{ActivityItem, ActivityQuery, DeleteResult, SaveResult, Settings, UpdateStatus};
use crate::model::notes::AgentNote;

/// 冷启动时先等后台的启动工作做完（`startup.rs`）：环境检测、Agent 目标、第一次对账和修改锁都在它后面。
/// 等待发生在阻塞线程池里，不占 async 运行时的工作线程
async fn blocking<T, F>(state: State<'_, Arc<Backend>>, work: F) -> Result<T>
where
    T: Send + 'static,
    F: FnOnce(&Arc<Backend>) -> Result<T> + Send + 'static,
{
    run(state, true, work).await
}

/// 首屏要用、只读数据库或静态内容的命令不等启动工作；它们不碰运行环境，也不拿修改锁
async fn early<T, F>(state: State<'_, Arc<Backend>>, work: F) -> Result<T>
where
    T: Send + 'static,
    F: FnOnce(&Arc<Backend>) -> Result<T> + Send + 'static,
{
    run(state, false, work).await
}

async fn run<T, F>(state: State<'_, Arc<Backend>>, wait: bool, work: F) -> Result<T>
where
    T: Send + 'static,
    F: FnOnce(&Arc<Backend>) -> Result<T> + Send + 'static,
{
    let backend = Arc::clone(state.inner());
    tokio::task::spawn_blocking(move || {
        if wait {
            backend.wait_for_startup();
        }
        work(&backend)
    })
    .await
    .map_err(|_| AppError::internal("IPC background task unavailable"))?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionTestStarted {
    test_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeStarted {
    run_id: String,
}

#[derive(Serialize)]
pub struct CopiedKey {
    path: String,
}

#[tauri::command]
pub async fn detect_environments(state: State<'_, Arc<Backend>>) -> Result<Vec<Environment>> {
    blocking(state, |backend| backend.detect_environments()).await
}

#[tauri::command]
pub async fn list_ssh_hosts(state: State<'_, Arc<Backend>>, env_id: Option<EnvId>) -> Result<SshHostList> {
    blocking(state, move |backend| backend.list_ssh_hosts(env_id.as_ref())).await
}

#[tauri::command]
pub async fn list_assets(state: State<'_, Arc<Backend>>) -> Result<Vec<Asset>> {
    early(state, |backend| backend.list_assets()).await
}

#[tauri::command]
pub async fn save_asset(state: State<'_, Arc<Backend>>, input: AssetInput) -> Result<SaveResult> {
    blocking(state, move |backend| backend.save_asset(input)).await
}

#[tauri::command]
pub async fn delete_asset(state: State<'_, Arc<Backend>>, id: String, opts: DeleteOptions) -> Result<DeleteResult> {
    blocking(state, move |backend| {
        backend.delete_asset(&id, opts.remove_generated_key)
    })
    .await
}

#[tauri::command]
pub async fn import_hosts(
    state: State<'_, Arc<Backend>>,
    hosts: Vec<ImportHost>,
    probe_after: bool,
) -> Result<Vec<Asset>> {
    blocking(state, move |backend| backend.import_hosts(hosts, probe_after)).await
}

#[tauri::command]
pub async fn test_connection(
    state: State<'_, Arc<Backend>>,
    req: ConnectionTestRequest,
) -> Result<ConnectionTestStarted> {
    blocking(state, move |backend| {
        backend.start_test(req).map(|test_id| ConnectionTestStarted { test_id })
    })
    .await
}

#[tauri::command]
pub async fn cancel_connection_test(state: State<'_, Arc<Backend>>, test_id: String) -> Result<()> {
    blocking(state, move |backend| backend.cancel_connection_test(&test_id)).await
}

#[tauri::command]
pub async fn trust_host_key(state: State<'_, Arc<Backend>>, test_id: String, fingerprint: String) -> Result<()> {
    blocking(state, move |backend| backend.trust_host_key(&test_id, &fingerprint)).await
}

#[tauri::command]
pub async fn set_password(state: State<'_, Arc<Backend>>, asset_id: String, password: Option<String>) -> Result<()> {
    blocking(state, move |backend| backend.set_password(&asset_id, password)).await
}

#[tauri::command]
pub async fn convert_to_key_auth(state: State<'_, Arc<Backend>>, asset_id: String) -> Result<Asset> {
    blocking(state, move |backend| backend.convert_to_key_auth(&asset_id)).await
}

#[tauri::command]
pub async fn copy_key_to_wsl(state: State<'_, Arc<Backend>>, req: CopyKeyRequest) -> Result<CopiedKey> {
    blocking(state, move |backend| {
        backend
            .copy_key_to_wsl(&req.source, &req.env_id)
            .map(|path| CopiedKey { path })
    })
    .await
}

#[tauri::command]
pub async fn get_ssh_config_status(state: State<'_, Arc<Backend>>) -> Result<Vec<SshConfigStatus>> {
    blocking(state, |backend| backend.get_ssh_config_status()).await
}

#[tauri::command]
pub async fn add_ssh_include(state: State<'_, Arc<Backend>>, env_id: EnvId) -> Result<SshConfigStatus> {
    blocking(state, move |backend| backend.add_ssh_include(&env_id)).await
}

#[tauri::command]
pub async fn set_distribute(
    state: State<'_, Arc<Backend>>,
    asset_id: String,
    agent_key: String,
    on: bool,
) -> Result<Vec<Inclusion>> {
    blocking(state, move |backend| backend.set_distribute(&asset_id, &agent_key, on)).await
}

#[tauri::command]
pub async fn set_mode(state: State<'_, Arc<Backend>>, asset_id: String, mode: Mode) -> Result<SaveResult> {
    blocking(state, move |backend| backend.set_mode(&asset_id, mode)).await
}

#[tauri::command]
pub async fn detect_cli_environment(
    state: State<'_, Arc<Backend>>,
    req: CliRequest,
) -> Result<BTreeMap<EnvId, CliEnvState>> {
    blocking(state, move |backend| backend.detect_cli_environment(req)).await
}

#[tauri::command]
pub async fn refresh_cli_scope(state: State<'_, Arc<Backend>>, req: CliRequest) -> Result<Vec<CliScopeItem>> {
    blocking(state, move |backend| backend.refresh_cli_scope(req)).await
}

#[tauri::command]
pub async fn set_cli_scope(
    state: State<'_, Arc<Backend>>,
    asset_id: String,
    selected_ids: Vec<String>,
) -> Result<SaveResult> {
    blocking(state, move |backend| backend.set_cli_scope(&asset_id, &selected_ids)).await
}

#[tauri::command]
pub async fn open_env_terminal(state: State<'_, Arc<Backend>>, req: TerminalRequest) -> Result<()> {
    blocking(state, move |backend| {
        backend.cli.open_terminal(&backend.context(&req.env_id)?, &req.command)
    })
    .await
}

#[tauri::command]
pub async fn start_probe(state: State<'_, Arc<Backend>>, asset_id: String) -> Result<ProbeStarted> {
    blocking(state, move |backend| {
        backend.start_probe(&asset_id).map(|run_id| ProbeStarted { run_id })
    })
    .await
}

#[tauri::command]
pub async fn cancel_probe(state: State<'_, Arc<Backend>>, run_id: String) -> Result<()> {
    blocking(state, move |backend| backend.cancel_probe(&run_id)).await
}

#[tauri::command]
pub async fn confirm_probe_items(
    state: State<'_, Arc<Backend>>,
    run_id: String,
    change_ids: Vec<String>,
) -> Result<SaveResult> {
    blocking(state, move |backend| backend.confirm_probe_items(&run_id, &change_ids)).await
}

#[tauri::command]
pub async fn undo_probe(state: State<'_, Arc<Backend>>, run_id: String) -> Result<SaveResult> {
    blocking(state, move |backend| backend.undo_probe(&run_id)).await
}

#[tauri::command]
pub async fn get_skill_config(state: State<'_, Arc<Backend>>) -> Result<SkillConfig> {
    early(state, |backend| backend.get_skill_config()).await
}

#[tauri::command]
pub async fn save_skill_config(state: State<'_, Arc<Backend>>, input: SkillConfig) -> Result<Vec<CompileStatus>> {
    blocking(state, move |backend| backend.save_skill_config(input)).await
}

#[tauri::command]
pub async fn preview_skill(state: State<'_, Arc<Backend>>, req: PreviewRequest) -> Result<CompilePreview> {
    blocking(state, move |backend| backend.preview_skill(req)).await
}

#[tauri::command]
pub async fn get_compile_status(state: State<'_, Arc<Backend>>) -> Result<Vec<CompileStatus>> {
    blocking(state, |backend| backend.get_compile_status()).await
}

#[tauri::command]
pub async fn list_targets(state: State<'_, Arc<Backend>>) -> Result<Vec<Target>> {
    blocking(state, |backend| backend.list_targets()).await
}

#[tauri::command]
pub async fn set_target_enabled(state: State<'_, Arc<Backend>>, id: String, enabled: bool) -> Result<Target> {
    blocking(state, move |backend| backend.set_target_enabled(&id, enabled)).await
}

#[tauri::command]
pub async fn add_custom_target(state: State<'_, Arc<Backend>>, req: AddCustomTargetRequest) -> Result<Target> {
    blocking(state, move |backend| backend.add_custom_target(req)).await
}

#[tauri::command]
pub async fn remove_custom_target(state: State<'_, Arc<Backend>>, id: String) -> Result<()> {
    blocking(state, move |backend| backend.remove_custom_target(&id)).await
}

#[tauri::command]
pub async fn list_inclusions(state: State<'_, Arc<Backend>>) -> Result<Vec<Inclusion>> {
    blocking(state, |backend| backend.list_inclusions()).await
}

#[tauri::command]
pub async fn list_deliveries(state: State<'_, Arc<Backend>>) -> Result<Vec<Delivery>> {
    blocking(state, |backend| backend.list_deliveries()).await
}

#[tauri::command]
pub async fn check_deliveries(state: State<'_, Arc<Backend>>) -> Result<Vec<Delivery>> {
    blocking(state, |backend| backend.check_deliveries()).await
}

#[tauri::command]
pub async fn repair_delivery(state: State<'_, Arc<Backend>>, id: String) -> Result<Delivery> {
    blocking(state, move |backend| backend.repair_delivery(&id)).await
}

#[tauri::command]
pub async fn remove_all_deliveries(state: State<'_, Arc<Backend>>) -> Result<()> {
    blocking(state, |backend| backend.remove_all_deliveries()).await
}

#[tauri::command]
pub async fn list_activity(state: State<'_, Arc<Backend>>, q: ActivityQuery) -> Result<Vec<ActivityItem>> {
    blocking(state, move |backend| backend.list_activity(q)).await
}

#[tauri::command]
pub async fn get_settings(state: State<'_, Arc<Backend>>) -> Result<Settings> {
    blocking(state, |backend| backend.get_settings()).await
}

#[tauri::command]
pub async fn update_settings(state: State<'_, Arc<Backend>>, patch: SettingsPatch) -> Result<Settings> {
    blocking(state, move |backend| backend.update_settings(patch)).await
}

#[tauri::command]
pub async fn get_probe_script(state: State<'_, Arc<Backend>>) -> Result<&'static str> {
    early(state, |_| Ok(crate::probe::SCRIPT)).await
}

#[tauri::command]
pub async fn get_guard_status(state: State<'_, Arc<Backend>>) -> Result<Vec<GuardStatus>> {
    blocking(state, |backend| backend.get_guard_status()).await
}

#[tauri::command]
pub async fn install_guard(state: State<'_, Arc<Backend>>, env_id: EnvId) -> Result<GuardStatus> {
    blocking(state, move |backend| backend.install_guard(&env_id)).await
}

#[tauri::command]
pub async fn remove_guard(state: State<'_, Arc<Backend>>, env_id: EnvId) -> Result<GuardStatus> {
    blocking(state, move |backend| backend.remove_guard(&env_id)).await
}

#[tauri::command]
pub async fn get_guard_rules(state: State<'_, Arc<Backend>>) -> Result<GuardRules> {
    early(state, |_| Ok(serde_json::from_value(guard_rules::rules())?)).await
}

#[tauri::command]
pub async fn list_operations(state: State<'_, Arc<Backend>>, q: OperationQuery) -> Result<Vec<Operation>> {
    blocking(state, move |backend| backend.list_operations(q)).await
}

#[tauri::command]
pub async fn list_notes(state: State<'_, Arc<Backend>>, asset_id: Option<String>) -> Result<Vec<AgentNote>> {
    blocking(state, move |backend| backend.list_notes(asset_id.as_deref())).await
}

#[tauri::command]
pub async fn merge_notes(state: State<'_, Arc<Backend>>, items: Vec<MergeNote>) -> Result<SaveResult> {
    blocking(state, move |backend| backend.merge_notes(items)).await
}

#[tauri::command]
pub async fn dismiss_notes(state: State<'_, Arc<Backend>>, ids: Vec<String>) -> Result<()> {
    blocking(state, move |backend| backend.dismiss_notes(&ids)).await
}

#[tauri::command]
pub async fn reset_data(state: State<'_, Arc<Backend>>) -> Result<()> {
    blocking(state, |backend| backend.reset_data()).await
}

#[tauri::command]
pub async fn get_update_status(state: State<'_, Arc<Backend>>) -> Result<UpdateStatus> {
    early(state, |backend| Ok(backend.update_status())).await
}

#[tauri::command]
pub async fn install_update(state: State<'_, Arc<Backend>>) -> Result<()> {
    blocking(state, |backend| backend.install_update()).await
}

#[tauri::command]
pub async fn cancel_update(state: State<'_, Arc<Backend>>) -> Result<()> {
    early(state, |backend| {
        backend.cancel_update();
        Ok(())
    })
    .await
}
