//! 错误类型。界面只收到 `IpcError { id, params }`，文案由 copy.ts 按 id 映射；
//! 内部错误的细节只进日志，不进 IPC（日志里也不带密码和原始探测输出）

use std::io;

use serde::{Serialize, Serializer};

use crate::model::Params;
use crate::model::misc::{IpcError, IpcErrorId};

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("ipc error {id:?}")]
    Ipc { id: IpcErrorId, params: Params },
    #[error("io: {0}")]
    Io(#[from] io::Error),
    #[error("db: {0}")]
    Db(#[from] rusqlite::Error),
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
    #[error("{0}")]
    Internal(String),
}

pub type Result<T> = std::result::Result<T, AppError>;

impl AppError {
    pub fn ipc(id: IpcErrorId) -> Self {
        AppError::Ipc {
            id,
            params: Params::new(),
        }
    }
    pub fn ipc_with(id: IpcErrorId, params: Params) -> Self {
        AppError::Ipc { id, params }
    }
    pub fn internal(msg: impl Into<String>) -> Self {
        AppError::Internal(msg.into())
    }
    pub fn to_ipc(&self) -> IpcError {
        match self {
            AppError::Ipc { id, params } => IpcError {
                id: *id,
                params: (!params.is_empty()).then(|| params.clone()),
            },
            _ => IpcError {
                id: IpcErrorId::Internal,
                params: None,
            },
        }
    }
    pub fn is_ipc(&self, want: IpcErrorId) -> bool {
        matches!(self, AppError::Ipc { id, .. } if *id == want)
    }
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        if !matches!(self, AppError::Ipc { .. }) {
            log::error!("{self}");
        }
        self.to_ipc().serialize(s)
    }
}
