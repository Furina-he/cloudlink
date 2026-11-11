//! 系统托盘（F-407，PRD 6.10）。菜单文字由前端经 `set_tray_copy` 传入（文案只在 copy.ts），
//! 收到之前不创建托盘。资源、档位或护栏变化时重建菜单。
//!
//! 原生菜单不能排版也不能给文字上色（2026-11-10）：档位、数量放进 `\t` 后面的右侧列对齐；
//! 生产 + 标准运维的资源前面放一个琥珀圆点图标（F-109 AC1）。

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager};
use ts_rs::TS;

use crate::ipc::Backend;
use crate::model::asset::{Asset, Mode};

const TRAY_ID: &str = "cloudlink";

/// 琥珀圆点的颜色：托盘菜单跟随系统深浅色，取 DESIGN.md amber 与 amber-dark 之间的
/// oklch(0.62 0.15 60)，在浅色（#F9F9F9）和深色（#2B2B2B）菜单底上对比度都在 3.5 以上
const AMBER: [u8; 3] = [198, 108, 0];
/// muda 在 Windows 上把菜单图标画成 16×16 的位图，直接给这个尺寸免得缩放发糊
const DOT_SIZE: u32 = 16;
/// 圆点半径（像素），和界面里 6–7px 的状态点差不多大
const DOT_RADIUS: f32 = 3.5;

/// Windows 菜单里 `\t` 后面的文字右对齐成一列（快捷键那一列）
fn columns(left: &str, right: &str) -> String {
    format!("{left}\t{right}")
}

/// 菜单里资源的排序键：服务器在前，云平台和代码托管在后；组内生产在前，再按标识（菜单上显示的就是标识）
fn order_key(cli: bool, production: bool, handle: &str) -> (bool, bool, String) {
    (cli, !production, handle.to_ascii_lowercase())
}

/// 16×16 的抗锯齿圆点，RGBA
fn amber_dot_rgba() -> Vec<u8> {
    let center = DOT_SIZE as f32 / 2.0;
    let mut rgba = Vec::with_capacity((DOT_SIZE * DOT_SIZE * 4) as usize);
    for y in 0..DOT_SIZE {
        for x in 0..DOT_SIZE {
            let dx = x as f32 + 0.5 - center;
            let dy = y as f32 + 0.5 - center;
            let alpha = (DOT_RADIUS + 0.5 - (dx * dx + dy * dy).sqrt()).clamp(0.0, 1.0);
            rgba.extend_from_slice(&[AMBER[0], AMBER[1], AMBER[2], (alpha * 255.0).round() as u8]);
        }
    }
    rgba
}

/// 托盘菜单的全部文字。`{n}` 由 Rust 换成数量
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "misc.ts")]
pub struct TrayCopy {
    pub tooltip: String,
    pub guard_on: String,
    pub guard_off: String,
    pub modes_header: String,
    pub read_only: String,
    pub standard: String,
    pub all_read_only: String,
    /// 「{n} 项在标准运维」，跟在「生产资源全部切回只读」右边
    pub prod_in_standard: String,
    pub open: String,
    pub quit: String,
    /// 系统通知标题与正文「{n} 项生产资源已切回只读」
    pub notify_title: String,
    pub notify_all_read_only: String,
}

#[derive(Default)]
pub struct TrayState {
    copy: Mutex<Option<TrayCopy>>,
    guard_on: AtomicBool,
    refreshing: AtomicBool,
    pending: AtomicBool,
}

/// `tray://confirm-mode`：生产资源要切到标准运维，主窗口打开确认（AC1）
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "misc.ts")]
pub struct TrayConfirmMode {
    pub asset_id: String,
}

pub fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

/// 后端事件经过这里：护栏状态直接从事件内容取，其余变化触发一次菜单重建
pub fn on_event(app: &AppHandle, event: &str, payload: &serde_json::Value) {
    let Some(state) = app.try_state::<Arc<TrayState>>() else {
        return;
    };
    if event == "guard://changed" {
        let on = payload.get("statuses").and_then(|v| v.as_array()).is_some_and(|items| {
            items
                .iter()
                .any(|s| s.get("state").and_then(|v| v.as_str()) == Some("active"))
        });
        state.guard_on.store(on, Ordering::SeqCst);
    }
    if matches!(
        event,
        "guard://changed" | "compile://finished" | "deliveries://changed" | "activity://new"
    ) {
        schedule_refresh(app);
    }
}

