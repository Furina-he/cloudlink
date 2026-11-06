//! 具名 IPC 命令、持久化协调、后台任务与护栏/收件箱管理。

mod assets;
pub mod backend;
pub mod commands;
mod feedback;
mod jobs;
mod publication;
pub mod requests;
mod reset;
mod startup;
mod update;

pub use backend::{Backend, EventSink, TauriEvents};

#[cfg(test)]
mod p4c_tests;
#[cfg(test)]
mod tests;
#[cfg(test)]
mod update_tests;
