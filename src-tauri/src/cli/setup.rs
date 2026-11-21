//! One-click CLI install and login (F-104 AC2, P9b; revised 2026-11-21). A fixed command
//! table chosen by `{provider, environment, method}` runs in a hidden process for the CLIs
//! whose login is browser-based (`cf`, `vercel`, `gh`), so no console window appears; the
//! CLI opens the authorization page itself. OCI's `oci setup bootstrap` is an interactive
//! terminal wizard with no browser flow, so only that provider keeps a visible terminal.
//! CloudLink never accepts a command string from the frontend, never reads credentials, and
//! observes completion only through one-shot marker files and a fresh read-only environment
//! check.

use std::collections::BTreeMap;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::env::EnvContext;
use crate::error::{AppError, Result};
use crate::model::asset::{CliProvider, CliSetupChangedEvent, CliSetupStarted, CliSetupState, CliSetupStep};
use crate::model::env::EnvId;
use crate::model::misc::IpcErrorId;
use crate::paths::Paths;
use crate::proc;

use super::runner::{ps_quote, sh_quote};

/// Waiting cadence and per-step ceiling (P9b): 4–5 seconds, ten minutes each.
pub const POLL_INTERVAL: Duration = Duration::from_secs(4);
pub const STEP_TIMEOUT: Duration = Duration::from_secs(10 * 60);
const MAX_MARKER_BYTES: u64 = 64;
const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;

#[derive(Debug, Clone, Copy)]
pub struct Timing {
    pub poll: Duration,
    pub step: Duration,
}

impl Default for Timing {
    fn default() -> Self {
        Self {
            poll: POLL_INTERVAL,
            step: STEP_TIMEOUT,
        }
    }
}

/// What the setup process should run. The Windows script is handed to PowerShell as
/// `-EncodedCommand`; the WSL script is written to the isolated CloudLink directory and
/// executed by a fresh login shell. `visible` is true only where the CLI login itself needs
/// a terminal (OCI); the browser-based CLIs run hidden and open the authorization page.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Launch {
    Windows {
        script: String,
        visible: bool,
    },
    Wsl {
        distro: String,
        command: String,
        visible: bool,
    },
}

pub trait TerminalLauncher: Send + Sync {
    fn launch(&self, launch: &Launch) -> Result<()>;
}

/// Isolated sessions and unit tests never open a visible terminal.
pub struct InertLauncher;

impl TerminalLauncher for InertLauncher {
    fn launch(&self, _launch: &Launch) -> Result<()> {
        Ok(())
    }
}

/// Real launcher. Hidden providers run with `CREATE_NO_WINDOW`; only OCI is shown in
/// Windows Terminal (or a new console) because its login is an interactive terminal wizard.
pub struct SystemLauncher;

impl TerminalLauncher for SystemLauncher {
    fn launch(&self, launch: &Launch) -> Result<()> {
        let (visible, program, args) = match launch {
            Launch::Windows { script, visible } => {
                let encoded = encode_powershell(script);
                let args = if *visible {
                    vec![
                        "-NoLogo".to_string(),
                        "-NoProfile".to_string(),
                        "-NoExit".to_string(),
                        "-EncodedCommand".to_string(),
                        encoded,
                    ]
                } else {
                    vec![
                        "-NoLogo".to_string(),
                        "-NoProfile".to_string(),
                        "-NonInteractive".to_string(),
                        "-WindowStyle".to_string(),
                        "Hidden".to_string(),
                        "-EncodedCommand".to_string(),
                        encoded,
                    ]
                };
                (*visible, "powershell.exe".to_string(), args)
            }
            Launch::Wsl {
                distro,
                command,
                visible,
            } => {
                let args = vec![
                    "-d".to_string(),
                    distro.clone(),
                    "--".to_string(),
                    "bash".to_string(),
                    "-ilc".to_string(),
                    command.clone(),
                ];
                (*visible, "wsl.exe".to_string(), args)
            }
        };
        if !visible {
            // `proc::command` adds CREATE_NO_WINDOW; the child never gets a console window.
            let mut command = proc::command(&program);
            command
                .args(&args)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                // A CI marker inherited from the launcher must not turn user-facing login
                // into a headless flow that refuses to open the browser.
                .env_remove("CI");
            return command
                .spawn()
                .map(|_| ())
                .map_err(|_| AppError::ipc(IpcErrorId::TerminalCommandInvalid));
        }
        if let Some(wt) = program_path("wt.exe") {
            let mut wt_args = vec!["new-tab".to_string(), "--".to_string(), program.clone()];
            wt_args.extend(args.iter().cloned());
            if std::process::Command::new(wt).args(&wt_args).spawn().is_ok() {
                return Ok(());
            }
        }
        let mut command = std::process::Command::new(&program);
        command.args(&args);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x0000_0010); // CREATE_NEW_CONSOLE: the user asked for it
        }
        command
            .spawn()
            .map(|_| ())
            .map_err(|_| AppError::ipc(IpcErrorId::TerminalCommandInvalid))
    }
}