/// 合并连续的重建请求；读数据库在后台线程里做，不占用发事件的锁
pub fn schedule_refresh(app: &AppHandle) {
    let Some(state) = app.try_state::<Arc<TrayState>>() else {
        return;
    };
    let state = Arc::clone(&state);
    if state.refreshing.swap(true, Ordering::SeqCst) {
        state.pending.store(true, Ordering::SeqCst);
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        loop {
            state.pending.store(false, Ordering::SeqCst);
            if let Err(error) = refresh(&app, &state) {
                log::warn!("CloudLink tray could not be updated: {error}");
            }
            if !state.pending.load(Ordering::SeqCst) {
                break;
            }
        }
        state.refreshing.store(false, Ordering::SeqCst);
    });
}

pub fn set_copy(app: &AppHandle, copy: TrayCopy) {
    if let Some(state) = app.try_state::<Arc<TrayState>>() {
        if let Ok(mut slot) = state.copy.lock() {
            *slot = Some(copy);
        }
        schedule_refresh(app);
    }
}

fn refresh(app: &AppHandle, state: &TrayState) -> tauri::Result<()> {
    let Some(copy) = state.copy.lock().ok().and_then(|c| c.clone()) else {
        return Ok(());
    };
    let Some(backend) = app.try_state::<Arc<Backend>>() else {
        return Ok(());
    };
    let mut assets = backend.list_assets().unwrap_or_default();
    assets.sort_by_cached_key(|a| order_key(matches!(a, Asset::Cli(_)), a.production(), a.handle()));
    let prod_standard = assets
        .iter()
        .filter(|a| a.production() && a.agent().mode == Mode::Standard)
        .count();

    let guard = if state.guard_on.load(Ordering::SeqCst) {
        &copy.guard_on
    } else {
        &copy.guard_off
    };
    let menu = Menu::new(app)?;
    menu.append(&MenuItem::with_id(
        app,
        "status",
        columns("CloudLink", guard),
        false,
        None::<&str>,
    )?)?;
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    if !assets.is_empty() {
        menu.append(&MenuItem::with_id(
            app,
            "modes",
            &copy.modes_header,
            false,
            None::<&str>,
        )?)?;
        for asset in &assets {
            let mode = asset.agent().mode;
            let label = columns(
                asset.handle(),
                if mode == Mode::Standard {
                    &copy.standard
                } else {
                    &copy.read_only
                },
            );
            let id = asset.id();
            let sub = Submenu::with_items(
                app,
                label,
                true,
                &[
                    &CheckMenuItem::with_id(
                        app,
                        format!("mode:read-only:{id}"),
                        &copy.read_only,
                        true,
                        mode == Mode::ReadOnly,
                        None::<&str>,
                    )?,
                    &CheckMenuItem::with_id(
                        app,
                        format!("mode:standard:{id}"),
                        &copy.standard,
                        true,
                        mode == Mode::Standard,
                        None::<&str>,
                    )?,
                ],
            )?;
            if asset.production() && mode == Mode::Standard {
                sub.set_icon(Some(tauri::image::Image::new_owned(
                    amber_dot_rgba(),
                    DOT_SIZE,
                    DOT_SIZE,
                )))?;
            }
            menu.append(&sub)?;
        }
        menu.append(&PredefinedMenuItem::separator(app)?)?;
        let all_label = if prod_standard > 0 {
            columns(
                &copy.all_read_only,
                &copy.prod_in_standard.replace("{n}", &prod_standard.to_string()),
            )
        } else {
            copy.all_read_only.clone()
        };
        menu.append(&MenuItem::with_id(
            app,
            "all-read-only",
            all_label,
            prod_standard > 0,
            None::<&str>,
        )?)?;
        menu.append(&PredefinedMenuItem::separator(app)?)?;
    }
    menu.append(&MenuItem::with_id(app, "open", &copy.open, true, None::<&str>)?)?;
    menu.append(&MenuItem::with_id(app, "quit", &copy.quit, true, None::<&str>)?)?;

    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        tray.set_menu(Some(menu))?;
        tray.set_tooltip(Some(&copy.tooltip))?;
    } else {
        let mut builder = TrayIconBuilder::with_id(TRAY_ID)
            .menu(&menu)
            .tooltip(&copy.tooltip)
            .show_menu_on_left_click(false)
            .on_menu_event(|app, event| on_menu(app, event.id().as_ref()))
            .on_tray_icon_event(|tray, event| {
                if let TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } = event
                {
                    show_main(tray.app_handle());
                }
            });
        if let Some(icon) = app.default_window_icon() {
            builder = builder.icon(icon.clone());
        }
        builder.build(app)?;
    }
    Ok(())
}

