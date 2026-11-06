//! F-406：用假的更新源覆盖定时、开关、失败重试、下载进度、取消和签名失败；不访问网络。

use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde_json::Value;

use super::plugin::is_loopback_url;
use super::*;
use crate::ipc::EventSink;

#[derive(Default)]
pub(crate) struct StatusEvents(Mutex<Vec<Value>>);

impl EventSink for StatusEvents {
    fn emit(&self, event: &str, payload: Value) {
        if event == "update://changed" {
            self.0.lock().unwrap().push(payload["status"].clone());
        }
    }
}

impl StatusEvents {
    pub(crate) fn take(&self) -> Vec<Value> {
        std::mem::take(&mut *self.0.lock().unwrap())
    }
}

pub(crate) enum FakeDownload {
    Package(Vec<u8>),
    Fail(Failure),
    /// 先报告一块进度，然后一直等到被取消
    UntilCancelled,
}

pub(crate) struct FakeSource {
    pub checks: Mutex<VecDeque<Result<Option<Release>, String>>>,
    pub calls: AtomicUsize,
    pub download: Mutex<FakeDownload>,
    pub started: AtomicBool,
    pub installed: Mutex<Vec<Vec<u8>>>,
    pub install_result: Mutex<Result<(), Failure>>,
}

impl FakeSource {
    pub(crate) fn new(download: FakeDownload) -> Arc<Self> {
        Arc::new(FakeSource {
            checks: Mutex::new(VecDeque::new()),
            calls: AtomicUsize::new(0),
            download: Mutex::new(download),
            started: AtomicBool::new(false),
            installed: Mutex::new(Vec::new()),
            install_result: Mutex::new(Ok(())),
        })
    }

    pub(crate) fn answer(&self, result: Result<Option<Release>, String>) {
        self.checks.lock().unwrap().push_back(result);
    }

    fn calls(&self) -> usize {
        self.calls.load(Ordering::SeqCst)
    }
}

impl Source for FakeSource {
    fn check(&self) -> Result<Option<Release>, String> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        self.checks.lock().unwrap().pop_front().unwrap_or(Ok(None))
    }

    fn download(
        &self,
        progress: &mut dyn FnMut(u64, Option<u64>),
        cancelled: &dyn Fn() -> bool,
    ) -> Result<Vec<u8>, Failure> {
        let package = match &*self.download.lock().unwrap() {
            FakeDownload::Package(package) => package.clone(),
            FakeDownload::Fail(failure) => return Err(*failure),
            FakeDownload::UntilCancelled => {
                progress(1024, Some(8192));
                self.started.store(true, Ordering::SeqCst);
                let deadline = Instant::now() + Duration::from_secs(5);
                while !cancelled() {
                    assert!(Instant::now() < deadline, "download was never cancelled");
                    std::thread::sleep(Duration::from_millis(5));
                }
                return Err(Failure::Cancelled);
            }
        };
        let total = package.len() as u64;
        for end in [total / 3, total] {
            progress(end, Some(total));
        }
        Ok(package)
    }

    fn install(&self, package: &[u8]) -> Result<(), Failure> {
        self.installed.lock().unwrap().push(package.to_vec());
        *self.install_result.lock().unwrap()
    }
}

pub(crate) fn release(version: &str) -> Release {
    Release {
        version: version.into(),
        date: Some("2026-11-20T08:00:00Z".into()),
        notes: Some("Faster probes\r\n- Fixes\u{7}\n".into()),
    }
}

fn setup(enabled: bool, download: FakeDownload, now: Instant) -> (Arc<Updates>, Arc<FakeSource>, Arc<StatusEvents>) {
    let events = Arc::new(StatusEvents::default());
    let updates = Arc::new(Updates::new("0.1.0", events.clone(), enabled, now));
    let source = FakeSource::new(download);
    updates.set_source(source.clone());
    (updates, source, events)
}

fn available(now: Instant, download: FakeDownload) -> (Arc<Updates>, Arc<FakeSource>, Arc<StatusEvents>) {
    let (updates, source, events) = setup(true, download, now);
    source.answer(Ok(Some(release("0.2.0"))));
    assert!(updates.check_if_due(now + FIRST_CHECK));
    events.take();
    (updates, source, events)
}

