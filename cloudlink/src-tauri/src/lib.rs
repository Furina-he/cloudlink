//! CloudLink 后端（PRD 第八章）

pub mod compile;
pub mod db;
pub mod env;
pub mod error;
pub mod fsx;
pub mod model;
pub mod paths;
pub mod proc;
pub mod secret;
pub mod ssh;
pub mod time;

#[cfg(test)]
pub mod testkit;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // 单实例插件必须最先注册；askpass 辅助进程在 main() 第一行就已经退出，不会走到这里
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            use tauri::Manager;
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_log::Builder::default()
                .level(if cfg!(debug_assertions) {
                    log::LevelFilter::Info
                } else {
                    log::LevelFilter::Warn
                })
                .build(),
        )
        .run(tauri::generate_context!())
        .expect("error while running CloudLink");
}

/// 带前缀的 ULID，例如 `ast_01JB3Q8Z6W…`
pub fn new_id(prefix: &str) -> String {
    format!("{prefix}_{}", ulid::Ulid::generate())
}