fn program_path(name: &str) -> Option<PathBuf> {
    if let Some(path) = std::env::var_os("PATH") {
        for directory in std::env::split_paths(&path) {
            if directory.as_os_str().is_empty() {
                continue;
            }
            let candidate = directory.join(name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    // wt.exe and winget.exe are app execution aliases; the alias directory is often absent
    // from both system and user PATH (verified on this workstation 2026-11-19).
    let local = std::env::var_os("LOCALAPPDATA")?;
    let candidate = PathBuf::from(local).join("Microsoft").join("WindowsApps").join(name);
    candidate.is_file().then_some(candidate)
}

/// PowerShell `-EncodedCommand` input: UTF-16LE, base64. Kept dependency-free.
pub fn encode_powershell(script: &str) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let bytes: Vec<u8> = script.encode_utf16().flat_map(u16::to_le_bytes).collect();
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let a = chunk[0] as u32;
        let b = chunk.get(1).copied().unwrap_or(0) as u32;
        let c = chunk.get(2).copied().unwrap_or(0) as u32;
        let value = (a << 16) | (b << 8) | c;
        out.push(TABLE[((value >> 18) & 0x3f) as usize] as char);
        out.push(TABLE[((value >> 12) & 0x3f) as usize] as char);
        if chunk.len() > 1 {
            out.push(TABLE[((value >> 6) & 0x3f) as usize] as char);
        } else {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(TABLE[(value & 0x3f) as usize] as char);
        } else {
            out.push('=');
        }
    }
    out
}

/// Browser-based login commands run without a terminal. `gh` needs `--web` and explicit
/// host/protocol flags so it does not stop at its interactive questions.
fn login_command(provider: CliProvider) -> &'static str {
    match provider {
        // `--force` matters for the ready-state "switch account" action: without it cf exits
        // early with "You are already logged in" and the browser never opens.
        CliProvider::Cloudflare => "cf auth login --force",
        CliProvider::Vercel => "vercel login",
        CliProvider::Oracle => "oci setup bootstrap",
        CliProvider::Github => "gh auth login --web --clipboard --git-protocol https --hostname github.com",
    }
}

/// Only OCI's setup wizard has no browser flow and must stay visible.
fn needs_visible_terminal(provider: CliProvider) -> bool {
    provider == CliProvider::Oracle
}

/// The only commands this feature may run. The method id must be one the wizard shows for
/// this provider and environment; everything else is rejected before any process starts.
fn install_command(provider: CliProvider, env: &EnvContext, method: &str) -> Option<&'static str> {
    let windows = env.is_windows();
    match (provider, windows, method) {
        (CliProvider::Cloudflare, _, "npm") => Some("npm install --global cf"),
        (CliProvider::Cloudflare, _, "pnpm") => Some("pnpm add --global cf"),
        (CliProvider::Vercel, _, "npm") => Some("npm install -g vercel"),
        (CliProvider::Vercel, _, "pnpm") => Some("pnpm add -g vercel"),
        (CliProvider::Vercel, _, "bun") => Some("bun add -g vercel"),
        (CliProvider::Oracle, true, "winget") => Some("winget install --exact --id Oracle.OCI-CLI"),
        (CliProvider::Oracle, false, "script") => Some(
            "bash -c \"$(curl -L https://raw.githubusercontent.com/oracle/oci-cli/master/scripts/install/install.sh)\"",
        ),
        (CliProvider::Oracle, _, "pip") => Some("pip install oci-cli"),
        (CliProvider::Github, true, "winget") => Some("winget install --id GitHub.cli"),
        (CliProvider::Github, false, "apt") => Some("sudo apt install gh"),
        _ => None,
    }
}

fn ps_command(command: &str) -> String {
    if let Some(rest) = command.strip_prefix("winget ") {
        let program = program_path("winget.exe")
            .map(|path| ps_quote(&path.to_string_lossy()))
            .unwrap_or_else(|| "winget".to_string());
        format!("& {program} {rest}")
    } else {
        format!("& {command}")
    }
}

fn refresh_path() -> &'static str {
    "$env:Path = @([Environment]::GetEnvironmentVariable('Path','Machine'), [Environment]::GetEnvironmentVariable('Path','User'), $env:Path) -join ';'"
}

fn set_marker(quoted_path: &str, step: &str) -> String {
    format!("Set-Content -LiteralPath {quoted_path} -NoNewline -Value ('{step}:' + $code) -Encoding ASCII")
}

fn windows_script(plan: &SetupPlan) -> String {
    let mut lines = vec!["$ErrorActionPreference = 'Continue'".to_string()];
    // The app's inherited PATH predates any CLI installed after it started. Merge the
    // registry on every run, including a login-only retry, or `oci` (installed by winget
    // after CloudLink started) is not found by this fresh PowerShell.
    lines.push(refresh_path().into());
    if let (Some(install), Some(marker)) = (plan.install, &plan.install_marker_script) {
        lines.push(ps_command(install));
        lines.push("$ok = $?".into());
        lines.push("$code = $LASTEXITCODE".into());
        lines.push("if (-not $ok -and ($null -eq $code -or $code -eq 0)) { $code = 1 }".into());
        lines.push("if ($null -eq $code) { $code = 0 }".into());
        lines.push(set_marker(marker, "install"));
        lines.push("if ($code -eq 0) {".into());
    }
    let indent = if plan.install.is_some() { "  " } else { "" };
    if plan.install.is_some() {
        lines.push(format!("{indent}{}", refresh_path()));
    }
    lines.push(format!("{indent}{}", ps_command(plan.login)));
    lines.push(format!("{indent}$ok = $?"));
    lines.push(format!("{indent}$code = $LASTEXITCODE"));
    lines.push(format!(
        "{indent}if (-not $ok -and ($null -eq $code -or $code -eq 0)) {{ $code = 1 }}"
    ));
    lines.push(format!("{indent}if ($null -eq $code) {{ $code = 0 }}"));
    if let Some(marker) = &plan.login_marker_script {
        lines.push(format!("{indent}{}", set_marker(marker, "login")));
    }
    if plan.install.is_some() {
        lines.push("}".into());
    }
    lines.join("\n")
}

