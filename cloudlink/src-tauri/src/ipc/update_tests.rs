//! F-406 的后端集成测试：忙碌判定、安装前的活动记录和设置开关。路径全部隔离，更新源是假的。

use std::fs;
use std::sync::Arc;
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};

use serde_json::json;

use super::Backend;
use super::requests::SettingsPatch;
use crate::cli;
use crate::env::FakeSystem;
use crate::model::asset::{Asset, CliProvider};
use crate::model::misc::{ActivityKind, ActivityMessageId, ActivityQuery, IpcErrorId, UpdateState};
use crate::paths::Paths;
use crate::secret::store::MemoryCredentialStore;
use crate::testkit;
use crate::update::tests::{FakeDownload, FakeSource, StatusEvents, release};
use crate::update::{FIRST_CHECK, Failure};

struct Fixture {
    backend: Arc<Backend>,
    source: Arc<FakeSource>,
    events: Arc<StatusEvents>,
    _temp: tempfile::TempDir,
}

impl Fixture {
    /// 已发现 0.2.0 的后端；`hk-edge` 已保存，用来验证等待任务时带上服务器名
    fn with_update(download: FakeDownload) -> Self {
        let temp = tempfile::tempdir().unwrap();
        let paths = Paths::isolated_in(temp.path());
        fs::create_dir_all(&paths.data_dir).unwrap();
        fs::write(
            paths.data_dir.join(".cloudlink.json"),
            serde_json::to_vec(&json!({ "managedBy": "cloudlink", "kind": "data" })).unwrap(),
        )
        .unwrap();
        let events = Arc::new(StatusEvents::default());
        let backend = Backend::with_services(
            paths,
            Arc::new(FakeSystem::from_env()),
            Arc::new(MemoryCredentialStore::default()),
            cli::Service::new(Arc::new(cli::EmptyRunner)),
            events.clone(),
        )
        .unwrap();
        backend
            .database()
            .unwrap()
            .upsert_asset(&Asset::Vps(testkit::hk_edge()))
            .unwrap();
        let source = FakeSource::new(download);
        backend.updates.set_source(source.clone());
        source.answer(Ok(Some(release("0.2.0"))));
        assert!(backend.updates.check_if_due(Instant::now() + FIRST_CHECK));
        assert_eq!(backend.update_status().state, UpdateState::Available);
        events.take();
        Fixture {
            backend,
            source,
            events,
            _temp: temp,
        }
    }

    fn busy_params(&self) -> (String, Option<String>) {
        let error = self.backend.install_update().unwrap_err().to_ipc();
        assert_eq!(error.id, IpcErrorId::UpdateBusy);
        let params = serde_json::to_value(error.params.unwrap()).unwrap();
        (
            params["task"].as_str().unwrap().into(),
            params["name"].as_str().map(String::from),
        )
    }

    fn wait_for(&self, state: UpdateState) {
        let deadline = Instant::now() + Duration::from_secs(5);
        while self.backend.update_status().state != state {
            assert!(Instant::now() < deadline, "update never reached {state:?}");
            std::thread::sleep(Duration::from_millis(5));
        }
    }
}

#[test]
fn a_running_probe_blocks_installing_and_names_the_server() {
    let fixture = Fixture::with_update(FakeDownload::Package(vec![1, 2, 3]));
    let probe = fixture.backend.probes.hold_for_test(testkit::hk_edge().id.as_str());
    assert_eq!(fixture.busy_params(), ("probe".into(), Some("hk-edge".into())));
    // 不开始下载，提醒照旧
    assert_eq!(fixture.backend.update_status().state, UpdateState::Available);
    assert!(fixture.events.take().is_empty());

    probe.store(true, Ordering::SeqCst);
    fixture.backend.install_update().unwrap();
    fixture.wait_for(UpdateState::Installing);
    let installed = fixture.source.installed.lock().unwrap().clone();
    assert_eq!(installed, vec![vec![1, 2, 3]]);

    // F-406 AC5：退出前写一条活动记录
    let activity = fixture
        .backend
        .list_activity(ActivityQuery {
            before: None,
            limit: 10,
            kinds: Some(vec![ActivityKind::Update]),
            asset_id: None,
        })
        .unwrap();
    assert_eq!(activity.len(), 1);
    assert_eq!(activity[0].message_id, ActivityMessageId::UpdateInstalling);
    let params = serde_json::to_value(activity[0].params.as_ref().unwrap()).unwrap();
    assert_eq!(params, json!({ "from": env!("CARGO_PKG_VERSION"), "to": "0.2.0" }));
}

