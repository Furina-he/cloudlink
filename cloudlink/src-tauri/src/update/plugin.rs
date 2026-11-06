//! 真实更新源：Tauri updater 只在 Rust 侧调用，前端不引入 `@tauri-apps/plugin-updater`（PRD 7.3、8.1）。
//! 端点、公钥和 Windows 安装模式都来自 `tauri.conf.json` 的 `plugins.updater`。

use std::sync::{Mutex, PoisonError};
use std::time::Duration;

use tauri_plugin_updater::{Update, UpdaterExt};

use super::{Failure, Release, Source};

/// 只限制读取版本清单；安装包可能很大，下载阶段不设超时，用户可以随时取消
const CHECK_TIMEOUT: Duration = Duration::from_secs(30);
const CANCEL_POLL: Duration = Duration::from_millis(100);

pub struct PluginSource {
    app: tauri::AppHandle,
    /// 隔离实例（设置了 CLOUDLINK_HOME）只访问本机回环地址上的测试端点，绝不请求 GitHub
    loopback_only: bool,
    pending: Mutex<Option<Update>>,
}

impl PluginSource {
    pub fn new(app: tauri::AppHandle, loopback_only: bool) -> Self {
        PluginSource {
            app,
            loopback_only,
            pending: Mutex::new(None),
        }
    }

    fn pending(&self) -> Option<Update> {
        self.pending.lock().unwrap_or_else(PoisonError::into_inner).clone()
    }

    fn endpoints_are_loopback(&self) -> bool {
        self.app
            .config()
            .plugins
            .0
            .get("updater")
            .and_then(|updater| updater.get("endpoints"))
            .and_then(serde_json::Value::as_array)
            .is_some_and(|endpoints| {
                !endpoints.is_empty()
                    && endpoints
                        .iter()
                        .all(|endpoint| endpoint.as_str().is_some_and(is_loopback_url))
            })
    }
}

impl Source for PluginSource {
    fn check(&self) -> Result<Option<Release>, String> {
        if cfg!(test) {
            return Err("the network update source is disabled in unit tests".into());
        }
        if self.loopback_only && !self.endpoints_are_loopback() {
            return Err("an isolated CloudLink only checks loopback update endpoints".into());
        }
        let updater = self
            .app
            .updater_builder()
            .timeout(CHECK_TIMEOUT)
            .build()
            .map_err(|e| e.to_string())?;
        let update = tauri::async_runtime::block_on(updater.check()).map_err(|e| e.to_string())?;
        let release = update.as_ref().map(|update| Release {
            version: update.version.clone(),
            date: update
                .date
                .map(|date| crate::time::format_rfc3339(date.unix_timestamp())),
            notes: update.body.clone(),
        });
        *self.pending.lock().unwrap_or_else(PoisonError::into_inner) = update;
        Ok(release)
    }

    fn download(
        &self,
        progress: &mut dyn FnMut(u64, Option<u64>),
        cancelled: &dyn Fn() -> bool,
    ) -> Result<Vec<u8>, Failure> {
        let update = self.pending().ok_or(Failure::Download)?;
        let mut downloaded = 0u64;
        tauri::async_runtime::block_on(async {
            let download = update.download(
                |chunk, total| {
                    downloaded += chunk as u64;
                    progress(downloaded, total);
                },
                || {},
            );
            tokio::pin!(download);
            loop {
                tokio::select! {
                    result = &mut download => {
                        return result.map_err(|e| {
                            log::warn!("CloudLink update download failed: {e}");
                            failure(&e, Failure::Download)
                        });
                    }
                    () = tokio::time::sleep(CANCEL_POLL) => {
                        if cancelled() {
                            return Err(Failure::Cancelled);
                        }
                    }
                }
            }
        })
    }

    fn install(&self, package: &[u8]) -> Result<(), Failure> {
        let update = self.pending().ok_or(Failure::Install)?;
        update.install(package).map_err(|e| {
            log::warn!("CloudLink update install failed: {e}");
            failure(&e, Failure::Install)
        })?;
        // Windows 不会走到这里：安装程序已接手，CloudLink 已退出
        self.app.restart()
    }
}

fn failure(error: &tauri_plugin_updater::Error, otherwise: Failure) -> Failure {
    use tauri_plugin_updater::Error;
    match error {
        Error::Minisign(_)
        | Error::Base64(_)
        | Error::SignatureUtf8(_)
        | Error::SignedVersionMismatch { .. }
        | Error::MissingSignedVersion => Failure::Signature,
        _ => otherwise,
    }
}

/// `http(s)://127.0.0.1`、`localhost` 或 `[::1]`，可带端口；带用户信息或其他主机的地址一律不算
pub(super) fn is_loopback_url(url: &str) -> bool {
    let Some(rest) = url.strip_prefix("http://").or_else(|| url.strip_prefix("https://")) else {
        return false;
    };
    let authority = rest.split(['/', '?', '#']).next().unwrap_or_default();
    let (host, port) = match authority.strip_prefix("[::1]") {
        Some(port) => ("[::1]", port),
        None => authority.find(':').map_or((authority, ""), |i| authority.split_at(i)),
    };
    let port_ok = port.is_empty()
        || port
            .strip_prefix(':')
            .is_some_and(|digits| (1..=5).contains(&digits.len()) && digits.bytes().all(|b| b.is_ascii_digit()));
    port_ok && matches!(host.to_ascii_lowercase().as_str(), "127.0.0.1" | "localhost" | "[::1]")
}
