use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use super::assets::connection_matches;
use super::backend::{Backend, check_ancestors};
use crate::error::{AppError, Result};
use crate::model::asset::*;
use crate::model::connection::*;
use crate::model::env::EnvId;
use crate::model::misc::*;
use crate::model::probe::*;
use crate::params;
use crate::probe;
use crate::secret::SecretString;
use crate::ssh::{
    self,
    connect::{TestOutcome, TestTarget, TrustRegistry},
    managed::ManagedHost,
};

#[derive(Clone)]
pub(super) struct ConnectionProof {
    pub env_id: EnvId,
    pub at: String,
}

struct ConnectionJob {
    epoch: u64,
    connection: ConnectionInput,
    asset_id: Option<String>,
    env_id: EnvId,
    cancel: Arc<AtomicBool>,
    outcome: Option<TestOutcome>,
    at: String,
    expires: Instant,
    started: Instant,
    /// Successful persisted verification, with finer precision than its RFC3339 display time.
    completed: Option<Instant>,
    baseline_verified: Option<Option<ConnectionVerified>>,
    consumed: bool,
}

struct ConnectionAttempt {
    id: String,
    epoch: u64,
    connection: ConnectionInput,
    asset_id: Option<String>,
    env_id: EnvId,
    cancel: Arc<AtomicBool>,
    expires: Instant,
    started: Instant,
    baseline_verified: Option<Option<ConnectionVerified>>,
}

struct ConversionJob {
    asset_id: String,
    cancel: Arc<AtomicBool>,
}

struct ConversionGuard<'a> {
    registry: &'a ConnectionJobs,
    id: String,
    cancel: Arc<AtomicBool>,
}

impl Drop for ConversionGuard<'_> {
    fn drop(&mut self) {
        self.cancel.store(true, Ordering::SeqCst);
        if let Ok(mut jobs) = self.registry.conversions.lock() {
            jobs.remove(&self.id);
        }
    }
}

#[derive(Default)]
pub(super) struct ConnectionJobs {
    jobs: Mutex<HashMap<String, ConnectionJob>>,
    trust: TrustRegistry,
    conversions: Mutex<HashMap<String, ConversionJob>>,
    stopping: AtomicBool,
}

impl ConnectionJobs {
    pub fn proof(&self, id: &str, connection: &ConnectionInput) -> Result<ConnectionProof> {
        if self.stopping.load(Ordering::SeqCst) {
            return Err(AppError::ipc(IpcErrorId::NotFound));
        }
        let jobs = self
            .jobs
            .lock()
            .map_err(|_| AppError::internal("connection state unavailable"))?;
        let job = jobs
            .get(id)
            .filter(|j| {
                !j.consumed
                    && !j.cancel.load(Ordering::SeqCst)
                    && j.expires > Instant::now()
                    && j.connection == *connection
                    && j.outcome.as_ref().is_some_and(|o| o.status == ConnectionTestStatus::Ok)
            })
            .ok_or_else(|| AppError::ipc(IpcErrorId::NotFound))?;
        Ok(ConnectionProof {
            env_id: job.env_id.clone(),
            at: job.at.clone(),
        })
    }

    pub fn consume(&self, id: &str) {
        if let Ok(mut jobs) = self.jobs.lock()
            && let Some(job) = jobs.get_mut(id)
        {
            job.consumed = true;
        }
        self.trust.cancel(id);
    }

    fn expire(&self, id: &str, expected: Instant, now: Instant) -> bool {
        let Ok(mut jobs) = self.jobs.lock() else { return false };
        if !jobs
            .get(id)
            .is_some_and(|job| job.expires == expected && job.expires <= now)
        {
            return false;
        }
        if let Some(job) = jobs.remove(id) {
            job.cancel.store(true, Ordering::SeqCst);
        }
        // Keep the job mutex until trust cancellation so a refreshed attempt cannot race it.
        self.trust.cancel(id);
        true
    }

    fn begin_conversion(&self, asset_id: &str) -> Result<ConversionGuard<'_>> {
        if self.stopping.load(Ordering::SeqCst) {
            return Err(AppError::ipc(IpcErrorId::NotFound));
        }
        let mut jobs = self
            .conversions
            .lock()
            .map_err(|_| AppError::internal("conversion state unavailable"))?;
        if jobs
            .values()
            .any(|job| job.asset_id == asset_id && !job.cancel.load(Ordering::SeqCst))
        {
            return Err(AppError::ipc(IpcErrorId::SettingsInvalid));
        }
        let id = crate::new_id("key");
        let cancel = Arc::new(AtomicBool::new(false));
        jobs.insert(
            id.clone(),
            ConversionJob {
                asset_id: asset_id.into(),
                cancel: cancel.clone(),
            },
        );
        Ok(ConversionGuard {
            registry: self,
            id,
            cancel,
        })
    }
}

struct ProbeJob {
    asset_id: String,
    cancel: Arc<AtomicBool>,
    active: bool,
    expires: Instant,
    started: Instant,
}

#[derive(Default)]
pub(super) struct ProbeJobs {
    jobs: Mutex<HashMap<String, ProbeJob>>,
}

impl Backend {
    pub fn start_test(self: &Arc<Self>, mut req: ConnectionTestRequest) -> Result<String> {
        let epoch = self.reset_epoch.load(Ordering::SeqCst);
        if self.connections.stopping.load(Ordering::SeqCst) {
            return Err(AppError::ipc(IpcErrorId::NotFound));
        }
        let env_id = req.env_id.clone().unwrap_or_else(EnvId::windows);
        let env = self.context(&env_id)?;
        let supplied = req.password.take().map(SecretString::new).transpose()?;
        let managed = managed_target(&req.connection, &env_id);
        if let Some(h) = &managed {
            h.validate(env.is_windows())?;
        }
        if !ssh::validate::alias_ok(req.connection.ssh_alias()) {
            return Err(AppError::ipc(IpcErrorId::SettingsInvalid));
        }
        let target = TestTarget {
            env,
            alias: req.connection.ssh_alias().into(),
            managed,
            password: supplied,
        };
        let _edit = self.edit_at(epoch)?;
        if self.connections.stopping.load(Ordering::SeqCst) {
            return Err(AppError::ipc(IpcErrorId::NotFound));
        }
        let baseline_verified = match req.asset_id.as_deref() {
            Some(asset_id) => {
                let saved = self.database()?.require_asset(asset_id)?;
                let server = saved.as_server().ok_or_else(|| AppError::ipc(IpcErrorId::NotFound))?;
                connection_matches(&server.connection, &req.connection).then(|| server.connection.verified.clone())
            }
            None => None,
        };
        let id = crate::new_id("test");
        let cancel = Arc::new(AtomicBool::new(false));
        let started = Instant::now();
        let expires = started + ssh::connect::TRUST_TTL;
        self.connections
            .jobs
            .lock()
            .map_err(|_| AppError::internal("connection state unavailable"))?
            .insert(
                id.clone(),
                ConnectionJob {
                    epoch,
                    connection: req.connection,
                    asset_id: req.asset_id,
                    env_id,
                    cancel,
                    outcome: None,
                    at: crate::time::now_rfc3339(),
                    expires,
                    started,
                    completed: None,
                    baseline_verified,
                    consumed: false,
                },
            );
        drop(_edit);
        self.spawn_connection(id.clone(), target, None)?;
        Ok(id)
    }

    fn spawn_connection(
        self: &Arc<Self>,
        id: String,
        mut target: TestTarget,
        fingerprint: Option<String>,
    ) -> Result<()> {
        let mut attempt = {
            let jobs = self
                .connections
                .jobs
                .lock()
                .map_err(|_| AppError::internal("connection state unavailable"))?;
            let job = jobs.get(&id).ok_or_else(|| AppError::ipc(IpcErrorId::NotFound))?;
            ConnectionAttempt {
                id: id.clone(),
                epoch: job.epoch,
                connection: job.connection.clone(),
                asset_id: job.asset_id.clone(),
                env_id: job.env_id.clone(),
                cancel: job.cancel.clone(),
                expires: job.expires,
                started: job.started,
                baseline_verified: job.baseline_verified.clone(),
            }
        };
        let expected = attempt.expires;
        let backend = self.clone();
        let spawned = std::thread::Builder::new()
            .name("cloudlink-connection".into())
            .spawn(move || {
                let result: Result<TestOutcome> = (|| {
                    if backend.connections.stopping.load(Ordering::SeqCst) || attempt.cancel.load(Ordering::SeqCst) {
                        return Ok(cancelled_test());
                    }
                    if !target.env.is_windows()
                        && (target.password.is_some()
                            || target
                                .managed
                                .as_ref()
                                .is_some_and(|host| host.method == AuthMethod::Password))
                    {
                        return Ok(failed_test(SshErrorId::NeedsInteraction, &target.alias));
                    }
                    if target.password.is_none()
                        && target
                            .managed
                            .as_ref()
                            .is_some_and(|h| h.method == AuthMethod::Password)
                    {
                        let asset_id = attempt
                            .asset_id
                            .as_deref()
                            .ok_or_else(|| AppError::ipc(IpcErrorId::PasswordMissing))?;
                        target.password =
                            Some(backend.saved_password(asset_id, &attempt.connection, &attempt.cancel)?);
                    }
                    if attempt.cancel.load(Ordering::SeqCst) || attempt.expires <= Instant::now() {
                        return Ok(cancelled_test());
                    }
                    if (backend.paths.isolated && target.env.distro().is_some())
                        || (cfg!(test) && backend.tools()?.windows_ssh == Path::new(DEFAULT_WINDOWS_SSH))
                    {
                        return Ok(failed_test(SshErrorId::NeedsInteraction, &target.alias));
                    }
                    Ok(ssh::connect::run_test(
                        &backend.tools()?,
                        &backend.paths.tmp_dir(),
                        &target,
                        fingerprint.as_deref(),
                        Some(&attempt.cancel),
                    ))
                })();
                let outcome = result.unwrap_or_else(|e| {
                    failed_test(
                        if e.is_ipc(IpcErrorId::PasswordTargetChanged) {
                            SshErrorId::PasswordRejected
                        } else {
                            SshErrorId::Unknown
                        },
                        &target.alias,
                    )
                });
                let completed = backend.finish_connection_attempt(&mut attempt, &target, &outcome);
                drop(target.password.take());
                if matches!(completed, Ok(Some(_))) {
                    backend.schedule_connection_expiry(attempt.id, attempt.expires);
                }
            });
        if spawned.is_err() {
            self.connections.expire(&id, expected, expected);
            return Err(AppError::internal("could not start connection worker"));
        }
        self.schedule_connection_expiry(id, expected);
        Ok(())
    }

