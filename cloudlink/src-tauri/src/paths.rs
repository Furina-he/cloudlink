//! 路径解析。设置了 `CLOUDLINK_HOME` 时，所有路径都落在它下面，**绝不回退**到真实的
//! `HOME` / `USERPROFILE` / `APPDATA`（CLAUDE.md 第 2 条、CC-SWITCH 四.1）：
//! - 数据目录 = `$CLOUDLINK_HOME`
//! - Windows 用户家目录 = `$CLOUDLINK_USER_HOME`，没设时为 `$CLOUDLINK_HOME/home`
//! - WSL 发行版的文件系统 = `$CLOUDLINK_WSL_ROOT/<发行版>`，没设时为 `$CLOUDLINK_HOME/wsl/<发行版>`
//!
//! 没有设置 `CLOUDLINK_HOME` 时，才使用真实家目录下的 `~/.cloudlink`。
//!
//! 更新实测的测试构建（`scripts/build-update-test.mjs`）在编译时写入 `CLOUDLINK_TEST_BUILD_HOME`，作为
//! `CLOUDLINK_HOME` 的默认值：安装程序经资源管理器重新打开应用，测试进程的环境变量传不过去，否则
//! 新版本一启动就落到真实家目录。正式构建不设这个变量，`option_env!` 在编译时就是 `None`。

use std::ffi::OsString;
use std::path::{Component, Path, PathBuf};

use crate::error::{AppError, Result};

const TEST_BUILD_HOME: Option<&str> = option_env!("CLOUDLINK_TEST_BUILD_HOME");

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
    let user_override = get("CLOUDLINK_USER_HOME");
    let wsl_override = get("CLOUDLINK_WSL_ROOT");
    if let Some(override_dir) = get("CLOUDLINK_HOME") {
        let data_dir = override_path("CLOUDLINK_HOME", override_dir)?;
        let user_home = user_override
            .map(|p| override_path("CLOUDLINK_USER_HOME", p))
            .transpose()?
            .unwrap_or_else(|| data_dir.join("home"));
        let wsl_root = wsl_override
            .map(|p| override_path("CLOUDLINK_WSL_ROOT", p))
            .transpose()?
            .unwrap_or_else(|| data_dir.join("wsl"));
        return Ok(Paths {
            data_dir,
            user_home,
            wsl_root,
            isolated: true,
        });
    }
    if user_override.is_some() || wsl_override.is_some() {
        return Err(AppError::internal("path overrides require CLOUDLINK_HOME"));
    }
    let home = real_home().ok_or_else(|| AppError::internal("home directory not found"))?;
    Ok(Paths {
        data_dir: home.join(".cloudlink"),
        user_home: home,
        wsl_root: PathBuf::from(r"\\wsl.localhost"),
        isolated: false,
    })
}

/// 环境变量优先；只有 `CLOUDLINK_HOME` 有编译进来的默认值
fn with_build_home<'a>(
    get: impl Fn(&str) -> Option<OsString> + 'a,
    build_home: Option<&'a str>,
) -> impl Fn(&str) -> Option<OsString> + 'a {
    move |key| {
        get(key).or_else(|| {
            if key == "CLOUDLINK_HOME" {
                build_home.map(OsString::from)
            } else {
                None
            }
        })
    }
}

fn override_path(name: &str, value: OsString) -> Result<PathBuf> {
    let path = PathBuf::from(value);
    if !path.is_absolute() || path.components().any(|part| part == Component::ParentDir) {
        return Err(AppError::internal(format!(
            "{name} must be an absolute path without parent segments"
        )));
    }
    Ok(path)
}

/// Check from the filesystem root down, so even inspecting a child never follows a linked ancestor.
pub(crate) fn validate_directory(path: &Path) -> Result<()> {
    if !path.is_absolute() || path.components().any(|part| part == Component::ParentDir) {
        return Err(AppError::internal("application directories must use absolute paths"));
    }
    for ancestor in path.ancestors().collect::<Vec<_>>().into_iter().rev() {
        match std::fs::symlink_metadata(ancestor) {
            Ok(meta) if crate::fsx::is_link(&meta) || !meta.is_dir() => {
                return Err(AppError::internal("application directory is not a plain directory"));
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => break,
            Err(error) => return Err(error.into()),
        }
    }
    Ok(())
}

/// Plugin-owned storage may contain arbitrary nested files, but never links or special files.
/// Inspect metadata only; do not read contents or descend until each directory is checked.
pub(crate) fn validate_directory_tree(root: &Path) -> Result<()> {
    validate_directory(root)?;
    let mut pending = vec![root.to_path_buf()];
    while let Some(path) = pending.pop() {
        let meta = match std::fs::symlink_metadata(&path) {
            Ok(meta) => meta,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound && path.as_path() == root => return Ok(()),
            Err(error) => return Err(error.into()),
        };
        if crate::fsx::is_link(&meta) || (!meta.is_dir() && !meta.is_file()) {
            return Err(AppError::internal(
                "application storage contains a linked or special entry",
            ));
        }
        if meta.is_dir() {
            for entry in std::fs::read_dir(path)? {
                pending.push(entry?.path());
            }
        }
    }
    Ok(())
}

pub(crate) fn validate_file(path: &Path) -> Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| AppError::internal("application file must have a directory"))?;
    validate_directory(parent)?;
    match std::fs::symlink_metadata(path) {
        Ok(meta) if meta.is_file() && !crate::fsx::is_link(&meta) => Ok(()),
        Ok(_) => Err(AppError::internal("application file is not a plain file")),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
    }
}