#[test]
fn the_package_version_replaces_the_crate_version_everywhere() {
    let start = Instant::now();
    let (updates, source, events) = setup(true, FakeDownload::Fail(Failure::Download), start);
    updates.set_current_version("0.1.1");
    assert_eq!(updates.current_version(), "0.1.1");
    assert_eq!(updates.status(), UpdateStatus::idle("0.1.1"));
    // 启动时还没有订阅者，换版本号不推送
    assert!(events.take().is_empty());

    source.answer(Ok(Some(release("0.2.0"))));
    assert!(updates.check_if_due(start + FIRST_CHECK));
    assert_eq!(updates.status().current_version, "0.1.1");
    updates.set_enabled(false, start + FIRST_CHECK);
    assert_eq!(updates.status(), UpdateStatus::idle("0.1.1"));
}

#[test]
fn first_check_runs_ten_seconds_after_start_then_daily() {
    let start = Instant::now();
    let (updates, source, events) = setup(true, FakeDownload::Fail(Failure::Download), start);
    assert_eq!(updates.next_check(), Some(start + FIRST_CHECK));
    assert!(!updates.check_if_due(start + Duration::from_secs(9)));
    assert_eq!(source.calls(), 0);

    assert!(updates.check_if_due(start + FIRST_CHECK));
    assert_eq!(source.calls(), 1);
    // 没有新版本：不推送任何快照
    assert!(events.take().is_empty());
    let next = start + FIRST_CHECK + CHECK_INTERVAL;
    assert_eq!(updates.next_check(), Some(next));
    assert!(!updates.check_if_due(next - Duration::from_secs(1)));
    assert_eq!(source.calls(), 1);

    source.answer(Ok(Some(release("0.2.0"))));
    assert!(updates.check_if_due(next));
    let status = updates.status();
    assert_eq!(status.state, UpdateState::Available);
    assert_eq!(status.current_version, "0.1.0");
    assert_eq!(status.version.as_deref(), Some("0.2.0"));
    assert_eq!(status.date.as_deref(), Some("2026-11-20T08:00:00Z"));
    assert_eq!(status.notes.as_deref(), Some("Faster probes\n- Fixes"));
    assert_eq!(events.take().len(), 1);
    assert_eq!(updates.next_check(), Some(next + CHECK_INTERVAL));
}

#[test]
fn failed_check_stays_quiet_and_retries_after_an_hour() {
    let start = Instant::now();
    let (updates, source, events) = setup(true, FakeDownload::Fail(Failure::Download), start);
    source.answer(Err("offline".into()));
    assert!(updates.check_if_due(start + FIRST_CHECK));
    assert_eq!(updates.status(), UpdateStatus::idle("0.1.0"));
    assert!(events.take().is_empty());
    let retry = start + FIRST_CHECK + RETRY_AFTER;
    assert_eq!(updates.next_check(), Some(retry));
    assert!(!updates.check_if_due(retry - Duration::from_secs(1)));

    source.answer(Ok(Some(release("0.2.0"))));
    assert!(updates.check_if_due(retry));
    assert_eq!(updates.status().state, UpdateState::Available);
    events.take();

    // 已经发现的新版本不会因为之后一次检查失败而消失
    source.answer(Err("offline".into()));
    assert!(updates.check_if_due(retry + CHECK_INTERVAL));
    assert_eq!(updates.status().state, UpdateState::Available);
    assert!(events.take().is_empty());
}

