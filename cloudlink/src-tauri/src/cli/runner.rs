use std::path::PathBuf;
use std::process::Command;
use std::time::Duration;

use serde_json::{Value, json};

use super::{Query, QueryOutput, Runner, terminal_command_allowed, valid_account, valid_path};
use crate::env::EnvContext;
use crate::error::{AppError, Result};
use crate::model::asset::CliProvider;
use crate::model::misc::IpcErrorId;
use crate::paths::Paths;
use crate::proc::{self, Ended, RunOpts};

const SENTINEL: &str = "__CLOUDLINK_CLI_METADATA__";
const MAX_METADATA: u64 = 256 * 1024;
const QUERY_TIMEOUT: Duration = Duration::from_secs(30);

/// Default for isolated sessions. It does not read real environment variables, profiles,
/// credentials, or executable paths; tests replace it with a metadata fixture runner.
pub struct EmptyRunner;

impl Runner for EmptyRunner {
    fn run(&self, _env: &EnvContext, query: &Query) -> Result<QueryOutput> {
        match query {
            Query::Discover { .. } => Ok(QueryOutput::json(json!({ "installed": false }))),
            _ => Err(AppError::ipc(IpcErrorId::CliCommandUnsupported)),
        }
    }

    fn open_terminal(&self, _env: &EnvContext, _command: &str) -> Result<()> {
        Err(AppError::ipc(IpcErrorId::TerminalCommandInvalid))
    }
}

pub struct SystemRunner {
    isolated: bool,
    working_dir: PathBuf,
}

impl SystemRunner {
    pub fn new(paths: &Paths) -> Self {
        Self {
            isolated: paths.isolated,
            working_dir: paths.data_dir.clone(),
        }
    }

    fn permitted(&self) -> Result<()> {
        if self.isolated || cfg!(test) {
            return Err(AppError::ipc(IpcErrorId::CliCommandUnsupported));
        }
        Ok(())
    }
}

impl Runner for SystemRunner {
    fn run(&self, env: &EnvContext, query: &Query) -> Result<QueryOutput> {
        self.permitted()?;
        let script = script_for(env, query)?;
        let mut command = if env.is_windows() {
            let mut command = proc::command("powershell.exe");
            command.args(["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", &script]);
            command
        } else {
            let distro = env
                .distro()
                .ok_or_else(|| AppError::ipc(IpcErrorId::CliCommandUnsupported))?;
            let mut command = proc::command("wsl.exe");
            command.args(["-d", distro, "--", "bash", "-ilc", &script]);
            command
        };
        command
            .current_dir(&self.working_dir)
            .env("WRANGLER_SEND_METRICS", "false")
            .env("WRANGLER_WRITE_LOGS", "false")
            .env("WRANGLER_LOG_SANITIZE", "true")
            .env("VERCEL_TELEMETRY_DISABLED", "1")
            .env("DO_NOT_TRACK", "1")
            .env("NO_COLOR", "1")
            .env("CI", "1");
        let output = proc::run(
            command,
            RunOpts {
                timeout: QUERY_TIMEOUT,
                max_output: MAX_METADATA,
                ..Default::default()
            },
        )
        .map_err(|_| AppError::ipc(IpcErrorId::CliScopeFailed))?;
        if output.ended != Ended::Exited {
            return Err(AppError::ipc(IpcErrorId::CliScopeFailed));
        }
        // Login-shell startup messages and all stderr remain private. Only the final,
        // structured envelope emitted by the fixed bridge can leave this runner.
        let text = output.stdout_str();
        let body = text
            .rsplit_once(SENTINEL)
            .map(|(_, body)| body.trim())
            .ok_or_else(|| AppError::ipc(IpcErrorId::CliCommandUnsupported))?;
        let metadata: Value =
            serde_json::from_str(body).map_err(|_| AppError::ipc(IpcErrorId::CliCommandUnsupported))?;
        Ok(QueryOutput {
            code: output.code,
            stdout: metadata.to_string(),
        })
    }

