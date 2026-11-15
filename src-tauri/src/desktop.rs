//! Native desktop storage must follow path isolation before plugins and WebView2 start.

use std::fs::{self, OpenOptions};
use std::io::Write;

use tauri::utils::config::{AppDirectoriesOverride, AppDirectoryOverrides, Config};

use crate::error::{AppError, Result};
use crate::model::misc::IpcErrorId;
use crate::paths::{Paths, validate_directory, validate_directory_tree, validate_file};

pub(crate) fn configure(config: &mut Config, paths: &Paths) -> Result<()> {
    paths.validate_startup()?;
    // Match the log plugin's default file name (the Tauri package name).
    let log_file = paths
        .log_dir()
        .join(config.product_name.as_deref().unwrap_or(env!("CARGO_PKG_NAME")))
        .with_extension("log");
    validate_file(&log_file)?;
    if paths.isolated {
        let root = paths.data_dir.join("desktop");
        let webview = root.join("webview");
        let cache = root.join("cache");
        validate_directory_tree(&root)?;
        for directory in [&webview, &cache] {
            validate_directory(directory)?;
        }
        validate_file(&root.join(tauri_plugin_window_state::DEFAULT_FILENAME))?;
        config.app.app_directories_override = Some(AppDirectoriesOverride::Directories(AppDirectoryOverrides {
            config: Some(root.clone()),
            data: Some(root),
            local_data: Some(webview.clone()),
            cache: Some(cache),
            log: Some(paths.log_dir()),
        }));
        // An explicit window dataDirectory takes precedence over appDirectoriesOverride.
        for window in &mut config.app.windows {
            window.data_directory = Some(webview.clone());
        }
    }
    // The log plugin starts before Backend::open. Verify/claim the data root before it can write.
    ensure_data_owner(paths)
}