fn wsl_script(plan: &SetupPlan, mount_prefix: &str) -> String {
    let mut lines = vec!["#!/bin/bash".to_string()];
    // WSL has no browser of its own. The browser-based CLIs call `xdg-open`; a temporary
    // shim forwards that URL to the Windows default browser through WSL interop. Only
    // http(s) URLs are passed, and no shell evaluates the URL again. `rundll32` is a GUI
    // entry point, so it does not flash a console window.
    let open_browser = wsl_path(Path::new(r"C:\Windows\System32\rundll32.exe"), mount_prefix)
        .unwrap_or_else(|| "/mnt/c/Windows/System32/rundll32.exe".into());
    lines.push("cl_open=$(mktemp -d)".into());
    lines.push("export cl_open".into());
    lines.push("trap 'rm -rf \"$cl_open\"' EXIT".into());
    lines.push("cat > \"$cl_open/xdg-open\" <<'CL_CLOUDLINK_OPEN'".into());
    lines.push("#!/bin/sh".into());
    lines.push("case \"$1\" in http://*|https://*) ;; *) exit 0 ;; esac".into());
    lines.push(format!(
        "\"{open_browser}\" url.dll,FileProtocolHandler \"$1\" >/dev/null 2>&1"
    ));
    lines.push("exit 0".into());
    lines.push("CL_CLOUDLINK_OPEN".into());
    lines.push("chmod +x \"$cl_open/xdg-open\"".into());
    lines.push("export PATH=\"$cl_open:$PATH\"".into());
    if let (Some(install), Some(marker)) = (plan.install, &plan.install_marker_script) {
        lines.push(install.to_string());
        lines.push("code=$?".into());
        lines.push(format!("printf 'install:%s' \"$code\" > {}", marker));
        lines.push("if [ \"$code\" -eq 0 ]".into());
        lines.push("then".into());
    }
    // A login profile can rebuild PATH; prepend the shim directory again inside the login
    // shell so cf/vercel/gh still find `xdg-open`.
    lines.push(format!(
        "bash -ilc {}",
        sh_quote(&format!("export PATH=\"$cl_open:$PATH\"; {}", plan.login))
    ));
    lines.push("code=$?".into());
    if let Some(marker) = &plan.login_marker_script {
        lines.push(format!("printf 'login:%s' \"$code\" > {}", marker));
    }
    if plan.install.is_some() {
        lines.push("fi".into());
    }
    lines.push("exit 0".into());
    lines.join("\n")
}

/// `C:\Users\me\.cloudlink` → `/mnt/c/Users/me/.cloudlink`. Only drive-letter paths are
/// accepted; a UNC or relative path cannot be reached from WSL and is rejected.
fn wsl_path(path: &Path, mount_prefix: &str) -> Option<String> {
    let text = path.to_string_lossy();
    let bytes = text.as_bytes();
    if bytes.len() < 3 || bytes[1] != b':' || !bytes[0].is_ascii_alphabetic() {
        return None;
    }
    let drive = (bytes[0] as char).to_ascii_lowercase();
    let prefix = if mount_prefix.is_empty() { "/mnt/" } else { mount_prefix };
    let prefix = if prefix.ends_with('/') {
        prefix.to_string()
    } else {
        format!("{prefix}/")
    };
    Some(format!("{prefix}{drive}{}", text[2..].replace('\\', "/")))
}

struct SetupPlan {
    id: String,
    provider: CliProvider,
    env_id: EnvId,
    phase: CliSetupState,
    phase_started: Instant,
    install: Option<&'static str>,
    login: &'static str,
    install_marker: Option<PathBuf>,
    login_marker: Option<PathBuf>,
    install_marker_script: Option<String>,
    login_marker_script: Option<String>,
    script_file: Option<PathBuf>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SetupProgress {
    pub state: CliSetupState,
    pub step: Option<CliSetupStep>,
}

pub struct Setups {
    launcher: Arc<dyn TerminalLauncher>,
    pub timing: Timing,
    active: Mutex<BTreeMap<String, SetupPlan>>,
}

impl Setups {
    pub fn new(launcher: Arc<dyn TerminalLauncher>) -> Self {
        Self::with_timing(launcher, Timing::default())
    }

    pub fn with_timing(launcher: Arc<dyn TerminalLauncher>, timing: Timing) -> Self {
        Self {
            launcher,
            timing,
            active: Mutex::new(BTreeMap::new()),
        }
    }

