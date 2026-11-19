//! One-click cloud CLI setup (F-104 AC2, P9b). Starting is a user action; progress is a
//! background poll of this one environment. No frontend-provided command string is executed.

use std::sync::{Arc, Weak};
use std::time::Instant;

use crate::cli::setup;
use crate::error::{AppError, Result};
use crate::model::asset::{CliProvider, CliSetupRequest, CliSetupStarted, CliSetupState};
use crate::model::env::EnvId;
use crate::model::misc::IpcErrorId;

use super::backend::Backend;

impl Backend {
    pub fn start_cli_setup(self: &Arc<Self>, req: CliSetupRequest) -> Result<CliSetupStarted> {
        let env = self
            .cli_contexts()?
            .into_iter()
            .find(|env| env.id == req.env_id)
            .ok_or_else(|| AppError::ipc(IpcErrorId::TerminalCommandInvalid))?;
        let installed = self.cli.installed(&env, req.provider);
        let (started, initial) =
            self.cli_setups
                .start(&self.paths, &env, req.provider, &req.method, installed, Instant::now())?;
        self.emit("cli-setup://changed", &initial);
        let weak = Arc::downgrade(self);
        let id = started.id.clone();
        std::thread::spawn(move || poll(weak, id));
        Ok(started)
    }

    /// P9b waits on this one environment only; other environments keep their current state.
    fn cli_setup_ready(&self, env_id: &EnvId, provider: CliProvider) -> bool {
        let Ok(envs) = self.cli_contexts() else {
            return false;
        };
        let Some(env) = envs.into_iter().find(|env| env.id == *env_id) else {
            return false;
        };
        self.cli
            .detect(&[env], provider, None)
            .ok()
            .and_then(|states| states.get(env_id).cloned())
            .is_some_and(|state| state.installed && state.authenticated && !state.expired)
    }
}

fn poll(weak: Weak<Backend>, id: String) {
    loop {
        let Some(backend) = weak.upgrade() else {
            return;
        };
        let interval = backend.cli_setups.timing.poll;
        drop(backend);
        std::thread::sleep(interval);
        let Some(backend) = weak.upgrade() else {
            return;
        };
        let Some((env_id, provider)) = backend.cli_setups.snapshot(&id) else {
            return;
        };
        let ready = backend.cli_setup_ready(&env_id, provider);
        if let Some(progress) = backend.cli_setups.evaluate(&id, Instant::now(), ready) {
            backend.emit("cli-setup://changed", &setup::event(&id, provider, &env_id, progress));
            if !matches!(
                progress.state,
                CliSetupState::WaitingInstall | CliSetupState::WaitingLogin
            ) {
                return;
            }
        }
    }
}
