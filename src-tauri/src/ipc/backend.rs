use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, UNIX_EPOCH};

use serde::Serialize;
use tauri::Emitter;

use super::jobs::{ConnectionJobs, ProbeJobs};
use super::requests::{CliRequest, SettingsPatch};
use super::startup::{Start, StartupEnvironments, StartupGate};
use crate::cli;
use crate::compile::{self, CompileInput};
use crate::db::Db;
use crate::deliver;
use crate::env::{self, EnvContext, System};
use crate::error::{AppError, Result};
use crate::fsx;
use crate::model::asset::*;
use crate::model::compile::*;
use crate::model::delivery::*;
use crate::model::env::{EnvId, Environment, ManagedSshConfig, SshConfigStatus, SshHostList};
use crate::model::misc::*;
use crate::params;
use crate::paths::Paths;
use crate::proc::{self, RunOpts};
use crate::secret::store::{CredentialStore, MemoryCredentialStore, OsCredentialStore};
use crate::ssh::{self, SshTools, managed};

pub trait EventSink: Send + Sync {
    fn emit(&self, event: &str, payload: serde_json::Value);
}

pub struct TauriEvents(pub tauri::AppHandle);

impl EventSink for TauriEvents {
    fn emit(&self, event: &str, payload: serde_json::Value) {
        crate::tray::on_event(&self.0, event, &payload);
        if self.0.emit(event, payload).is_err() {
            log::warn!("could not emit CloudLink event {event}");
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub(super) struct SshReadbackKey {
    pub env_id: EnvId,
    pub alias: String,
    pub host: String,
    pub port: u16,
    pub user: String,
    pub ssh_exe: PathBuf,
    pub user_config: Option<(u64, u128)>,
    pub managed_config: Option<(u64, u128)>,
}

pub(super) fn file_stamp(path: &Path) -> Option<(u64, u128)> {
    let meta = fs::symlink_metadata(path).ok()?;
    if fsx::is_link(&meta) || !meta.is_file() {
        return None;
    }
    let modified = meta.modified().ok()?.duration_since(UNIX_EPOCH).ok()?.as_nanos();
    Some((meta.len(), modified))
}

pub struct Backend {
    pub paths: Paths,
    pub(super) db: Mutex<Db>,
    pub(super) envs: Mutex<Vec<EnvContext>>,
    pub(super) mutation: Mutex<()>,
    /// 本会话首次发现共用目录选择不一致；收窄后仍提示，明确开关一次后清除。
    pub(super) shared_mismatches: Mutex<BTreeSet<String>>,
    /// 缓存 `ssh -G` 回读结果（按环境、主机字段与 ssh config 文件指纹），避免每次点击分发都重复启动子进程。
    pub(super) ssh_readback_cache: Mutex<HashMap<SshReadbackKey, Vec<&'static str>>>,
    pub(super) credentials: Arc<dyn CredentialStore>,
    pub(super) system: Arc<dyn System>,
    pub(super) cli: cli::Service,
    /// F-104 AC2（P9b）：一键安装并登录的固定命令表、等待状态和一次性标记文件
    pub(super) cli_setups: cli::setup::Setups,
    pub(super) events: Arc<dyn EventSink>,
    pub(super) connections: ConnectionJobs,
    pub(super) probes: ProbeJobs,
    pub(super) guard_test: Arc<dyn crate::guard::SelfTest>,
    pub(super) resetting: AtomicBool,
    pub(super) reset_epoch: AtomicU64,
    pub(super) credential_writes: AtomicUsize,
    /// Serializes only vault writes/cleanup; the UI mutation and database locks are released for OS calls.
    pub(super) vault_writes: Mutex<()>,
    /// F-406：检测更新与安装
    pub(super) updates: Arc<crate::update::Updates>,
    /// 进行中的 CLI 检测与范围拉取（F-406 AC4 的忙碌判定）
    pub(super) cli_runs: Mutex<Vec<CliProvider>>,
    /// 冷启动：启动工作做完之前 IPC 命令在这里等（见 `startup.rs`）
    pub(super) startup: StartupGate,
    pub(super) startup_environments: Mutex<Option<StartupEnvironments>>,
    /// 开机启动的开关（tauri-plugin-autostart）。隔离模式和单元测试不注册，设置只记在数据库里
    pub(super) autostart: std::sync::OnceLock<AutostartHook>,
    /// Runtime lease and in-memory approval ledger; raw commands are never serialized to disk.
    pub(super) execution: Mutex<super::execution::ExecutionService>,
}

pub type AutostartHook = Box<dyn Fn(bool) -> bool + Send + Sync>;

/// 登记一次进行中的 CLI 检测，结束（含出错返回）时自动注销
pub(super) struct CliRun<'a> {
    runs: &'a Mutex<Vec<CliProvider>>,
    provider: CliProvider,
}

impl Backend {
    pub(super) fn cli_run(&self, provider: CliProvider) -> CliRun<'_> {
        if let Ok(mut runs) = self.cli_runs.lock() {
            runs.push(provider);
        }
        CliRun {
            runs: &self.cli_runs,
            provider,
        }
    }
}

impl Drop for CliRun<'_> {
    fn drop(&mut self) {
        if let Ok(mut runs) = self.runs.lock()
            && let Some(index) = runs.iter().position(|p| *p == self.provider)
        {
            runs.remove(index);
        }
    }
}

impl Backend {
    /// 桌面应用的 setup 调用：打开数据库就返回，其余启动工作在后台线程里做（见 `startup.rs`）
    pub fn open(paths: Paths, events: Arc<dyn EventSink>) -> Result<Arc<Self>> {
        Self::open_with_runtime(paths, events, None)
    }

    pub fn open_with_runtime(
        paths: Paths,
        events: Arc<dyn EventSink>,
        runtime: Option<guard_rules::runtime::RuntimeOwner>,
    ) -> Result<Arc<Self>> {
        let isolated = paths.isolated || cfg!(test);
        let system: Arc<dyn System> = if isolated {
            Arc::new(env::FakeSystem::from_env())
        } else {
            Arc::new(env::RealSystem {
                openssh_dir: PathBuf::from(DEFAULT_WINDOWS_SSH).parent().unwrap().to_path_buf(),
            })
        };
        let credentials: Arc<dyn CredentialStore> = if isolated {
            Arc::new(MemoryCredentialStore::default())
        } else {
            Arc::new(OsCredentialStore::new(&paths.data_dir))
        };
        let runner: Arc<dyn cli::Runner> = if isolated {
            Arc::new(cli::EmptyRunner)
        } else {
            Arc::new(cli::SystemRunner::new(&paths))
        };
        // A desktop session can check its own packaged helper without consulting user profiles.
        // Unit tests keep using injected services; isolated WSL execution stays disabled.
        let guard_test: Arc<dyn crate::guard::SelfTest> = if cfg!(test) {
            Arc::new(super::feedback::NoProcessSelfTest)
        } else {
            Arc::new(crate::guard::ProcessSelfTest)
        };
        let backend = Self::assemble(
            paths,
            system,
            credentials,
            cli::Service::new(runner),
            events,
            guard_test,
            runtime,
        )?;
        if !cfg!(test) {
            backend.start_execution_service()?;
        }
        if cfg!(test) {
            // Unit tests never copy the packaged guard helper and finish starting before they continue.
            backend.start(Start::Inline)?;
        } else {
            backend.start_in_background();
        }
        Ok(backend)
    }