    fn schedule_connection_expiry(self: &Arc<Self>, id: String, expires: Instant) {
        let backend = Arc::downgrade(self);
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(expires.saturating_duration_since(Instant::now())).await;
            if let Some(backend) = backend.upgrade() {
                backend.connections.expire(&id, expires, Instant::now());
            }
        });
    }

    /// A saved revision is read only for the persisted endpoint, with no vault call under a state lock.
    fn saved_password(
        &self,
        asset_id: &str,
        connection: &ConnectionInput,
        cancel: &AtomicBool,
    ) -> Result<SecretString> {
        if self.connections.stopping.load(Ordering::SeqCst) || cancel.load(Ordering::SeqCst) {
            return Err(AppError::ipc(IpcErrorId::NotFound));
        }
        let key = {
            let db = self.database()?;
            let saved = db.require_asset(asset_id)?;
            ssh::connect::saved_password_allowed(
                saved.as_server().ok_or_else(|| AppError::ipc(IpcErrorId::NotFound))?,
                connection,
            )?;
            db.password_ref(asset_id)?
                .ok_or_else(|| AppError::ipc(IpcErrorId::PasswordMissing))?
        };
        let password = self
            .credentials
            .get(&key)?
            .ok_or_else(|| AppError::ipc(IpcErrorId::PasswordMissing))?;
        if self.connections.stopping.load(Ordering::SeqCst) || cancel.load(Ordering::SeqCst) {
            return Err(AppError::ipc(IpcErrorId::NotFound));
        }
        let db = self.database()?;
        let current = db.require_asset(asset_id)?;
        ssh::connect::saved_password_allowed(
            current.as_server().ok_or_else(|| AppError::ipc(IpcErrorId::NotFound))?,
            connection,
        )?;
        if db.password_ref(asset_id)?.as_deref() != Some(key.as_str()) {
            return Err(AppError::ipc(IpcErrorId::PasswordTargetChanged));
        }
        Ok(password)
    }

    fn finish_connection_attempt(
        &self,
        attempt: &mut ConnectionAttempt,
        target: &TestTarget,
        outcome: &TestOutcome,
    ) -> Result<Option<TestOutcome>> {
        // Keep the original epoch through every completion side effect. A cancelled
        // worker can return from the unlocked vault/SSH call after reset has finished.
        let _edit = self.edit_at(attempt.epoch)?;
        let outcome = match self.record_connection_attempt(attempt, target, outcome) {
            Ok(Some(outcome)) => outcome,
            Ok(None) => return Ok(None), // a refreshed attempt owns this same test ID now
            Err(_) => failed_test(SshErrorId::Unknown, &target.alias),
        };
        self.emit(
            "connection://tested",
            &ConnectionTestedEvent {
                test_id: attempt.id.clone(),
                status: outcome.status,
                ms: Some(outcome.ms),
                remote_os: outcome.remote_os.clone(),
                error: outcome.error.clone(),
                host_key: outcome.host_key.clone(),
            },
        );
        let _ = self.activity(
            ActivityKind::Connection,
            if outcome.status == ConnectionTestStatus::Ok {
                ActivityMessageId::TestOk
            } else {
                ActivityMessageId::TestFailed
            },
            attempt.asset_id.as_deref(),
            params! {"alias" => target.alias.as_str(), "ms" => outcome.ms},
            outcome.status == ConnectionTestStatus::Ok,
        );
        Ok(Some(outcome))
    }

    /// The caller holds the mutation lock through the result, events, and activity.
    fn record_connection_attempt(
        &self,
        attempt: &mut ConnectionAttempt,
        target: &TestTarget,
        outcome: &TestOutcome,
    ) -> Result<Option<TestOutcome>> {
        let mut jobs = self
            .connections
            .jobs
            .lock()
            .map_err(|_| AppError::internal("connection state unavailable"))?;
        let Some(job) = jobs.get(&attempt.id).filter(|j| j.expires == attempt.expires) else {
            return Ok(None);
        };
        if self.connections.stopping.load(Ordering::SeqCst)
            || job.consumed
            || job.cancel.load(Ordering::SeqCst)
            || job.expires <= Instant::now()
        {
            return Ok(Some(cancelled_test()));
        }
        let outcome = outcome.clone();
        let newer_success = jobs.values().any(|job| {
            job.asset_id == attempt.asset_id
                && job.completed.is_some_and(|completed| completed > attempt.started)
                && job
                    .outcome
                    .as_ref()
                    .is_some_and(|o| o.status == ConnectionTestStatus::Ok)
        });
        let mut changed = false;
        if outcome.status != ConnectionTestStatus::Cancelled
            && let Some(asset_id) = &attempt.asset_id
        {
            let mut asset = self.database()?.require_asset(asset_id)?;
            let Asset::Vps(server) = &mut asset else {
                return Err(AppError::ipc(IpcErrorId::NotFound));
            };
            let can_record = connection_matches(&server.connection, &attempt.connection)
                && (outcome.status == ConnectionTestStatus::Ok
                    || (!newer_success && attempt.baseline_verified.as_ref() == Some(&server.connection.verified)));
            if can_record {
                let mut verified = server.connection.verified.take().unwrap_or(ConnectionVerified {
                    ok: false,
                    at: String::new(),
                    env_ids: Vec::new(),
                });
                verified.ok = outcome.status == ConnectionTestStatus::Ok;
                verified.at = crate::time::now_rfc3339();
                if verified.ok && !verified.env_ids.contains(&attempt.env_id) {
                    verified.env_ids.push(attempt.env_id.clone());
                }
                server.connection.verified = Some(verified);
                self.database()?.upsert_asset(&asset)?;
                changed = true;
            }
        }
        let job = jobs
            .get_mut(&attempt.id)
            .ok_or_else(|| AppError::ipc(IpcErrorId::NotFound))?;
        job.at = crate::time::now_rfc3339();
        job.expires = Instant::now() + ssh::connect::TRUST_TTL;
        attempt.expires = job.expires;
        job.outcome = Some(outcome.clone());
        job.completed = (changed && outcome.status == ConnectionTestStatus::Ok).then(Instant::now);
        if outcome.status == ConnectionTestStatus::HostKey
            && let Some(key) = outcome.host_key.as_ref().filter(|key| key.known == HostKeyKnown::New)
        {
            self.connections
                .trust
                .insert(&attempt.id, target.clone(), key.fingerprint.clone());
        }
        drop(jobs);
        if changed {
            self.publish_locked()?;
        }
        Ok(Some(outcome))
    }

    pub fn cancel_connection_test(&self, id: &str) -> Result<()> {
        if let Some(job) = self
            .connections
            .jobs
            .lock()
            .map_err(|_| AppError::internal("connection state unavailable"))?
            .get_mut(id)
        {
            job.cancel.store(true, Ordering::SeqCst);
            job.consumed = true;
        }
        self.connections.trust.cancel(id);
        Ok(())
    }

    pub fn trust_host_key(self: &Arc<Self>, id: &str, fingerprint: &str) -> Result<()> {
        let _edit = self.edit()?;
        let trust = {
            let mut jobs = self
                .connections
                .jobs
                .lock()
                .map_err(|_| AppError::internal("connection state unavailable"))?;
            let job = jobs
                .get_mut(id)
                .filter(|j| {
                    !j.consumed
                        && !j.cancel.load(Ordering::SeqCst)
                        && j.expires > Instant::now()
                        && j.outcome
                            .as_ref()
                            .is_some_and(|o| o.status == ConnectionTestStatus::HostKey)
                })
                .ok_or_else(|| AppError::ipc(IpcErrorId::NotFound))?;
            let trust = self.connections.trust.take(id, fingerprint)?;
            if let Some(asset_id) = &job.asset_id {
                let saved = self.database()?.require_asset(asset_id)?;
                job.baseline_verified = saved
                    .as_server()
                    .filter(|s| connection_matches(&s.connection, &job.connection))
                    .map(|s| s.connection.verified.clone());
            }
            job.outcome = None;
            job.started = Instant::now();
            job.completed = None;
            job.expires = job.started + ssh::connect::TRUST_TTL;
            trust
        };
        drop(_edit);
        self.spawn_connection(id.to_string(), trust.target, Some(trust.fingerprint))
    }

    pub fn convert_to_key_auth(self: &Arc<Self>, asset_id: &str) -> Result<Asset> {
        let epoch = self.reset_epoch.load(Ordering::SeqCst);
        let conversion = {
            let _edit = self.edit_at(epoch)?;
            self.connections.begin_conversion(asset_id)?
        };
        let (snapshot, key) = {
            let db = self.database()?;
            (
                db.require_asset(asset_id)?,
                db.password_ref(asset_id)?
                    .ok_or_else(|| AppError::ipc(IpcErrorId::PasswordMissing))?,
            )
        };
        let server = snapshot
            .as_server()
            .ok_or_else(|| AppError::ipc(IpcErrorId::NotFound))?;
        if server
            .connection
            .auth
            .as_ref()
            .is_none_or(|a| a.method != AuthMethod::Password)
        {
            return Err(AppError::ipc(IpcErrorId::SettingsInvalid));
        }
        let input = connection_input(&server.connection);
        let password = self.saved_password(asset_id, &input, &conversion.cancel)?;
        let env = self.context(&EnvId::windows())?;
        self.check_data_ownership()?;
        check_ancestors(&env.host_in_home(&[".ssh"]))?;
        let host = ManagedHost::from_asset(&snapshot, &env).ok_or_else(|| AppError::ipc(IpcErrorId::NotFound))?;
        let target = TestTarget {
            env: env.clone(),
            alias: host.alias.clone(),
            managed: Some(host),
            password: Some(password),
        };
        let tools = self.tools()?;
        if cfg!(test) && tools.windows_ssh == Path::new(DEFAULT_WINDOWS_SSH) {
            return Err(AppError::ipc(IpcErrorId::ConnectionFailed));
        }
        if conversion.cancel.load(Ordering::SeqCst) {
            return Err(AppError::ipc(IpcErrorId::NotFound));
        }
        let converted = ssh::keyconv::convert_to_key(&tools, &self.paths.tmp_dir(), &target, Some(&conversion.cancel)).map_err(|e| AppError::ipc_with(IpcErrorId::ConnectionFailed, params! {"alias" => server.connection.ssh_alias.clone(), "error" => serde_json::to_value(e.id).ok().and_then(|v|v.as_str().map(String::from)).unwrap_or_default()}))?;
        // Persist ownership even if cancellation or a target edit prevents attaching this new key.
        let mut asset = {
            let _edit = self.edit_at(epoch)?;
            self.record_pending_key_files(&env, &converted.identity_file)?;
            if conversion.cancel.load(Ordering::SeqCst) {
                return Err(AppError::ipc(IpcErrorId::NotFound));
            }
            let mut current = self.database()?.require_asset(asset_id)?;
            if !same_target(&current, &snapshot)
                || self.database()?.password_ref(asset_id)?.as_deref() != Some(key.as_str())
            {
                return Err(AppError::ipc(IpcErrorId::PasswordTargetChanged));
            }
            let Asset::Vps(s) = &mut current else {
                return Err(AppError::ipc(IpcErrorId::NotFound));
            };
            let auth = s
                .connection
                .auth
                .as_mut()
                .ok_or_else(|| AppError::ipc(IpcErrorId::NotFound))?;
            ssh::keyconv::apply_key_auth(auth, env.id.clone(), converted.identity_file.clone());
            s.connection.verified = Some(ConnectionVerified {
                ok: true,
                at: crate::time::now_rfc3339(),
                env_ids: vec![env.id.clone()],
            });
            s.updated_at = crate::time::now_rfc3339();
            self.record_generated_key(asset_id, Path::new(&converted.identity_file))?;
            self.database()?.replace_password_ref(&current, None)?;
            self.write_managed_configs()?;
            self.publish_locked()?;
            current
        };
        self.retry_credential_cleanup();
        // Only CloudLink-created copies are registered. Original user identity files are never deleted.
        let converted_snapshot = asset.clone();
        if let Asset::Vps(s) = &asset {
            let mut copied = Vec::new();
            for wsl in self
                .contexts(false)?
                .iter()
                .filter(|e| e.distro().is_some() && e.available && s.connection.defined_in.contains(&e.id))
            {
                match self.copy_key_to_wsl_at(
                    &converted.identity_file,
                    &wsl.id,
                    epoch,
                    Some((&converted_snapshot, &conversion.cancel)),
                ) {
                    Ok(native) => copied.push((wsl.id.clone(), native)),
                    Err(error)
                        if error.is_ipc(IpcErrorId::ResetIncomplete)
                            || error.is_ipc(IpcErrorId::NotFound)
                            || error.is_ipc(IpcErrorId::PasswordTargetChanged) =>
                    {
                        return Err(error);
                    }
                    Err(_) => log::warn!("could not copy a generated key into WSL; the Windows key remains usable"),
                }
            }
            if !copied.is_empty() {
                let _edit = self.edit_at(epoch)?;
                let mut current = self.conversion_asset_locked(&converted_snapshot, &conversion.cancel)?;
                if let Asset::Vps(s) = &mut current
                    && let Some(auth) = &mut s.connection.auth
                {
                    for (env_id, path) in copied {
                        auth.identity_file.insert(env_id, path);
                    }
                }
                self.database()?.upsert_asset_guarded(&current)?;
                self.write_managed_configs()?;
                self.publish_locked()?;
                asset = current;
            }
        }
        self.finish_conversion_at(epoch, &asset, &conversion.cancel)
    }

    fn finish_conversion_at(&self, epoch: u64, snapshot: &Asset, cancel: &AtomicBool) -> Result<Asset> {
        let _edit = self.edit_at(epoch)?;
        self.conversion_asset_locked(snapshot, cancel)
    }

    /// Called under the original conversion's epoch/mutation guard.
    fn conversion_asset_locked(&self, snapshot: &Asset, cancel: &AtomicBool) -> Result<Asset> {
        if self.connections.stopping.load(Ordering::SeqCst) || cancel.load(Ordering::SeqCst) {
            return Err(AppError::ipc(IpcErrorId::NotFound));
        }
        let current = self.database()?.require_asset(snapshot.id())?;
        if current.created_at() != snapshot.created_at() || !same_target(&current, snapshot) {
            return Err(AppError::ipc(IpcErrorId::PasswordTargetChanged));
        }
        Ok(current)
    }

    pub fn copy_key_to_wsl(&self, source: &str, env_id: &EnvId) -> Result<String> {
        let epoch = self.reset_epoch.load(Ordering::SeqCst);
        self.copy_key_to_wsl_at(source, env_id, epoch, None)
    }

    fn copy_key_to_wsl_at(
        &self,
        source: &str,
        env_id: &EnvId,
        epoch: u64,
        conversion: Option<(&Asset, &AtomicBool)>,
    ) -> Result<String> {
        let _edit = self.edit_at(epoch)?;
        if self.connections.stopping.load(Ordering::SeqCst) {
            return Err(AppError::ipc(IpcErrorId::NotFound));
        }
        if let Some((snapshot, cancel)) = conversion {
            self.conversion_asset_locked(snapshot, cancel)?;
        }
        let env = self.context(env_id)?;
        if env.is_windows() || !Path::new(source).is_absolute() {
            return Err(AppError::ipc(IpcErrorId::SettingsInvalid));
        }
        check_ancestors(Path::new(source))?;
        let source_public = crate::secret::keygen::pub_path(Path::new(source));
        check_ancestors(&source_public)?;
        match fs::symlink_metadata(&source_public) {
            Ok(meta) if crate::fsx::is_link(&meta) || !meta.is_file() => {
                return Err(AppError::ipc(IpcErrorId::SettingsInvalid));
            }
            Err(error) if error.kind() != std::io::ErrorKind::NotFound => return Err(error.into()),
            _ => {}
        }
        check_ancestors(&env.host_in_home(&[".ssh"]))?;
        self.check_data_ownership()?;
        let native = ssh::keyconv::copy_key_to_wsl(Path::new(source), &env)?;
        self.record_pending_key_files(&env, &native)?;
        if !self.paths.isolated && !cfg!(test) {
            ssh::keyconv::wsl_chmod_private(&env, &native)?;
        }
        Ok(native)
    }

    fn record_pending_key_files(&self, env: &crate::env::EnvContext, native: &str) -> Result<()> {
        self.check_data_ownership()?;
        let host = env.to_host(native);
        for path in [host.clone(), crate::secret::keygen::pub_path(&host)] {
            check_ancestors(&path)?;
            match fs::symlink_metadata(&path) {
                Ok(meta) if !crate::fsx::is_link(&meta) && meta.is_file() => {
                    let bytes = zeroize::Zeroizing::new(fs::read(&path)?);
                    let hash = crate::compile::publish::tree_hash([("", bytes.as_slice())]);
                    self.database()?
                        .record_pending_key(env.id.as_str(), native, &path.to_string_lossy(), &hash)?;
                }
                Err(error) if error.kind() == std::io::ErrorKind::NotFound && path != host => {}
                Err(error) => return Err(error.into()),
                _ => return Err(AppError::ipc(IpcErrorId::SettingsInvalid)),
            }
        }
        Ok(())
    }

    pub fn start_probe(self: &Arc<Self>, asset_id: &str) -> Result<String> {
        let epoch = self.reset_epoch.load(Ordering::SeqCst);
        if self.connections.stopping.load(Ordering::SeqCst) {
            return Err(AppError::ipc(IpcErrorId::NotFound));
        }
        let _edit = self.edit_at(epoch)?;
        let snapshot = self.database()?.require_asset(asset_id)?;
        let server = snapshot
            .as_server()
            .ok_or_else(|| AppError::ipc(IpcErrorId::NotFound))?
            .clone();
        let env = self
            .contexts(true)?
            .into_iter()
            .find(|e| e.available && server.connection.defined_in.contains(&e.id))
            .ok_or_else(|| AppError::ipc(IpcErrorId::NotFound))?;
        let run_id = crate::new_id("prb");
        let cancel = Arc::new(AtomicBool::new(false));
        let started = Instant::now();
        let expires = started + Duration::from_secs(30);
        {
            let mut jobs = self
                .probes
                .jobs
                .lock()
                .map_err(|_| AppError::internal("probe state unavailable"))?;
            if jobs.values().any(|j| {
                j.asset_id == asset_id && j.active && !j.cancel.load(Ordering::SeqCst) && j.expires > Instant::now()
            }) {
                return Err(AppError::ipc(IpcErrorId::SettingsInvalid));
            }
            jobs.retain(|_, j| j.asset_id != asset_id);
            jobs.insert(
                run_id.clone(),
                ProbeJob {
                    asset_id: asset_id.into(),
                    cancel: cancel.clone(),
                    active: true,
                    expires,
                    started,
                },
            );
        }
        drop(_edit);
        let backend = self.clone();
        let id = run_id.clone();
        let spawned = std::thread::Builder::new()
            .name("cloudlink-probe".into())
            .spawn(move || {
                let started = Instant::now();
                let result = (|| {
                    if !backend.probe_live(&id, snapshot.id()) {
                        return Err(probe::ExecuteError::Cancelled);
                    }
                    if (backend.paths.isolated && env.distro().is_some()) || cfg!(test) {
                        return Err(probe::ExecuteError::Failed(SshError::new(
                            SshErrorId::NeedsInteraction,
                            params! {"alias" => snapshot.handle()},
                        )));
                    }
                    let password = if server
                        .connection
                        .auth
                        .as_ref()
                        .is_some_and(|a| a.method == AuthMethod::Password)
                    {
                        if !env.is_windows() {
                            return Err(probe::ExecuteError::Failed(SshError::new(
                                SshErrorId::NeedsInteraction,
                                params! {"alias" => snapshot.handle()},
                            )));
                        }
                        Some(
                            backend
                                .saved_password(snapshot.id(), &connection_input(&server.connection), &cancel)
                                .map_err(|error| {
                                    probe::ExecuteError::Failed(SshError::new(
                                        if error.is_ipc(IpcErrorId::PasswordTargetChanged)
                                            || error.is_ipc(IpcErrorId::PasswordMissing)
                                        {
                                            SshErrorId::PasswordRejected
                                        } else {
                                            SshErrorId::Unknown
                                        },
                                        params! {"alias" => snapshot.handle()},
                                    ))
                                })?,
                        )
                    } else {
                        None
                    };
                    if !backend.probe_live(&id, snapshot.id()) {
                        return Err(probe::ExecuteError::Cancelled);
                    }
                    let current = backend
                        .database()
                        .and_then(|db| db.require_asset(snapshot.id()))
                        .map_err(|_| {
                            probe::ExecuteError::Failed(SshError::new(
                                SshErrorId::Unknown,
                                params! {"alias" => snapshot.handle()},
                            ))
                        })?;
                    if !same_target(&snapshot, &current) {
                        return Err(probe::ExecuteError::Cancelled);
                    }
                    let mut progress = |step, status, ms| {
                        let _ = backend.emit_probe_progress_at(
                            epoch,
                            &ProbeProgressEvent {
                                run_id: id.clone(),
                                asset_id: snapshot.id().into(),
                                step,
                                status,
                                ms,
                            },
                        );
                    };
                    probe::execute(
                        &backend
                            .tools()
                            .map_err(|_| probe::ExecuteError::Failed(SshError::new(SshErrorId::Unknown, params! {})))?,
                        &env,
                        snapshot.handle(),
                        password.as_ref(),
                        Duration::from_secs(u64::from(
                            backend
                                .get_settings()
                                .map_err(|_| {
                                    probe::ExecuteError::Failed(SshError::new(SshErrorId::Unknown, params! {}))
                                })?
                                .probe_timeout_sec,
                        )),
                        &cancel,
                        &mut progress,
                    )
                })();
                let result = if !backend.probe_live(&id, snapshot.id()) {
                    Err(probe::ExecuteError::Cancelled)
                } else {
                    result
                };
                let mut event = ProbeFinishedEvent {
                    run_id: id.clone(),
                    asset_id: snapshot.id().into(),
                    status: ProbeFinishedStatus::Failed,
                    error: None,
                    applied: None,
                    held: None,
                    duration_ms: Some(started.elapsed().as_millis().min(u128::from(u32::MAX)) as u32),
                    finished_at: Some(crate::time::now_rfc3339()),
                };
                match result {
                    Ok(data) => match backend.apply_probe_data(&id, &snapshot, &env.id, &data) {
                        Ok(merged) => {
                            event.status = ProbeFinishedStatus::Ok;
                            event.error = merged.partial;
                            event.applied = Some(merged.applied);
                            event.held = Some(merged.held);
                        }
                        Err(error)
                            if error.is_ipc(IpcErrorId::NotFound)
                                || error.is_ipc(IpcErrorId::PasswordTargetChanged) =>
                        {
                            event.status = ProbeFinishedStatus::Cancelled;
                        }
                        Err(_) => {
                            event.error = Some(SshError::new(
                                SshErrorId::Unknown,
                                params! {"alias" => snapshot.handle()},
                            ));
                        }
                    },
                    Err(probe::ExecuteError::Cancelled) => {
                        event.status = ProbeFinishedStatus::Cancelled;
                    }
                    Err(probe::ExecuteError::Failed(e)) => {
                        event.error = Some(e);
                        let _ = backend.record_probe_failure(snapshot.id(), &id, &snapshot);
                    }
                }
                let _ = backend.finish_probe_at(epoch, &mut event);
            });
        if spawned.is_err() {
            if let Ok(mut jobs) = self.probes.jobs.lock()
                && let Some(job) = jobs.remove(&run_id)
            {
                job.cancel.store(true, Ordering::SeqCst);
            }
            return Err(AppError::internal("could not start probe worker"));
        }
        let backend = Arc::downgrade(self);
        let expiry_id = run_id.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(expires.saturating_duration_since(Instant::now())).await;
            if let Some(backend) = backend.upgrade()
                && let Ok(mut jobs) = backend.probes.jobs.lock()
                && jobs
                    .get(&expiry_id)
                    .is_some_and(|job| job.expires == expires && job.expires <= Instant::now())
                && let Some(job) = jobs.remove(&expiry_id)
            {
                job.cancel.store(true, Ordering::SeqCst);
            }
        });
        Ok(run_id)
    }

    fn emit_probe_progress_at(&self, epoch: u64, event: &ProbeProgressEvent) -> Result<()> {
        let _edit = self.edit_at(epoch)?;
        if self.probe_live(&event.run_id, &event.asset_id) {
            self.emit("probe://progress", event);
        }
        Ok(())
    }

    fn finish_probe_at(&self, epoch: u64, event: &mut ProbeFinishedEvent) -> Result<()> {
        let _edit = self.edit_at(epoch)?;
        if self.connections.stopping.load(Ordering::SeqCst) {
            return Ok(());
        }
        let mut jobs = self
            .probes
            .jobs
            .lock()
            .map_err(|_| AppError::internal("probe state unavailable"))?;
        let cancelled = match jobs.get_mut(&event.run_id).filter(|job| job.asset_id == event.asset_id) {
            Some(job) => {
                job.active = false;
                job.cancel.load(Ordering::SeqCst) || job.expires <= Instant::now()
            }
            None => true,
        };
        if cancelled {
            event.status = ProbeFinishedStatus::Cancelled;
            event.error = None;
            event.applied = None;
            event.held = None;
        }
        drop(jobs);
        self.emit("probe://finished", event);
        Ok(())
    }

    fn probe_live(&self, run_id: &str, asset_id: &str) -> bool {
        !self.connections.stopping.load(Ordering::SeqCst)
            && self.probes.jobs.lock().is_ok_and(|jobs| {
                jobs.get(run_id).is_some_and(|job| {
                    job.asset_id == asset_id
                        && job.active
                        && !job.cancel.load(Ordering::SeqCst)
                        && job.expires > Instant::now()
                })
            })
    }

    pub(super) fn apply_probe_data(
        &self,
        run_id: &str,
        snapshot: &Asset,
        env_id: &EnvId,
        data: &probe::ProbeData,
    ) -> Result<probe::MergeResult> {
        let _edit = self.edit()?;
        let mut jobs = self
            .probes
            .jobs
            .lock()
            .map_err(|_| AppError::internal("probe state unavailable"))?;
        let job = jobs
            .get_mut(run_id)
            .filter(|job| {
                job.asset_id == snapshot.id()
                    && job.active
                    && !job.cancel.load(Ordering::SeqCst)
                    && job.expires > Instant::now()
            })
            .ok_or_else(|| AppError::ipc(IpcErrorId::NotFound))?;
        if self.connections.stopping.load(Ordering::SeqCst) {
            return Err(AppError::ipc(IpcErrorId::NotFound));
        }
        let current = self.database()?.require_asset(snapshot.id())?;
        if !same_target(snapshot, &current) {
            return Err(AppError::ipc(IpcErrorId::PasswordTargetChanged));
        }
        let before_server = snapshot
            .as_server()
            .ok_or_else(|| AppError::ipc(IpcErrorId::NotFound))?;
        let current_server = current.as_server().ok_or_else(|| AppError::ipc(IpcErrorId::NotFound))?;
        if current_server.probe != before_server.probe {
            return Err(AppError::ipc(IpcErrorId::NotFound));
        }
        if !data.valid {
            return Err(AppError::ipc(IpcErrorId::SettingsInvalid));
        }
        let data = preserve_probe_edits(before_server, current_server, data);
        let now = crate::time::now_rfc3339();
        let mut merged = probe::merge(current_server, &data, run_id, &now);
        if let Some(verified) = &mut merged.asset.connection.verified
            && !verified.env_ids.contains(env_id)
        {
            verified.env_ids.push(env_id.clone());
        }
        let after = Asset::Vps(merged.asset.clone());
        self.database()?
            .commit_probe_snapshot(run_id, &now, &current, &after, &serde_json::to_value(&merged)?)?;
        job.active = false;
        drop(jobs);
        self.emit(
            "probe://progress",
            &ProbeProgressEvent {
                run_id: run_id.into(),
                asset_id: current.id().into(),
                step: ProbeStep::Merge,
                status: ProbeStepStatus::Done,
                ms: None,
            },
        );
        self.publish_locked()?;
        self.activity(
            ActivityKind::Probe,
            if !merged.held.is_empty() {
                ActivityMessageId::ProbeHeld
            } else if merged.applied.is_empty() {
                ActivityMessageId::ProbeNoChanges
            } else {
                ActivityMessageId::ProbeUpdated
            },
            Some(current.id()),
            params! {"alias" => current.handle(), "count" => merged.applied.len(), "held" => merged.held.len()},
            true,
        )?;
        Ok(merged)
    }

    fn record_probe_failure(&self, asset_id: &str, run_id: &str, snapshot: &Asset) -> Result<()> {
        let _edit = self.edit()?;
        let mut jobs = self
            .probes
            .jobs
            .lock()
            .map_err(|_| AppError::internal("probe state unavailable"))?;
        let Some(job) = jobs.get_mut(run_id).filter(|job| {
            job.asset_id == asset_id && job.active && !job.cancel.load(Ordering::SeqCst) && job.expires > Instant::now()
        }) else {
            return Ok(());
        };
        if self.connections.stopping.load(Ordering::SeqCst) {
            return Ok(());
        }
        let mut asset = self.database()?.require_asset(asset_id)?;
        if !same_target(snapshot, &asset) {
            return Ok(());
        }
        let baseline = snapshot
            .as_server()
            .ok_or_else(|| AppError::ipc(IpcErrorId::NotFound))?;
        let current = asset.as_server().ok_or_else(|| AppError::ipc(IpcErrorId::NotFound))?;
        let newer_verification = self
            .connections
            .jobs
            .lock()
            .map_err(|_| AppError::internal("connection state unavailable"))?
            .values()
            .any(|connection| {
                connection.asset_id.as_deref() == Some(asset_id)
                    && connection.completed.is_some_and(|completed| completed > job.started)
                    && connection
                        .outcome
                        .as_ref()
                        .is_some_and(|outcome| outcome.status == ConnectionTestStatus::Ok)
            });
        if current.probe != baseline.probe
            || current.connection.verified != baseline.connection.verified
            || newer_verification
        {
            job.active = false;
            return Ok(());
        }
        if let Asset::Vps(s) = &mut asset {
            s.probe.last_run_id = Some(run_id.into());
            s.probe.status = ProbeState::Failed;
            if let Some(v) = &mut s.connection.verified {
                v.ok = false;
            }
        }
        self.database()?.upsert_asset(&asset)?;
        job.active = false;
        drop(jobs);
        self.publish_locked()?;
        Ok(())
    }

    pub fn cancel_probe(&self, run_id: &str) -> Result<()> {
        if let Some(job) = self
            .probes
            .jobs
            .lock()
            .map_err(|_| AppError::internal("probe state unavailable"))?
            .get_mut(run_id)
        {
            job.cancel.store(true, Ordering::SeqCst);
            job.active = false;
        }
        Ok(())
    }

    pub fn confirm_probe_items(&self, run_id: &str, ids: &[String]) -> Result<SaveResult> {
        let _edit = self.edit()?;
        let result = self
            .database()?
            .probe_result(run_id)?
            .ok_or_else(|| AppError::ipc(IpcErrorId::NotFound))?;
        let mut merged: probe::MergeResult = serde_json::from_value(result)?;
        if ids.is_empty() || ids.iter().any(|id| !merged.held.iter().any(|c| &c.id == id)) {
            return Err(AppError::ipc(IpcErrorId::NotFound));
        }
        let current = self.database()?.require_asset(&merged.asset.id)?;
        let server = probe::confirm(
            current.as_server().ok_or_else(|| AppError::ipc(IpcErrorId::NotFound))?,
            &merged,
            ids,
        )?;
        let probe_after = probe::confirm(&merged.asset, &merged, ids)?;
        let accepted: Vec<_> = merged.held.iter().filter(|c| ids.contains(&c.id)).cloned().collect();
        merged.asset = probe_after.clone();
        merged.held.retain(|c| !ids.contains(&c.id));
        merged.applied.extend(accepted);
        let asset = Asset::Vps(server);
        self.database()?.update_probe_snapshot_with_after(
            run_id,
            &asset,
            &Asset::Vps(probe_after),
            &serde_json::to_value(&merged)?,
        )?;
        let statuses = self.publish_locked()?;
        Ok(SaveResult { asset, statuses })
    }

    pub fn undo_probe(&self, run_id: &str) -> Result<SaveResult> {
        let _edit = self.edit()?;
        let (before, after) = self
            .database()?
            .probe_snapshot(run_id)?
            .ok_or_else(|| AppError::ipc(IpcErrorId::NotFound))?;
        let current = self.database()?.require_asset(before.id())?;
        if current
            .as_server()
            .is_none_or(|server| server.probe.last_run_id.as_deref() != Some(run_id))
        {
            return Err(AppError::ipc(IpcErrorId::NotFound));
        }
        let restored = Asset::Vps(probe::undo(
            current.as_server().ok_or_else(|| AppError::ipc(IpcErrorId::NotFound))?,
            before.as_server().ok_or_else(|| AppError::ipc(IpcErrorId::NotFound))?,
            after.as_server().ok_or_else(|| AppError::ipc(IpcErrorId::NotFound))?,
        ));
        self.database()?.undo_probe_snapshot(run_id, &restored)?;
        let statuses = self.publish_locked()?;
        self.activity(
            ActivityKind::Probe,
            ActivityMessageId::ProbeUndone,
            Some(restored.id()),
            params! {"alias"=>restored.handle()},
            true,
        )?;
        Ok(SaveResult {
            asset: restored,
            statuses,
        })
    }

    pub fn cancel_asset_jobs(&self, asset_id: &str) {
        if let Ok(mut jobs) = self.connections.jobs.lock() {
            for (id, job) in jobs.iter_mut().filter(|(_, j)| j.asset_id.as_deref() == Some(asset_id)) {
                job.cancel.store(true, Ordering::SeqCst);
                self.connections.trust.cancel(id);
            }
        }
        if let Ok(mut jobs) = self.probes.jobs.lock() {
            for job in jobs.values_mut().filter(|j| j.asset_id == asset_id) {
                job.cancel.store(true, Ordering::SeqCst);
            }
        }
        if let Ok(jobs) = self.connections.conversions.lock() {
            for job in jobs.values().filter(|job| job.asset_id == asset_id) {
                job.cancel.store(true, Ordering::SeqCst);
            }
        }
    }

    pub fn cancel_all_jobs(&self) {
        self.connections.stopping.store(true, Ordering::SeqCst);
        self.cancel_jobs_for_reset();
    }

    pub(super) fn cancel_jobs_for_reset(&self) {
        if let Ok(mut jobs) = self.connections.jobs.lock() {
            for (id, job) in jobs.iter_mut() {
                job.cancel.store(true, Ordering::SeqCst);
                self.connections.trust.cancel(id);
            }
        }
        if let Ok(mut jobs) = self.probes.jobs.lock() {
            for job in jobs.values_mut() {
                job.cancel.store(true, Ordering::SeqCst);
            }
        }
        if let Ok(jobs) = self.connections.conversions.lock() {
            for job in jobs.values() {
                job.cancel.store(true, Ordering::SeqCst);
            }
        }
    }
}