    fn open_terminal(&self, env: &EnvContext, command: &str) -> Result<()> {
        self.permitted()
            .map_err(|_| AppError::ipc(IpcErrorId::TerminalCommandInvalid))?;
        if !env.available || !terminal_command_allowed(env, command) {
            return Err(AppError::ipc(IpcErrorId::TerminalCommandInvalid));
        }
        let mut args = vec!["new-tab".to_string()];
        let fallback_program;
        let fallback_args;
        if env.is_windows() {
            // Seed editable command history and display it. No install/login command is
            // executed until the user recalls it and presses Enter in the visible terminal.
            let quoted = ps_quote(command);
            let init = format!(
                "$clCommand={quoted}; Write-Host $clCommand; if (Get-Module -ListAvailable PSReadLine) {{ Import-Module PSReadLine; [Microsoft.PowerShell.PSConsoleReadLine]::AddToHistory($clCommand) }}"
            );
            fallback_program = "powershell.exe";
            fallback_args = vec!["-NoExit".into(), "-Command".into(), init];
            args.push(fallback_program.to_string());
        } else {
            let distro = env
                .distro()
                .ok_or_else(|| AppError::ipc(IpcErrorId::TerminalCommandInvalid))?;
            let history = format!("history -s {}; unset PROMPT_COMMAND", sh_quote(command));
            let init = format!(
                "printf '%s\\n' {}; export HISTFILE=/dev/null; export PROMPT_COMMAND={}; exec bash --noprofile --norc -i",
                sh_quote(command),
                sh_quote(&history)
            );
            fallback_program = "wsl.exe";
            fallback_args = vec![
                "-d".into(),
                distro.into(),
                "--".into(),
                "bash".into(),
                "-ilc".into(),
                init,
            ];
            args.push(fallback_program.to_string());
        }
        args.extend(fallback_args.iter().cloned());
        if Command::new("wt.exe").args(&args).spawn().is_ok() {
            return Ok(());
        }
        let mut fallback = Command::new(fallback_program);
        fallback.args(fallback_args);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            fallback.creation_flags(0x0000_0010); // CREATE_NEW_CONSOLE: explicit interactive UI action
        }
        fallback
            .spawn()
            .map(|_| ())
            .map_err(|_| AppError::ipc(IpcErrorId::TerminalCommandInvalid))
    }
}

pub(crate) fn ps_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

pub(crate) fn sh_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn query_args(query: &Query) -> (&str, CliProvider, &str, Option<&str>) {
    match query {
        Query::Discover { provider } => ("discover", *provider, "", None),
        Query::Version { provider, path } => ("version", *provider, path, None),
        Query::Identity {
            provider,
            path,
            account,
        } => ("identity", *provider, path, account.as_deref()),
        Query::Profiles { path } => ("profiles", CliProvider::Oracle, path, None),
        Query::Scope {
            provider,
            path,
            account,
        } => ("scope", *provider, path, Some(account)),
    }
}

pub(crate) fn script_for(env: &EnvContext, query: &Query) -> Result<String> {
    let (operation, provider, path, account) = query_args(query);
    if (!path.is_empty() && !valid_path(path, env)) || account.is_some_and(|a| !valid_account(provider, a)) {
        return Err(AppError::ipc(IpcErrorId::CliAccountUnavailable));
    }
    if env.is_windows() {
        let settings = format!(
            "$clOperation={}; $clProvider={}; $clBinary={}; $clAccount={};\n",
            ps_quote(operation),
            ps_quote(provider.as_str()),
            ps_quote(path),
            ps_quote(account.unwrap_or(""))
        );
        Ok(format!(
            "{}\n{}\n{}",
            PS_PROFILE,
            settings,
            include_str!("metadata.ps1")
        ))
    } else {
        let args = format!(
            "{} {} {} {}",
            sh_quote(operation),
            sh_quote(provider.as_str()),
            sh_quote(path),
            sh_quote(account.unwrap_or(""))
        );
        let body = if provider == CliProvider::Oracle && matches!(operation, "profiles" | "identity" | "scope") {
            format!("python3 -c {} {args}", sh_quote(include_str!("oracle.py")))
        } else if matches!(operation, "scope" | "identity") {
            format!("node -e {} {args}", sh_quote(include_str!("metadata.js")))
        } else {
            format!(
                "{}\ncl_operation={}; cl_provider={}; cl_binary={};\n{}",
                SH_ENV,
                sh_quote(operation),
                sh_quote(provider.as_str()),
                sh_quote(path),
                include_str!("metadata.sh")
            )
        };
        Ok(format!("{SH_ENV}\ncd /;\n{body}"))
    }
}

const PS_PROFILE: &str = r#"$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$env:WRANGLER_SEND_METRICS='false'
$env:WRANGLER_WRITE_LOGS='false'
$env:WRANGLER_LOG_SANITIZE='true'
$env:VERCEL_TELEMETRY_DISABLED='1'
$env:DO_NOT_TRACK='1'
$env:NO_COLOR='1'
$env:CI='1'
foreach ($clProfile in @($PROFILE.AllUsersAllHosts,$PROFILE.AllUsersCurrentHost,$PROFILE.CurrentUserAllHosts,$PROFILE.CurrentUserCurrentHost)) {
  if ($clProfile -and (Test-Path -LiteralPath $clProfile -PathType Leaf)) { try { & { . $clProfile } *> $null } catch {} }
}
"#;

const SH_ENV: &str = "export WRANGLER_SEND_METRICS=false WRANGLER_WRITE_LOGS=false WRANGLER_LOG_SANITIZE=true VERCEL_TELEMETRY_DISABLED=1 DO_NOT_TRACK=1 NO_COLOR=1 CI=1";
