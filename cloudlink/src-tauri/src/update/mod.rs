//! 检测更新（F-406，PRD 8.1 `update`）：按设置开关定时检查；发现新版本就在后台下载并校验签名，下好才提醒；
//! 用户点「重启以更新」时安装；推送 `update://changed` 快照。
//! 检查周期只在这里决定：启动 10 秒后一次，之后每 24 小时一次，失败后 1 小时重试，前端不自建定时器。
//! 更新源可注入。单元测试只用假的更新源；`cfg!(test)` 下真实更新源直接报错，不访问网络。

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

use crate::ipc::EventSink;
use crate::model::misc::{IpcError, IpcErrorId, UpdateState, UpdateStatus};

mod plugin;
pub use plugin::PluginSource;

#[cfg(test)]
pub(crate) mod tests;

pub const FIRST_CHECK: Duration = Duration::from_secs(10);
pub const CHECK_INTERVAL: Duration = Duration::from_secs(24 * 60 * 60);
pub const RETRY_AFTER: Duration = Duration::from_secs(60 * 60);
/// 下载进度最多每 100ms 推送一次快照
const PROGRESS_INTERVAL: Duration = Duration::from_millis(100);
/// 更新说明来自未签名的 latest.json，只保留这么多字符
const NOTES_LIMIT: usize = 4000;
/// 调度线程在检查到期前至少睡这么久，避免在下载期间空转
const MIN_WAIT: Duration = Duration::from_secs(1);
/// 关闭检查时的兜底睡眠；重新打开开关会立即唤醒
const IDLE_WAIT: Duration = Duration::from_secs(60 * 60);

/// 版本清单里的一次发布
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Release {
    pub version: String,
    /// RFC 3339
    pub date: Option<String>,
    pub notes: Option<String>,
}

/// 下载或安装没有完成的原因
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Failure {
    Cancelled,
    Download,
    Signature,
    Install,
}

impl Failure {
    /// 取消（下载期间关闭了检查）不是错误
    pub fn error(self) -> Option<IpcError> {
        let id = match self {
            Failure::Cancelled => return None,
            Failure::Download => IpcErrorId::UpdateDownloadFailed,
            Failure::Signature => IpcErrorId::UpdateSignatureInvalid,
            Failure::Install => IpcErrorId::UpdateInstallFailed,
        };
        Some(IpcError { id, params: None })
    }
}

pub trait Source: Send + Sync {
    /// 读取版本清单；有新版本时记住它，供 `download` 使用。错误只写日志
    fn check(&self) -> Result<Option<Release>, String>;
    /// 下载最近一次检查到的版本，并用内置公钥校验签名。`progress` 收到累计字节数和总大小（可能未知）
    fn download(
        &self,
        progress: &mut dyn FnMut(u64, Option<u64>),
        cancelled: &dyn Fn() -> bool,
    ) -> Result<Vec<u8>, Failure>;
    /// 再次校验后运行安装程序。Windows 上成功时 CloudLink 随即退出，不会返回
    fn install(&self, package: &[u8]) -> Result<(), Failure>;
}

/// 接上真实更新源之前使用：从不报告新版本
pub struct NoSource;

impl Source for NoSource {
    fn check(&self) -> Result<Option<Release>, String> {
        Ok(None)
    }

    fn download(
        &self,
        _progress: &mut dyn FnMut(u64, Option<u64>),
        _cancelled: &dyn Fn() -> bool,
    ) -> Result<Vec<u8>, Failure> {
        Err(Failure::Download)
    }

    fn install(&self, _package: &[u8]) -> Result<(), Failure> {
        Err(Failure::Install)
    }
}

struct State {
    enabled: bool,
    status: UpdateStatus,
    next_check: Option<Instant>,
    checking: bool,
    /// 开关每切换一次加一：开关切换前就已发出的检查，结果直接丢弃
    generation: u64,
    download: Option<Arc<AtomicBool>>,
    /// 下好并通过签名校验、等用户重启安装的安装包（ready）
    package: Option<Vec<u8>>,
}

pub struct Updates {
    events: Arc<dyn EventSink>,
    source: Mutex<Arc<dyn Source>>,
    state: Mutex<State>,
    wake: Condvar,
}

impl Updates {
    pub fn new(current_version: &str, events: Arc<dyn EventSink>, enabled: bool, now: Instant) -> Self {
        Updates {
            events,
            source: Mutex::new(Arc::new(NoSource)),
            state: Mutex::new(State {
                enabled,
                status: UpdateStatus::idle(current_version),
                next_check: enabled.then(|| now + FIRST_CHECK),
                checking: false,
                generation: 0,
                download: None,
                package: None,
            }),
            wake: Condvar::new(),
        }
    }

    pub fn set_source(&self, source: Arc<dyn Source>) {
        *self.source.lock().unwrap_or_else(PoisonError::into_inner) = source;
    }

