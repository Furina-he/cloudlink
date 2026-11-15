//! Runtime identity shared by the hook, independent runner and desktop coordinator.
//! An unreachable coordinator, damaged record or inaccessible process is never an exit.

use std::fs::{self, OpenOptions};
use std::io::{self, Read, Write};
use std::path::{Component, Path, PathBuf};

use serde_json::{Value, json};
use sha2::{Digest, Sha256};

pub const MAX_RUNTIME: u64 = 16 * 1024;
pub const MAX_MANIFEST: u64 = 4 * 1024 * 1024;

pub fn is_link(metadata: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return true;
        }
    }
    metadata.file_type().is_symlink()
}

pub fn safe_path(path: &Path) -> bool {
    if !path.is_absolute() || path.components().any(|part| part == Component::ParentDir) {
        return false;
    }
    path.ancestors()
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .all(|ancestor| match fs::symlink_metadata(ancestor) {
            Ok(metadata) => !is_link(&metadata) && (ancestor == path || metadata.is_dir()),
            Err(error) => error.kind() == io::ErrorKind::NotFound,
        })
}

pub fn bounded_file(path: &Path, limit: u64) -> io::Result<Option<Vec<u8>>> {
    if !safe_path(path) {
        return Err(invalid());
    }
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.is_file() && metadata.len() <= limit => metadata,
        Ok(_) => return Err(invalid()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error),
    };
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    fs::File::open(path)?.take(limit + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > limit {
        return Err(invalid());
    }
    Ok(Some(bytes))
}

pub fn read_owned_json(path: &Path, kind: &str, limit: u64) -> io::Result<Value> {
    let bytes = bounded_file(path, limit)?.ok_or_else(invalid)?;
    let value: Value = serde_json::from_slice(&bytes).map_err(|_| invalid())?;
    if value["managedBy"] != "cloudlink" || value["kind"] != kind {
        return Err(invalid());
    }
    Ok(value)
}

pub fn installation_id(root: &Path) -> io::Result<String> {
    if !safe_path(root) {
        return Err(invalid());
    }
    let root = fs::canonicalize(root)?;
    let text = root.to_str().ok_or_else(invalid)?.replace('\\', "/");
    #[cfg(windows)]
    let text = text.to_lowercase();
    Ok(digest(text.as_bytes()))
}

pub fn digest(bytes: &[u8]) -> String {
    Sha256::digest(bytes).iter().map(|byte| format!("{byte:02x}")).collect()
}

pub fn file_digest(path: &Path, limit: u64) -> io::Result<String> {
    if !safe_path(path) {
        return Err(invalid());
    }
    let metadata = fs::symlink_metadata(path)?;
    if !metadata.is_file() || is_link(&metadata) || metadata.len() > limit {
        return Err(invalid());
    }
    let mut file = fs::File::open(path)?;
    let mut hash = Sha256::new();
    let mut buffer = [0; 65_536];
    let mut size = 0;
    loop {
        let count = file.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        size += count as u64;
        if size > limit {
            return Err(invalid());
        }
        hash.update(&buffer[..count]);
    }
    if !safe_path(path) || file.metadata()?.len() != size {
        return Err(invalid());
    }
    Ok(hash.finalize().iter().map(|byte| format!("{byte:02x}")).collect())
}

pub fn nonce() -> io::Result<String> {
    let mut bytes = [0; 32];
    platform::random(&mut bytes)?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

/// Caller verifies the enclosing ownership marker before replacing any existing file.
/// Temporary files are exclusively created and protected before becoming visible.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> io::Result<()> {
    if !safe_path(path) {
        return Err(invalid());
    }
    let parent = path.parent().ok_or_else(invalid)?;
    let temporary = parent.join(format!(".cloudlink-write-{}", nonce()?));
    let mut file = OpenOptions::new().write(true).create_new(true).open(&temporary)?;
    let result = (|| {
        protect(&temporary)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        if !safe_path(path) || !safe_path(&temporary) {
            return Err(invalid());
        }
        fs::rename(&temporary, path)
    })();
    if result.is_err() && safe_path(&temporary) {
        let _ = fs::remove_file(&temporary);
    }
    result
}

/// Private runtime/routes data is accessible only to this user (and Windows SYSTEM).
pub fn protect(path: &Path) -> io::Result<()> {
    if !safe_path(path) {
        return Err(invalid());
    }
    platform::protect(path)
}

