//! Single-file SFTP only. The final local name is published with an exclusive
//! hard-link creation; remote upload has a documented stat/write race.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::Duration;

use guard_rules::{routes, runtime};
use serde_json::{Value, json};

use super::{Error, Result, process};

const MAX_FILE: u64 = 1024 * 1024 * 1024;

pub(super) fn quote(path: &str) -> Result<String> {
    quoted(path, false)
}

fn quoted(path: &str, escape_braces: bool) -> Result<String> {
    if path.is_empty()
        || path.len() > 4096
        || path.starts_with('-')
        || path.chars().any(char::is_control)
        || path.split('/').any(|part| part == "..")
    {
        return Err(Error::new("execution-path-invalid"));
    }
    let mut text = String::from("\"");
    for c in path.chars() {
        match c {
            // Win32 replaces every input backslash before makeargv. Adjacent
            // quoted segments preserve a quote without introducing a backslash.
            '"' => text.push_str("\"'\"'\""),
            '\\' => text.push_str("\\\\"),
            '{' | '}' if escape_braces => {
                text.push('\\');
                text.push(c);
            }
            _ => text.push(c),
        }
    }
    text.push('"');
    Ok(text)
}

fn glob_quote(path: &str, win32_sftp: bool) -> Result<String> {
    // makeargv already escapes quoted *, ? and [. Only ls enables GLOB_BRACE.
    // Win32's pre-parser slash conversion prevents escaping braces/backslashes;
    // reject those remote paths before uploading instead of creating an
    // inaccessible file or accidentally checking another expanded destination.
    if win32_sftp && path.contains(['\\', '{', '}']) {
        return Err(Error::new("execution-path-invalid"));
    }
    quoted(path, !win32_sftp)
}

struct Temporary {
    directory: PathBuf,
    token: String,
}
impl Temporary {
    fn new(parent: &Path) -> Result<Self> {
        if !runtime::safe_path(parent) || !parent.is_dir() {
            return Err(Error::new("execution-path-invalid"));
        }
        let token = runtime::nonce().map_err(Error::from)?;
        let directory = parent.join(format!(".cloudlink-transfer-{token}"));
        fs::create_dir(&directory).map_err(|_| Error::new("execution-transfer-unavailable"))?;
        runtime::protect(&directory).map_err(Error::from)?;
        let value = json!({"managedBy":"cloudlink","kind":"execution-transfer","token":token});
        let mut marker = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(directory.join(".cloudlink.json"))
            .map_err(Error::from)?;
        marker
            .write_all(&serde_json::to_vec(&value).map_err(|_| Error::new("execution-transfer-unavailable"))?)
            .map_err(Error::from)?;
        marker.sync_all().map_err(Error::from)?;
        Ok(Self { directory, token })
    }
    fn file(&self) -> PathBuf {
        self.directory.join("data")
    }
}
impl Drop for Temporary {
    fn drop(&mut self) {
        if !runtime::safe_path(&self.directory) {
            return;
        }
        let marker = runtime::read_owned_json(
            &self.directory.join(".cloudlink.json"),
            "execution-transfer",
            runtime::MAX_RUNTIME,
        );
        if !marker.is_ok_and(|value| value["token"] == self.token) {
            return;
        }
        let Ok(entries) = fs::read_dir(&self.directory) else {
            return;
        };
        let entries: Vec<_> = entries
            .filter_map(std::result::Result::ok)
            .map(|entry| entry.path())
            .collect();
        if entries.iter().any(|path| {
            !runtime::safe_path(path)
                || path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .is_none_or(|name| !["data", ".cloudlink.json"].contains(&name))
                || !fs::symlink_metadata(path).is_ok_and(|metadata| metadata.is_file() && !runtime::is_link(&metadata))
        }) {
            return;
        }
        for entry in entries {
            if fs::remove_file(entry).is_err() {
                return;
            }
        }
        let _ = fs::remove_dir(&self.directory);
    }
}