    fn source(&self) -> Arc<dyn Source> {
        Arc::clone(&self.source.lock().unwrap_or_else(PoisonError::into_inner))
    }

    fn lock(&self) -> MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    pub fn current_version(&self) -> String {
        self.lock().status.current_version.clone()
    }

    /// 桌面应用启动时换成 Tauri 的包版本：更新插件用它和清单比较，界面和活动记录要显示同一个版本
    pub fn set_current_version(&self, version: &str) {
        self.lock().status.current_version = version.into();
    }

    pub fn status(&self) -> UpdateStatus {
        self.lock().status.clone()
    }

    pub fn next_check(&self) -> Option<Instant> {
        self.lock().next_check
    }

    /// 持有状态锁时推送，保证快照按顺序到达前端
    fn publish(&self, state: &mut State, status: UpdateStatus) {
        if state.status != status {
            state.status = status;
            self.events
                .emit("update://changed", serde_json::json!({ "status": state.status }));
        }
    }

    /// F-406 AC6：关闭时立即停止检查并隐藏提醒（进行中的下载一并取消，下好的安装包丢弃）；重新打开时立即检查一次
    pub fn set_enabled(&self, enabled: bool, now: Instant) {
        let mut state = self.lock();
        if state.enabled == enabled {
            return;
        }
        state.enabled = enabled;
        state.generation += 1;
        if enabled {
            state.next_check = Some(now);
        } else {
            state.next_check = None;
            if let Some(cancel) = &state.download {
                cancel.store(true, Ordering::SeqCst);
            }
            if state.status.state != UpdateState::Installing {
                state.package = None;
                let idle = UpdateStatus::idle(&state.status.current_version);
                self.publish(&mut state, idle);
            }
        }
        self.wake.notify_all();
    }

    /// 检查到期时执行一次检查，返回是否执行了。下载中、已下好或安装期间不检查
    pub fn check_if_due(&self, now: Instant) -> bool {
        let generation = {
            let mut state = self.lock();
            let due = state.enabled
                && !state.checking
                && state.next_check.is_some_and(|at| at <= now)
                && matches!(state.status.state, UpdateState::Idle | UpdateState::Available);
            if !due {
                return false;
            }
            state.checking = true;
            state.generation
        };
        // 网络请求期间不持有状态锁
        let result = self.source().check();
        let mut state = self.lock();
        state.checking = false;
        if state.generation != generation {
            return true;
        }
        match result {
            Ok(release) => {
                state.next_check = Some(now + CHECK_INTERVAL);
                if matches!(state.status.state, UpdateState::Idle | UpdateState::Available) {
                    let status = match release {
                        Some(release) => self.available(&state.status, release),
                        None => UpdateStatus::idle(&state.status.current_version),
                    };
                    self.publish(&mut state, status);
                }
            }
            Err(message) => {
                // F-406：检查失败不打扰用户，只写日志
                log::warn!("CloudLink update check failed: {message}");
                state.next_check = Some(now + RETRY_AFTER);
            }
        }
        true
    }

    fn available(&self, previous: &UpdateStatus, release: Release) -> UpdateStatus {
        // 同一个版本保留上次安装失败的原因，定时检查不冲掉用户正在看的提示
        let error = (previous.version.as_deref() == Some(release.version.as_str()))
            .then(|| previous.error.clone())
            .flatten();
        UpdateStatus {
            state: UpdateState::Available,
            current_version: previous.current_version.clone(),
            version: Some(release.version),
            date: release.date,
            notes: release.notes.as_deref().and_then(plain_notes),
            downloaded: None,
            total: None,
            error,
        }
    }

    /// 后台调度线程：随进程结束
    pub fn spawn_scheduler(self: &Arc<Self>) -> std::io::Result<()> {
        let updates = Arc::clone(self);
        std::thread::Builder::new()
            .name("cloudlink-updates".into())
            .spawn(move || {
                loop {
                    // 发现新版本（或上次下载失败后又检查到它）就接着在这个线程里下载，下好才提醒
                    if updates.check_if_due(Instant::now()) {
                        updates.download_pending();
                    }
                    let state = updates.lock();
                    let wait = match state.next_check {
                        Some(due) if state.enabled => due.saturating_duration_since(Instant::now()).max(MIN_WAIT),
                        _ => IDLE_WAIT,
                    };
                    drop(
                        updates
                            .wake
                            .wait_timeout(state, wait)
                            .unwrap_or_else(PoisonError::into_inner),
                    );
                }
            })
            .map(drop)
    }

    /// 下载并校验最近一次检查到的版本，成功后进入「已下好」。调度线程发现新版本后、用户在下载失败后点「重试」时调用；
    /// 已经在下载、已下好、正在安装或没有新版本时什么也不做
    pub fn download_pending(&self) {
        let Ok(Some(cancel)) = self.begin_download() else {
            return;
        };
        match self.download(&cancel) {
            Ok(package) => self.mark_ready(&cancel, package),
            Err(failure) => self.abort(failure.error()),
        }
    }