    pub fn snapshot(&self, id: &str) -> Option<(EnvId, CliProvider)> {
        self.active
            .lock()
            .ok()?
            .get(id)
            .map(|plan| (plan.env_id.clone(), plan.provider))
    }

    /// Start (or restart) the single setup for this environment. The terminal launch happens
    /// before the plan becomes observable, so a failed launch leaves no waiting state behind.
    pub fn start(
        &self,
        paths: &Paths,
        env: &EnvContext,
        provider: CliProvider,
        method: &str,
        installed: bool,
        now: Instant,
    ) -> Result<(CliSetupStarted, CliSetupChangedEvent)> {
        if !env.available {
            return Err(AppError::ipc(IpcErrorId::TerminalCommandInvalid));
        }
        // The method is validated even when only the login step will run, so the frontend
        // cannot smuggle an unlisted method id into this feature.
        let install =
            install_command(provider, env, method).ok_or_else(|| AppError::ipc(IpcErrorId::TerminalCommandInvalid))?;
        let install = (!installed).then_some(install);
        let login = login_command(provider);
        let id = random_token();
        let directory = ensure_setup_directory(&paths.data_dir)?;
        let install_marker = (!installed).then(|| directory.join(format!("{id}.install")));
        let login_marker = directory.join(format!("{id}.login"));
        let script_file = (!env.is_windows()).then(|| directory.join(format!("{id}.sh")));

        let mut plan = SetupPlan {
            id: id.clone(),
            provider,
            env_id: env.id.clone(),
            phase: if install.is_some() {
                CliSetupState::WaitingInstall
            } else {
                CliSetupState::WaitingLogin
            },
            phase_started: now,
            install,
            login,
            install_marker: install_marker.clone(),
            login_marker: Some(login_marker.clone()),
            install_marker_script: None,
            login_marker_script: None,
            script_file: script_file.clone(),
        };

        let visible = needs_visible_terminal(provider);
        let launch = if env.is_windows() {
            plan.install_marker_script = install_marker.as_ref().map(|path| ps_quote(&path.to_string_lossy()));
            plan.login_marker_script = Some(ps_quote(&login_marker.to_string_lossy()));
            Launch::Windows {
                script: windows_script(&plan),
                visible,
            }
        } else {
            let distro = env
                .id
                .wsl_distro()
                .ok_or_else(|| AppError::ipc(IpcErrorId::TerminalCommandInvalid))?
                .to_string();
            let convert = |path: &Path| {
                wsl_path(path, &env.mount_prefix)
                    .map(|text| sh_quote(&text))
                    .ok_or_else(|| AppError::ipc(IpcErrorId::TerminalCommandInvalid))
            };
            plan.install_marker_script = install_marker.as_deref().map(convert).transpose()?;
            plan.login_marker_script = Some(convert(&login_marker)?);
            let script = wsl_script(&plan, &env.mount_prefix);
            let file = script_file
                .as_ref()
                .ok_or_else(|| AppError::ipc(IpcErrorId::TerminalCommandInvalid))?;
            write_script(file, &script)?;
            let wsl_file =
                wsl_path(file, &env.mount_prefix).ok_or_else(|| AppError::ipc(IpcErrorId::TerminalCommandInvalid))?;
            Launch::Wsl {
                distro,
                command: format!("bash -ilc {}", sh_quote(&format!("bash {}", sh_quote(&wsl_file)))),
                visible,
            }
        };

        // Replace any running setup for this environment so two terminal scripts cannot fight.
        if let Ok(mut active) = self.active.lock() {
            let previous: Vec<String> = active
                .iter()
                .filter(|(_, plan)| plan.env_id == env.id)
                .map(|(id, _)| id.clone())
                .collect();
            for id in previous {
                if let Some(plan) = active.remove(&id) {
                    cleanup(&plan);
                }
            }
        }
        if let Err(error) = self.launcher.launch(&launch) {
            cleanup(&plan);
            return Err(error);
        }
        let initial = SetupProgress {
            state: plan.phase,
            step: None,
        };
        let event = event_for(&plan, initial);
        self.active
            .lock()
            .map_err(|_| AppError::internal("CLI setup state unavailable"))?
            .insert(id.clone(), plan);
        Ok((
            CliSetupStarted {
                id,
                state: initial.state,
                step: initial.step,
            },
            event,
        ))
    }