    pub fn with_services(
        paths: Paths,
        system: Arc<dyn System>,
        credentials: Arc<dyn CredentialStore>,
        cli: cli::Service,
        events: Arc<dyn EventSink>,
    ) -> Result<Arc<Self>> {
        let guard_test: Arc<dyn crate::guard::SelfTest> = if paths.isolated || cfg!(test) {
            Arc::new(super::feedback::NoProcessSelfTest)
        } else {
            Arc::new(crate::guard::ProcessSelfTest)
        };
        Self::with_guard_services(paths, system, credentials, cli, events, guard_test)
    }

    /// 构造后同步做完启动工作再返回（单元测试用）
    pub fn with_guard_services(
        paths: Paths,
        system: Arc<dyn System>,
        credentials: Arc<dyn CredentialStore>,
        cli: cli::Service,
        events: Arc<dyn EventSink>,
        guard_test: Arc<dyn crate::guard::SelfTest>,
    ) -> Result<Arc<Self>> {
        let backend = Self::assemble(paths, system, credentials, cli, events, guard_test, None)?;
        backend.start(Start::Inline)?;
        Ok(backend)
    }

    /// 打开数据库、建好状态；闸门关着，启动工作由调用方接着做
    pub(super) fn assemble(
        paths: Paths,
        system: Arc<dyn System>,
        credentials: Arc<dyn CredentialStore>,
        cli: cli::Service,
        events: Arc<dyn EventSink>,
        guard_test: Arc<dyn crate::guard::SelfTest>,
        runtime: Option<guard_rules::runtime::RuntimeOwner>,
    ) -> Result<Arc<Self>> {
        // The production WSL root is a UNC server, not a filesystem directory.
        for path in [&paths.data_dir, &paths.user_home] {
            check_ancestors(path)?;
        }
        if paths.isolated {
            check_ancestors(&paths.wsl_root)?;
        }
        fs::create_dir_all(&paths.data_dir)?;
        ensure_data_marker(&paths)?;
        let execution = super::execution::ExecutionService::new(match runtime {
            Some(owner) => owner,
            None => super::execution::begin_runtime(&paths)?,
        })?;
        for directory in [paths.log_dir(), paths.tmp_dir(), paths.inbox_dir()] {
            check_ancestors(&directory)?;
            fs::create_dir_all(directory)?;
        }
        check_ancestors(&paths.db_file())?;
        let db = Db::open(&paths.db_file())?;
        if db.get_settings()?.is_none() {
            db.put_settings(&Settings::defaults(
                paths.data_dir.to_string_lossy().into_owned(),
                paths.log_dir().to_string_lossy().into_owned(),
            ))?;
        }
        let auto_check_updates = db.get_settings()?.is_some_and(|settings| settings.auto_check_updates);
        let setup_launcher: Arc<dyn cli::setup::TerminalLauncher> = if paths.isolated || cfg!(test) {
            Arc::new(cli::setup::InertLauncher)
        } else {
            Arc::new(cli::setup::SystemLauncher)
        };
        let updates = Arc::new(crate::update::Updates::new(
            env!("CARGO_PKG_VERSION"),
            Arc::clone(&events),
            auto_check_updates,
            std::time::Instant::now(),
        ));
        let backend = Arc::new(Self {
            paths,
            db: Mutex::new(db),
            envs: Mutex::new(Vec::new()),
            mutation: Mutex::new(()),
            shared_mismatches: Mutex::new(BTreeSet::new()),
            ssh_readback_cache: Mutex::new(HashMap::new()),
            credentials,
            system,
            cli,
            cli_setups: cli::setup::Setups::new(setup_launcher),
            events,
            connections: ConnectionJobs::default(),
            probes: ProbeJobs::default(),
            guard_test,
            resetting: AtomicBool::new(false),
            reset_epoch: AtomicU64::new(0),
            credential_writes: AtomicUsize::new(0),
            vault_writes: Mutex::new(()),
            updates,
            cli_runs: Mutex::new(Vec::new()),
            startup: StartupGate::closed(),
            startup_environments: Mutex::new(None),
            autostart: std::sync::OnceLock::new(),
            execution: Mutex::new(execution),
        });
        Ok(backend)
    }