fn managed_target(input: &ConnectionInput, env: &EnvId) -> Option<ManagedHost> {
    match input {
        ConnectionInput::Managed {
            ssh_alias,
            host,
            port,
            user,
            auth,
            proxy_jump,
            ..
        } => Some(ManagedHost {
            alias: ssh_alias.clone(),
            host: host.clone(),
            port: *port,
            user: user.clone(),
            method: auth.method,
            identity_file: auth.identity_file.get(env).cloned(),
            proxy_jump: proxy_jump.clone(),
        }),
        _ => None,
    }
}

fn same_target(left: &Asset, right: &Asset) -> bool {
    match (left.as_server(), right.as_server()) {
        (Some(a), Some(b)) => {
            a.connection.source == b.connection.source
                && a.connection.ssh_alias == b.connection.ssh_alias
                && a.connection.host == b.connection.host
                && a.connection.port == b.connection.port
                && a.connection.user == b.connection.user
                && a.connection.proxy_jump == b.connection.proxy_jump
                && a.connection.auth.as_ref().map(|x| (&x.method, &x.identity_file))
                    == b.connection.auth.as_ref().map(|x| (&x.method, &x.identity_file))
        }
        _ => false,
    }
}

fn connection_input(connection: &AssetConnection) -> ConnectionInput {
    if connection.source == ConnectionSource::Imported {
        ConnectionInput::Imported {
            ssh_alias: connection.ssh_alias.clone(),
        }
    } else {
        ConnectionInput::Managed {
            ssh_alias: connection.ssh_alias.clone(),
            host: connection.host.clone().unwrap_or_default(),
            port: connection.port.unwrap_or_default(),
            user: connection.user.clone().unwrap_or_default(),
            auth: AuthInput {
                method: connection.auth.as_ref().map_or(AuthMethod::Agent, |auth| auth.method),
                identity_file: connection
                    .auth
                    .as_ref()
                    .map(|auth| auth.identity_file.clone())
                    .unwrap_or_default(),
            },
            proxy_jump: connection.proxy_jump.clone().flatten(),
            defined_in: connection.defined_in.clone(),
        }
    }
}