    /// One poll tick. Returns only state changes. Marker files are one-shot and removed after
    /// a strict read, so a stale file can never approve a later setup.
    pub fn evaluate(&self, id: &str, now: Instant, ready: bool) -> Option<SetupProgress> {
        let mut active = self.active.lock().ok()?;
        let plan = active.get_mut(id)?;
        if plan.phase == CliSetupState::WaitingInstall
            && let Some(code) = plan
                .install_marker
                .as_deref()
                .and_then(|path| read_marker(path, "install"))
        {
            remove_file(plan.install_marker.as_deref());
            if code != 0 {
                let event = SetupProgress {
                    state: CliSetupState::Failed,
                    step: Some(CliSetupStep::Install),
                };
                let plan = active.remove(id)?;
                cleanup(&plan);
                return Some(event);
            }
            plan.phase = CliSetupState::WaitingLogin;
            plan.phase_started = now;
            return Some(SetupProgress {
                state: CliSetupState::WaitingLogin,
                step: None,
            });
        }
        if plan.phase == CliSetupState::WaitingLogin
            && let Some(code) = plan.login_marker.as_deref().and_then(|path| read_marker(path, "login"))
        {
            // The login command exiting is not proof of a usable session; detection decides.
            remove_file(plan.login_marker.as_deref());
            if code != 0 {
                let event = SetupProgress {
                    state: CliSetupState::Failed,
                    step: Some(CliSetupStep::Login),
                };
                let plan = active.remove(id)?;
                cleanup(&plan);
                return Some(event);
            }
        }
        if ready {
            let plan = active.remove(id)?;
            cleanup(&plan);
            return Some(SetupProgress {
                state: CliSetupState::Ready,
                step: None,
            });
        }
        if now.saturating_duration_since(plan.phase_started) >= self.timing.step {
            let step = (plan.phase == CliSetupState::WaitingInstall).then_some(CliSetupStep::Install);
            let plan = active.remove(id)?;
            cleanup(&plan);
            return Some(SetupProgress {
                state: CliSetupState::TimedOut,
                step,
            });
        }
        None
    }
}

fn event_for(plan: &SetupPlan, progress: SetupProgress) -> CliSetupChangedEvent {
    CliSetupChangedEvent {
        id: plan.id.clone(),
        provider: plan.provider,
        env_id: plan.env_id.clone(),
        state: progress.state,
        step: progress.step,
    }
}

pub fn event(id: &str, provider: CliProvider, env_id: &EnvId, progress: SetupProgress) -> CliSetupChangedEvent {
    CliSetupChangedEvent {
        id: id.to_string(),
        provider,
        env_id: env_id.clone(),
        state: progress.state,
        step: progress.step,
    }
}

fn ensure_setup_directory(data_dir: &Path) -> Result<PathBuf> {
    let directory = data_dir.join("cli-setup");
    match fs::symlink_metadata(&directory) {
        Ok(metadata) => {
            if !metadata.is_dir() || metadata.file_type().is_symlink() || is_reparse(&metadata) {
                return Err(AppError::internal("CLI setup directory is not owned"));
            }
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            fs::create_dir_all(&directory)?;
        }
        Err(error) => return Err(error.into()),
    }
    Ok(directory)
}

fn write_script(path: &Path, script: &str) -> Result<()> {
    if fs::symlink_metadata(path).is_ok() {
        return Err(AppError::internal("CLI setup script already exists"));
    }
    fs::write(path, script)?;
    Ok(())
}

fn is_reparse(metadata: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
    }
    #[cfg(not(windows))]
    {
        let _ = metadata;
        false
    }
}

fn read_marker(path: &Path, expected: &str) -> Option<i32> {
    let metadata = fs::symlink_metadata(path).ok()?;
    if !metadata.is_file() || metadata.file_type().is_symlink() || is_reparse(&metadata) {
        return None;
    }
    if metadata.len() > MAX_MARKER_BYTES {
        return None;
    }
    let text = fs::read_to_string(path).ok()?;
    let (step, code) = text.trim().split_once(':')?;
    if step != expected || code.is_empty() || code.len() > 3 || !code.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    code.parse().ok()
}

fn remove_file(path: Option<&Path>) {
    let Some(path) = path else { return };
    if let Ok(metadata) = fs::symlink_metadata(path)
        && metadata.is_file()
        && !metadata.file_type().is_symlink()
        && !is_reparse(&metadata)
    {
        let _ = fs::remove_file(path);
    }
}

fn cleanup(plan: &SetupPlan) {
    remove_file(plan.install_marker.as_deref());
    remove_file(plan.login_marker.as_deref());
    remove_file(plan.script_file.as_deref());
}

