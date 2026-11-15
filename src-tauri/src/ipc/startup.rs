//! 冷启动（PRD 第九章：不超过 1.5 秒）。
//!
//! Tauri 先按配置建好窗口、让 WebView2 开始加载页面，再在主线程上运行 setup；setup 返回之前，主线程处理不了
//! 页面的资源请求，窗口就一直空白。所以桌面应用的 setup 只打开数据库（`Backend::open`），其余启动工作都放到
//! 后台线程：同步护栏程序、检测运行环境和 Agent、第一次对账（`ssh -G` 回读、编译、检查副本、护栏自检），
//! 然后重试凭据清理、导入反馈。这些工作会启动外部程序（`wsl.exe`、`ssh`、护栏自检），WSL 没在运行时要等好几秒。
//!
//! 启动工作做完之前，IPC 命令在 `StartupGate` 前等着（`commands.rs` 里只有首屏要用、只读数据库或静态内容的几条
//! 不等），所以命令看到的运行环境、Agent 目标和对账结果，和以前在 setup 里同步做完时一样，修改锁也只会在启动
//! 工作之后才被命令拿到。单元测试走 `with_services`，在构造时同步做完。

use std::sync::atomic::Ordering;
use std::sync::{Arc, Condvar, Mutex, PoisonError};
use std::time::{Duration, Instant};

use super::Backend;
use crate::env;
use crate::error::{AppError, Result};
use crate::model::env::Environment;

/// 启动时的检测结果超过这个时间就不再沿用，重新检测
const STARTUP_RESULT_TTL: Duration = Duration::from_secs(30);

pub(super) struct StartupGate {
    open: Mutex<bool>,
    opened: Condvar,
}

impl StartupGate {
    pub(super) fn closed() -> Self {
        Self {
            open: Mutex::new(false),
            opened: Condvar::new(),
        }
    }

    /// 等启动工作做完。锁中毒也照常判断：闸门只记录一个布尔值
    fn wait(&self) {
        let mut open = self.open.lock().unwrap_or_else(PoisonError::into_inner);
        while !*open {
            open = self.opened.wait(open).unwrap_or_else(PoisonError::into_inner);
        }
    }

    fn release(&self) {
        *self.open.lock().unwrap_or_else(PoisonError::into_inner) = true;
        self.opened.notify_all();
    }
}

/// 启动工作出错或 panic 时也要放行，否则所有命令会一直等下去
struct Release<'a>(&'a StartupGate);

impl Drop for Release<'_> {
    fn drop(&mut self) {
        self.0.release();
    }
}

/// 启动线程检测出的运行环境，留给前端加载时的第一次 `detect_environments`：那次调用在闸门后面等启动工作做完，
/// 再把 WSL 检测和对账重跑一遍，只会让 Agent 开关晚出现几秒
pub(super) struct StartupEnvironments {
    epoch: u64,
    at: Instant,
    environments: Vec<Environment>,
}

/// 启动方式：桌面应用在后台线程里做，并同步护栏程序、留下检测结果；单元测试在构造时同步做完，两样都不碰
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Start {
    Desktop,
    Inline,
}

impl Backend {
    /// 桌面应用：交给后台线程。起不了线程就在这里做完，和以前一样
    pub(super) fn start_in_background(self: &Arc<Self>) {
        let backend = Arc::clone(self);
        let spawned = std::thread::Builder::new()
            .name("cloudlink-startup".into())
            .spawn(move || backend.finish_start());
        if spawned.is_err() {
            self.finish_start();
        }
    }

    fn finish_start(&self) {
        if let Err(error) = self.start(Start::Desktop) {
            // 闸门已经放行；命令各自报告它们遇到的问题，前端的「重新检测」会再做一遍
            log::warn!("CloudLink startup checks did not finish: {error}");
        }
    }

    /// 启动工作，做完（含出错）时放行闸门
    pub(super) fn start(&self, mode: Start) -> Result<()> {
        let _release = Release(&self.startup);
        {
            // 命令要等闸门放行才可能拿修改锁，这里直接拿，不经过 `edit()`
            let _edit = self
                .mutation
                .lock()
                .map_err(|_| AppError::internal("mutation state unavailable"))?;
            if self.database()?.reset_pending()? {
                // A previous reset failed or was interrupted. Do not recreate copies or policy from old data.
                *self
                    .envs
                    .lock()
                    .map_err(|_| AppError::internal("environment state unavailable"))? =
                    env::detect(&self.paths, self.system.as_ref());
                return Ok(());
            }
            // 先同步护栏程序，第一次对账里的护栏自检检查的就是安装目录里的这一版
            if mode == Start::Desktop && self.prepare_guard_binary().is_err() {
                log::warn!("CloudLink guard binary is unavailable; guard health will report it");
            }
            let environments = self.detect_environments_locked()?;
            if mode == Start::Desktop {
                self.keep_startup_environments(environments);
            }
        }
        self.retry_credential_cleanup();
        if self.refresh_feedback().is_err() {
            log::warn!("CloudLink feedback import remains pending");
        }
        Ok(())
    }

    /// IPC 命令在这里等启动工作做完（见模块说明）
    pub(super) fn wait_for_startup(&self) {
        self.startup.wait();
    }

    fn keep_startup_environments(&self, environments: Vec<Environment>) {
        if let Ok(mut kept) = self.startup_environments.lock() {
            *kept = Some(StartupEnvironments {
                epoch: self.reset_epoch.load(Ordering::SeqCst),
                at: Instant::now(),
                environments,
            });
        }
    }

    /// 只用一次；数据重置过、或者已经过了一阵子，就重新检测。调用方持有修改锁
    pub(super) fn take_startup_environments(&self) -> Option<Vec<Environment>> {
        let kept = self.startup_environments.lock().ok()?.take()?;
        (kept.epoch == self.reset_epoch.load(Ordering::SeqCst) && kept.at.elapsed() <= STARTUP_RESULT_TTL)
            .then_some(kept.environments)
    }

    /// 启动时的结果里有 Include 状态，加入 Include 之后就过时了
    pub(super) fn forget_startup_environments(&self) {
        if let Ok(mut kept) = self.startup_environments.lock() {
            *kept = None;
        }
    }
}
