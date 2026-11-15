//! 密码与密钥（F-108，CC-SWITCH 二、3.1）

pub mod askpass;
pub mod keygen;
pub mod store;

use std::fmt;

use zeroize::Zeroizing;

use crate::error::{AppError, Result};
use crate::model::misc::IpcErrorId;

/// 内存中的密码：释放时清零；Debug 固定输出 `[REDACTED]`；不实现 Display / Serialize
#[derive(Clone)]
pub struct SecretString(Zeroizing<String>);

impl SecretString {
    /// 校验后构造：非空、不超过 4096 字节、不含 NUL / CR / LF。**不做 trim**，密码首尾可能本来就有空格
    pub fn new(s: String) -> Result<Self> {
        let s = Zeroizing::new(s);
        if s.is_empty() || s.len() > 4096 || s.contains(['\0', '\r', '\n']) {
            return Err(AppError::ipc(IpcErrorId::PasswordMissing));
        }
        Ok(SecretString(s))
    }
    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for SecretString {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("[REDACTED]")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn secret_validation_and_redaction() {
        let s = SecretString::new(" pa ss ".to_string()).unwrap();
        assert_eq!(s.expose(), " pa ss ");
        assert_eq!(format!("{s:?}"), "[REDACTED]");
        assert!(SecretString::new(String::new()).is_err());
        assert!(SecretString::new("a\nb".into()).is_err());
        assert!(SecretString::new("x".repeat(4097)).is_err());
    }
}
