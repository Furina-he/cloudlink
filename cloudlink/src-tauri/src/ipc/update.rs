//! F-406 检测更新的后端入口：忙碌判定、下载线程，以及安装前的最后一次检查。

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use super::backend::Backend;
use crate::error::{AppError, Result};
use crate::model::misc::{ActivityKind, ActivityMessageId, IpcErrorId, UpdateStatus};
use crate::params;

/// `update-busy` 的 `params.task`
const TASK_CONNECTION: &str = "connection";
const TASK_PROBE: &str = "probe";
const TASK_CLI: &str = "cli";
const TASK_PUBLISH: &str = "publish";

fn busy(task: &str, name: &str) -> AppError {
    let mut params = params! {"task" => task};
    if !name.is_empty() {
        params.insert("name".into(), name.into());
    }
    AppError::ipc_with(IpcErrorId::UpdateBusy, params)
}

impl Backend {
    /// 接上真实更新源并启动调度线程（只在桌面应用启动时调用一次）
    pub fn start_updates(&self, current_version: &str, source: Arc<dyn crate::update::Source>) {
        self.updates.set_current_version(current_version);
        self.updates.set_source(source);
        if let Err(e) = self.updates.spawn_scheduler() {
            log::warn!("CloudLink update checks are unavailable: {e}");
        }
    }

    pub fn update_status(&self) -> UpdateStatus {
        self.updates.status()
    }

    /// F-406 AC2–AC5：开始下载；进度、失败和「正在安装」都经 `update://changed` 推送
    pub fn install_update(self: &Arc<Self>) -> Result<()> {
        if let Some(busy) = self.running_task() {
            return Err(busy);
        }
        if self.mutation.try_lock().is_err() {
            return Err(busy(TASK_PUBLISH, ""));
        }
        let Some(cancel) = self.updates.begin_download()? else {
            return Ok(());
        };
        let backend = Arc::clone(self);
        let spawned = std::thread::Builder::new()
            .name("cloudlink-update".into())
            .spawn(move || backend.finish_update(&cancel));
        if spawned.is_err() {
            self.updates.abort(crate::update::Failure::Download.error());
        }
        Ok(())
    }

    pub fn cancel_update(&self) {
        self.updates.cancel();
    }

    pub(super) fn finish_update(&self, cancel: &AtomicBool) {
        let package = match self.updates.download(cancel) {
            Ok(package) => package,
            Err(failure) => return self.updates.abort(failure.error()),
        };
        // 从最后一次检查一直持有到 CloudLink 退出：新的测试连接、探测、CLI 检测和发布都要先拿这把锁，
        // 所以安装程序接手时不会有发布被截断。安装失败时锁随之释放
        let Ok(_edit) = self.mutation.try_lock() else {
            return self.updates.abort(Some(busy(TASK_PUBLISH, "").to_ipc()));
        };
        if let Some(busy) = self.running_task() {
            return self.updates.abort(Some(busy.to_ipc()));
        }
        let Some(version) = self.updates.mark_installing() else {
            return self.updates.abort(None);
        };
        // F-406 AC5：退出前写一条活动记录
        let recorded = self.activity(
            ActivityKind::Update,
            ActivityMessageId::UpdateInstalling,
            None,
            params! {"from" => self.updates.current_version(), "to" => version},
            true,
        );
        if recorded.is_err() {
            log::warn!("could not record the CloudLink update in the activity log");
        }
        if let Err(failure) = self.updates.install(&package) {
            self.updates.abort(failure.error());
        }
    }

    /// 第一项进行中的任务（F-406 AC4）。正在写入的凭据和进行中的重置按「发布」计
    fn running_task(&self) -> Option<AppError> {
        if let Some((asset_id, alias)) = self.connections.running() {
            let name = asset_id.and_then(|id| self.asset_handle(&id)).unwrap_or(alias);
            return Some(busy(TASK_CONNECTION, &name));
        }
        if let Some(asset_id) = self.probes.running() {
            return Some(busy(TASK_PROBE, &self.asset_handle(&asset_id).unwrap_or_default()));
        }
        if let Some(provider) = self.cli_runs.lock().ok().and_then(|runs| runs.first().copied()) {
            return Some(busy(TASK_CLI, provider.as_str()));
        }
        if self.credential_writes.load(Ordering::SeqCst) > 0 || self.resetting.load(Ordering::SeqCst) {
            return Some(busy(TASK_PUBLISH, ""));
        }
        None
    }

    fn asset_handle(&self, id: &str) -> Option<String> {
        let db = self.database().ok()?;
        db.require_asset(id).ok().map(|asset| asset.handle().to_string())
    }
}