fn random_token() -> String {
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hasher};

    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let mut hasher = RandomState::new().build_hasher();
    hasher.write_u128(nanos);
    hasher.write_u32(std::process::id());
    hasher.write_u64(COUNTER.fetch_add(1, Ordering::Relaxed));
    format!("{:016x}", hasher.finish())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::env::WslInfo;
    use crate::paths::Paths;

    struct FakeLauncher(Mutex<Vec<Launch>>);

    impl TerminalLauncher for FakeLauncher {
        fn launch(&self, launch: &Launch) -> Result<()> {
            self.0.lock().unwrap().push(launch.clone());
            Ok(())
        }
    }

    fn windows(paths: &Paths) -> EnvContext {
        EnvContext::windows(paths)
    }

    fn wsl(paths: &Paths) -> EnvContext {
        EnvContext::wsl(
            paths,
            "Ubuntu-24.04",
            WslInfo {
                home: "/home/test".into(),
                user: "test".into(),
                interop: true,
                mount_prefix: "/mnt/".into(),
            },
        )
    }

    fn decode_powershell(encoded: &str) -> String {
        const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let mut lookup = [0u8; 256];
        for (index, byte) in TABLE.iter().enumerate() {
            lookup[*byte as usize] = index as u8;
        }
        let mut bytes = Vec::new();
        for chunk in encoded.as_bytes().chunks(4) {
            let mut value = 0u32;
            for (i, byte) in chunk.iter().enumerate() {
                value |= (lookup[*byte as usize] as u32) << (18 - i * 6);
            }
            bytes.push((value >> 16) as u8);
            if chunk[2] != b'=' {
                bytes.push((value >> 8) as u8);
            }
            if chunk[3] != b'=' {
                bytes.push(value as u8);
            }
        }
        let units: Vec<u16> = bytes
            .chunks(2)
            .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
            .collect();
        String::from_utf16(&units).unwrap()
    }

    #[test]
    fn command_table_matches_the_frontend_display_copy() {
        let temp = tempfile::tempdir().unwrap();
        let paths = Paths::isolated_in(temp.path());
        let win = windows(&paths);
        let wsl = wsl(&paths);
        let cases = [
            ("cloudflare", "npm", "npm install --global cf"),
            ("cloudflare", "pnpm", "pnpm add --global cf"),
            ("vercel", "npm", "npm install -g vercel"),
            ("vercel", "pnpm", "pnpm add -g vercel"),
            ("vercel", "bun", "bun add -g vercel"),
            ("oracle", "winget", "winget install --exact --id Oracle.OCI-CLI"),
            ("oracle", "pip", "pip install oci-cli"),
            ("github", "winget", "winget install --id GitHub.cli"),
        ];
        for (provider, method, command) in cases {
            let provider = match provider {
                "cloudflare" => CliProvider::Cloudflare,
                "vercel" => CliProvider::Vercel,
                "oracle" => CliProvider::Oracle,
                _ => CliProvider::Github,
            };
            assert_eq!(install_command(provider, &win, method), Some(command));
        }
        assert_eq!(
            install_command(CliProvider::Oracle, &wsl, "script"),
            Some(
                "bash -c \"$(curl -L https://raw.githubusercontent.com/oracle/oci-cli/master/scripts/install/install.sh)\""
            )
        );
        assert_eq!(
            install_command(CliProvider::Oracle, &wsl, "pip"),
            Some("pip install oci-cli")
        );
        assert_eq!(
            install_command(CliProvider::Github, &wsl, "apt"),
            Some("sudo apt install gh")
        );
        assert_eq!(install_command(CliProvider::Cloudflare, &win, "bun"), None);
        assert_eq!(install_command(CliProvider::Vercel, &win, "curl"), None);
        assert_eq!(login_command(CliProvider::Cloudflare), "cf auth login --force");
        assert_eq!(login_command(CliProvider::Vercel), "vercel login");
        assert_eq!(login_command(CliProvider::Oracle), "oci setup bootstrap");
        assert_eq!(
            login_command(CliProvider::Github),
            "gh auth login --web --clipboard --git-protocol https --hostname github.com"
        );
        assert!(needs_visible_terminal(CliProvider::Oracle));
        assert!(!needs_visible_terminal(CliProvider::Cloudflare));
        assert!(!needs_visible_terminal(CliProvider::Vercel));
        assert!(!needs_visible_terminal(CliProvider::Github));
        let frontend = include_str!("../../../src/lib/cliProviders.ts");
        for command in [
            "npm install --global cf",
            "pnpm add --global cf",
            "npm install -g vercel",
            "pnpm add -g vercel",
            "bun add -g vercel",
            "winget install --exact --id Oracle.OCI-CLI",
            "pip install oci-cli",
            "winget install --id GitHub.cli",
            "cf auth login --force",
            "vercel login",
            "oci setup bootstrap",
            "gh auth login --web --clipboard --git-protocol https --hostname github.com",
        ] {
            assert!(frontend.contains(command), "frontend is missing {command}");
        }
    }

    #[test]
    fn powershell_transport_is_encodable_and_round_trips_unicode() {
        let script = "$env:Path = 'C:\\用户\\O''Brien'; & npm install --global cf";
        let encoded = encode_powershell(script);
        assert_eq!(decode_powershell(&encoded), script);
        assert!(!encoded.contains(';'));
    }

    #[test]
    fn wsl_paths_convert_only_drive_letter_paths() {
        assert_eq!(
            wsl_path(Path::new(r"C:\Users\me\.cloudlink\cli-setup\x.install"), "/mnt/"),
            Some("/mnt/c/Users/me/.cloudlink/cli-setup/x.install".into())
        );
        assert_eq!(wsl_path(Path::new(r"\\wsl.localhost\Ubuntu\tmp"), "/mnt/"), None);
        assert_eq!(wsl_path(Path::new("relative/path"), "/mnt/"), None);
    }

    #[test]
    fn marker_files_are_strict_and_one_shot() {
        let dir = tempfile::tempdir().unwrap();
        let marker = dir.path().join("marker");
        fs::write(&marker, "install:0").unwrap();
        assert_eq!(read_marker(&marker, "install"), Some(0));
        fs::write(&marker, "login:0").unwrap();
        assert_eq!(read_marker(&marker, "install"), None);
        fs::write(&marker, "install:abc").unwrap();
        assert_eq!(read_marker(&marker, "install"), None);
        fs::write(&marker, "install:12").unwrap();
        assert_eq!(read_marker(&marker, "install"), Some(12));
        fs::write(&marker, "install:1234").unwrap();
        assert_eq!(read_marker(&marker, "install"), None);
    }

    #[test]
    fn windows_launch_runs_install_then_login_and_writes_markers_under_the_isolated_home() {
        let temp = tempfile::tempdir().unwrap();
        let paths = Paths::isolated_in(temp.path());
        let launcher = Arc::new(FakeLauncher(Mutex::new(Vec::new())));
        let setups = Setups::with_timing(
            launcher.clone(),
            Timing {
                poll: Duration::from_millis(1),
                step: Duration::from_secs(60),
            },
        );
        let env = windows(&paths);
        let (started, event) = setups
            .start(&paths, &env, CliProvider::Cloudflare, "npm", false, Instant::now())
            .unwrap();
        assert_eq!(event.state, CliSetupState::WaitingInstall);
        assert_eq!(started.state, CliSetupState::WaitingInstall);
        let launches = launcher.0.lock().unwrap();
        let Launch::Windows { script, visible } = &launches[0] else {
            panic!("expected a Windows launch")
        };
        assert!(!visible, "browser-based login must not open a terminal");
        assert!(script.contains("npm install --global cf"));
        assert!(script.contains("cf auth login"));
        assert!(script.contains("Set-Content -LiteralPath"));
        assert!(script.contains(paths.data_dir.join("cli-setup").to_string_lossy().as_ref()));
        assert!(paths.data_dir.join("cli-setup").is_dir());
        assert!(setups.snapshot(&started.id).is_some());
    }

    #[test]
    fn state_machine_waits_for_install_then_login_then_rejects_a_failed_login() {
        let temp = tempfile::tempdir().unwrap();
        let paths = Paths::isolated_in(temp.path());
        let launcher = Arc::new(FakeLauncher(Mutex::new(Vec::new())));
        let setups = Setups::with_timing(
            launcher,
            Timing {
                poll: Duration::from_millis(1),
                step: Duration::from_secs(600),
            },
        );
        let env = windows(&paths);
        let started = Instant::now();
        let (state, _) = setups
            .start(&paths, &env, CliProvider::Vercel, "npm", false, started)
            .unwrap();
        let directory = paths.data_dir.join("cli-setup");
        let install = directory.join(format!("{}.install", state.id));
        fs::write(&install, "install:0").unwrap();
        let event = setups
            .evaluate(&state.id, started + Duration::from_secs(1), false)
            .unwrap();
        assert_eq!(event.state, CliSetupState::WaitingLogin);
        assert!(!install.exists());
        let login = directory.join(format!("{}.login", state.id));
        fs::write(&login, "login:1").unwrap();
        let event = setups
            .evaluate(&state.id, started + Duration::from_secs(2), false)
            .unwrap();
        assert_eq!(event.state, CliSetupState::Failed);
        assert_eq!(event.step, Some(CliSetupStep::Login));
        assert!(!login.exists());
        assert!(setups.snapshot(&state.id).is_none());
    }

    #[test]
    fn ready_stops_polling_and_timeout_is_retryable() {
        let temp = tempfile::tempdir().unwrap();
        let paths = Paths::isolated_in(temp.path());
        let launcher = Arc::new(FakeLauncher(Mutex::new(Vec::new())));
        let setups = Setups::with_timing(
            launcher,
            Timing {
                poll: Duration::from_millis(1),
                step: Duration::from_secs(10),
            },
        );
        let env = windows(&paths);
        let started = Instant::now();
        let (state, _) = setups
            .start(&paths, &env, CliProvider::Cloudflare, "npm", true, started)
            .unwrap();
        // Already installed: the terminal starts at login, so the timeout is the login step.
        assert_eq!(state.state, CliSetupState::WaitingLogin);
        let event = setups
            .evaluate(&state.id, started + Duration::from_secs(11), false)
            .unwrap();
        assert_eq!(event.state, CliSetupState::TimedOut);
        assert!(setups.snapshot(&state.id).is_none());
        let (state, _) = setups
            .start(&paths, &env, CliProvider::Cloudflare, "npm", true, Instant::now())
            .unwrap();
        let event = setups.evaluate(&state.id, Instant::now(), true).unwrap();
        assert_eq!(event.state, CliSetupState::Ready);
        assert!(setups.snapshot(&state.id).is_none());
    }

    #[test]
    fn wsl_launch_writes_a_script_inside_the_isolated_data_directory() {
        let temp = tempfile::tempdir().unwrap();
        let paths = Paths::isolated_in(temp.path());
        let launcher = Arc::new(FakeLauncher(Mutex::new(Vec::new())));
        let setups = Setups::with_timing(launcher.clone(), Timing::default());
        let env = wsl(&paths);
        let (state, event) = setups
            .start(&paths, &env, CliProvider::Oracle, "pip", false, Instant::now())
            .unwrap();
        assert_eq!(event.state, CliSetupState::WaitingInstall);
        let script = paths.data_dir.join("cli-setup").join(format!("{}.sh", state.id));
        assert!(script.is_file());
        let text = fs::read_to_string(&script).unwrap();
        assert!(text.contains("pip install oci-cli"));
        assert!(text.contains(r#"export PATH="$cl_open:$PATH"; oci setup bootstrap"#));
        let Launch::Wsl {
            distro,
            command,
            visible,
        } = &launcher.0.lock().unwrap()[0]
        else {
            panic!("expected a WSL launch")
        };
        assert_eq!(distro, "Ubuntu-24.04");
        assert!(visible, "OCI keeps its interactive terminal");
        assert!(command.contains("/mnt/"));
        assert!(command.contains("bash -ilc"));
        assert!(text.contains("xdg-open"));
    }

    #[test]
    fn only_oci_gets_a_visible_terminal() {
        let temp = tempfile::tempdir().unwrap();
        let paths = Paths::isolated_in(temp.path());
        let launcher = Arc::new(FakeLauncher(Mutex::new(Vec::new())));
        let setups = Setups::with_timing(launcher.clone(), Timing::default());
        let env = windows(&paths);
        setups
            .start(&paths, &env, CliProvider::Oracle, "winget", false, Instant::now())
            .unwrap();
        let launches = launcher.0.lock().unwrap();
        let Launch::Windows { script, visible } = &launches[0] else {
            panic!("expected a Windows launch")
        };
        assert!(visible, "OCI setup bootstrap is an interactive terminal wizard");
        assert!(script.contains("oci setup bootstrap"));
    }

    #[test]
    fn login_only_oci_setup_refreshes_the_registry_path_before_login() {
        let temp = tempfile::tempdir().unwrap();
        let paths = Paths::isolated_in(temp.path());
        let launcher = Arc::new(FakeLauncher(Mutex::new(Vec::new())));
        let setups = Setups::with_timing(launcher.clone(), Timing::default());
        let env = windows(&paths);
        let (state, _) = setups
            .start(&paths, &env, CliProvider::Oracle, "winget", true, Instant::now())
            .unwrap();
        assert_eq!(state.state, CliSetupState::WaitingLogin);
        let launches = launcher.0.lock().unwrap();
        let Launch::Windows { script, .. } = &launches[0] else {
            panic!("expected a Windows launch")
        };
        let refresh = script.find("GetEnvironmentVariable('Path','Machine')").unwrap();
        let login = script.find("& oci setup bootstrap").unwrap();
        assert!(refresh < login, "PATH must be refreshed before the login command");
        assert!(
            !script.contains("winget install"),
            "installed CLI must not be reinstalled"
        );
    }

    #[test]
    fn cloudflare_wsl_setup_runs_hidden_with_a_windows_browser_shim() {
        let temp = tempfile::tempdir().unwrap();
        let paths = Paths::isolated_in(temp.path());
        let launcher = Arc::new(FakeLauncher(Mutex::new(Vec::new())));
        let setups = Setups::with_timing(launcher.clone(), Timing::default());
        let env = wsl(&paths);
        let (state, _) = setups
            .start(&paths, &env, CliProvider::Cloudflare, "npm", false, Instant::now())
            .unwrap();
        let script = paths.data_dir.join("cli-setup").join(format!("{}.sh", state.id));
        let text = fs::read_to_string(&script).unwrap();
        assert!(text.contains("cf auth login --force"));
        assert!(text.contains("export PATH=\"$cl_open:$PATH\""));
        assert!(text.contains("xdg-open"));
        assert!(text.contains("rundll32.exe"));
        assert!(text.contains("url.dll,FileProtocolHandler"));
        let Launch::Wsl { visible, .. } = &launcher.0.lock().unwrap()[0] else {
            panic!("expected a WSL launch")
        };
        assert!(!visible);
    }

    #[test]
    fn restarting_the_same_environment_replaces_the_previous_setup_without_touching_other_files() {
        let temp = tempfile::tempdir().unwrap();
        let paths = Paths::isolated_in(temp.path());
        let launcher = Arc::new(FakeLauncher(Mutex::new(Vec::new())));
        let setups = Setups::with_timing(launcher, Timing::default());
        let env = wsl(&paths);
        let unrelated = temp.path().join("unrelated.txt");
        fs::write(&unrelated, "keep").unwrap();
        let (first, _) = setups
            .start(&paths, &env, CliProvider::Cloudflare, "npm", false, Instant::now())
            .unwrap();
        let first_script = paths.data_dir.join("cli-setup").join(format!("{}.sh", first.id));
        assert!(first_script.is_file());
        let (second, _) = setups
            .start(&paths, &env, CliProvider::Cloudflare, "npm", false, Instant::now())
            .unwrap();
        assert!(setups.snapshot(&first.id).is_none());
        assert!(setups.snapshot(&second.id).is_some());
        assert!(!first_script.exists());
        assert!(unrelated.is_file());
    }

    #[test]
    fn unavailable_environment_and_unknown_method_never_launch_a_terminal() {
        let temp = tempfile::tempdir().unwrap();
        let paths = Paths::isolated_in(temp.path());
        let launcher = Arc::new(FakeLauncher(Mutex::new(Vec::new())));
        let setups = Setups::with_timing(launcher.clone(), Timing::default());
        let mut env = windows(&paths);
        env.available = false;
        assert!(
            setups
                .start(&paths, &env, CliProvider::Cloudflare, "npm", false, Instant::now())
                .is_err()
        );
        env.available = true;
        assert!(
            setups
                .start(&paths, &env, CliProvider::Cloudflare, "curl", false, Instant::now())
                .is_err()
        );
        assert!(launcher.0.lock().unwrap().is_empty());
    }
}
