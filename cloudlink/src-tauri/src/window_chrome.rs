//! P8b: native decorations and caption colors. CSS remains the only palette source.
//! The window stays hidden until React has applied its stored theme; no extra preference file.

use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};

use tauri::utils::config::{Color, Config};
use tauri::{Manager, Theme, WebviewWindow};
use tauri_plugin_window_state::StateFlags;

use crate::error::{AppError, Result};
use crate::model::misc::{IpcErrorId, Theme as ThemePreference};

const CSS: &str = include_str!("../../src/index.css");

pub(crate) struct WindowChrome {
    preference: Mutex<ThemePreference>,
    show_when_ready: AtomicBool,
}

impl WindowChrome {
    pub fn new(show_when_ready: bool) -> Self {
        Self {
            preference: Mutex::new(ThemePreference::System),
            show_when_ready: AtomicBool::new(show_when_ready),
        }
    }
}

/// Keep test configurations that explicitly start hidden hidden. Do not restore P7 decorations=false.
pub(crate) fn prepare(config: &mut Config) -> bool {
    let Some(window) = config.app.windows.iter_mut().find(|w| w.label == "main") else {
        return false;
    };
    let show = window.visible;
    window.visible = false;
    window.decorations = true;
    show
}

pub(crate) fn restore_flags() -> StateFlags {
    StateFlags::all() & !(StateFlags::VISIBLE | StateFlags::DECORATIONS)
}

#[tauri::command]
pub(crate) fn set_window_theme(
    window: WebviewWindow,
    theme: ThemePreference,
    state: tauri::State<'_, WindowChrome>,
) -> Result<()> {
    if window.label() != "main" {
        return Err(AppError::ipc(IpcErrorId::SettingsInvalid));
    }
    *state
        .preference
        .lock()
        .map_err(|_| AppError::ipc(IpcErrorId::Internal))? = theme;
    let preferred = match theme {
        ThemePreference::System => None,
        ThemePreference::Light => Some(Theme::Light),
        ThemePreference::Dark => Some(Theme::Dark),
    };
    // Unsupported exact tinting must not prevent the actual app from appearing.
    let result = window
        .set_theme(preferred)
        .map_err(|_| AppError::ipc(IpcErrorId::Internal))
        .and_then(|()| apply(&window, theme, None));
    if state.show_when_ready.swap(false, Ordering::AcqRel) {
        window.show().map_err(|_| AppError::ipc(IpcErrorId::Internal))?;
    }
    result
}

pub(crate) fn on_window_event(window: &WebviewWindow, event: &tauri::WindowEvent) {
    if window.label() != "main" {
        return;
    }
    let system = match event {
        tauri::WindowEvent::ThemeChanged(theme) => Some(*theme),
        tauri::WindowEvent::Focused(_) => None,
        _ => return,
    };
    let Some(state) = window.app_handle().try_state::<WindowChrome>() else {
        return;
    };
    let preference = match state.preference.lock() {
        Ok(preference) => *preference,
        Err(_) => return,
    };
    if apply(window, preference, system).is_err() {
        log::warn!("CloudLink native window theme could not be refreshed");
    }
}

fn apply(window: &WebviewWindow, preference: ThemePreference, system: Option<Theme>) -> Result<()> {
    let dark = match preference {
        ThemePreference::Light => false,
        ThemePreference::Dark => true,
        ThemePreference::System => system.unwrap_or_else(|| window.theme().unwrap_or(Theme::Light)) == Theme::Dark,
    };
    let palette = palette(dark)?;
    let high_contrast = native::high_contrast();
    let background = (!high_contrast).then_some(Color(
        palette.background[0],
        palette.background[1],
        palette.background[2],
        255,
    ));
    window
        .set_background_color(background)
        .map_err(|_| AppError::ipc(IpcErrorId::Internal))?;
    native::caption(window, dark, high_contrast, palette);
    Ok(())
}

#[derive(Clone, Copy)]
struct Palette {
    background: [u8; 3],
    foreground: [u8; 3],
}

fn palette(dark: bool) -> Result<Palette> {
    let selector = if dark { ".dark {" } else { ":root {" };
    let block = CSS
        .split_once(selector)
        .and_then(|(_, rest)| rest.split_once('}').map(|(block, _)| block))
        .ok_or_else(|| AppError::ipc(IpcErrorId::Internal))?;
    Ok(Palette {
        background: css_rgb(block, "--background:")?,
        foreground: css_rgb(block, "--foreground:")?,
    })
}