fn same_service_observation(left: &Service, right: &Service) -> bool {
    left.kind == right.kind
        && left.name == right.name
        && left.image == right.image
        && left.ports == right.ports
        && left.missing == right.missing
        && left.sanitized == right.sanitized
}

/// Apply unaffected observations while keeping facts and service rosters edited after collection began.
fn preserve_probe_edits(before: &ServerAsset, current: &ServerAsset, data: &probe::ProbeData) -> probe::ProbeData {
    let mut data = data.clone();
    macro_rules! fact {
        ($member:ident) => {
            if before.facts.$member != current.facts.$member {
                data.facts.$member = None;
            }
        };
    }
    fact!(os);
    fact!(kernel);
    fact!(arch);
    fact!(cpu_cores);
    fact!(memory_total_mib);
    fact!(disk_total_gib);
    fact!(panel);
    if before.listening_ports != current.listening_ports {
        data.successful_sections.remove("listen");
    }
    for kind in [ServiceKind::Docker, ServiceKind::Systemd] {
        let previous: Vec<_> = before.services.iter().filter(|service| service.kind == kind).collect();
        let now: Vec<_> = current.services.iter().filter(|service| service.kind == kind).collect();
        if previous.len() != now.len()
            || previous
                .iter()
                .any(|old| !now.iter().any(|new| same_service_observation(old, new)))
        {
            data.successful_sections.remove(kind.as_str());
        }
    }
    data
}