    pub(super) fn database(&self) -> Result<MutexGuard<'_, Db>> {
        self.db
            .lock()
            .map_err(|_| AppError::internal("database state unavailable"))
    }

    pub(super) fn edit(&self) -> Result<MutexGuard<'_, ()>> {
        let epoch = self.reset_epoch.load(Ordering::SeqCst);
        self.edit_at(epoch)
    }

    pub(super) fn edit_at(&self, epoch: u64) -> Result<MutexGuard<'_, ()>> {
        let lock = self
            .mutation
            .lock()
            .map_err(|_| AppError::internal("mutation state unavailable"))?;
        if self.resetting.load(Ordering::SeqCst) || epoch != self.reset_epoch.load(Ordering::SeqCst) {
            return Err(AppError::ipc(IpcErrorId::ResetIncomplete));
        }
        if self.database()?.reset_pending()? {
            return Err(AppError::ipc(IpcErrorId::ResetIncomplete));
        }
        Ok(lock)
    }

    pub(super) fn emit<T: Serialize>(&self, event: &str, payload: &T) {
        if let Ok(value) = serde_json::to_value(payload) {
            self.events.emit(event, value);
        }
    }

    pub(super) fn activity(
        &self,
        kind: ActivityKind,
        message_id: ActivityMessageId,
        asset_id: Option<&str>,
        params: crate::model::Params,
        ok: bool,
    ) -> Result<()> {
        let item = ActivityItem {
            id: crate::new_id("act"),
            kind,
            at: crate::time::now_rfc3339(),
            asset_id: asset_id.map(String::from),
            message_id,
            params: (!params.is_empty()).then_some(params),
            duration_ms: None,
            detail: None,
            ok,
        };
        self.database()?.add_activity(&item)?;
        self.emit("activity://new", &serde_json::json!({ "item": item }));
        Ok(())
    }

    pub(super) fn contexts(&self, enabled_only: bool) -> Result<Vec<EnvContext>> {
        let settings = self.get_settings()?;
        let envs = self
            .envs
            .lock()
            .map_err(|_| AppError::internal("environment state unavailable"))?;
        Ok(envs
            .iter()
            .filter(|env| !enabled_only || settings.environments.iter().any(|s| s.id == env.id && s.enabled))
            .cloned()
            .collect())
    }

    pub(super) fn context(&self, id: &EnvId) -> Result<EnvContext> {
        self.contexts(false)?
            .into_iter()
            .find(|e| &e.id == id && e.available)
            .ok_or_else(|| AppError::ipc_with(IpcErrorId::NotFound, params! {"env" => id.as_str()}))
    }

    pub(super) fn tools(&self) -> Result<SshTools> {
        Ok(SshTools {
            windows_ssh: PathBuf::from(self.get_settings()?.windows_ssh_path),
        })
    }

    pub fn get_settings(&self) -> Result<Settings> {
        self.database()?
            .get_settings()?
            .ok_or_else(|| AppError::internal("settings unavailable"))
    }

    pub fn list_assets(&self) -> Result<Vec<Asset>> {
        self.database()?.list_assets()
    }
    pub fn list_targets(&self) -> Result<Vec<Target>> {
        self.database()?.list_targets()
    }
    pub fn list_inclusions(&self) -> Result<Vec<Inclusion>> {
        self.database()?.list_inclusions()
    }
    pub fn list_deliveries(&self) -> Result<Vec<Delivery>> {
        self.database()?.list_deliveries()
    }
    pub fn get_compile_status(&self) -> Result<Vec<CompileStatus>> {
        self.database()?.get_compile_statuses()
    }
    pub fn get_skill_config(&self) -> Result<SkillConfig> {
        self.database()?.get_skill_config()
    }

    pub(super) fn delivery_plan(&self) -> Result<deliver::groups::Plan> {
        Ok(deliver::groups::Plan::new(
            &self.paths,
            &self.contexts(false)?,
            &self.list_targets()?,
        ))
    }

    pub(super) fn save_result(&self, asset: Asset, statuses: Vec<CompileStatus>) -> Result<SaveResult> {
        let asset = self.database()?.require_asset(asset.id())?;
        let inclusions = self.list_inclusions()?;
        let deliveries = self.list_deliveries()?;
        Ok(SaveResult {
            asset,
            statuses,
            inclusions,
            deliveries,
        })
    }

    /// 这个环境里装了哪些 Agent：先看目录，Claude Code、Codex 和 Antigravity 再看 PATH 里有没有命令（2026-11-07）
    fn detect_agents(&self, env: &EnvContext) -> Vec<DetectedAgent> {
        let mut agents = deliver::agents::detect(env);
        let missing: Vec<(AgentBrand, &str)> = [
            (AgentBrand::ClaudeCode, "claude"),
            (AgentBrand::Codex, "codex"),
            (AgentBrand::Antigravity, "agy"),
        ]
        .into_iter()
        .filter(|(brand, _)| !agents.iter().any(|a| a.brand == *brand))
        .collect();
        if !missing.is_empty() {
            let names: Vec<&str> = missing.iter().map(|(_, bin)| *bin).collect();
            let found = self.binaries_on_path(env, &names);
            for (brand, binary) in missing {
                if found.contains(binary) {
                    agents.push(deliver::agents::found(brand));
                }
            }
        }
        deliver::agents::sort(&mut agents);
        agents
    }

    fn binaries_on_path(&self, env: &EnvContext, binaries: &[&str]) -> BTreeSet<String> {
        let mut found = BTreeSet::new();
        if self.paths.isolated || cfg!(test) || !env.available || binaries.is_empty() {
            return found;
        }
        if let Some(distro) = env.distro() {
            let mut cmd = proc::command("wsl.exe");
            cmd.args([
                "-d",
                distro,
                "-e",
                "bash",
                "-ilc",
                r#"for b in "$@"; do command -v "$b" >/dev/null 2>&1 && printf '%s\n' "$b"; done"#,
                "cloudlink-which",
            ]);
            cmd.args(binaries);
            cmd.stdin(std::process::Stdio::null());
            if let Ok(output) = proc::run(
                cmd,
                RunOpts {
                    timeout: Duration::from_secs(5),
                    ..Default::default()
                },
            ) && output.success()
            {
                for line in output.stdout_str().lines() {
                    let trimmed = line.trim();
                    if binaries.contains(&trimmed) {
                        found.insert(trimmed.to_string());
                    }
                }
            }
            return found;
        }
        // Windows: check PATH directly without spawning where.exe per binary.
        let path_var = std::env::var_os("PATH").unwrap_or_default();
        let pathext: Vec<String> = std::env::var("PATHEXT")
            .unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".into())
            .split(';')
            .filter(|s| !s.is_empty())
            .map(|s| s.to_ascii_lowercase())
            .collect();
        let dirs: Vec<PathBuf> = std::env::split_paths(&path_var).collect();
        for &binary in binaries {
            let has_ext = Path::new(binary).extension().is_some();
            'dirs: for dir in &dirs {
                if has_ext {
                    if dir.join(binary).is_file() {
                        found.insert(binary.to_string());
                        break 'dirs;
                    }
                } else {
                    for ext in &pathext {
                        if dir.join(format!("{binary}{ext}")).is_file() {
                            found.insert(binary.to_string());
                            break 'dirs;
                        }
                    }
                }
            }
        }
        found
    }

    pub fn detect_environments(&self) -> Result<Vec<Environment>> {
        let _edit = self.edit()?;
        // 前端加载时的第一次检测：启动线程刚做完一遍，直接用它的结果
        if let Some(environments) = self.take_startup_environments() {
            return Ok(environments);
        }
        self.detect_environments_locked()
    }

    /// Caller holds the mutation mutex.
    pub(super) fn detect_environments_locked(&self) -> Result<Vec<Environment>> {
        let detected = env::detect(&self.paths, self.system.as_ref());
        let mut settings = self.get_settings()?;
        for env in &detected {
            if !settings.environments.iter().any(|s| s.id == env.id) {
                settings.environments.push(EnvSetting {
                    id: env.id.clone(),
                    enabled: env.available,
                });
            }
        }
        let mut known = self.list_targets()?;
        let agents: Vec<Vec<DetectedAgent>> = detected.iter().map(|env| self.detect_agents(env)).collect();
        for (env, found) in detected.iter().zip(&agents) {
            for agent in AgentId::BUILTIN {
                let detected_agent = deliver::agents::target_detected(agent, found);
                if let Some(target) = known.iter_mut().find(|t| t.env_id == env.id && t.agent == agent) {
                    target.detected = detected_agent;
                    continue;
                }
                // 只认自己目录的 Agent 检测到以后才加；用户已经把这个目录加成自定义目录时不重复
                let Some(dir) = agent.skills_dir() else { continue };
                let path = env.native_in_home(dir);
                if !(agent.always_listed() || detected_agent)
                    || known
                        .iter()
                        .any(|t| t.env_id == env.id && same_or_nested(&t.path, &path, env.is_windows()))
                {
                    continue;
                }
                known.push(Target {
                    id: crate::new_id("tgt"),
                    env_id: env.id.clone(),
                    agent,
                    agent_key: agent.as_str().into(),
                    label: agent.default_label().into(),
                    path,
                    enabled: detected_agent,
                    detected: detected_agent,
                });
            }
        }
        {
            let db = self.database()?;
            db.put_settings(&settings)?;
            for t in &known {
                db.upsert_target(t)?;
            }
        }
        *self
            .envs
            .lock()
            .map_err(|_| AppError::internal("environment state unavailable"))? = detected.clone();
        self.reconcile_locked(true)?;
        Ok(detected
            .iter()
            .zip(agents)
            .map(|(e, agents)| self.environment(e, agents))
            .collect())
    }

    /// 用户的 `~/.ssh/config` 是否已经 Include 托管文件
    fn include_present(e: &EnvContext) -> bool {
        let config = e.host_in_home(&[".ssh", "config"]);
        check_ancestors(&config).is_ok()
            && fs::read_to_string(config).is_ok_and(|s| {
                managed::is_included_at(&s, &e.managed_config_native(), managed::IncludeMode::for_env(e))
            })
    }

    fn environment(&self, e: &EnvContext, agents: Vec<DetectedAgent>) -> Environment {
        let included = Self::include_present(e);
        Environment {
            id: e.id.clone(),
            label: e.label.clone(),
            home: e.home.clone(),
            ssh_config_path: e.ssh_config_native(),
            available: e.available,
            managed_ssh_config: ManagedSshConfig {
                path: e.managed_config_native(),
                included,
            },
            ssh_agent_keys: self.system.ssh_agent_keys(e),
            agents,
        }
    }

    pub fn get_ssh_config_status(&self) -> Result<Vec<SshConfigStatus>> {
        self.contexts(false)?
            .iter()
            .map(|env| {
                Ok(SshConfigStatus {
                    env_id: env.id.clone(),
                    managed_path: env.managed_config_native(),
                    user_config_path: env.ssh_config_native(),
                    included: Self::include_present(env),
                    include_line: managed::include_line(
                        &env.managed_config_native(),
                        managed::IncludeMode::for_env(env),
                    )?,
                    known_hosts_path: env.known_hosts_native(),
                })
            })
            .collect()
    }

    pub fn add_ssh_include(&self, env_id: &EnvId) -> Result<SshConfigStatus> {
        let _edit = self.edit()?;
        self.forget_startup_environments();
        let env = self.context(env_id)?;
        let config = env.host_in_home(&[".ssh", "config"]);
        check_ancestors(&config)?;
        check_ancestors(&env.host_in_home(&[".ssh", "cloudlink.conf"]))?;
        managed::add_include_at(
            &config,
            &env.managed_config_native(),
            managed::IncludeMode::for_env(&env),
        )?;
        let mut settings = self.get_settings()?;
        if !settings.ssh_include_asked.contains(env_id) {
            settings.ssh_include_asked.push(env_id.clone());
        }
        self.database()?.put_settings(&settings)?;
        self.activity(
            ActivityKind::SshConfig,
            ActivityMessageId::SshIncludeAdded,
            None,
            params! {"env" => env_id.as_str()},
            true,
        )?;
        self.publish_locked()?;
        self.get_ssh_config_status()?
            .into_iter()
            .find(|s| &s.env_id == env_id)
            .ok_or_else(|| AppError::ipc(IpcErrorId::NotFound))
    }

    pub fn list_ssh_hosts(&self, env_id: Option<&EnvId>) -> Result<SshHostList> {
        let envs: Vec<_> = self
            .contexts(false)?
            .into_iter()
            .filter(|e| env_id.is_none_or(|id| &e.id == id))
            .collect();
        let existing = self.list_assets()?.iter().map(|a| a.handle().to_lowercase()).collect();
        Ok(ssh::list_hosts(&envs, &existing))
    }

    /// Caller holds the mutation mutex. No credentials, SSH authentication, or remote probes run here.
    pub(super) fn publish_locked(&self) -> Result<Vec<CompileStatus>> {
        self.reconcile_locked(false)
    }

    pub(super) fn emit_deliveries(&self) -> Result<()> {
        self.emit(
            "deliveries://changed",
            &serde_json::json!({ "deliveries": self.list_deliveries()?, "inclusions": self.list_inclusions()? }),
        );
        Ok(())
    }

    pub fn check_deliveries(&self) -> Result<Vec<Delivery>> {
        let _edit = self.edit()?;
        if self.import_feedback_locked().is_err() {
            log::warn!("CloudLink feedback import remains pending");
        }
        self.reconcile_locked(true)?;
        self.list_deliveries()
    }

    /// F-309：自动覆盖后通知界面（提示条带「撤销」）并记进活动日志
    pub(super) fn backed_up(&self, saved: &deliver::backup::BackupMeta) -> Result<()> {
        let target = self.require_target(&saved.target_id)?;
        self.emit(
            "deliveries://backed-up",
            &BackupEvent {
                backup_id: saved.backup_id.clone(),
                target_id: saved.target_id.clone(),
                reason: saved.reason,
            },
        );
        self.activity(
            ActivityKind::Repair,
            match saved.reason {
                BackupReason::Modified => ActivityMessageId::CopyRestored,
                BackupReason::Takeover => ActivityMessageId::CopyTakenOver,
            },
            None,
            params! {"target" => target.label, "env" => target.env_id.as_str(), "backup" => saved.backup_id.clone()},
            true,
        )
    }

    /// F-309 AC3：「备份并接管」。只处理没有 CloudLink 标记、全部由普通文件组成的同名目录
    pub fn take_over_target(&self, id: &str) -> Result<Delivery> {
        let _edit = self.edit()?;
        let target = self.require_target(id)?;
        if !target.enabled {
            return Err(AppError::ipc(IpcErrorId::NotFound));
        }
        if self
            .get_compile_status()?
            .iter()
            .any(|s| s.env_id == target.env_id && s.agent_key == target.agent_key && s.blocked)
        {
            return Err(AppError::ipc(IpcErrorId::CompileBlocked));
        }
        let env = self.context(&target.env_id)?;
        let plan = self.delivery_plan()?;
        let unit = plan
            .unit_for(&target.id)
            .ok_or_else(|| AppError::ipc(IpcErrorId::TargetExists))?;
        let (marker, files) = deliver::load_source_with_key(
            &self.paths,
            &target.env_id,
            &unit.owner().agent_key,
            &plan.source_key(unit),
        )?
        .ok_or_else(|| AppError::ipc(IpcErrorId::SourceMissing))?;
        let (_, saved) = deliver::take_over_unit(&self.paths, &env, &target, unit, &files, &marker)?;
        self.publish_locked()?;
        let delivery = self
            .list_deliveries()?
            .into_iter()
            .find(|d| d.target_id == target.id)
            .ok_or_else(|| AppError::ipc(IpcErrorId::NotFound))?;
        self.backed_up(&saved)?;
        if deliver::backup::prune(&self.paths, crate::time::now_secs()).is_err() {
            log::warn!("CloudLink could not prune old backups");
        }
        Ok(delivery)
    }

    /// F-309 AC2/AC3「撤销」：备份写回原处，并停用这个目标（暂停自动同步），直到用户再次启用
    pub fn undo_backup(&self, backup_id: &str) -> Result<Target> {
        let _edit = self.edit()?;
        let target_id = deliver::backup::target_of(&self.paths, backup_id)?;
        let mut target = self.require_target(&target_id)?;
        let env = self.context(&target.env_id)?;
        let plan = self.delivery_plan()?;
        let unit = plan
            .unit_for(&target.id)
            .ok_or_else(|| AppError::ipc(IpcErrorId::TargetExists))?;
        deliver::restore_backup_unit(&self.paths, &env, &target, unit, backup_id)?;
        // 一个共用目录是一份副本；撤销必须暂停全部写入成员，不能马上由另一个成员覆盖回来。
        for mut member in unit.targets.clone() {
            member.enabled = false;
            self.database()?.upsert_target(&member)?;
            self.database()?.delete_delivery(&format!("dlv_{}", member.id))?;
        }
        target.enabled = false;
        self.activity(
            ActivityKind::Repair,
            ActivityMessageId::BackupUndone,
            None,
            params! {"target" => target.label.clone(), "env" => target.env_id.as_str()},
            true,
        )?;
        self.publish_locked()?;
        Ok(target)
    }

    pub fn set_autostart_hook(&self, hook: AutostartHook) {
        let _ = self.autostart.set(hook);
    }

    pub(super) fn require_target(&self, id: &str) -> Result<Target> {
        self.list_targets()?
            .into_iter()
            .find(|t| t.id == id)
            .ok_or_else(|| AppError::ipc(IpcErrorId::NotFound))
    }

    pub fn set_target_enabled(&self, id: &str, enabled: bool) -> Result<Target> {
        let updated = self.set_targets_enabled(std::slice::from_ref(&id.to_string()), enabled)?;
        updated
            .into_iter()
            .next()
            .ok_or_else(|| AppError::ipc(IpcErrorId::NotFound))
    }

    /// 批量开关同一 Agent 在各运行环境的目录，只做一次对账与发布，减少重复磁盘与 WSL 开销。
    pub fn set_targets_enabled(&self, ids: &[String], enabled: bool) -> Result<Vec<Target>> {
        let _edit = self.edit()?;
        let mut targets = Vec::with_capacity(ids.len());
        for id in ids {
            targets.push(self.require_target(id)?);
        }
        if !enabled {
            let plan = self.delivery_plan()?;
            let id_set: BTreeSet<&str> = ids.iter().map(String::as_str).collect();
            let mut removed_units = BTreeSet::new();
            for target in &targets {
                if !target.enabled {
                    continue;
                }
                if let Some(unit) = plan.unit_for(&target.id) {
                    let any_remaining = unit
                        .targets
                        .iter()
                        .any(|t| !id_set.contains(t.id.as_str()) && t.enabled);
                    if !any_remaining && removed_units.insert(unit.id().to_string()) {
                        let env = self.context(&target.env_id)?;
                        deliver::remove_unit(&self.paths, &env, unit)?;
                    }
                } else if !plan.windows_shared.contains_key(&target.id) {
                    let env = self.context(&target.env_id)?;
                    deliver::remove(&self.paths, &env, target)?;
                }
            }
        }
        {
            let db = self.database()?;
            for target in &mut targets {
                target.enabled = enabled;
                db.upsert_target(target)?;
            }
        }
        self.publish_locked()?;
        Ok(targets)
    }

    pub fn add_custom_target(&self, req: AddCustomTargetRequest) -> Result<Target> {
        let _edit = self.edit()?;
        let env = self.context(&req.env_id)?;
        deliver::validate_custom_target(&self.paths, &env, &req, &self.list_targets()?)?;
        let target = Target {
            id: crate::new_id("tgt"),
            env_id: req.env_id,
            agent: AgentId::Custom,
            agent_key: format!("custom:{}", req.label.trim()),
            label: req.label.trim().into(),
            path: req.path,
            enabled: true,
            detected: false,
        };
        self.database()?.upsert_target(&target)?;
        self.publish_locked()?;
        Ok(target)
    }

    pub fn remove_custom_target(&self, id: &str) -> Result<()> {
        let _edit = self.edit()?;
        let target = self.require_target(id)?;
        if target.agent != AgentId::Custom {
            return Err(AppError::ipc(IpcErrorId::NotFound));
        }
        let env = self.context(&target.env_id)?;
        let plan = self.delivery_plan()?;
        if let Some(unit) = plan.unit_for(id) {
            let remaining: Vec<_> = unit.targets.iter().filter(|t| t.id != id).cloned().collect();
            if remaining.iter().any(|t| t.enabled) {
                deliver::retag_unit(&self.paths, &env, unit, &remaining)?;
            } else {
                deliver::remove_unit(&self.paths, &env, unit)?;
            }
        } else if !plan.windows_shared.contains_key(id) {
            deliver::remove(&self.paths, &env, &target)?;
        }
        self.database()?.delete_target(id)?;
        if !self.list_targets()?.iter().any(|t| t.agent_key == target.agent_key) {
            for mut asset in self.list_assets()? {
                asset.agent_mut().agents.retain(|key| key != &target.agent_key);
                self.database()?.upsert_asset(&asset)?;
            }
        }
        self.publish_locked()?;
        Ok(())
    }

    pub fn remove_all_deliveries(&self) -> Result<()> {
        let _edit = self.edit()?;
        // 按真实目录撤回一次；成功的组先记下，后续失败不掩盖已经完成的撤回。
        let plan = self.delivery_plan()?;
        let mut failure = None;
        let mut handled = BTreeSet::new();
        for unit in &plan.units {
            handled.extend(unit.targets.iter().map(|t| t.id.clone()));
            match self
                .context(&unit.env_id)
                .and_then(|env| deliver::remove_unit(&self.paths, &env, unit))
            {
                Ok(_) => {
                    for mut target in unit.targets.clone() {
                        target.enabled = false;
                        self.database()?.upsert_target(&target)?;
                        self.database()?.delete_delivery(&format!("dlv_{}", target.id))?;
                    }
                }
                Err(error) => failure = Some(error),
            }
        }
        for mut target in self.list_targets()?.into_iter().filter(|t| !handled.contains(&t.id)) {
            let result = if plan.windows_shared.contains_key(&target.id) {
                Ok(false)
            } else {
                self.context(&target.env_id)
                    .and_then(|env| deliver::remove(&self.paths, &env, &target))
            };
            match result {
                Ok(_) => {
                    target.enabled = false;
                    self.database()?.upsert_target(&target)?;
                    self.database()?.delete_delivery(&format!("dlv_{}", target.id))?;
                }
                Err(error) => failure = Some(error),
            }
        }
        self.publish_locked()?;
        failure.map_or(Ok(()), Err)
    }

    pub fn save_skill_config(&self, input: SkillConfig) -> Result<Vec<CompileStatus>> {
        let _edit = self.edit()?;
        let input = input.migrated();
        let line_ok = |text: &str| !text.trim().is_empty() && text.len() <= 4096;
        if input.conventions.len() > 100
            || input.relation_notes.len() > 100
            || input.hidden_relations.len() > 1000
            || !input.conventions.iter().all(|c| line_ok(&c.text))
            || !input
                .relation_notes
                .iter()
                .all(|n| line_ok(&n.text) && n.id.len() <= 200)
            || input.hidden_relations.iter().any(|id| id.is_empty() || id.len() > 400)
        {
            return Err(AppError::ipc(IpcErrorId::SettingsInvalid));
        }
        self.database()?.put_skill_config(&input)?;
        self.publish_locked()
    }

    /// CloudLink 从资源数据推出的关系，标出用户隐藏的（资源关系，2026-11-07）
    pub fn list_relations(&self) -> Result<Vec<Relation>> {
        let assets = self.list_assets()?;
        let config = self.get_skill_config()?;
        Ok(crate::compile::relations::with_hidden(
            crate::compile::relations::derive(&assets),
            &config,
        ))
    }

    pub fn preview_skill(&self, req: PreviewRequest) -> Result<CompilePreview> {
        let env = self.context(&req.env_id)?;
        let mut assets = self.list_assets()?;
        let target = Target {
            id: "preview".into(),
            env_id: req.env_id.clone(),
            agent: AgentId::Custom,
            agent_key: req.agent_key.clone(),
            label: req.agent_key.clone(),
            path: String::new(),
            enabled: true,
            detected: false,
        };
        // A draft must not invalidate the managed-file proof of unrelated saved resources.
        let inclusions = deliver::compute_inclusions(&assets, std::slice::from_ref(&env), &[target]);
        let mut force_id = None;
        if let Some(input) = req.asset {
            let draft = self.build_asset(input, false)?;
            force_id = Some(draft.id().to_string());
            if let Some(index) = assets.iter().position(|a| a.id() == draft.id()) {
                assets[index] = draft;
            } else {
                assets.push(draft);
            }
        }
        let included: Vec<_> = assets
            .iter()
            .filter(|a| {
                force_id.as_deref() == Some(a.id()) || inclusions.iter().any(|i| i.asset_id == a.id() && i.included)
            })
            .collect();
        let config = req.config.unwrap_or(self.get_skill_config()?);
        let settings = self.get_settings()?;
        let inbox = env.windows_path_to_native(&self.paths.inbox_dir());
        let runner = env.windows_path_to_native(&crate::guard::executable_path(&self.paths));
        Ok(compile::compile(&CompileInput {
            env_id: &req.env_id,
            agent_key: &req.agent_key,
            assets: &included,
            all_assets: &assets,
            config: &config,
            inbox: &inbox,
            runner: &runner,
            body_line_limit: settings.body_line_limit,
            write_snapshot_time: settings.write_snapshot_time,
            now_secs: crate::time::now_secs(),
        }))
    }

    pub fn update_settings(&self, patch: SettingsPatch) -> Result<Settings> {
        let _edit = self.edit()?;
        let mut settings = self.get_settings()?;
        if patch.data_dir.as_ref().is_some_and(|p| p != &settings.data_dir)
            || patch.log_dir.as_ref().is_some_and(|p| p != &settings.log_dir)
        {
            return Err(AppError::ipc(IpcErrorId::SettingsInvalid));
        }
        if let Some(v) = patch.body_line_limit {
            if !(20..=500).contains(&v) {
                return Err(AppError::ipc(IpcErrorId::SettingsInvalid));
            }
            settings.body_line_limit = v;
        }
        if let Some(v) = patch.probe_timeout_sec {
            if !(10..=120).contains(&v) {
                return Err(AppError::ipc(IpcErrorId::SettingsInvalid));
            }
            settings.probe_timeout_sec = v;
        }
        if let Some(v) = patch.windows_ssh_path {
            if !Path::new(&v).is_absolute() || v.contains(['\0', '\n', '\r']) {
                return Err(AppError::ipc(IpcErrorId::SettingsInvalid));
            }
            settings.windows_ssh_path = v;
        }
        if let Some(v) = patch.theme {
            settings.theme = v;
        }
        if let Some(v) = patch.output_language {
            settings.output_language = v;
        }
        if let Some(v) = patch.write_snapshot_time {
            settings.write_snapshot_time = v;
        }
        if let Some(v) = patch.default_mode {
            settings.default_mode = v;
        }
        if let Some(v) = patch.ssh_include_asked {
            settings.ssh_include_asked = v;
        }
        if let Some(v) = patch.close_to_tray {
            settings.close_to_tray = v;
        }
        if let Some(v) = patch.launch_at_login {
            if let Some(hook) = self.autostart.get()
                && !hook(v)
            {
                return Err(AppError::ipc(IpcErrorId::SettingsInvalid));
            }
            settings.launch_at_login = v;
        }
        let auto_check_updates = patch.auto_check_updates;
        if let Some(v) = auto_check_updates {
            settings.auto_check_updates = v;
        }
        if let Some(v) = patch.environments {
            let envs = self.contexts(false)?;
            if v.iter().any(|s| !envs.iter().any(|e| e.id == s.id))
                || v.iter().map(|s| &s.id).collect::<BTreeSet<_>>().len() != v.len()
            {
                return Err(AppError::ipc(IpcErrorId::SettingsInvalid));
            }
            // 同一环境的共用目录只撤回一次；WSL 共用 Windows 的目录不从 WSL 删除。
            let plan = self.delivery_plan()?;
            let mut removed = BTreeSet::new();
            for target in self.list_targets()? {
                if v.iter().any(|s| s.id == target.env_id && !s.enabled)
                    && let Some(env) = envs.iter().find(|e| e.id == target.env_id)
                {
                    if let Some(unit) = plan.unit_for(&target.id) {
                        if removed.insert(unit.id().to_string()) {
                            deliver::remove_unit(&self.paths, env, unit)?;
                        }
                    } else if !plan.windows_shared.contains_key(&target.id) {
                        deliver::remove(&self.paths, env, &target)?;
                    }
                }
            }
            settings.environments = v;
        }
        self.database()?.put_settings(&settings)?;
        if let Some(v) = auto_check_updates {
            // F-406 AC6：打开时立即检查一次，关闭时立即停止并隐藏提醒
            self.updates.set_enabled(v, std::time::Instant::now());
        }
        self.publish_locked()?;
        Ok(settings)
    }

    pub(super) fn cli_contexts(&self) -> Result<Vec<EnvContext>> {
        let enabled: BTreeSet<_> = self
            .list_targets()?
            .iter()
            .filter(|t| t.enabled)
            .map(|t| t.env_id.clone())
            .collect();
        Ok(self
            .contexts(true)?
            .into_iter()
            .filter(|e| e.available && enabled.contains(&e.id))
            .collect())
    }

    pub fn detect_cli_environment(&self, req: CliRequest) -> Result<BTreeMap<EnvId, CliEnvState>> {
        if req.provider == CliProvider::Github {
            return self
                .get_github_scope(crate::model::github::GithubScopeRequest {
                    asset_id: req.asset_id,
                    owner_login: req.account,
                    host: None,
                    force: Some(true),
                    expected_revision: None,
                })
                .map(|result| result.env_states);
        }
        let _run = self.cli_run(req.provider);
        let epoch = self.reset_epoch.load(Ordering::SeqCst);
        drop(self.edit_at(epoch)?);
        let saved = req
            .asset_id
            .as_ref()
            .map(|id| self.database()?.require_asset(id))
            .transpose()?;
        let account = saved
            .as_ref()
            .and_then(Asset::as_cli)
            .and_then(|a| a.account.as_deref())
            .or(req.account.as_deref());
        if saved
            .as_ref()
            .is_some_and(|a| a.as_cli().is_none_or(|c| c.cli_provider != req.provider))
        {
            return Err(AppError::ipc(IpcErrorId::NotFound));
        }
        let states = self.cli.detect(&self.cli_contexts()?, req.provider, account)?;
        if let Some(id) = req.asset_id {
            let _edit = self.edit_at(epoch)?;
            let mut asset = self.database()?.require_asset(&id)?;
            let Asset::Cli(cli) = &mut asset else {
                return Err(AppError::ipc(IpcErrorId::NotFound));
            };
            if cli.account.as_deref() != account {
                return Err(AppError::ipc(IpcErrorId::CliAccountUnavailable));
            }
            cli.cli.env_states = states.clone();
            cli.updated_at = crate::time::now_rfc3339();
            self.database()?.upsert_asset(&asset)?;
            self.publish_locked()?;
        }
        Ok(states)
    }

    pub fn refresh_cli_scope(&self, req: CliRequest) -> Result<Vec<CliScopeItem>> {
        if req.provider == CliProvider::Github {
            return self
                .get_github_scope(crate::model::github::GithubScopeRequest {
                    asset_id: req.asset_id,
                    owner_login: req.account,
                    host: None,
                    force: Some(true),
                    expected_revision: None,
                })
                .map(|result| result.scope);
        }
        let _run = self.cli_run(req.provider);
        let epoch = self.reset_epoch.load(Ordering::SeqCst);
        drop(self.edit_at(epoch)?);
        let saved = req
            .asset_id
            .as_ref()
            .map(|id| self.database()?.require_asset(id))
            .transpose()?;
        let account = saved
            .as_ref()
            .and_then(Asset::as_cli)
            .and_then(|a| a.account.as_deref())
            .or(req.account.as_deref());
        if saved
            .as_ref()
            .is_some_and(|a| a.as_cli().is_none_or(|c| c.cli_provider != req.provider))
        {
            return Err(AppError::ipc(IpcErrorId::NotFound));
        }
        let fetched = self
            .cli
            .scope(&self.cli_contexts()?, req.provider, account, &self.list_assets()?);
        match fetched {
            Ok(mut items) => {
                if let Some(id) = req.asset_id {
                    let _edit = self.edit_at(epoch)?;
                    let mut asset = self.database()?.require_asset(&id)?;
                    let Asset::Cli(cli) = &mut asset else {
                        return Err(AppError::ipc(IpcErrorId::NotFound));
                    };
                    if cli.account.as_deref() != account {
                        return Err(AppError::ipc(IpcErrorId::CliAccountUnavailable));
                    }
                    let mut config = cli.effective_cloud_scope();
                    config.canonicalize();
                    for item in &mut items {
                        item.selected = config.includes(&item.id);
                    }
                    config.snapshot_status = CloudSnapshotStatus::Complete;
                    config.snapshot_error_id = None;
                    config.checked_at = Some(crate::time::now_rfc3339());
                    cli.cli.scope = items.clone();
                    cli.cloud_scope = Some(config);
                    cli.updated_at = crate::time::now_rfc3339();
                    self.database()?.upsert_asset(&asset)?;
                    self.publish_locked()?;
                }
                Ok(items)
            }
            Err(error) => {
                // Failed refresh on a saved cloud asset preserves its known snapshot and
                // records degraded status instead of wiping the catalog.
                if let Some(id) = req.asset_id
                    && let Ok(_edit) = self.edit_at(epoch)
                    && let Ok(db) = self.database()
                    && let Ok(mut asset) = db.require_asset(&id)
                    && let Asset::Cli(cli) = &mut asset
                    && cli.account.as_deref() == account
                {
                    let mut config = cli.effective_cloud_scope();
                    config.snapshot_status = CloudSnapshotStatus::Failed;
                    config.snapshot_error_id = Some(error.to_ipc().id);
                    config.checked_at = Some(crate::time::now_rfc3339());
                    cli.cloud_scope = Some(config);
                    cli.updated_at = crate::time::now_rfc3339();
                    let _ = db.upsert_asset(&asset);
                }
                Err(error)
            }
        }
    }

    pub fn save_cloud_scope(&self, req: CloudScopeSaveRequest) -> Result<SaveResult> {
        let epoch = self.reset_epoch.load(Ordering::SeqCst);
        if !crate::cli::valid_cloud_scope_ids(&req.selected_ids)
            || !crate::cli::valid_cloud_scope_ids(&req.excluded_ids)
        {
            return Err(AppError::ipc(IpcErrorId::CliScopeFailed));
        }
        let _edit = self.edit_at(epoch)?;
        let mut asset = self.database()?.require_asset(&req.asset_id)?;
        let Asset::Cli(cli) = &mut asset else {
            return Err(AppError::ipc(IpcErrorId::NotFound));
        };
        if cli.cli_provider == CliProvider::Github {
            return Err(AppError::ipc(IpcErrorId::NotFound));
        }
        let old = cli.effective_cloud_scope();
        if old.revision != req.expected_revision {
            return Err(AppError::ipc_with(
                IpcErrorId::CliScopeFailed,
                params! {"reason" => "revision-changed"},
            ));
        }
        let known: BTreeSet<&str> = cli.cli.scope.iter().map(|s| s.id.as_str()).collect();
        match req.mode {
            CloudScopeMode::Manual => {
                if req.selected_ids.iter().any(|id| !known.contains(id.as_str())) {
                    return Err(AppError::ipc(IpcErrorId::CliScopeFailed));
                }
            }
            CloudScopeMode::Auto => {
                if req
                    .excluded_ids
                    .iter()
                    .any(|id| !known.contains(id.as_str()) && !old.excluded_ids.contains(id))
                {
                    return Err(AppError::ipc(IpcErrorId::CliScopeFailed));
                }
            }
        }
        let mut next = CloudScopeConfig {
            mode: req.mode,
            excluded_ids: if req.mode == CloudScopeMode::Auto {
                req.excluded_ids
            } else {
                Vec::new()
            },
            selected_ids: if req.mode == CloudScopeMode::Manual {
                req.selected_ids
            } else {
                Vec::new()
            },
            snapshot_status: old.snapshot_status,
            snapshot_error_id: old.snapshot_error_id,
            checked_at: old.checked_at.clone(),
            revision: old.revision,
        };
        next.canonicalize();
        if !old.same_authority(&next) {
            next.revision = old
                .revision
                .checked_add(1)
                .ok_or_else(|| AppError::ipc(IpcErrorId::CliScopeFailed))?;
        }
        for item in &mut cli.cli.scope {
            item.selected = next.includes(&item.id);
        }
        cli.cloud_scope = Some(next);
        cli.updated_at = crate::time::now_rfc3339();
        self.database()?.upsert_asset(&asset)?;
        let statuses = self.publish_locked()?;
        self.save_result(asset, statuses)
    }

    pub fn set_cli_scope(&self, asset_id: &str, selected_ids: &[String]) -> Result<SaveResult> {
        let epoch = self.reset_epoch.load(Ordering::SeqCst);
        if selected_ids.iter().collect::<BTreeSet<_>>().len() != selected_ids.len() {
            return Err(AppError::ipc(IpcErrorId::CliScopeFailed));
        }
        let snapshot = self.database()?.require_asset(asset_id)?;
        let cli = snapshot.as_cli().ok_or_else(|| AppError::ipc(IpcErrorId::NotFound))?;
        if cli.cli_provider == CliProvider::Github {
            let result = self.get_github_scope(crate::model::github::GithubScopeRequest {
                asset_id: Some(asset_id.into()),
                owner_login: None,
                host: None,
                force: Some(false),
                expected_revision: None,
            })?;
            let mut excluded = result.config.excluded_repo_ids.clone();
            if result.config.mode == crate::model::github::GithubScopeMode::Auto {
                excluded.retain(|id| !selected_ids.contains(id));
                excluded.extend(
                    result
                        .scope
                        .iter()
                        .filter(|item| !selected_ids.contains(&item.id))
                        .map(|item| item.id.clone()),
                );
                excluded.sort();
                excluded.dedup();
            }
            return self.save_github_scope(crate::model::github::GithubScopeSaveRequest {
                asset_id: asset_id.into(),
                expected_revision: result.config.revision,
                mode: result.config.mode,
                selected_repo_ids: selected_ids.to_vec(),
                excluded_repo_ids: excluded,
                owner_login: None,
            });
        }
        // Reject IDs outside this saved account before refresh can mutate its state or timestamps.
        if selected_ids
            .iter()
            .any(|id| !cli.cli.scope.iter().any(|scope| &scope.id == id))
        {
            return Err(AppError::ipc(IpcErrorId::CliScopeFailed));
        }
        let adds_scope = selected_ids
            .iter()
            .any(|id| !cli.cli.scope.iter().any(|s| &s.id == id && s.selected));
        if adds_scope {
            self.detect_cli_environment(CliRequest {
                provider: cli.cli_provider,
                asset_id: Some(asset_id.into()),
                account: None,
            })?;
            self.refresh_cli_scope(CliRequest {
                provider: cli.cli_provider,
                asset_id: Some(asset_id.into()),
                account: None,
            })?;
        }
        let _edit = self.edit_at(epoch)?;
        let mut asset = self.database()?.require_asset(asset_id)?;
        let Asset::Cli(cli) = &mut asset else {
            return Err(AppError::ipc(IpcErrorId::NotFound));
        };
        if selected_ids.iter().any(|id| !cli.cli.scope.iter().any(|s| &s.id == id)) {
            return Err(AppError::ipc(IpcErrorId::CliScopeFailed));
        }
        let old = cli.effective_cloud_scope();
        let mut next = old.clone();
        match next.mode {
            CloudScopeMode::Auto => {
                next.excluded_ids.retain(|id| !selected_ids.contains(id));
                next.excluded_ids.extend(
                    cli.cli
                        .scope
                        .iter()
                        .filter(|item| !selected_ids.contains(&item.id))
                        .map(|item| item.id.clone()),
                );
            }
            CloudScopeMode::Manual => {
                next.selected_ids = selected_ids.to_vec();
            }
        }
        next.canonicalize();
        if !old.same_authority(&next) {
            next.revision = old.revision.saturating_add(1);
        }
        for item in &mut cli.cli.scope {
            item.selected = next.includes(&item.id);
        }
        if adds_scope {
            cli.cli.scope = self
                .cli
                .validate_scope(cli.cli_provider, cli.account.as_deref(), &cli.cli.scope)?;
        }
        cli.cloud_scope = Some(next);
        cli.updated_at = crate::time::now_rfc3339();
        self.database()?.upsert_asset(&asset)?;
        let statuses = self.publish_locked()?;
        self.save_result(asset, statuses)
    }
}