pub(super) fn input_digest(manifest: &Value, route: &Value, input: &Value) -> Result<String> {
    let path = input["args"]
        .get(0)
        .and_then(Value::as_str)
        .ok_or_else(|| Error::new("execution-input-invalid"))?;
    let path = routes::local_path(route, path).map_err(Error::from)?;
    if !routes::path_allowed(manifest, &path) {
        return Err(Error::new("execution-path-invalid"));
    }
    runtime::file_digest(&path, MAX_FILE).map_err(|_| Error::new("execution-input-changed"))
}

pub(super) fn run(
    manifest: &Value,
    route: &Value,
    input: &Value,
    timeout: Duration,
    before: &mut dyn FnMut() -> Result<()>,
    started: &mut dyn FnMut() -> Result<()>,
) -> Result<process::Finished> {
    let args = input["args"]
        .as_array()
        .filter(|args| args.len() == 2)
        .ok_or_else(|| Error::new("execution-input-invalid"))?;
    let upload = input["kind"] == "put";
    let (local, remote) = if upload {
        (&args[0], &args[1])
    } else {
        (&args[1], &args[0])
    };
    let remote = remote.as_str().ok_or_else(|| Error::new("execution-input-invalid"))?;
    let win32_sftp = cfg!(windows) && route["envId"] == "windows";
    let remote_pattern = glob_quote(remote, win32_sftp)?;
    let remote = quote(remote)?;
    let local = routes::local_path(
        route,
        local.as_str().ok_or_else(|| Error::new("execution-input-invalid"))?,
    )
    .map_err(Error::from)?;
    if !routes::path_allowed(manifest, &local) {
        return Err(Error::new("execution-path-invalid"));
    }
    let parent = local
        .parent()
        .filter(|parent| parent.is_dir())
        .ok_or_else(|| Error::new("execution-path-invalid"))?;
    if !upload && local.try_exists().map_err(Error::from)? {
        return Err(Error::new("execution-destination-exists"));
    }
    let temporary = Temporary::new(parent)?;
    let stage = temporary.file();
    let mut placeholder = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&stage)
        .map_err(Error::from)?;
    runtime::protect(&stage).map_err(Error::from)?;
    if upload {
        let expected = input["inputDigest"]
            .as_str()
            .ok_or_else(|| Error::new("execution-input-changed"))?;
        if input_digest(manifest, route, input)? != expected {
            return Err(Error::new("execution-input-changed"));
        }
        let source = fs::File::open(&local).map_err(Error::from)?;
        use std::io::Read;
        let copied = std::io::copy(&mut source.take(MAX_FILE + 1), &mut placeholder).map_err(Error::from)?;
        if copied > MAX_FILE {
            return Err(Error::new("execution-input-changed"));
        }
        placeholder.sync_all().map_err(Error::from)?;
        drop(placeholder);
        if runtime::file_digest(&stage, MAX_FILE).map_err(Error::from)? != expected
            || input_digest(manifest, route, input)? != expected
        {
            return Err(Error::new("execution-input-changed"));
        }
        let spec = process::spec(manifest, route, input, None, true)?;
        let stat = process::capture(&spec, format!("ls -l {remote_pattern}\nquit\n").as_bytes())?;
        if stat.state == "succeeded" {
            return Err(Error::new("execution-destination-exists"));
        }
        let diagnostic = String::from_utf8_lossy(&stat.stderr).to_ascii_lowercase();
        if stat.state == "unknown"
            || !(diagnostic.contains("no such file")
                || diagnostic.contains("can't ls:") && diagnostic.contains("not found"))
        {
            return Err(Error::new("execution-transfer-unavailable"));
        }
        // SFTP has no exclusive upload primitive: the remote name may be created
        // between this check and put. Do not claim an atomic remote publication.
        let _ = std::io::stderr()
            .lock()
            .write_all(b"{\"source\":\"cloudlink\",\"reasonId\":\"sftp-create-race\"}\n");
        let path = quote(&process::for_program(route, &stage)?)?;
        process::stream(
            &spec,
            format!("put {path} {remote}\nquit\n").as_bytes(),
            timeout,
            before,
            started,
        )
    } else {
        drop(placeholder);
        let spec = process::spec(manifest, route, input, None, true)?;
        let path = quote(&process::for_program(route, &stage)?)?;
        let result = process::stream(
            &spec,
            format!("get {remote_pattern} {path}\nquit\n").as_bytes(),
            timeout,
            before,
            started,
        )?;
        if result.state == "succeeded" {
            if !runtime::safe_path(&stage)
                || !routes::path_allowed(manifest, &local)
                || local.try_exists().map_err(Error::from)?
            {
                return Err(Error::new("execution-destination-exists"));
            }
            // hard_link cannot overwrite an existing destination. Staging is
            // adjacent, so no cross-device rename or overwrite fallback exists.
            fs::hard_link(&stage, &local).map_err(|error| {
                Error::new(if error.kind() == std::io::ErrorKind::AlreadyExists {
                    "execution-destination-exists"
                } else {
                    "execution-transfer-unavailable"
                })
            })?;
        }
        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn sftp_batch_paths_are_literal_and_cannot_inject_a_second_command() {
        assert_eq!(quote("/tmp/a space *?[x] {a,b}").unwrap(), r#""/tmp/a space *?[x] {a,b}""#);
        assert_eq!(quote(r#"a"b'c"#).unwrap(), r#""a"'"'"b'c""#);
        assert_eq!(
            glob_quote("/tmp/a space *?[x] {a,b}", false).unwrap(),
            r#""/tmp/a space *?[x] \{a,b\}""#
        );
        assert_eq!(
            glob_quote("C:/home [test]/.cloudlink-transfer-id/data", true).unwrap(),
            r#""C:/home [test]/.cloudlink-transfer-id/data""#
        );
        for path in ["", "/tmp/a\nrm /tmp/b", "-f", "/tmp/../x", "\r", "\0"] {
            assert!(quote(path).is_err());
            assert!(glob_quote(path, false).is_err());
            assert!(glob_quote(path, true).is_err());
        }
        for path in ["/tmp/{a,b}.txt", "/tmp/open{", "/tmp/close}", r"/tmp/back\slash"] {
            assert!(glob_quote(path, true).is_err());
            assert!(glob_quote(path, false).is_ok());
        }
    }
    #[test]
    fn temporary_cleanup_is_owned_and_never_deletes_a_foreign_entry() {
        let parent = std::env::temp_dir().join(format!("cloudlink-transfer-test-{}", runtime::nonce().unwrap()));
        fs::create_dir(&parent).unwrap();
        fs::write(
            parent.join(".cloudlink.json"),
            b"{\"managedBy\":\"cloudlink\",\"kind\":\"execution-transfer-test\"}",
        )
        .unwrap();
        let temp = Temporary::new(&parent).unwrap();
        let directory = temp.directory.clone();
        fs::write(directory.join("foreign.txt"), b"keep").unwrap();
        drop(temp);
        assert_eq!(fs::read(directory.join("foreign.txt")).unwrap(), b"keep");
        assert!(runtime::safe_path(&directory));
        runtime::read_owned_json(
            &parent.join(".cloudlink.json"),
            "execution-transfer-test",
            runtime::MAX_RUNTIME,
        )
        .unwrap();
        fs::remove_file(directory.join("foreign.txt")).unwrap();
        fs::remove_file(directory.join(".cloudlink.json")).unwrap();
        fs::remove_dir(directory).unwrap();
        fs::remove_file(parent.join(".cloudlink.json")).unwrap();
        fs::remove_dir(parent).unwrap();
    }
}