pub struct RuntimeOwner {
    root: PathBuf,
    installation: String,
    epoch: String,
    created: String,
    handoff_until: std::sync::atomic::AtomicI64,
    _lease: platform::Lease,
}

impl RuntimeOwner {
    pub fn start(root: &Path, epoch: &str) -> io::Result<Self> {
        if epoch.is_empty() || epoch.len() > 128 || epoch.chars().any(char::is_control) {
            return Err(invalid());
        }
        let marker_path = root.join(".cloudlink.json");
        let mut marker = read_owned_json(&marker_path, "data", MAX_RUNTIME)?;
        let installation = installation_id(root)?;
        let lease = platform::Lease::acquire(root, &installation)?;
        let path = root.join("runtime.json");
        let before = bounded_file(&path, MAX_RUNTIME)?;
        if before.is_some() && marker["runtimeOwned"] != true {
            read_owned_json(&path, "runtime", MAX_RUNTIME)?;
        }
        if marker["runtimeOwned"] != true {
            marker["runtimeOwned"] = Value::Bool(true);
            write_atomic(&marker_path, &serde_json::to_vec(&marker).map_err(|_| invalid())?)?;
        }
        let owner = Self {
            root: root.to_path_buf(),
            installation,
            epoch: epoch.into(),
            created: platform::process_created(std::process::id())?.ok_or_else(invalid)?,
            handoff_until: std::sync::atomic::AtomicI64::new(0),
            _lease: lease,
        };
        owner.publish("starting", None, None)?;
        Ok(owner)
    }

    pub fn installation_id(&self) -> &str {
        &self.installation
    }

    pub fn epoch(&self) -> &str {
        &self.epoch
    }

    pub fn publish_handoff(&self, until_secs: i64) -> io::Result<()> {
        let now = unix_secs();
        if until_secs <= now || until_secs > now.saturating_add(300) {
            return Err(invalid());
        }
        self.handoff_until
            .store(until_secs, std::sync::atomic::Ordering::SeqCst);
        self.publish("starting", None, None)
    }

    pub fn publish(&self, state: &str, endpoint: Option<&str>, capability: Option<&str>) -> io::Result<()> {
        if !["starting", "active", "stopping", "stopped"].contains(&state) {
            return Err(invalid());
        }
        if state == "active" {
            let endpoint = endpoint.ok_or_else(invalid)?;
            let address: std::net::SocketAddr = endpoint.parse().map_err(|_| invalid())?;
            if address.ip() != std::net::IpAddr::V4(std::net::Ipv4Addr::LOCALHOST)
                || address.port() == 0
                || !capability.is_some_and(valid_token)
            {
                return Err(invalid());
            }
        }
        let marker = read_owned_json(&self.root.join(".cloudlink.json"), "data", MAX_RUNTIME)?;
        if marker["runtimeOwned"] != true || installation_id(&self.root)? != self.installation {
            return Err(invalid());
        }
        if state == "active" {
            self.handoff_until.store(0, std::sync::atomic::Ordering::SeqCst);
        }
        let until = self.handoff_until.load(std::sync::atomic::Ordering::SeqCst);
        let handoff = until > unix_secs() && until <= unix_secs().saturating_add(300);
        let mut value = json!({
            "managedBy":"cloudlink", "kind":"runtime", "version":crate::protocol::VERSION,
            "installationId":self.installation, "epoch":self.epoch,
            "pid":std::process::id(), "processCreated":self.created,
            "state":if handoff { "starting" } else { state }, "endpoint":endpoint, "capability":capability,
        });
        if handoff {
            value["handoffUntilSecs"] = json!(until);
        }
        write_atomic(
            &self.root.join("runtime.json"),
            &serde_json::to_vec(&value).map_err(|_| invalid())?,
        )
    }
}