pub(super) fn check_ancestors(path: &Path) -> Result<()> {
    for ancestor in path.ancestors() {
        match fs::symlink_metadata(ancestor) {
            Ok(m) if fsx::is_link(&m) => {
                return Err(AppError::internal("reparse point is not a CloudLink writable path"));
            }
            Ok(_) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.into()),
        }
    }
    Ok(())
}

pub(super) fn ensure_data_marker(paths: &Paths) -> Result<()> {
    let path = paths.data_dir.join(".cloudlink.json");
    check_ancestors(&path)?;
    match fs::symlink_metadata(&path) {
        Ok(meta) if meta.is_file() => {
            let marker: serde_json::Value = serde_json::from_slice(&fs::read(&path)?)?;
            if marker.get("managedBy").and_then(serde_json::Value::as_str) == Some("cloudlink")
                && marker.get("kind").and_then(serde_json::Value::as_str) == Some("data")
            {
                return Ok(());
            }
            Err(AppError::ipc(IpcErrorId::SettingsInvalid))
        }
        Ok(_) => Err(AppError::ipc(IpcErrorId::SettingsInvalid)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            let mut file = fs::OpenOptions::new().write(true).create_new(true).open(path)?;
            file.write_all(b"{\"managedBy\":\"cloudlink\",\"kind\":\"data\"}\n")?;
            file.sync_all()?;
            Ok(())
        }
        Err(e) => Err(e.into()),
    }
}

/// 同一环境写法的两个目录是否相同或互相包含（只比较字面；Windows 不区分大小写）
fn same_or_nested(a: &str, b: &str, windows: bool) -> bool {
    let parts = |p: &str| -> Vec<String> {
        p.split(['/', '\\'])
            .filter(|s| !s.is_empty())
            .map(|s| if windows { s.to_lowercase() } else { s.to_string() })
            .collect()
    };
    let (a, b) = (parts(a), parts(b));
    a.starts_with(&b) || b.starts_with(&a)
}
