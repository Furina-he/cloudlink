//! 路径解析。设置了 `CLOUDLINK_HOME` 时，所有路径都落在它下面，**绝不回退**到真实的
//! `HOME` / `USERPROFILE` / `APPDATA`（CLAUDE.md 第 2 条、CC-SWITCH 四.1）：
//! - 数据目录 = `$CLOUDLINK_HOME`
//! - Windows 用户家目录 = `$CLOUDLINK_USER_HOME`，没设时为 `$CLOUDLINK_HOME/home`
//! - WSL 发行版的文件系统 = `$CLOUDLINK_WSL_ROOT/<发行版>`，没设时为 `$CLOUDLINK_HOME/wsl/<发行版>`
//!
//! 没有设置 `CLOUDLINK_HOME` 时，才使用真实家目录下的 `~/.cloudlink`。

use std::ffi::OsString;
use std::path::{Path, PathBuf};

use crate::error::{AppError, Result};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Paths {
    /// `~/.cloudlink`
    pub data_dir: PathBuf,
    /// Windows 用户家目录（`~/.ssh`、`~/.claude` 所在）
    pub user_home: PathBuf,
    /// 访问 WSL 文件系统的根：真实环境为 `\\wsl.localhost`，隔离时为临时目录
    pub wsl_root: PathBuf,
    /// 隔离模式：不读真实家目录，也不调用会改动系统状态的外部程序
    pub isolated: bool,
}

/// 从一组环境变量解析路径。抽成纯函数，测试时传入假的变量表
pub fn resolve(get: impl Fn(&str) -> Option<OsString>, real_home: impl FnOnce() -> Option<PathBuf>) -> Result<Paths> {
    let non_empty = |k: &str| get(k).filter(|v| !v.is_empty()).map(PathBuf::from);
    if let Some(override_dir) = get("CLOUDLINK_HOME") {
        if override_dir.is_empty() {
            return Err(AppError::internal("CLOUDLINK_HOME must not be empty"));
        }
        let data_dir = PathBuf::from(override_dir);
        let user_home = non_empty("CLOUDLINK_USER_HOME").unwrap_or_else(|| data_dir.join("home"));
        let wsl_root = non_empty("CLOUDLINK_WSL_ROOT").unwrap_or_else(|| data_dir.join("wsl"));
        return Ok(Paths {
            data_dir,
            user_home,
            wsl_root,
            isolated: true,
        });
    }
    let home = real_home().ok_or_else(|| AppError::internal("home directory not found"))?;
    Ok(Paths {
        data_dir: home.join(".cloudlink"),
        user_home: home,
        wsl_root: PathBuf::from(r"\\wsl.localhost"),
        isolated: false,
    })
}

impl Paths {
    pub fn from_env() -> Result<Self> {
        resolve(|k| std::env::var_os(k), dirs::home_dir)
    }

    /// 测试用：全部落在一个临时目录里
    pub fn isolated_in(root: &Path) -> Self {
        Paths {
            data_dir: root.join("data"),
            user_home: root.join("home"),
            wsl_root: root.join("wsl"),
            isolated: true,
        }
    }

    pub fn db_file(&self) -> PathBuf {
        self.data_dir.join("data.db")
    }
    pub fn compiled_dir(&self) -> PathBuf {
        self.data_dir.join("compiled")
    }
    pub fn inbox_dir(&self) -> PathBuf {
        self.data_dir.join("inbox")
    }
    pub fn log_dir(&self) -> PathBuf {
        self.data_dir.join("logs")
    }
    pub fn tmp_dir(&self) -> PathBuf {
        self.data_dir.join("tmp")
    }
    /// 某个 WSL 发行版的 `/` 在 Windows 侧的位置
    pub fn wsl_distro_root(&self, distro: &str) -> PathBuf {
        self.wsl_root.join(distro)
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::*;

    fn vars(pairs: &[(&str, &str)]) -> impl Fn(&str) -> Option<OsString> {
        let map: HashMap<String, OsString> = pairs.iter().map(|(k, v)| (k.to_string(), OsString::from(v))).collect();
        move |k| map.get(k).cloned()
    }

    #[test]
    fn cloudlink_home_never_falls_back_to_real_home() {
        let a = tempfile::tempdir().unwrap();
        let b = tempfile::tempdir().unwrap();
        let a_str = a.path().to_str().unwrap();
        let p = resolve(vars(&[("CLOUDLINK_HOME", a_str)]), || {
            panic!("must not read the real home")
        })
        .unwrap();
        assert!(p.isolated);
        assert_eq!(p.data_dir, a.path());
        assert_eq!(p.user_home, a.path().join("home"));
        assert_eq!(p.wsl_root, a.path().join("wsl"));

        let b_str = b.path().to_str().unwrap();
        let p = resolve(
            vars(&[
                ("CLOUDLINK_HOME", a_str),
                ("CLOUDLINK_USER_HOME", b_str),
                ("CLOUDLINK_WSL_ROOT", b_str),
            ]),
            || panic!("must not read the real home"),
        )
        .unwrap();
        assert_eq!(p.user_home, b.path());
        assert_eq!(p.wsl_distro_root("Ubuntu"), b.path().join("Ubuntu"));
        for path in [&p.data_dir, &p.user_home, &p.wsl_root] {
            assert!(path.starts_with(a.path()) || path.starts_with(b.path()));
        }
    }

    #[test]
    fn empty_cloudlink_home_never_falls_back_to_real_home() {
        let mut read_real_home = false;
        let result = resolve(vars(&[("CLOUDLINK_HOME", "")]), || {
            read_real_home = true;
            Some(PathBuf::from("/fake/home"))
        });
        assert!(
            !read_real_home,
            "an invalid isolation override must never enable real paths"
        );
        assert!(result.is_err());
    }
}