/// Convert the existing opaque OKLCH tokens to sRGB for DWM COLORREF, not a second set of colors.
fn css_rgb(block: &str, name: &str) -> Result<[u8; 3]> {
    let invalid = || AppError::ipc(IpcErrorId::Internal);
    let token = block
        .split_once(name)
        .and_then(|(_, rest)| rest.split_once(';').map(|(token, _)| token.trim()))
        .and_then(|token| token.strip_prefix("oklch(").and_then(|token| token.strip_suffix(')')))
        .ok_or_else(invalid)?;
    let values: Vec<f64> = token
        .split_whitespace()
        .map(str::parse)
        .collect::<std::result::Result<_, _>>()
        .map_err(|_| invalid())?;
    if values.len() != 3 || values.iter().any(|v| !v.is_finite()) {
        return Err(invalid());
    }
    let (lightness, chroma, hue) = (values[0], values[1], values[2].to_radians());
    let (a, b) = (chroma * hue.cos(), chroma * hue.sin());
    let l = (lightness + 0.3963377774 * a + 0.2158037573 * b).powi(3);
    let m = (lightness - 0.1055613458 * a - 0.0638541728 * b).powi(3);
    let s = (lightness - 0.0894841775 * a - 1.2914855480 * b).powi(3);
    let linear = [
        4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
    ];
    Ok(linear.map(|channel| {
        let encoded = if channel <= 0.0031308 {
            12.92 * channel
        } else {
            1.055 * channel.powf(1.0 / 2.4) - 0.055
        };
        (encoded.clamp(0.0, 1.0) * 255.0).round() as u8
    }))
}

#[cfg(windows)]
mod native {
    use super::Palette;
    use std::ffi::c_void;
    use tauri::WebviewWindow;

    #[repr(C)]
    struct HighContrast {
        size: u32,
        flags: u32,
        scheme: *mut u16,
    }
    #[link(name = "user32")]
    unsafe extern "system" {
        fn SystemParametersInfoW(action: u32, parameter: u32, value: *mut c_void, flags: u32) -> i32;
    }
    #[link(name = "dwmapi")]
    unsafe extern "system" {
        fn DwmSetWindowAttribute(window: *mut c_void, attribute: u32, value: *const c_void, size: u32) -> i32;
    }

    pub(super) fn high_contrast() -> bool {
        let mut contrast = HighContrast {
            size: std::mem::size_of::<HighContrast>() as u32,
            flags: 0,
            scheme: std::ptr::null_mut(),
        };
        // Read-only. Failure falls back to native system appearance; never change the user's settings.
        let ok =
            unsafe { SystemParametersInfoW(0x0042, contrast.size, (&mut contrast as *mut HighContrast).cast(), 0) };
        ok == 0 || contrast.flags & 1 != 0
    }

    fn color_ref(rgb: [u8; 3]) -> u32 {
        rgb[0] as u32 | (rgb[1] as u32) << 8 | (rgb[2] as u32) << 16
    }

    pub(super) fn caption(window: &WebviewWindow, dark: bool, high_contrast: bool, palette: Palette) {
        let Ok(window) = window.hwnd() else {
            return;
        };
        let window = window.0.cast();
        let immersive = i32::from(dark && !high_contrast);
        let background = if high_contrast {
            u32::MAX
        } else {
            color_ref(palette.background)
        };
        let foreground = if high_contrast {
            u32::MAX
        } else {
            color_ref(palette.foreground)
        };
        // 20: Windows 10 21H2+ theme. 35/36: Windows 11 tint. Unsupported attributes simply keep OS colors.
        unsafe {
            DwmSetWindowAttribute(
                window,
                20,
                (&immersive as *const i32).cast(),
                std::mem::size_of::<i32>() as u32,
            );
            DwmSetWindowAttribute(
                window,
                35,
                (&background as *const u32).cast(),
                std::mem::size_of::<u32>() as u32,
            );
            DwmSetWindowAttribute(
                window,
                36,
                (&foreground as *const u32).cast(),
                std::mem::size_of::<u32>() as u32,
            );
        }
    }
}

#[cfg(not(windows))]
mod native {
    pub(super) fn high_contrast() -> bool {
        false
    }
    pub(super) fn caption(_: &tauri::WebviewWindow, _: bool, _: bool, _: super::Palette) {}
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::utils::config::WindowConfig;

    #[test]
    fn startup_uses_native_decorations_and_waits_for_the_frontend_theme() {
        let mut config = Config::default();
        config.app.windows.push(WindowConfig {
            decorations: false,
            ..Default::default()
        });
        assert!(prepare(&mut config));
        assert!(config.app.windows[0].decorations);
        assert!(!config.app.windows[0].visible);
    }

    #[test]
    fn explicitly_hidden_desktop_test_window_is_not_automatically_shown() {
        let mut config = Config::default();
        config.app.windows.push(WindowConfig {
            visible: false,
            ..Default::default()
        });
        assert!(!prepare(&mut config));
        assert!(!config.app.windows[0].visible);
    }

    #[test]
    fn old_saved_window_state_cannot_restore_custom_decorations_or_flash_visible() {
        let flags = restore_flags();
        assert!(!flags.intersects(StateFlags::VISIBLE | StateFlags::DECORATIONS));
        assert!(
            flags.contains(StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED | StateFlags::FULLSCREEN)
        );
    }

    #[test]
    fn native_colors_are_derived_from_the_actual_css_tokens() {
        let light = palette(false).unwrap();
        let dark = palette(true).unwrap();
        assert!(light.background.iter().all(|v| *v > 230));
        assert!(light.foreground.iter().all(|v| *v < 40));
        assert!(dark.background.iter().all(|v| *v < 40));
        assert!(dark.foreground.iter().all(|v| *v > 230));
        assert_eq!(
            css_rgb("--background: not-a-color;", "--background:")
                .err()
                .unwrap()
                .to_ipc()
                .id,
            IpcErrorId::Internal
        );
    }
}