pub fn valid_token(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

/// One record read, one process-identity query. The per-root lease also closes the
/// starting-before-record race and prevents an old dead record hiding a new instance.
pub fn snapshot(root: &Path) -> io::Result<Value> {
    read_owned_json(&root.join(".cloudlink.json"), "data", MAX_RUNTIME)?;
    let installation = installation_id(root)?;
    let bytes = bounded_file(&root.join("runtime.json"), MAX_RUNTIME)?;
    let record = match bytes {
        Some(bytes) => {
            let value: Value = serde_json::from_slice(&bytes).map_err(|_| invalid())?;
            if value["managedBy"] != "cloudlink"
                || value["kind"] != "runtime"
                || value["version"].as_u64() != Some(crate::protocol::VERSION)
                || value["installationId"].as_str() != Some(&installation)
                || !value["epoch"].as_str().is_some_and(|s| !s.is_empty() && s.len() <= 128)
                || !matches!(
                    value["state"].as_str(),
                    Some("starting" | "active" | "stopping" | "stopped")
                )
                || !value["handoffUntilSecs"].is_null()
                    && (value["state"] != "starting"
                        || !value["handoffUntilSecs"]
                            .as_i64()
                            .is_some_and(|until| until >= 0 && until <= unix_secs().saturating_add(300)))
            {
                return Err(invalid());
            }
            Some(value)
        }
        None => None,
    };
    let held = platform::Lease::exists(root, &installation)?;
    let Some(mut record) = record else {
        if held {
            return Err(not_ready());
        }
        return Ok(json!({"version":crate::protocol::VERSION,"installationId":installation,"state":"stopped"}));
    };
    let pid = record["pid"]
        .as_u64()
        .filter(|pid| *pid > 0 && *pid <= u64::from(u32::MAX))
        .ok_or_else(invalid)?;
    let created = record["processCreated"]
        .as_str()
        .filter(|created| !created.is_empty())
        .ok_or_else(invalid)?;
    let live = platform::process_created(pid as u32)?.is_some_and(|actual| actual == created);
    if !live {
        if held {
            return Err(not_ready());
        }
        if record["state"] == "starting"
            && record["handoffUntilSecs"]
                .as_i64()
                .is_some_and(|until| until > unix_secs() && until <= unix_secs().saturating_add(300))
        {
            record["endpoint"] = Value::Null;
            record["capability"] = Value::Null;
            return Ok(record);
        }
        record["state"] = Value::String("stopped".into());
        record["endpoint"] = Value::Null;
        record["capability"] = Value::Null;
        return Ok(record);
    }
    if !held {
        return Err(invalid());
    }
    // stopped is a durable intent, not proof that the process has exited.
    if record["state"] == "stopped" {
        record["state"] = Value::String("stopping".into());
    }
    if record["state"] == "active" {
        let endpoint = record["endpoint"].as_str().ok_or_else(invalid)?;
        let address: std::net::SocketAddr = endpoint.parse().map_err(|_| invalid())?;
        if address.ip() != std::net::IpAddr::V4(std::net::Ipv4Addr::LOCALHOST)
            || address.port() == 0
            || !record["capability"].as_str().is_some_and(valid_token)
        {
            return Err(invalid());
        }
    }
    Ok(record)
}

fn unix_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
        .min(i64::MAX as u64) as i64
}

fn invalid() -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, "runtime-invalid")
}

fn not_ready() -> io::Error {
    io::Error::new(io::ErrorKind::WouldBlock, "runtime-not-ready")
}

#[cfg(windows)]
mod platform {
    use super::*;
    use std::ffi::c_void;
    use std::os::windows::ffi::OsStrExt;
    use std::ptr::{null, null_mut};