#[test]
fn switched_off_never_checks_and_switching_on_checks_at_once() {
    let start = Instant::now();
    let (updates, source, events) = setup(false, FakeDownload::Fail(Failure::Download), start);
    assert_eq!(updates.next_check(), None);
    assert!(!updates.check_if_due(start + Duration::from_secs(30 * 24 * 3600)));
    assert_eq!(source.calls(), 0);

    let later = start + Duration::from_secs(600);
    source.answer(Ok(Some(release("0.2.0"))));
    updates.set_enabled(true, later);
    assert_eq!(updates.next_check(), Some(later));
    assert!(updates.check_if_due(later));
    assert_eq!(source.calls(), 1);
    assert_eq!(updates.status().state, UpdateState::Available);

    // 关闭后立即隐藏提醒，也不再检查
    events.take();
    updates.set_enabled(false, later);
    assert_eq!(updates.status(), UpdateStatus::idle("0.1.0"));
    let pushed = events.take();
    assert_eq!(pushed.len(), 1);
    assert_eq!(pushed[0]["state"], "idle");
    assert!(!updates.check_if_due(later + CHECK_INTERVAL * 3));
    assert_eq!(source.calls(), 1);
}

#[test]
fn a_check_running_while_switched_off_is_discarded() {
    let start = Instant::now();
    let events = Arc::new(StatusEvents::default());
    let updates = Arc::new(Updates::new("0.1.0", events.clone(), true, start));

    struct SwitchOffDuringCheck(Mutex<Option<Arc<Updates>>>);
    impl Source for SwitchOffDuringCheck {
        fn check(&self) -> Result<Option<Release>, String> {
            if let Some(updates) = self.0.lock().unwrap().take() {
                updates.set_enabled(false, Instant::now());
            }
            Ok(Some(release("0.2.0")))
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

    updates.set_source(Arc::new(SwitchOffDuringCheck(Mutex::new(Some(updates.clone())))));
    assert!(updates.check_if_due(start + FIRST_CHECK));
    assert_eq!(updates.status(), UpdateStatus::idle("0.1.0"));
    assert!(events.take().is_empty());
}

#[test]
fn download_reports_progress_then_installs() {
    let start = Instant::now();
    let package = vec![7u8; 3 * 1024];
    let (updates, source, events) = available(start, FakeDownload::Package(package.clone()));

    let cancel = updates.begin_download().unwrap().expect("download starts");
    // 已经在下载时，再点一次不会开始第二次下载
    assert!(updates.begin_download().unwrap().is_none());
    // 下载期间不检查
    assert!(!updates.check_if_due(start + CHECK_INTERVAL * 2));

    let downloaded = updates.download(&cancel).unwrap();
    assert_eq!(downloaded, package);
    let pushed = events.take();
    assert_eq!(pushed[0]["state"], "downloading");
    assert_eq!(pushed[0]["downloaded"], 0);
    let last = pushed.last().unwrap();
    assert_eq!(last["downloaded"], 3 * 1024);
    assert_eq!(last["total"], 3 * 1024);

    assert_eq!(updates.mark_installing().as_deref(), Some("0.2.0"));
    assert_eq!(updates.status().state, UpdateState::Installing);
    updates.install(&downloaded).unwrap();
    assert_eq!(*source.installed.lock().unwrap(), vec![package]);
}

#[test]
fn signature_failure_returns_to_available_with_the_reason() {
    let start = Instant::now();
    let (updates, source, events) = available(start, FakeDownload::Fail(Failure::Signature));
    let cancel = updates.begin_download().unwrap().unwrap();
    let failure = updates.download(&cancel).unwrap_err();
    assert_eq!(failure, Failure::Signature);
    updates.abort(failure.error());

    let status = updates.status();
    assert_eq!(status.state, UpdateState::Available);
    assert_eq!(status.version.as_deref(), Some("0.2.0"));
    assert_eq!(status.downloaded, None);
    assert_eq!(
        status.error.as_ref().map(|e| e.id),
        Some(IpcErrorId::UpdateSignatureInvalid)
    );
    assert_eq!(events.take().last().unwrap()["error"]["id"], "update-signature-invalid");

    // 同一个版本的定时检查保留失败原因；重试会清掉它
    source.answer(Ok(Some(release("0.2.0"))));
    assert!(updates.check_if_due(start + FIRST_CHECK + CHECK_INTERVAL));
    assert!(updates.status().error.is_some());
    updates.begin_download().unwrap().unwrap();
    assert_eq!(updates.status().error, None);
}

#[test]
fn download_and_install_failures_map_to_their_error_ids() {
    assert_eq!(Failure::Cancelled.error(), None);
    assert_eq!(Failure::Download.error().unwrap().id, IpcErrorId::UpdateDownloadFailed);
    assert_eq!(
        Failure::Signature.error().unwrap().id,
        IpcErrorId::UpdateSignatureInvalid
    );
    assert_eq!(Failure::Install.error().unwrap().id, IpcErrorId::UpdateInstallFailed);
}

fn run_until_cancelled(
    updates: &Arc<Updates>,
    source: &FakeSource,
) -> std::thread::JoinHandle<Result<Vec<u8>, Failure>> {
    let cancel = updates.begin_download().unwrap().unwrap();
    let worker = {
        let updates = updates.clone();
        std::thread::spawn(move || updates.download(&cancel))
    };
    let deadline = Instant::now() + Duration::from_secs(5);
    while !source.started.load(Ordering::SeqCst) {
        assert!(Instant::now() < deadline, "download never started");
        std::thread::sleep(Duration::from_millis(5));
    }
    worker
}

#[test]
fn cancelling_a_download_returns_to_available_without_an_error() {
    let start = Instant::now();
    let (updates, source, events) = available(start, FakeDownload::UntilCancelled);
    let worker = run_until_cancelled(&updates, &source);
    assert_eq!(updates.status().downloaded, Some(1024));
    updates.cancel();
    let failure = worker.join().unwrap().unwrap_err();
    assert_eq!(failure, Failure::Cancelled);
    updates.abort(failure.error());

    let status = updates.status();
    assert_eq!(status.state, UpdateState::Available);
    assert_eq!(status.error, None);
    assert_eq!(status.downloaded, None);
    assert_eq!(events.take().last().unwrap()["state"], "available");
}

#[test]
fn switching_off_during_a_download_cancels_it_and_hides_the_reminder() {
    let start = Instant::now();
    let (updates, source, _events) = available(start, FakeDownload::UntilCancelled);
    let worker = run_until_cancelled(&updates, &source);
    updates.set_enabled(false, Instant::now());
    assert_eq!(updates.status().state, UpdateState::Idle);
    let failure = worker.join().unwrap().unwrap_err();
    assert_eq!(failure, Failure::Cancelled);
    assert_eq!(updates.mark_installing(), None);
    updates.abort(failure.error());
    assert_eq!(updates.status(), UpdateStatus::idle("0.1.0"));
    assert!(source.installed.lock().unwrap().is_empty());
}

#[test]
fn nothing_to_install_without_a_new_version() {
    let start = Instant::now();
    let (updates, _source, _events) = setup(true, FakeDownload::Fail(Failure::Download), start);
    let error = updates.begin_download().unwrap_err();
    assert!(error.is_ipc(IpcErrorId::NotFound));
    // 没有下载时取消什么也不做
    updates.cancel();
    assert_eq!(updates.status(), UpdateStatus::idle("0.1.0"));
}

#[test]
fn release_notes_are_bounded_plain_text() {
    assert_eq!(plain_notes("a\r\nb\rc\u{1b}[31m\td").as_deref(), Some("a\nb\nc[31m\td"));
    assert_eq!(plain_notes(" \n\u{0} ").as_deref(), None);
    let long = "界".repeat(NOTES_LIMIT + 10);
    assert_eq!(plain_notes(&long).unwrap().chars().count(), NOTES_LIMIT);
}

#[test]
fn isolated_instances_only_accept_loopback_endpoints() {
    for url in [
        "http://127.0.0.1:8765/latest.json",
        "http://localhost/latest.json",
        "https://LOCALHOST:443/x",
        "http://[::1]:9000/latest.json",
        "http://127.0.0.1?x=1",
    ] {
        assert!(is_loopback_url(url), "{url}");
    }
    for url in [
        "https://github.com/Furina-he/cloudlink/releases/latest/download/latest.json",
        "http://127.0.0.1@evil.example/latest.json",
        "http://127.0.0.1:80@evil.example/latest.json",
        "http://localhost.evil.example/latest.json",
        "http://127.0.0.2/latest.json",
        "file:///C:/latest.json",
        "http://127.0.0.1:99999999/latest.json",
    ] {
        assert!(!is_loopback_url(url), "{url}");
    }
}
