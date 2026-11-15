//! 具名 IPC 命令、持久化协调、后台任务与护栏/收件箱管理。

mod assets;
pub mod backend;
pub mod commands;
mod execution;
mod feedback;
mod github;
mod jobs;
mod publication;
pub mod requests;
mod reset;
mod routes;
mod startup;
mod update;

pub use backend::{Backend, EventSink, TauriEvents};
pub use execution::begin_runtime;

#[cfg(test)]
mod p4c_tests;
#[cfg(test)]
mod tests;
#[cfg(test)]
mod update_tests;