    type Handle = *mut c_void;
    #[repr(C)]
    #[derive(Default)]
    struct FileTime {
        low: u32,
        high: u32,
    }
    #[repr(C)]
    struct SidAndAttributes {
        sid: *mut c_void,
        attributes: u32,
    }

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn CreateMutexW(attributes: *const c_void, initial_owner: i32, name: *const u16) -> Handle;
        fn OpenMutexW(access: u32, inherit: i32, name: *const u16) -> Handle;
        fn ReleaseMutex(handle: Handle) -> i32;
        fn CloseHandle(handle: Handle) -> i32;
        fn GetLastError() -> u32;
        fn OpenProcess(access: u32, inherit: i32, pid: u32) -> Handle;
        fn GetProcessTimes(
            process: Handle,
            creation: *mut FileTime,
            exit: *mut FileTime,
            kernel: *mut FileTime,
            user: *mut FileTime,
        ) -> i32;
        fn GetExitCodeProcess(process: Handle, code: *mut u32) -> i32;
        fn GetCurrentProcess() -> Handle;
        fn LocalFree(memory: Handle) -> Handle;
    }
    #[link(name = "advapi32")]
    unsafe extern "system" {
        fn OpenProcessToken(process: Handle, access: u32, token: *mut Handle) -> i32;
        fn GetTokenInformation(
            token: Handle,
            class: u32,
            information: *mut c_void,
            length: u32,
            needed: *mut u32,
        ) -> i32;
        fn ConvertSidToStringSidW(sid: *const c_void, text: *mut *mut u16) -> i32;
        fn ConvertStringSecurityDescriptorToSecurityDescriptorW(
            text: *const u16,
            revision: u32,
            descriptor: *mut Handle,
            size: *mut u32,
        ) -> i32;
        fn SetFileSecurityW(path: *const u16, information: u32, descriptor: *const c_void) -> i32;
    }
    #[link(name = "bcrypt")]
    unsafe extern "system" {
        fn BCryptGenRandom(algorithm: Handle, buffer: *mut u8, length: u32, flags: u32) -> i32;
    }

    fn wide(text: &std::ffi::OsStr) -> Vec<u16> {
        text.encode_wide().chain(Some(0)).collect()
    }
    fn name(id: &str) -> Vec<u16> {
        wide(std::ffi::OsStr::new(&format!("Local\\CloudLink.Runtime.{id}")))
    }
    fn error() -> io::Error {
        io::Error::last_os_error()
    }

    pub struct Lease(Handle);
    // The handle is an immutable process-owned lease; no thread waits on it.
    unsafe impl Send for Lease {}
    unsafe impl Sync for Lease {}
    impl Lease {
        pub fn acquire(_root: &Path, id: &str) -> io::Result<Self> {
            let handle = unsafe { CreateMutexW(null(), 0, name(id).as_ptr()) };
            if handle.is_null() {
                return Err(error());
            }
            if unsafe { GetLastError() } == 183 {
                unsafe {
                    CloseHandle(handle);
                }
                return Err(io::Error::new(io::ErrorKind::AddrInUse, "runtime-instance-active"));
            }
            Ok(Self(handle))
        }
        pub fn exists(_root: &Path, id: &str) -> io::Result<bool> {
            let handle = unsafe { OpenMutexW(0x0010_0000, 0, name(id).as_ptr()) };
            if !handle.is_null() {
                unsafe {
                    CloseHandle(handle);
                }
                return Ok(true);
            }
            if unsafe { GetLastError() } == 2 {
                Ok(false)
            } else {
                Err(error())
            }
        }
    }
    impl Drop for Lease {
        fn drop(&mut self) {
            unsafe {
                ReleaseMutex(self.0);
                CloseHandle(self.0);
            }
        }
    }

    pub fn process_created(pid: u32) -> io::Result<Option<String>> {
        let handle = unsafe { OpenProcess(0x1000, 0, pid) };
        if handle.is_null() {
            return if unsafe { GetLastError() } == 87 {
                Ok(None)
            } else {
                Err(error())
            };
        }
        let mut created = FileTime::default();
        let mut exit = FileTime::default();
        let mut kernel = FileTime::default();
        let mut user = FileTime::default();
        let mut code = 0;
        let ok = unsafe {
            GetProcessTimes(handle, &mut created, &mut exit, &mut kernel, &mut user) != 0
                && GetExitCodeProcess(handle, &mut code) != 0
        };
        let failure = (!ok).then(error);
        unsafe {
            CloseHandle(handle);
        }
        if let Some(error) = failure {
            return Err(error);
        }
        if code != 259 {
            return Ok(None);
        }
        Ok(Some(format!(
            "{:016x}",
            (u64::from(created.high) << 32) | u64::from(created.low)
        )))
    }

    pub fn random(bytes: &mut [u8]) -> io::Result<()> {
        let status = unsafe { BCryptGenRandom(null_mut(), bytes.as_mut_ptr(), bytes.len() as u32, 2) };
        if status >= 0 {
            Ok(())
        } else {
            Err(io::Error::other("execution-random-unavailable"))
        }
    }

    pub fn protect(path: &Path) -> io::Result<()> {
        let mut token = null_mut();
        if unsafe { OpenProcessToken(GetCurrentProcess(), 8, &mut token) } == 0 {
            return Err(error());
        }
        let result = (|| {
            let mut length = 0;
            unsafe {
                GetTokenInformation(token, 1, null_mut(), 0, &mut length);
            }
            if length == 0 || length > 16_384 {
                return Err(error());
            }
            // u64 storage supplies pointer alignment for TOKEN_USER.
            let mut storage = vec![0u64; (length as usize).div_ceil(8)];
            if unsafe { GetTokenInformation(token, 1, storage.as_mut_ptr().cast(), length, &mut length) } == 0 {
                return Err(error());
            }
            let user = unsafe { &*storage.as_ptr().cast::<SidAndAttributes>() };
            let mut sid = null_mut();
            if unsafe { ConvertSidToStringSidW(user.sid, &mut sid) } == 0 {
                return Err(error());
            }
            let mut size = 0;
            while unsafe { *sid.add(size) } != 0 {
                size += 1;
            }
            let sid_text = String::from_utf16_lossy(unsafe { std::slice::from_raw_parts(sid, size) });
            unsafe {
                LocalFree(sid.cast());
            }
            let sddl = wide(std::ffi::OsStr::new(&format!(
                "D:P(A;OICI;FA;;;{sid_text})(A;OICI;FA;;;SY)"
            )));
            let mut descriptor = null_mut();
            if unsafe {
                ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl.as_ptr(), 1, &mut descriptor, null_mut())
            } == 0
            {
                return Err(error());
            }
            let ok = unsafe { SetFileSecurityW(wide(path.as_os_str()).as_ptr(), 0x8000_0004, descriptor) } != 0;
            let failure = (!ok).then(error);
            unsafe {
                LocalFree(descriptor);
            }
            failure.map_or(Ok(()), Err)
        })();
        unsafe {
            CloseHandle(token);
        }
        result
    }
}

