//! 拼进 ssh_config 或 ssh 参数的字段一律先校验（CC-SWITCH 3.2.3），杜绝指令注入和选项注入

use crate::error::{AppError, Result};

fn no_control(s: &str) -> bool {
    !s.chars().any(char::is_control)
}

/// 别名：1–64 个 `[A-Za-z0-9._-]`，不能以 `-` 或 `.` 开头（也就不会含通配符）
pub fn alias_ok(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 64
        && !s.starts_with(['-', '.'])
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
}

/// 地址：域名、IPv4 或 IPv6（可带方括号），不含空白，不以 `-` 开头
pub fn host_ok(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 253
        && !s.starts_with('-')
        // 不允许 `%`：IPv6 zone id 也会被 OpenSSH 当作 token 展开
        && s.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | ':' | '[' | ']'))
}

/// 登录用户：`[A-Za-z0-9._@-]`，不以 `-` 开头
pub fn user_ok(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 64
        && !s.starts_with('-')
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-' | '@'))
}

/// 私钥路径：该环境的绝对路径，不含 `..`、引号、`%`（OpenSSH token）、`$`（环境变量）和控制字符
pub fn identity_ok(path: &str, windows: bool) -> bool {
    if path.is_empty() || path.len() > 1024 || !no_control(path) || path.contains(['"', '%', '$']) {
        return false;
    }
    let absolute = if windows {
        let b = path.as_bytes();
        (b.len() >= 3 && b[0].is_ascii_alphabetic() && b[1] == b':' && matches!(b[2], b'\\' | b'/'))
            || path.starts_with(r"\\")
    } else {
        path.starts_with('/')
    };
    absolute && !path.split(['/', '\\']).any(|seg| seg == "..")
}

pub fn require(ok: bool, field: &str) -> Result<()> {
    if ok {
        Ok(())
    } else {
        Err(AppError::internal(format!("invalid ssh field: {field}")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_injection_shapes() {
        assert!(alias_ok("hk-edge") && alias_ok("sg_db.2"));
        for bad in [
            "",
            "-oProxyCommand=x",
            "a b",
            "a\nHost *",
            "*",
            "a?",
            "!a",
            ".hidden",
            &"x".repeat(65),
        ] {
            assert!(!alias_ok(bad), "{bad:?}");
        }
        assert!(
            host_ok("203.0.113.10") && host_ok("example.com") && host_ok("[2001:db8::1]") && host_ok("2001:db8::1")
        );
        for bad in [
            "",
            "-oProxyCommand=calc",
            "a b",
            "a\r\nProxyCommand x",
            "h%h",
            "fe80::1%eth0",
        ] {
            assert!(!host_ok(bad), "{bad:?}");
        }
        assert!(user_ok("root") && user_ok("me@corp"));
        assert!(!user_ok("-l") && !user_ok("a b") && !user_ok("a\n"));
        assert!(identity_ok(r"C:\Users\中文 名\.ssh\id_ed25519", true));
        assert!(identity_ok("/home/me/.ssh/id_ed25519", false));
        for bad in [
            r"..\id",
            r"C:\a\..\b",
            r#"C:\a"\b"#,
            r"C:\%d\k",
            r"C:\$HOME\k",
            "relative/k",
        ] {
            assert!(!identity_ok(bad, true), "{bad:?}");
        }
        assert!(!identity_ok(r"C:\Users\me\id", false));
        assert!(!identity_ok("/home/me/../root/id", false));
    }
}