fn on_menu(app: &AppHandle, id: &str) {
    match id {
        "open" => show_main(app),
        "quit" => app.exit(0),
        "all-read-only" => {
            let app = app.clone();
            tauri::async_runtime::spawn_blocking(move || all_read_only(&app));
        }
        _ => {
            let Some(rest) = id.strip_prefix("mode:") else { return };
            let Some((mode, asset_id)) = rest.split_once(':') else {
                return;
            };
            let mode = if mode == "standard" {
                Mode::Standard
            } else {
                Mode::ReadOnly
            };
            let app = app.clone();
            let asset_id = asset_id.to_string();
            tauri::async_runtime::spawn_blocking(move || set_mode(&app, &asset_id, mode));
        }
    }
}

fn set_mode(app: &AppHandle, asset_id: &str, mode: Mode) {
    let Some(backend) = app.try_state::<Arc<Backend>>() else {
        return;
    };
    let production = backend
        .list_assets()
        .ok()
        .and_then(|assets| assets.into_iter().find(|a| a.id() == asset_id))
        .map(|a| a.production());
    match production {
        None => {}
        // AC1：托盘里不做确认，打开主窗口让用户确认
        Some(true) if mode == Mode::Standard => {
            show_main(app);
            let _ = app.emit(
                "tray://confirm-mode",
                TrayConfirmMode {
                    asset_id: asset_id.into(),
                },
            );
        }
        Some(_) => {
            if let Err(error) = backend.set_mode(asset_id, mode) {
                log::warn!("CloudLink tray could not switch mode: {error:?}");
            }
        }
    }
    schedule_refresh(app);
}

fn all_read_only(app: &AppHandle) {
    let Some(backend) = app.try_state::<Arc<Backend>>() else {
        return;
    };
    let switched = match backend.all_read_only() {
        Ok(switched) => switched,
        Err(error) => {
            log::warn!("CloudLink tray could not switch to read-only: {error:?}");
            return;
        }
    };
    schedule_refresh(app);
    if switched.is_empty() {
        return;
    }
    let copy = app
        .try_state::<Arc<TrayState>>()
        .and_then(|s| s.copy.lock().ok().and_then(|c| c.clone()));
    if let Some(copy) = copy {
        use tauri_plugin_notification::NotificationExt;
        let _ = app
            .notification()
            .builder()
            .title(&copy.notify_title)
            .body(copy.notify_all_read_only.replace("{n}", &switched.len().to_string()))
            .show();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn servers_come_first_then_production_then_handle() {
        let mut items = [
            (true, true, "vercel"),
            (false, false, "dev-box"),
            (true, false, "github"),
            (false, true, "sg-db"),
            (false, true, "hk-edge"),
            (true, true, "Cloudflare"),
        ];
        items.sort_by_cached_key(|(cli, production, handle)| order_key(*cli, *production, handle));
        let handles: Vec<_> = items.iter().map(|item| item.2).collect();
        assert_eq!(
            handles,
            ["hk-edge", "sg-db", "dev-box", "Cloudflare", "vercel", "github"]
        );
    }

    #[test]
    fn right_column_follows_a_tab() {
        assert_eq!(columns("hk-edge", "只读巡检"), "hk-edge\t只读巡检");
    }

    #[test]
    fn amber_dot_is_round_and_soft_edged() {
        let rgba = amber_dot_rgba();
        assert_eq!(rgba.len(), (DOT_SIZE * DOT_SIZE * 4) as usize);
        let alpha = |x: u32, y: u32| rgba[((y * DOT_SIZE + x) * 4 + 3) as usize];
        assert_eq!(alpha(8, 8), 255);
        assert_eq!(alpha(0, 0), 0);
        assert_eq!(alpha(15, 8), 0);
        let edge = alpha(4, 8);
        assert!(edge > 0 && edge < 255, "edge alpha {edge}");
        assert_eq!(&rgba[..3], &AMBER);
    }
}