#[cfg(not(windows))]
mod platform {
    use super::*;
    use std::os::fd::AsRawFd;
    use std::os::unix::fs::PermissionsExt;
    unsafe extern "C" {
        fn flock(fd: i32, operation: i32) -> i32;
        fn kill(pid: i32, signal: i32) -> i32;
    }
    pub struct Lease(fs::File);
    impl Lease {
        fn file(root: &Path) -> io::Result<fs::File> {
            let path = root.join(".runtime.lock");
            if !safe_path(&path) {
                return Err(invalid());
            }
            let file = OpenOptions::new()
                .read(true)
                .write(true)
                .create(true)
                .truncate(false)
                .open(path)?;
            file.set_permissions(fs::Permissions::from_mode(0o600))?;
            Ok(file)
        }
        pub fn acquire(root: &Path, _id: &str) -> io::Result<Self> {
            let file = Self::file(root)?;
            if unsafe { flock(file.as_raw_fd(), 2 | 4) } != 0 {
                return Err(io::Error::last_os_error());
            }
            Ok(Self(file))
        }
        pub fn exists(root: &Path, _id: &str) -> io::Result<bool> {
            let path = root.join(".runtime.lock");
            if !safe_path(&path) {
                return Err(invalid());
            }
            if !path.try_exists()? {
                return Ok(false);
            }
            let file = Self::file(root)?;
            if unsafe { flock(file.as_raw_fd(), 2 | 4) } == 0 {
                unsafe {
                    flock(file.as_raw_fd(), 8);
                }
                Ok(false)
            } else {
                let error = io::Error::last_os_error();
                if error.kind() == io::ErrorKind::WouldBlock {
                    Ok(true)
                } else {
                    Err(error)
                }
            }
        }
    }
    impl Drop for Lease {
        fn drop(&mut self) {
            unsafe {
                flock(self.0.as_raw_fd(), 8);
            }
        }
    }
    pub fn process_created(pid: u32) -> io::Result<Option<String>> {
        if pid == 0 || pid > i32::MAX as u32 {
            return Ok(None);
        }
        if unsafe { kill(pid as i32, 0) } != 0 {
            let error = io::Error::last_os_error();
            return if error.raw_os_error() == Some(3) {
                Ok(None)
            } else {
                Err(error)
            };
        }
        // Linux start ticks distinguish PID reuse without launching a process.
        #[cfg(target_os = "linux")]
        {
            let text = fs::read_to_string(format!("/proc/{pid}/stat"))?;
            let fields = text
                .rsplit_once(')')
                .ok_or_else(invalid)?
                .1
                .split_whitespace()
                .collect::<Vec<_>>();
            if fields.first() == Some(&"Z") {
                return Ok(None);
            }
            return fields.get(19).map(|s| Some((*s).into())).ok_or_else(invalid);
        }
        #[cfg(not(target_os = "linux"))]
        Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "runtime-process-identity-unsupported",
        ))
    }
    pub fn random(bytes: &mut [u8]) -> io::Result<()> {
        fs::File::open("/dev/urandom")?.read_exact(bytes)
    }
    pub fn protect(path: &Path) -> io::Result<()> {
        let mode = if fs::symlink_metadata(path)?.is_dir() {
            0o700
        } else {
            0o600
        };
        fs::set_permissions(path, fs::Permissions::from_mode(mode))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Directory(PathBuf);
    impl Directory {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!("cloudlink-runtime-{}", nonce().unwrap()));
            fs::create_dir(&path).unwrap();
            fs::write(
                path.join(".cloudlink.json"),
                b"{\"managedBy\":\"cloudlink\",\"kind\":\"data\"}",
            )
            .unwrap();
            Self(path)
        }
    }
    impl Drop for Directory {
        fn drop(&mut self) {
            assert!(safe_path(&self.0));
            assert_eq!(
                read_owned_json(&self.0.join(".cloudlink.json"), "data", MAX_RUNTIME).unwrap()["managedBy"],
                "cloudlink"
            );
            fs::remove_dir_all(&self.0).unwrap();
        }
    }

    #[test]
    fn live_stopped_record_is_not_an_exit_and_instances_do_not_cross() {
        let a = Directory::new();
        let b = Directory::new();
        let owner = RuntimeOwner::start(&a.0, "epoch-a").unwrap();
        assert_eq!(snapshot(&a.0).unwrap()["state"], "starting");
        assert_eq!(snapshot(&b.0).unwrap()["state"], "stopped");
        assert!(RuntimeOwner::start(&a.0, "epoch-other").is_err());
        owner
            .publish("active", Some("127.0.0.1:40000"), Some(&nonce().unwrap()))
            .unwrap();
        assert_eq!(snapshot(&a.0).unwrap()["state"], "active");
        owner.publish("stopped", None, None).unwrap();
        assert_eq!(snapshot(&a.0).unwrap()["state"], "stopping");
    }

    #[test]
    fn malformed_and_foreign_runtime_records_never_mean_not_running() {
        let directory = Directory::new();
        fs::write(directory.0.join("runtime.json"), b"{").unwrap();
        assert!(snapshot(&directory.0).is_err());
        assert!(RuntimeOwner::start(&directory.0, "epoch").is_err());
        fs::write(directory.0.join("runtime.json"), b"{\"managedBy\":\"other\"}").unwrap();
        assert!(snapshot(&directory.0).is_err());
    }

    #[test]
    fn bounded_update_handoff_is_not_an_exit_after_old_process_disappears() {
        let directory = Directory::new();
        let value = json!({"managedBy":"cloudlink","kind":"runtime","version":1,
            "installationId":installation_id(&directory.0).unwrap(),"epoch":"updating",
            "pid":u32::MAX,"processCreated":"0","state":"starting","handoffUntilSecs":unix_secs()+60});
        fs::write(directory.0.join("runtime.json"), serde_json::to_vec(&value).unwrap()).unwrap();
        assert_eq!(snapshot(&directory.0).unwrap()["state"], "starting");
        let mut expired = value;
        expired["handoffUntilSecs"] = json!(unix_secs() - 1);
        fs::write(directory.0.join("runtime.json"), serde_json::to_vec(&expired).unwrap()).unwrap();
        assert_eq!(snapshot(&directory.0).unwrap()["state"], "stopped");
        expired["handoffUntilSecs"] = json!(unix_secs() + 3600);
        fs::write(directory.0.join("runtime.json"), serde_json::to_vec(&expired).unwrap()).unwrap();
        assert!(snapshot(&directory.0).is_err());
    }

    #[test]
    fn dead_process_record_requires_no_new_instance_and_matching_installation() {
        let directory = Directory::new();
        let value = json!({"managedBy":"cloudlink","kind":"runtime","version":1,
            "installationId":installation_id(&directory.0).unwrap(),"epoch":"old",
            "pid":u32::MAX,"processCreated":"0","state":"active"});
        fs::write(directory.0.join("runtime.json"), serde_json::to_vec(&value).unwrap()).unwrap();
        assert_eq!(snapshot(&directory.0).unwrap()["state"], "stopped");
        let mut foreign = value;
        foreign["installationId"] = Value::String("another-installation".into());
        fs::write(directory.0.join("runtime.json"), serde_json::to_vec(&foreign).unwrap()).unwrap();
        assert!(snapshot(&directory.0).is_err());
    }
}
