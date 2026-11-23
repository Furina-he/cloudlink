//! 系统托盘（F-407，PRD 6.10）。菜单文字由前端经 `set_tray_copy` 传入（文案只在 copy.ts），
//! 收到之前不创建托盘。资源、档位或护栏变化时重建菜单。
//!
//! 原生菜单不能排版也不能给文字上色：档位、数量放进 `\t` 后面的右侧列对齐；
//! P10 取消生产环境标记与琥珀圆点图标，优先显示资源名称并按名称自然排序。

use std::collections::HashMap;
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

/// Windows 菜单里 `\t` 后面的文字右对齐成一列（快捷键那一列）
fn columns(left: &str, right: &str) -> String {
    format!("{left}\t{right}")
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
enum NatPart {
    Text(String),
    Num(u128),
}

fn natural_key(s: &str) -> Vec<NatPart> {
    let mut parts = Vec::new();
    let mut chars = s.chars().peekable();
    while let Some(&ch) = chars.peek() {
        if ch.is_ascii_digit() {
            let mut n: u128 = 0;
            while let Some(&d) = chars.peek() {
                if let Some(v) = d.to_digit(10) {
                    n = n.saturating_mul(10).saturating_add(u128::from(v));
                    chars.next();
                } else {
                    break;
                }
            }
            parts.push(NatPart::Num(n));
        } else {
            let mut text = String::new();
            while let Some(&c) = chars.peek() {
                if c.is_ascii_digit() {
                    break;
                }
                for lc in c.to_lowercase() {
                    text.push(lc);
                }
                chars.next();
            }
            parts.push(NatPart::Text(text));
        }
    }
    parts
}

fn display_name(asset: &Asset) -> &str {
    let trimmed = asset.name().trim();
    if trimmed.is_empty() { asset.handle() } else { trimmed }
}

/// 菜单里资源的排序键：服务器在前，云平台和代码托管在后；组内按名称自然排序，再按标识兜底
fn order_key(cli: bool, name: &str, handle: &str) -> (bool, Vec<NatPart>, String) {
    (cli, natural_key(name), handle.to_ascii_lowercase())
}

/// 优先显示资源名称；同组内出现重名时再附括号区分，不裸露 `cloudlink-N` 等技术别名
fn menu_labels(assets: &[Asset]) -> Vec<String> {
    let mut counts = HashMap::<(bool, String), usize>::new();
    for a in assets {
        let key = (matches!(a, Asset::Cli(_)), display_name(a).to_lowercase());
        *counts.entry(key).or_insert(0) += 1;
    }
    assets
        .iter()
        .map(|a| {
            let name = display_name(a);
            let key = (matches!(a, Asset::Cli(_)), name.to_lowercase());
            if counts.get(&key).copied().unwrap_or(0) > 1 {
                let extra = match a {
                    Asset::Vps(s) => s.connection.ssh_alias.as_str(),
                    Asset::Cli(c) => c.account.as_deref().unwrap_or(c.handle.as_str()),
                };
                format!("{name} ({extra})")
            } else {
                name.to_string()
            }
        })
        .collect()
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
    /// 「{n} 项在自动运维」，跟在「全部改为确认变更」右边
    pub prod_in_standard: String,
    pub open: String,
    pub quit: String,
    /// 系统通知标题与正文「{n} 项资源已改为确认变更」
    pub notify_title: String,
    pub notify_all_read_only: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub notify_execution: Option<String>,
}

#[derive(Default)]
pub struct TrayState {
    copy: Mutex<Option<TrayCopy>>,
    guard_on: AtomicBool,
    refreshing: AtomicBool,
    pending: AtomicBool,
    notified_requests: Mutex<std::collections::BTreeSet<String>>,
}

/// `tray://confirm-mode`：任意资源要切到自动运维，主窗口打开确认（AC1）
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
    if event == "execution://changed" {
        notify_execution(app, &state, payload);
    }
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

/// Notifications contain only an opaque request ID and epoch, never a command or resource address.
fn notify_execution(app: &AppHandle, state: &TrayState, payload: &serde_json::Value) {
    use tauri_plugin_notification::NotificationExt;
    let Some(copy) = state.copy.lock().ok().and_then(|copy| copy.clone()) else {
        return;
    };
    let Some(body) = copy.notify_execution else { return };
    let Some(requests) = payload["requests"].as_array() else {
        return;
    };
    let Ok(mut notified) = state.notified_requests.lock() else {
        return;
    };
    let ids: std::collections::BTreeSet<_> = requests
        .iter()
        .filter_map(|request| request["requestId"].as_str())
        .collect();
    notified.retain(|id| ids.contains(id.as_str()));
    for request in requests.iter().filter(|request| request["state"] == "waiting") {
        let Some(id) = request["requestId"].as_str() else {
            continue;
        };
        if notified.contains(id) {
            continue;
        }
        if app
            .notification()
            .builder()
            .title(&copy.notify_title)
            .body(&body)
            .extra("cloudlinkRequestId", id)
            .extra("cloudlinkEpoch", payload["epoch"].clone())
            .show()
            .is_ok()
        {
            notified.insert(id.into());
        }
    }
}

pub fn register_execution_notifications(app: &AppHandle) -> tauri_plugin_notification::Result<()> {
    use tauri_plugin_notification::NotificationExt;
    let handle = app.clone();
    app.notification().on_action(move |action| {
        if action.action_id() != "tap" {
            return;
        }
        let Some(notification) = action.notification() else {
            return;
        };
        let Some(id) = notification
            .extra()
            .get("cloudlinkRequestId")
            .and_then(|id| id.as_str())
        else {
            return;
        };
        let Some(epoch) = notification
            .extra()
            .get("cloudlinkEpoch")
            .and_then(|epoch| epoch.as_str())
        else {
            return;
        };
        let Some(backend) = handle.try_state::<Arc<Backend>>() else {
            return;
        };
        if backend.get_runtime_status().is_ok_and(|status| status.epoch == epoch) {
            show_main(&handle);
            let _ = handle.emit("execution://focus", serde_json::json!({"requestId":id}));
        }
        // A notification never approves. The original card still requires an explicit GUI answer.
    })
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
    assets.sort_by_cached_key(|a| order_key(matches!(a, Asset::Cli(_)), display_name(a), a.handle()));
    let labels = menu_labels(&assets);
    let auto_ops_count = assets.iter().filter(|a| a.agent().mode == Mode::AutoOps).count();

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
        for (asset, name) in assets.iter().zip(labels.iter()) {
            let mode = asset.agent().mode;
            let label = columns(
                name,
                if mode == Mode::AutoOps {
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
                        format!("mode:confirm-changes:{id}"),
                        &copy.read_only,
                        true,
                        mode == Mode::ConfirmChanges,
                        None::<&str>,
                    )?,
                    &CheckMenuItem::with_id(
                        app,
                        format!("mode:auto-ops:{id}"),
                        &copy.standard,
                        true,
                        mode == Mode::AutoOps,
                        None::<&str>,
                    )?,
                ],
            )?;
            menu.append(&sub)?;
        }
        menu.append(&PredefinedMenuItem::separator(app)?)?;
        let all_label = if auto_ops_count > 0 {
            columns(
                &copy.all_read_only,
                &copy.prod_in_standard.replace("{n}", &auto_ops_count.to_string()),
            )
        } else {
            copy.all_read_only.clone()
        };
        menu.append(&MenuItem::with_id(
            app,
            "all-read-only",
            all_label,
            auto_ops_count > 0,
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

fn menu_mode(value: &str) -> Option<Mode> {
    match value {
        "auto-ops" => Some(Mode::AutoOps),
        "confirm-changes" | "read-only" | "standard" => Some(Mode::ConfirmChanges),
        _ => None,
    }
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
            let Some(mode) = menu_mode(mode) else { return };
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
    let current = backend
        .list_assets()
        .ok()
        .and_then(|assets| assets.into_iter().find(|a| a.id() == asset_id))
        .map(|a| a.agent().mode);
    match current {
        None => {}
        Some(prev) if prev == mode => {}
        // AC1：任意资源切到自动运维，托盘里不做确认，打开主窗口让用户确认
        Some(_) if mode == Mode::AutoOps => {
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
    fn real_use_tray_mode_ids_round_trip_and_legacy_modes_do_not_elevate() {
        for mode in [Mode::ConfirmChanges, Mode::AutoOps] {
            assert_eq!(menu_mode(mode.as_str()), Some(mode));
        }
        for value in ["read-only", "standard"] {
            assert_eq!(menu_mode(value), Some(Mode::ConfirmChanges));
        }
        assert_eq!(menu_mode("unrecognized"), None);
    }

    #[test]
    fn servers_come_first_then_natural_name_order() {
        let mut items = [
            (true, "Vercel", "vercel"),
            (false, "节点 10", "cloudlink-10"),
            (true, "GitHub", "github"),
            (false, "节点 2", "cloudlink-2"),
            (false, "Alpha", "hk-edge"),
            (true, "Cloudflare", "cloudflare"),
        ];
        items.sort_by_cached_key(|(cli, name, handle)| order_key(*cli, name, handle));
        let names: Vec<_> = items.iter().map(|item| item.1).collect();
        assert_eq!(names, ["Alpha", "节点 2", "节点 10", "Cloudflare", "GitHub", "Vercel"]);
    }

    #[test]
    fn menu_labels_prefer_display_name_and_disambiguate_duplicates() {
        let mut a = crate::testkit::hk_edge();
        a.name = "腾讯云".into();
        a.connection.ssh_alias = "cloudlink-1".into();
        let mut b = crate::testkit::sg_db();
        b.name = "测试机".into();
        b.connection.ssh_alias = "cloudlink-2".into();
        let mut c = crate::testkit::dev_box();
        c.name = "测试机".into();
        c.connection.ssh_alias = "cloudlink-3".into();
        let mut cf1 = crate::testkit::cloudflare();
        cf1.name = "Cloudflare".into();
        cf1.account = Some("me@example.com".into());
        let mut cf2 = crate::testkit::cloudflare();
        cf2.id = "ast_cf2".into();
        cf2.handle = "cloudflare-2".into();
        cf2.name = "Cloudflare".into();
        cf2.account = Some("acme-corp".into());
        let assets = vec![
            Asset::Vps(a),
            Asset::Vps(b),
            Asset::Vps(c),
            Asset::Cli(cf1),
            Asset::Cli(cf2),
        ];
        assert_eq!(
            menu_labels(&assets),
            vec![
                "腾讯云",
                "测试机 (cloudlink-2)",
                "测试机 (cloudlink-3)",
                "Cloudflare (me@example.com)",
                "Cloudflare (acme-corp)",
            ]
        );
    }

    #[test]
    fn right_column_follows_a_tab() {
        assert_eq!(columns("香港边缘节点", "确认变更"), "香港边缘节点\t确认变更");
    }
}