fn ensure_data_owner(paths: &Paths) -> Result<()> {
    let marker_path = paths.data_dir.join(".cloudlink.json");
    match fs::symlink_metadata(&marker_path) {
        Ok(meta) if meta.is_file() && !crate::fsx::is_link(&meta) => {
            let marker: serde_json::Value = serde_json::from_slice(&fs::read(marker_path)?)?;
            if marker.get("managedBy").and_then(serde_json::Value::as_str) != Some("cloudlink")
                || marker.get("kind").and_then(serde_json::Value::as_str) != Some("data")
            {
                return Err(AppError::ipc(IpcErrorId::SettingsInvalid));
            }
        }
        Ok(_) => return Err(AppError::ipc(IpcErrorId::SettingsInvalid)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            fs::create_dir_all(&paths.data_dir)?;
            let mut marker = OpenOptions::new().write(true).create_new(true).open(marker_path)?;
            marker.write_all(b"{\"managedBy\":\"cloudlink\",\"kind\":\"data\"}\n")?;
            marker.sync_all()?;
        }
        Err(error) => return Err(error.into()),
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use tauri::utils::config::WindowConfig;

    use super::*;

    #[test]
    fn native_storage_cannot_keep_real_or_partial_overrides_in_isolated_mode() {
        let isolated = tempfile::tempdir().unwrap();
        let unused_home = tempfile::tempdir().unwrap();
        let paths = crate::paths::resolve(
            |name| (name == "CLOUDLINK_HOME").then(|| isolated.path().as_os_str().to_os_string()),
            || panic!("native startup must not read the real home"),
        )
        .unwrap();
        let mut config = Config::default();
        config.app.app_directories_override = Some(AppDirectoriesOverride::Root(unused_home.path().into()));
        config.app.windows.push(WindowConfig {
            data_directory: Some(unused_home.path().join("old-webview")),
            ..Default::default()
        });

        configure(&mut config, &paths).unwrap();
        let Some(AppDirectoriesOverride::Directories(dirs)) = config.app.app_directories_override else {
            panic!("every app directory must be overridden")
        };
        for directory in [&dirs.config, &dirs.data, &dirs.local_data, &dirs.cache, &dirs.log] {
            assert!(directory.as_ref().unwrap().starts_with(isolated.path()));
        }
        assert_eq!(dirs.log, Some(paths.log_dir()));
        assert_eq!(config.app.windows[0].data_directory, dirs.local_data);
        assert_eq!(fs::read_dir(unused_home.path()).unwrap().count(), 0);
    }

    #[test]
    fn production_keeps_native_window_and_plugin_directories() {
        let home = tempfile::tempdir().unwrap();
        let paths = crate::paths::resolve(|_| None, || Some(home.path().into())).unwrap();
        fs::create_dir_all(&paths.data_dir).unwrap();
        // Production does not use this isolated plugin root, even if a file occupies its name.
        let unused = paths.data_dir.join("desktop");
        fs::write(&unused, b"unrelated production file").unwrap();
        let mut config = Config::default();
        config.app.windows.push(WindowConfig::default());
        let original = config.clone();
        configure(&mut config, &paths).unwrap();
        assert_eq!(config, original);
        assert!(paths.data_dir.join(".cloudlink.json").is_file());
        assert_eq!(fs::read(unused).unwrap(), b"unrelated production file");
    }

    #[test]
    fn foreign_data_owner_stops_startup_before_log_or_webview_creation() {
        let root = tempfile::tempdir().unwrap();
        let paths = Paths::isolated_in(root.path());
        fs::create_dir_all(&paths.data_dir).unwrap();
        let marker = paths.data_dir.join(".cloudlink.json");
        let content = b"{\"managedBy\":\"another-app\",\"kind\":\"data\"}";
        fs::write(&marker, content).unwrap();
        assert!(configure(&mut Config::default(), &paths).is_err());
        assert_eq!(fs::read(marker).unwrap(), content);
        assert!(!paths.log_dir().exists());
        assert!(!paths.data_dir.join("desktop").exists());
    }

    fn desktop_config() -> Config {
        Config {
            product_name: Some("CloudLink".into()),
            ..Default::default()
        }
    }

    #[test]
    fn existing_plain_plugin_storage_is_preserved() {
        let root = tempfile::tempdir().unwrap();
        let paths = Paths::isolated_in(root.path());
        let entries = [
            "logs/CloudLink.log",
            "desktop/.window-state.json",
            "desktop/webview/Default/Preferences",
            "desktop/cache/entry",
        ];
        for entry in entries {
            let path = paths.data_dir.join(entry);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, b"{}\n").unwrap();
        }
        configure(&mut desktop_config(), &paths).unwrap();
        for entry in entries {
            assert_eq!(fs::read(paths.data_dir.join(entry)).unwrap(), b"{}\n");
        }
    }

    #[test]
    fn plugin_file_and_directory_conflicts_stop_startup_before_claiming_data() {
        for (entry, needs_directory) in [
            ("logs", true),
            ("desktop", true),
            ("desktop/webview", true),
            ("desktop/cache", true),
            ("logs/CloudLink.log", false),
            ("desktop/.window-state.json", false),
        ] {
            let root = tempfile::tempdir().unwrap();
            let paths = if entry.starts_with("logs") {
                // Log storage is checked in production mode as well as isolation.
                crate::paths::resolve(|_| None, || Some(root.path().into())).unwrap()
            } else {
                Paths::isolated_in(root.path())
            };
            let conflict = paths.data_dir.join(entry);
            fs::create_dir_all(conflict.parent().unwrap()).unwrap();
            let preserved = if needs_directory {
                conflict.clone()
            } else {
                fs::create_dir(&conflict).unwrap();
                conflict.join("keep")
            };
            fs::write(&preserved, b"preserve conflict").unwrap();
            assert!(configure(&mut desktop_config(), &paths).is_err(), "accepted {entry}");
            assert_eq!(fs::read(preserved).unwrap(), b"preserve conflict");
            assert!(!paths.data_dir.join(".cloudlink.json").exists());
        }
    }

    #[cfg(any(windows, unix))]
    fn link_directory(link: &std::path::Path, target: &std::path::Path) {
        #[cfg(windows)]
        use std::os::windows::process::CommandExt;

        assert!(link.is_absolute() && target.is_absolute());
        #[cfg(unix)]
        std::os::unix::fs::symlink(target, link).unwrap();
        #[cfg(windows)]
        match std::os::windows::fs::symlink_dir(target, link) {
            Ok(()) => {}
            Err(error) if error.raw_os_error() == Some(1314) => {
                let result = crate::proc::command("cmd.exe")
                    .args(["/D", "/V:OFF", "/C"])
                    .raw_arg(r#"mklink /J "%CLOUDLINK_TEST_LINK%" "%CLOUDLINK_TEST_TARGET%""#)
                    .env("CLOUDLINK_TEST_LINK", link)
                    .env("CLOUDLINK_TEST_TARGET", target)
                    .output()
                    .unwrap();
                assert!(result.status.success(), "{}", String::from_utf8_lossy(&result.stderr));
            }
            Err(error) => panic!("cannot create directory link: {error}"),
        }
    }

    #[cfg(any(windows, unix))]
    #[test]
    fn linked_plugin_storage_entries_are_rejected_without_touching_external_files() {
        for entry in [
            "logs/CloudLink.log",
            "logs/rotated",
            "desktop/.window-state.json",
            "desktop/cache/nested",
            "desktop/webview/Default/Network",
        ] {
            let root = tempfile::tempdir().unwrap();
            let outside = tempfile::tempdir().unwrap();
            let paths = Paths::isolated_in(root.path());
            let sentinel = outside.path().join("keep");
            fs::write(&sentinel, b"external content").unwrap();
            let link = paths.data_dir.join(entry);
            fs::create_dir_all(link.parent().unwrap()).unwrap();
            link_directory(&link, outside.path());

            assert!(configure(&mut desktop_config(), &paths).is_err(), "accepted {entry}");
            assert_eq!(fs::read(sentinel).unwrap(), b"external content");
            assert_eq!(fs::read_dir(outside.path()).unwrap().count(), 1);
            assert!(!paths.data_dir.join(".cloudlink.json").exists());
            assert!(crate::fsx::path_is_link(&link));
            #[cfg(windows)]
            fs::remove_dir(link).unwrap();
            #[cfg(unix)]
            fs::remove_file(link).unwrap();
        }
    }

    #[cfg(any(windows, unix))]
    #[test]
    fn existing_and_dangling_plugin_file_symlinks_are_rejected_before_any_write() {
        for entry in [
            "logs/CloudLink.log",
            "desktop/.window-state.json",
            "desktop/webview/Default/Preferences",
        ] {
            for exists in [true, false] {
                let root = tempfile::tempdir().unwrap();
                let outside = tempfile::tempdir().unwrap();
                let paths = Paths::isolated_in(root.path());
                let destination = outside.path().join("external-file");
                if exists {
                    fs::write(&destination, b"external content").unwrap();
                }
                let link = paths.data_dir.join(entry);
                fs::create_dir_all(link.parent().unwrap()).unwrap();
                #[cfg(unix)]
                std::os::unix::fs::symlink(&destination, &link).unwrap();
                #[cfg(windows)]
                match std::os::windows::fs::symlink_file(&destination, &link) {
                    Ok(()) => {}
                    // Junction coverage above always runs on Windows without this privilege.
                    Err(error) if error.raw_os_error() == Some(1314) => return,
                    Err(error) => panic!("cannot create file symlink: {error}"),
                }

                assert!(configure(&mut desktop_config(), &paths).is_err(), "accepted {entry}");
                if exists {
                    assert_eq!(fs::read(&destination).unwrap(), b"external content");
                }
                assert_eq!(destination.exists(), exists);
                assert_eq!(
                    fs::read_dir(outside.path()).unwrap().count(),
                    if exists { 1 } else { 0 }
                );
                assert!(!paths.data_dir.join(".cloudlink.json").exists());
                assert!(crate::fsx::path_is_link(&link));
                fs::remove_file(link).unwrap();
            }
        }
    }
}