    /// 「有新版本」→「下载中」。已经在下载、已下好或正在安装时返回 `None`；没有可下载的版本时返回 `NotFound`
    pub fn begin_download(&self) -> crate::error::Result<Option<Arc<AtomicBool>>> {
        let mut state = self.lock();
        match state.status.state {
            UpdateState::Available if state.enabled => {}
            UpdateState::Downloading | UpdateState::Ready | UpdateState::Installing => return Ok(None),
            _ => return Err(crate::error::AppError::ipc(IpcErrorId::NotFound)),
        }
        let cancel = Arc::new(AtomicBool::new(false));
        state.download = Some(Arc::clone(&cancel));
        let mut status = state.status.clone();
        status.state = UpdateState::Downloading;
        status.downloaded = Some(0);
        status.total = None;
        status.error = None;
        self.publish(&mut state, status);
        Ok(Some(cancel))
    }

    /// 下载并校验签名，同时推送进度
    pub fn download(&self, cancel: &AtomicBool) -> Result<Vec<u8>, Failure> {
        let mut last: Option<Instant> = None;
        let mut progress = |downloaded: u64, total: Option<u64>| {
            let now = Instant::now();
            let finished = total.is_some_and(|total| downloaded >= total);
            if !finished && last.is_some_and(|at| now.duration_since(at) < PROGRESS_INTERVAL) {
                return;
            }
            last = Some(now);
            let mut state = self.lock();
            if state.status.state != UpdateState::Downloading {
                return;
            }
            let mut status = state.status.clone();
            status.downloaded = Some(downloaded);
            status.total = total;
            self.publish(&mut state, status);
        };
        let cancelled = || cancel.load(Ordering::SeqCst);
        self.source().download(&mut progress, &cancelled)
    }

    /// 下载或安装没有完成：回到「有新版本」并带上原因；这期间关闭了检查时回到 idle
    pub fn abort(&self, error: Option<IpcError>) {
        let mut state = self.lock();
        state.download = None;
        let status = if state.enabled && state.status.version.is_some() {
            let mut status = state.status.clone();
            status.state = UpdateState::Available;
            status.downloaded = None;
            status.total = None;
            status.error = error;
            status
        } else {
            UpdateStatus::idle(&state.status.current_version)
        };
        self.publish(&mut state, status);
        self.wake.notify_all();
    }

    /// 「下载中」→「已下好」：顶栏这时才出现「更新」。下载期间关闭了检查时安装包直接丢弃
    fn mark_ready(&self, cancel: &AtomicBool, package: Vec<u8>) {
        let mut state = self.lock();
        if !state.enabled || cancel.load(Ordering::SeqCst) || state.status.state != UpdateState::Downloading {
            drop(state);
            return self.abort(None);
        }
        state.download = None;
        state.package = Some(package);
        let mut status = state.status.clone();
        status.state = UpdateState::Ready;
        status.error = None;
        self.publish(&mut state, status);
    }

    /// 「已下好」→「正在安装」，交出版本号和安装包。没有下好的安装包或检查已关闭时返回 `None`
    pub fn mark_installing(&self) -> Option<(String, Vec<u8>)> {
        let mut state = self.lock();
        if !state.enabled || state.status.state != UpdateState::Ready {
            return None;
        }
        let package = state.package.take()?;
        let mut status = state.status.clone();
        status.state = UpdateState::Installing;
        status.error = None;
        self.publish(&mut state, status);
        Some((state.status.version.clone()?, package))
    }

    pub fn install(&self, package: &[u8]) -> Result<(), Failure> {
        self.source().install(package)
    }

    /// 安装没有完成：留着安装包回到「已下好」并带上原因，用户可以再点一次「重启以更新」
    pub fn install_failed(&self, error: Option<IpcError>, package: Vec<u8>) {
        let mut state = self.lock();
        if !state.enabled || state.status.state != UpdateState::Installing {
            let idle = UpdateStatus::idle(&state.status.current_version);
            return self.publish(&mut state, idle);
        }
        state.package = Some(package);
        let mut status = state.status.clone();
        status.state = UpdateState::Ready;
        status.error = error;
        self.publish(&mut state, status);
    }
}

/// 更新说明按不可信纯文本处理：统一换行、去掉控制字符、限制长度
fn plain_notes(notes: &str) -> Option<String> {
    let text: String = notes
        .replace("\r\n", "\n")
        .replace('\r', "\n")
        .chars()
        .filter(|c| !c.is_control() || matches!(c, '\n' | '\t'))
        .take(NOTES_LIMIT)
        .collect();
    let text = text.trim();
    (!text.is_empty()).then(|| text.to_string())
}