impl Paths {
    pub fn from_env() -> Result<Self> {
        resolve(
            with_build_home(|k| std::env::var_os(k), TEST_BUILD_HOME),
            dirs::home_dir,
        )
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

    /// Run before Tauri initializes plugins or creates the WebView, not only when the backend opens.
    pub fn validate_startup(&self) -> Result<()> {
        for directory in [&self.data_dir, &self.user_home] {
            validate_directory(directory)?;
        }
        // The log plugin opens existing files directly, including during startup.
        validate_directory_tree(&self.log_dir())?;
        if self.isolated {
            validate_directory(&self.wsl_root)?;
        }
        Ok(())
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
    fn a_compiled_test_home_isolates_a_launch_without_any_environment() {
        let built = tempfile::tempdir().unwrap();
        let built_str = built.path().to_str().unwrap();
        let p = resolve(with_build_home(vars(&[]), Some(built_str)), || {
            panic!("must not read the real home")
        })
        .unwrap();
        assert!(p.isolated);
        assert_eq!(p.data_dir, built.path());
        assert_eq!(p.user_home, built.path().join("home"));
        assert_eq!(p.wsl_root, built.path().join("wsl"));

        // 环境变量仍然优先
        let env = tempfile::tempdir().unwrap();
        let env_str = env.path().to_str().unwrap();
        let p = resolve(
            with_build_home(vars(&[("CLOUDLINK_HOME", env_str)]), Some(built_str)),
            || panic!("must not read the real home"),
        )
        .unwrap();
        assert_eq!(p.data_dir, env.path());

        // 只有 CLOUDLINK_HOME 有默认值；正式构建没有编译进来的目录，走真实家目录
        let get = with_build_home(vars(&[]), Some(built_str));
        assert_eq!(get("CLOUDLINK_USER_HOME"), None);
        let home = tempfile::tempdir().unwrap();
        let p = resolve(with_build_home(vars(&[]), None), || Some(home.path().to_path_buf())).unwrap();
        assert!(!p.isolated);
        assert_eq!(p.data_dir, home.path().join(".cloudlink"));
    }

    #[test]
    fn ordinary_builds_have_no_compiled_test_home() {
        assert_eq!(TEST_BUILD_HOME, None);
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

    #[test]
    fn invalid_or_incomplete_overrides_never_read_real_home() {
        let isolated = tempfile::tempdir().unwrap();
        let unused_home = tempfile::tempdir().unwrap();
        let root = isolated.path().to_str().unwrap();
        let real = unused_home.path().to_str().unwrap();
        for pairs in [
            vec![("CLOUDLINK_HOME", "relative")],
            vec![("CLOUDLINK_HOME", "../outside")],
            vec![("CLOUDLINK_USER_HOME", real)],
            vec![("CLOUDLINK_WSL_ROOT", real)],
            vec![("CLOUDLINK_USER_HOME", "")],
            vec![("CLOUDLINK_WSL_ROOT", "")],
            vec![("CLOUDLINK_HOME", root), ("CLOUDLINK_USER_HOME", "")],
            vec![("CLOUDLINK_HOME", root), ("CLOUDLINK_WSL_ROOT", "")],
            vec![("CLOUDLINK_HOME", root), ("CLOUDLINK_USER_HOME", "relative")],
            vec![("CLOUDLINK_HOME", root), ("CLOUDLINK_WSL_ROOT", "relative")],
        ] {
            assert!(
                resolve(vars(&pairs), || panic!("must not read the real home")).is_err(),
                "invalid path overrides were accepted: {pairs:?}"
            );
        }
        assert_eq!(std::fs::read_dir(unused_home.path()).unwrap().count(), 0);
    }

    #[test]
    fn override_parent_segments_are_rejected_before_directory_access() {
        let isolated = tempfile::tempdir().unwrap();
        let path = isolated.path().join("missing").join("..").join("data");
        assert!(
            resolve(vars(&[("CLOUDLINK_HOME", path.to_str().unwrap())]), || {
                panic!("must not read the real home")
            })
            .is_err()
        );
        assert!(!isolated.path().join("missing").exists());
    }

    #[test]
    fn startup_validation_rejects_a_file_in_directory_ancestors() {
        let isolated = tempfile::tempdir().unwrap();
        let blocked = isolated.path().join("file");
        std::fs::write(&blocked, b"keep").unwrap();
        let paths = Paths::isolated_in(&blocked.join("child"));
        assert!(paths.validate_startup().is_err());
        assert_eq!(std::fs::read(blocked).unwrap(), b"keep");
    }

    #[cfg(windows)]
    #[test]
    fn startup_validation_rejects_junction_ancestors_before_writing() {
        use std::os::windows::process::CommandExt;

        let isolated = tempfile::tempdir().unwrap();
        let target = isolated.path().join("outside");
        std::fs::create_dir(&target).unwrap();
        let link = isolated.path().join("linked");
        match std::os::windows::fs::symlink_dir(&target, &link) {
            Ok(()) => {}
            Err(error) if error.raw_os_error() == Some(1314) => {
                let result = crate::proc::command("cmd.exe")
                    .args(["/D", "/V:OFF", "/C"])
                    .raw_arg(r#"mklink /J "%CLOUDLINK_TEST_LINK%" "%CLOUDLINK_TEST_TARGET%""#)
                    .env("CLOUDLINK_TEST_LINK", &link)
                    .env("CLOUDLINK_TEST_TARGET", &target)
                    .output()
                    .unwrap();
                assert!(result.status.success());
            }
            Err(error) => panic!("cannot create directory link: {error}"),
        }
        let paths = Paths::isolated_in(&link.join("not-created"));
        assert!(paths.validate_startup().is_err());
        assert_eq!(std::fs::read_dir(&target).unwrap().count(), 0);
        assert!(crate::fsx::path_is_link(&link));
        std::fs::remove_dir(link).unwrap();
    }
}