#[test]
fn cli_detection_and_publishing_block_installing() {
    let fixture = Fixture::with_update(FakeDownload::Package(vec![1]));
    {
        let _run = fixture.backend.cli_run(CliProvider::Cloudflare);
        assert_eq!(fixture.busy_params(), ("cli".into(), Some("cloudflare".into())));
    }
    {
        let _edit = fixture.backend.mutation.lock().unwrap();
        assert_eq!(fixture.busy_params(), ("publish".into(), None));
    }
    fixture.backend.credential_writes.fetch_add(1, Ordering::SeqCst);
    assert_eq!(fixture.busy_params(), ("publish".into(), None));
    fixture.backend.credential_writes.fetch_sub(1, Ordering::SeqCst);
    assert!(fixture.source.installed.lock().unwrap().is_empty());
    assert_eq!(fixture.backend.update_status().state, UpdateState::Available);
}

#[test]
fn a_rejected_signature_is_never_installed() {
    let fixture = Fixture::with_update(FakeDownload::Fail(Failure::Signature));
    fixture.backend.install_update().unwrap();
    let deadline = Instant::now() + Duration::from_secs(5);
    while fixture.backend.update_status().error.is_none() {
        assert!(Instant::now() < deadline, "the signature failure was never reported");
        std::thread::sleep(Duration::from_millis(5));
    }
    let status = fixture.backend.update_status();
    assert_eq!(status.state, UpdateState::Available);
    assert_eq!(status.error.unwrap().id, IpcErrorId::UpdateSignatureInvalid);
    assert!(fixture.source.installed.lock().unwrap().is_empty());
    assert!(
        fixture
            .backend
            .list_activity(ActivityQuery {
                before: None,
                limit: 10,
                kinds: Some(vec![ActivityKind::Update]),
                asset_id: None,
            })
            .unwrap()
            .is_empty()
    );
}

#[test]
fn a_failed_installer_returns_to_available_and_releases_the_publish_lock() {
    let fixture = Fixture::with_update(FakeDownload::Package(vec![9]));
    *fixture.source.install_result.lock().unwrap() = Err(Failure::Install);
    fixture.backend.install_update().unwrap();
    let deadline = Instant::now() + Duration::from_secs(5);
    while fixture.backend.update_status().error.is_none() {
        assert!(Instant::now() < deadline, "the install failure was never reported");
        std::thread::sleep(Duration::from_millis(5));
    }
    assert_eq!(
        fixture.backend.update_status().error.unwrap().id,
        IpcErrorId::UpdateInstallFailed
    );
    assert!(fixture.backend.mutation.try_lock().is_ok());
}

#[test]
fn the_settings_switch_controls_checking() {
    let fixture = Fixture::with_update(FakeDownload::Package(vec![1]));
    assert!(fixture.backend.get_settings().unwrap().auto_check_updates);

    let settings = fixture
        .backend
        .update_settings(SettingsPatch {
            auto_check_updates: Some(false),
            ..Default::default()
        })
        .unwrap();
    assert!(!settings.auto_check_updates);
    assert!(!fixture.backend.get_settings().unwrap().auto_check_updates);
    assert_eq!(fixture.backend.update_status().state, UpdateState::Idle);
    assert_eq!(fixture.backend.updates.next_check(), None);
    assert!(
        fixture
            .backend
            .install_update()
            .unwrap_err()
            .is_ipc(IpcErrorId::NotFound)
    );

    let before = Instant::now();
    fixture
        .backend
        .update_settings(SettingsPatch {
            auto_check_updates: Some(true),
            ..Default::default()
        })
        .unwrap();
    let next = fixture.backend.updates.next_check().unwrap();
    assert!(next >= before && next <= Instant::now());
}