fn cancelled_test() -> TestOutcome {
    TestOutcome {
        status: ConnectionTestStatus::Cancelled,
        ms: 0,
        remote_os: None,
        error: None,
        host_key: None,
    }
}
fn failed_test(error: SshErrorId, alias: &str) -> TestOutcome {
    TestOutcome {
        status: ConnectionTestStatus::Failed,
        ms: 0,
        remote_os: None,
        error: Some(SshError::new(error, params! {"alias"=>alias})),
        host_key: None,
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Weak;

    use super::*;
    use crate::env::FakeSystem;
    use crate::ipc::backend::EventSink;
    use crate::paths::Paths;
    use crate::secret::store::{CredentialStore, MemoryCredentialStore};
    use crate::testkit;

    const OUTPUT: &str = include_str!("../../tests/probe-fixtures/ubuntu-24.04.txt");

    struct NoEvents;
    impl EventSink for NoEvents {
        fn emit(&self, _: &str, _: serde_json::Value) {}
    }

    #[derive(Default)]
    struct CheckedEvents {
        backend: Mutex<Weak<Backend>>,
        events: Mutex<Vec<(String, serde_json::Value)>>,
    }

    impl EventSink for CheckedEvents {
        fn emit(&self, event: &str, payload: serde_json::Value) {
            if matches!(
                event,
                "connection://tested" | "activity://new" | "probe://progress" | "probe://finished"
            ) && let Some(backend) = self.backend.lock().unwrap().upgrade()
            {
                assert!(
                    backend.mutation.try_lock().is_err(),
                    "job completion escaped the reset gate"
                );
            }
            self.events.lock().unwrap().push((event.into(), payload));
        }
    }

    type VaultHook = Box<dyn FnOnce() + Send>;

    #[derive(Default)]
    struct CheckingCredentials {
        values: MemoryCredentialStore,
        reads: Mutex<Vec<String>>,
        backend: Mutex<Weak<Backend>>,
        hook: Mutex<Option<VaultHook>>,
    }

    impl CredentialStore for CheckingCredentials {
        fn get(&self, key: &str) -> Result<Option<SecretString>> {
            if let Some(backend) = self.backend.lock().unwrap().upgrade() {
                assert!(backend.db.try_lock().is_ok(), "vault read held the database lock");
                assert!(backend.mutation.try_lock().is_ok(), "vault read held the mutation lock");
            }
            self.reads.lock().unwrap().push(key.into());
            let hook = self.hook.lock().unwrap().take();
            if let Some(hook) = hook {
                hook();
            }
            self.values.get(key)
        }
        fn set(&self, key: &str, password: &SecretString) -> Result<()> {
            self.values.set(key, password)
        }
        fn delete(&self, key: &str) -> Result<()> {
            self.values.delete(key)
        }
    }

    fn fixture() -> (tempfile::TempDir, Arc<Backend>, Arc<CheckingCredentials>) {
        fixture_with_events(Arc::new(NoEvents))
    }

    fn fixture_with_events(events: Arc<dyn EventSink>) -> (tempfile::TempDir, Arc<Backend>, Arc<CheckingCredentials>) {
        let directory = tempfile::tempdir().unwrap();
        let credentials = Arc::new(CheckingCredentials::default());
        let backend = Backend::with_services(
            Paths::isolated_in(directory.path()),
            Arc::new(FakeSystem {
                distros: vec!["Ubuntu-24.04".into()],
                ..Default::default()
            }),
            credentials.clone(),
            crate::cli::Service::new(Arc::new(crate::cli::EmptyRunner)),
            events,
        )
        .unwrap();
        *credentials.backend.lock().unwrap() = Arc::downgrade(&backend);
        (directory, backend, credentials)
    }

    fn seed(backend: &Backend, server: ServerAsset) -> Asset {
        let asset = Asset::Vps(server);
        backend.database().unwrap().upsert_asset_guarded(&asset).unwrap();
        backend.database().unwrap().require_asset(asset.id()).unwrap()
    }

    fn ok_test() -> TestOutcome {
        TestOutcome {
            status: ConnectionTestStatus::Ok,
            ms: 1,
            remote_os: None,
            error: None,
            host_key: None,
        }
    }

    fn register_connection(
        backend: &Backend,
        id: &str,
        asset: &Asset,
        started: Instant,
        outcome: Option<TestOutcome>,
    ) -> ConnectionAttempt {
        let server = asset.as_server().unwrap();
        let epoch = backend.reset_epoch.load(Ordering::SeqCst);
        let input = connection_input(&server.connection);
        let expires = Instant::now() + ssh::connect::TRUST_TTL;
        let cancel = Arc::new(AtomicBool::new(false));
        let baseline_verified = Some(server.connection.verified.clone());
        let completed = outcome
            .as_ref()
            .filter(|outcome| outcome.status == ConnectionTestStatus::Ok)
            .map(|_| started);
        backend.connections.jobs.lock().unwrap().insert(
            id.into(),
            ConnectionJob {
                epoch,
                connection: input.clone(),
                asset_id: Some(asset.id().into()),
                env_id: EnvId::windows(),
                cancel: cancel.clone(),
                outcome,
                at: testkit::NOW.into(),
                expires,
                started,
                completed,
                baseline_verified: baseline_verified.clone(),
                consumed: false,
            },
        );
        ConnectionAttempt {
            id: id.into(),
            epoch,
            connection: input,
            asset_id: Some(asset.id().into()),
            env_id: EnvId::windows(),
            cancel,
            expires,
            started,
            baseline_verified,
        }
    }

    fn target(backend: &Backend, asset: &Asset) -> TestTarget {
        let env = backend.context(&EnvId::windows()).unwrap();
        TestTarget {
            env: env.clone(),
            alias: asset.handle().into(),
            managed: ManagedHost::from_asset(asset, &env),
            password: None,
        }
    }

    fn register_probe(backend: &Backend, asset: &Asset, id: &str) -> Arc<AtomicBool> {
        let cancel = Arc::new(AtomicBool::new(false));
        backend.probes.jobs.lock().unwrap().insert(
            id.into(),
            ProbeJob {
                asset_id: asset.id().into(),
                cancel: cancel.clone(),
                active: true,
                expires: Instant::now() + Duration::from_secs(30),
                started: Instant::now(),
            },
        );
        cancel
    }

    fn password_asset(backend: &Backend, credentials: &CheckingCredentials, revision: Option<&str>) -> Asset {
        let mut server = testkit::dev_box();
        server.connection.auth.as_mut().unwrap().method = AuthMethod::Password;
        let asset = seed(backend, server);
        if let Some(revision) = revision {
            credentials
                .set(revision, &SecretString::new("test-only password".into()).unwrap())
                .unwrap();
            backend
                .database()
                .unwrap()
                .replace_password_ref(&asset, Some(revision))
                .unwrap();
        }
        backend.database().unwrap().require_asset(asset.id()).unwrap()
    }

    #[test]
    fn connection_proofs_are_target_bound_expiring_and_single_use() {
        let (_directory, backend, _) = fixture();
        let asset = seed(&backend, testkit::dev_box());
        let attempt = register_connection(&backend, "test_proof", &asset, Instant::now(), Some(ok_test()));
        assert_eq!(
            backend
                .connections
                .proof("test_proof", &attempt.connection)
                .unwrap()
                .env_id,
            EnvId::windows()
        );
        let mut other = attempt.connection.clone();
        if let ConnectionInput::Managed { host, .. } = &mut other {
            *host = "198.51.100.6".into();
        }
        assert!(backend.connections.proof("test_proof", &other).is_err());
        backend.connections.consume("test_proof");
        assert!(backend.connections.proof("test_proof", &attempt.connection).is_err());
        let attempt = register_connection(&backend, "test_expired", &asset, Instant::now(), Some(ok_test()));
        backend
            .connections
            .jobs
            .lock()
            .unwrap()
            .get_mut("test_expired")
            .unwrap()
            .expires = Instant::now();
        assert!(backend.connections.proof("test_expired", &attempt.connection).is_err());
    }

    #[test]
    fn an_old_expiry_cannot_cancel_a_refreshed_attempt_or_its_trust() {
        let (_directory, backend, _) = fixture();
        let asset = seed(&backend, testkit::dev_box());
        let attempt = register_connection(&backend, "test_trust", &asset, Instant::now(), None);
        let refreshed = attempt.expires + Duration::from_secs(1);
        backend
            .connections
            .jobs
            .lock()
            .unwrap()
            .get_mut("test_trust")
            .unwrap()
            .expires = refreshed;
        backend
            .connections
            .trust
            .insert("test_trust", target(&backend, &asset), "SHA256:fixture".into());
        assert!(!backend.connections.expire("test_trust", attempt.expires, refreshed));
        assert!(!attempt.cancel.load(Ordering::SeqCst));
        assert!(backend.connections.trust.take("test_trust", "SHA256:fixture").is_ok());
        assert!(backend.connections.expire("test_trust", refreshed, refreshed));
        assert!(attempt.cancel.load(Ordering::SeqCst));
        assert!(!backend.connections.jobs.lock().unwrap().contains_key("test_trust"));
    }

    #[test]
    fn expiry_tasks_do_not_retain_backend_or_its_database_file() {
        let (directory, backend, _) = fixture();
        let weak = Arc::downgrade(&backend);
        let database = backend.paths.db_file();
        backend.schedule_connection_expiry("unused".into(), Instant::now() + Duration::from_secs(300));
        drop(backend);
        assert!(weak.upgrade().is_none());
        // Reopening SQLite proves the expired task does not retain the old Backend.
        let reopened = crate::db::Db::open(&database).unwrap();
        drop(reopened);
        drop(directory);
    }

    #[test]
    fn saved_password_has_no_legacy_asset_id_fallback_and_reads_only_a_revision() {
        let (_directory, backend, credentials) = fixture();
        let asset = password_asset(&backend, &credentials, None);
        credentials
            .set(
                asset.id(),
                &SecretString::new("legacy test-only password".into()).unwrap(),
            )
            .unwrap();
        let input = connection_input(&asset.as_server().unwrap().connection);
        assert!(
            backend
                .saved_password(asset.id(), &input, &AtomicBool::new(false))
                .unwrap_err()
                .is_ipc(IpcErrorId::PasswordMissing)
        );
        assert!(credentials.reads.lock().unwrap().is_empty());
        credentials
            .set(
                "ast_revision",
                &SecretString::new("revision test-only password".into()).unwrap(),
            )
            .unwrap();
        backend
            .database()
            .unwrap()
            .replace_password_ref(&asset, Some("ast_revision"))
            .unwrap();
        assert_eq!(
            backend
                .saved_password(asset.id(), &input, &AtomicBool::new(false))
                .unwrap()
                .expose(),
            "revision test-only password"
        );
        assert_eq!(*credentials.reads.lock().unwrap(), ["ast_revision"]);
    }

    #[test]
    fn changed_password_target_is_rejected_before_the_vault() {
        let (_directory, backend, credentials) = fixture();
        let asset = password_asset(&backend, &credentials, Some("ast_revision"));
        let mut input = connection_input(&asset.as_server().unwrap().connection);
        if let ConnectionInput::Managed { host, .. } = &mut input {
            *host = "198.51.100.6".into();
        }
        assert!(
            backend
                .saved_password(asset.id(), &input, &AtomicBool::new(false))
                .unwrap_err()
                .is_ipc(IpcErrorId::PasswordTargetChanged)
        );
        assert!(credentials.reads.lock().unwrap().is_empty());
    }

    #[test]
    fn a_wsl_password_test_fails_without_reading_the_windows_vault() {
        let (_directory, backend, credentials) = fixture();
        let asset = password_asset(&backend, &credentials, Some("ast_revision"));
        let id = backend
            .start_test(ConnectionTestRequest {
                asset_id: Some(asset.id().into()),
                connection: connection_input(&asset.as_server().unwrap().connection),
                password: None,
                env_id: Some(EnvId::wsl("Ubuntu-24.04")),
            })
            .unwrap();
        let deadline = Instant::now() + Duration::from_secs(3);
        loop {
            let outcome = backend
                .connections
                .jobs
                .lock()
                .unwrap()
                .get(&id)
                .and_then(|job| job.outcome.clone());
            if let Some(outcome) = outcome
                && Arc::strong_count(&backend) == 1
            {
                assert_eq!(outcome.error.unwrap().id, SshErrorId::NeedsInteraction);
                break;
            }
            assert!(
                Instant::now() < deadline,
                "the unsupported password test worker did not finish"
            );
            std::thread::sleep(Duration::from_millis(5));
        }
        assert!(credentials.reads.lock().unwrap().is_empty());
    }

    #[test]
    fn target_and_revision_are_rechecked_after_the_unlocked_vault_read() {
        for change_revision in [false, true] {
            let (_directory, backend, credentials) = fixture();
            let asset = password_asset(&backend, &credentials, Some("ast_revision"));
            let input = connection_input(&asset.as_server().unwrap().connection);
            let changed_backend = backend.clone();
            let changed_asset = asset.clone();
            *credentials.hook.lock().unwrap() = Some(Box::new(move || {
                let mut asset = changed_asset;
                if change_revision {
                    changed_backend
                        .database()
                        .unwrap()
                        .replace_password_ref(&asset, Some("ast_new_revision"))
                        .unwrap();
                } else {
                    if let Asset::Vps(server) = &mut asset {
                        server.connection.host = Some("198.51.100.6".into());
                    }
                    changed_backend
                        .database()
                        .unwrap()
                        .upsert_asset_guarded(&asset)
                        .unwrap();
                }
            }));
            assert!(
                backend
                    .saved_password(asset.id(), &input, &AtomicBool::new(false))
                    .unwrap_err()
                    .is_ipc(IpcErrorId::PasswordTargetChanged)
            );
            assert_eq!(*credentials.reads.lock().unwrap(), ["ast_revision"]);
        }
    }

    #[test]
    fn verification_changes_during_a_vault_read_do_not_change_the_endpoint() {
        let (_directory, backend, credentials) = fixture();
        let asset = password_asset(&backend, &credentials, Some("ast_revision"));
        let input = connection_input(&asset.as_server().unwrap().connection);
        let changed_backend = backend.clone();
        let mut changed = asset.clone();
        *credentials.hook.lock().unwrap() = Some(Box::new(move || {
            if let Asset::Vps(server) = &mut changed {
                server.connection.verified.as_mut().unwrap().at = "2026-11-04T12:00:00Z".into();
            }
            changed_backend
                .database()
                .unwrap()
                .upsert_asset_guarded(&changed)
                .unwrap();
        }));
        assert!(
            backend
                .saved_password(asset.id(), &input, &AtomicBool::new(false))
                .is_ok()
        );
        let current = backend.database().unwrap().require_asset(asset.id()).unwrap();
        assert!(same_target(&asset, &current));
        let mut changed = current;
        if let Asset::Vps(server) = &mut changed {
            server.connection.proxy_jump = Some(Some("other-jump".into()));
        }
        assert!(!same_target(&asset, &changed));
    }

    #[test]
    fn failed_connection_clears_only_its_original_verification() {
        let (_directory, backend, _) = fixture();
        let asset = seed(&backend, testkit::dev_box());
        let mut attempt = register_connection(&backend, "test_failure", &asset, Instant::now(), None);
        let failure = failed_test(SshErrorId::AuthFailed, asset.handle());
        backend
            .finish_connection_attempt(&mut attempt, &target(&backend, &asset), &failure)
            .unwrap();
        let current = backend.database().unwrap().require_asset(asset.id()).unwrap();
        assert!(!current.as_server().unwrap().connection.verified.as_ref().unwrap().ok);
        let mut old = register_connection(&backend, "test_old", &current, Instant::now(), None);
        let mut later = current.clone();
        if let Asset::Vps(server) = &mut later {
            server.connection.verified = Some(ConnectionVerified {
                ok: true,
                at: "2026-11-04T12:00:00Z".into(),
                env_ids: vec![EnvId::windows()],
            });
        }
        backend.database().unwrap().upsert_asset(&later).unwrap();
        backend
            .finish_connection_attempt(&mut old, &target(&backend, &later), &failure)
            .unwrap();
        assert_eq!(backend.database().unwrap().require_asset(asset.id()).unwrap(), later);
    }

    #[test]
    fn newer_success_protects_verification_even_with_identical_timestamps() {
        let (_directory, backend, _) = fixture();
        let asset = seed(&backend, testkit::dev_box());
        let started = Instant::now();
        let mut old = register_connection(&backend, "test_old", &asset, started, None);
        register_connection(
            &backend,
            "test_new",
            &asset,
            started + Duration::from_millis(1),
            Some(ok_test()),
        );
        backend
            .finish_connection_attempt(
                &mut old,
                &target(&backend, &asset),
                &failed_test(SshErrorId::Timeout, asset.handle()),
            )
            .unwrap();
        assert_eq!(backend.database().unwrap().require_asset(asset.id()).unwrap(), asset);
    }

    #[test]
    fn cancelled_or_refreshed_connection_attempts_cannot_write_verification() {
        let (_directory, backend, _) = fixture();
        let asset = seed(&backend, testkit::dev_box());
        let mut cancelled = register_connection(&backend, "test_cancelled", &asset, Instant::now(), None);
        backend.cancel_connection_test("test_cancelled").unwrap();
        assert_eq!(
            backend
                .finish_connection_attempt(&mut cancelled, &target(&backend, &asset), &ok_test())
                .unwrap()
                .unwrap()
                .status,
            ConnectionTestStatus::Cancelled
        );
        let mut stale = register_connection(&backend, "test_refreshed", &asset, Instant::now(), None);
        backend
            .connections
            .jobs
            .lock()
            .unwrap()
            .get_mut("test_refreshed")
            .unwrap()
            .expires += Duration::from_secs(1);
        assert!(
            backend
                .finish_connection_attempt(&mut stale, &target(&backend, &asset), &ok_test())
                .unwrap()
                .is_none()
        );
        assert_eq!(backend.database().unwrap().require_asset(asset.id()).unwrap(), asset);
    }

    #[test]
    fn reset_during_saved_password_read_blocks_connection_completion_and_activity() {
        let events = Arc::new(CheckedEvents::default());
        let (_directory, backend, credentials) = fixture_with_events(events.clone());
        *events.backend.lock().unwrap() = Arc::downgrade(&backend);
        let asset = password_asset(&backend, &credentials, Some("ast_revision"));
        let mut attempt = register_connection(&backend, "test_reset", &asset, Instant::now(), None);
        let test_target = target(&backend, &asset);
        let reset_backend = backend.clone();
        *credentials.hook.lock().unwrap() = Some(Box::new(move || reset_backend.reset_data().unwrap()));

        assert!(
            backend
                .saved_password(asset.id(), &attempt.connection, &attempt.cancel)
                .is_err()
        );
        assert_eq!(*credentials.reads.lock().unwrap(), ["ast_revision"]);
        let reset_events = events.events.lock().unwrap().clone();
        assert!(
            backend
                .finish_connection_attempt(
                    &mut attempt,
                    &test_target,
                    &failed_test(SshErrorId::Unknown, asset.handle()),
                )
                .unwrap_err()
                .is_ipc(IpcErrorId::ResetIncomplete)
        );
        assert_eq!(*events.events.lock().unwrap(), reset_events);
        assert!(backend.list_assets().unwrap().is_empty());
        let query = ActivityQuery {
            before: None,
            limit: 100,
            kinds: None,
            asset_id: None,
        };
        assert!(backend.database().unwrap().list_activity(&query).unwrap().is_empty());

        let fresh = seed(&backend, testkit::dev_box());
        let mut fresh_attempt = register_connection(&backend, "test_after_reset", &fresh, Instant::now(), None);
        backend
            .finish_connection_attempt(&mut fresh_attempt, &target(&backend, &fresh), &ok_test())
            .unwrap();
        let activity = backend.database().unwrap().list_activity(&query).unwrap();
        assert_eq!(activity.len(), 1);
        assert_eq!(activity[0].message_id, ActivityMessageId::TestOk);
        assert!(
            events
                .events
                .lock()
                .unwrap()
                .iter()
                .any(|(event, payload)| { event == "connection://tested" && payload["testId"] == "test_after_reset" })
        );
    }

    #[test]
    fn reset_blocks_probe_events_even_after_the_merge_was_committed() {
        let events = Arc::new(CheckedEvents::default());
        let (_directory, backend, _) = fixture_with_events(events.clone());
        *events.backend.lock().unwrap() = Arc::downgrade(&backend);
        let snapshot = seed(&backend, testkit::hk_edge());
        let epoch = backend.reset_epoch.load(Ordering::SeqCst);
        register_probe(&backend, &snapshot, "prb_reset");
        let merged = backend
            .apply_probe_data("prb_reset", &snapshot, &EnvId::windows(), &probe::parse(OUTPUT))
            .unwrap();
        let progress = ProbeProgressEvent {
            run_id: "prb_reset".into(),
            asset_id: snapshot.id().into(),
            step: ProbeStep::Merge,
            status: ProbeStepStatus::Done,
            ms: None,
        };
        let mut finished = ProbeFinishedEvent {
            run_id: "prb_reset".into(),
            asset_id: snapshot.id().into(),
            status: ProbeFinishedStatus::Ok,
            error: merged.partial,
            applied: Some(merged.applied),
            held: Some(merged.held),
            duration_ms: Some(1),
            finished_at: Some(testkit::NOW.into()),
        };
        backend.reset_data().unwrap();
        let reset_events = events.events.lock().unwrap().clone();
        assert!(
            backend
                .emit_probe_progress_at(epoch, &progress)
                .unwrap_err()
                .is_ipc(IpcErrorId::ResetIncomplete)
        );
        assert!(
            backend
                .finish_probe_at(epoch, &mut finished)
                .unwrap_err()
                .is_ipc(IpcErrorId::ResetIncomplete)
        );
        assert_eq!(*events.events.lock().unwrap(), reset_events);
        assert!(backend.list_assets().unwrap().is_empty());
        assert!(backend.database().unwrap().probe_result("prb_reset").unwrap().is_none());
    }

    #[test]
    fn cancelled_probe_completion_cannot_emit_a_successful_result() {
        let events = Arc::new(CheckedEvents::default());
        let (_directory, backend, _) = fixture_with_events(events.clone());
        *events.backend.lock().unwrap() = Arc::downgrade(&backend);
        let snapshot = seed(&backend, testkit::hk_edge());
        let epoch = backend.reset_epoch.load(Ordering::SeqCst);
        register_probe(&backend, &snapshot, "prb_cancel");
        backend.cancel_probe("prb_cancel").unwrap();
        let mut event = ProbeFinishedEvent {
            run_id: "prb_cancel".into(),
            asset_id: snapshot.id().into(),
            status: ProbeFinishedStatus::Ok,
            error: Some(SshError::new(SshErrorId::Unknown, params! {})),
            applied: Some(Vec::new()),
            held: Some(Vec::new()),
            duration_ms: Some(1),
            finished_at: None,
        };
        backend.finish_probe_at(epoch, &mut event).unwrap();
        assert_eq!(event.status, ProbeFinishedStatus::Cancelled);
        assert!(event.error.is_none() && event.applied.is_none() && event.held.is_none());
        assert!(
            events
                .events
                .lock()
                .unwrap()
                .iter()
                .any(|(name, payload)| { name == "probe://finished" && payload["status"] == "cancelled" })
        );
    }

    #[test]
    fn probe_merge_preserves_edits_made_during_collection() {
        let (_directory, backend, _) = fixture();
        let snapshot = seed(&backend, testkit::hk_edge());
        register_probe(&backend, &snapshot, "prb_edit");
        let mut edited = snapshot.clone();
        if let Asset::Vps(server) = &mut edited {
            server.notes = "A note written while collection was running".into();
            server.facts.os = Some("manual OS correction".into());
            server.services[0].image = Some("manual/image:2".into());
            server.services[0].role = Some("manual role".into());
        }
        backend.database().unwrap().upsert_asset(&edited).unwrap();
        let merged = backend
            .apply_probe_data("prb_edit", &snapshot, &EnvId::windows(), &probe::parse(OUTPUT))
            .unwrap();
        let edited_server = edited.as_server().unwrap();
        assert_eq!(merged.asset.facts.os, edited_server.facts.os);
        assert_eq!(merged.asset.notes, edited_server.notes);
        assert_eq!(merged.asset.services[0], edited_server.services[0]);
        assert_ne!(merged.asset.facts.kernel, edited_server.facts.kernel);
    }

    #[test]
    fn cancelled_expired_or_superseded_probes_cannot_modify_an_asset() {
        for cause in 0..3 {
            let (_directory, backend, _) = fixture();
            let snapshot = seed(&backend, testkit::hk_edge());
            let cancel = register_probe(&backend, &snapshot, "prb_stale");
            let mut current = snapshot.clone();
            match cause {
                0 => cancel.store(true, Ordering::SeqCst),
                1 => {
                    backend
                        .probes
                        .jobs
                        .lock()
                        .unwrap()
                        .get_mut("prb_stale")
                        .unwrap()
                        .expires = Instant::now()
                }
                _ => {
                    if let Asset::Vps(server) = &mut current {
                        server.probe.last_run_id = Some("prb_newer".into());
                    }
                }
            }
            backend.database().unwrap().upsert_asset(&current).unwrap();
            assert!(
                backend
                    .apply_probe_data("prb_stale", &snapshot, &EnvId::windows(), &probe::parse(OUTPUT))
                    .is_err()
            );
            backend
                .record_probe_failure(snapshot.id(), "prb_stale", &snapshot)
                .unwrap();
            assert_eq!(
                backend.database().unwrap().require_asset(snapshot.id()).unwrap(),
                current
            );
        }
    }

    #[test]
    fn an_old_probe_failure_preserves_a_new_connection_verification() {
        let (_directory, backend, _) = fixture();
        let snapshot = seed(&backend, testkit::hk_edge());
        register_probe(&backend, &snapshot, "prb_failed");
        let mut newer = snapshot.clone();
        if let Asset::Vps(server) = &mut newer {
            server.connection.verified.as_mut().unwrap().at = "2026-11-04T12:00:00Z".into();
        }
        backend.database().unwrap().upsert_asset(&newer).unwrap();
        backend
            .record_probe_failure(snapshot.id(), "prb_failed", &snapshot)
            .unwrap();
        assert_eq!(backend.database().unwrap().require_asset(snapshot.id()).unwrap(), newer);
    }

    #[test]
    fn a_completed_success_fences_failures_when_display_timestamps_are_equal() {
        let (_directory, backend, _) = fixture();
        let snapshot = seed(&backend, testkit::hk_edge());
        register_probe(&backend, &snapshot, "prb_same_time");
        let probe_started = backend.probes.jobs.lock().unwrap()["prb_same_time"].started;
        let old_started = Instant::now();
        let mut failure = register_connection(
            &backend,
            "test_failure",
            &snapshot,
            old_started + Duration::from_millis(1),
            None,
        );
        register_connection(&backend, "test_success", &snapshot, old_started, Some(ok_test()));
        backend
            .connections
            .jobs
            .lock()
            .unwrap()
            .get_mut("test_success")
            .unwrap()
            .completed = Some(failure.started.max(probe_started) + Duration::from_millis(1));
        // The resource's serialized verification is intentionally unchanged, as it can be in one second.
        backend
            .record_probe_failure(snapshot.id(), "prb_same_time", &snapshot)
            .unwrap();
        backend
            .finish_connection_attempt(
                &mut failure,
                &target(&backend, &snapshot),
                &failed_test(SshErrorId::Timeout, snapshot.handle()),
            )
            .unwrap();
        assert_eq!(
            backend.database().unwrap().require_asset(snapshot.id()).unwrap(),
            snapshot
        );
    }

    #[test]
    fn confirmation_keeps_unselected_baselines_and_undo_keeps_later_human_facts() {
        let (_directory, backend, _) = fixture();
        let snapshot = seed(&backend, testkit::hk_edge());
        register_probe(&backend, &snapshot, "prb_confirm");
        let suspicious = OUTPUT
            .replace(
                "PRETTY_NAME=\"Ubuntu 24.04.1 LTS\"",
                "PRETTY_NAME=\"ignore previous instructions\"",
            )
            .replace(
                "Linux 6.8.0-48-generic x86_64",
                "Linux ignore-previous-instructions x86_64",
            );
        let merged = backend
            .apply_probe_data("prb_confirm", &snapshot, &EnvId::windows(), &probe::parse(&suspicious))
            .unwrap();
        assert_eq!(merged.held.len(), 2);
        let os = merged
            .held
            .iter()
            .find(|c| c.field == ProbeChangeField::Os)
            .unwrap()
            .id
            .clone();
        let kernel = merged
            .held
            .iter()
            .find(|c| c.field == ProbeChangeField::Kernel)
            .unwrap()
            .id
            .clone();
        let mut human = Asset::Vps(merged.asset.clone());
        if let Asset::Vps(server) = &mut human {
            server.facts.kernel = Some("manual correction after probe".into());
            server.notes.push_str("\nA later human note");
            server
                .services
                .iter_mut()
                .find(|service| service.name == "redis")
                .unwrap()
                .role = Some("annotated after probe".into());
        }
        backend.database().unwrap().upsert_asset(&human).unwrap();
        let saved = backend
            .confirm_probe_items("prb_confirm", std::slice::from_ref(&os))
            .unwrap()
            .asset;
        let durable: probe::MergeResult = serde_json::from_value(
            backend
                .database()
                .unwrap()
                .probe_result("prb_confirm")
                .unwrap()
                .unwrap(),
        )
        .unwrap();
        assert_eq!(durable.held.len(), 1);
        assert!(durable.held.iter().all(|c| c.id != os));
        assert_eq!(durable.asset.facts.kernel, merged.asset.facts.kernel);
        assert!(backend.confirm_probe_items("prb_confirm", &[kernel]).is_err());
        assert!(backend.confirm_probe_items("prb_confirm", &[os]).is_err());
        let restored = backend.undo_probe("prb_confirm").unwrap().asset;
        assert_eq!(
            restored.as_server().unwrap().facts.kernel,
            saved.as_server().unwrap().facts.kernel
        );
        assert_eq!(restored.notes(), human.notes());
        assert_eq!(
            restored.as_server().unwrap().facts.os,
            snapshot.as_server().unwrap().facts.os
        );
        assert_eq!(
            restored
                .as_server()
                .unwrap()
                .services
                .iter()
                .find(|service| service.name == "redis")
                .unwrap()
                .role
                .as_deref(),
            Some("annotated after probe")
        );
        assert!(
            backend
                .database()
                .unwrap()
                .probe_result("prb_confirm")
                .unwrap()
                .is_none()
        );
    }

    #[test]
    fn undo_is_latest_only_and_does_not_reenable_the_previous_snapshot() {
        let (_directory, backend, _) = fixture();
        let snapshot = seed(&backend, testkit::hk_edge());
        register_probe(&backend, &snapshot, "prb_first");
        let first = backend
            .apply_probe_data("prb_first", &snapshot, &EnvId::windows(), &probe::parse(OUTPUT))
            .unwrap();
        let current = Asset::Vps(first.asset.clone());
        register_probe(&backend, &current, "prb_second");
        backend
            .apply_probe_data("prb_second", &current, &EnvId::windows(), &probe::parse(OUTPUT))
            .unwrap();
        assert!(backend.undo_probe("prb_first").is_err());
        backend.undo_probe("prb_second").unwrap();
        assert!(
            backend.undo_probe("prb_first").is_err(),
            "the older snapshot was replaced, not re-enabled"
        );
    }

    #[test]
    fn copied_key_receipts_cover_only_new_wsl_files_and_are_claimed_on_save() {
        let (_directory, backend, _) = fixture();
        let env = backend.context(&EnvId::windows()).unwrap();
        let generated = crate::secret::keygen::generate("fixture").unwrap();
        let source = crate::secret::keygen::save(&env.host_in_home(&[".ssh"]), "fixture", &generated).unwrap();
        let source_before = fs::read(&source).unwrap();
        let wsl_id = EnvId::wsl("Ubuntu-24.04");
        let native = backend.copy_key_to_wsl(&source.to_string_lossy(), &wsl_id).unwrap();
        let mut server = testkit::dev_box();
        server
            .connection
            .auth
            .as_mut()
            .unwrap()
            .identity_file
            .insert(wsl_id.clone(), native.clone());
        let asset = seed(&backend, server);
        let receipts = backend.database().unwrap().generated_keys(asset.id()).unwrap();
        assert_eq!(receipts.len(), 2);
        assert!(receipts.iter().all(|(path, _)| Path::new(path) != source));
        let host = backend.context(&wsl_id).unwrap().to_host(&native);
        assert!(receipts.iter().any(|(path, _)| Path::new(path) == host));
        assert!(
            receipts
                .iter()
                .any(|(path, _)| Path::new(path) == crate::secret::keygen::pub_path(&host))
        );
        assert_eq!(fs::read(&source).unwrap(), source_before);
    }

    #[test]
    fn conversion_copy_and_completion_recheck_the_original_epoch_and_target() {
        let (_directory, backend, _) = fixture();
        let snapshot = seed(&backend, testkit::dev_box());
        let conversion = backend.connections.begin_conversion(snapshot.id()).unwrap();
        let epoch = backend.reset_epoch.load(Ordering::SeqCst);
        let windows = backend.context(&EnvId::windows()).unwrap();
        let wsl_id = EnvId::wsl("Ubuntu-24.04");
        let wsl = backend.context(&wsl_id).unwrap();
        let generated = crate::secret::keygen::generate("conversion").unwrap();
        let source = crate::secret::keygen::save(&windows.host_in_home(&[".ssh"]), "conversion", &generated).unwrap();
        let destination = wsl.host_in_home(&[".ssh", source.file_name().unwrap().to_str().unwrap()]);

        let mut edited = snapshot.clone();
        if let Asset::Vps(server) = &mut edited {
            server.notes = "Preserve the newest metadata at completion".into();
        }
        backend.database().unwrap().upsert_asset_guarded(&edited).unwrap();
        assert_eq!(
            backend
                .finish_conversion_at(epoch, &snapshot, &conversion.cancel)
                .unwrap(),
            edited
        );
        if let Asset::Vps(server) = &mut edited {
            server.connection.host = Some("198.51.100.6".into());
        }
        backend.database().unwrap().upsert_asset_guarded(&edited).unwrap();
        assert!(
            backend
                .copy_key_to_wsl_at(
                    &source.to_string_lossy(),
                    &wsl_id,
                    epoch,
                    Some((&snapshot, &conversion.cancel))
                )
                .unwrap_err()
                .is_ipc(IpcErrorId::PasswordTargetChanged)
        );
        assert!(
            backend
                .finish_conversion_at(epoch, &snapshot, &conversion.cancel)
                .unwrap_err()
                .is_ipc(IpcErrorId::PasswordTargetChanged)
        );
        assert!(!destination.exists());

        backend.reset_data().unwrap();
        assert!(source.is_file(), "reset preserves existing SSH identity files");
        assert!(
            backend
                .copy_key_to_wsl_at(
                    &source.to_string_lossy(),
                    &wsl_id,
                    epoch,
                    Some((&snapshot, &conversion.cancel))
                )
                .unwrap_err()
                .is_ipc(IpcErrorId::ResetIncomplete)
        );
        assert!(
            backend
                .finish_conversion_at(epoch, &snapshot, &conversion.cancel)
                .unwrap_err()
                .is_ipc(IpcErrorId::ResetIncomplete)
        );
        assert!(!destination.exists());
        let db = rusqlite::Connection::open(backend.paths.db_file()).unwrap();
        assert_eq!(
            db.query_row("SELECT COUNT(*) FROM pending_keys", [], |row| row.get::<_, u32>(0))
                .unwrap(),
            0
        );
        drop(db);

        let native = backend.copy_key_to_wsl(&source.to_string_lossy(), &wsl_id).unwrap();
        assert!(wsl.to_host(&native).is_file(), "a fresh request may copy after reset");
    }

    #[test]
    fn shutdown_cancels_conversions_and_prevents_new_background_work() {
        let (_directory, backend, _) = fixture();
        let asset = seed(&backend, testkit::dev_box());
        let conversion = backend.connections.begin_conversion(asset.id()).unwrap();
        backend.cancel_all_jobs();
        assert!(conversion.cancel.load(Ordering::SeqCst));
        assert!(backend.start_probe(asset.id()).is_err());
        assert!(backend.connections.begin_conversion(asset.id()).is_err());
        let input = connection_input(&asset.as_server().unwrap().connection);
        assert!(
            backend
                .start_test(ConnectionTestRequest {
                    asset_id: Some(asset.id().into()),
                    connection: input,
                    password: None,
                    env_id: Some(EnvId::windows())
                })
                .is_err()
        );
        drop(conversion);
        assert!(backend.connections.conversions.lock().unwrap().is_empty());
    }
}
