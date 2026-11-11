//! CloudLink 后端（PRD 第八章）

pub mod cli;
pub mod compile;
pub mod db;
pub mod deliver;
mod desktop;
pub mod env;
pub mod error;
pub mod fsx;
pub mod guard;
pub mod ipc;
pub mod model;
pub mod notes;
pub mod operations;
pub mod paths;
pub mod probe;
pub mod proc;
pub mod secret;
pub mod ssh;
pub mod time;
pub mod tray;
pub mod update;

#[cfg(test)]
pub mod testkit;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    use std::sync::Arc;
    use tauri::Manager;
    use tauri_plugin_log::{Target, TargetKind};

    let paths = paths::Paths::from_env().expect("invalid CloudLink paths");
    let mut context = tauri::generate_context!();
    desktop::configure(context.config_mut(), &paths).expect("could not prepare CloudLink desktop storage");
    let log_dir = paths.log_dir();

    let mut builder = tauri::Builder::default();
    if !paths.isolated {
        // 单实例插件必须最先注册；askpass 辅助进程在 main() 第一行就已经退出，不会走到这里
        // 隔离实例不转发给另一个数据根的窗口，也不读取它的插件状态。
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            tray::show_main(app);
        }));
        // 开机启动只写当前用户的启动项；隔离实例不注册，不碰真实系统设置
        builder = builder.plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ));
    }
    let app = builder
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        // F-406：只在 Rust 侧调用，capability 不给前端授予 updater:* 权限
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            tauri_plugin_log::Builder::default()
                .targets([
                    Target::new(TargetKind::Stdout),
                    Target::new(TargetKind::Folder {
                        path: log_dir,
                        file_name: None,
                    }),
                ])
                .level(if cfg!(debug_assertions) {
                    log::LevelFilter::Info
                } else {
                    log::LevelFilter::Warn
                })
                .build(),
        )
        .setup(move |app| {
            let events = Arc::new(ipc::TauriEvents(app.handle().clone()));
            let isolated = paths.isolated;
            let backend = ipc::Backend::open(paths, events)?;
            backend.start_updates(
                &app.package_info().version.to_string(),
                Arc::new(update::PluginSource::new(app.handle().clone(), isolated)),
            );
            if !isolated {
                use tauri_plugin_autostart::ManagerExt;
                let handle = app.handle().clone();
                backend.set_autostart_hook(Box::new(move |on| {
                    let launcher = handle.autolaunch();
                    if on { launcher.enable() } else { launcher.disable() }.is_ok()
                }));
            }
            app.manage(backend);
            app.manage(Arc::new(tray::TrayState::default()));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ipc::commands::detect_environments,
            ipc::commands::list_ssh_hosts,
            ipc::commands::list_assets,
            ipc::commands::save_asset,
            ipc::commands::delete_asset,
            ipc::commands::import_hosts,
            ipc::commands::test_connection,
            ipc::commands::cancel_connection_test,
            ipc::commands::trust_host_key,
            ipc::commands::set_password,
            ipc::commands::convert_to_key_auth,
            ipc::commands::copy_key_to_wsl,
            ipc::commands::copy_key_to_ssh_dir,
            ipc::commands::check_key,
            ipc::commands::list_relations,
            ipc::commands::get_ssh_config_status,
            ipc::commands::add_ssh_include,
            ipc::commands::set_distribute,
            ipc::commands::set_mode,
            ipc::commands::detect_cli_environment,
            ipc::commands::refresh_cli_scope,
            ipc::commands::set_cli_scope,
            ipc::commands::open_env_terminal,
            ipc::commands::start_probe,
            ipc::commands::cancel_probe,
            ipc::commands::confirm_probe_items,
            ipc::commands::undo_probe,
            ipc::commands::get_skill_config,
            ipc::commands::save_skill_config,
            ipc::commands::preview_skill,
            ipc::commands::get_compile_status,
            ipc::commands::list_targets,
            ipc::commands::set_target_enabled,
            ipc::commands::add_custom_target,
            ipc::commands::remove_custom_target,
            ipc::commands::list_inclusions,
            ipc::commands::list_deliveries,
            ipc::commands::check_deliveries,
            ipc::commands::take_over_target,
            ipc::commands::undo_backup,
            ipc::commands::remove_all_deliveries,
            ipc::commands::get_guard_status,
            ipc::commands::install_guard,
            ipc::commands::remove_guard,
            ipc::commands::get_guard_rules,
            ipc::commands::list_operations,
            ipc::commands::list_notes,
            ipc::commands::merge_notes,
            ipc::commands::dismiss_notes,
            ipc::commands::list_activity,
            ipc::commands::get_settings,
            ipc::commands::update_settings,
            ipc::commands::get_probe_script,
            ipc::commands::reset_data,
            ipc::commands::get_update_status,
            ipc::commands::install_update,
            ipc::commands::all_read_only,
            ipc::commands::set_tray_copy,
        ])
        .build(context)
        .expect("error while running CloudLink");
    app.run(|handle, event| {
        // F-407：关闭窗口时留在托盘（设置里可改为退出）。托盘还没建好时照常关闭，免得窗口找不回来
        if let tauri::RunEvent::WindowEvent {
            label,
            event: tauri::WindowEvent::CloseRequested { api, .. },
            ..
        } = &event
            && label == "main"
            && handle.tray_by_id("cloudlink").is_some()
            && handle
                .try_state::<Arc<ipc::Backend>>()
                .and_then(|b| b.get_settings().ok())
                .is_some_and(|s| s.close_to_tray)
        {
            api.prevent_close();
            if let Some(w) = handle.get_webview_window("main") {
                let _ = w.hide();
            }
            return;
        }
        if matches!(
            event,
            tauri::RunEvent::ExitRequested { .. }
                | tauri::RunEvent::Exit
                | tauri::RunEvent::WindowEvent {
                    event: tauri::WindowEvent::CloseRequested { .. },
                    ..
                }
        ) && let Some(backend) = handle.try_state::<Arc<ipc::Backend>>()
        {
            backend.cancel_all_jobs();
        }
    });
}

/// 带前缀的 ULID，例如 `ast_01JB3Q8Z6W…`
pub fn new_id(prefix: &str) -> String {
    format!("{prefix}_{}", ulid::Ulid::generate())
}
